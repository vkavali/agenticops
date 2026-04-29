import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';

// Internal Developer Portal — service scorecards.
//
// Computes four metrics per service from data already in the system:
//   - slo_compliance: % of the service's SLOs whose latest eval has burn < 1.0
//   - incident_health:  100 - weighted incident count over last 7 days
//   - deploy_freshness: days since last successful deployment (lower is better)
//   - security_posture: 100 - weighted open security findings (high=10, crit=25)
//
// Each metric maps to a letter grade A-F. Scorecards land in `scorecards` and
// the latest set per service is exposed via /api/idp/services.

const RECOMPUTE_INTERVAL = 30 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function gradeFromValue(value, thresholds = [90, 80, 70, 60]) {
  if (value >= thresholds[0]) return 'A';
  if (value >= thresholds[1]) return 'B';
  if (value >= thresholds[2]) return 'C';
  if (value >= thresholds[3]) return 'D';
  return 'F';
}

async function sloCompliance(serviceName) {
  const slos = await query('SELECT id FROM slos WHERE service=$1 AND enabled=true', [serviceName]);
  if (slos.length === 0) return { value: 100, detail: { reason: 'no SLOs configured' } };
  let healthy = 0;
  for (const s of slos) {
    const ev = await queryOne('SELECT burn_rate FROM slo_evals WHERE slo_id=$1 ORDER BY evaluated_at DESC LIMIT 1', [s.id]);
    if (!ev || Number(ev.burn_rate) < 1.0) healthy++;
  }
  const value = (healthy / slos.length) * 100;
  return { value, detail: { healthy, total: slos.length } };
}

async function incidentHealth(serviceName) {
  const since = Date.now() - SEVEN_DAYS;
  const rows = await query(
    'SELECT severity FROM incidents WHERE service=$1 AND incident_timestamp > $2',
    [serviceName, since]
  );
  const weights = { critical: 15, warning: 5, info: 1 };
  const penalty = rows.reduce((s, r) => s + (weights[r.severity] || 5), 0);
  const value = Math.max(0, 100 - penalty);
  return { value, detail: { incident_count: rows.length, penalty } };
}

async function deployFreshness(serviceName) {
  const dep = await queryOne(
    `SELECT deploy_timestamp FROM deployments
     WHERE service=$1
     ORDER BY deploy_timestamp DESC LIMIT 1`,
    [serviceName]
  );
  if (!dep) return { value: 0, detail: { reason: 'never deployed' } };
  const ageDays = (Date.now() - Number(dep.deploy_timestamp)) / 86400000;
  // Linear: 0 days → 100, 30 days → 0
  const value = Math.max(0, 100 - (ageDays / 30) * 100);
  return { value, detail: { days_since_deploy: +ageDays.toFixed(1) } };
}

async function securityPosture(serviceName) {
  const rows = await query(
    `SELECT severity, COUNT(*)::INT AS n
     FROM security_findings f
     JOIN security_scans s ON f.scan_id=s.id
     WHERE s.target=$1 AND f.status='open'
     GROUP BY severity`,
    [serviceName]
  );
  const counts = Object.fromEntries(rows.map(r => [r.severity, r.n]));
  const penalty = (counts.critical || 0) * 25 + (counts.high || 0) * 10 + (counts.medium || 0) * 3;
  const value = Math.max(0, 100 - penalty);
  return { value, detail: counts };
}

const METRICS = [
  { key: 'slo_compliance', fn: sloCompliance },
  { key: 'incident_health', fn: incidentHealth },
  { key: 'deploy_freshness', fn: deployFreshness },
  { key: 'security_posture', fn: securityPosture },
];

export async function computeScorecards() {
  const services = await query('SELECT id, name FROM services');
  const now = Date.now();
  for (const svc of services) {
    for (const m of METRICS) {
      try {
        const { value, detail } = await m.fn(svc.name);
        const grade = gradeFromValue(value);
        await execute(
          `INSERT INTO scorecards (service_id, metric, value, grade, detail, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [svc.id, m.key, value.toFixed(3), grade, JSON.stringify(detail), now]
        );
      } catch (err) {
        console.error(`Scorecard ${m.key} for ${svc.name}:`, err.message);
      }
    }
  }
  broadcast('idp:scorecards-computed', { at: now });
}

// Latest scorecard set per service.
export async function latestScorecards() {
  const rows = await query(`
    SELECT DISTINCT ON (service_id, metric)
      service_id, metric, value, grade, detail, computed_at
    FROM scorecards
    ORDER BY service_id, metric, computed_at DESC
  `);
  const byService = new Map();
  for (const r of rows) {
    const arr = byService.get(r.service_id) || [];
    arr.push({ ...r, value: Number(r.value), computed_at: Number(r.computed_at) });
    byService.set(r.service_id, arr);
  }
  return byService;
}

export function startScorecardSweep() {
  setInterval(() => {
    computeScorecards().catch(err => console.error('Scorecard sweep:', err.message));
  }, RECOMPUTE_INTERVAL);
  console.log('✓ IDP scorecard sweep started');
}
