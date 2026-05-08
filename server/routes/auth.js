import { Router } from 'express';
import crypto from 'crypto';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { query, queryOne, execute } from '../db.js';
import { mintToken, revokeToken } from '../auth.js';
import { record } from '../audit.js';

// User-facing login flows: GitHub OAuth + OIDC authorization-code-with-PKCE.
//
// The Phase-0 bearer-token system stays as the API-of-record. This router
// just gives end users a way to *obtain* a bearer token without copy-pasting.
// A successful login mints (or replaces) an api_tokens row for the user and
// redirects to the SPA with `#token=<raw>` in the URL fragment, which the
// TokenGate extracts and stores in localStorage.
//
// Role assignment for each method:
//   GitHub: env vars GITHUB_ADMIN_USERS, GITHUB_OPERATOR_USERS (comma list).
//           Anyone else gets `viewer`. Set GITHUB_ALLOWED_USERS to lock the
//           gate to a specific list (deny others).
//   OIDC:   the existing oidc.js role derivation — direct claim or
//           group_role_map.

const router = Router();

const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_API = 'https://api.github.com';

// In-process state cache for OAuth round-trips. 10-minute TTL — long enough
// for human auth, short enough that abandoned flows don't accumulate.
const stateCache = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;
function rememberState(state, payload) {
  stateCache.set(state, { payload, expiresAt: Date.now() + STATE_TTL_MS });
}
function consumeState(state) {
  const entry = stateCache.get(state);
  if (!entry) return null;
  stateCache.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry.payload;
}
// Periodic GC.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateCache) if (v.expiresAt < now) stateCache.delete(k);
}, 60 * 1000).unref?.();

function appBase(req) {
  if (APP_URL) return APP_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// ── /api/auth/methods ────────────────────────────────────────────────
// Public endpoint the TokenGate hits to render its login buttons. Lists
// every working method. Token-paste is always available; it's not in this
// list since the UI shows it as a fallback.
router.get('/methods', async (req, res) => {
  const methods = [];
  if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
    methods.push({ kind: 'github', label: 'Sign in with GitHub' });
  }
  const oidc = await query(
    'SELECT id, issuer, client_id FROM oidc_configs WHERE enabled = true ORDER BY issuer'
  );
  for (const cfg of oidc) {
    let label = `Sign in with ${new URL(cfg.issuer).hostname}`;
    methods.push({ kind: 'oidc', label, config_id: cfg.id });
  }
  res.json({ methods });
});

