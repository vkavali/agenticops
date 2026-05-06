import { createRemoteJWKSet, jwtVerify } from 'jose';
import { query, queryOne, execute } from './db.js';

// OIDC SSO middleware. Lives alongside the bearer-token auth from Phase 0 —
// when a request carries `Authorization: Bearer <jwt>`, we try to verify it
// against any configured OIDC issuer's JWKS first; if that fails or no OIDC
// config exists, we fall back to the existing api_tokens lookup.
//
// Rationale: enterprises hand out JWTs from Okta / Azure AD / Auth0; we
// shouldn't make them mint a separate AgenticOps token. Self-hosted ops still
// works — the JWKS verifier no-ops when no oidc_configs row exists.

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

// Cache JWKS sets per-issuer for the lifetime of the process. jose's helper
// already does its own per-jwks caching; this map just dedupes the lookup.
const jwksCache = new Map();
function jwksFor(issuer) {
  let jwks = jwksCache.get(issuer);
  if (jwks) return jwks;
  // jose's createRemoteJWKSet handles refresh + caching internally. We append
  // a standard discovery suffix; if your IdP needs a different path, store
  // the full URL in oidc_configs.issuer.
  const url = issuer.endsWith('/.well-known/jwks.json')
    ? new URL(issuer)
    : new URL(`${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`);
  jwks = createRemoteJWKSet(url);
  jwksCache.set(issuer, jwks);
  return jwks;
}

function deriveRole(payload, cfg) {
  // Direct role claim wins.
  if (payload[cfg.role_claim]) return payload[cfg.role_claim];
  // Otherwise map first matching group → role.
  const groups = payload[cfg.groups_claim] || [];
  const map = cfg.group_role_map || {};
  for (const g of (Array.isArray(groups) ? groups : [groups])) {
    if (map[g]) return map[g];
  }
  return 'viewer'; // safe default
}

/**
 * Try to authenticate a JWT against any configured OIDC issuer.
 * Returns { tokenId, role, label, orgId, claims } on success, null otherwise.
 * The label is the JWT's `sub` so audit logs name a real user.
 */
export async function tryOidcAuth(rawJwt) {
  if (!rawJwt) return null;
  // JWT format: three base64url segments separated by dots. Reject anything
  // that doesn't look like a JWT before paying for a DB lookup.
  if (rawJwt.split('.').length !== 3) return null;

  // Get issuer from the unverified payload — we need it to pick the JWKS,
  // but we'll re-verify the issuer claim inside jwtVerify so this is safe.
  let unverifiedIssuer;
  try {
    const [, payloadB64] = rawJwt.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    unverifiedIssuer = payload.iss;
  } catch { return null; }
  if (!unverifiedIssuer) return null;

  const cfg = await queryOne(
    'SELECT * FROM oidc_configs WHERE issuer=$1 AND enabled=true LIMIT 1',
    [unverifiedIssuer]
  );
  if (!cfg) return null;

  try {
    const { payload } = await jwtVerify(rawJwt, jwksFor(cfg.issuer), {
      issuer: cfg.issuer,
      audience: cfg.audience || cfg.client_id,
    });
    return {
      tokenId: `oidc:${cfg.id}:${payload.sub}`,
      role: deriveRole(payload, cfg),
      label: payload.email || payload.preferred_username || payload.sub,
      orgId: cfg.org_id,
      claims: payload,
    };
  } catch {
    // Signature / iss / aud / expiry mismatch — fall back to bearer-token path.
    return null;
  }
}

export async function listOidcConfigs() {
  return query('SELECT id, org_id, issuer, client_id, audience, role_claim, groups_claim, group_role_map, enabled, created_at FROM oidc_configs ORDER BY issuer');
}

export async function createOidcConfig({ id, org_id, issuer, client_id, audience, role_claim, groups_claim, group_role_map }) {
  const cid = id || `oidc-${Date.now()}`;
  await execute(
    `INSERT INTO oidc_configs (id, org_id, issuer, client_id, audience, role_claim, groups_claim, group_role_map, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cid, org_id || 'org-default', issuer, client_id, audience || null,
     role_claim || 'role', groups_claim || 'groups',
     JSON.stringify(group_role_map || {}), Date.now()]
  );
  return cid;
}

export async function deleteOidcConfig(id) {
  await execute('DELETE FROM oidc_configs WHERE id=$1', [id]);
}

export { ROLE_RANK };
