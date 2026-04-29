import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { evaluateAll } from '../slo.js';

const router = Router();
const operator = requireAuth('operator');

const SLI_TYPES = new Set(['availability', 'latency']);

router.get('/', async (req, res) => {
  res.json(await query('SELECT * FROM slos ORDER BY name'));
});

router.get('/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM slos WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', operator, async (req, res) => {
  const {
    id, name, service, sli_type, target_pct, window_ms,
    latency_threshold_ms, burn_rate_alert_threshold, enabled,
  } = req.body;
  if (!name || !service || !sli_type || target_pct == null) {
    return res.status(400).json({ error: 'name, service, sli_type, target_pct required' });
  }
  if (!SLI_TYPES.has(sli_type)) return res.status(400).json({ error: 'sli_type must be availability|latency' });
  if (sli_type === 'latency' && !latency_threshold_ms) {
    return res.status(400).json({ error: 'latency_threshold_ms required for sli_type=latency' });
  }

  const sid = id || `slo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await execute(
    `INSERT INTO slos (id, name, service, sli_type, target_pct, window_ms,
       latency_threshold_ms, burn_rate_alert_threshold, enabled, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [sid, name, service, sli_type, target_pct, window_ms || 2592000000,
     latency_threshold_ms || null, burn_rate_alert_threshold || 2.0,
     enabled !== false, Date.now(), req.auth?.label || null]
  );
  const row = await queryOne('SELECT * FROM slos WHERE id=$1', [sid]);
  broadcast('slo:created', row);
  res.status(201).json(row);
});

router.put('/:id', operator, async (req, res) => {
  const { name, target_pct, window_ms, latency_threshold_ms, burn_rate_alert_threshold, enabled } = req.body;
  await execute(
    `UPDATE slos SET
       name=COALESCE($1,name),
       target_pct=COALESCE($2,target_pct),
       window_ms=COALESCE($3,window_ms),
       latency_threshold_ms=COALESCE($4,latency_threshold_ms),
       burn_rate_alert_threshold=COALESCE($5,burn_rate_alert_threshold),
       enabled=COALESCE($6,enabled)
     WHERE id=$7`,
    [name, target_pct, window_ms, latency_threshold_ms, burn_rate_alert_threshold, enabled, req.params.id]
  );
  const row = await queryOne('SELECT * FROM slos WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', operator, async (req, res) => {
  await execute('DELETE FROM slos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Eval history for one SLO.
router.get('/:id/evals', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = await query(
    `SELECT id, evaluated_at, sli_value, error_budget_remaining_pct, burn_rate, sample_count, alerting
     FROM slo_evals WHERE slo_id=$1 ORDER BY evaluated_at DESC LIMIT $2`,
    [req.params.id, limit]
  );
  res.json(rows.map(r => ({
    ...r,
    evaluated_at: Number(r.evaluated_at),
    sli_value: Number(r.sli_value),
    error_budget_remaining_pct: Number(r.error_budget_remaining_pct),
    burn_rate: Number(r.burn_rate),
  })));
});

// Manual eval trigger — useful for testing without waiting for the 60s tick.
router.post('/eval', operator, async (req, res) => {
  evaluateAll().catch(err => console.error('Manual SLO eval failed:', err));
  res.status(202).json({ ok: true });
});

export default router;
