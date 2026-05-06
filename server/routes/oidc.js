import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { listOidcConfigs, createOidcConfig, deleteOidcConfig } from '../oidc.js';
import { record } from '../audit.js';

const router = Router();
const admin = requireAuth('admin');

router.get('/', admin, async (req, res) => {
  res.json(await listOidcConfigs());
});

router.post('/', admin, async (req, res) => {
  const { issuer, client_id, audience, role_claim, groups_claim, group_role_map } = req.body || {};
  if (!issuer || !client_id) return res.status(400).json({ error: 'issuer and client_id required' });
  const id = await createOidcConfig({
    org_id: req.auth.orgId,
    issuer, client_id, audience, role_claim, groups_claim, group_role_map,
  });
  await record({ actor: req.auth.label, action: 'oidc:create', target: id, detail: { issuer } });
  res.status(201).json({ id });
});

router.delete('/:id', admin, async (req, res) => {
  await deleteOidcConfig(req.params.id);
  await record({ actor: req.auth.label, action: 'oidc:delete', target: req.params.id });
  res.json({ ok: true });
});

export default router;
