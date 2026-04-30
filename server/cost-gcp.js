import { BigQuery } from '@google-cloud/bigquery';
import { query, queryOne, execute } from './db.js';
import { decrypt } from './crypto.js';

// GCP Cost adapter — BigQuery billing-export pattern.
//
// GCP recommends Detailed Usage Cost export to BigQuery for any non-trivial
// cost analysis. A `cloud_connectors` row with provider='gcp' carries a
// service-account JSON key + the export dataset + table:
//
//   credentials.enc = JSON.stringify({
//     service_account_json: { type: "service_account", project_id, ... },
//     project_id: "my-project",
//     dataset: "billing_export",
//     table: "gcp_billing_export_v1_XXXX",
//   })
//
// This is the standard schema GCP creates when you set up Cloud Billing →
// Billing Export → BigQuery → Detailed usage cost. We query it for the last
// N days, group by service.description, and upsert into cost_data.

const POLL_INTERVAL_MS = 60 * 60 * 1000;

function decryptCreds(connector) {
  const env = typeof connector.credentials === 'string'
    ? JSON.parse(connector.credentials)
    : connector.credentials;
  return env?.enc ? JSON.parse(decrypt(env.enc)) : env;
}

async function shouldPoll(connectorId) {
  const r = await queryOne(
    `SELECT MAX(captured_at) AS last FROM cost_data WHERE cloud_connector_id=$1`,
    [connectorId]
  );
  if (!r?.last) return true;
  return Date.now() - Number(r.last) > 23 * 60 * 60 * 1000;
}

export async function pollGcpConnector(connector, { lookbackDays = 14 } = {}) {
  let creds;
  try { creds = decryptCreds(connector); }
  catch (err) { return { ok: false, error: 'decrypt failed' }; }
  if (!creds?.service_account_json || !creds?.dataset || !creds?.table) {
    return { ok: false, error: 'GCP connector missing service_account_json/dataset/table' };
  }

  const client = new BigQuery({
    projectId: creds.project_id || creds.service_account_json.project_id,
    credentials: creds.service_account_json,
  });

  const sql = `
    SELECT
      DATE(usage_start_time) AS date_key,
      service.description AS service_name,
      SUM(cost) AS daily_cost,
      ANY_VALUE(currency) AS currency
    FROM \`${creds.project_id}.${creds.dataset}.${creds.table}\`
    WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookback DAY)
    GROUP BY date_key, service_name
    ORDER BY date_key DESC, daily_cost DESC
  `;

  let imported = 0;
  try {
    const [rows] = await client.query({
      query: sql,
      params: { lookback: lookbackDays },
    });
    for (const r of rows) {
      const dateKey = (r.date_key?.value || r.date_key);
      const cost = Number(r.daily_cost || 0);
      if (!Number.isFinite(cost) || cost <= 0) continue;
      await execute(
        `INSERT INTO cost_data (cloud_connector_id, provider, account, service, daily_cost, currency, captured_at, date_key)
         VALUES ($1,'gcp',$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [connector.id, creds.project_id || null, r.service_name || 'unknown',
         cost.toFixed(4), r.currency || 'USD', Date.now(), dateKey]
      );
      imported++;
    }
    return { ok: true, imported };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function pollAllGcpConnectors() {
  const connectors = await query("SELECT * FROM cloud_connectors WHERE provider='gcp' AND status='connected'");
  for (const c of connectors) {
    if (!await shouldPoll(c.id)) continue;
    try {
      const result = await pollGcpConnector(c);
      if (result.ok) {
        console.log(`✓ GCP cost poll: ${c.name} imported ${result.imported} rows`);
      } else {
        console.warn(`GCP cost poll failed for ${c.name}: ${result.error}`);
      }
    } catch (err) {
      console.error(`GCP cost poll exception for ${c.name}:`, err.message);
    }
  }
}

export function startGcpCostPoller() {
  setInterval(() => {
    pollAllGcpConnectors().catch(err => console.error('GCP cost poll tick:', err.message));
  }, POLL_INTERVAL_MS);
  pollAllGcpConnectors().catch(() => {});
  console.log('✓ GCP Billing poller started');
}
