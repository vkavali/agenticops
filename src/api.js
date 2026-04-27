// ============================================================
// API CLIENT — Centralized fetch wrapper + SSE consumer
// ============================================================

const BASE = import.meta.env.VITE_API_URL || '';

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const api = {
  // Services
  services: {
    list: () => request('GET', '/api/services'),
    update: (id, data) => request('PATCH', `/api/services/${id}`, data),
  },

  // Pipelines
  pipelines: {
    list: () => request('GET', '/api/pipelines'),
    create: (data) => request('POST', '/api/pipelines', data),
    update: (id, data) => request('PUT', `/api/pipelines/${id}`, data),
    delete: (id) => request('DELETE', `/api/pipelines/${id}`),
    run: (id, data) => request('POST', `/api/pipelines/${id}/run`, data || {}),
  },

  // Deployments
  deployments: {
    list: () => request('GET', '/api/deployments'),
    create: (data) => request('POST', '/api/deployments', data),
    promote: (id, env) => request('POST', `/api/deployments/${id}/promote/${env}`),
    rollback: (id, env) => request('POST', `/api/deployments/${id}/rollback/${env}`),
  },

  // Incidents
  incidents: {
    list: () => request('GET', '/api/incidents'),
    create: (data) => request('POST', '/api/incidents', data),
    ack: (id) => request('POST', `/api/incidents/${id}/ack`),
    resolve: (id) => request('POST', `/api/incidents/${id}/resolve`),
    comment: (id, comment) => request('POST', `/api/incidents/${id}/comment`, { comment }),
    update: (id, data) => request('PATCH', `/api/incidents/${id}`, data),
  },

  // Infrastructure
  infrastructure: {
    nodes: () => request('GET', '/api/infrastructure/nodes'),
    links: () => request('GET', '/api/infrastructure/links'),
    updateNode: (id, data) => request('PATCH', `/api/infrastructure/nodes/${id}`, data),
    remediate: () => request('POST', '/api/infrastructure/remediate'),
    state: () => request('GET', '/api/infrastructure/state'),
  },

  // Settings
  settings: {
    get: (section) => request('GET', `/api/settings/${section}`),
    set: (section, data) => request('PUT', `/api/settings/${section}`, data),
    addItem: (section, item) => request('POST', `/api/settings/${section}/items`, item),
    deleteItem: (section, itemId) => request('DELETE', `/api/settings/${section}/items/${itemId}`),
  },

  // Activity
  activity: {
    list: (limit = 50, offset = 0) => request('GET', `/api/activity?limit=${limit}&offset=${offset}`),
  },

  // Health
  health: () => request('GET', '/api/health'),

  // GitHub
  github: {
    authorize: () => request('GET', '/api/github/authorize'),
    status: () => request('GET', '/api/github/status'),
    disconnect: () => request('DELETE', '/api/github/disconnect'),
    repos: (page = 1) => request('GET', `/api/github/repos?page=${page}`),
    connectRepo: (owner, repo) => request('POST', `/api/github/repos/${owner}/${repo}/connect`),
    disconnectRepo: (owner, repo) => request('DELETE', `/api/github/repos/${owner}/${repo}/disconnect`),
  },
};

// ── SSE Connection ──
export function subscribeSSE(onEvent) {
  const url = `${BASE}/api/events`;
  let es = new EventSource(url);
  let reconnectTimer = null;

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent(data);
    } catch (err) { /* ignore parse errors */ }
  };

  es.onerror = () => {
    es.close();
    // Reconnect after 3s
    reconnectTimer = setTimeout(() => {
      es = new EventSource(url);
      es.onmessage = (e) => {
        try { onEvent(JSON.parse(e.data)); } catch (err) { /* ignore */ }
      };
      es.onerror = () => { es.close(); };
    }, 3000);
  };

  // Return cleanup function
  return () => {
    es.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}

export default api;
