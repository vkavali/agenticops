import { Router } from 'express';
import { query, execute, queryOne } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
const admin = requireAuth('admin');

router.get('/:section', async (req, res) => {
  const row = await queryOne('SELECT value FROM settings WHERE key=$1', [req.params.section]);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  res.json(row.value);
});

router.put('/:section', admin, async (req, res) => {
  const { section } = req.params;
  await execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2',
    [section, JSON.stringify(req.body)]
  );
  res.json({ ok: true });
});

// Add item to array section
router.post('/:section/items', admin, async (req, res) => {
  const { section } = req.params;
  const row = await queryOne('SELECT value FROM settings WHERE key=$1', [section]);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  const arr = Array.isArray(row.value) ? row.value : [];
  arr.push(req.body);
  await execute('UPDATE settings SET value=$1 WHERE key=$2', [JSON.stringify(arr), section]);
  res.status(201).json(req.body);
});

// Delete item from array section
router.delete('/:section/items/:itemId', admin, async (req, res) => {
  const { section, itemId } = req.params;
  const row = await queryOne('SELECT value FROM settings WHERE key=$1', [section]);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  const arr = Array.isArray(row.value) ? row.value.filter(i => i.id !== itemId) : [];
  await execute('UPDATE settings SET value=$1 WHERE key=$2', [JSON.stringify(arr), section]);
  res.json({ ok: true });
});

export default router;
