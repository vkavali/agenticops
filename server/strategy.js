import { execute, queryOne } from './db.js';
import { broadcast } from './sse.js';
import { createGate } from './routes/gates.js';

// Deployment strategy engine.
// Drives phase progression for rolling / canary / blue-green deploys against a
// target environment. We can't actually shift traffic on real infra here, but
// we model the state machine accurately so the agent + UI behave as if we did.
// When a real cloud connector is wired up later, swap the simulated phases for
// real cloud-provider calls.

const PHASE_DURATION_MS = 4000; // per-phase wall time in the simulated state machine

const STRATEGY_PHASES = {
  rolling: ['provisioning', 'rolling-out', 'verifying', 'complete'],
  canary: ['provisioning', 'canary-10', 'canary-50', 'canary-100', 'verifying', 'complete'],
  'blue-green': ['provisioning', 'green-deployed', 'switching-traffic', 'verifying', 'complete'],
};

// Envs that always require an approval gate before deploy. Configurable later.
const GATED_ENVS = new Set(['production']);

const inFlight = new Map(); // depId+env -> timer

function envState(deployment, env) {
  return (deployment.environments || {})[env] || null;
}

async function setPhase(depId, env, patch) {
  const dep = await queryOne('SELECT * FROM deployments WHERE id=$1', [depId]);
  if (!dep) return null;
  const envs = dep.environments || {};
  envs[env] = { ...(envs[env] || {}), ...patch, time: 'Just now', timestamp: Date.now() };
  await execute('UPDATE deployments SET environments=$1 WHERE id=$2', [JSON.stringify(envs), depId]);
  broadcast('deployment:updated', { id: depId, environments: envs });
  return envs[env];
}

function clearInFlight(key) {
  const t = inFlight.get(key);
  if (t) clearTimeout(t);
  inFlight.delete(key);
}

async function advancePhase(depId, env, strategy, phaseIdx) {
  const phases = STRATEGY_PHASES[strategy] || STRATEGY_PHASES.rolling;
  const key = `${depId}:${env}`;
  if (phaseIdx >= phases.length) {
    clearInFlight(key);
    return;
  }

  const phase = phases[phaseIdx];
  const isFinal = phase === 'complete';

  await setPhase(depId, env, {
    status: isFinal ? 'passed' : 'running',
    phase,
    strategy,
    progress: Math.round(((phaseIdx + (isFinal ? 0 : 1)) / phases.length) * 100),
  });

  if (isFinal) {
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Deployment ${depId} completed in ${env}`, 'deploy', Date.now()]);
    broadcast('activity:new', { event: `Deployment ${depId} completed in ${env}`, type: 'deploy', timestamp: Date.now() });
    clearInFlight(key);
    return;
  }

  const t = setTimeout(() => advancePhase(depId, env, strategy, phaseIdx + 1).catch(err => {
    console.error('Strategy advance error:', err);
    clearInFlight(key);
  }), PHASE_DURATION_MS);
  inFlight.set(key, t);
}

// Begin a deploy to env. If env is gated, creates an approval gate and parks
// the deploy in 'pending-approval' until decided. Otherwise advances immediately.
export async function beginDeploy(deployment, env, { actor } = {}) {
  const strategy = deployment.strategy || 'rolling';

  if (GATED_ENVS.has(env)) {
    const gateId = await createGate({
      subject_type: 'deployment',
      subject_id: deployment.id,
      description: `Promote ${deployment.service} ${deployment.version} to ${env} (${strategy})`,
      required_role: 'operator',
      requested_by: actor,
      payload: { env, strategy },
      ttl_ms: 24 * 60 * 60 * 1000,
    });
    await execute('UPDATE deployments SET gate_id=$1 WHERE id=$2', [gateId, deployment.id]);
    await setPhase(deployment.id, env, {
      status: 'pending-approval',
      phase: 'awaiting-gate',
      strategy,
      gate_id: gateId,
      progress: 0,
    });
    return { gated: true, gateId };
  }

  await setPhase(deployment.id, env, { status: 'running', phase: 'provisioning', strategy, progress: 5 });
  advancePhase(deployment.id, env, strategy, 1).catch(err => console.error('Strategy start error:', err));
  return { gated: false };
}

// Called by gates router when an approval is decided. Resumes any deployment
// that was waiting on this gate.
export async function onGateDecision(gateId, decision) {
  const dep = await queryOne('SELECT * FROM deployments WHERE gate_id=$1', [gateId]);
  if (!dep) return;
  // Find which env was waiting on this gate.
  const envs = dep.environments || {};
  const waitingEnv = Object.keys(envs).find(e => envs[e]?.gate_id === gateId);
  if (!waitingEnv) return;

  if (decision === 'approved') {
    await setPhase(dep.id, waitingEnv, { status: 'running', phase: 'provisioning', progress: 5 });
    advancePhase(dep.id, waitingEnv, dep.strategy || 'rolling', 1).catch(err => console.error('Resume error:', err));
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Deployment ${dep.id} approved for ${waitingEnv}`, 'deploy', Date.now()]);
  } else {
    await setPhase(dep.id, waitingEnv, { status: 'rejected', phase: 'gate-rejected', progress: 0 });
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Deployment ${dep.id} rejected for ${waitingEnv}`, 'deploy', Date.now()]);
  }
  await execute('UPDATE deployments SET gate_id=NULL WHERE id=$1', [dep.id]);
}

// Operator-initiated rollback. Cancels any in-flight progression.
export async function rollback(deployment, env, { actor } = {}) {
  const key = `${deployment.id}:${env}`;
  clearInFlight(key);
  await setPhase(deployment.id, env, { status: 'rolledback', phase: 'rolledback', progress: 0 });
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Rolled back ${deployment.service} in ${env} by ${actor || 'operator'}`, 'deploy', Date.now()]);
  broadcast('activity:new', { event: `Rolled back ${deployment.service} in ${env}`, type: 'deploy', timestamp: Date.now() });
}
