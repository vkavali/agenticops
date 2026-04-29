import { spawn } from 'child_process';
import { mkdtemp, rm, readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { queryOne, execute } from './db.js';
import { broadcast } from './sse.js';
import { decrypt } from './crypto.js';
import { createGate } from './routes/gates.js';
import { diagnoseAndPatch, isAgentEnabled } from './agent.js';

// Terraform runner.
//
// Each run mints a temporary work dir, clones the linked repo, and runs
// terraform init / plan / apply in `tf_dir`. Output is streamed via SSE under
// `iac:log` events tagged with the run id. The plan summary (counts of
// add/change/destroy) is parsed for the UI.

const activeRuns = new Map(); // runId -> child process

function spawnCmd(cmd, args, cwd, runId, stage) {
  return new Promise((resolve) => {
    const logs = [];
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, TF_IN_AUTOMATION: '1', TF_INPUT: '0' },
      timeout: 10 * 60 * 1000,
    });
    activeRuns.set(runId, proc);

    const onLine = (data, prefix = '') => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const out = `${prefix}${line}`;
        logs.push(out);
        broadcast('iac:log', { runId, stage, line: out });
      }
    };
    proc.stdout.on('data', d => onLine(d));
    proc.stderr.on('data', d => onLine(d, '[stderr] '));
    proc.on('close', (exitCode) => {
      activeRuns.delete(runId);
      resolve({ exitCode: exitCode ?? 0, logs });
    });
    proc.on('error', (err) => {
      activeRuns.delete(runId);
      logs.push(`[error] ${err.message}`);
      resolve({ exitCode: 1, logs });
    });
  });
}

export function cancelRun(runId) {
  const p = activeRuns.get(runId);
  if (!p) return false;
  try { p.kill('SIGTERM'); } catch {}
  activeRuns.delete(runId);
  return true;
}

// Walk tf_dir and concatenate all .tf / .tfvars files into a single string for
// the agent. Caps total bytes so a misconfigured dir can't blow up the prompt.
const MAX_SOURCE_BYTES = 800_000; // ~200K tokens at 4 bytes/token, well under the 1M ctx
async function readTerraformSource(rootDir) {
  const out = [];
  let bytes = 0;
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      const r = path.join(rel, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, r);
      } else if (/\.(tf|tfvars|hcl)$/.test(ent.name)) {
        const s = await stat(abs);
        if (bytes + s.size > MAX_SOURCE_BYTES) continue;
        const body = await readFile(abs, 'utf8');
        out.push(`# === ${r} ===\n${body}`);
        bytes += s.size;
      }
    }
  }
  await walk(rootDir, '');
  return out.join('\n\n');
}

// Parse `terraform plan` summary line: "Plan: X to add, Y to change, Z to destroy."
function parsePlanSummary(planText) {
  const m = planText.match(/Plan:\s+(\d+)\s+to add,\s+(\d+)\s+to change,\s+(\d+)\s+to destroy/);
  if (m) return { add: +m[1], change: +m[2], destroy: +m[3] };
  if (/No changes\.\s+Your infrastructure matches the configuration/.test(planText)) {
    return { add: 0, change: 0, destroy: 0 };
  }
  return null;
}

async function getCloneToken(config) {
  if (!config.repo_full_name) return null;
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  return conn?.access_token ? decrypt(conn.access_token) : null;
}

async function setupWorkdir(config) {
  const token = await getCloneToken(config);
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'aops-iac-'));
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${config.repo_full_name}.git`
    : `https://github.com/${config.repo_full_name}.git`;
  return { workDir, cloneUrl, branch: config.branch || 'main' };
}

