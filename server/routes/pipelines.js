import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';
import { executePipeline, cancelRun } from '../executor.js';
import { requireAuth } from '../auth.js';

const router = Router();
const operator = requireAuth('operator');

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

// Create pipeline (defines what shell commands the executor runs — operator only)
router.post('/', operator, async (req, res) => {
  const { id, name, branch, stages, repo_full_name } = req.body;
  const pid = id || `pipe-${Date.now()}`;
  await execute(
    'INSERT INTO pipelines (id,name,branch,last_run,last_run_time,trigger_config,schedule,stages,repo_full_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [pid, name || 'new-pipeline', branch || 'main', 'new', '—', JSON.stringify({ type: 'push', branch: branch || 'main' }), null, JSON.stringify(stages || []), repo_full_name || null]
  );
  const row = await queryOne('SELECT * FROM pipelines WHERE id=$1', [pid]);
  broadcast('pipeline:created', row);
  res.status(201).json(row);
});

// Update pipeline
router.put('/:id', operator, async (req, res) => {
  const { name, branch, stages, trigger_config, schedule, repo_full_name } = req.body;
  await execute(
    'UPDATE pipelines SET name=COALESCE($1,name), branch=COALESCE($2,branch), stages=COALESCE($3,stages), trigger_config=COALESCE($4,trigger_config), schedule=COALESCE($5,schedule), repo_full_name=COALESCE($6,repo_full_name) WHERE id=$7',
    [name, branch, stages ? JSON.stringify(stages) : null, trigger_config ? JSON.stringify(trigger_config) : null, schedule, repo_full_name, req.params.id]
  );
  const row = await queryOne('SELECT * FROM pipelines WHERE id=$1', [req.params.id]);
  res.json(row);
});

// Delete pipeline
router.delete('/:id', operator, async (req, res) => {
  await execute('DELETE FROM pipelines WHERE id=$1', [req.params.id]);
  broadcast('pipeline:deleted', { id: req.params.id });
  res.json({ ok: true });
});

// Trigger a real pipeline run (uses executor — runs arbitrary shell, operator only)
router.post('/:id/run', operator, async (req, res) => {
  const pipe = await queryOne('SELECT * FROM pipelines WHERE id=$1', [req.params.id]);
  if (!pipe) return res.status(404).json({ error: 'Pipeline not found' });

  try {
    const run = await executePipeline(pipe, {
      commit: req.body.commit,
      branch: req.body.branch || pipe.branch,
      triggeredBy: req.body.by || 'operator',
      message: req.body.message || 'manual trigger',
    });
    res.status(201).json(run);
  } catch (err) {
    console.error('Pipeline execution error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cancel a running pipeline
router.post('/:pipeId/runs/:runId/cancel', operator, async (req, res) => {
  const cancelled = cancelRun(req.params.runId);
  if (cancelled) {
    await execute('UPDATE pipeline_runs SET status=$1 WHERE id=$2', ['cancelled', req.params.runId]);
    broadcast('pipeline:finished', { runId: req.params.runId, pipelineId: req.params.pipeId, status: 'cancelled' });
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Run not found or already completed' });
  }
});

// Get logs for a specific run
router.get('/:pipeId/runs/:runId/logs', async (req, res) => {
  const run = await queryOne('SELECT * FROM pipeline_runs WHERE id=$1', [req.params.runId]);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ stages: run.stage_results || [] });
});

export default router;
