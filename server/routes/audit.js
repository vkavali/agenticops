import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

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

export default router;
