import { Router } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db.js';
import { requireAuth } from '../auth.js';
import { record } from '../audit.js';

// SCIM 2.0 minimal User endpoint — RFC 7644.
//
// Implements the subset Okta / Azure AD / OneLogin / Google Workspace
// actually use during user provisioning + deprovisioning:
//   GET  /Users          → paginated list with filter support
//   GET  /Users/:id      → single user
//   POST /Users          → create
//   PUT  /Users/:id      → replace
//   PATCH /Users/:id     → mutate (active=false on deprovision)
//   DELETE /Users/:id    → delete
//   GET  /ServiceProviderConfig → static capability advertisement
//   GET  /Schemas        → schema document (minimal)
//
// Auth: requires admin role (IdP holds an AgenticOps admin token).
// Per SCIM convention, all responses use `application/scim+json`.

const router = Router();
const admin = requireAuth('admin');

router.use(admin);
router.use((req, res, next) => {
  res.type('application/scim+json');
  next();
});

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const ENTERPRISE_USER_EXT = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

function toScim(row, baseUrl) {
  return {
    schemas: [USER_SCHEMA],
    id: row.id,
    externalId: row.external_id || undefined,
    userName: row.user_name,
    displayName: row.display_name || undefined,
    active: row.active,
    emails: row.emails || [],
    meta: {
      resourceType: 'User',
      created: new Date(Number(row.created_at)).toISOString(),
      lastModified: new Date(Number(row.updated_at)).toISOString(),
      location: `${baseUrl}/Users/${row.id}`,
    },
  };
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/scim/v2`;
}

// Quick filter parser. SCIM filters are a mini-language; we only implement
// `userName eq "alice@x.com"` which is what every IdP we care about emits.
function parseSimpleFilter(filter) {
  if (!filter) return null;
  const m = filter.match(/^userName\s+eq\s+"([^"]+)"$/i);
  return m ? { userName: m[1] } : null;
}

// ── ServiceProviderConfig ──
router.get('/v2/ServiceProviderConfig', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Authentication via AgenticOps bearer token', primary: true }],
    meta: { resourceType: 'ServiceProviderConfig' },
  });
});

router.get('/v2/Schemas', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 1,
    Resources: [{
      id: USER_SCHEMA,
      name: 'User',
      description: 'Core SCIM User resource',
      attributes: [
        { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
        { name: 'displayName', type: 'string' },
        { name: 'active', type: 'boolean' },
        { name: 'emails', type: 'complex', multiValued: true },
      ],
    }],
  });
});

// ── Users CRUD ──
router.get('/v2/Users', async (req, res) => {
  const start = parseInt(req.query.startIndex) || 1;
  const count = Math.min(parseInt(req.query.count) || 100, 200);
  const filter = parseSimpleFilter(req.query.filter);

  let rows;
  if (filter?.userName) {
    rows = await query('SELECT * FROM scim_users WHERE org_id=$1 AND user_name=$2', [req.auth.orgId, filter.userName]);
  } else {
    rows = await query(
      'SELECT * FROM scim_users WHERE org_id=$1 ORDER BY user_name LIMIT $2 OFFSET $3',
      [req.auth.orgId, count, Math.max(0, start - 1)]
    );
  }
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: rows.length,
    startIndex: start,
    itemsPerPage: rows.length,
    Resources: rows.map(r => toScim(r, baseUrl(req))),
  });
});

router.get('/v2/Users/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM scim_users WHERE id=$1 AND org_id=$2', [req.params.id, req.auth.orgId]);
  if (!row) return res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });
  res.json(toScim(row, baseUrl(req)));
});

router.post('/v2/Users', async (req, res) => {
  const { userName, displayName, active, emails, externalId } = req.body || {};
  if (!userName) return res.status(400).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'userName required', status: '400' });

  const existing = await queryOne('SELECT id FROM scim_users WHERE org_id=$1 AND user_name=$2', [req.auth.orgId, userName]);
  if (existing) return res.status(409).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'userName already exists', status: '409' });

  const id = `scim-${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  await execute(
    `INSERT INTO scim_users (id, external_id, user_name, display_name, emails, active, org_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [id, externalId || null, userName, displayName || null, JSON.stringify(emails || []),
     active !== false, req.auth.orgId, now]
  );
  await record({ actor: req.auth.label, action: 'scim:user-create', target: id, detail: { userName, externalId } });
  const row = await queryOne('SELECT * FROM scim_users WHERE id=$1', [id]);
  res.status(201).json(toScim(row, baseUrl(req)));
});

router.put('/v2/Users/:id', async (req, res) => {
  const { userName, displayName, active, emails, externalId } = req.body || {};
  const row = await queryOne('SELECT * FROM scim_users WHERE id=$1 AND org_id=$2', [req.params.id, req.auth.orgId]);
  if (!row) return res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });
  await execute(
    `UPDATE scim_users SET
       user_name=COALESCE($1,user_name),
       display_name=COALESCE($2,display_name),
       emails=COALESCE($3,emails),
       active=COALESCE($4,active),
       external_id=COALESCE($5,external_id),
       updated_at=$6
     WHERE id=$7`,
    [userName, displayName, emails ? JSON.stringify(emails) : null, active, externalId, Date.now(), req.params.id]
  );
  const updated = await queryOne('SELECT * FROM scim_users WHERE id=$1', [req.params.id]);
  await record({ actor: req.auth.label, action: 'scim:user-replace', target: req.params.id });
  res.json(toScim(updated, baseUrl(req)));
});

// PATCH supports the `Operations` array per RFC 7644 §3.5.2. Most IdPs use it
// just to flip `active` on deprovision, so we only handle the common ops.
router.patch('/v2/Users/:id', async (req, res) => {
  const ops = req.body?.Operations || [];
  const row = await queryOne('SELECT * FROM scim_users WHERE id=$1 AND org_id=$2', [req.params.id, req.auth.orgId]);
  if (!row) return res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });

  const sets = []; const params = []; let i = 1;
  for (const op of ops) {
    if (op.op?.toLowerCase() !== 'replace') continue;
    if (op.path === 'active' || op.value?.active !== undefined) {
      sets.push(`active=$${i++}`);
      params.push(op.path === 'active' ? !!op.value : !!op.value.active);
    }
    if (op.path === 'displayName' || op.value?.displayName !== undefined) {
      sets.push(`display_name=$${i++}`);
      params.push(op.path === 'displayName' ? op.value : op.value.displayName);
    }
  }
  if (sets.length) {
    sets.push(`updated_at=$${i++}`);
    params.push(Date.now());
    params.push(req.params.id);
    await execute(`UPDATE scim_users SET ${sets.join(', ')} WHERE id=$${i}`, params);
  }
  const updated = await queryOne('SELECT * FROM scim_users WHERE id=$1', [req.params.id]);
  await record({ actor: req.auth.label, action: 'scim:user-patch', target: req.params.id, detail: { ops: ops.length } });
  res.json(toScim(updated, baseUrl(req)));
});

router.delete('/v2/Users/:id', async (req, res) => {
  const r = await execute('DELETE FROM scim_users WHERE id=$1 AND org_id=$2', [req.params.id, req.auth.orgId]);
  if (r.rowCount === 0) return res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });
  await record({ actor: req.auth.label, action: 'scim:user-delete', target: req.params.id });
  res.status(204).end();
});

export default router;
