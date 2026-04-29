import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { record } from '../audit.js';

const router = Router();

// List gates, optionally filtered by status (?status=pending) or subject.
router.get('/', requireAuth('viewer'), async (req, res) => {
  const { status, subject_type, subject_id } = req.query;
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (subject_type) { params.push(subject_type); where.push(`subject_type = $${params.length}`); }
  if (subject_id) { params.push(subject_id); where.push(`subject_id = $${params.length}`); }
  const sql = `SELECT * FROM approval_gates ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`;
  res.json(await query(sql, params));
});

router.get('/:id', requireAuth('viewer'), async (req, res) => {
  const row = await queryOne('SELECT * FROM approval_gates WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Approve / reject. Required role is set per-gate at creation; default operator.
router.post('/:id/decide', requireAuth('viewer'), async (req, res) => {
  const { decision } = req.body;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved|rejected' });
  }
  const gate = await queryOne('SELECT * FROM approval_gates WHERE id=$1', [req.params.id]);
  if (!gate) return res.status(404).json({ error: 'Not found' });
  if (gate.status !== 'pending') return res.status(409).json({ error: `Already ${gate.status}` });

  const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };
  if (ROLE_RANK[req.auth.role] < ROLE_RANK[gate.required_role]) {
    return res.status(403).json({ error: `Requires role ${gate.required_role}` });
  }

  await execute(
    'UPDATE approval_gates SET status=$1, decided_by=$2, decided_at=$3 WHERE id=$4',
    [decision, req.auth.label || String(req.auth.tokenId), Date.now(), req.params.id]
  );
  await record({
    actor: req.auth.label,
    action: `gate:${decision}`,
    target: req.params.id,
    detail: { subject_type: gate.subject_type, subject_id: gate.subject_id },
  });
  broadcast('gate:updated', { id: req.params.id, status: decision });
  res.json({ ok: true, status: decision });
});

// Programmatic creation — used by the executor / IaC engine, not by users directly.
// Exposed so internal tools can poll / trigger gates over HTTP if needed.
export async function createGate({ subject_type, subject_id, description, required_role, requested_by, payload, ttl_ms }) {
  const id = `gate-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = Date.now();
  const expires = ttl_ms ? now + ttl_ms : null;
  await execute(
    `INSERT INTO approval_gates
     (id, subject_type, subject_id, description, status, required_role, requested_by, payload, created_at, expires_at)
     VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9)`,
    [id, subject_type, subject_id, description || null, required_role || 'operator', requested_by || null,
     payload ? JSON.stringify(payload) : null, now, expires]
  );
  broadcast('gate:created', { id, subject_type, subject_id, description, required_role: required_role || 'operator' });
  return id;
}

router.post('/', requireAuth('operator'), async (req, res) => {
  const { subject_type, subject_id, description, required_role, payload, ttl_ms } = req.body;
  if (!subject_type || !subject_id) return res.status(400).json({ error: 'subject_type and subject_id required' });
  const id = await createGate({
    subject_type, subject_id, description, required_role, payload, ttl_ms,
    requested_by: req.auth.label || String(req.auth.tokenId),
  });
  res.status(201).json({ id });
});

export default router;
