import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { seed } from './seed.js';
import { addClient } from './sse.js';
import { startSimulation } from './simulation.js';
import { startMonitoring } from './monitor.js';
import { bootstrapAdmin, requireAuth } from './auth.js';
import { auditMiddleware } from './audit.js';
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
import chaosRouter from './routes/chaos.js';
import { onGateDecision as chaosOnGate } from './chaos.js';
import idpRouter from './routes/idp.js';
import { startScorecardSweep } from './idp.js';
import securityRouter from './routes/security.js';
import gitopsRouter from './routes/gitops.js';
import { startGitOpsSweep } from './gitops.js';
import dbopsRouter from './routes/dbops.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// CORS allowlist. Comma-separated origins via APP_CORS_ORIGINS.
// Default to no cross-origin requests in production; allow localhost dev URLs otherwise.
const corsOrigins = (process.env.APP_CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    if (corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed`));
  },
  credentials: true,
}));

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
]);

// Global auth gate: every /api/* call needs at least viewer, except public paths.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
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

// SSE endpoint (auth handled inside addClient)
app.get('/api/events', (req, res) => { addClient(req, res); });

// Health check (public)
app.get('/api/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime() }); });

// Identity endpoint — returns the authenticated token's role/label.
app.get('/api/auth/me', (req, res) => {
  res.json({ role: req.auth.role, label: req.auth.label, tokenId: req.auth.tokenId });
});

// Serve production build
const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Boot
async function start() {
  try {
    await initDb();
    await migrateSecretsAtRest();
    await bootstrapAdmin();
    await seed();
    onGateDecided(strategyOnGate);
    onGateDecided(iacOnGate);
    onGateDecided(chaosOnGate);
    await seedSyntheticCosts();
    startSimulation();
    startMonitoring();
    startDriftSweep();
    startSloEvaluator();
    startRolloutController();
    startCostSweep();
    startAwsCostPoller();
    startScorecardSweep();
    startGitOpsSweep();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ AgenticOps API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
