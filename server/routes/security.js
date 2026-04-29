import { Router } from 'express';
import { query, queryOne, execute } from '../db.js';
import { requireAuth } from '../auth.js';
import { createScan, hasOpenCriticalFindings } from '../security.js';

const router = Router();
const operator = requireAuth('operator');

router.get('/scans', async (req, res) => {
  const { target, scan_type, limit } = req.query;
  const where = [];
  const params = [];
  if (target) { params.push(target); where.push(`target=$${params.length}`); }
  if (scan_type) { params.push(scan_type); where.push(`scan_type=$${params.length}`); }
  const lim = Math.min(parseInt(limit) || 50, 200);
  params.push(lim);
  const sql = `SELECT * FROM security_scans
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY started_at DESC LIMIT $${params.length}`;
  const rows = await query(sql, params);
  res.json(rows.map(r => ({
    ...r,
    started_at: Number(r.started_at),
    finished_at: r.finished_at ? Number(r.finished_at) : null,
  })));
});

router.get('/scans/:id', async (req, res) => {
  const scan = await queryOne('SELECT * FROM security_scans WHERE id=$1', [req.params.id]);
  if (!scan) return res.status(404).json({ error: 'Not found' });
  const findings = await query('SELECT * FROM security_findings WHERE scan_id=$1 ORDER BY severity', [scan.id]);
  res.json({
    ...scan,
    started_at: Number(scan.started_at),
    finished_at: scan.finished_at ? Number(scan.finished_at) : null,
    findings,
  });
});

// Ingest a scan from a scanner (Trivy/Semgrep/Snyk wrapper running in a
// pipeline). Body: { scan_type, target, pipeline_run_id, findings: [...] }
router.post('/scans', operator, async (req, res) => {
  const { scan_type, target, pipeline_run_id, findings } = req.body || {};
  if (!scan_type || !target) return res.status(400).json({ error: 'scan_type and target required' });
  const result = await createScan({ scanType: scan_type, target, pipelineRunId: pipeline_run_id, findings: findings || [] });
  res.status(201).json(result);
});

router.get('/findings', async (req, res) => {
  const { severity, status, target, limit } = req.query;
  const where = ["1=1"];
  const params = [];
  if (severity) { params.push(severity); where.push(`f.severity=$${params.length}`); }
  if (status) { params.push(status); where.push(`f.status=$${params.length}`); }
  if (target) { params.push(target); where.push(`s.target=$${params.length}`); }
  const lim = Math.min(parseInt(limit) || 100, 500);
  params.push(lim);
  const sql = `SELECT f.*, s.target, s.scan_type FROM security_findings f
               JOIN security_scans s ON f.scan_id=s.id
               WHERE ${where.join(' AND ')}
               ORDER BY f.severity, f.id DESC LIMIT $${params.length}`;
  res.json(await query(sql, params));
});

router.post('/findings/:id/resolve', operator, async (req, res) => {
  await execute("UPDATE security_findings SET status='resolved' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

router.post('/findings/:id/ignore', operator, async (req, res) => {
  await execute("UPDATE security_findings SET status='ignored' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// Used by other modules (deployment / IaC pre-flight).
router.get('/blockers/:target', async (req, res) => {
  const blocked = await hasOpenCriticalFindings(req.params.target);
  res.json({ target: req.params.target, blocked });
});

export default router;
