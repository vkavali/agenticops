// Server-Sent Events manager.
// - Per-client error isolation (one bad socket can't take down broadcasts)
// - 25s heartbeat to keep idle connections alive through proxies
// - Auth: client must present a valid bearer token (header OR ?token=… query)

import { queryOne } from './db.js';
import crypto from 'crypto';

const clients = new Set();
const HEARTBEAT_MS = 25_000;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function authenticate(req) {
  // EventSource can't set headers in browsers — accept ?token= as a fallback.
  const header = req.headers.authorization;
  let raw = null;
  if (header && header.startsWith('Bearer ')) raw = header.slice(7).trim();
  else if (req.query?.token) raw = String(req.query.token);
  if (!raw) return null;
  return queryOne('SELECT id, role FROM api_tokens WHERE token_hash=$1', [hashToken(raw)]);
}

export async function addClient(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid bearer token' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('data: {"type":"connected"}\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(': hb\n\n'); }
    catch { cleanup(); }
  }, HEARTBEAT_MS);

  const client = { res, role: auth.role };
  clients.add(client);

  function cleanup() {
    clearInterval(heartbeat);
    clients.delete(client);
    try { res.end(); } catch {}
  }

  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function broadcast(eventType, data) {
  const payload = `data: ${JSON.stringify({ type: eventType, data })}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch (err) {
      // Drop the bad client; do not let one slow/closed socket block the rest.
      clients.delete(client);
      try { client.res.end(); } catch {}
    }
  }
}

export function clientCount() { return clients.size; }
