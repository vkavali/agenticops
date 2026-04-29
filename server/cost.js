import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';

// Cost Management.
//
// `cost_data` is the per-day fact table (one row per provider/account/service/
// resource/day). In production you'd populate it from AWS Cost Explorer / GCP
// Billing / Azure Cost Management — for now we provide a seedSyntheticCosts()
// helper for demos and an anomaly detector that compares yesterday's spend
// per service to a 14-day baseline.

const ANOMALY_TICK_MS = 60 * 60 * 1000; // hourly
const ANOMALY_DELTA_PCT = 25; // alert when daily cost exceeds baseline by this much

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

// Detect cost anomalies — for each (provider, service) pair, compare the most
// recent day's spend to the trailing 14-day mean. Anomalies ≥ ANOMALY_DELTA_PCT
// over baseline open a row in cost_anomalies (deduped on the same day).
export async function detectAnomalies() {
  const rows = await query(`
    WITH recent AS (
      SELECT provider, service,
             SUM(daily_cost) FILTER (WHERE date_key = (CURRENT_DATE - INTERVAL '1 day')) AS yesterday_cost,
             AVG(daily_cost) FILTER (WHERE date_key BETWEEN (CURRENT_DATE - INTERVAL '15 days')
                                                       AND  (CURRENT_DATE - INTERVAL '2 days')) AS baseline_cost
      FROM cost_data
      WHERE date_key >= (CURRENT_DATE - INTERVAL '15 days')
      GROUP BY provider, service
    )
    SELECT * FROM recent WHERE yesterday_cost IS NOT NULL AND baseline_cost > 0
  `);

  for (const r of rows) {
    const yesterday = Number(r.yesterday_cost);
    const baseline = Number(r.baseline_cost);
    const deltaPct = ((yesterday - baseline) / baseline) * 100;
    if (deltaPct < ANOMALY_DELTA_PCT) continue;

    const existing = await queryOne(
      `SELECT id FROM cost_anomalies
       WHERE provider=$1 AND service=$2 AND status='open'
         AND detected_at >= $3`,
      [r.provider, r.service, Date.now() - 24 * 60 * 60 * 1000]
    );
    if (existing) continue;

    const id = `cost-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    await execute(
      `INSERT INTO cost_anomalies (id, provider, service, observed_cost, baseline_cost, delta_pct, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, r.provider, r.service, yesterday.toFixed(2), baseline.toFixed(2), deltaPct.toFixed(2), Date.now()]
    );
    broadcast('cost:anomaly', {
      id, provider: r.provider, service: r.service,
      observed_cost: yesterday, baseline_cost: baseline, delta_pct: deltaPct,
    });
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Cost anomaly: ${r.service} on ${r.provider} up ${deltaPct.toFixed(0)}% (\$${yesterday.toFixed(2)} vs \$${baseline.toFixed(2)} baseline)`, 'cost', Date.now()]);
  }
}

// Idle-resource recommendation — for now, surface any service whose CPU has
// averaged < 5% for the last 24h as a downsizing candidate. Real CCM would
// poll cloud-provider utilization metrics; we use the existing services table
// as a stand-in.
export async function generateRecommendations() {
  const services = await query("SELECT id, name, cpu, memory FROM services WHERE cpu < 5");
  for (const s of services) {
    const id = `rec-idle-${s.id}`;
    await execute(
      `INSERT INTO cost_recommendations (id, kind, resource, estimated_monthly_savings, rationale, created_at)
       VALUES ($1,'rightsize',$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET created_at=$5, status='open'`,
      [id, s.name, 50, `${s.name} is averaging ${s.cpu}% CPU — consider downsizing.`, Date.now()]
    ).catch(() => {});
  }
}

// Demo helper: seed 14 days of synthetic cost data so the anomaly detector has
// something to work with. In production this is replaced by a real connector.
export async function seedSyntheticCosts() {
  const existing = await queryOne('SELECT COUNT(*) AS n FROM cost_data');
  if (Number(existing.n) > 0) return;

  const services = ['ec2', 'rds', 's3', 'lambda', 'cloudfront'];
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  for (let d = 14; d >= 0; d--) {
    const ts = now - d * day;
    for (const svc of services) {
      const base = { ec2: 120, rds: 80, s3: 30, lambda: 45, cloudfront: 25 }[svc];
      // Inject a spike on yesterday for `lambda` so the anomaly detector has a hit.
      const spike = (d === 1 && svc === 'lambda') ? 1.6 : 1;
      const cost = (base * spike * (0.9 + Math.random() * 0.2)).toFixed(2);
      await execute(
        `INSERT INTO cost_data (provider, account, service, daily_cost, captured_at, date_key)
         VALUES ('aws','demo-account',$1,$2,$3,$4)`,
        [svc, cost, ts, dayKey(ts)]
      );
    }
  }
  console.log('✓ Seeded 14 days of synthetic cost data');
}

export function startCostSweep() {
  setInterval(() => {
    detectAnomalies().catch(err => console.error('Cost anomaly tick:', err.message));
    generateRecommendations().catch(err => console.error('Cost recs tick:', err.message));
  }, ANOMALY_TICK_MS);
  console.log('✓ Cost anomaly sweep started');
}
