import { spawn } from 'child_process';
import { mkdtemp, rm, readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';
import { decrypt } from './crypto.js';
import { kubectlApply } from './k8s.js';

// GitOps sync loop.
//
// Each `gitops_app` declares (repo, manifest_path, target_cluster). The sweep
// clones the repo at HEAD, hashes the manifest tree, and compares with the
// last_sync_revision. When it differs, we record a sync entry and emit an
// event. Real apply requires kubectl/helm against the target cluster — we
// stub it by emitting `gitops:sync-applied` so the rest of the system can
// react. Plug in a real K8s client to make it production-real.

const SWEEP_INTERVAL = 60 * 1000;

function spawnCmd(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, timeout: 120000 });
    const out = []; const err = [];
    proc.stdout.on('data', d => out.push(d.toString()));
    proc.stderr.on('data', d => err.push(d.toString()));
    proc.on('close', code => resolve({ code: code ?? 0, stdout: out.join(''), stderr: err.join('') }));
    proc.on('error', e => resolve({ code: 1, stdout: '', stderr: e.message }));
  });
}

async function hashTree(dir) {
  const h = crypto.createHash('sha256');
  async function walk(p, rel) {
    const entries = await readdir(p, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.git')) continue;
      const abs = path.join(p, e.name);
      const r = path.join(rel, e.name);
      if (e.isDirectory()) await walk(abs, r);
      else if (/\.(ya?ml|json|tpl|tmpl)$/.test(e.name)) {
        const body = await readFile(abs, 'utf8');
        h.update(`${r}\0${body}\0`);
      }
    }
  }
  await walk(dir, '');
  return h.digest('hex');
}

async function syncApp(app) {
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  if (!conn?.access_token) return;
  const token = decrypt(conn.access_token);
  const syncId = `sync-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const startedAt = Date.now();

  await execute(
    `INSERT INTO gitops_syncs (id, app_id, status, started_at) VALUES ($1,$2,'running',$3)`,
    [syncId, app.id, startedAt]
  );

  let workDir = null;
  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'aops-gitops-'));
    const cloneUrl = `https://x-access-token:${token}@github.com/${app.repo_full_name}.git`;
    let r = await spawnCmd('git', ['clone', '--depth', '1', cloneUrl, '.'], workDir);
    if (r.code !== 0) throw new Error('clone failed');

    const sha = (await spawnCmd('git', ['rev-parse', 'HEAD'], workDir)).stdout.trim();
    const manifestDir = path.join(workDir, app.manifest_path || '.');
    await stat(manifestDir).catch(() => { throw new Error('manifest_path not found'); });

    const treeHash = await hashTree(manifestDir);
    const drift = app.last_sync_revision && app.last_sync_revision !== treeHash;

    let status = drift ? 'drift-detected' : 'in-sync';
    let applyChanges = [];
    if (app.auto_sync && drift) {
      if (app.cluster_connector_id) {
        // Real apply against the linked K8s connector.
        const result = await kubectlApply(app.cluster_connector_id, manifestDir, { runId: syncId });
        if (result.exitCode === 0) {
          status = 'synced';
          applyChanges = result.logs.filter(l => /(created|configured|unchanged|deleted)$/.test(l));
          broadcast('gitops:sync-applied', { app_id: app.id, sync_id: syncId, sha, applied: applyChanges.length });
        } else {
          status = 'failed';
          broadcast('gitops:sync-applied', { app_id: app.id, sync_id: syncId, sha, error: 'kubectl apply failed' });
        }
      } else {
        // No cluster connector — emit the event and let an external operator
        // wire in a real apply. Useful for demos without a cluster.
        broadcast('gitops:sync-applied', { app_id: app.id, sync_id: syncId, sha, target_cluster: app.target_cluster, simulated: true });
        status = 'synced';
      }
    }

    await execute(
      `UPDATE gitops_syncs SET status=$1, drift_detected=$2, revision=$3, changes=$4, finished_at=$5 WHERE id=$6`,
      [status, drift, treeHash, JSON.stringify(applyChanges.slice(0, 50)), Date.now(), syncId]
    );
    await execute(
      `UPDATE gitops_apps SET last_sync_at=$1, last_sync_status=$2, last_sync_revision=$3 WHERE id=$4`,
      [Date.now(), status, treeHash, app.id]
    );
    broadcast('gitops:sync-finished', { app_id: app.id, id: syncId, status, drift_detected: drift, sha });
    if (drift) {
      await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
        [`GitOps drift: ${app.name} ${app.auto_sync ? 'auto-synced' : 'awaiting sync'}`, 'gitops', Date.now()]);
    }
  } catch (err) {
    await execute(
      `UPDATE gitops_syncs SET status='failed', finished_at=$1 WHERE id=$2`,
      [Date.now(), syncId]
    );
    await execute(
      `UPDATE gitops_apps SET last_sync_at=$1, last_sync_status='failed' WHERE id=$2`,
      [Date.now(), app.id]
    );
    broadcast('gitops:sync-finished', { app_id: app.id, id: syncId, status: 'failed', error: err.message });
  } finally {
    if (workDir) { try { await rm(workDir, { recursive: true, force: true }); } catch {} }
  }
}

export async function syncAll(forceAll = false) {
  const apps = await query('SELECT * FROM gitops_apps');
  const now = Date.now();
  for (const app of apps) {
    const last = app.last_sync_at ? Number(app.last_sync_at) : 0;
    const interval = Number(app.sync_interval_ms || 300000);
    if (forceAll || (now - last) >= interval) {
      await syncApp(app).catch(err => console.error(`GitOps sync ${app.id}:`, err.message));
    }
  }
}

export async function syncOne(appId) {
  const app = await queryOne('SELECT * FROM gitops_apps WHERE id=$1', [appId]);
  if (!app) throw new Error('app not found');
  await syncApp(app);
}

export function startGitOpsSweep() {
  setInterval(() => {
    syncAll().catch(err => console.error('GitOps sweep:', err.message));
  }, SWEEP_INTERVAL);
  console.log('✓ GitOps sweep started');
}
