import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';

// Multi-tenancy primitive.
//
// Every Phase-7 schema row carries an `org_id` foreign key with a default of
// 'org-default'. New deployments share that default org so single-tenant
// usage works unchanged. Multi-tenant deployments mint additional `orgs`
// rows and tag tokens / OIDC configs / SCIM users to them.
//
// scopedQuery(req, sql, params) injects `AND org_id = $N` automatically when
// the query contains the marker `${ORG}` (see usage below). This is opt-in;
// existing queries continue to work without scoping until they're retrofitted.

export async function listOrgs() {
  return query('SELECT id, name, slug, created_at FROM orgs ORDER BY created_at');
}

export async function getOrg(id) {
  return queryOne('SELECT id, name, slug, created_at FROM orgs WHERE id=$1', [id]);
}

export async function createOrg({ id, name, slug }) {
  if (!name) throw new Error('name required');
  const oid = id || `org-${crypto.randomBytes(4).toString('hex')}`;
  const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await execute(
    'INSERT INTO orgs (id, name, slug, created_at) VALUES ($1,$2,$3,$4)',
    [oid, name, finalSlug, Date.now()]
  );
  return oid;
}

export async function deleteOrg(id) {
  if (id === 'org-default') throw new Error('cannot delete the default org');
  await execute('DELETE FROM orgs WHERE id=$1', [id]);
}

/**
 * Replace `${ORG}` markers in a SQL string with a positional parameter that
 * binds to req.auth.orgId. Returns the patched SQL + params array.
 *
 * Example:
 *   scopedQuery(req, 'SELECT * FROM services WHERE org_id = ${ORG}')
 *
 * For queries that need both an org filter AND user params, append the user
 * params after the marker is expanded:
 *
 *   const { sql, params } = scopedQuery(req, 'SELECT * FROM services WHERE org_id = ${ORG} AND id = $2', ['svc-1']);
 */
export function scopedQuery(req, sql, params = []) {
  const orgId = req.auth?.orgId || 'org-default';
  if (!sql.includes('${ORG}')) return { sql, params };
  // Find the next available positional parameter.
  const next = params.length + 1;
  const patched = sql.replace('${ORG}', `$${next}`);
  return { sql: patched, params: [...params, orgId] };
}

/**
 * Express middleware that asserts the authenticated principal has access to
 * the org named in :orgId path param. Most routes don't need this — they
 * scope to req.auth.orgId implicitly. Use this on cross-org admin endpoints.
 */
export function requireOrgAccess(req, res, next) {
  const requested = req.params.orgId || req.body?.org_id;
  if (!requested) return next();
  if (req.auth?.role !== 'admin' && req.auth?.orgId !== requested) {
    return res.status(403).json({ error: `No access to org ${requested}` });
  }
  next();
}