async function recordRunStart(configId, kind, triggeredBy, incidentId = null) {
  const id = `iac-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = Date.now();
  await execute(
    `INSERT INTO iac_runs (id, iac_config_id, kind, status, triggered_by, incident_id, started_at)
     VALUES ($1,$2,$3,'running',$4,$5,$6)`,
    [id, configId, kind, triggeredBy || 'system', incidentId, now]
  );
  broadcast('iac:run-started', { id, iac_config_id: configId, kind });
  return id;
}

async function finishRun(runId, fields) {
  const finishedAt = Date.now();
  const start = await queryOne('SELECT started_at FROM iac_runs WHERE id=$1', [runId]);
  const duration = start ? finishedAt - Number(start.started_at) : null;
  await execute(
    `UPDATE iac_runs SET status=$1, plan_summary=$2, proposed_patch=$3,
       agent_diagnosis=$4, gate_id=$5, finished_at=$6, duration_ms=$7,
       applied_sha=COALESCE($8, applied_sha)
     WHERE id=$9`,
    [
      fields.status,
      fields.plan_summary ? JSON.stringify(fields.plan_summary) : null,
      fields.proposed_patch || null,
      fields.agent_diagnosis || null,
      fields.gate_id || null,
      finishedAt,
      duration,
      fields.applied_sha || null,
      runId,
    ]
  );
  broadcast('iac:run-finished', { id: runId, ...fields, duration_ms: duration });
}

/**
 * Run terraform init + plan against the config. Returns { runId, summary, planText }.
 * If incident is provided, the agent is invoked to propose a patch.
 */
export async function runPlan(config, { incidentId = null, triggeredBy = null, kind = 'plan' } = {}) {
  const runId = await recordRunStart(config.id, kind, triggeredBy, incidentId);
  let workDir = null;
  let planText = '';

  try {
    const { workDir: wd, cloneUrl, branch } = await setupWorkdir(config);
    workDir = wd;
    broadcast('iac:log', { runId, stage: 'clone', line: `> Cloning ${config.repo_full_name} (${branch})` });
    const cloneRes = await spawnCmd('git', ['clone', '--depth', '1', '--branch', branch, cloneUrl, '.'], workDir, runId, 'clone');
    if (cloneRes.exitCode !== 0) {
      await finishRun(runId, { status: 'failed' });
      return { runId, status: 'failed' };
    }

    const tfDir = path.join(workDir, config.tf_dir || '.');
    const initRes = await spawnCmd('terraform', ['init', '-no-color', '-input=false'], tfDir, runId, 'init');
    if (initRes.exitCode !== 0) {
      await finishRun(runId, { status: 'failed' });
      return { runId, status: 'failed' };
    }

    const planRes = await spawnCmd('terraform', ['plan', '-no-color', '-input=false', '-detailed-exitcode'], tfDir, runId, 'plan');
    planText = planRes.logs.join('\n');
    const summary = parsePlanSummary(planText);

    // detailed-exitcode: 0 = no changes, 2 = changes present, 1 = error
    let status;
    if (planRes.exitCode === 1) status = 'failed';
    else if (kind === 'drift-check') status = (planRes.exitCode === 2) ? 'drift-detected' : 'no-changes';
    else status = 'passed';

    let diagnosis = null;
    let patch = null;
    let gateId = null;

    // If we have an incident and the agent is enabled, ask it to propose a patch.
    if (incidentId && isAgentEnabled() && status !== 'failed') {
      const incident = await queryOne('SELECT * FROM incidents WHERE id=$1', [incidentId]);
      if (incident) {
        try {
          const tfSource = await readTerraformSource(tfDir);
          broadcast('iac:log', { runId, stage: 'agent', line: '> Agent diagnosing incident...' });
          const result = await diagnoseAndPatch({
            tfSource, planOutput: planText, incident,
            onDelta: (chunk) => broadcast('iac:agent-delta', { runId, chunk }),
          });
          diagnosis = result.diagnosis;
          patch = result.patch;
          broadcast('iac:log', { runId, stage: 'agent', line: `✓ Agent proposed ${patch ? 'a patch' : 'no patch (incident not addressable via TF)'}` });
          broadcast('iac:log', { runId, stage: 'agent', line: `  cache_read=${result.usage.cache_read_input_tokens} input=${result.usage.input_tokens} output=${result.usage.output_tokens}` });

          if (patch) {
            gateId = await createGate({
              subject_type: 'iac_run',
              subject_id: runId,
              description: `Apply agent-proposed Terraform patch for incident ${incident.id}`,
              required_role: 'operator',
              requested_by: triggeredBy || 'agent',
              payload: { iac_config_id: config.id, incident_id: incidentId, runId },
              ttl_ms: 24 * 60 * 60 * 1000,
            });
          }
        } catch (err) {
          broadcast('iac:log', { runId, stage: 'agent', line: `[error] ${err.message}` });
        }
      }
    }

    await finishRun(runId, { status, plan_summary: summary, proposed_patch: patch, agent_diagnosis: diagnosis, gate_id: gateId });
    await execute('UPDATE iac_configs SET last_drift_check_at=$1 WHERE id=$2', [Date.now(), config.id]);

    return { runId, status, summary, planText, patch, diagnosis, gateId };
  } catch (err) {
    broadcast('iac:log', { runId, stage: 'system', line: `[error] ${err.message}` });
    await finishRun(runId, { status: 'failed' });
    return { runId, status: 'failed', error: err.message };
  } finally {
    if (workDir) { try { await rm(workDir, { recursive: true, force: true }); } catch {} }
  }
}

/**
 * Apply a previously-approved patch. Re-clones, applies the patch, runs
 * terraform apply. Caller is responsible for verifying the gate is approved.
 */
export async function runApply(config, sourceRun, { triggeredBy = null } = {}) {
  const runId = await recordRunStart(config.id, 'apply', triggeredBy, sourceRun.incident_id);
  let workDir = null;
  try {
    const { workDir: wd, cloneUrl, branch } = await setupWorkdir(config);
    workDir = wd;

    const cloneRes = await spawnCmd('git', ['clone', '--depth', '1', '--branch', branch, cloneUrl, '.'], workDir, runId, 'clone');
    if (cloneRes.exitCode !== 0) { await finishRun(runId, { status: 'failed' }); return { runId, status: 'failed' }; }

    const tfDir = path.join(workDir, config.tf_dir || '.');

    if (sourceRun.proposed_patch) {
      broadcast('iac:log', { runId, stage: 'patch', line: '> Applying agent-proposed patch' });
      const ok = await applyPatchToWorkdir(workDir, sourceRun.proposed_patch, runId);
      if (!ok) { await finishRun(runId, { status: 'failed' }); return { runId, status: 'failed' }; }
    }

    const initRes = await spawnCmd('terraform', ['init', '-no-color', '-input=false'], tfDir, runId, 'init');
    if (initRes.exitCode !== 0) { await finishRun(runId, { status: 'failed' }); return { runId, status: 'failed' }; }

    // Capture the HEAD SHA we're applying from. For PR-merge applies the caller
    // already passed applied_sha through sourceRun; for in-place + rollback we
    // resolve it from the working copy.
    let appliedSha = sourceRun.applied_sha || null;
    if (!appliedSha) {
      const sha = await spawnCmd('git', ['rev-parse', 'HEAD'], workDir, runId, 'sha');
      appliedSha = sha.logs.join('').trim() || null;
    }

    const applyRes = await spawnCmd('terraform', ['apply', '-no-color', '-input=false', '-auto-approve'], tfDir, runId, 'apply');
    const status = applyRes.exitCode === 0 ? 'passed' : 'failed';
    await finishRun(runId, { status, applied_sha: appliedSha });
    return { runId, status, appliedSha };
  } catch (err) {
    broadcast('iac:log', { runId, stage: 'system', line: `[error] ${err.message}` });
    await finishRun(runId, { status: 'failed' });
    return { runId, status: 'failed', error: err.message };
  } finally {
    if (workDir) { try { await rm(workDir, { recursive: true, force: true }); } catch {} }
  }
}

function applyPatchToWorkdir(workDir, patch, runId) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['apply', '--whitespace=nowarn', '-p1'], { cwd: workDir });
    proc.stdin.write(patch);
    proc.stdin.end();
    proc.stderr.on('data', d => broadcast('iac:log', { runId, stage: 'patch', line: `[stderr] ${d.toString()}` }));
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

const GITHUB_API = 'https://api.github.com';

function shortRunId(runId) {
  return runId.replace(/^iac-/, '').slice(0, 18);
}

/**
 * Open a remediation PR for an agent-proposed patch:
 *   clone → branch → apply patch → commit → push → POST /repos/.../pulls
 * Persists pr_number/pr_url/pr_branch/pr_status on the iac_run row.
 *
 * The apply does NOT run here. terraform apply happens later, when the
 * webhook for the merged PR fires (see routes/github.js).
 */
export async function openRemediationPR(config, sourceRun, { triggeredBy = null } = {}) {
  if (!config.repo_full_name) throw new Error('Config has no linked repo');
  if (!sourceRun.proposed_patch) throw new Error('Source run has no proposed patch');

  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  if (!conn?.access_token) throw new Error('No GitHub connection — cannot open PR');
  const token = decrypt(conn.access_token);

  const branch = `agenticops/remediation-${shortRunId(sourceRun.id)}`;
  let workDir = null;
  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'aops-pr-'));
    const cloneUrl = `https://x-access-token:${token}@github.com/${config.repo_full_name}.git`;

    broadcast('iac:log', { runId: sourceRun.id, stage: 'pr', line: `> Cloning ${config.repo_full_name}` });
    let r = await spawnCmd('git', ['clone', '--depth', '1', '--branch', config.branch || 'main', cloneUrl, '.'], workDir, sourceRun.id, 'pr');
    if (r.exitCode !== 0) throw new Error('clone failed');

    r = await spawnCmd('git', ['checkout', '-b', branch], workDir, sourceRun.id, 'pr');
    if (r.exitCode !== 0) throw new Error('branch creation failed');

    if (!await applyPatchToWorkdir(workDir, sourceRun.proposed_patch, sourceRun.id)) {
      throw new Error('git apply failed — patch did not apply cleanly');
    }

    // Anonymous-friendly committer identity. Real users would configure this.
    r = await spawnCmd('git', ['-c', 'user.email=agent@agenticops.local', '-c', 'user.name=AgenticOps Agent',
      'commit', '-am', `agent: remediate ${sourceRun.incident_id || sourceRun.id}`],
      workDir, sourceRun.id, 'pr');
    if (r.exitCode !== 0) throw new Error('commit failed');

    r = await spawnCmd('git', ['push', '-u', 'origin', branch], workDir, sourceRun.id, 'pr');
    if (r.exitCode !== 0) throw new Error('push failed');

    broadcast('iac:log', { runId: sourceRun.id, stage: 'pr', line: '> Opening pull request' });
    const body = [
      sourceRun.agent_diagnosis || '_Agent diagnosis unavailable._',
      '',
      '---',
      `Opened by AgenticOps for ${sourceRun.incident_id ? `incident **${sourceRun.incident_id}**` : 'a drift event'}.`,
      `Source run: \`${sourceRun.id}\`. Approval gate: \`${sourceRun.gate_id || 'n/a'}\`.`,
      'Merging this PR will trigger \`terraform apply\` on the target environment.',
    ].join('\n');

    const prRes = await fetch(`${GITHUB_API}/repos/${config.repo_full_name}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AgenticOps',
      },
      body: JSON.stringify({
        title: `agent: remediate ${sourceRun.incident_id || sourceRun.id}`,
        head: branch,
        base: config.branch || 'main',
        body,
      }),
    });
    const pr = await prRes.json();
    if (!prRes.ok || !pr.number) {
      throw new Error(`PR creation failed: ${pr.message || prRes.status}`);
    }

    await execute(
      'UPDATE iac_runs SET pr_number=$1, pr_url=$2, pr_branch=$3, pr_status=$4 WHERE id=$5',
      [pr.number, pr.html_url, branch, 'open', sourceRun.id]
    );
    broadcast('iac:log', { runId: sourceRun.id, stage: 'pr', line: `✓ PR #${pr.number} opened: ${pr.html_url}` });
    broadcast('iac:pr-opened', { runId: sourceRun.id, prNumber: pr.number, prUrl: pr.html_url });
    return { prNumber: pr.number, prUrl: pr.html_url, prBranch: branch };
  } finally {
    if (workDir) { try { await rm(workDir, { recursive: true, force: true }); } catch {} }
  }
}

