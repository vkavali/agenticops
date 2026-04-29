import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { queryOne } from './db.js';
import { decrypt } from './crypto.js';
import { broadcast } from './sse.js';

// Argo Rollouts integration.
//
// Argo Rollouts is a K8s controller that drives canary and blue-green
// progression for a Rollout CRD. We don't try to re-implement the controller —
// we just patch the image, poll status via `kubectl get rollout -o json`,
// bridge that into our deployment phase machine, and expose promote/abort.
//
// Requires the Argo Rollouts CRDs installed in the target cluster. The
// `kubectl-argo-rollouts` plugin is convenient but not required — we use raw
// `kubectl patch` for image updates and `kubectl annotate` for promote/abort,
// both of which the controller picks up.

function spawnKubectl(args, kubeconfigPath, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, KUBECONFIG: kubeconfigPath };
    const proc = spawn('kubectl', args, { env, timeout: opts.timeoutMs || 60_000 });
    const out = []; const err = [];
    proc.stdout.on('data', d => out.push(d.toString()));
    proc.stderr.on('data', d => err.push(d.toString()));
    proc.on('close', code => resolve({ exitCode: code ?? 0, stdout: out.join(''), stderr: err.join('') }));
    proc.on('error', e => resolve({ exitCode: 127, stdout: '', stderr: e.message }));
  });
}

async function withKubeconfig(connectorId) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const env = typeof conn.credentials === 'string' ? JSON.parse(conn.credentials) : conn.credentials;
  const creds = env?.enc ? JSON.parse(decrypt(env.enc)) : env;
  if (!creds?.kubeconfig) throw new Error('connector missing kubeconfig');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'aops-argo-'));
  const kubeconfigPath = path.join(dir, 'kubeconfig.yaml');
  await writeFile(kubeconfigPath, creds.kubeconfig, { mode: 0o600 });
  const ctx = { namespace: creds.namespace || null, context: creds.context || null };
  return {
    path: kubeconfigPath,
    ctx,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}

function withFlags(args, ctx) {
  const out = [...args];
  if (ctx.context) out.push('--context', ctx.context);
  if (ctx.namespace) out.push('-n', ctx.namespace);
  return out;
}

/**
 * Patch a Rollout's container image. The Argo controller takes over from
 * here, executing the strategy steps defined in the Rollout spec.
 */
export async function rolloutSetImage(connectorId, rolloutName, container, image) {
  const { path: kubeconfig, ctx, cleanup } = await withKubeconfig(connectorId);
  try {
    const patch = JSON.stringify({
      spec: { template: { spec: { containers: [{ name: container, image }] } } },
    });
    return spawnKubectl(
      withFlags(['patch', 'rollout', rolloutName, '--type=merge', '-p', patch], ctx),
      kubeconfig,
    );
  } finally { await cleanup(); }
}

/**
 * Read a Rollout's status. Returns the parsed JSON object or null on failure.
 * Caller is responsible for understanding the shape; see parseRolloutStatus
 * for the curated subset we surface to the UI.
 */
export async function rolloutGet(connectorId, rolloutName) {
  const { path: kubeconfig, ctx, cleanup } = await withKubeconfig(connectorId);
  try {
    const r = await spawnKubectl(
      withFlags(['get', 'rollout', rolloutName, '-o', 'json'], ctx),
      kubeconfig,
    );
    if (r.exitCode !== 0) return null;
    return JSON.parse(r.stdout);
  } catch { return null; }
  finally { await cleanup(); }
}

/** Distill an Argo Rollout payload down to the fields we care about. */
export function parseRolloutStatus(payload) {
  if (!payload) return null;
  const status = payload.status || {};
  const spec = payload.spec || {};
  const strategy = spec.strategy?.canary ? 'canary' : (spec.strategy?.blueGreen ? 'blue-green' : 'unknown');
  const phase = status.phase || 'Unknown'; // Progressing | Healthy | Degraded | Paused
  const message = status.message || null;
  const currentStep = status.currentStepIndex ?? null;
  const totalSteps = (spec.strategy?.canary?.steps || []).length || null;
  const weight = strategy === 'canary' ? (status.canary?.weights?.canary?.weight ?? null) : null;
  const activeSelector = strategy === 'blue-green' ? (status.blueGreen?.activeSelector ?? null) : null;
  const pauseConditions = status.pauseConditions || []; // present when paused awaiting promote
  return { strategy, phase, message, currentStep, totalSteps, weight, activeSelector, pauseConditions };
}

/**
 * Promote a paused canary to its next step.
 * The Argo controller watches the `argo-rollouts.argoproj.io/promote` annotation.
 */
export async function rolloutPromote(connectorId, rolloutName, full = false) {
  const { path: kubeconfig, ctx, cleanup } = await withKubeconfig(connectorId);
  try {
    const annotation = full
      ? 'rollout.argoproj.io/promote-full=true'
      : 'rollout.argoproj.io/promote=true';
    return spawnKubectl(
      withFlags(['annotate', 'rollout', rolloutName, annotation, '--overwrite'], ctx),
      kubeconfig,
    );
  } finally { await cleanup(); }
}

/**
 * Abort the rollout — the Argo controller scales the canary/preview down and
 * keeps the stable side serving traffic. Distinct from runRollback (which
 * reverts the image entirely).
 */
export async function rolloutAbort(connectorId, rolloutName) {
  const { path: kubeconfig, ctx, cleanup } = await withKubeconfig(connectorId);
  try {
    return spawnKubectl(
      withFlags(['annotate', 'rollout', rolloutName, 'rollout.argoproj.io/abort=true', '--overwrite'], ctx),
      kubeconfig,
    );
  } finally { await cleanup(); }
}

/**
 * Drive a canary/blue-green deploy through Argo and bridge progress into our
 * deployment phase machine. Polls every 5s; broadcasts deployment:argo-status
 * with the parsed status. Resolves when the rollout reaches Healthy or
 * Degraded, or when the operator aborts.
 *
 * onPhase({phase, weight, currentStep, totalSteps, paused, gateRequired}) lets
 * the caller (strategy.js) update the deployment row with our internal phase
 * names.
 */
export async function observeRollout(connectorId, rolloutName, { runId, intervalMs = 5000, timeoutMs = 30 * 60 * 1000, onPhase }) {
  const start = Date.now();
  let lastPhase = null;
  while (Date.now() - start < timeoutMs) {
    const payload = await rolloutGet(connectorId, rolloutName);
    const parsed = parseRolloutStatus(payload);
    if (parsed) {
      broadcast('deployment:argo-status', { runId, ...parsed });
      if (onPhase) {
        try { await onPhase(parsed); } catch (err) { console.error('argo onPhase:', err.message); }
      }
      lastPhase = parsed.phase;
      if (parsed.phase === 'Healthy' || parsed.phase === 'Degraded') {
        return parsed;
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { phase: lastPhase || 'TimedOut', message: 'observation timed out' };
}
