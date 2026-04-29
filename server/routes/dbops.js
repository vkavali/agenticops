import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { analyzeSql } from '../dbops.js';
import { createGate } from './gates.js';

const router = Router();
const operator = requireAuth('operator');
const admin = requireAuth('admin');

router.get('/migrations', async (req, res) => {
  const rows = await query('SELECT * FROM db_migrations ORDER BY created_at DESC LIMIT 200');
  res.json(rows.map(r => ({ ...r, created_at: Number(r.created_at), applied_at: r.applied_at ? Number(r.applied_at) : null })));
});

router.get('/migrations/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM db_migrations WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, created_at: Number(row.created_at), applied_at: row.applied_at ? Number(row.applied_at) : null });
});

// Submit a migration. Runs the safety analyzer on the SQL; warnings + score
// land on the row. If the score is critical (< 50), an approval gate is
// auto-created with required_role=admin instead of operator.
router.post('/migrations', operator, async (req, res) => {
  const { name, version, database_name, sql_text, pipeline_run_id } = req.body || {};
  if (!name || !version || !sql_text) {
    return res.status(400).json({ error: 'name, version, sql_text required' });
  }
  const { score, warnings } = analyzeSql(sql_text);
  const id = `mig-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  await execute(
    `INSERT INTO db_migrations (id, name, version, database_name, sql_text, status,
       safety_score, safety_warnings, pipeline_run_id, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)`,
    [id, name, version, database_name || null, sql_text, score,
     JSON.stringify(warnings), pipeline_run_id || null, Date.now(), req.auth?.label || null]
  );

  // Auto-gate. High-risk migrations need admin sign-off; everything else operator.
  const requiredRole = score < 50 ? 'admin' : 'operator';
  const gateId = await createGate({
    subject_type: 'db_migration',
    subject_id: id,
    description: `Apply migration "${name}" (${version}) — safety score ${score}, ${warnings.length} warning(s)`,
    required_role: requiredRole,
    requested_by: req.auth?.label || null,
    payload: { migration_id: id, score, warning_codes: warnings.map(w => w.code) },
    ttl_ms: 24 * 60 * 60 * 1000,
  });
  await execute('UPDATE db_migrations SET gate_id=$1 WHERE id=$2', [gateId, id]);

  const row = await queryOne('SELECT * FROM db_migrations WHERE id=$1', [id]);
  broadcast('db:migration-submitted', { id, score, warnings, gate_id: gateId });
  res.status(201).json({ ...row, created_at: Number(row.created_at) });
});

// Mark a migration applied. Caller is expected to have actually run it against
// the target DB (we don't auto-apply DDL across customer databases). The gate
// must be approved first.
router.post('/migrations/:id/applied', operator, async (req, res) => {
  const m = await queryOne('SELECT * FROM db_migrations WHERE id=$1', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.gate_id) {
    const gate = await queryOne('SELECT status FROM approval_gates WHERE id=$1', [m.gate_id]);
    if (!gate || gate.status !== 'approved') {
      return res.status(409).json({ error: `Gate ${m.gate_id} is ${gate?.status || 'missing'}` });
    }
  }
  await execute("UPDATE db_migrations SET status='applied', applied_at=$1 WHERE id=$2", [Date.now(), req.params.id]);
  broadcast('db:migration-applied', { id: req.params.id });
  res.json({ ok: true });
});

router.post('/migrations/:id/rollback', admin, async (req, res) => {
  await execute("UPDATE db_migrations SET status='rolled-back' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// Standalone analyze — clients can dry-run a SQL string before submitting.
router.post('/analyze', operator, (req, res) => {
  const { sql_text } = req.body || {};
  if (!sql_text) return res.status(400).json({ error: 'sql_text required' });
  res.json(analyzeSql(sql_text));
});

export default router;