/**
 * Verify the head SHA of a PR has passing CI before we apply.
 * Belt-and-suspenders next to GitHub's branch-protection: even if a PR slips
 * through with red checks, we refuse to apply.
 *
 * Returns { ok, summary } — ok=false means apply should be aborted.
 * Treats no checks as ok (caller's repo doesn't run CI).
 */
async function verifyChecksPassing(repoFullName, sha, runId) {
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  if (!conn?.access_token) return { ok: true, summary: 'no GitHub token; skipping CI gate' };
  const token = decrypt(conn.access_token);

  try {
    const res = await fetch(`${GITHUB_API}/repos/${repoFullName}/commits/${sha}/check-runs`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AgenticOps', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { ok: true, summary: `check-runs fetch ${res.status}; skipping` };
    const data = await res.json();
    const runs = data.check_runs || [];
    if (runs.length === 0) return { ok: true, summary: 'no checks configured' };

    const failed = runs.filter(r => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion));
    const pending = runs.filter(r => !r.conclusion);

    if (failed.length > 0) {
      const names = failed.map(r => `${r.name}=${r.conclusion}`).join(', ');
      broadcast('iac:log', { runId, stage: 'ci-gate', line: `✗ CI gate: ${names}` });
      return { ok: false, summary: `${failed.length} check(s) failed: ${names}` };
    }
    if (pending.length > 0) {
      const names = pending.map(r => r.name).join(', ');
      broadcast('iac:log', { runId, stage: 'ci-gate', line: `✗ CI gate: ${pending.length} check(s) still pending: ${names}` });
      return { ok: false, summary: `${pending.length} check(s) pending` };
    }
    broadcast('iac:log', { runId, stage: 'ci-gate', line: `✓ CI gate: ${runs.length} check(s) passed` });
    return { ok: true, summary: `${runs.length} checks passed` };
  } catch (err) {
    broadcast('iac:log', { runId, stage: 'ci-gate', line: `[error] check-runs fetch failed: ${err.message}` });
    // Fail closed — if we can't verify, don't apply.
    return { ok: false, summary: `check-runs fetch error: ${err.message}` };
  }
}

