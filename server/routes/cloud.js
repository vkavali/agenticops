import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';

const router = Router();

// List all cloud connectors
router.get('/', async (req, res) => {
  const rows = await query('SELECT id, provider, name, region, status, created_at FROM cloud_connectors ORDER BY created_at DESC');
  res.json(rows);
});

// Connect to a new cloud provider
router.post('/', async (req, res) => {
  const { provider, name, region, credentials } = req.body;
  const id = `cc-${Date.now()}`;
  const now = Date.now();

  // Basic validation (in a real app, we'd verify the credentials by calling the provider's API)
  if (!provider || !name || !credentials) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await execute(
      'INSERT INTO cloud_connectors (id, provider, name, region, credentials, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, provider, name, region, JSON.stringify(credentials), 'connected', now]
    );

    await execute('INSERT INTO activity (event, type, activity_timestamp) VALUES ($1, $2, $3)',
      [`Connected to ${provider} (${name})`, 'system', now]);

    const connector = { id, provider, name, region, status: 'connected', created_at: now };
    broadcast('cloud:connected', connector);
    broadcast('activity:new', { event: `Connected to ${provider} (${name})`, type: 'system', timestamp: now });
    
    res.status(201).json(connector);
  } catch (err) {
    console.error('Failed to connect to cloud:', err);
    res.status(500).json({ error: 'Failed to connect' });
  }
});

// Disconnect a cloud provider
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const cc = await queryOne('SELECT * FROM cloud_connectors WHERE id=$1', [id]);
  
  if (!cc) {
    return res.status(404).json({ error: 'Connector not found' });
  }

  await execute('DELETE FROM cloud_connectors WHERE id=$1', [id]);
  
  const now = Date.now();
  await execute('INSERT INTO activity (event, type, activity_timestamp) VALUES ($1, $2, $3)',
    [`Disconnected from ${cc.provider} (${cc.name})`, 'system', now]);

  broadcast('cloud:disconnected', { id });
  broadcast('activity:new', { event: `Disconnected from ${cc.provider} (${cc.name})`, type: 'system', timestamp: now });

  res.json({ ok: true });
});

export default router;
