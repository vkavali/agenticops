import { Router } from 'express';
import { query, queryOne, execute } from '../db.js';
import { broadcast } from '../sse.js';
import { requireAuth } from '../auth.js';
import { runPlan, runApply, runRollback, cancelRun, openRemediationPR } from '../iac.js';
import { isAgentEnabled } from '../agent.js';

const router = Router();
const operator = requireAuth('operator');
const admin = requireAuth('admin');

// ── IaC configs ──
router.get('/configs', async (req, res) => {
  res.json(await query('SELECT * FROM iac_configs ORDER BY name'));
});

router.post('/configs', operator, async (req, res) => {
  const { id, name, repo_full_name, branch, tf_dir, cloud_connector_id, drift_check_interval_ms } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const cid = id || `iac-cfg-${Date.now()}`;
  await execute(
    `INSERT INTO iac_configs (id, name, repo_full_name, branch, tf_dir, cloud_connector_id,
       drift_check_interval_ms, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cid, name, repo_full_name || null, branch || 'main', tf_dir || '.',
     cloud_connector_id || null, drift_check_interval_ms || 3600000,
     Date.now(), req.auth?.label || null]
  );
  const row = await queryOne('SELECT * FROM iac_configs WHERE id=$1', [cid]);
  broadcast('iac:config-created', row);
  res.status(201).json(row);
});

router.put('/configs/:id', operator, async (req, res) => {
  const { name, repo_full_name, branch, tf_dir, cloud_connector_id, drift_check_interval_ms } = req.body;
  await execute(
    `UPDATE iac_configs SET
       name=COALESCE($1,name), repo_full_name=COALESCE($2,repo_full_name),
       branch=COALESCE($3,branch), tf_dir=COALESCE($4,tf_dir),
       cloud_connector_id=COALESCE($5,cloud_connector_id),
       drift_check_interval_ms=COALESCE($6,drift_check_interval_ms)
     WHERE id=$7`,
    [name, repo_full_name, branch, tf_dir, cloud_connector_id, drift_check_interval_ms, req.params.id]
  );
  const row = await queryOne('SELECT * FROM iac_configs WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/configs/:id', admin, async (req, res) => {
  await execute('DELETE FROM iac_configs WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── Runs ──
router.get('/runs', async (req, res) => {
  const { iac_config_id, kind, limit } = req.query;
  const where = [];
  const params = [];
  if (iac_config_id) { params.push(iac_config_id); where.push(`iac_config_id=$${params.length}`); }
  if (kind) { params.push(kind); where.push(`kind=$${params.length}`); }
  const lim = Math.min(parseInt(limit) || 50, 200);
  params.push(lim);
  const sql = `SELECT * FROM iac_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY started_at DESC LIMIT $${params.length}`;
  const rows = await query(sql, params);
  res.json(rows.map(r => ({
    ...r,
    started_at: Number(r.started_at),
    finished_at: r.finished_at ? Number(r.finished_at) : null,
  })));
});

router.get('/runs/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM iac_runs WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...row,
    started_at: Number(row.started_at),
    finished_at: row.finished_at ? Number(row.finished_at) : null,
  });
});

// Latest run with a non-empty proposed patch — used by the UI to surface the
// most recent agent-proposed remediation.
router.get('/latest-proposal', async (req, res) => {
  const row = await queryOne(
    `SELECT * FROM iac_runs WHERE proposed_patch IS NOT NULL AND proposed_patch <> ''
     ORDER BY started_at DESC LIMIT 1`
  );
  if (!row) return res.json(null);
  res.json({
    ...row,
    started_at: Number(row.started_at),
    finished_at: row.finished_at ? Number(row.finished_at) : null,
  });
});

// Trigger a plan. Optionally pass an incident_id to invoke the agent.
router.post('/configs/:id/plan', operator, async (req, res) => {
  const config = await queryOne('SELECT * FROM iac_configs WHERE id=$1', [req.params.id]);
  if (!config) return res.status(404).json({ error: 'Config not found' });
  if (req.body.incident_id && !isAgentEnabled()) {
    return res.status(400).json({ error: 'Agent not configured (ANTHROPIC_API_KEY unset)' });
  }
  // Fire and forget — the run streams progress via SSE.
  runPlan(config, {
    incidentId: req.body.incident_id || null,
    triggeredBy: req.auth?.label || null,
  }).catch(err => console.error('Plan run failed:', err));
  res.status(202).json({ ok: true });
});

router.post('/runs/:id/cancel', operator, async (req, res) => {
  const ok = cancelRun(req.params.id);
  res.json({ ok });
});

// Roll back a passed apply by re-running terraform apply at the previous SHA.
// Optional ?target_sha overrides the default (which is the run's previous_sha).
router.post('/runs/:id/rollback', operator, async (req, res) => {
  const run = await queryOne('SELECT * FROM iac_runs WHERE id=$1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.kind !== 'apply' || run.status !== 'passed') {
    return res.status(400).json({ error: 'Can only rollback successful apply runs' });
  }
  const targetSha = req.body?.target_sha || run.previous_sha;
  if (!targetSha) return res.status(400).json({ error: 'No previous SHA available' });

  const config = await queryOne('SELECT * FROM iac_configs WHERE id=$1', [run.iac_config_id]);
  if (!config) return res.status(404).json({ error: 'Config not found' });

  runRollback(config, run, { targetSha, triggeredBy: req.auth?.label || null })
    .catch(err => console.error('Rollback failed:', err));
  res.status(202).json({ ok: true, target_sha: targetSha });
});

// Apply a previously-approved run. The gate must already be approved.
// Two modes:
//   - mode='pr' (default if config has a repo): open a remediation PR. The
//     terraform apply runs later, when the webhook for the merged PR fires.
//   - mode='in-place': clone, git apply, terraform apply. Bypasses GitHub.
router.post('/runs/:id/apply', operator, async (req, res) => {
  const run = await queryOne('SELECT * FROM iac_runs WHERE id=$1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (!run.proposed_patch) return res.status(400).json({ error: 'Run has no proposed patch' });
  if (!run.gate_id) return res.status(400).json({ error: 'Run has no associated gate' });
  const gate = await queryOne('SELECT status FROM approval_gates WHERE id=$1', [run.gate_id]);
  if (!gate || gate.status !== 'approved') {
    return res.status(409).json({ error: `Gate ${run.gate_id} is ${gate?.status || 'missing'} — apply blocked` });
  }
  const config = await queryOne('SELECT * FROM iac_configs WHERE id=$1', [run.iac_config_id]);
  if (!config) return res.status(404).json({ error: 'Config not found' });

  const mode = req.body?.mode || (config.repo_full_name ? 'pr' : 'in-place');

  if (mode === 'pr') {
    if (run.pr_number) return res.status(409).json({ error: `PR #${run.pr_number} already open` });
    try {
      const result = await openRemediationPR(config, run, { triggeredBy: req.auth?.label || null });
      return res.status(202).json({ ok: true, mode: 'pr', ...result });
    } catch (err) {
      console.error('Open PR failed:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  runApply(config, run, { triggeredBy: req.auth?.label || null })
    .catch(err => console.error('Apply run failed:', err));
  res.status(202).json({ ok: true, mode: 'in-place' });
});

export default router;

// Gate-decision listener — when a gate for an iac_run is approved, we leave
// the explicit /apply call to the operator (so they can review the plan
// summary first). On rejection, mark the run cancelled.
export async function onGateDecision(gateId, decision) {
  if (decision !== 'rejected') return;
  const run = await queryOne('SELECT id FROM iac_runs WHERE gate_id=$1', [gateId]);
  if (!run) return;
  await execute("UPDATE iac_runs SET status='cancelled' WHERE id=$1", [run.id]);
  broadcast('iac:run-finished', { id: run.id, status: 'cancelled' });
}
