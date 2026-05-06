import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';
import * as notify from './notify.js';

// SLO evaluator.
//
// For each enabled SLO, computes the current SLI from `health_checks` over the
// SLO window, derives error-budget remaining and burn rate, and writes an
// `slo_evals` row. When the burn rate exceeds the SLO's alert threshold, opens
// a critical incident (deduplicated against existing active incidents).
//
// Burn rate definition (SRE workbook style): observed error rate / acceptable
// error rate. Burn rate of 1.0 = exactly on budget; >1 = consuming budget
// faster than allowed. Alert threshold defaults to 2.0.

const EVAL_INTERVAL = 60_000;

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function evaluateOne(slo) {
  const since = Date.now() - Number(slo.window_ms);
  const rows = await query(
    `SELECT status, response_time FROM health_checks
     WHERE service_id=(SELECT id FROM services WHERE name=$1 LIMIT 1)
       AND checked_at > $2`,
    [slo.service, since]
  );
  if (rows.length === 0) return null;

  const target = Number(slo.target_pct);
  let sli;
  if (slo.sli_type === 'availability') {
    const good = rows.filter(r => r.status === 'healthy').length;
    sli = (good / rows.length) * 100;
  } else {
    const threshold = slo.latency_threshold_ms || 1000;
    const fast = rows.filter(r => r.response_time != null && r.response_time <= threshold).length;
    sli = (fast / rows.length) * 100;
  }

  // Error budget — what fraction of the allowed errors have we used?
  // allowedErrorPct = 100 - target. observedErrorPct = 100 - sli.
  const allowedErrorPct = Math.max(0.001, 100 - target);
  const observedErrorPct = Math.max(0, 100 - sli);
  const errorBudgetRemainingPct = Math.max(0, 100 - (observedErrorPct / allowedErrorPct) * 100);
  const burnRate = observedErrorPct / allowedErrorPct;
  const alerting = burnRate >= Number(slo.burn_rate_alert_threshold);

  await execute(
    `INSERT INTO slo_evals (slo_id, evaluated_at, sli_value, error_budget_remaining_pct, burn_rate, sample_count, alerting)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [slo.id, Date.now(), sli.toFixed(3), errorBudgetRemainingPct.toFixed(3), burnRate.toFixed(3), rows.length, alerting]
  );

  broadcast('slo:evaluated', {
    slo_id: slo.id,
    sli: +sli.toFixed(3),
    error_budget_remaining_pct: +errorBudgetRemainingPct.toFixed(3),
    burn_rate: +burnRate.toFixed(3),
    alerting,
  });

  if (alerting) await maybeOpenIncident(slo, sli, burnRate);

  return { sli, burnRate, alerting };
}

async function maybeOpenIncident(slo, sli, burnRate) {
  // Dedupe — don't open a second incident if one is already active for this SLO.
  const existing = await queryOne(
    `SELECT id FROM incidents
     WHERE service=$1 AND status IN ('active','acknowledged')
       AND title LIKE $2`,
    [slo.service, `SLO burn-rate alert: ${slo.name}%`]
  );
  if (existing) return;

  const lastInc = await queryOne("SELECT id FROM incidents ORDER BY incident_timestamp DESC LIMIT 1");
  const lastNum = lastInc ? parseInt(lastInc.id.replace('INC-', ''), 10) : 2847;
  const id = `INC-${lastNum + 1}`;
  const now = Date.now();
  const timeline = [{
    time: nowTime(),
    event: `SLO ${slo.name} burning at ${burnRate.toFixed(2)}× (SLI ${sli.toFixed(2)}% vs target ${slo.target_pct}%)`,
    type: 'alert',
  }];
  await execute(
    'INSERT INTO incidents (id,title,service,severity,status,opened,incident_timestamp,assignee,description,timeline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, `SLO burn-rate alert: ${slo.name}`, slo.service, 'critical', 'active', 'Just now', now,
     'AgenticOps SLO Engine',
     `SLO "${slo.name}" is burning at ${burnRate.toFixed(2)}× the acceptable rate. SLI=${sli.toFixed(2)}%, target=${slo.target_pct}%. Window=${Math.round(Number(slo.window_ms)/3600000)}h.`,
     JSON.stringify(timeline)]
  );
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`${id} opened: SLO ${slo.name} burning at ${burnRate.toFixed(2)}×`, 'incident', now]);
  const incident = {
    id, title: `SLO burn-rate alert: ${slo.name}`, service: slo.service, severity: 'critical',
    status: 'active', opened: 'Just now', timestamp: now, assignee: 'AgenticOps SLO Engine',
    description: `SLO "${slo.name}" burning at ${burnRate.toFixed(2)}× the acceptable rate.`,
    timeline,
  };
  broadcast('incident:created', incident);
  broadcast('activity:new', { event: `${id} opened: SLO ${slo.name} burning`, type: 'incident', timestamp: now });
  notify.incidentOpened(slo.org_id, incident).catch(err => console.error('notify slo incident:', err.message));
  notify.sloBurning(slo.org_id, slo, burnRate).catch(err => console.error('notify slo burn:', err.message));
}

export async function evaluateAll() {
  const slos = await query("SELECT * FROM slos WHERE enabled=true");
  for (const s of slos) {
    try { await evaluateOne(s); }
    catch (err) { console.error(`SLO eval ${s.id} failed:`, err.message); }
  }
}

export function startSloEvaluator() {
  setInterval(() => { evaluateAll().catch(err => console.error('SLO eval tick:', err)); }, EVAL_INTERVAL);
  console.log('✓ SLO evaluator started');
}
