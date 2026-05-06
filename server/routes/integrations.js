import { Router } from 'express';
import crypto from 'crypto';
import { queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { listIntegrations, createIntegration, deleteIntegration } from '../integrations.js';
import { record } from '../audit.js';

const router = Router();
const operator = requireAuth('operator');
const admin = requireAuth('admin');

const KINDS = new Set(['slack', 'pagerduty', 'datadog', 'webhook']);

router.get('/', requireAuth('viewer'), async (req, res) => {
  res.json(await listIntegrations(req.auth.orgId));
});

router.post('/', admin, async (req, res) => {
  const { kind, config } = req.body || {};
  if (!KINDS.has(kind)) return res.status(400).json({ error: `kind must be one of ${[...KINDS].join('|')}` });
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'config required' });
  const id = await createIntegration({ org_id: req.auth.orgId, kind, config });
  await record({ actor: req.auth.label, action: 'integration:create', target: id, detail: { kind } });
  res.status(201).json({ id });
});

router.delete('/:id', admin, async (req, res) => {
  await deleteIntegration(req.params.id, req.auth.orgId);
  await record({ actor: req.auth.label, action: 'integration:delete', target: req.params.id });
  res.json({ ok: true });
});

// ── PagerDuty inbound webhook ──
// PagerDuty Webhooks v3 POSTs JSON when an incident is acknowledged or
// resolved on their side. We mirror the state into our incidents row.
// Configure a Webhook in PagerDuty pointing at:
//   https://<your-host>/api/integrations/pagerduty/webhook
router.post('/pagerduty/webhook', async (req, res) => {
  const events = req.body?.event ? [req.body.event] : (req.body?.events || []);
  const now = Date.now();
  for (const ev of events) {
    const dedupKey = ev?.data?.dedup_key || ev?.data?.incident?.dedup_key;
    if (!dedupKey || !dedupKey.startsWith('INC-')) continue;
    const incident = await queryOne('SELECT * FROM incidents WHERE id=$1', [dedupKey]);
    if (!incident) continue;

    if (ev.event_type === 'incident.acknowledged') {
      const timeline = [...(incident.timeline || []), { time: new Date().toISOString(), event: 'Acknowledged in PagerDuty', type: 'system' }];
      await execute("UPDATE incidents SET status='acknowledged', timeline=$1 WHERE id=$2",
        [JSON.stringify(timeline), incident.id]);
      broadcast('incident:updated', { id: incident.id, status: 'acknowledged', timeline });
    } else if (ev.event_type === 'incident.resolved') {
      const timeline = [...(incident.timeline || []), { time: new Date().toISOString(), event: 'Resolved in PagerDuty', type: 'resolved' }];
      await execute("UPDATE incidents SET status='resolved', resolved='Just now', timeline=$1 WHERE id=$2",
        [JSON.stringify(timeline), incident.id]);
      broadcast('incident:updated', { id: incident.id, status: 'resolved', timeline });
      await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
        [`${incident.id} resolved via PagerDuty`, 'incident', now]);
    }
  }
  res.json({ ok: true });
});

export default router;
