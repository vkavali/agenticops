import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const rows = await query('SELECT * FROM activity ORDER BY activity_timestamp DESC LIMIT $1 OFFSET $2', [limit, offset]);
  res.json(rows.map(a => ({
    time: getTimeAgo(Number(a.activity_timestamp)),
    timestamp: Number(a.activity_timestamp),
    event: a.event,
    type: a.type,
  })));
});

function getTimeAgo(timestamp) {
  if (!timestamp) return '—';
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default router;
