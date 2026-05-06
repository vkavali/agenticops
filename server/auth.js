import crypto from 'crypto';
import { queryOne, execute } from './db.js';

// Bearer-token auth + RBAC.
// Tokens live in the api_tokens table. Hash-only storage (sha256, no plaintext).
// Roles: viewer < operator < admin.
// Bootstrap: if APP_BOOTSTRAP_ADMIN_TOKEN is set and no admin token exists, it is
// installed as the initial admin token on first boot.

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function bootstrapAdmin() {
  const existing = await queryOne("SELECT id FROM api_tokens WHERE role='admin' LIMIT 1");
  if (existing) return;
  const raw = process.env.APP_BOOTSTRAP_ADMIN_TOKEN;
  if (!raw) {
    console.warn('⚠ No admin token configured. Set APP_BOOTSTRAP_ADMIN_TOKEN to enable admin access.');
    return;
  }
  await execute(
    'INSERT INTO api_tokens (token_hash, role, label, created_at) VALUES ($1,$2,$3,$4)',
    [hashToken(raw), 'admin', 'bootstrap', Date.now()]
  );
  console.log('✓ Bootstrap admin token installed');
}

function extractToken(req) {
  const h = req.headers.authorization;
  if (!h) return null;
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

// Middleware: attaches req.auth = { tokenId, role, label, orgId } or 401s.
//
// Auth resolution order:
//   1. Try OIDC JWT verification (jose against the issuer's JWKS) when the
//      token looks like a JWT and a matching oidc_configs row exists.
//   2. Fall back to api_tokens lookup (sha256 hash match).
//
// This lets enterprises hand out IdP-issued JWTs without minting AgenticOps-
// specific tokens, while keeping the simple bearer-token path working for
// CI / scripts / self-host.
export function requireAuth(minRole = 'viewer') {
  const minRank = ROLE_RANK[minRole];
  if (!minRank) throw new Error(`Unknown role: ${minRole}`);

  return async (req, res, next) => {
    const raw = extractToken(req);
    if (!raw) return res.status(401).json({ error: 'Missing bearer token' });

    // 1. OIDC JWT path
    let auth = null;
    try {
      const { tryOidcAuth } = await import('./oidc.js');
      auth = await tryOidcAuth(raw);
    } catch (err) {
      // Issuer reachable failure shouldn't surface to viewers as a 500;
      // log and fall through to api_tokens.
      console.warn('OIDC auth attempt failed:', err.message);
    }

    // 2. api_tokens fallback
    if (!auth) {
      const row = await queryOne(
        'SELECT id, role, label, org_id FROM api_tokens WHERE token_hash=$1',
        [hashToken(raw)]
      );
      if (!row) return res.status(401).json({ error: 'Invalid token' });
      auth = { tokenId: row.id, role: row.role, label: row.label, orgId: row.org_id || 'org-default' };
    }

    if (ROLE_RANK[auth.role] < minRank) {
      return res.status(403).json({ error: `Requires role ${minRole}, token has ${auth.role}` });
    }

    req.auth = auth;
    next();
  };
}

// Mints a new token. Returns { token, id } — token is shown once, never stored.
export async function mintToken(role, label) {
  if (!ROLE_RANK[role]) throw new Error(`Unknown role: ${role}`);
  const raw = `aops_${crypto.randomBytes(24).toString('base64url')}`;
  const result = await execute(
    'INSERT INTO api_tokens (token_hash, role, label, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
    [hashToken(raw), role, label || null, Date.now()]
  );
  return { token: raw, id: result.rows[0].id };
}

export async function revokeToken(id) {
  await execute('DELETE FROM api_tokens WHERE id=$1', [id]);
}

export async function listTokens() {
  const { query } = await import('./db.js');
  return query('SELECT id, role, label, created_at FROM api_tokens ORDER BY created_at DESC');
}
