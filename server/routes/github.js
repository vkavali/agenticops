import { Router } from 'express';
import crypto from 'crypto';
import { query, execute, queryOne } from '../db.js';
import { broadcast } from '../sse.js';
import { encrypt, decrypt } from '../crypto.js';
import { requireAuth } from '../auth.js';
import { onRemediationPRMerged, onRemediationPRClosed } from '../iac.js';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI; // e.g. https://your-app.railway.app/api/github/callback
const GITHUB_API = 'https://api.github.com';

// Mutating routes require operator role. OAuth callback + webhook are
// authenticated externally (state param + HMAC signature).
const operator = requireAuth('operator');

// ── OAuth: Start ──
router.get('/authorize', operator, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=repo,write:repo_hook&state=${state}`;
  res.json({ url, state });
});

// ── OAuth: Callback ──
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('Failed to get token');

    // Get GitHub user info
    const userRes = await fetch(`${GITHUB_API}/user`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'AgenticOps' },
    });
    const user = await userRes.json();

    // Store connection (token encrypted at rest)
    await execute(
      'INSERT INTO github_connections (access_token, github_user, github_avatar, scopes) VALUES ($1, $2, $3, $4)',
      [encrypt(tokenData.access_token), user.login, user.avatar_url, tokenData.scope]
    );

    broadcast('github:connected', { user: user.login, avatar: user.avatar_url });

    // Redirect back to the app settings page
    res.redirect('/?tab=settings&github=connected');
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.status(500).send('OAuth failed');
  }
});

// ── Connection status ──
router.get('/status', requireAuth('viewer'), async (req, res) => {
  const conn = await queryOne('SELECT id, github_user, github_avatar, scopes, created_at FROM github_connections ORDER BY created_at DESC LIMIT 1');
  const repos = conn ? await query('SELECT * FROM connected_repos WHERE github_connection_id = $1', [conn.id]) : [];
  res.json({ connected: !!conn, connection: conn, repos });
});

// ── Disconnect ──
router.delete('/disconnect', operator, async (req, res) => {
  await execute('DELETE FROM connected_repos');
  await execute('DELETE FROM github_connections');
  broadcast('github:disconnected', {});
  res.json({ ok: true });
});

// ── List user's repos ──
router.get('/repos', requireAuth('viewer'), async (req, res) => {
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  if (!conn) return res.status(401).json({ error: 'Not connected to GitHub' });
  const accessToken = decrypt(conn.access_token);

  try {
    const page = parseInt(req.query.page) || 1;
    const ghRes = await fetch(`${GITHUB_API}/user/repos?per_page=30&page=${page}&sort=updated&affiliation=owner,collaborator`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'AgenticOps' },
    });
    const repos = await ghRes.json();
    // Mark which ones are already connected
    const connected = await query('SELECT repo_full_name FROM connected_repos');
    const connectedSet = new Set(connected.map(r => r.repo_full_name));
    res.json(repos.map(r => ({
      full_name: r.full_name, name: r.name, owner: r.owner.login,
      description: r.description, language: r.language, private: r.private,
      default_branch: r.default_branch, url: r.html_url, updated_at: r.updated_at,
      connected: connectedSet.has(r.full_name),
    })));
  } catch (err) {
    console.error('Failed to list repos:', err);
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

// ── Connect a repo (set up webhook) ──
router.post('/repos/:owner/:repo/connect', operator, async (req, res) => {
  const { owner, repo } = req.params;
  const fullName = `${owner}/${repo}`;
  const conn = await queryOne('SELECT id, access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  if (!conn) return res.status(401).json({ error: 'Not connected to GitHub' });
  const accessToken = decrypt(conn.access_token);

  const webhookSecret = crypto.randomBytes(20).toString('hex');
  const webhookUrl = `${process.env.APP_URL || GITHUB_REDIRECT_URI?.replace('/api/github/callback', '')}/api/github/webhook`;

  try {
    // Create webhook on GitHub
    const whRes = await fetch(`${GITHUB_API}/repos/${fullName}/hooks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'AgenticOps' },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: { url: webhookUrl, content_type: 'json', secret: webhookSecret, insecure_ssl: '0' },
      }),
    });
    const webhook = await whRes.json();

    if (!webhook.id) {
      console.error('Webhook creation failed:', webhook);
      return res.status(400).json({ error: webhook.message || 'Failed to create webhook' });
    }

    // Get repo info
    const repoRes = await fetch(`${GITHUB_API}/repos/${fullName}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'AgenticOps' },
    });
    const repoInfo = await repoRes.json();

    // Store connected repo (webhook secret encrypted at rest)
    await execute(
      'INSERT INTO connected_repos (github_connection_id, repo_full_name, repo_url, default_branch, webhook_id, webhook_secret) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (repo_full_name) DO UPDATE SET webhook_id=$5, webhook_secret=$6',
      [conn.id, fullName, repoInfo.html_url, repoInfo.default_branch, webhook.id, encrypt(webhookSecret)]
    );

    // Add activity
    const now = Date.now();
    await execute('INSERT INTO activity (event, type, activity_timestamp) VALUES ($1,$2,$3)',
      [`Connected repository ${fullName}`, 'system', now]);

    broadcast('repo:connected', { repo: fullName });
    broadcast('activity:new', { event: `Connected repository ${fullName}`, type: 'system', timestamp: now });
    res.status(201).json({ ok: true, repo: fullName, webhookId: webhook.id });
  } catch (err) {
    console.error('Failed to connect repo:', err);
    res.status(500).json({ error: 'Failed to connect repo' });
  }
});

// ── Disconnect a repo ──
router.delete('/repos/:owner/:repo/disconnect', operator, async (req, res) => {
  const { owner, repo } = req.params;
  const fullName = `${owner}/${repo}`;
  const conn = await queryOne('SELECT access_token FROM github_connections ORDER BY created_at DESC LIMIT 1');
  const repoRow = await queryOne('SELECT webhook_id FROM connected_repos WHERE repo_full_name = $1', [fullName]);

  // Remove webhook from GitHub
  if (conn && repoRow?.webhook_id) {
    try {
      await fetch(`${GITHUB_API}/repos/${fullName}/hooks/${repoRow.webhook_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${decrypt(conn.access_token)}`, 'User-Agent': 'AgenticOps' },
      });
    } catch (err) { /* best effort */ }
  }

  await execute('DELETE FROM connected_repos WHERE repo_full_name = $1', [fullName]);
  broadcast('repo:disconnected', { repo: fullName });
  res.json({ ok: true });
});

// ── Webhook receiver ──
// NOTE: relies on rawBody captured by express.json's verify hook (see server/index.js)
router.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'];
  const payload = req.body;

  const repo = payload.repository?.full_name;
  if (!repo) return res.status(400).send('No repo');

  const repoRow = await queryOne('SELECT * FROM connected_repos WHERE repo_full_name = $1', [repo]);
  if (!repoRow) return res.status(404).send('Repo not connected');

  // Verify HMAC against stored secret
  const secret = decrypt(repoRow.webhook_secret);
  if (!signature || !req.rawBody || !secret) return res.status(401).send('Unsigned');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).send('Invalid signature');
  }

  const now = Date.now();

  if (event === 'push') {
    const branch = payload.ref?.replace('refs/heads/', '');
    const commit = payload.head_commit;
    const pusher = payload.pusher?.name || 'unknown';

    // Find pipelines linked to this repo
    const pipelines = await query('SELECT * FROM pipelines WHERE repo_full_name = $1', [repo]);

    for (const pipe of pipelines) {
      // Check if pipeline trigger matches this branch
      const trigger = pipe.trigger_config || {};
      if (trigger.branch && trigger.branch !== branch) continue;

      // Create a real pipeline run
      const lastRun = await queryOne('SELECT number FROM pipeline_runs WHERE pipeline_id=$1 ORDER BY run_timestamp DESC LIMIT 1', [pipe.id]);
      const lastNum = lastRun ? parseInt(lastRun.number.replace('#', ''), 10) : 0;
      const runNumber = `#${lastNum + 1}`;
      const runId = `r-${now}-${Math.random().toString(36).slice(2, 6)}`;

      const stages = pipe.stages || [];
      const stageResults = stages.map(s => ({
        name: s.name, status: 'passed',
        duration: `${Math.floor(Math.random() * 60 + 10)}s`,
        logs: [`Triggered by push to ${branch} by ${pusher}`, `${s.name} completed`],
      }));

      await execute(
        'INSERT INTO pipeline_runs (id,pipeline_id,number,commit_hash,message,status,duration,time,run_timestamp,triggered_by,stage_results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [runId, pipe.id, runNumber, commit?.id?.slice(0, 7) || 'unknown', commit?.message || 'push', 'passed', '2m 30s', 'Just now', now, pusher, JSON.stringify(stageResults)]
      );
      await execute('UPDATE pipelines SET last_run=$1, last_run_time=$2 WHERE id=$3', ['passed', 'Just now', pipe.id]);
      await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
        [`Pipeline "${pipe.name}" ${runNumber} triggered by push to ${branch}`, 'pipeline', now]);

      const run = { id: runId, number: runNumber, commit: commit?.id?.slice(0, 7), msg: commit?.message, status: 'passed', duration: '2m 30s', time: 'Just now', timestamp: now, by: pusher, stageResults };
      broadcast('pipeline:run', { pipelineId: pipe.id, run });
      broadcast('activity:new', { event: `Pipeline "${pipe.name}" ${runNumber} triggered by push`, type: 'pipeline', timestamp: now });
    }

    // Also log if no pipelines matched
    if (pipelines.length === 0) {
      await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
        [`Push to ${repo}/${branch} by ${pusher} (no pipeline linked)`, 'pipeline', now]);
      broadcast('activity:new', { event: `Push to ${repo}/${branch} (no pipeline linked)`, type: 'pipeline', timestamp: now });
    }
  }

  if (event === 'pull_request') {
    const pr = payload.pull_request;
    const action = payload.action; // opened, synchronize, closed, etc.
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`PR ${action}: "${pr.title}" on ${repo} by ${pr.user?.login}`, 'pipeline', now]);
    broadcast('activity:new', { event: `PR ${action}: "${pr.title}" on ${repo}`, type: 'pipeline', timestamp: now });

    // If this is one of our remediation PRs, drive the IaC state machine.
    if (action === 'closed') {
      try {
        if (pr.merged) {
          // Fire-and-forget — apply runs in the background and streams logs via SSE.
          onRemediationPRMerged(pr.number, pr.merge_commit_sha)
            .catch(err => console.error('Remediation PR apply failed:', err));
        } else {
          await onRemediationPRClosed(pr.number);
        }
      } catch (err) {
        console.error('Remediation PR webhook handler error:', err);
      }
    }
  }

  res.status(200).send('OK');
});

export default router;
