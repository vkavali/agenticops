import { Router } from 'express';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';

const router = Router();
const operator = requireAuth('operator');

const REGISTRIES = ['docker.io', 'ghcr.io', 'ecr', 'gcr.io', 'quay.io', 'custom'];

router.get('/', async (req, res) => {
  const { registry, repository, limit } = req.query;
  const where = [];
  const params = [];
  if (registry) { params.push(registry); where.push(`registry = $${params.length}`); }
  if (repository) { params.push(repository); where.push(`repository = $${params.length}`); }
  const lim = Math.min(parseInt(limit) || 100, 500);
  params.push(lim);
  const sql = `SELECT * FROM artifacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pushed_at DESC LIMIT $${params.length}`;
  res.json((await query(sql, params)).map(a => ({ ...a, pushed_at: Number(a.pushed_at), size_bytes: a.size_bytes ? Number(a.size_bytes) : null })));
});

router.get('/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM artifacts WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, pushed_at: Number(row.pushed_at), size_bytes: row.size_bytes ? Number(row.size_bytes) : null });
});

// Register an artifact. Called by CI after a successful push.
router.post('/', operator, async (req, res) => {
  const { registry, repository, tag, digest, size_bytes, pipeline_run_id, metadata } = req.body;
  if (!registry || !repository || !tag) {
    return res.status(400).json({ error: 'registry, repository, tag required' });
  }
  if (!REGISTRIES.includes(registry) && registry !== 'custom') {
    // Allow unknown but warn — don't block.
  }
  const id = `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await execute(
      `INSERT INTO artifacts (id, registry, repository, tag, digest, size_bytes, pushed_at, pushed_by, pipeline_run_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (registry, repository, tag) DO UPDATE SET
         digest=EXCLUDED.digest, size_bytes=EXCLUDED.size_bytes,
         pushed_at=EXCLUDED.pushed_at, pushed_by=EXCLUDED.pushed_by,
         pipeline_run_id=EXCLUDED.pipeline_run_id, metadata=EXCLUDED.metadata
       RETURNING *`,
      [id, registry, repository, tag, digest || null, size_bytes || null,
       Date.now(), req.auth?.label || null, pipeline_run_id || null,
       JSON.stringify(metadata || {})]
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const row = await queryOne('SELECT * FROM artifacts WHERE registry=$1 AND repository=$2 AND tag=$3', [registry, repository, tag]);
  const shaped = { ...row, pushed_at: Number(row.pushed_at), size_bytes: row.size_bytes ? Number(row.size_bytes) : null };
  broadcast('artifact:registered', shaped);
  res.status(201).json(shaped);
});

router.delete('/:id', operator, async (req, res) => {
  await execute('DELETE FROM artifacts WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
