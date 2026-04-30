import { query, queryOne, execute } from './db.js';
import { decrypt } from './crypto.js';

// Azure Cost adapter — Cost Management REST API.
//
// Connector credentials shape:
//   credentials.enc = JSON.stringify({
//     tenant_id, client_id, client_secret,
//     subscription_id,
//     scope: "subscriptions/<id>",         // or management groups, etc.
//   })
//
// We OAuth2 client-credentials → Cost Management /query endpoint. No SDK
// dependency — plain fetch, since the request shape is small and the SDK
// would dwarf the rest of this file.
//
// Reference: https://learn.microsoft.com/rest/api/cost-management/query/usage

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const AZURE_LOGIN = 'https://login.microsoftonline.com';
const AZURE_MGMT = 'https://management.azure.com';

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

async function fetchAccessToken(creds) {
  const url = `${AZURE_LOGIN}/${creds.tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    scope: 'https://management.azure.com/.default',
  });
  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`Azure token fetch ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

export async function pollAzureConnector(connector, { lookbackDays = 14 } = {}) {
  let creds;
  try { creds = decryptCreds(connector); }
  catch { return { ok: false, error: 'decrypt failed' }; }
  if (!creds?.tenant_id || !creds?.client_id || !creds?.client_secret || !(creds?.subscription_id || creds?.scope)) {
    return { ok: false, error: 'Azure connector missing required fields' };
  }

  let token;
  try { token = await fetchAccessToken(creds); }
  catch (err) { return { ok: false, error: err.message }; }

  const scope = creds.scope || `subscriptions/${creds.subscription_id}`;
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const isoDay = (d) => d.toISOString().slice(0, 10);

  const url = `${AZURE_MGMT}/${scope}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const body = {
    type: 'Usage',
    timeframe: 'Custom',
    timePeriod: { from: isoDay(start), to: isoDay(end) },
    dataset: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping: [{ type: 'Dimension', name: 'ServiceName' }],
    },
  };

  let imported = 0;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Azure query ${res.status}: ${await res.text()}` };
    const data = await res.json();

    // Response shape: properties.columns + properties.rows; we discover column
    // indexes from the column names since they can vary by API version.
    const cols = (data.properties?.columns || []).map(c => c.name);
    const idxCost = cols.indexOf('Cost') !== -1 ? cols.indexOf('Cost') : cols.indexOf('PreTaxCost');
    const idxDate = cols.indexOf('UsageDate');
    const idxService = cols.indexOf('ServiceName');
    const idxCurrency = cols.indexOf('Currency');
    if (idxCost < 0 || idxDate < 0 || idxService < 0) {
      return { ok: false, error: `unexpected Azure response columns: ${cols.join(',')}` };
    }
    for (const row of (data.properties?.rows || [])) {
      const cost = Number(row[idxCost] || 0);
      if (!Number.isFinite(cost) || cost <= 0) continue;
      // UsageDate format is YYYYMMDD as integer
      const raw = String(row[idxDate]);
      const dateKey = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      await execute(
        `INSERT INTO cost_data (cloud_connector_id, provider, account, service, daily_cost, currency, captured_at, date_key)
         VALUES ($1,'azure',$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [connector.id, creds.subscription_id || null, row[idxService] || 'unknown',
         cost.toFixed(4), idxCurrency >= 0 ? row[idxCurrency] : 'USD', Date.now(), dateKey]
      );
      imported++;
    }
    return { ok: true, imported };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function pollAllAzureConnectors() {
  const connectors = await query("SELECT * FROM cloud_connectors WHERE provider='azure' AND status='connected'");
  for (const c of connectors) {
    if (!await shouldPoll(c.id)) continue;
    try {
      const result = await pollAzureConnector(c);
      if (result.ok) console.log(`✓ Azure cost poll: ${c.name} imported ${result.imported} rows`);
      else console.warn(`Azure cost poll failed for ${c.name}: ${result.error}`);
    } catch (err) { console.error(`Azure cost poll exception for ${c.name}:`, err.message); }
  }
}

export function startAzureCostPoller() {
  setInterval(() => {
    pollAllAzureConnectors().catch(err => console.error('Azure cost poll tick:', err.message));
  }, POLL_INTERVAL_MS);
  pollAllAzureConnectors().catch(() => {});
  console.log('✓ Azure Cost Management poller started');
}
