import { Router } from 'express';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';

const router = Router();
const operator = requireAuth('operator');

router.get('/', async (req, res) => {
  const { category } = req.query;
  const rows = category
    ? await query('SELECT * FROM pipeline_templates WHERE category=$1 ORDER BY name', [category])
    : await query('SELECT * FROM pipeline_templates ORDER BY name');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM pipeline_templates WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', operator, async (req, res) => {
  const { id, name, description, category, stages, variables } = req.body;
  if (!name || !Array.isArray(stages)) {
    return res.status(400).json({ error: 'name and stages[] required' });
  }
  const tid = id || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await execute(
    'INSERT INTO pipeline_templates (id, name, description, category, stages, variables, created_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [tid, name, description || null, category || null, JSON.stringify(stages),
     JSON.stringify(variables || {}), Date.now(), req.auth?.label || null]
  );
  const row = await queryOne('SELECT * FROM pipeline_templates WHERE id=$1', [tid]);
  broadcast('template:created', row);
  res.status(201).json(row);
});

router.put('/:id', operator, async (req, res) => {
  const { name, description, category, stages, variables } = req.body;
  await execute(
    `UPDATE pipeline_templates SET
      name=COALESCE($1,name), description=COALESCE($2,description),
      category=COALESCE($3,category),
      stages=COALESCE($4,stages), variables=COALESCE($5,variables)
     WHERE id=$6`,
    [name, description, category,
     stages ? JSON.stringify(stages) : null,
     variables ? JSON.stringify(variables) : null,
     req.params.id]
  );
  const row = await queryOne('SELECT * FROM pipeline_templates WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', operator, async (req, res) => {
  await execute('DELETE FROM pipeline_templates WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Instantiate a template into a new pipeline. Variables in the template
// (${VAR_NAME}) are replaced from req.body.variables.
router.post('/:id/instantiate', operator, async (req, res) => {
  const tpl = await queryOne('SELECT * FROM pipeline_templates WHERE id=$1', [req.params.id]);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  const vars = { ...(tpl.variables || {}), ...(req.body.variables || {}) };
  const substitute = (s) => typeof s === 'string'
    ? s.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, k) => vars[k] ?? `\${${k}}`)
    : s;
  const stages = (tpl.stages || []).map(stage => ({
    ...stage,
    name: substitute(stage.name),
    image: substitute(stage.image),
    commands: (stage.commands || []).map(substitute),
  }));

  const pid = req.body.id || `pipe-${Date.now()}`;
  const name = req.body.name || `${tpl.name} (instance)`;
  await execute(
    'INSERT INTO pipelines (id,name,branch,last_run,last_run_time,trigger_config,schedule,stages,repo_full_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [pid, name, req.body.branch || 'main', 'new', '—',
     JSON.stringify({ type: 'push', branch: req.body.branch || 'main' }),
     null, JSON.stringify(stages), req.body.repo_full_name || null]
  );
  const row = await queryOne('SELECT * FROM pipelines WHERE id=$1', [pid]);
  broadcast('pipeline:created', row);
  res.status(201).json(row);
});

export default router;
