// ============================================================
// API CLIENT — Centralized fetch wrapper + SSE consumer
// ============================================================

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'aops_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode etc */ }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || res.statusText);
    e.status = res.status;
    throw e;
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

  // Auth — validates the current token and returns role/label
  me: () => request('GET', '/api/auth/me'),

  // GitHub
  github: {
    authorize: () => request('GET', '/api/github/authorize'),
    status: () => request('GET', '/api/github/status'),
    disconnect: () => request('DELETE', '/api/github/disconnect'),
    repos: (page = 1) => request('GET', `/api/github/repos?page=${page}`),
    connectRepo: (owner, repo) => request('POST', `/api/github/repos/${owner}/${repo}/connect`),
    disconnectRepo: (owner, repo) => request('DELETE', `/api/github/repos/${owner}/${repo}/disconnect`),
  },

  // Metrics
  metrics: {
    serviceHealth: (serviceId, range = '1h') => request('GET', `/api/metrics/${serviceId}?range=${range}`),
  },

  // Cloud Connectors
  cloud: {
    list: () => request('GET', '/api/cloud'),
    connect: (data) => request('POST', '/api/cloud', data),
    disconnect: (id) => request('DELETE', `/api/cloud/${id}`),
  },

  // API Tokens (admin only)
  tokens: {
    list: () => request('GET', '/api/tokens'),
    mint: (role, label) => request('POST', '/api/tokens', { role, label }),
    revoke: (id) => request('DELETE', `/api/tokens/${id}`),
  },

  // Approval Gates
  gates: {
    list: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return request('GET', `/api/gates${qs ? '?' + qs : ''}`);
    },
    get: (id) => request('GET', `/api/gates/${id}`),
    decide: (id, decision) => request('POST', `/api/gates/${id}/decide`, { decision }),
    create: (data) => request('POST', '/api/gates', data),
  },

  // Audit log (admin only)
  audit: {
    list: (limit = 100, offset = 0) => request('GET', `/api/audit?limit=${limit}&offset=${offset}`),
  },

  // Pipeline templates
  templates: {
    list: (category) => request('GET', `/api/templates${category ? `?category=${encodeURIComponent(category)}` : ''}`),
    get: (id) => request('GET', `/api/templates/${id}`),
    create: (data) => request('POST', '/api/templates', data),
    update: (id, data) => request('PUT', `/api/templates/${id}`, data),
    delete: (id) => request('DELETE', `/api/templates/${id}`),
    instantiate: (id, data) => request('POST', `/api/templates/${id}/instantiate`, data),
  },

  // Artifact registry metadata
  artifacts: {
    list: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return request('GET', `/api/artifacts${qs ? '?' + qs : ''}`);
    },
    get: (id) => request('GET', `/api/artifacts/${id}`),
    register: (data) => request('POST', '/api/artifacts', data),
    delete: (id) => request('DELETE', `/api/artifacts/${id}`),
  },
};

// ── SSE Connection ──
export function subscribeSSE(onEvent) {
  const token = getToken();
  // EventSource can't set Authorization header — pass token as query param.
  const url = `${BASE}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  let es = new EventSource(url);
  let reconnectTimer = null;

  function attach(source) {
    source.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    source.onerror = () => {
      source.close();
      reconnectTimer = setTimeout(() => {
        es = new EventSource(url);
        attach(es);
      }, 3000);
    };
  }
  attach(es);

  return () => {
    es.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}

export default api;
