// Server-Sent Events manager
const clients = new Set();

export function addClient(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(eventType, data) {
  const payload = JSON.stringify({ type: eventType, data });
  for (const client of clients) {
    client.write(`data: ${payload}\n\n`);
  }
}

export function clientCount() { return clients.size; }