/**
 * Called by the GitHub webhook when a remediation PR is merged.
 * Verifies CI passed, records the previous-applied SHA for rollback,
 * then triggers terraform apply against the merged base branch.
 */
export async function onRemediationPRMerged(prNumber, mergedSha) {
  const run = await queryOne(
    'SELECT * FROM iac_runs WHERE pr_number=$1 AND pr_status=$2',
    [prNumber, 'open']
  );
  if (!run) return null;
  await execute("UPDATE iac_runs SET pr_status='merged' WHERE id=$1", [run.id]);
  broadcast('iac:pr-merged', { runId: run.id, prNumber, mergedSha });

  const config = await queryOne('SELECT * FROM iac_configs WHERE id=$1', [run.iac_config_id]);
  if (!config) return null;

  // CI gate — refuse to apply if checks aren't passing on the merge commit.
  const gate = await verifyChecksPassing(config.repo_full_name, mergedSha, run.id);
  if (!gate.ok) {
    await execute("UPDATE iac_runs SET status='failed' WHERE id=$1", [run.id]);
    broadcast('iac:run-finished', { id: run.id, status: 'failed', reason: gate.summary });
    return { runId: run.id, status: 'failed', reason: gate.summary };
  }

  // Record the previous-applied SHA for rollback before kicking off apply.
  const prevApply = await queryOne(
    `SELECT applied_sha FROM iac_runs
     WHERE iac_config_id=$1 AND kind='apply' AND status='passed' AND applied_sha IS NOT NULL
     ORDER BY started_at DESC LIMIT 1`,
    [run.iac_config_id]
  );
  await execute(
    'UPDATE iac_runs SET applied_sha=$1, previous_sha=$2 WHERE id=$3',
    [mergedSha, prevApply?.applied_sha || null, run.id]
  );

  // Run terraform apply against the merged base. Patch is already in the
  // base branch — pass proposed_patch=null to skip the in-place git apply.
  return runApply(config, { ...run, proposed_patch: null, applied_sha: mergedSha },
    { triggeredBy: `pr-merge:#${prNumber}` });
}

