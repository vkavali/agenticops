import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { evaluate } from '../flags.js';

const router = Router();
const operator = requireAuth('operator');

const TYPES = new Set(['boolean', 'string', 'number', 'json']);

router.get('/', async (req, res) => {
  const flags = await query('SELECT * FROM flags ORDER BY key');
  // Attach active rollouts for visibility — common UI need.
  const rollouts = await query("SELECT * FROM flag_rollouts WHERE status IN ('running','paused')");
  const byFlag = new Map();
  for (const r of rollouts) byFlag.set(r.flag_id, r);
  res.json(flags.map(f => ({ ...f, rollout: byFlag.get(f.id) || null })));
});

router.get('/:key', async (req, res) => {
  const flag = await queryOne('SELECT * FROM flags WHERE key=$1', [req.params.key]);
  if (!flag) return res.status(404).json({ error: 'Not found' });
  const rules = await query('SELECT * FROM flag_rules WHERE flag_id=$1 ORDER BY priority ASC', [flag.id]);
  const rollout = await queryOne(
    "SELECT * FROM flag_rollouts WHERE flag_id=$1 AND status IN ('running','paused','complete') ORDER BY started_at DESC LIMIT 1",
    [flag.id]
  );
  res.json({ ...flag, rules, rollout });
});

router.post('/', operator, async (req, res) => {
  const { key, name, description, type, default_value, rolled_out_value, enabled } = req.body;
  if (!key || !name || !type || default_value === undefined) {
    return res.status(400).json({ error: 'key, name, type, default_value required' });
  }
  if (!TYPES.has(type)) return res.status(400).json({ error: `type must be one of ${[...TYPES].join('|')}` });

  const id = `flag-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await execute(
      `INSERT INTO flags (id, key, name, description, type, default_value, rolled_out_value, enabled, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, key, name, description || null, type, JSON.stringify(default_value),
       rolled_out_value !== undefined ? JSON.stringify(rolled_out_value) : null,
       enabled !== false, Date.now(), req.auth?.label || null]
    );
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'flag key already exists' });
    throw err;
  }
  const row = await queryOne('SELECT * FROM flags WHERE id=$1', [id]);
  broadcast('flag:created', row);
  res.status(201).json(row);
});

router.put('/:id', operator, async (req, res) => {
  const { name, description, default_value, rolled_out_value, enabled } = req.body;
  await execute(
    `UPDATE flags SET
       name=COALESCE($1,name),
       description=COALESCE($2,description),
       default_value=COALESCE($3,default_value),
       rolled_out_value=COALESCE($4,rolled_out_value),
       enabled=COALESCE($5,enabled)
     WHERE id=$6`,
    [name, description,
     default_value !== undefined ? JSON.stringify(default_value) : null,
     rolled_out_value !== undefined ? JSON.stringify(rolled_out_value) : null,
     enabled, req.params.id]
  );
  const row = await queryOne('SELECT * FROM flags WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  broadcast('flag:updated', row);
  res.json(row);
});

router.delete('/:id', operator, async (req, res) => {
  await execute('DELETE FROM flags WHERE id=$1', [req.params.id]);
  broadcast('flag:deleted', { id: req.params.id });
  res.json({ ok: true });
});

// ── Rules ──
router.post('/:id/rules', operator, async (req, res) => {
  const { conditions, value, priority, description } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value required' });
  const rid = `frule-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await execute(
    `INSERT INTO flag_rules (id, flag_id, priority, conditions, value, description, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [rid, req.params.id, priority || 0,
     JSON.stringify(conditions || []), JSON.stringify(value), description || null, Date.now()]
  );
  const row = await queryOne('SELECT * FROM flag_rules WHERE id=$1', [rid]);
  res.status(201).json(row);
});

router.delete('/:id/rules/:ruleId', operator, async (req, res) => {
  await execute('DELETE FROM flag_rules WHERE id=$1 AND flag_id=$2', [req.params.ruleId, req.params.id]);
  res.json({ ok: true });
});

// ── Evaluation (viewer ok — apps embed a viewer-scoped token) ──
router.post('/:key/evaluate', async (req, res) => {
  const result = await evaluate(req.params.key, req.body || {});
  if (result.reason === 'flag_not_found') return res.status(404).json(result);
  res.json(result);
});

// ── Rollouts ──
router.post('/:id/rollout', operator, async (req, res) => {
  const flag = await queryOne('SELECT * FROM flags WHERE id=$1', [req.params.id]);
  if (!flag) return res.status(404).json({ error: 'Not found' });

  const existing = await queryOne(
    "SELECT id FROM flag_rollouts WHERE flag_id=$1 AND status IN ('running','paused')",
    [flag.id]
  );
  if (existing) return res.status(409).json({ error: 'Rollout already active for this flag' });

  const { start_pct, target_pct, increment_pct, increment_interval_ms, slo_id } = req.body || {};
  const id = `rollout-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = Date.now();
  await execute(
    `INSERT INTO flag_rollouts (id, flag_id, start_pct, target_pct, current_pct,
       increment_pct, increment_interval_ms, slo_id, status, started_at, last_increment_at)
     VALUES ($1,$2,$3,$4,$3,$5,$6,$7,'running',$8,$8)`,
    [id, flag.id, start_pct ?? 0, target_pct ?? 100,
     increment_pct ?? 10, increment_interval_ms ?? 600000, slo_id || null, now]
  );
  const row = await queryOne('SELECT * FROM flag_rollouts WHERE id=$1', [id]);
  broadcast('flag:rollout-started', row);
  res.status(201).json(row);
});

router.post('/rollouts/:id/pause', operator, async (req, res) => {
  const reason = req.body?.reason || 'manual';
  await execute(
    "UPDATE flag_rollouts SET status='paused', pause_reason=$1 WHERE id=$2 AND status='running'",
    [reason, req.params.id]
  );
  broadcast('flag:rollout-paused', { id: req.params.id, reason });
  res.json({ ok: true });
});

router.post('/rollouts/:id/resume', operator, async (req, res) => {
  await execute(
    "UPDATE flag_rollouts SET status='running', pause_reason=NULL WHERE id=$1 AND status='paused'",
    [req.params.id]
  );
  broadcast('flag:rollout-resumed', { id: req.params.id });
  res.json({ ok: true });
});

router.post('/rollouts/:id/rollback', operator, async (req, res) => {
  const r = await queryOne('SELECT * FROM flag_rollouts WHERE id=$1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  await execute(
    "UPDATE flag_rollouts SET status='rolled-back', current_pct=$1, finished_at=$2, pause_reason=$3 WHERE id=$4",
    [r.start_pct, Date.now(), req.body?.reason || 'manual', r.id]
  );
  broadcast('flag:rollout-rolled-back', { id: r.id, reason: req.body?.reason || 'manual' });
  res.json({ ok: true });
});

export default router;
