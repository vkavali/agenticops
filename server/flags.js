import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';

// Feature flag engine.
//
// Evaluation order for a flag against a context object:
//   1. If flag.enabled is false → default_value
//   2. Walk flag_rules in ascending priority. First rule whose conditions all
//      match the context wins → rule.value
//   3. If an active rollout exists, hash(context.key + flag.key) % 100 picks
//      a stable bucket. If bucket < current_pct → rolled_out_value.
//   4. Otherwise → default_value
//
// Rollouts are linear-by-default — every increment_interval_ms, the controller
// bumps current_pct by increment_pct (capped at target_pct). If the linked SLO
// is burning at >= 1.5× while a rollout is running, the rollout auto-pauses
// and the cause is recorded. On a critical burn (>= 2×) we mark it
// rolled-back: current_pct is reset to start_pct.

const ROLLOUT_TICK_MS = 30_000;
const AUTO_PAUSE_BURN_RATE = 1.5;
const AUTO_ROLLBACK_BURN_RATE = 2.0;

export function hashBucket(input) {
  return parseInt(crypto.createHash('sha1').update(input).digest('hex').slice(0, 8), 16) % 100;
}

export function matchCondition(cond, context) {
  const lhs = context[cond.attr];
  const rhs = cond.value;
  switch (cond.op) {
    case 'equals': return lhs === rhs;
    case 'not_equals': return lhs !== rhs;
    case 'in': return Array.isArray(rhs) && rhs.includes(lhs);
    case 'not_in': return Array.isArray(rhs) && !rhs.includes(lhs);
    case 'contains': return typeof lhs === 'string' && lhs.includes(rhs);
    case 'gt': return Number(lhs) > Number(rhs);
    case 'lt': return Number(lhs) < Number(rhs);
    case 'gte': return Number(lhs) >= Number(rhs);
    case 'lte': return Number(lhs) <= Number(rhs);
    case 'present': return lhs !== undefined && lhs !== null;
    default: return false;
  }
}

export function matchAll(conditions, context) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every(c => matchCondition(c, context));
}

export async function evaluate(flagKey, context = {}) {
  const flag = await queryOne('SELECT * FROM flags WHERE key=$1', [flagKey]);
  if (!flag) return { value: null, reason: 'flag_not_found' };
  if (!flag.enabled) return { value: flag.default_value, reason: 'disabled' };

  const rules = await query(
    'SELECT * FROM flag_rules WHERE flag_id=$1 ORDER BY priority ASC',
    [flag.id]
  );
  for (const rule of rules) {
    if (matchAll(rule.conditions, context)) {
      return { value: rule.value, reason: 'rule_match', rule_id: rule.id };
    }
  }

  const rollout = await queryOne(
    "SELECT * FROM flag_rollouts WHERE flag_id=$1 AND status IN ('running','paused')",
    [flag.id]
  );
  if (rollout && flag.rolled_out_value !== null) {
    // Stable bucketing: same (subject, flag) always lands in the same bucket.
    const subject = String(context.key ?? context.user_id ?? context.id ?? '');
    const bucket = hashBucket(`${flag.key}:${subject}`);
    if (bucket < Number(rollout.current_pct)) {
      return {
        value: flag.rolled_out_value,
        reason: 'rollout',
        rollout_id: rollout.id,
        bucket,
        current_pct: Number(rollout.current_pct),
      };
    }
    return { value: flag.default_value, reason: 'rollout_excluded', bucket, current_pct: Number(rollout.current_pct) };
  }

  return { value: flag.default_value, reason: 'default' };
}

async function activeRollouts() {
  return query("SELECT r.*, f.key AS flag_key FROM flag_rollouts r JOIN flags f ON r.flag_id=f.id WHERE r.status='running'");
}

async function latestSloEval(sloId) {
  return queryOne(
    'SELECT burn_rate, alerting FROM slo_evals WHERE slo_id=$1 ORDER BY evaluated_at DESC LIMIT 1',
    [sloId]
  );
}

async function pauseRollout(rolloutId, reason) {
  await execute(
    "UPDATE flag_rollouts SET status='paused', pause_reason=$1 WHERE id=$2",
    [reason, rolloutId]
  );
  broadcast('flag:rollout-paused', { id: rolloutId, reason });
}

async function rollbackRollout(rollout, reason) {
  await execute(
    "UPDATE flag_rollouts SET status='rolled-back', pause_reason=$1, current_pct=$2, finished_at=$3 WHERE id=$4",
    [reason, rollout.start_pct, Date.now(), rollout.id]
  );
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Flag rollout ${rollout.id} auto-rolled-back: ${reason}`, 'flag', Date.now()]);
  broadcast('flag:rollout-rolled-back', { id: rollout.id, reason });
}

async function tickOne(rollout) {
  if (rollout.slo_id) {
    const ev = await latestSloEval(rollout.slo_id);
    if (ev) {
      const burn = Number(ev.burn_rate);
      if (burn >= AUTO_ROLLBACK_BURN_RATE) {
        await rollbackRollout(rollout, `SLO burn ${burn.toFixed(2)}× ≥ ${AUTO_ROLLBACK_BURN_RATE}× threshold`);
        return;
      }
      if (burn >= AUTO_PAUSE_BURN_RATE) {
        await pauseRollout(rollout.id, `SLO burn ${burn.toFixed(2)}× ≥ ${AUTO_PAUSE_BURN_RATE}× threshold`);
        return;
      }
    }
  }

  const lastInc = rollout.last_increment_at ? Number(rollout.last_increment_at) : 0;
  if (Date.now() - lastInc < Number(rollout.increment_interval_ms)) return;

  const next = Math.min(Number(rollout.target_pct), Number(rollout.current_pct) + Number(rollout.increment_pct));
  const isComplete = next >= Number(rollout.target_pct);
  await execute(
    `UPDATE flag_rollouts SET current_pct=$1, last_increment_at=$2,
       status=CASE WHEN $3 THEN 'complete' ELSE status END,
       finished_at=CASE WHEN $3 THEN $2 ELSE finished_at END
     WHERE id=$4`,
    [next, Date.now(), isComplete, rollout.id]
  );
  broadcast('flag:rollout-progress', {
    id: rollout.id, flag_key: rollout.flag_key,
    current_pct: next, status: isComplete ? 'complete' : 'running',
  });
}

export function startRolloutController() {
  setInterval(async () => {
    try {
      const rollouts = await activeRollouts();
      for (const r of rollouts) {
        try { await tickOne(r); }
        catch (err) { console.error(`Rollout ${r.id} tick failed:`, err.message); }
      }
    } catch (err) {
      console.error('Rollout controller tick error:', err.message);
    }
  }, ROLLOUT_TICK_MS);
  console.log('✓ Flag rollout controller started');
}
