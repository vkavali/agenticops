import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// Get health check history for a service
router.get('/:serviceId', async (req, res) => {
  const range = req.query.range || '1h';
  const rangeMs = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 }[range] || 3600000;
  const since = Date.now() - rangeMs;

  const rows = await query(
    'SELECT status, response_time, status_code, checked_at FROM health_checks WHERE service_id=$1 AND checked_at > $2 ORDER BY checked_at ASC',
    [req.params.serviceId, since]
  );

  // Compute summary
  const total = rows.length;
  const healthy = rows.filter(r => r.status === 'healthy').length;
  const uptime = total > 0 ? ((healthy / total) * 100).toFixed(2) : '100.00';
  const avgResponseTime = total > 0 ? Math.round(rows.reduce((s, r) => s + r.response_time, 0) / total) : 0;
  const p99 = total > 0 ? rows.map(r => r.response_time).sort((a, b) => a - b)[Math.floor(total * 0.99)] : 0;

  res.json({
    serviceId: req.params.serviceId,
    range, total, uptime, avgResponseTime, p99,
    checks: rows.map(r => ({
      status: r.status,
      responseTime: r.response_time,
      statusCode: r.status_code,
      timestamp: Number(r.checked_at),
    })),
  });
});

export default router;
