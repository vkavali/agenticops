import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { beginDeploy, rollback as strategyRollback } from '../strategy.js';
import { rolloutPromote, rolloutAbort, rolloutGet, parseRolloutStatus } from '../argo.js';

const router = Router();
const operator = requireAuth('operator');
const ENVS = ['development', 'staging', 'production'];
const STRATEGIES = ['rolling', 'canary', 'blue-green'];

function shape(d) {
  return {
    id: d.id, service: d.service, version: d.version, commit: d.commit_hash,
    msg: d.message, by: d.deployed_by, timestamp: Number(d.deploy_timestamp),
    strategy: d.strategy || 'rolling', gateId: d.gate_id,
    environments: d.environments || {},
  };
}

router.get('/', async (req, res) => {
  const rows = await query('SELECT * FROM deployments ORDER BY deploy_timestamp DESC');
  res.json(rows.map(shape));
});

router.post('/', operator, async (req, res) => {
  const { service, version, commit, msg, by, environments, strategy } = req.body;
  const id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const strat = STRATEGIES.includes(strategy) ? strategy : 'rolling';
  await execute(
    'INSERT INTO deployments (id,service,version,commit_hash,message,deployed_by,deploy_timestamp,environments,strategy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, service, version || 'v1.0.0', commit || Math.random().toString(36).slice(2,9),
     msg || 'deploy', by || req.auth?.label || 'operator', now,
     JSON.stringify(environments || {}), strat]
  );
  const row = await queryOne('SELECT * FROM deployments WHERE id=$1', [id]);
  const dep = shape(row);
  broadcast('deployment:created', dep);
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`${dep.by} started ${strat} deploy of ${service} ${version}`, 'deploy', now]);
  res.status(201).json(dep);
});

router.post('/:id/promote/:env', operator, async (req, res) => {
  const { id, env } = req.params;
  if (!ENVS.includes(env)) return res.status(400).json({ error: 'Unknown env' });

  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });

  // Find the next env relative to current state. If env is given, promote there;
  // gating + strategy progression are handled by the engine.
  const result = await beginDeploy(dep, env, { actor: req.auth?.label });
  res.json({ ok: true, env, ...result });
});

router.post('/:id/rollback/:env', operator, async (req, res) => {
  const { id, env } = req.params;
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  await strategyRollback(dep, env, { actor: req.auth?.label });
  res.json({ ok: true });
});

// Argo Rollouts — operator-driven promote/abort (independent of gates).
async function getArgoTarget(serviceName) {
  const svc = await queryOne('SELECT deploy_target FROM services WHERE name=$1 LIMIT 1', [serviceName]);
  const k8s = svc?.deploy_target?.k8s;
  if (!k8s?.connector_id || !k8s?.argo_rollout) return null;
  return k8s;
}

router.post('/:id/argo/promote', operator, async (req, res) => {
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [req.params.id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const k8s = await getArgoTarget(dep.service);
  if (!k8s) return res.status(400).json({ error: 'Service has no Argo Rollouts target' });
  const r = await rolloutPromote(k8s.connector_id, k8s.argo_rollout, !!req.body?.full);
  res.json({ ok: r.exitCode === 0, stderr: r.exitCode === 0 ? null : r.stderr });
});

router.post('/:id/argo/abort', operator, async (req, res) => {
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [req.params.id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const k8s = await getArgoTarget(dep.service);
  if (!k8s) return res.status(400).json({ error: 'Service has no Argo Rollouts target' });
  const r = await rolloutAbort(k8s.connector_id, k8s.argo_rollout);
  res.json({ ok: r.exitCode === 0, stderr: r.exitCode === 0 ? null : r.stderr });
});

router.get('/:id/argo/status', async (req, res) => {
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [req.params.id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const k8s = await getArgoTarget(dep.service);
  if (!k8s) return res.json(null);
  const payload = await rolloutGet(k8s.connector_id, k8s.argo_rollout);
  res.json(parseRolloutStatus(payload));
});

export default router;
