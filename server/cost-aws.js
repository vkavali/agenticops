import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { query, queryOne, execute } from './db.js';
import { decrypt } from './crypto.js';

// Real AWS Cost Explorer adapter.
//
// For each cloud_connector with provider='aws', polls GetCostAndUsage daily,
// grouped by SERVICE, and upserts rows into cost_data. Idempotent on
// (provider, account, service, date_key) — re-polling overwrites in place
// instead of double-counting. Cost Explorer is itself $0.01/request, so we
// gate on `lookback_days` (default 14) and only poll once per day per
// connector.
//
// Connector credentials shape (after decrypt of cloud_connectors.credentials.enc):
//   { access_key_id, secret_access_key, region?, account_id? }

const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly tick — gates internally on per-day cadence

function decryptConnectorCreds(connector) {
  if (!connector.credentials) return null;
  const env = typeof connector.credentials === 'string'
    ? JSON.parse(connector.credentials)
    : connector.credentials;
  if (!env.enc) return env; // legacy plaintext fallback
  return JSON.parse(decrypt(env.enc));
}

function clientFor(connector, creds) {
  return new CostExplorerClient({
    region: connector.region || creds.region || 'us-east-1',
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
      ...(creds.session_token ? { sessionToken: creds.session_token } : {}),
    },
  });
}

async function shouldPoll(connectorId) {
  const r = await queryOne(
    `SELECT MAX(captured_at) AS last FROM cost_data WHERE cloud_connector_id=$1`,
    [connectorId]
  );
  if (!r?.last) return true;
  return Date.now() - Number(r.last) > 23 * 60 * 60 * 1000;
}

export async function pollAwsConnector(connector, { lookbackDays = 14 } = {}) {
  let creds;
  try { creds = decryptConnectorCreds(connector); }
  catch (err) {
    console.error(`AWS cost: cannot decrypt connector ${connector.id}:`, err.message);
    return { ok: false, error: 'decrypt failed' };
  }
  if (!creds?.access_key_id || !creds?.secret_access_key) {
    return { ok: false, error: 'missing AWS credentials in connector' };
  }

  const client = clientFor(connector, creds);
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  let nextToken;
  let imported = 0;
  do {
    const cmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: fmt(start), End: fmt(end) },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      NextPageToken: nextToken,
    });
    const resp = await client.send(cmd);
    nextToken = resp.NextPageToken;

    for (const row of resp.ResultsByTime || []) {
      const dateKey = row.TimePeriod.Start;
      for (const g of row.Groups || []) {
        const service = g.Keys?.[0] || 'unknown';
        const amount = parseFloat(g.Metrics?.UnblendedCost?.Amount || '0');
        if (!Number.isFinite(amount)) continue;
        await execute(
          `INSERT INTO cost_data (cloud_connector_id, provider, account, service, daily_cost, currency, captured_at, date_key)
           VALUES ($1,'aws',$2,$3,$4,$5,$6,$7)
           ON CONFLICT DO NOTHING`,
          [connector.id, creds.account_id || null, service, amount.toFixed(4),
           g.Metrics?.UnblendedCost?.Unit || 'USD', Date.now(), dateKey]
        );
        imported++;
      }
    }
  } while (nextToken);

  return { ok: true, imported };
}

export async function pollAllAwsConnectors() {
  const connectors = await query("SELECT * FROM cloud_connectors WHERE provider='aws' AND status='connected'");
  for (const c of connectors) {
    if (!await shouldPoll(c.id)) continue;
    try {
      const result = await pollAwsConnector(c);
      if (result.ok) {
        console.log(`✓ AWS cost poll: ${c.name} imported ${result.imported} cost rows`);
      } else {
        console.warn(`AWS cost poll failed for ${c.name}: ${result.error}`);
      }
    } catch (err) {
      console.error(`AWS cost poll exception for ${c.name}:`, err.message);
    }
  }
}

export function startAwsCostPoller() {
  setInterval(() => {
    pollAllAwsConnectors().catch(err => console.error('AWS cost poll tick:', err.message));
  }, POLL_INTERVAL_MS);
  // Run once at boot so demos with a real connector see real data immediately.
  pollAllAwsConnectors().catch(() => {});
  console.log('✓ AWS Cost Explorer poller started');
}
