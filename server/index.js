import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { seed, cleanSeedData } from './seed.js';
import { addClient } from './sse.js';
import { startSimulation } from './simulation.js';
import { startMonitoring } from './monitor.js';
import { bootstrapAdmin, requireAuth } from './auth.js';
import { auditMiddleware, startAuditRetentionSweep } from './audit.js';
import { migrateSecretsAtRest } from './migrate-secrets.js';
import { onGateDecided } from './routes/gates.js';
import { onGateDecision as strategyOnGate } from './strategy.js';
import servicesRouter from './routes/services.js';
import pipelinesRouter from './routes/pipelines.js';
import deploymentsRouter from './routes/deployments.js';
import incidentsRouter from './routes/incidents.js';
import infrastructureRouter from './routes/infrastructure.js';
import settingsRouter from './routes/settings.js';
import activityRouter from './routes/activity.js';
import githubRouter from './routes/github.js';
import metricsRouter from './routes/metrics.js';
import cloudRouter from './routes/cloud.js';
import tokensRouter from './routes/tokens.js';
import gatesRouter from './routes/gates.js';
import auditRouter from './routes/audit.js';
import templatesRouter from './routes/templates.js';
import artifactsRouter from './routes/artifacts.js';
import iacRouter, { onGateDecision as iacOnGate } from './routes/iac.js';
import { startDriftSweep } from './iac.js';
import slosRouter from './routes/slos.js';
import { startSloEvaluator } from './slo.js';
import flagsRouter from './routes/flags.js';
import { startRolloutController } from './flags.js';
import costRouter from './routes/cost.js';
import { startCostSweep, seedSyntheticCosts } from './cost.js';
import { startAwsCostPoller } from './cost-aws.js';
import { startGcpCostPoller } from './cost-gcp.js';
import { startAzureCostPoller } from './cost-azure.js';
import { startCatalogSweep } from './catalog-import.js';
import chaosRouter from './routes/chaos.js';
import { onGateDecision as chaosOnGate } from './chaos.js';
import idpRouter from './routes/idp.js';
import { startScorecardSweep } from './idp.js';
import securityRouter from './routes/security.js';
import gitopsRouter from './routes/gitops.js';
import { startGitOpsSweep } from './gitops.js';
import dbopsRouter from './routes/dbops.js';
import oidcRouter from './routes/oidc.js';
import orgsRouter from './routes/orgs.js';
import integrationsRouter from './routes/integrations.js';
import scimRouter from './routes/scim.js';
import canaryRouter from './routes/canary.js';
import authRouter from './routes/auth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway / proxy headers so req.protocol reflects the public scheme.
app.set('trust proxy', true);

// CORS allowlist. Built from three sources, in priority order:
//   1. Same-origin: Origin matches the request's own host (always allowed).
//      This is the path that just-works behind Railway / Fly / Vercel without
//      any config — the frontend and API live on the same domain.
//   2. Auto-detected platform domains: RAILWAY_PUBLIC_DOMAIN + APP_URL.
//   3. Manual allowlist: APP_CORS_ORIGINS (comma-separated) for additional
//      cross-origin clients (separate frontend, mobile app, etc.).
//
// We custom-handle CORS instead of using the `cors` middleware so the same-
// origin check can read the request's Host header (which the cors middleware
// doesn't expose to its origin callback).
const manualOrigins = (process.env.APP_CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);
const platformOrigins = [
  process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
  process.env.APP_URL && process.env.APP_URL.replace(/\/+$/, ''),
].filter(Boolean);
const allowlist = new Set([...manualOrigins, ...platformOrigins]);
console.log(`✓ CORS allowlist (in addition to same-origin): ${[...allowlist].join(', ') || '(none)'}`);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next(); // not a CORS request — curl, server-to-server, etc.

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const sameOrigin = origin === `${proto}://${host}`;

  if (sameOrigin || allowlist.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'authorization,content-type');
      res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method'] || 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    return next();
  }

  // Non-allowlisted origin — pass through WITHOUT CORS headers. The browser
  // will block the JS from reading the response (correct, that's the point of
  // CORS), but server-to-server tooling (health checks, monitoring, curl with
  // -H Origin) still gets a normal response. Returning 403 here was wrong:
  // it broke health checks and any client that happens to send Origin headers
  // server-side.
  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // preflight from a non-allowed origin: 204 no-headers; browser blocks
  }
  next();
});

// Capture raw body for webhook HMAC verification.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
  limit: '1mb',
}));

// Routes that bypass bearer auth (each has its own auth model).
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/events',          // SSE — auth via ?token= param inside addClient
  '/api/github/callback', // OAuth redirect, validated by state
  '/api/github/webhook',  // GitHub HMAC-signed
  '/api/auth/methods',    // pre-login: list available login flows
]);

// Auth start/callback paths that are public (OAuth round-trip). Express paths
// can include params, so we test by prefix on these instead of exact match.
// /api/github/callback is shared between repo-connect and login flows;
// it's already in PUBLIC_PATHS above.
const PUBLIC_PREFIXES = [
  '/api/auth/github/start',
  '/api/auth/oidc/',
  '/api/integrations/pagerduty/webhook',
];

// Global auth gate: every /api/* call needs at least viewer, except public paths.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();
  return requireAuth('viewer')(req, res, next);
});

// Audit log: append-only record of every successful mutation.
app.use(auditMiddleware);

