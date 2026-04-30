import { spawn } from 'child_process';
import { mkdtemp, rm, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { query, queryOne, execute } from './db.js';
import { decrypt } from './crypto.js';
import { broadcast } from './sse.js';

// Backstage-style catalog import.
//
// Walks each connected_repo, looks for `catalog-info.yaml` at root, parses it,
// and merges fields into the matching `services` row by name. Supports the
// minimal Backstage Component spec — kind: Component, plus the spec fields
// we care about (owner, system, lifecycle, type, dependsOn).
//
// Falls back gracefully on parse errors or missing files: per-repo failures
// are logged but don't abort the sweep.

const SWEEP_INTERVAL = 30 * 60 * 1000; // 30 min

function spawnGit(args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd, timeout: 60_000 });
    const out = []; const err = [];
    proc.stdout.on('data', d => out.push(d.toString()));
    proc.stderr.on('data', d => err.push(d.toString()));
    proc.on('close', code => resolve({ exitCode: code ?? 0, stdout: out.join(''), stderr: err.join('') }));
    proc.on('error', e => resolve({ exitCode: 127, stdout: '', stderr: e.message }));
  });
}

/**
 * Parse a Backstage Component spec into our services schema. Pure function —
 * exported separately for testing.
 *
 * Returns { name, updates } where updates is the patch we'll apply to the
 * services row. null when the document isn't a Component or has no name.
 */
export function parseCatalogInfo(doc) {
  if (!doc || doc.kind !== 'Component') return null;
  const name = doc.metadata?.name;
  if (!name) return null;
  const spec = doc.spec || {};
  const meta = doc.metadata || {};

  // Pass through the standard Backstage fields and tuck the rest into metadata.
  const updates = {
    owner: spec.owner || null,
    tier: spec.lifecycle || null,
    metadata: {
      backstage: {
        type: spec.type || null,
        system: spec.system || null,
        domain: spec.domain || null,
        description: meta.description || null,
        tags: meta.tags || [],
        links: meta.links || [],
        depends_on: spec.dependsOn || [],
        provides_apis: spec.providesApis || [],
        consumes_apis: spec.consumesApis || [],
      },
      annotations: meta.annotations || {},
    },
  };
  return { name, updates };
}

async function importFromRepo(repoFullName, accessToken) {
  const cloneUrl = accessToken
    ? `https://x-access-token:${accessToken}@github.com/${repoFullName}.git`
    : `https://github.com/${repoFullName}.git`;
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'aops-cat-'));
  try {
    const r = await spawnGit(['clone', '--depth', '1', cloneUrl, '.'], workDir);
    if (r.exitCode !== 0) return { ok: false, error: 'clone failed', repo: repoFullName };

    let body;
    try { body = await readFile(path.join(workDir, 'catalog-info.yaml'), 'utf8'); }
    catch { return { ok: false, error: 'no catalog-info.yaml at repo root', repo: repoFullName }; }

    const docs = yaml.loadAll(body).filter(Boolean);
    const imported = [];
    for (const doc of docs) {
      const parsed = parseCatalogInfo(doc);
      if (!parsed) continue;
      const svc = await queryOne('SELECT id FROM services WHERE name=$1 LIMIT 1', [parsed.name]);
      if (!svc) {
        // Catalog entry references a service not in our DB — skip silently.
        // Could auto-create, but that mixes intent with import; leave it to
        // an operator to add the service first.
        continue;
      }
      const u = parsed.updates;
      await execute(
        `UPDATE services SET
           owner=COALESCE($1, owner),
           tier=COALESCE($2, tier),
           repo_full_name=COALESCE($3, repo_full_name),
           metadata=COALESCE(metadata, '{}'::jsonb) || $4::jsonb
         WHERE id=$5`,
        [u.owner, u.tier, repoFullName, JSON.stringify(u.metadata), svc.id]
      );
      imported.push(parsed.name);
    }
    if (imported.length > 0) {
      broadcast('idp:catalog-imported', { repo: repoFullName, services: imported });
    }
    return { ok: true, repo: repoFullName, imported };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function importAll() {
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  const token = conn?.access_token ? decrypt(conn.access_token) : null;
  const repos = await query('SELECT repo_full_name FROM connected_repos');
  const results = [];
  for (const r of repos) {
    try { results.push(await importFromRepo(r.repo_full_name, token)); }
    catch (err) { results.push({ ok: false, repo: r.repo_full_name, error: err.message }); }
  }
  return results;
}

export async function importOneRepo(repoFullName) {
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  const token = conn?.access_token ? decrypt(conn.access_token) : null;
  return importFromRepo(repoFullName, token);
}

export function startCatalogSweep() {
  setInterval(() => {
    importAll().catch(err => console.error('Catalog import sweep:', err.message));
  }, SWEEP_INTERVAL);
  console.log('✓ Catalog import sweep started');
}
