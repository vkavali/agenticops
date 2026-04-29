import { execute } from './db.js';

// Append-only audit log for every mutating action.
// Use the middleware to auto-record from req.auth + route, or call record() directly.

export async function record({ actor, action, target, detail }) {
  try {
    await execute(
      'INSERT INTO audit_log (actor, action, target, detail, audit_timestamp) VALUES ($1,$2,$3,$4,$5)',
      [actor || 'anonymous', action, target || null, detail ? JSON.stringify(detail) : null, Date.now()]
    );
  } catch (err) {
    console.error('Audit write failed:', err.message);
  }
}

// Express middleware: records every non-GET request after the response is sent.
// Skips /api/events and /api/health to avoid noise.
export function auditMiddleware(req, res, next) {
  if (req.method === 'GET') return next();
  if (req.path === '/api/events' || req.path === '/api/health') return next();
  if (req.path.startsWith('/api/github/webhook')) return next(); // signed externally

  res.on('finish', () => {
    if (res.statusCode >= 400) return; // only log successful mutations
    record({
      actor: req.auth?.label || req.auth?.tokenId?.toString() || 'anonymous',
      action: `${req.method} ${req.path}`,
      target: req.params?.id || null,
      detail: { status: res.statusCode },
    });
  });
  next();
}