// ── GitHub OAuth login ───────────────────────────────────────────────
function roleForGithubUser(login) {
  const allow = (process.env.GITHUB_ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(login)) return null; // explicit deny

  const admins = (process.env.GITHUB_ADMIN_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  const operators = (process.env.GITHUB_OPERATOR_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (admins.includes(login)) return 'admin';
  if (operators.includes(login)) return 'operator';
  return 'viewer';
}
// Exported for unit tests.
export { roleForGithubUser };

router.get('/github/start', async (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(503).send('GitHub login not configured');
  const state = `gh-${crypto.randomBytes(16).toString('hex')}`;
  rememberState(state, { kind: 'github' });
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${appBase(req)}/api/auth/github/callback`,
    scope: 'read:user',
    state,
    allow_signup: 'false',
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!consumeState(state)) return res.status(400).send('Invalid or expired state');

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('GitHub auth failed');

    const userRes = await fetch(`${GITHUB_API}/user`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'AgenticOps' },
    });
    const user = await userRes.json();
    if (!user.login) return res.status(400).send('Could not read GitHub user');

    const role = roleForGithubUser(user.login);
    if (!role) {
      // Explicit denylist hit.
      return res
        .status(403)
        .type('text/html')
        .send(`<!doctype html><body style="font:14px monospace;padding:2rem">
          <h2>${user.login} is not authorized</h2>
          <p>Ask an admin to add you to <code>GITHUB_ALLOWED_USERS</code>.</p>
          <p><a href="/">← back</a></p></body>`);
    }

    // Replace any existing api_tokens row for this GitHub user so they always
    // have exactly one active token. Keeps the pool clean.
    const label = `github:${user.login}`;
    const existing = await query('SELECT id FROM api_tokens WHERE label=$1', [label]);
    for (const row of existing) await revokeToken(row.id);

    const { token } = await mintToken(role, label);
    await record({ actor: label, action: 'login:github', detail: { role, github_id: user.id } });

    // Hand the token to the SPA via URL fragment — fragments are not sent
    // to the server, only readable by client JS. The TokenGate extracts +
    // strips it on mount.
    res.redirect(`${appBase(req)}/#token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('GitHub login error:', err);
    res.status(500).send('GitHub login failed');
  }
});

// ── OIDC authorization-code-with-PKCE login ──────────────────────────
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function discoverIssuer(issuer) {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} from ${url}`);
  return res.json();
}

router.get('/oidc/start/:configId', async (req, res) => {
  const cfg = await queryOne('SELECT * FROM oidc_configs WHERE id=$1 AND enabled=true', [req.params.configId]);
  if (!cfg) return res.status(404).send('OIDC config not found');

  let discovery;
  try { discovery = await discoverIssuer(cfg.issuer); }
  catch (err) { return res.status(502).send(err.message); }

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = `oidc-${crypto.randomBytes(16).toString('hex')}`;
  rememberState(state, { kind: 'oidc', configId: cfg.id, verifier });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.client_id,
    redirect_uri: `${appBase(req)}/api/auth/oidc/callback`,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`${discovery.authorization_endpoint}?${params}`);
});

router.get('/oidc/callback', async (req, res) => {
  const { code, state } = req.query;
  const cached = consumeState(state);
  if (!cached || cached.kind !== 'oidc') return res.status(400).send('Invalid or expired state');

  const cfg = await queryOne('SELECT * FROM oidc_configs WHERE id=$1', [cached.configId]);
  if (!cfg) return res.status(400).send('OIDC config gone');

  let discovery;
  try { discovery = await discoverIssuer(cfg.issuer); }
  catch (err) { return res.status(502).send(err.message); }

  // Exchange auth code for tokens. PKCE verifier is sent — public clients
  // (no client_secret) and confidential clients both work; we send the
  // client_secret only if the issuer requires it (basic/post auth method).
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${appBase(req)}/api/auth/oidc/callback`,
    client_id: cfg.client_id,
    code_verifier: cached.verifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  // Some IdPs (Auth0, Okta classic confidential clients) require basic auth
  // with the client secret. We allow it via env var per-config. Skipped if
  // not configured (PKCE-only public-client flow).
  const secretEnvKey = `OIDC_CLIENT_SECRET_${cfg.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const secret = process.env[secretEnvKey];
  if (secret) {
    headers.Authorization = 'Basic ' + Buffer.from(`${cfg.client_id}:${secret}`).toString('base64');
  }

  let tokenJson;
  try {
    const tr = await fetch(discovery.token_endpoint, { method: 'POST', headers, body });
    tokenJson = await tr.json();
    if (!tr.ok || !tokenJson.id_token) {
      return res.status(400).send(`OIDC token exchange failed: ${JSON.stringify(tokenJson)}`);
    }
  } catch (err) {
    return res.status(502).send(`OIDC token endpoint unreachable: ${err.message}`);
  }

  // Verify the ID token against the issuer's JWKS (same machinery as
  // server/oidc.js#tryOidcAuth uses for runtime requests).
  const jwksUrl = new URL(discovery.jwks_uri || `${cfg.issuer}/.well-known/jwks.json`);
  const jwks = createRemoteJWKSet(jwksUrl);
  let payload;
  try {
    const verified = await jwtVerify(tokenJson.id_token, jwks, {
      issuer: cfg.issuer,
      audience: cfg.audience || cfg.client_id,
    });
    payload = verified.payload;
  } catch (err) {
    return res.status(401).send(`ID token invalid: ${err.message}`);
  }

  // The runtime auth path verifies the JWT directly against JWKS on every
  // request. So we hand the raw ID token to the SPA — no AgenticOps token
  // mint needed. Server-side request verification still works.
  await record({
    actor: payload.email || payload.preferred_username || payload.sub,
    action: 'login:oidc',
    target: cfg.id,
    detail: { issuer: cfg.issuer },
  });
  res.redirect(`${appBase(req)}/#token=${encodeURIComponent(tokenJson.id_token)}`);
});

export default router;