/**
 * Re-apply terraform at a previous SHA. Records a new iac_run with kind='apply'
 * and `rolled_back_from` pointing at the run we're undoing.
 *
 * If targetSha is omitted, picks `previous_sha` from the run being rolled back.
 */
export async function runRollback(config, sourceRun, { targetSha = null, triggeredBy = null } = {}) {
  const sha = targetSha || sourceRun.previous_sha;
  if (!sha) throw new Error('No previous SHA available for rollback');

  const runId = await recordRunStart(config.id, 'apply', triggeredBy, sourceRun.incident_id);
  await execute('UPDATE iac_runs SET rolled_back_from=$1 WHERE id=$2', [sourceRun.id, runId]);

  let workDir = null;
  try {
    const { workDir: wd, cloneUrl } = await setupWorkdir(config);
    workDir = wd;

    broadcast('iac:log', { runId, stage: 'rollback', line: `> Rolling back to ${sha.slice(0, 12)}` });
    // Full clone so we can checkout an arbitrary SHA (depth 1 won't have it).
    let r = await spawnCmd('git', ['clone', cloneUrl, '.'], workDir, runId, 'clone');
    if (r.exitCode !== 0) { await finishRun(runId, { status: 'failed' }); return { runId, status: 'failed' }; }
    r = await spawnCmd('git', ['checkout', sha], workDir, runId, 'clone');
    if (r.exitCode !== 0) { await finishRun(runId, { status: 'failed' }); return { runId, status: 'failed' }; }

    const tfDir = path.join(workDir, config.tf_dir || '.');
    const initRes = await spawnCmd('terraform', ['init', '-no-color', '-input=false'], tfDir, runId, 'init');
    if (initRes.exitCode !== 0) { await finishRun(runId, { status: 'failed' }); return { runId, status: 'failed' }; }

    const applyRes = await spawnCmd('terraform', ['apply', '-no-color', '-input=false', '-auto-approve'], tfDir, runId, 'apply');
    const status = applyRes.exitCode === 0 ? 'passed' : 'failed';
    await finishRun(runId, { status, applied_sha: sha });
    return { runId, status, appliedSha: sha };
  } catch (err) {
    broadcast('iac:log', { runId, stage: 'system', line: `[error] ${err.message}` });
    await finishRun(runId, { status: 'failed' });
    return { runId, status: 'failed', error: err.message };
  } finally {
    if (workDir) { try { await rm(workDir, { recursive: true, force: true }); } catch {} }
  }
}

