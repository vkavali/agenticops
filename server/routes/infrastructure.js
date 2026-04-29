import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';

const router = Router();
const operator = requireAuth('operator');

router.get('/nodes', async (req, res) => {
  const rows = await query('SELECT * FROM nodes');
  res.json(rows);
});

router.get('/links', async (req, res) => {
  const rows = await query('SELECT * FROM links');
  res.json(rows.map(l => ({
    source: l.source, target: l.target, speed: l.speed,
    dashed: l.dashed, isError: l.is_error, isBroken: l.is_broken,
  })));
});

router.patch('/nodes/:id', operator, async (req, res) => {
  const { id } = req.params;
  const { x, y, status } = req.body;
  const sets = []; const vals = []; let i = 1;
  if (x !== undefined) { sets.push(`x=$${i++}`); vals.push(x); }
  if (y !== undefined) { sets.push(`y=$${i++}`); vals.push(y); }
  if (status !== undefined) { sets.push(`status=$${i++}`); vals.push(status); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(id);
  await execute(`UPDATE nodes SET ${sets.join(',')} WHERE id=$${i}`, vals);
  const row = await queryOne('SELECT * FROM nodes WHERE id=$1', [id]);
  broadcast('node:updated', row);
  res.json(row);
});

router.post('/remediate', operator, async (req, res) => {
  // Fix lambda-post node
  await execute("UPDATE nodes SET status='healthy' WHERE id='lambda-post'");
  // Fix api-service
  await execute("UPDATE services SET status='healthy' WHERE name='api-service'");
  // Set remediated state
  await execute("INSERT INTO app_state (key, value) VALUES ('remediated', 'true') ON CONFLICT (key) DO UPDATE SET value='true'");
  // Resolve INC-2847
  const inc = await queryOne("SELECT * FROM incidents WHERE id='INC-2847'");
  if (inc && inc.status !== 'resolved') {
    const timeline = [...(inc.timeline || []), { time: new Date().toLocaleTimeString('en-US', { hour12: false }), event: 'Incident resolved via remediation', type: 'resolved' }];
    await execute("UPDATE incidents SET status='resolved', resolved='Just now', timeline=$1 WHERE id='INC-2847'", [JSON.stringify(timeline)]);
  }
  // Create remediation deployment
  const depId = `d-${Date.now()}`;
  const now = Date.now();
  const envs = { development: { status: 'passed', time: 'Just now', timestamp: now }, staging: { status: 'passed', time: 'Just now', timestamp: now }, production: { status: 'running', time: 'Just now', timestamp: now } };
  await execute(
    'INSERT INTO deployments (id,service,version,commit_hash,message,deployed_by,deploy_timestamp,environments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [depId, 'api-service', 'v2.3.2', Math.random().toString(36).slice(2,9), 'fix: memory_size 128→256MB (auto-remediation)', 'ARC-R Engine', now, JSON.stringify(envs)]
  );
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    ['ARC-R applied IaC patch: memory_size 128→256MB on lambda-post', 'deploy', now]);

  broadcast('remediation:complete', { nodeId: 'lambda-post' });
  broadcast('activity:new', { event: 'ARC-R applied IaC patch', type: 'deploy', timestamp: now });
  res.json({ ok: true });
});

router.get('/state', async (req, res) => {
  const row = await queryOne("SELECT value FROM app_state WHERE key='remediated'");
  res.json({ remediated: row ? JSON.parse(row.value) : false });
});

export default router;
