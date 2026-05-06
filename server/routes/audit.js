import { Router } from 'express';
import { query, execute } from '../db.js';
import { requireAuth } from '../auth.js';
import { record } from '../audit.js';

const router = Router();

router.get('/', requireAuth('admin'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const rows = await query(
    'SELECT id, actor, action, target, detail, audit_timestamp FROM audit_log ORDER BY audit_timestamp DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  res.json(rows.map(r => ({ ...r, audit_timestamp: Number(r.audit_timestamp) })));
});

// Streaming export — CSV or JSONL — for SOC 2 / compliance evidence.
// Streams the entire log without buffering it all in memory.
router.get('/export', requireAuth('admin'), async (req, res) => {
  const format = req.query.format === 'jsonl' ? 'jsonl' : 'csv';
  const since = parseInt(req.query.since) || 0;
  const until = parseInt(req.query.until) || Date.now() + 1;

  res.setHeader('Content-Type', format === 'jsonl' ? 'application/x-ndjson' : 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${since}-${until}.${format}"`);

  if (format === 'csv') {
    res.write('id,actor,action,target,detail,audit_timestamp\n');
  }

  const pageSize = 1000;
  let lastId = 0;
  while (true) {
    const rows = await query(
      `SELECT id, actor, action, target, detail, audit_timestamp
       FROM audit_log
       WHERE id > $1 AND audit_timestamp BETWEEN $2 AND $3
       ORDER BY id ASC LIMIT $4`,
      [lastId, since, until, pageSize]
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      if (format === 'jsonl') {
        res.write(JSON.stringify({ ...r, audit_timestamp: Number(r.audit_timestamp) }) + '\n');
      } else {
        const detail = r.detail ? JSON.stringify(r.detail).replace(/"/g, '""') : '';
        res.write(`${r.id},"${r.actor}","${r.action}","${r.target || ''}","${detail}",${r.audit_timestamp}\n`);
      }
      lastId = Number(r.id);
    }
    if (rows.length < pageSize) break;
  }

  await record({
    actor: req.auth.label, action: 'audit:export',
    detail: { format, since, until, last_id: lastId },
  });
  res.end();
});

// Manual retention sweep — admin-triggered. The auto-sweep below runs daily.
router.post('/retention/sweep', requireAuth('admin'), async (req, res) => {
  const days = parseInt(req.body?.days) || parseInt(process.env.AUDIT_RETENTION_DAYS) || 365;
  const cutoff = Date.now() - days * 86400000;
  const result = await execute('DELETE FROM audit_log WHERE audit_timestamp < $1', [cutoff]);
  await record({ actor: req.auth.label, action: 'audit:retention-sweep', detail: { days, deleted: result.rowCount } });
  res.json({ ok: true, deleted: result.rowCount, cutoff });
});

export default router;
