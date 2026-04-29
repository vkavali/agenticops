import { execute, queryOne } from './db.js';
import { broadcast } from './sse.js';
import { createGate } from './routes/gates.js';
import { kubectlSetImage, kubectlRolloutStatus, kubectlRolloutUndo } from './k8s.js';
import { rolloutSetImage, observeRollout, rolloutPromote, rolloutAbort } from './argo.js';

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

// Resolves the K8s deploy target from the service definition. Format:
//   service.deploy_target = {
//     k8s: { connector_id, deployment, container, image_repo, namespace? }
//   }
// Returns null when the service hasn't been wired for real K8s deploys.
async function resolveK8sTarget(serviceName) {
  const svc = await queryOne('SELECT deploy_target FROM services WHERE name=$1 LIMIT 1', [serviceName]);
  return svc?.deploy_target?.k8s || null;
}

// Real rolling deploy via kubectl. set image, then rollout status; on failure
// rollout undo. Phase progression mirrors the simulated path so the UI is
// agnostic about whether the deploy is real or modeled.
async function realRollingDeploy(deployment, env, k8s) {
  const image = `${k8s.image_repo}:${deployment.version}`;
  const ctx = { runId: `${deployment.id}:${env}` };

  await setPhase(deployment.id, env, { status: 'running', phase: 'set-image', strategy: 'rolling', progress: 20 });
  const setRes = await kubectlSetImage(k8s.connector_id, k8s.deployment, k8s.container, image, ctx);
  if (setRes.exitCode !== 0) {
    await setPhase(deployment.id, env, { status: 'failed', phase: 'set-image-failed', progress: 0 });
    return;
  }

  await setPhase(deployment.id, env, { status: 'running', phase: 'rolling-out', strategy: 'rolling', progress: 60 });
  const statusRes = await kubectlRolloutStatus(k8s.connector_id, k8s.deployment, ctx);
  if (statusRes.exitCode !== 0) {
    await setPhase(deployment.id, env, { status: 'failed', phase: 'rollout-failed', progress: 60 });
    // Try to undo so the cluster doesn't stay broken.
    await kubectlRolloutUndo(k8s.connector_id, k8s.deployment, ctx).catch(() => {});
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Rollout of ${deployment.service} ${deployment.version} failed in ${env}; auto-rolled-back`, 'deploy', Date.now()]);
    return;
  }

  await setPhase(deployment.id, env, { status: 'passed', phase: 'complete', strategy: 'rolling', progress: 100 });
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Real K8s rollout: ${deployment.service} ${deployment.version} → ${env}`, 'deploy', Date.now()]);
  broadcast('activity:new', { event: `${deployment.service} ${deployment.version} rolled out in ${env}`, type: 'deploy', timestamp: Date.now() });
}

// Real canary / blue-green via Argo Rollouts. Patches the image, observes
// status, bridges to our phase machine. When Argo pauses awaiting promotion,
// we open an approval gate; on approval we annotate the rollout to promote.
async function realArgoDeploy(deployment, env, k8s, strategy) {
  const image = `${k8s.image_repo}:${deployment.version}`;
  const runId = `${deployment.id}:${env}`;

  await setPhase(deployment.id, env, { status: 'running', phase: 'argo-set-image', strategy, progress: 10 });
  const setRes = await rolloutSetImage(k8s.connector_id, k8s.argo_rollout, k8s.container, image);
  if (setRes.exitCode !== 0) {
    await setPhase(deployment.id, env, { status: 'failed', phase: 'argo-set-image-failed', progress: 0 });
    return;
  }

  let openGateId = null;
  const final = await observeRollout(k8s.connector_id, k8s.argo_rollout, {
    runId, intervalMs: 5000, timeoutMs: 60 * 60 * 1000,
    onPhase: async (s) => {
      // Map Argo's progress into our progress field. Canary uses the weight;
      // blue-green has no weight so we step on phase changes.
      const progress = s.weight != null
        ? Math.max(10, Math.min(95, Number(s.weight)))
        : (s.phase === 'Progressing' ? 50 : s.phase === 'Healthy' ? 100 : 0);
      await setPhase(deployment.id, env, {
        status: 'running',
        phase: `argo-${s.phase.toLowerCase()}`,
        strategy,
        progress,
        argo: { weight: s.weight, currentStep: s.currentStep, totalSteps: s.totalSteps },
      });

      // Argo pauses when a step has no `duration` (= awaiting manual promote).
      // Open an approval gate for the operator on first such pause.
      if (s.phase === 'Paused' && (s.pauseConditions || []).length > 0 && !openGateId) {
        openGateId = await createGate({
          subject_type: 'argo_rollout',
          subject_id: deployment.id,
          description: `Promote canary step ${s.currentStep}/${s.totalSteps} for ${deployment.service} ${deployment.version} (${s.weight ?? '—'}% traffic)`,
          required_role: 'operator',
          requested_by: 'argo-observer',
          payload: { deployment_id: deployment.id, env, rollout: k8s.argo_rollout, connector_id: k8s.connector_id },
          ttl_ms: 24 * 60 * 60 * 1000,
        });
        await execute('UPDATE deployments SET gate_id=$1 WHERE id=$2', [openGateId, deployment.id]);
        broadcast('deployment:argo-paused', { runId, gate_id: openGateId, weight: s.weight, currentStep: s.currentStep });
      }
    },
  });

  if (final.phase === 'Healthy') {
    await setPhase(deployment.id, env, { status: 'passed', phase: 'argo-healthy', strategy, progress: 100 });
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Argo ${strategy} complete: ${deployment.service} ${deployment.version} → ${env}`, 'deploy', Date.now()]);
  } else {
    await setPhase(deployment.id, env, { status: 'failed', phase: `argo-${(final.phase || 'unknown').toLowerCase()}`, strategy, progress: 0 });
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Argo ${strategy} ${final.phase}: ${deployment.service} ${deployment.version} (${final.message || 'no message'})`, 'deploy', Date.now()]);
  }
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

  const k8s = await resolveK8sTarget(deployment.service);

  // Real K8s rolling deploy when the target is wired and the strategy is rolling.
  if (strategy === 'rolling' && k8s?.connector_id && k8s?.deployment && k8s?.container && k8s?.image_repo) {
    realRollingDeploy(deployment, env, k8s).catch(err => console.error('Real rolling deploy:', err));
    return { gated: false, mode: 'k8s' };
  }

  // Real canary / blue-green via Argo Rollouts when the service points at one.
  if ((strategy === 'canary' || strategy === 'blue-green')
      && k8s?.connector_id && k8s?.argo_rollout && k8s?.container && k8s?.image_repo) {
    realArgoDeploy(deployment, env, k8s, strategy).catch(err => console.error('Argo deploy:', err));
    return { gated: false, mode: 'argo' };
  }

  await setPhase(deployment.id, env, { status: 'running', phase: 'provisioning', strategy, progress: 5 });
  advancePhase(deployment.id, env, strategy, 1).catch(err => console.error('Strategy start error:', err));
  return { gated: false, mode: 'simulated' };
}

