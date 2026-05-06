import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import * as notify from '../notify.js';

const router = Router();
const operator = requireAuth('operator');

function getNow() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function getNextIncidentId() {
  const row = await queryOne("SELECT id FROM incidents ORDER BY incident_timestamp DESC LIMIT 1");
  if (!row) return 'INC-2848';
  const num = parseInt(row.id.replace('INC-', ''), 10);
  return `INC-${num + 1}`;
}

router.get('/', async (req, res) => {
  const rows = await query('SELECT * FROM incidents ORDER BY incident_timestamp DESC');
  res.json(rows.map(i => ({
    id: i.id, title: i.title, service: i.service, severity: i.severity,
    status: i.status, opened: i.opened, timestamp: Number(i.incident_timestamp),
    resolved: i.resolved, assignee: i.assignee, description: i.description,
    timeline: i.timeline || [],
  })));
});

router.post('/', operator, async (req, res) => {
  const { title, service, severity, assignee, description } = req.body;
  const id = await getNextIncidentId();
  const now = Date.now();
  const timeline = [{ time: getNow(), event: 'Incident created', type: 'alert' }];
  await execute(
    'INSERT INTO incidents (id,title,service,severity,status,opened,incident_timestamp,assignee,description,timeline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, title, service, severity || 'warning', 'active', 'Just now', now, assignee || 'ops-team', description || '', JSON.stringify(timeline)]
  );
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`${id} opened: ${title}`, 'incident', now]);
  const inc = { id, title, service, severity: severity || 'warning', status: 'active', opened: 'Just now', timestamp: now, assignee: assignee || 'ops-team', description: description || '', timeline };
  broadcast('incident:created', inc);
  broadcast('activity:new', { event: `${id} opened: ${title}`, type: 'incident', timestamp: now });
  notify.incidentOpened(req.auth?.orgId, inc).catch(err => console.error('notify.incidentOpened:', err.message));
  res.status(201).json(inc);
});

router.post('/:id/ack', operator, async (req, res) => {
  const { id } = req.params;
  const inc = await queryOne('SELECT * FROM incidents WHERE id=$1', [id]);
  if (!inc) return res.status(404).json({ error: 'Not found' });
  const timeline = [...(inc.timeline || []), { time: getNow(), event: 'Incident acknowledged by operator', type: 'system' }];
  await execute('UPDATE incidents SET status=$1, timeline=$2 WHERE id=$3', ['acknowledged', JSON.stringify(timeline), id]);
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)', [`${id} acknowledged`, 'incident', Date.now()]);
  broadcast('incident:updated', { id, status: 'acknowledged', timeline });
  res.json({ ok: true });
});

router.post('/:id/resolve', operator, async (req, res) => {
  const { id } = req.params;
  const inc = await queryOne('SELECT * FROM incidents WHERE id=$1', [id]);
  if (!inc) return res.status(404).json({ error: 'Not found' });
  const timeline = [...(inc.timeline || []), { time: getNow(), event: 'Incident resolved by operator', type: 'resolved' }];
  await execute('UPDATE incidents SET status=$1, resolved=$2, timeline=$3 WHERE id=$4', ['resolved', 'Just now', JSON.stringify(timeline), id]);
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)', [`${id} resolved`, 'incident', Date.now()]);
  broadcast('incident:updated', { id, status: 'resolved', timeline });
  notify.incidentResolved(req.auth?.orgId, inc).catch(err => console.error('notify.incidentResolved:', err.message));
  res.json({ ok: true });
});

router.post('/:id/comment', operator, async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;
  const inc = await queryOne('SELECT * FROM incidents WHERE id=$1', [id]);
  if (!inc) return res.status(404).json({ error: 'Not found' });
  const timeline = [...(inc.timeline || []), { time: getNow(), event: comment, type: 'comment' }];
  await execute('UPDATE incidents SET timeline=$1 WHERE id=$2', [JSON.stringify(timeline), id]);
  broadcast('incident:updated', { id, timeline });
  res.json({ ok: true });
});

router.patch('/:id', operator, async (req, res) => {
  const { id } = req.params;
  const { severity, assignee, title, description } = req.body;
  const sets = []; const vals = []; let i = 1;
  if (severity) { sets.push(`severity=$${i++}`); vals.push(severity); }
  if (assignee) { sets.push(`assignee=$${i++}`); vals.push(assignee); }
  if (title) { sets.push(`title=$${i++}`); vals.push(title); }
  if (description) { sets.push(`description=$${i++}`); vals.push(description); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(id);
  await execute(`UPDATE incidents SET ${sets.join(',')} WHERE id=$${i}`, vals);
  broadcast('incident:updated', { id, ...req.body });
  res.json({ ok: true });
});

export default router;