// API routes
app.use('/api/services', servicesRouter);
app.use('/api/pipelines', pipelinesRouter);
app.use('/api/deployments', deploymentsRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/infrastructure', infrastructureRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/github', githubRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/gates', gatesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/iac', iacRouter);
app.use('/api/slos', slosRouter);
app.use('/api/flags', flagsRouter);
app.use('/api/cost', costRouter);
app.use('/api/chaos', chaosRouter);
app.use('/api/idp', idpRouter);
app.use('/api/security', securityRouter);
app.use('/api/gitops', gitopsRouter);
app.use('/api/dbops', dbopsRouter);
app.use('/api/oidc', oidcRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/scim', scimRouter);
app.use('/api/canary', canaryRouter);
app.use('/api/auth', authRouter);

// SSE endpoint (auth handled inside addClient)
app.get('/api/events', (req, res) => { addClient(req, res); });

// Health check (public)
app.get('/api/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime() }); });

// Identity endpoint — returns the authenticated token's role/label.
app.get('/api/auth/me', (req, res) => {
  res.json({ role: req.auth.role, label: req.auth.label, tokenId: req.auth.tokenId });
});

// Admin: wipe demo seed data so the operator can populate the system with
// real services, pipelines, incidents, etc. Append-only audit + auth tables
// are preserved (see seed.js DEMO_TABLES). Requires admin role.
app.post('/api/admin/reset-demo', requireAuth('admin'), async (req, res) => {
  try {
    await cleanSeedData();
    res.json({ ok: true });
  } catch (err) {
    console.error('reset-demo failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve production build
const distPath = path.resolve(__dirname, '..', 'dist');
const { existsSync } = await import('fs');
if (!existsSync(path.join(distPath, 'index.html'))) {
  console.warn(`⚠ dist/index.html missing at ${distPath} — frontend will 404. Run \`npm run build\`.`);
}
app.use(express.static(distPath));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      // Make the failure mode obvious instead of silently sending a blank page.
      res.status(500).type('text/html').send(
        `<!doctype html><html><body style="font:14px monospace;padding:2rem">
         <h2>AgenticOps frontend not built</h2>
         <p><code>dist/index.html</code> missing on the server.</p>
         <p>Run <code>npm run build</code> in the deploy environment.</p>
         </body></html>`
      );
    }
  });
});

// Boot
async function start() {
  try {
    console.log(`→ initDb (DATABASE_URL ${process.env.DATABASE_URL ? 'set' : 'MISSING'})`);
    await initDb();
    console.log('✓ initDb');
    // The migrations + seeds below are best-effort. We never let a single
    // step (e.g. seedSyntheticCosts hitting a transient error) prevent the
    // server from listening — Railway healthcheck targets /api/health, and
    // the app must respond on that port even if a sweeper is sad. Each step
    // logs its name BEFORE running so the deploy log tells us exactly where
    // a real crash happens.
    const step = async (name, fn) => {
      try { console.log(`→ ${name}`); await fn(); console.log(`✓ ${name}`); }
      catch (err) { console.error(`✗ ${name} failed (continuing): ${err.message}`); }
    };

    await step('migrateSecretsAtRest', migrateSecretsAtRest);
    await step('bootstrapAdmin', bootstrapAdmin);
    await step('seed', seed);
    if (process.env.DISABLE_SEED !== 'true' && process.env.DISABLE_SEED !== '1') {
      await step('seedSyntheticCosts', seedSyntheticCosts);
    }

    onGateDecided(strategyOnGate);
    onGateDecided(iacOnGate);
    onGateDecided(chaosOnGate);

    // Background loops: each handles its own internal errors. Don't await
    // — they're setInterval registrations.
    //
    // The simulation engine (server/simulation.js) generates synthetic
    // metrics + occasional fake incidents to make the demo feel alive when
    // there are no real services connected. In a real deployment with
    // health_url-configured services, the monitor + SLO evaluator produce
    // real signal — set DISABLE_SIMULATION=true to silence the synthetic
    // fluctuations.
    if (process.env.DISABLE_SIMULATION !== 'true' && process.env.DISABLE_SIMULATION !== '1') {
      try { startSimulation(); } catch (e) { console.error('startSimulation:', e.message); }
    } else {
      console.log('✓ Simulation skipped (DISABLE_SIMULATION=true)');
    }
    try { startMonitoring(); } catch (e) { console.error('startMonitoring:', e.message); }
    try { startDriftSweep(); } catch (e) { console.error('startDriftSweep:', e.message); }
    try { startSloEvaluator(); } catch (e) { console.error('startSloEvaluator:', e.message); }
    try { startRolloutController(); } catch (e) { console.error('startRolloutController:', e.message); }
    try { startCostSweep(); } catch (e) { console.error('startCostSweep:', e.message); }
    try { startAwsCostPoller(); } catch (e) { console.error('startAwsCostPoller:', e.message); }
    try { startGcpCostPoller(); } catch (e) { console.error('startGcpCostPoller:', e.message); }
    try { startAzureCostPoller(); } catch (e) { console.error('startAzureCostPoller:', e.message); }
    try { startCatalogSweep(); } catch (e) { console.error('startCatalogSweep:', e.message); }
    try { startScorecardSweep(); } catch (e) { console.error('startScorecardSweep:', e.message); }
    try { startGitOpsSweep(); } catch (e) { console.error('startGitOpsSweep:', e.message); }
    try { startAuditRetentionSweep(); } catch (e) { console.error('startAuditRetentionSweep:', e.message); }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ AgenticOps API running on port ${PORT}`);
    });
  } catch (err) {
    // Only initDb() throws here now (everything else is wrapped). If we
    // reach this branch, Postgres itself is unreachable — the only thing
    // that's actually fatal at boot.
    console.error('Failed to start server (DB likely unreachable):', err);
    process.exit(1);
  }
}

start();
