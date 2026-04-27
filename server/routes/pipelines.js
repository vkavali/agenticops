import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';

const router = Router();

// List all pipelines with their runs embedded
router.get('/', async (req, res) => {
  const pipes = await query('SELECT * FROM pipelines ORDER BY name');
  const runs = await query('SELECT * FROM pipeline_runs ORDER BY run_timestamp DESC');
  const result = pipes.map(p => ({
    ...p,
    trigger: p.trigger_config,
    runs: runs.filter(r => r.pipeline_id === p.id).map(r => ({
      id: r.id, number: r.number, commit: r.commit_hash, msg: r.message,
      status: r.status, duration: r.duration, time: r.time,
      timestamp: Number(r.run_timestamp), by: r.triggered_by,
      stageResults: r.stage_results || [],
    })),
  }));
  res.json(result);
});

// Create pipeline
router.post('/', async (req, res) => {
  const { id, name, branch, stages } = req.body;
  const pid = id || `pipe-${Date.now()}`;
  await execute(
    'INSERT INTO pipelines (id,name,branch,last_run,last_run_time,trigger_config,schedule,stages) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [pid, name || 'new-pipeline', branch || 'main', 'passed', 'new', JSON.stringify({ type: 'push', branch: 'main' }), null, JSON.stringify(stages || [])]
  );
  const row = await queryOne('SELECT * FROM pipelines WHERE id=$1', [pid]);
  broadcast('pipeline:created', row);
  res.status(201).json(row);
});

// Update pipeline
router.put('/:id', async (req, res) => {
  const { name, branch, stages, trigger_config, schedule } = req.body;
  await execute(
    'UPDATE pipelines SET name=COALESCE($1,name), branch=COALESCE($2,branch), stages=COALESCE($3,stages), trigger_config=COALESCE($4,trigger_config), schedule=COALESCE($5,schedule) WHERE id=$6',
    [name, branch, stages ? JSON.stringify(stages) : null, trigger_config ? JSON.stringify(trigger_config) : null, schedule, req.params.id]
  );
  const row = await queryOne('SELECT * FROM pipelines WHERE id=$1', [req.params.id]);
  res.json(row);
});

// Delete pipeline
router.delete('/:id', async (req, res) => {
  await execute('DELETE FROM pipelines WHERE id=$1', [req.params.id]);
  broadcast('pipeline:deleted', { id: req.params.id });
  res.json({ ok: true });
});

// Trigger a pipeline run
router.post('/:id/run', async (req, res) => {
  const pipe = await queryOne('SELECT * FROM pipelines WHERE id=$1', [req.params.id]);
  if (!pipe) return res.status(404).json({ error: 'Pipeline not found' });

  // Compute next run number
  const lastRun = await queryOne('SELECT number FROM pipeline_runs WHERE pipeline_id=$1 ORDER BY run_timestamp DESC LIMIT 1', [pipe.id]);
  const lastNum = lastRun ? parseInt(lastRun.number.replace('#', ''), 10) : 0;
  const runNumber = `#${lastNum + 1}`;
  const runId = `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const commit = Math.random().toString(36).slice(2, 9);
  const now = Date.now();

  // Build stage results
  const stages = pipe.stages || [];
  const stageResults = stages.map(s => ({
    name: s.name, status: 'passed',
    duration: `${Math.floor(Math.random() * 90 + 10)}s`,
    logs: [`${s.name} completed successfully`],
  }));

  await execute(
    'INSERT INTO pipeline_runs (id,pipeline_id,number,commit_hash,message,status,duration,time,run_timestamp,triggered_by,stage_results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [runId, pipe.id, runNumber, commit, req.body.message || 'manual trigger', 'passed', '3m 12s', 'Just now', now, req.body.by || 'operator', JSON.stringify(stageResults)]
  );
  await execute('UPDATE pipelines SET last_run=$1, last_run_time=$2 WHERE id=$3', ['passed', 'Just now', pipe.id]);

  // Add activity
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Pipeline "${pipe.name}" ${runNumber} completed`, 'pipeline', now]);

  const run = { id: runId, number: runNumber, commit, msg: req.body.message || 'manual trigger', status: 'passed', duration: '3m 12s', time: 'Just now', timestamp: now, by: req.body.by || 'operator', stageResults };
  broadcast('pipeline:run', { pipelineId: pipe.id, run });
  broadcast('activity:new', { event: `Pipeline "${pipe.name}" ${runNumber} completed`, type: 'pipeline', timestamp: now });
  res.status(201).json(run);
});

export default router;
