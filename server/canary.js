import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';

// Kayenta-style canary analysis (lightweight).
//
// Compares signal samples from the canary window vs a baseline window using a
// two-sample Welch's t-test on the means, plus an n>0 sanity check. Returns
// a verdict ∈ pass | fail | inconclusive that the strategy engine can use
// to auto-abort a deploy that's regressing.
//
// Signals available out of the box:
//   - response_time   (lower better) — from health_checks.response_time
//   - error_rate      (lower better) — derived: % of health_checks.status != healthy
//
// Real Kayenta supports many more signals via Prometheus / Datadog / NewRelic
// adapters. Add a `signal` plugin map here when you wire metric providers.

// Pure stats — exported for unit tests.
export function mean(xs) {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function variance(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

// Welch's t-statistic — handles unequal variances + sample sizes.
// Returns t and the approximate degrees of freedom.
export function welchT(a, b) {
  const ma = mean(a), mb = mean(b);
  const va = variance(a), vb = variance(b);
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return { t: 0, df: 0 };
  const sePooled = Math.sqrt(va / na + vb / nb);
  if (sePooled === 0) return { t: 0, df: na + nb - 2 };
  const t = (ma - mb) / sePooled;
  const df = ((va / na + vb / nb) ** 2)
    / (((va / na) ** 2) / (na - 1) + ((vb / nb) ** 2) / (nb - 1));
  return { t, df };
}

// Critical value approximation — for our purposes a z-value is fine
// (df > 30 in any realistic sample). We treat |t| ≥ 2 ≈ 95% confidence
// as "different at the 5% level".
const SIGNIFICANCE_T = 2.0;

/**
 * Run a single canary analysis comparing the canary window to a baseline.
 *
 * @param {object} args
 * @param {string} args.service     — services.name to pull health_checks for
 * @param {string} args.metric      — 'response_time' or 'error_rate'
 * @param {number} args.baselineFromMs  — start of baseline window
 * @param {number} args.baselineUntilMs — end of baseline window
 * @param {number} args.canaryFromMs    — start of canary window
 * @param {number} args.canaryUntilMs   — end of canary window
 * @param {string} [args.deploymentId]  — deployment to attribute the analysis to
 * @returns {{verdict, baseline_mean, canary_mean, z, baseline_n, canary_n, id}}
 */
export async function analyzeCanary({
  service, metric = 'response_time',
  baselineFromMs, baselineUntilMs, canaryFromMs, canaryUntilMs,
  deploymentId = null,
}) {
  const svc = await queryOne('SELECT id FROM services WHERE name=$1 LIMIT 1', [service]);
  if (!svc) throw new Error(`service '${service}' not found`);

  const baselineRows = await query(
    `SELECT response_time, status FROM health_checks
     WHERE service_id=$1 AND checked_at BETWEEN $2 AND $3`,
    [svc.id, baselineFromMs, baselineUntilMs]
  );
  const canaryRows = await query(
    `SELECT response_time, status FROM health_checks
     WHERE service_id=$1 AND checked_at BETWEEN $2 AND $3`,
    [svc.id, canaryFromMs, canaryUntilMs]
  );

  const sample = (rows) => {
    if (metric === 'response_time') {
      return rows.filter(r => r.response_time != null).map(r => Number(r.response_time));
    }
    // error_rate: produce a 0/1 sample per check (1 if not healthy).
    return rows.map(r => (r.status === 'healthy' ? 0 : 1));
  };

  const baseline = sample(baselineRows);
  const canary = sample(canaryRows);

  let verdict, t = 0;
  if (baseline.length < 5 || canary.length < 5) {
    verdict = 'inconclusive';
  } else {
    const r = welchT(baseline, canary);
    t = r.t;
    // For "lower better" metrics: canary > baseline (significant t < -SIG)
    // means canary is worse → fail. baseline-canary >= 0 → t > 0 → safe.
    if (Math.abs(t) < SIGNIFICANCE_T) {
      verdict = 'pass';
    } else {
      // Welch's t = (baseline_mean - canary_mean) / SE
      // t > 0 means baseline > canary → canary is faster / fewer errors → pass
      verdict = t > 0 ? 'pass' : 'fail';
    }
  }

  const id = `canary-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const baseline_mean = +mean(baseline).toFixed(3);
  const canary_mean = +mean(canary).toFixed(3);

  await execute(
    `INSERT INTO canary_analyses (id, deployment_id, service, metric,
       baseline_mean, canary_mean, baseline_n, canary_n, z_score, verdict, evaluated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, deploymentId, service, metric,
     baseline_mean, canary_mean, baseline.length, canary.length, +t.toFixed(3), verdict, Date.now()]
  );

  const result = {
    id, deployment_id: deploymentId, service, metric,
    baseline_mean, canary_mean,
    baseline_n: baseline.length, canary_n: canary.length,
    z_score: +t.toFixed(3), verdict,
  };
  broadcast('canary:analyzed', result);
  return result;
}

export async function listAnalyses({ deploymentId = null, limit = 50 } = {}) {
  const lim = Math.min(limit, 200);
  if (deploymentId) {
    const rows = await query(
      'SELECT * FROM canary_analyses WHERE deployment_id=$1 ORDER BY evaluated_at DESC LIMIT $2',
      [deploymentId, lim]
    );
    return rows.map(r => ({ ...r, evaluated_at: Number(r.evaluated_at) }));
  }
  const rows = await query(
    'SELECT * FROM canary_analyses ORDER BY evaluated_at DESC LIMIT $1', [lim]
  );
  return rows.map(r => ({ ...r, evaluated_at: Number(r.evaluated_at) }));
}
