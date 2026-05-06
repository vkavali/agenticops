import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { listOrgs, getOrg, createOrg, deleteOrg } from '../orgs.js';
import { record } from '../audit.js';

const router = Router();
const admin = requireAuth('admin');

router.get('/', requireAuth('viewer'), async (req, res) => {
  // Non-admins only see their own org. Admins see all.
  if (req.auth.role === 'admin') {
    res.json(await listOrgs());
  } else {
    const o = await getOrg(req.auth.orgId);
    res.json(o ? [o] : []);
  }
});

router.post('/', admin, async (req, res) => {
  const { name, slug, id } = req.body || {};
  try {
    const oid = await createOrg({ id, name, slug });
    await record({ actor: req.auth.label, action: 'org:create', target: oid, detail: { name } });
    res.status(201).json({ id: oid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', admin, async (req, res) => {
  try {
    await deleteOrg(req.params.id);
    await record({ actor: req.auth.label, action: 'org:delete', target: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
