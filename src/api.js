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
    argoStatus: (id) => request('GET', `/api/deployments/${id}/argo/status`),
    argoPromote: (id, full = false) => request('POST', `/api/deployments/${id}/argo/promote`, { full }),
    argoAbort: (id) => request('POST', `/api/deployments/${id}/argo/abort`),
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

  // IaC management (Terraform plan/apply, agent-proposed patches)
  iac: {
    listConfigs: () => request('GET', '/api/iac/configs'),
    createConfig: (data) => request('POST', '/api/iac/configs', data),
    updateConfig: (id, data) => request('PUT', `/api/iac/configs/${id}`, data),
    deleteConfig: (id) => request('DELETE', `/api/iac/configs/${id}`),
    listRuns: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return request('GET', `/api/iac/runs${qs ? '?' + qs : ''}`);
    },
    getRun: (id) => request('GET', `/api/iac/runs/${id}`),
    latestProposal: () => request('GET', '/api/iac/latest-proposal'),
    plan: (configId, body = {}) => request('POST', `/api/iac/configs/${configId}/plan`, body),
    apply: (runId, body = {}) => request('POST', `/api/iac/runs/${runId}/apply`, body),
    cancel: (runId) => request('POST', `/api/iac/runs/${runId}/cancel`),
    rollback: (runId, body = {}) => request('POST', `/api/iac/runs/${runId}/rollback`, body),
  },

  // Feature flags + agent-driven gradual rollout
  flags: {
    list: () => request('GET', '/api/flags'),
    get: (key) => request('GET', `/api/flags/${key}`),
    create: (data) => request('POST', '/api/flags', data),
    update: (id, data) => request('PUT', `/api/flags/${id}`, data),
    delete: (id) => request('DELETE', `/api/flags/${id}`),
    addRule: (id, data) => request('POST', `/api/flags/${id}/rules`, data),
    deleteRule: (id, ruleId) => request('DELETE', `/api/flags/${id}/rules/${ruleId}`),
    evaluate: (key, context) => request('POST', `/api/flags/${key}/evaluate`, context || {}),
    startRollout: (id, data) => request('POST', `/api/flags/${id}/rollout`, data || {}),
    pauseRollout: (rolloutId, reason) => request('POST', `/api/flags/rollouts/${rolloutId}/pause`, { reason }),
    resumeRollout: (rolloutId) => request('POST', `/api/flags/rollouts/${rolloutId}/resume`),
    rollbackRollout: (rolloutId, reason) => request('POST', `/api/flags/rollouts/${rolloutId}/rollback`, { reason }),
  },

  // Cloud Cost Management
  cost: {
    daily: (days = 14) => request('GET', `/api/cost/daily?days=${days}`),
    byService: () => request('GET', '/api/cost/by-service'),
    anomalies: () => request('GET', '/api/cost/anomalies'),
    resolveAnomaly: (id) => request('POST', `/api/cost/anomalies/${id}/resolve`),
    recommendations: () => request('GET', '/api/cost/recommendations'),
    dismissRecommendation: (id) => request('POST', `/api/cost/recommendations/${id}/dismiss`),
    sweep: () => request('POST', '/api/cost/sweep'),
  },

  // Chaos Engineering
  chaos: {
    listExperiments: () => request('GET', '/api/chaos/experiments'),
    getExperiment: (id) => request('GET', `/api/chaos/experiments/${id}`),
    createExperiment: (data) => request('POST', '/api/chaos/experiments', data),
    deleteExperiment: (id) => request('DELETE', `/api/chaos/experiments/${id}`),
    runExperiment: (id) => request('POST', `/api/chaos/experiments/${id}/run`),
    listRuns: (limit = 50) => request('GET', `/api/chaos/runs?limit=${limit}`),
    abortRun: (id, reason) => request('POST', `/api/chaos/runs/${id}/abort`, { reason }),
  },

  // IDP service catalog + scorecards
  idp: {
    listServices: () => request('GET', '/api/idp/services'),
    getService: (id) => request('GET', `/api/idp/services/${id}`),
    updateService: (id, data) => request('PATCH', `/api/idp/services/${id}`, data),
    recompute: () => request('POST', '/api/idp/recompute'),
  },

  // STO security scans
  security: {
    listScans: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return request('GET', `/api/security/scans${qs ? '?' + qs : ''}`);
    },
    getScan: (id) => request('GET', `/api/security/scans/${id}`),
    submitScan: (data) => request('POST', '/api/security/scans', data),
    listFindings: (filters = {}) => {
      const qs = new URLSearchParams(filters).toString();
      return request('GET', `/api/security/findings${qs ? '?' + qs : ''}`);
    },
    resolveFinding: (id) => request('POST', `/api/security/findings/${id}/resolve`),
    ignoreFinding: (id) => request('POST', `/api/security/findings/${id}/ignore`),
    blockers: (target) => request('GET', `/api/security/blockers/${encodeURIComponent(target)}`),
  },

  // GitOps
  gitops: {
    listApps: () => request('GET', '/api/gitops/apps'),
    getApp: (id) => request('GET', `/api/gitops/apps/${id}`),
    createApp: (data) => request('POST', '/api/gitops/apps', data),
    updateApp: (id, data) => request('PUT', `/api/gitops/apps/${id}`, data),
    deleteApp: (id) => request('DELETE', `/api/gitops/apps/${id}`),
    sync: (id) => request('POST', `/api/gitops/apps/${id}/sync`),
  },

  // DB DevOps
  dbops: {
    listMigrations: () => request('GET', '/api/dbops/migrations'),
    getMigration: (id) => request('GET', `/api/dbops/migrations/${id}`),
    submitMigration: (data) => request('POST', '/api/dbops/migrations', data),
    markApplied: (id) => request('POST', `/api/dbops/migrations/${id}/applied`),
    rollbackMigration: (id) => request('POST', `/api/dbops/migrations/${id}/rollback`),
    analyze: (sql_text) => request('POST', '/api/dbops/analyze', { sql_text }),
  },

  // SLOs / error budgets
  slos: {
    list: () => request('GET', '/api/slos'),
    get: (id) => request('GET', `/api/slos/${id}`),
    create: (data) => request('POST', '/api/slos', data),
    update: (id, data) => request('PUT', `/api/slos/${id}`, data),
    delete: (id) => request('DELETE', `/api/slos/${id}`),
    evals: (id, limit = 100) => request('GET', `/api/slos/${id}/evals?limit=${limit}`),
    triggerEval: () => request('POST', '/api/slos/eval'),
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
