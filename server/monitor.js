import { query, execute, queryOne } from './db.js';
import { broadcast } from './sse.js';

// ============================================================
// SERVICE HEALTH MONITOR
// ============================================================
// Pings real service URLs, tracks uptime, auto-creates incidents.

const CHECK_INTERVAL = 30000; // 30 seconds
const FAILURE_THRESHOLD = 3;  // 3 consecutive failures = incident
const failureCounts = new Map();

function getNow() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Start monitoring all services that have a health_url configured.
 */
export function startMonitoring() {
  setInterval(async () => {
    try {
      const services = await query('SELECT * FROM services WHERE health_url IS NOT NULL');
      for (const svc of services) {
        await checkService(svc);
      }
    } catch (err) {
      console.error('Monitor tick error:', err);
    }
  }, CHECK_INTERVAL);

  console.log('✓ Health monitor started');
}

async function checkService(svc) {
  const start = Date.now();
  let status = 'healthy';
  let responseTime = 0;
  let statusCode = 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(svc.health_url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AgenticOps-Monitor/1.0' },
    });
    clearTimeout(timeout);

    responseTime = Date.now() - start;
    statusCode = res.status;

    if (res.status >= 500) status = 'down';
    else if (res.status >= 400) status = 'degraded';
    else if (responseTime > 5000) status = 'degraded';
  } catch (err) {
    responseTime = Date.now() - start;
    status = 'down';
    statusCode = 0;
  }

  // Store metric
  await execute(
    'INSERT INTO health_checks (service_id, status, response_time, status_code, checked_at) VALUES ($1,$2,$3,$4,$5)',
    [svc.id, status, responseTime, statusCode, Date.now()]
  );

  // Update service status
  const prevStatus = svc.status;
  if (prevStatus !== status) {
    await execute('UPDATE services SET status=$1 WHERE id=$2', [status, svc.id]);
    broadcast('services:updated', [{ ...svc, status }]);
  }

  // Track failures for auto-incident
  const key = svc.id;
  if (status === 'down') {
    const count = (failureCounts.get(key) || 0) + 1;
    failureCounts.set(key, count);

    if (count === FAILURE_THRESHOLD) {
      // Check if there's already an active incident for this service
      const existing = await queryOne("SELECT id FROM incidents WHERE service=$1 AND status IN ('active','acknowledged')", [svc.name]);
      if (!existing) {
        await autoCreateIncident(svc, responseTime);
      }
    }
  } else {
    // Reset failure count on success
    if (failureCounts.get(key) >= FAILURE_THRESHOLD && status === 'healthy') {
      // Auto-resolve incident if service recovered
      const inc = await queryOne("SELECT * FROM incidents WHERE service=$1 AND status IN ('active','acknowledged') ORDER BY incident_timestamp DESC LIMIT 1", [svc.name]);
      if (inc) {
        const timeline = [...(inc.timeline || []), { time: getNow(), event: `Service recovered — auto-resolved`, type: 'resolved' }];
        await execute("UPDATE incidents SET status='resolved', resolved='Just now', timeline=$1 WHERE id=$2", [JSON.stringify(timeline), inc.id]);
        await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
          [`${inc.id} auto-resolved: ${svc.name} recovered`, 'incident', Date.now()]);
        broadcast('incident:updated', { id: inc.id, status: 'resolved', timeline });
        broadcast('activity:new', { event: `${inc.id} auto-resolved`, type: 'incident', timestamp: Date.now() });
      }
    }
    failureCounts.set(key, 0);
  }
}

async function autoCreateIncident(svc, responseTime) {
  const lastInc = await queryOne("SELECT id FROM incidents ORDER BY incident_timestamp DESC LIMIT 1");
  const lastNum = lastInc ? parseInt(lastInc.id.replace('INC-', ''), 10) : 2847;
  const id = `INC-${lastNum + 1}`;
  const now = Date.now();
  const timeline = [{ time: getNow(), event: `Health check failed: ${svc.health_url} (${FAILURE_THRESHOLD} consecutive failures)`, type: 'alert' }];

  await execute(
    'INSERT INTO incidents (id,title,service,severity,status,opened,incident_timestamp,assignee,description,timeline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, `${svc.name} health check failing`, svc.name, 'critical', 'active', 'Just now', now, 'AgenticOps Monitor', `Automated: ${svc.health_url} returned non-200 or timed out. Last response time: ${responseTime}ms.`, JSON.stringify(timeline)]
  );
  await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
    [`${id} opened: ${svc.name} health check failing`, 'incident', now]);

  broadcast('incident:created', { id, title: `${svc.name} health check failing`, service: svc.name, severity: 'critical', status: 'active', opened: 'Just now', timestamp: now, assignee: 'AgenticOps Monitor', timeline });
  broadcast('activity:new', { event: `${id} auto-created: ${svc.name} down`, type: 'incident', timestamp: now });
}