export async function onRemediationPRClosed(prNumber) {
  const run = await queryOne(
    'SELECT id FROM iac_runs WHERE pr_number=$1 AND pr_status=$2',
    [prNumber, 'open']
  );
  if (!run) return;
  await execute("UPDATE iac_runs SET pr_status='closed' WHERE id=$1", [run.id]);
  broadcast('iac:pr-closed', { runId: run.id, prNumber });
}

// Drift detection sweep — run plan against every config whose interval has elapsed.
const SWEEP_INTERVAL = 5 * 60 * 1000; // every 5 min check whether configs are due

export function startDriftSweep() {
  setInterval(async () => {
    try {
      const { query } = await import('./db.js');
      const configs = await query('SELECT * FROM iac_configs');
      const now = Date.now();
      for (const c of configs) {
        const last = c.last_drift_check_at ? Number(c.last_drift_check_at) : 0;
        const interval = Number(c.drift_check_interval_ms || 3600000);
        if (now - last >= interval) {
          runPlan(c, { kind: 'drift-check', triggeredBy: 'drift-sweep' })
            .catch(err => console.error(`Drift sweep failed for ${c.id}:`, err.message));
        }
      }
    } catch (err) {
      console.error('Drift sweep tick error:', err.message);
    }
  }, SWEEP_INTERVAL);
  console.log('✓ IaC drift sweep started');
}
