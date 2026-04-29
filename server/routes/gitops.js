import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { syncOne } from '../gitops.js';

const router = Router();
const operator = requireAuth('operator');

router.get('/apps', async (req, res) => {
  res.json(await query('SELECT * FROM gitops_apps ORDER BY name'));
});

router.get('/apps/:id', async (req, res) => {
  const app = await queryOne('SELECT * FROM gitops_apps WHERE id=$1', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'Not found' });
  const syncs = await query(
    `SELECT id, revision, status, drift_detected, started_at, finished_at
     FROM gitops_syncs WHERE app_id=$1 ORDER BY started_at DESC LIMIT 50`,
    [app.id]
  );
  res.json({
    ...app,
    syncs: syncs.map(s => ({ ...s, started_at: Number(s.started_at), finished_at: s.finished_at ? Number(s.finished_at) : null })),
  });
});

router.post('/apps', operator, async (req, res) => {
  const { name, repo_full_name, manifest_path, target_cluster, cluster_connector_id, sync_interval_ms, auto_sync } = req.body || {};
  if (!name || !repo_full_name) return res.status(400).json({ error: 'name and repo_full_name required' });
  const id = `app-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await execute(
    `INSERT INTO gitops_apps (id, name, repo_full_name, manifest_path, target_cluster,
       cluster_connector_id, sync_interval_ms, auto_sync, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, name, repo_full_name, manifest_path || '.', target_cluster || null,
     cluster_connector_id || null, sync_interval_ms || 300000, auto_sync !== false, Date.now()]
  );
  const row = await queryOne('SELECT * FROM gitops_apps WHERE id=$1', [id]);
  broadcast('gitops:app-created', row);
  res.status(201).json(row);
});

router.put('/apps/:id', operator, async (req, res) => {
  const { name, manifest_path, target_cluster, cluster_connector_id, sync_interval_ms, auto_sync } = req.body || {};
  await execute(
    `UPDATE gitops_apps SET
       name=COALESCE($1,name),
       manifest_path=COALESCE($2,manifest_path),
       target_cluster=COALESCE($3,target_cluster),
       cluster_connector_id=COALESCE($4,cluster_connector_id),
       sync_interval_ms=COALESCE($5,sync_interval_ms),
       auto_sync=COALESCE($6,auto_sync)
     WHERE id=$7`,
    [name, manifest_path, target_cluster, cluster_connector_id, sync_interval_ms, auto_sync, req.params.id]
  );
  const row = await queryOne('SELECT * FROM gitops_apps WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/apps/:id', operator, async (req, res) => {
  await execute('DELETE FROM gitops_apps WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/apps/:id/sync', operator, async (req, res) => {
  syncOne(req.params.id).catch(err => console.error('Manual GitOps sync:', err));
  res.status(202).json({ ok: true });
});

export default router;
