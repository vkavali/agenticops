import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { queryOne } from './db.js';
import { decrypt } from './crypto.js';
import { broadcast } from './sse.js';

// Kubernetes integration via kubectl.
//
// A cloud_connectors row with provider='kubernetes' carries a kubeconfig YAML
// in its encrypted credentials envelope (under the `kubeconfig` key). We
// write it to a temp file scoped to the call, set KUBECONFIG, run kubectl,
// then unlink. This avoids holding kubeconfigs anywhere on disk between
// invocations and means each call is fully isolated.
//
// kubectl must be on the host's PATH. If it isn't, calls fail with a clear
// error event — the rest of the system keeps working.

function spawnKubectl(args, kubeconfigPath, { stage, runId, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, KUBECONFIG: kubeconfigPath };
    const proc = spawn('kubectl', args, { env, timeout: timeoutMs });
    const logs = [];

    const onLine = (data, prefix = '') => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const out = `${prefix}${line}`;
        logs.push(out);
        if (runId) broadcast('k8s:log', { runId, stage, line: out });
      }
    };
    proc.stdout.on('data', d => onLine(d));
    proc.stderr.on('data', d => onLine(d, '[stderr] '));
    proc.on('close', (code) => resolve({ exitCode: code ?? 0, logs }));
    proc.on('error', (err) => resolve({
      exitCode: 127,
      logs: [`[error] kubectl spawn failed: ${err.message}. Is kubectl on PATH?`],
    }));
  });
}

// Decrypts the connector's credentials envelope and writes the kubeconfig to a
// temp file. Returns { kubeconfigPath, cleanup, ctx }, where ctx is whatever
// extra metadata (namespace, context) was supplied alongside the kubeconfig.
async function withKubeconfig(connector) {
  const env = typeof connector.credentials === 'string'
    ? JSON.parse(connector.credentials)
    : connector.credentials;
  const creds = env?.enc ? JSON.parse(decrypt(env.enc)) : env;
  if (!creds?.kubeconfig) {
    throw new Error('K8s connector missing `kubeconfig` in credentials');
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'aops-kube-'));
  const kubeconfigPath = path.join(dir, 'kubeconfig.yaml');
  await writeFile(kubeconfigPath, creds.kubeconfig, { mode: 0o600 });

  return {
    kubeconfigPath,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
    ctx: { namespace: creds.namespace || null, context: creds.context || null },
  };
}

function withCommonFlags(args, ctx) {
  const out = [...args];
  if (ctx.context) out.push('--context', ctx.context);
  if (ctx.namespace) out.push('-n', ctx.namespace);
  return out;
}

/** Apply a directory of manifests with `kubectl apply -k` (kustomize). */
export async function kubectlApply(connectorId, manifestDir, opts = {}) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const { kubeconfigPath, cleanup, ctx } = await withKubeconfig(conn);
  try {
    return await spawnKubectl(
      withCommonFlags(['apply', '-k', manifestDir], ctx),
      kubeconfigPath,
      { stage: 'apply', runId: opts.runId },
    );
  } finally { await cleanup(); }
}

/** Set a container image on a Deployment. */
export async function kubectlSetImage(connectorId, deployment, container, image, opts = {}) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const { kubeconfigPath, cleanup, ctx } = await withKubeconfig(conn);
  try {
    return await spawnKubectl(
      withCommonFlags(['set', 'image', `deployment/${deployment}`, `${container}=${image}`], ctx),
      kubeconfigPath,
      { stage: 'set-image', runId: opts.runId },
    );
  } finally { await cleanup(); }
}

/** Wait for a Deployment rollout to complete. Returns when status converges or times out. */
export async function kubectlRolloutStatus(connectorId, deployment, opts = {}) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const { kubeconfigPath, cleanup, ctx } = await withKubeconfig(conn);
  try {
    const timeoutSec = Math.round((opts.timeoutMs || 300000) / 1000);
    return await spawnKubectl(
      withCommonFlags(['rollout', 'status', `deployment/${deployment}`, `--timeout=${timeoutSec}s`], ctx),
      kubeconfigPath,
      { stage: 'rollout-status', runId: opts.runId, timeoutMs: opts.timeoutMs || 300000 },
    );
  } finally { await cleanup(); }
}

/** Roll a deployment back to the previous revision. */
export async function kubectlRolloutUndo(connectorId, deployment, opts = {}) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const { kubeconfigPath, cleanup, ctx } = await withKubeconfig(conn);
  try {
    return await spawnKubectl(
      withCommonFlags(['rollout', 'undo', `deployment/${deployment}`], ctx),
      kubeconfigPath,
      { stage: 'rollout-undo', runId: opts.runId },
    );
  } finally { await cleanup(); }
}

export async function kubectlVersion(connectorId) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const { kubeconfigPath, cleanup, ctx } = await withKubeconfig(conn);
  try {
    return await spawnKubectl(
      withCommonFlags(['version', '--client=true', '--output=json'], ctx),
      kubeconfigPath,
    );
  } finally { await cleanup(); }
}
