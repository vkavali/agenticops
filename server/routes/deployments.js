import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';

const router = Router();
const operator = requireAuth('operator');
const ENVS = ['development', 'staging', 'production'];

router.get('/', async (req, res) => {
  const rows = await query('SELECT * FROM deployments ORDER BY deploy_timestamp DESC');
  res.json(rows.map(d => ({
    id: d.id, service: d.service, version: d.version, commit: d.commit_hash,
    msg: d.message, by: d.deployed_by, timestamp: Number(d.deploy_timestamp),
    environments: d.environments || {},
  })));
});

router.post('/', operator, async (req, res) => {
  const { service, version, commit, msg, by, environments } = req.body;
  const id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  await execute(
    'INSERT INTO deployments (id,service,version,commit_hash,message,deployed_by,deploy_timestamp,environments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, service, version || 'v1.0.0', commit || Math.random().toString(36).slice(2,9), msg || 'deploy', by || 'operator', now, JSON.stringify(environments || {})]
  );
  const row = await queryOne('SELECT * FROM deployments WHERE id=$1', [id]);
  const dep = { id: row.id, service: row.service, version: row.version, commit: row.commit_hash, msg: row.message, by: row.deployed_by, timestamp: Number(row.deploy_timestamp), environments: row.environments };
  broadcast('deployment:created', dep);
  // Activity
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`${by || 'operator'} started deploy of ${service} ${version} to ${Object.keys(environments || {}).pop() || 'development'}`, 'deploy', now]);
  res.status(201).json(dep);
});

router.post('/:id/promote/:env', operator, async (req, res) => {
  const { id, env } = req.params;
  const envIndex = ENVS.indexOf(env);
  if (envIndex >= ENVS.length - 1) return res.status(400).json({ error: 'Already at highest environment' });
  const toEnv = ENVS[envIndex + 1];
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });

  const envs = dep.environments || {};
  envs[toEnv] = { status: 'running', time: 'Just now', timestamp: Date.now() };
  await execute('UPDATE deployments SET environments=$1 WHERE id=$2', [JSON.stringify(envs), id]);

  broadcast('deployment:updated', { id, environments: envs });

  // Simulate completion after 2.5s
  setTimeout(async () => {
    envs[toEnv] = { status: 'passed', time: 'Just now', timestamp: Date.now() };
    await execute('UPDATE deployments SET environments=$1 WHERE id=$2', [JSON.stringify(envs), id]);
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`${dep.service} ${dep.version} deployed to ${toEnv} successfully`, 'deploy', Date.now()]);
    broadcast('deployment:updated', { id, environments: envs });
    broadcast('activity:new', { event: `${dep.service} ${dep.version} deployed to ${toEnv}`, type: 'deploy', timestamp: Date.now() });
  }, 2500);

  res.json({ ok: true, promoting: toEnv });
});

router.post('/:id/rollback/:env', operator, async (req, res) => {
  const { id, env } = req.params;
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [id]);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const envs = dep.environments || {};
  envs[env] = { status: 'rolledback', time: 'Just now', timestamp: Date.now() };
  await execute('UPDATE deployments SET environments=$1 WHERE id=$2', [JSON.stringify(envs), id]);
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Rolled back ${dep.service} in ${env}`, 'deploy', Date.now()]);
  broadcast('deployment:updated', { id, environments: envs });
  res.json({ ok: true });
});

export default router;
