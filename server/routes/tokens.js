import { Router } from 'express';
import { mintToken, revokeToken, listTokens, requireAuth } from '../auth.js';
import { record } from '../audit.js';

const router = Router();
const admin = requireAuth('admin');

// List existing tokens (never reveals the raw token).
router.get('/', admin, async (req, res) => {
  res.json(await listTokens());
});

// Mint a new token. Returns the raw token in the response — shown once.
router.post('/', admin, async (req, res) => {
  const { role, label } = req.body;
  if (!role) return res.status(400).json({ error: 'role required' });
  try {
    const result = await mintToken(role, label);
    await record({ actor: req.auth.label, action: 'token:mint', target: String(result.id), detail: { role, label } });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', admin, async (req, res) => {
  await revokeToken(req.params.id);
  await record({ actor: req.auth.label, action: 'token:revoke', target: req.params.id });
  res.json({ ok: true });
});

export default router;
