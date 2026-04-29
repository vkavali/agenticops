import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { requestRun, abortRun } from '../chaos.js';

const router = Router();
const operator = requireAuth('operator');

const FAULT_TYPES = new Set(['latency', 'error-rate', 'pod-kill', 'cpu-stress', 'network-loss']);

router.get('/experiments', async (req, res) => {
  res.json(await query('SELECT * FROM chaos_experiments ORDER BY name'));
});

router.get('/experiments/:id', async (req, res) => {
  const exp = await queryOne('SELECT * FROM chaos_experiments WHERE id=$1', [req.params.id]);
  if (!exp) return res.status(404).json({ error: 'Not found' });
  const runs = await query('SELECT * FROM chaos_runs WHERE experiment_id=$1 ORDER BY started_at DESC LIMIT 50', [exp.id]);
  res.json({ ...exp, runs: runs.map(r => ({ ...r, started_at: Number(r.started_at), finished_at: r.finished_at ? Number(r.finished_at) : null })) });
});

router.post('/experiments', operator, async (req, res) => {
  const { name, target_service, fault_type, fault_config, blast_radius_pct, duration_ms, hypothesis, abort_on_slo_id } = req.body;
  if (!name || !target_service || !fault_type) {
    return res.status(400).json({ error: 'name, target_service, fault_type required' });
  }
  if (!FAULT_TYPES.has(fault_type)) {
    return res.status(400).json({ error: `fault_type must be one of ${[...FAULT_TYPES].join('|')}` });
  }
  const id = `exp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await execute(
    `INSERT INTO chaos_experiments (id, name, target_service, fault_type, fault_config,
       blast_radius_pct, duration_ms, hypothesis, abort_on_slo_id, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, name, target_service, fault_type, JSON.stringify(fault_config || {}),
     blast_radius_pct ?? 10, duration_ms ?? 60000, hypothesis || null,
     abort_on_slo_id || null, Date.now(), req.auth?.label || null]
  );
  const row = await queryOne('SELECT * FROM chaos_experiments WHERE id=$1', [id]);
  broadcast('chaos:experiment-created', row);
  res.status(201).json(row);
});

router.delete('/experiments/:id', operator, async (req, res) => {
  await execute('DELETE FROM chaos_experiments WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Request a run — creates an approval gate. Run begins when the gate is approved.
router.post('/experiments/:id/run', operator, async (req, res) => {
  try {
    const result = await requestRun(req.params.id, { triggeredBy: req.auth?.label || null });
    res.status(202).json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/runs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await query('SELECT * FROM chaos_runs ORDER BY started_at DESC LIMIT $1', [limit]);
  res.json(rows.map(r => ({ ...r, started_at: Number(r.started_at), finished_at: r.finished_at ? Number(r.finished_at) : null })));
});

router.post('/runs/:id/abort', operator, async (req, res) => {
  const ok = await abortRun(req.params.id, req.body?.reason || 'manual');
  res.json({ ok });
});

export default router;
