import { Router } from 'express';
import { query, execute } from '../db.js';
import { requireAuth } from '../auth.js';
import { detectAnomalies, generateRecommendations } from '../cost.js';

const router = Router();
const operator = requireAuth('operator');

// Daily cost rollup by service for a date range.
router.get('/daily', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 90);
  const rows = await query(`
    SELECT provider, service, date_key,
           SUM(daily_cost)::NUMERIC(12,2) AS daily_cost
    FROM cost_data
    WHERE date_key >= CURRENT_DATE - $1::INT
    GROUP BY provider, service, date_key
    ORDER BY date_key DESC, daily_cost DESC
  `, [days]);
  res.json(rows.map(r => ({ ...r, daily_cost: Number(r.daily_cost) })));
});

router.get('/by-service', async (req, res) => {
  const rows = await query(`
    SELECT provider, service,
           SUM(daily_cost) FILTER (WHERE date_key >= CURRENT_DATE - 30) AS last_30d,
           SUM(daily_cost) FILTER (WHERE date_key >= CURRENT_DATE - 7) AS last_7d
    FROM cost_data
    GROUP BY provider, service
    ORDER BY last_30d DESC NULLS LAST
  `);
  res.json(rows.map(r => ({
    ...r,
    last_30d: r.last_30d ? Number(r.last_30d) : 0,
    last_7d: r.last_7d ? Number(r.last_7d) : 0,
  })));
});

router.get('/anomalies', async (req, res) => {
  const rows = await query("SELECT * FROM cost_anomalies WHERE status='open' ORDER BY detected_at DESC LIMIT 100");
  res.json(rows.map(r => ({ ...r, detected_at: Number(r.detected_at) })));
});

router.post('/anomalies/:id/resolve', operator, async (req, res) => {
  await execute("UPDATE cost_anomalies SET status='resolved' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

router.get('/recommendations', async (req, res) => {
  const rows = await query("SELECT * FROM cost_recommendations WHERE status='open' ORDER BY estimated_monthly_savings DESC");
  res.json(rows.map(r => ({ ...r, created_at: Number(r.created_at), estimated_monthly_savings: Number(r.estimated_monthly_savings) })));
});

router.post('/recommendations/:id/dismiss', operator, async (req, res) => {
  await execute("UPDATE cost_recommendations SET status='dismissed' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

router.post('/sweep', operator, async (req, res) => {
  detectAnomalies().catch(err => console.error('Manual anomaly sweep:', err));
  generateRecommendations().catch(err => console.error('Manual rec sweep:', err));
  res.status(202).json({ ok: true });
});

export default router;
