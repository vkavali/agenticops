import { query, execute, queryOne } from './db.js';
import { broadcast } from './sse.js';

const SERVICE_NAMES = ['api-service', 'frontend', 'worker-service', 'auth-service'];
const COMMIT_MSGS = [
  'fix: resolve race condition', 'feat: add batch export', 'chore: update dependencies',
  'perf: optimize caching', 'fix: null pointer in auth', 'feat: webhook retry logic',
];

function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getNow() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function startSimulation() {
  // Metric fluctuation every 5s
  setInterval(async () => {
    try {
      const services = await query('SELECT * FROM services');
      for (const s of services) {
        const cpu = Math.max(2, Math.min(95, s.cpu + Math.round(rand(-5, 5))));
        const mem = Math.max(10, Math.min(95, s.memory + Math.round(rand(-3, 3))));
        await execute('UPDATE services SET cpu=$1, memory=$2 WHERE id=$3', [cpu, mem, s.id]);
      }
      const updated = await query('SELECT * FROM services');
      broadcast('services:updated', updated);
    } catch (e) { /* ignore tick errors */ }
  }, 5000);

  // Timestamp refresh every 30s
  setInterval(async () => {
    try {
      // Refresh incident opened times
      const incidents = await query('SELECT id, incident_timestamp FROM incidents');
      for (const i of incidents) {
        await execute('UPDATE incidents SET opened=$1 WHERE id=$2', [getTimeAgo(Number(i.incident_timestamp)), i.id]);
      }
      broadcast('timestamps:refreshed', { at: Date.now() });
    } catch (e) { /* ignore */ }
  }, 30000);

  // Random events every 60-120s
  const scheduleEvent = () => {
    const delay = rand(60000, 120000);
    setTimeout(async () => {
      try {
        // 15% chance pipeline activity
        if (Math.random() < 0.15) {
          const svc = pick(SERVICE_NAMES);
          const msg = pick(COMMIT_MSGS);
          const now = Date.now();
          await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
            [`ci-bot: Pipeline ${svc}/deploy triggered (${msg.split(':')[0].trim()})`, 'pipeline', now]);
          broadcast('activity:new', { event: `ci-bot: Pipeline ${svc}/deploy triggered`, type: 'pipeline', timestamp: now });
        }

        // 5% chance minor incident
        if (Math.random() < 0.05) {
          const activeCount = await queryOne("SELECT COUNT(*) as count FROM incidents WHERE status='active'");
          if (parseInt(activeCount.count) < 3) {
            const svc = pick(SERVICE_NAMES);
            const lastInc = await queryOne("SELECT id FROM incidents ORDER BY incident_timestamp DESC LIMIT 1");
            const lastNum = lastInc ? parseInt(lastInc.id.replace('INC-', ''), 10) : 2847;
            const id = `INC-${lastNum + 1}`;
            const now = Date.now();
            const timeline = [{ time: getNow(), event: 'Incident created (automated detection)', type: 'alert' }];
            await execute(
              'INSERT INTO incidents (id,title,service,severity,status,opened,incident_timestamp,assignee,description,timeline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
              [id, `Elevated error rate on ${svc}`, svc, 'warning', 'active', 'Just now', now, 'ARC-R Engine', `Automated detection: error rate exceeded threshold on ${svc}.`, JSON.stringify(timeline)]
            );
            await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)', [`${id} opened: Elevated error rate on ${svc}`, 'incident', now]);
            broadcast('incident:created', { id, title: `Elevated error rate on ${svc}`, service: svc, severity: 'warning', status: 'active', opened: 'Just now', timestamp: now, assignee: 'ARC-R Engine', timeline });
          }
        }
      } catch (e) { /* ignore */ }
      scheduleEvent();
    }, delay);
  };
  scheduleEvent();

  console.log('✓ Simulation engine started');
}
