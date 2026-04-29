import { Router } from 'express';
import { query, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await query('SELECT * FROM services ORDER BY name');
  res.json(rows);
});

router.patch('/:id', requireAuth('operator'), async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const sets = []; const vals = []; let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`); vals.push(v);
  }
  vals.push(id);
  await execute(`UPDATE services SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  const row = await query('SELECT * FROM services WHERE id = $1', [id]);
  broadcast('services:updated', row[0]);
  res.json(row[0]);
});

export default router;
