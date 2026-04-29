import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api, { subscribeSSE } from './api';

// ============================================================
// HELPERS
// ============================================================

export function getTimeAgo(timestamp) {
  if (!timestamp) return '—';
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function generateId(prefix = '') {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getNow() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function computeHealthScore(incidents, security, services) {
  let score = 100;
  const active = incidents.filter(i => i.status === 'active' || i.status === 'acknowledged');
  active.forEach(i => { score -= i.severity === 'critical' ? 8 : 3; });
  if (!security.mfa) score -= 3;
  if (!security.rbac) score -= 2;
  if (!security.auditLog) score -= 2;
  if (!security.sso) score -= 1;
  services.forEach(s => { if (s.status === 'degraded') score -= 2; if (s.status === 'down') score -= 5; });
  return Math.max(0, Math.min(100, parseFloat(score.toFixed(1))));
}

export function computeSecurityScore(security) {
  let score = 60;
  if (security.mfa) score += 10;
  if (security.sso) score += 8;
  if (security.rbac) score += 8;
  if (security.auditLog) score += 7;
  if (security.ipWhitelist) score += 5;
  if (security.secretRotation) score += 2;
  return Math.min(100, score);
}

const STAGE_DEFAULTS = {
  build: { name: 'Build', image: 'node:20-alpine', commands: ['npm ci', 'npm run build'], timeout: '10m' },
  test: { name: 'Unit Tests', image: 'node:20-alpine', commands: ['npm test -- --coverage'], timeout: '15m' },
  security: { name: 'Security Scan', image: 'aquasec/trivy:latest', commands: ['trivy fs --severity HIGH,CRITICAL .'], timeout: '5m' },
  deploy: { name: 'Deploy', image: 'hashicorp/terraform:latest', commands: ['terraform init', 'terraform apply -auto-approve'], timeout: '20m', env: 'staging' },
  approval: { name: 'Manual Approval', approvers: ['ops-team'], timeout: '1h' },
  script: { name: 'Custom Script', image: 'alpine:latest', commands: ['echo "Hello"'], timeout: '5m' },
};

const ENVIRONMENTS = ['development', 'staging', 'production'];

// ============================================================
// CONTEXT
// ============================================================

const AppContext = createContext(null);

export function AppProvider({ children, me = null }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [services, setServices] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [remediated, setRemediated] = useState(false);
  const [pipelines, setPipelines] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [activity, setActivity] = useState([]);
  const [envs, setEnvs] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [secrets, setSecrets] = useState([]);
  const [team, setTeam] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [policies, setPolicies] = useState({});
  const [security, setSecurity] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [general, setGeneral] = useState({});
  const [toasts, setToasts] = useState([]);
  const [gates, setGates] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [slos, setSlos] = useState([]);
  const [sloEvals, setSloEvals] = useState({}); // { sloId: latestEval }
  const [flags, setFlags] = useState([]);
  const [costAnomalies, setCostAnomalies] = useState([]);
  const [costRecommendations, setCostRecommendations] = useState([]);
  const [chaosExperiments, setChaosExperiments] = useState([]);
  const [catalogServices, setCatalogServices] = useState([]);
  const [securityScans, setSecurityScans] = useState([]);
  const [gitopsApps, setGitopsApps] = useState([]);
  const [dbMigrations, setDbMigrations] = useState([]);
  const [cloudConnectors, setCloudConnectors] = useState([]);

  // ── Hydrate from API on mount ──
  useEffect(() => {
    async function hydrate() {
      try {
        const [svc, pips, deps, incs, act, nds, lnks, infState,
          envData, intData, secData, teamData, whData, polData, securityData, alertData, keyData, genData,
          gatesData, tplData, artData, sloData, flagData,
          costAnomalyData, costRecData, chaosExpData, catalogData,
          scanData, gitopsAppData, migrationData, cloudData,
        ] = await Promise.all([
          api.services.list(),
          api.pipelines.list(),
          api.deployments.list(),
          api.incidents.list(),
          api.activity.list(),
          api.infrastructure.nodes(),
          api.infrastructure.links(),
          api.infrastructure.state(),
          api.settings.get('envs'),
          api.settings.get('integrations'),
          api.settings.get('secrets'),
          api.settings.get('team'),
          api.settings.get('webhooks'),
          api.settings.get('policies'),
          api.settings.get('security'),
          api.settings.get('alerts'),
          api.settings.get('apiKeys'),
          api.settings.get('general'),
          api.gates.list({ status: 'pending' }).catch(() => []),
          api.templates.list().catch(() => []),
          api.artifacts.list({ limit: 50 }).catch(() => []),
          api.slos.list().catch(() => []),
          api.flags.list().catch(() => []),
          api.cost.anomalies().catch(() => []),
          api.cost.recommendations().catch(() => []),
          api.chaos.listExperiments().catch(() => []),
          api.idp.listServices().catch(() => []),
          api.security.listScans({ limit: 50 }).catch(() => []),
          api.gitops.listApps().catch(() => []),
          api.dbops.listMigrations().catch(() => []),
          api.cloud.list().catch(() => []),
        ]);
        setServices(svc);
        setPipelines(pips);
        setDeployments(deps);
        setIncidents(incs);
        setActivity(act);
        setNodes(nds);
        setLinks(lnks);
        setRemediated(infState.remediated);
        setEnvs(envData);
        setIntegrations(intData);
        setSecrets(secData);
        setTeam(teamData);
        setWebhooks(whData);
        setPolicies(polData);
        setSecurity(securityData);
        setAlerts(alertData);
        setApiKeys(keyData);
        setGeneral(genData);
        setGates(gatesData);
        setTemplates(tplData);
        setArtifacts(artData);
        setSlos(sloData);
        setFlags(flagData);
        setCostAnomalies(costAnomalyData);
        setCostRecommendations(costRecData);
        setChaosExperiments(chaosExpData);
        setCatalogServices(catalogData);
        setSecurityScans(scanData);
        setGitopsApps(gitopsAppData);
        setDbMigrations(migrationData);
        setCloudConnectors(cloudData);
      } catch (err) {
        console.error('Failed to hydrate from API:', err);
      }
      setIsHydrated(true);
    }
    hydrate();
  }, []);

  // ── SSE listener for real-time updates ──
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      switch (event.type) {
        case 'services:updated':
          if (Array.isArray(event.data)) setServices(event.data);
          else setServices(prev => prev.map(s => s.id === event.data.id ? { ...s, ...event.data } : s));
          break;
        case 'incident:created':
          setIncidents(prev => {
            if (prev.find(i => i.id === event.data.id)) return prev;
            return [event.data, ...prev];
          });
          break;
        case 'incident:updated':
          setIncidents(prev => prev.map(i => i.id === event.data.id ? { ...i, ...event.data } : i));
          break;
        case 'deployment:created':
          setDeployments(prev => {
            if (prev.find(d => d.id === event.data.id)) return prev;
            return [event.data, ...prev];
          });
          break;
        case 'deployment:updated':
          setDeployments(prev => prev.map(d => d.id === event.data.id ? { ...d, ...event.data } : d));
          break;
        case 'pipeline:run':
          setPipelines(prev => prev.map(p => p.id === event.data.pipelineId
            ? { ...p, lastRun: event.data.run.status, lastRunTime: 'Just now', runs: [event.data.run, ...p.runs] }
            : p));
          break;
        case 'pipeline:deleted':
          setPipelines(prev => prev.filter(p => p.id !== event.data.id));
          break;
        case 'activity:new':
          setActivity(prev => [{ time: 'Just now', ...event.data }, ...prev].slice(0, 100));
          break;
        case 'timestamps:refreshed':
          // Refresh relative timestamps client-side
          setActivity(prev => prev.map(a => ({ ...a, time: getTimeAgo(a.timestamp) })));
          setDeployments(prev => prev.map(d => ({
            ...d,
            environments: Object.fromEntries(
              Object.entries(d.environments || {}).map(([env, data]) => [
                env, data ? { ...data, time: getTimeAgo(data.timestamp) } : null
              ])
            ),
          })));
          setIncidents(prev => prev.map(i => ({ ...i, opened: getTimeAgo(i.timestamp) })));
          break;
        case 'remediation:complete':
          setRemediated(true);
          setNodes(prev => prev.map(n => n.id === 'lambda-post' ? { ...n, status: 'healthy' } : n));
          setServices(prev => prev.map(s => s.name === 'api-service' ? { ...s, status: 'healthy' } : s));
          break;
        case 'node:updated':
          setNodes(prev => prev.map(n => n.id === event.data.id ? { ...n, ...event.data } : n));
          break;
        case 'gate:created':
          setGates(prev => [event.data, ...prev]);
          break;
        case 'gate:updated':
          setGates(prev => prev.map(g => g.id === event.data.id ? { ...g, status: event.data.status } : g));
          break;
        case 'template:created':
          setTemplates(prev => [event.data, ...prev]);
          break;
        case 'artifact:registered':
          setArtifacts(prev => [event.data, ...prev]);
          break;
        case 'slo:created':
          setSlos(prev => [event.data, ...prev]);
          break;
        case 'slo:evaluated':
          setSloEvals(prev => ({ ...prev, [event.data.slo_id]: event.data }));
          break;
        case 'flag:created':
          setFlags(prev => [{ ...event.data, rollout: null }, ...prev]);
          break;
        case 'flag:updated':
          setFlags(prev => prev.map(f => f.id === event.data.id ? { ...f, ...event.data } : f));
          break;
        case 'flag:deleted':
          setFlags(prev => prev.filter(f => f.id !== event.data.id));
          break;
        case 'flag:rollout-started':
          setFlags(prev => prev.map(f => f.id === event.data.flag_id ? { ...f, rollout: event.data } : f));
          break;
        case 'flag:rollout-progress':
        case 'flag:rollout-paused':
        case 'flag:rollout-resumed':
        case 'flag:rollout-rolled-back':
          setFlags(prev => prev.map(f => {
            if (!f.rollout || f.rollout.id !== event.data.id) return f;
            return { ...f, rollout: { ...f.rollout, ...event.data } };
          }));
          break;
        case 'cost:anomaly':
          setCostAnomalies(prev => [event.data, ...prev]);
          break;
        case 'chaos:experiment-created':
          setChaosExperiments(prev => [event.data, ...prev]);
          break;
        case 'chaos:run-finished':
          // Surface as a toast-friendly activity; experiment list refreshes itself.
          break;
        case 'idp:scorecards-computed':
          // Trigger a refresh of catalogServices in the next render — cheap.
          api.idp.listServices().then(setCatalogServices).catch(() => {});
          break;
        case 'security:scan-completed':
          setSecurityScans(prev => [event.data, ...prev].slice(0, 100));
          break;
        case 'gitops:app-created':
          setGitopsApps(prev => [event.data, ...prev]);
          break;
        case 'gitops:sync-finished':
          setGitopsApps(prev => prev.map(a => a.id === event.data.app_id
            ? { ...a, last_sync_status: event.data.status, last_sync_at: Date.now() } : a));
          break;
        case 'db:migration-submitted':
          api.dbops.listMigrations().then(setDbMigrations).catch(() => {});
          break;
      }
    });
    return unsub;
  }, []);

  // ── Toast System ──
  const toast = useCallback((message, severity = 'info') => {
    const id = generateId('toast-');
    setToasts(prev => [...prev, { id, message, severity }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Activity Feed ──
  const addActivity = useCallback((event, type = 'system') => {
    const entry = { time: 'Just now', timestamp: Date.now(), event, type };
    setActivity(prev => [entry, ...prev].slice(0, 100));
  }, []);

  // ── Incident Actions (API write-through) ──
  const createIncident = useCallback(async (data) => {
    try {
      const inc = await api.incidents.create(data);
      setIncidents(prev => {
        if (prev.find(i => i.id === inc.id)) return prev;
        return [inc, ...prev];
      });
      addActivity(`${inc.id} opened: ${data.title}`, 'incident');
      toast(`Incident ${inc.id} created`, 'warning');
      return inc;
    } catch (err) {
      toast(`Failed to create incident: ${err.message}`, 'error');
    }
  }, [addActivity, toast]);

  const acknowledgeIncident = useCallback(async (id) => {
    try {
      await api.incidents.ack(id);
      setIncidents(prev => prev.map(i => {
        if (i.id !== id) return i;
        return { ...i, status: 'acknowledged', timeline: [...(i.timeline || []), { time: getNow(), event: 'Incident acknowledged by operator', type: 'system' }] };
      }));
      addActivity(`${id} acknowledged by operator`, 'incident');
      toast(`${id} acknowledged`);
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [addActivity, toast]);

  const resolveIncident = useCallback(async (id) => {
    try {
      await api.incidents.resolve(id);
      setIncidents(prev => prev.map(i => {
        if (i.id !== id) return i;
        return { ...i, status: 'resolved', resolved: 'Just now', timeline: [...(i.timeline || []), { time: getNow(), event: 'Incident resolved', type: 'resolved' }] };
      }));
      addActivity(`${id} resolved`, 'incident');
      toast(`${id} resolved`, 'success');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [addActivity, toast]);

  const addIncidentComment = useCallback(async (id, comment) => {
    try {
      await api.incidents.comment(id, comment);
      setIncidents(prev => prev.map(i => {
        if (i.id !== id) return i;
        return { ...i, timeline: [...(i.timeline || []), { time: getNow(), event: comment, type: 'comment' }] };
      }));
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [toast]);

  const updateIncident = useCallback(async (id, updates) => {
    try {
      await api.incidents.update(id, updates);
      setIncidents(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [toast]);

  // ── Deployment Actions (API write-through) ──
  const addDeployment = useCallback(async (data) => {
    try {
      const dep = await api.deployments.create(data);
      setDeployments(prev => [dep, ...prev]);
      addActivity(`${dep.by} started deploy of ${dep.service} ${dep.version}`, 'deploy');
      return dep;
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [addActivity, toast]);

  const updateDeployment = useCallback((id, updater) => {
    setDeployments(prev => prev.map(d => d.id === id ? (typeof updater === 'function' ? updater(d) : { ...d, ...updater }) : d));
  }, []);

  const promoteDeployment = useCallback(async (depId, fromEnv) => {
    try {
      const dep = deployments.find(d => d.id === depId);
      const envIndex = ENVIRONMENTS.indexOf(fromEnv);
      if (envIndex >= ENVIRONMENTS.length - 1) return;
      const toEnv = ENVIRONMENTS[envIndex + 1];
      const result = await api.deployments.promote(depId, toEnv);
      if (result?.gated) {
        toast(`${toEnv} requires approval — gate ${result.gateId} pending`, 'warning');
      } else {
        toast(`Promoting to ${toEnv}...`);
      }
      addActivity(`Promoting ${dep?.service} ${dep?.version} to ${toEnv}`, 'deploy');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [deployments, addActivity, toast]);

  const decideGate = useCallback(async (gateId, decision) => {
    try {
      await api.gates.decide(gateId, decision);
      setGates(prev => prev.map(g => g.id === gateId ? { ...g, status: decision } : g));
      toast(`Gate ${decision}`, decision === 'approved' ? 'success' : 'warning');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [toast]);

  const rollbackDeployment = useCallback(async (depId, env) => {
    try {
      const dep = deployments.find(d => d.id === depId);
      await api.deployments.rollback(depId, env);
      addActivity(`Rolled back ${dep?.service} in ${env}`, 'deploy');
      toast(`Rolled back in ${env}`, 'warning');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [deployments, addActivity, toast]);

  // ── Pipeline Actions (API write-through) ──
  const updatePipeline = useCallback(async (id, updater) => {
    const pipe = pipelines.find(p => p.id === id);
    const updated = typeof updater === 'function' ? updater(pipe) : { ...pipe, ...updater };
    setPipelines(prev => prev.map(p => p.id === id ? updated : p));
    try {
      await api.pipelines.update(id, { name: updated.name, branch: updated.branch, stages: updated.stages });
    } catch (err) { toast(`Failed to save: ${err.message}`, 'error'); }
  }, [pipelines, toast]);

  const addPipelineRun = useCallback(async (pipeId, runData) => {
    try {
      const run = await api.pipelines.run(pipeId, { message: runData?.msg, by: runData?.by });
      // SSE will handle adding the run to local state
      return run;
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [toast]);

  const addPipeline = useCallback(async (data) => {
    try {
      const p = await api.pipelines.create(data);
      setPipelines(prev => [...prev, { ...p, trigger: p.trigger_config, runs: [] }]);
      addActivity(`Pipeline "${p.name}" created`, 'pipeline');
      toast('Pipeline created', 'success');
      return p;
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [addActivity, toast]);

  const deletePipeline = useCallback(async (id) => {
    try {
      const p = pipelines.find(pp => pp.id === id);
      await api.pipelines.delete(id);
      setPipelines(prev => prev.filter(pp => pp.id !== id));
      addActivity(`Pipeline "${p?.name}" deleted`, 'pipeline');
      toast('Pipeline deleted', 'warning');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [pipelines, addActivity, toast]);

  // ── Remediation (API write-through) ──
  const executeRemediation = useCallback(async () => {
    try {
      await api.infrastructure.remediate();
      // SSE will handle state updates (remediation:complete event)
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  }, [toast]);

  // ── Settings Actions ──
  const resetStore = useCallback(() => {
    window.location.reload();
  }, []);

  // ── Computed Values ──
  const activeIncidentCount = incidents.filter(i => i.status === 'active' || i.status === 'acknowledged').length;
  const healthScore = computeHealthScore(incidents, security, services);
  const securityScore = computeSecurityScore(security);
  const deploysToday = deployments.filter(d => Date.now() - d.timestamp < 86400000).length;
  const pipelineStats = {
    total: pipelines.reduce((acc, p) => acc + (p.runs?.length || 0), 0),
    passed: pipelines.reduce((acc, p) => acc + (p.runs || []).filter(r => r.status === 'passed').length, 0),
    failed: pipelines.reduce((acc, p) => acc + (p.runs || []).filter(r => r.status === 'failed').length, 0),
    running: pipelines.reduce((acc, p) => acc + (p.runs || []).filter(r => r.status === 'running').length, 0),
  };

  const value = {
    isHydrated,
    me,
    services, setServices,
    nodes, setNodes,
    links,
    remediated, setRemediated,
    pipelines, setPipelines,
    deployments, setDeployments,
    incidents, setIncidents,
    activity, setActivity,
    envs, setEnvs,
    integrations, setIntegrations,
    secrets, setSecrets,
    team, setTeam,
    webhooks, setWebhooks,
    policies, setPolicies,
    security, setSecurity,
    alerts, setAlerts,
    apiKeys, setApiKeys,
    general, setGeneral,
    gates, setGates,
    templates, setTemplates,
    artifacts, setArtifacts,
    slos, setSlos,
    sloEvals,
    flags, setFlags,
    costAnomalies, setCostAnomalies,
    costRecommendations, setCostRecommendations,
    chaosExperiments, setChaosExperiments,
    catalogServices, setCatalogServices,
    securityScans, setSecurityScans,
    gitopsApps, setGitopsApps,
    dbMigrations, setDbMigrations,
    cloudConnectors, setCloudConnectors,
    toasts,
    activeIncidentCount, healthScore, securityScore, deploysToday, pipelineStats,
    toast, dismissToast, addActivity,
    createIncident, acknowledgeIncident, resolveIncident, addIncidentComment, updateIncident,
    addDeployment, updateDeployment, promoteDeployment, rollbackDeployment, decideGate,
    updatePipeline, addPipelineRun, addPipeline, deletePipeline,
    executeRemediation, resetStore,
    ENVIRONMENTS, STAGE_DEFAULTS,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export default AppContext;
