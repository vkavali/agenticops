import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';

// External integrations: Slack (outbound) + PagerDuty (bidirectional).
//
// Each `integrations` row carries a `kind` + a `config` JSONB. Config shapes:
//   slack:      { webhook_url, channel?, mention?: '@channel' }
//   pagerduty:  { routing_key, api_key?, severity_map?: {critical, warning, info} }
//   datadog:    { api_key, app_key?, site? }   (used by metrics ingest, not here)
//   webhook:    { url, headers?, secret? }     (generic outbound)
//
// We dispatch on AgenticOps events: incident:created, deployment:failed,
// gate:created, slo:burning, etc.

const PD_EVENTS_API = 'https://events.pagerduty.com/v2/enqueue';

async function getActive(orgId, kind) {
  return query(
    "SELECT * FROM integrations WHERE org_id=$1 AND kind=$2 AND enabled=true",
    [orgId || 'org-default', kind]
  );
}

// ── Slack ──
export async function postSlack(orgId, { text, attachments }) {
  const integrations = await getActive(orgId, 'slack');
  for (const i of integrations) {
    const cfg = i.config || {};
    if (!cfg.webhook_url) continue;
    try {
      await fetch(cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cfg.mention ? `${cfg.mention} ${text}` : text,
          channel: cfg.channel,
          attachments: attachments || undefined,
        }),
      });
    } catch (err) {
      console.error('Slack post failed:', err.message);
    }
  }
}

// ── PagerDuty ──
const PD_DEFAULT_SEVERITY = { critical: 'critical', warning: 'warning', info: 'info' };

export async function pagePagerDuty(orgId, incident) {
  const integrations = await getActive(orgId, 'pagerduty');
  for (const i of integrations) {
    const cfg = i.config || {};
    if (!cfg.routing_key) continue;
    const sevMap = { ...PD_DEFAULT_SEVERITY, ...(cfg.severity_map || {}) };
    const severity = sevMap[incident.severity] || 'warning';
    try {
      const res = await fetch(PD_EVENTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: cfg.routing_key,
          event_action: 'trigger',
          dedup_key: incident.id, // ensures PD dedupes if we re-trigger
          payload: {
            summary: incident.title || `Incident ${incident.id}`,
            severity,
            source: incident.service || 'agenticops',
            timestamp: new Date(incident.timestamp || Date.now()).toISOString(),
            custom_details: {
              incident_id: incident.id,
              description: incident.description,
            },
          },
        }),
      });
      if (!res.ok) {
        console.error('PagerDuty trigger failed:', res.status, await res.text());
      }
    } catch (err) {
      console.error('PagerDuty trigger error:', err.message);
    }
  }
}

export async function resolvePagerDuty(orgId, incident) {
  const integrations = await getActive(orgId, 'pagerduty');
  for (const i of integrations) {
    const cfg = i.config || {};
    if (!cfg.routing_key) continue;
    try {
      await fetch(PD_EVENTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: cfg.routing_key,
          event_action: 'resolve',
          dedup_key: incident.id,
        }),
      });
    } catch (err) {
      console.error('PagerDuty resolve error:', err.message);
    }
  }
}

// ── Generic webhook ──
export async function postWebhook(orgId, eventType, data) {
  const integrations = await getActive(orgId, 'webhook');
  for (const i of integrations) {
    const cfg = i.config || {};
    if (!cfg.url) continue;
    const body = JSON.stringify({ event: eventType, data, timestamp: Date.now() });
    const headers = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
    if (cfg.secret) {
      // HMAC-SHA256 the body so receivers can verify authenticity.
      headers['X-AgenticOps-Signature'] = 'sha256=' +
        crypto.createHmac('sha256', cfg.secret).update(body).digest('hex');
    }
    try { await fetch(cfg.url, { method: 'POST', headers, body }); }
    catch (err) { console.error(`Webhook ${cfg.url} failed:`, err.message); }
  }
}

// ── CRUD ──
export async function listIntegrations(orgId) {
  // Don't return secrets in the wire payload; UIs only need the kind +
  // config shape minus credentials.
  const rows = await query(
    'SELECT id, org_id, kind, config, enabled, created_at FROM integrations WHERE org_id=$1 ORDER BY created_at DESC',
    [orgId || 'org-default']
  );
  return rows.map(r => ({ ...r, config: redactConfig(r.kind, r.config) }));
}

function redactConfig(kind, config) {
  const c = { ...(config || {}) };
  for (const key of ['webhook_url', 'routing_key', 'api_key', 'app_key', 'secret']) {
    if (c[key]) c[key] = `••••${String(c[key]).slice(-4)}`;
  }
  return c;
}

export async function createIntegration({ org_id, kind, config }) {
  const id = `int-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await execute(
    `INSERT INTO integrations (id, org_id, kind, config, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, org_id || 'org-default', kind, JSON.stringify(config || {}), Date.now()]
  );
  return id;
}

export async function deleteIntegration(id, orgId) {
  await execute('DELETE FROM integrations WHERE id=$1 AND org_id=$2', [id, orgId || 'org-default']);
}