// Called by gates router when an approval is decided. Resumes any deployment
// that was waiting on this gate (env-promote OR Argo canary-step pause).
export async function onGateDecision(gateId, decision) {
  // Argo pause-promote gates carry `subject_type='argo_rollout'`.
  const gate = await queryOne('SELECT subject_type, payload FROM approval_gates WHERE id=$1', [gateId]);
  if (gate?.subject_type === 'argo_rollout') {
    const payload = gate.payload || {};
    if (decision === 'approved') {
      await rolloutPromote(payload.connector_id, payload.rollout).catch(err => console.error('argo promote:', err));
      broadcast('deployment:argo-promoted', { deployment_id: payload.deployment_id, rollout: payload.rollout });
    } else {
      await rolloutAbort(payload.connector_id, payload.rollout).catch(err => console.error('argo abort:', err));
      broadcast('deployment:argo-aborted', { deployment_id: payload.deployment_id, rollout: payload.rollout });
    }
    await execute('UPDATE deployments SET gate_id=NULL WHERE id=$1', [payload.deployment_id]);
    return;
  }

  const dep = await queryOne('SELECT * FROM deployments WHERE gate_id=$1', [gateId]);
  if (!dep) return;
  // Find which env was waiting on this gate.
  const envs = dep.environments || {};
  const waitingEnv = Object.keys(envs).find(e => envs[e]?.gate_id === gateId);
  if (!waitingEnv) return;

  if (decision === 'approved') {
    const strategy = dep.strategy || 'rolling';
    if (strategy === 'rolling') {
      const k8s = await resolveK8sTarget(dep.service);
      if (k8s?.connector_id && k8s?.deployment && k8s?.container && k8s?.image_repo) {
        realRollingDeploy(dep, waitingEnv, k8s).catch(err => console.error('Resume real deploy:', err));
        await execute('UPDATE deployments SET gate_id=NULL WHERE id=$1', [dep.id]);
        return;
      }
    }
    await setPhase(dep.id, waitingEnv, { status: 'running', phase: 'provisioning', progress: 5 });
    advancePhase(dep.id, waitingEnv, strategy, 1).catch(err => console.error('Resume error:', err));
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Deployment ${dep.id} approved for ${waitingEnv}`, 'deploy', Date.now()]);
  } else {
    await setPhase(dep.id, waitingEnv, { status: 'rejected', phase: 'gate-rejected', progress: 0 });
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Deployment ${dep.id} rejected for ${waitingEnv}`, 'deploy', Date.now()]);
  }
  await execute('UPDATE deployments SET gate_id=NULL WHERE id=$1', [dep.id]);
}

// Operator-initiated rollback. Cancels any in-flight progression and, when
// the service has a real K8s target, runs `kubectl rollout undo`.
export async function rollback(deployment, env, { actor } = {}) {
  const key = `${deployment.id}:${env}`;
  clearInFlight(key);

  const k8s = await resolveK8sTarget(deployment.service);
  if (k8s?.connector_id && k8s?.deployment) {
    await setPhase(deployment.id, env, { status: 'running', phase: 'rolling-back', progress: 50 });
    const r = await kubectlRolloutUndo(k8s.connector_id, k8s.deployment, { runId: `${deployment.id}:${env}:rb` });
    const status = r.exitCode === 0 ? 'rolledback' : 'failed';
    await setPhase(deployment.id, env, { status, phase: status === 'rolledback' ? 'rolledback' : 'rollback-failed', progress: 0 });
  } else {
    await setPhase(deployment.id, env, { status: 'rolledback', phase: 'rolledback', progress: 0 });
  }
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`Rolled back ${deployment.service} in ${env} by ${actor || 'operator'}`, 'deploy', Date.now()]);
  broadcast('activity:new', { event: `Rolled back ${deployment.service} in ${env}`, type: 'deploy', timestamp: Date.now() });
}
