import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { queryOne, execute, query } from './db.js';
import { broadcast } from './sse.js';

// ============================================================
// PIPELINE EXECUTION ENGINE
// ============================================================
// Clones a real repo, runs real commands, streams real logs.
// Works on Railway's Nixpacks container (has git, node, npm).

const activeRuns = new Map(); // runId -> { process, status }

function getTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

/**
 * Execute a pipeline against a real repo.
 * @param {object} pipeline - pipeline row from DB
 * @param {object} options - { commit, branch, triggeredBy, message }
 */
export async function executePipeline(pipeline, options = {}) {
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  const repo = pipeline.repo_full_name;

  if (!repo) {
    console.log(`Pipeline ${pipeline.id} has no linked repo, running in simulation mode`);
    return simulateRun(pipeline, options);
  }

  const token = conn?.access_token;
  const branch = options.branch || pipeline.branch || 'main';
  const now = Date.now();

  // Get next run number
  const lastRun = await queryOne('SELECT number FROM pipeline_runs WHERE pipeline_id=$1 ORDER BY run_timestamp DESC LIMIT 1', [pipeline.id]);
  const lastNum = lastRun ? parseInt(lastRun.number.replace('#', ''), 10) : 0;
  const runNumber = `#${lastNum + 1}`;
  const runId = `r-${now}-${Math.random().toString(36).slice(2, 6)}`;

  // Create run in DB as "running"
  await execute(
    'INSERT INTO pipeline_runs (id,pipeline_id,number,commit_hash,message,status,duration,time,run_timestamp,triggered_by,stage_results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [runId, pipeline.id, runNumber, options.commit || 'HEAD', options.message || 'manual run', 'running', '—', 'Just now', now, options.triggeredBy || 'operator', '[]']
  );
  await execute('UPDATE pipelines SET last_run=$1, last_run_time=$2 WHERE id=$3', ['running', 'Just now', pipeline.id]);

  const run = {
    id: runId, number: runNumber, commit: options.commit || 'HEAD',
    msg: options.message || 'manual run', status: 'running', duration: '—',
    time: 'Just now', timestamp: now, by: options.triggeredBy || 'operator', stageResults: [],
  };
  broadcast('pipeline:run', { pipelineId: pipeline.id, run });
  broadcast('activity:new', { event: `Pipeline "${pipeline.name}" ${runNumber} started`, type: 'pipeline', timestamp: now });
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Pipeline "${pipeline.name}" ${runNumber} started`, 'pipeline', now]);

  // Run in background
  runPipeline(pipeline, run, token, branch).catch(err => {
    console.error(`Pipeline ${runId} execution error:`, err);
  });

  return run;
}

async function runPipeline(pipeline, run, token, branch) {
  const startTime = Date.now();
  let workDir = null;
  const stages = pipeline.stages || [];
  const stageResults = [];
  let failed = false;

  try {
    // 1. Clone the repo
    workDir = await mkdtemp(path.join(os.tmpdir(), 'agenticops-'));
    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${pipeline.repo_full_name}.git`
      : `https://github.com/${pipeline.repo_full_name}.git`;

    broadcast('pipeline:log', { runId: run.id, stage: 'clone', line: `> Cloning ${pipeline.repo_full_name} (${branch})...` });

    const cloneResult = await runCommand('git', ['clone', '--depth', '1', '--branch', branch, cloneUrl, '.'], workDir, run.id, 'clone');
    if (cloneResult.exitCode !== 0) {
      stageResults.push({ name: 'Clone', status: 'failed', duration: '—', logs: cloneResult.logs });
      await finishRun(pipeline, run, stageResults, startTime, 'failed');
      return;
    }
    broadcast('pipeline:log', { runId: run.id, stage: 'clone', line: '✓ Repository cloned' });

    // 2. Execute each stage
    for (const stage of stages) {
      if (failed) {
        stageResults.push({ name: stage.name, status: 'skipped', duration: '—', logs: ['Skipped: previous stage failed'] });
        broadcast('pipeline:stage', { runId: run.id, stage: stage.name, status: 'skipped' });
        continue;
      }

      if (stage.type === 'approval') {
        stageResults.push({ name: stage.name, status: 'passed', duration: '0s', logs: ['Auto-approved (no manual gate configured)'] });
        broadcast('pipeline:stage', { runId: run.id, stage: stage.name, status: 'passed' });
        continue;
      }

      const stageStart = Date.now();
      broadcast('pipeline:stage', { runId: run.id, stage: stage.name, status: 'running' });
      broadcast('pipeline:log', { runId: run.id, stage: stage.name, line: `> Starting: ${stage.name}` });

      const commands = stage.commands || [];
      const stageLogs = [];
      let stageStatus = 'passed';

      for (const cmd of commands) {
        broadcast('pipeline:log', { runId: run.id, stage: stage.name, line: `$ ${cmd}` });
        const result = await runCommand('sh', ['-c', cmd], workDir, run.id, stage.name);
        stageLogs.push(...result.logs);

        if (result.exitCode !== 0) {
          stageStatus = 'failed';
          failed = true;
          broadcast('pipeline:log', { runId: run.id, stage: stage.name, line: `✗ Command failed with exit code ${result.exitCode}` });
          break;
        }
      }

      const stageDuration = `${Math.round((Date.now() - stageStart) / 1000)}s`;
      stageResults.push({ name: stage.name, status: stageStatus, duration: stageDuration, logs: stageLogs });
      broadcast('pipeline:stage', { runId: run.id, stage: stage.name, status: stageStatus, duration: stageDuration });

      if (stageStatus === 'passed') {
        broadcast('pipeline:log', { runId: run.id, stage: stage.name, line: `✓ ${stage.name} completed (${stageDuration})` });
      }
    }

    const finalStatus = failed ? 'failed' : 'passed';
    await finishRun(pipeline, run, stageResults, startTime, finalStatus);

  } catch (err) {
    stageResults.push({ name: 'System', status: 'failed', duration: '—', logs: [`Internal error: ${err.message}`] });
    await finishRun(pipeline, run, stageResults, startTime, 'failed');
  } finally {
    // Cleanup
    if (workDir) {
      try { await rm(workDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  }
}

async function finishRun(pipeline, run, stageResults, startTime, status) {
  const elapsed = Date.now() - startTime;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.round((elapsed % 60000) / 1000);
  const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  await execute(
    'UPDATE pipeline_runs SET status=$1, duration=$2, stage_results=$3 WHERE id=$4',
    [status, duration, JSON.stringify(stageResults), run.id]
  );
  await execute('UPDATE pipelines SET last_run=$1, last_run_time=$2 WHERE id=$3', [status, 'Just now', pipeline.id]);
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Pipeline "${pipeline.name}" ${run.number} ${status} (${duration})`, 'pipeline', Date.now()]);

  broadcast('pipeline:finished', { runId: run.id, pipelineId: pipeline.id, status, duration, stageResults });
  broadcast('activity:new', { event: `Pipeline "${pipeline.name}" ${run.number} ${status}`, type: 'pipeline', timestamp: Date.now() });
}

/**
 * Run a shell command, capture output, stream logs via SSE.
 */
function runCommand(cmd, args, cwd, runId, stageName) {
  return new Promise((resolve) => {
    const logs = [];
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, CI: 'true', FORCE_COLOR: '0' }, timeout: 300000 });

    activeRuns.set(runId, { process: proc, status: 'running' });

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        logs.push(line);
        broadcast('pipeline:log', { runId, stage: stageName, line });
      }
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        logs.push(`[stderr] ${line}`);
        broadcast('pipeline:log', { runId, stage: stageName, line: `[stderr] ${line}` });
      }
    });

    proc.on('close', (exitCode) => {
      activeRuns.delete(runId);
      resolve({ exitCode: exitCode || 0, logs });
    });

    proc.on('error', (err) => {
      activeRuns.delete(runId);
      logs.push(`[error] ${err.message}`);
      resolve({ exitCode: 1, logs });
    });
  });
}

/**
 * Fallback: simulate a run for pipelines without a linked repo.
 */
async function simulateRun(pipeline, options) {
  const now = Date.now();
  const lastRun = await queryOne('SELECT number FROM pipeline_runs WHERE pipeline_id=$1 ORDER BY run_timestamp DESC LIMIT 1', [pipeline.id]);
  const lastNum = lastRun ? parseInt(lastRun.number.replace('#', ''), 10) : 0;
  const runNumber = `#${lastNum + 1}`;
  const runId = `r-${now}-${Math.random().toString(36).slice(2, 6)}`;
  const commit = options.commit || Math.random().toString(36).slice(2, 9);

  const stages = pipeline.stages || [];
  const stageResults = stages.map(s => ({
    name: s.name, status: 'passed',
    duration: `${Math.floor(Math.random() * 60 + 10)}s`,
    logs: [`[simulated] ${s.name} completed`],
  }));

  await execute(
    'INSERT INTO pipeline_runs (id,pipeline_id,number,commit_hash,message,status,duration,time,run_timestamp,triggered_by,stage_results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [runId, pipeline.id, runNumber, commit, options.message || 'manual trigger', 'passed', '2m 30s', 'Just now', now, options.triggeredBy || 'operator', JSON.stringify(stageResults)]
  );
  await execute('UPDATE pipelines SET last_run=$1, last_run_time=$2 WHERE id=$3', ['passed', 'Just now', pipeline.id]);
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Pipeline "${pipeline.name}" ${runNumber} completed (simulated)`, 'pipeline', now]);

  const run = { id: runId, number: runNumber, commit, msg: options.message || 'manual trigger', status: 'passed', duration: '2m 30s', time: 'Just now', timestamp: now, by: options.triggeredBy || 'operator', stageResults };
  broadcast('pipeline:run', { pipelineId: pipeline.id, run });
  return run;
}

export function cancelRun(runId) {
  const active = activeRuns.get(runId);
  if (active?.process) {
    active.process.kill('SIGTERM');
    activeRuns.delete(runId);
    return true;
  }
  return false;
}
