import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { seed } from './seed.js';
import { addClient } from './sse.js';
import { startSimulation } from './simulation.js';
import servicesRouter from './routes/services.js';
import pipelinesRouter from './routes/pipelines.js';
import deploymentsRouter from './routes/deployments.js';
import incidentsRouter from './routes/incidents.js';
import infrastructureRouter from './routes/infrastructure.js';
import settingsRouter from './routes/settings.js';
import activityRouter from './routes/activity.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/services', servicesRouter);
app.use('/api/pipelines', pipelinesRouter);
app.use('/api/deployments', deploymentsRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/infrastructure', infrastructureRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/activity', activityRouter);

// SSE endpoint
app.get('/api/events', (req, res) => { addClient(res); });

// Health check
app.get('/api/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime() }); });

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
    await seed();
    startSimulation();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ AgenticOps API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
