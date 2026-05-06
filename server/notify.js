import { postSlack, pagePagerDuty, resolvePagerDuty, postWebhook } from './integrations.js';

// Single fan-out point for AgenticOps events → external integrations.
// Callers fire `notify.X(...)` after persisting state; failures here never
// rollback the underlying action.

function fmtIncident(inc) {
  const sev = inc.severity?.toUpperCase() || 'WARNING';
  return `🚨 *[${sev}] ${inc.id}* ${inc.title} on \`${inc.service}\``;
}

export async function incidentOpened(orgId, incident) {
  const text = fmtIncident(incident);
  const description = incident.description ? `\n${incident.description}` : '';
  await Promise.all([
    postSlack(orgId, { text: `${text}${description}` }),
    pagePagerDuty(orgId, incident),
    postWebhook(orgId, 'incident.opened', incident),
  ]);
}

export async function incidentResolved(orgId, incident) {
  await Promise.all([
    postSlack(orgId, { text: `✅ Resolved *${incident.id}* — ${incident.title}` }),
    resolvePagerDuty(orgId, incident),
    postWebhook(orgId, 'incident.resolved', incident),
  ]);
}

export async function deploymentFailed(orgId, deployment, env) {
  const text = `❌ *Deploy failed* — ${deployment.service} ${deployment.version} → ${env}`;
  await Promise.all([
    postSlack(orgId, { text }),
    postWebhook(orgId, 'deployment.failed', { ...deployment, env }),
  ]);
}

export async function gateOpened(orgId, gate) {
  const text = `⏳ Approval needed: ${gate.description || `${gate.subject_type}/${gate.subject_id}`}`;
  await Promise.all([
    postSlack(orgId, { text }),
    postWebhook(orgId, 'gate.opened', gate),
  ]);
}

export async function sloBurning(orgId, slo, burnRate) {
  const text = `🔥 SLO *${slo.name}* burning at ${burnRate.toFixed(2)}× on \`${slo.service}\``;
  await Promise.all([
    postSlack(orgId, { text }),
    postWebhook(orgId, 'slo.burning', { slo, burn_rate: burnRate }),
  ]);
}
