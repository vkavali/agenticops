import { Router } from 'express';
import { query, queryOne, execute } from '../db.js';
import { requireAuth } from '../auth.js';
import { computeScorecards, latestScorecards } from '../idp.js';
import { importAll, importOneRepo } from '../catalog-import.js';

const router = Router();
const operator = requireAuth('operator');

// Service catalog with computed scorecards.
router.get('/services', async (req, res) => {
  const services = await query('SELECT * FROM services ORDER BY name');
  const cards = await latestScorecards();
  res.json(services.map(s => ({ ...s, scorecards: cards.get(s.id) || [] })));
});

router.get('/services/:id', async (req, res) => {
  const svc = await queryOne('SELECT * FROM services WHERE id=$1', [req.params.id]);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  const cards = await query(
    `SELECT metric, value, grade, detail, computed_at FROM scorecards
     WHERE service_id=$1 ORDER BY computed_at DESC LIMIT 50`,
    [svc.id]
  );
  res.json({
    ...svc,
    scorecards: cards.map(c => ({ ...c, value: Number(c.value), computed_at: Number(c.computed_at) })),
  });
});

router.patch('/services/:id', operator, async (req, res) => {
  const { owner, tier, repo_full_name, metadata } = req.body;
  await execute(
    `UPDATE services SET
       owner=COALESCE($1,owner),
       tier=COALESCE($2,tier),
       repo_full_name=COALESCE($3,repo_full_name),
       metadata=COALESCE($4,metadata)
     WHERE id=$5`,
    [owner, tier, repo_full_name, metadata ? JSON.stringify(metadata) : null, req.params.id]
  );
  const row = await queryOne('SELECT * FROM services WHERE id=$1', [req.params.id]);
  res.json(row);
});

router.post('/recompute', operator, async (req, res) => {
  computeScorecards().catch(err => console.error('Manual scorecard recompute:', err));
  res.status(202).json({ ok: true });
});

// Import catalog-info.yaml from connected repos. Backstage-style spec.
router.post('/catalog/import', operator, async (req, res) => {
  try {
    const results = await importAll();
    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/catalog/import/:owner/:repo', operator, async (req, res) => {
  try {
    const result = await importOneRepo(`${req.params.owner}/${req.params.repo}`);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
