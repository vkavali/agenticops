import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { analyzeCanary, listAnalyses } from '../canary.js';

const router = Router();

router.get('/', requireAuth('viewer'), async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const deploymentId = req.query.deployment_id || null;
  res.json(await listAnalyses({ deploymentId, limit }));
});

router.post('/analyze', requireAuth('operator'), async (req, res) => {
  const {
    service, metric,
    baseline_from_ms, baseline_until_ms,
    canary_from_ms, canary_until_ms,
    deployment_id,
  } = req.body || {};
  if (!service || !baseline_from_ms || !canary_from_ms) {
    return res.status(400).json({ error: 'service, baseline_from_ms, canary_from_ms required' });
  }
  try {
    const result = await analyzeCanary({
      service, metric,
      baselineFromMs: baseline_from_ms,
      baselineUntilMs: baseline_until_ms || baseline_from_ms + 60 * 60 * 1000,
      canaryFromMs: canary_from_ms,
      canaryUntilMs: canary_until_ms || Date.now(),
      deploymentId: deployment_id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
