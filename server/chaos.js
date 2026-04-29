import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';
import { createGate } from './routes/gates.js';

// Chaos Engineering.
//
// Experiments declare a target service, fault type, blast radius, duration,
// and an optional `abort_on_slo_id` — the SLO whose burn-rate auto-aborts
// the run. Every run is gated by an approval before fault injection begins.
//
// Real fault injection requires a chaos provider (LitmusChaos, Gremlin,
// Chaos Mesh) — we model the state machine and emit observation events; a
// real provider plug-in writes the actual fault and clears it on abort.

const ABORT_BURN_RATE = 1.5;
const TICK_MS = 5000;

const inFlight = new Map(); // runId -> tick interval

async function startInjection(run) {
  // Stub: emit an observation event indicating the fault is "active".
  broadcast('chaos:fault-injected', { runId: run.id });
  await appendObservation(run.id, { event: 'fault-injected', at: Date.now() });
}

async function clearInjection(run, reason) {
  broadcast('chaos:fault-cleared', { runId: run.id, reason });
  await appendObservation(run.id, { event: 'fault-cleared', reason, at: Date.now() });
}

async function appendObservation(runId, obs) {
  const r = await queryOne('SELECT observations FROM chaos_runs WHERE id=$1', [runId]);
  const next = [...(r?.observations || []), obs];
  await execute('UPDATE chaos_runs SET observations=$1 WHERE id=$2', [JSON.stringify(next), runId]);
}

async function checkAbortConditions(run, experiment) {
  if (!experiment.abort_on_slo_id) return null;
  const ev = await queryOne(
    'SELECT burn_rate FROM slo_evals WHERE slo_id=$1 ORDER BY evaluated_at DESC LIMIT 1',
    [experiment.abort_on_slo_id]
  );
  if (!ev) return null;
  const burn = Number(ev.burn_rate);
  if (burn >= ABORT_BURN_RATE) {
    return `SLO burn ${burn.toFixed(2)}× ≥ ${ABORT_BURN_RATE}× abort threshold`;
  }
  return null;
}

async function finishRun(runId, status, reason = null) {
  await execute(
    'UPDATE chaos_runs SET status=$1, finished_at=$2, abort_reason=$3 WHERE id=$4',
    [status, Date.now(), reason, runId]
  );
  broadcast('chaos:run-finished', { id: runId, status, reason });
  const t = inFlight.get(runId);
  if (t) { clearInterval(t); inFlight.delete(runId); }
}

async function executeRun(runId) {
  const run = await queryOne('SELECT * FROM chaos_runs WHERE id=$1', [runId]);
  if (!run) return;
  const exp = await queryOne('SELECT * FROM chaos_experiments WHERE id=$1', [run.experiment_id]);
  if (!exp) { await finishRun(runId, 'failed', 'experiment not found'); return; }

  await execute("UPDATE chaos_runs SET status='running' WHERE id=$1", [runId]);
  broadcast('chaos:run-started', { id: runId, experiment_id: exp.id });

  try {
    await startInjection(run);
    const startedAt = Date.now();
    const durationMs = Number(exp.duration_ms);

    const tick = setInterval(async () => {
      try {
        const reason = await checkAbortConditions(run, exp);
        if (reason) {
          await clearInjection(run, reason);
          await finishRun(runId, 'aborted', reason);
          return;
        }
        if (Date.now() - startedAt >= durationMs) {
          await clearInjection(run, 'duration-elapsed');
          await finishRun(runId, 'completed');
        }
      } catch (err) {
        console.error(`Chaos run ${runId} tick error:`, err.message);
      }
    }, TICK_MS);
    inFlight.set(runId, tick);
  } catch (err) {
    await finishRun(runId, 'failed', err.message);
  }
}

// Public entrypoint — caller verifies the gate is approved, then we kick off
// fault injection in the background.
export async function startChaosRun(runId) {
  executeRun(runId).catch(err => console.error('Chaos run failed:', err));
}

// Manual abort.
export async function abortRun(runId, reason = 'manual') {
  const run = await queryOne('SELECT * FROM chaos_runs WHERE id=$1', [runId]);
  if (!run || !['pending', 'running'].includes(run.status)) return false;
  await clearInjection(run, reason);
  await finishRun(runId, 'aborted', reason);
  return true;
}

// Create a run row and an approval gate. The actual injection waits on the
// gate-decision listener.
export async function requestRun(experimentId, { triggeredBy }) {
  const exp = await queryOne('SELECT * FROM chaos_experiments WHERE id=$1', [experimentId]);
  if (!exp) throw new Error('experiment not found');
  const id = `chaos-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const gateId = await createGate({
    subject_type: 'chaos_run',
    subject_id: id,
    description: `Run chaos experiment "${exp.name}" — ${exp.fault_type} on ${exp.target_service} (blast=${exp.blast_radius_pct}%, ${Math.round(Number(exp.duration_ms)/1000)}s)`,
    required_role: 'operator',
    requested_by: triggeredBy,
    payload: { experiment_id: exp.id, run_id: id },
    ttl_ms: 24 * 60 * 60 * 1000,
  });
  await execute(
    `INSERT INTO chaos_runs (id, experiment_id, status, gate_id, triggered_by, started_at)
     VALUES ($1,$2,'pending',$3,$4,$5)`,
    [id, exp.id, gateId, triggeredBy || null, Date.now()]
  );
  broadcast('chaos:run-requested', { id, experiment_id: exp.id, gate_id: gateId });
  return { runId: id, gateId };
}

// Gate-decision listener — kicks off fault injection on approval, marks
// failed on rejection.
export async function onGateDecision(gateId, decision) {
  const run = await queryOne('SELECT * FROM chaos_runs WHERE gate_id=$1', [gateId]);
  if (!run) return;
  if (decision === 'approved') {
    return startChaosRun(run.id);
  }
  await finishRun(run.id, 'failed', 'gate rejected');
}
