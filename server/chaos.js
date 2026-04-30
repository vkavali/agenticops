import crypto from 'crypto';
import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';
import { createGate } from './routes/gates.js';
import { generateCrd, crdResourceRef } from './chaos-mesh.js';
import { decrypt } from './crypto.js';

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

// kubectl wrapper scoped to chaos so we can apply YAML via stdin without
// pulling in the broader k8s.js dependency graph (which is also fine, but
// chaos has slightly different needs — apply with -f - vs apply -k).
async function withKubeconfig(connectorId) {
  const conn = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [connectorId]);
  if (!conn) throw new Error('connector not found');
  const env = typeof conn.credentials === 'string' ? JSON.parse(conn.credentials) : conn.credentials;
  const creds = env?.enc ? JSON.parse(decrypt(env.enc)) : env;
  if (!creds?.kubeconfig) throw new Error('connector missing kubeconfig');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aops-chaos-'));
  const kubeconfigPath = path.join(dir, 'kubeconfig.yaml');
  await writeFile(kubeconfigPath, creds.kubeconfig, { mode: 0o600 });
  return { kubeconfigPath, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}

function spawnKubectl(args, kubeconfigPath, stdin = null) {
  return new Promise((resolve) => {
    const proc = spawn('kubectl', args, { env: { ...process.env, KUBECONFIG: kubeconfigPath }, timeout: 60_000 });
    const out = []; const err = [];
    proc.stdout.on('data', d => out.push(d.toString()));
    proc.stderr.on('data', d => err.push(d.toString()));
    proc.on('close', code => resolve({ exitCode: code ?? 0, stdout: out.join(''), stderr: err.join('') }));
    proc.on('error', e => resolve({ exitCode: 127, stdout: '', stderr: e.message }));
    if (stdin) { proc.stdin.write(stdin); proc.stdin.end(); }
  });
}

// Tiny YAML emitter for the CRD shapes we generate. Avoids pulling in a YAML
// dep just for this — the shapes are simple and well-known. kubectl also
// accepts JSON via `apply -f -`, but `kind: NetworkChaos` reads better as YAML
// in the audit log + observations.
function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  if (obj == null) return 'null';
  if (typeof obj === 'string') {
    return /[:#\-{}\[\],&*?|<>=!%@\\]|^[\s]|[\s]$/.test(obj) ? JSON.stringify(obj) : obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => `${pad}- ${
      typeof item === 'object' && item !== null
        ? '\n' + toYaml(item, indent + 1).replace(/^/gm, '  ').trimStart()
        : toYaml(item)
    }`).join('\n');
  }
  return Object.entries(obj).map(([k, v]) => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
    }
    if (Array.isArray(v) && v.length > 0) {
      return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
    }
    return `${pad}${k}: ${toYaml(v, indent + 1)}`;
  }).join('\n');
}

async function startInjection(run, experiment) {
  if (experiment.cluster_connector_id) {
    try {
      const crd = generateCrd(experiment, experiment.fault_config?.namespace || 'default');
      const yaml = toYaml(crd);
      const { kubeconfigPath, cleanup } = await withKubeconfig(experiment.cluster_connector_id);
      try {
        const r = await spawnKubectl(['apply', '-f', '-'], kubeconfigPath, yaml);
        if (r.exitCode === 0) {
          const ref = crdResourceRef(crd);
          await execute('UPDATE chaos_runs SET injected_resource=$1 WHERE id=$2',
            [`${ref.kind}/${ref.name} -n ${ref.namespace}`, run.id]);
          await appendObservation(run.id, { event: 'fault-injected', resource: ref, at: Date.now() });
          broadcast('chaos:fault-injected', { runId: run.id, resource: ref });
        } else {
          await appendObservation(run.id, { event: 'fault-inject-failed', stderr: r.stderr, at: Date.now() });
          broadcast('chaos:fault-injected', { runId: run.id, error: r.stderr });
          throw new Error(r.stderr || 'kubectl apply failed');
        }
      } finally { await cleanup(); }
      return;
    } catch (err) {
      // Fall through to simulated mode if kubectl/CRD apply fails.
      await appendObservation(run.id, { event: 'fault-inject-error', message: err.message, at: Date.now() });
    }
  }
  // Simulated path — same as before; useful for demos without a cluster.
  broadcast('chaos:fault-injected', { runId: run.id, simulated: true });
  await appendObservation(run.id, { event: 'fault-injected', simulated: true, at: Date.now() });
}

async function clearInjection(run, reason, experiment) {
  if (experiment?.cluster_connector_id && run.injected_resource) {
    try {
      // Format we stored: "Kind/name -n namespace"
      const m = run.injected_resource.match(/^(\S+)\/(\S+)\s+-n\s+(\S+)$/);
      if (m) {
        const [, kind, name, namespace] = m;
        const { kubeconfigPath, cleanup } = await withKubeconfig(experiment.cluster_connector_id);
        try {
          await spawnKubectl(['delete', kind, name, '-n', namespace, '--ignore-not-found'], kubeconfigPath);
        } finally { await cleanup(); }
      }
    } catch (err) {
      await appendObservation(run.id, { event: 'fault-clear-error', message: err.message, at: Date.now() });
    }
  }
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
    await startInjection(run, exp);
    const startedAt = Date.now();
    const durationMs = Number(exp.duration_ms);

    const tick = setInterval(async () => {
      try {
        const reason = await checkAbortConditions(run, exp);
        if (reason) {
          // Re-read the run so we pick up injected_resource set by startInjection.
          const fresh = await queryOne('SELECT * FROM chaos_runs WHERE id=$1', [runId]);
          await clearInjection(fresh || run, reason, exp);
          await finishRun(runId, 'aborted', reason);
          return;
        }
        if (Date.now() - startedAt >= durationMs) {
          const fresh = await queryOne('SELECT * FROM chaos_runs WHERE id=$1', [runId]);
          await clearInjection(fresh || run, 'duration-elapsed', exp);
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
  const exp = await queryOne('SELECT * FROM chaos_experiments WHERE id=$1', [run.experiment_id]);
  await clearInjection(run, reason, exp);
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
