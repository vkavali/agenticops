import { useEffect, useState, useMemo } from 'react';
import { Rocket, CheckCircle2, XCircle, Clock, GitBranch, RotateCcw, ArrowRight, Play, Pause, Square, X, AlertTriangle, Shield, Search, Filter, Activity } from 'lucide-react';
import { useApp, getTimeAgo } from './store';
import api from './api';

const ENVIRONMENTS = ['development', 'staging', 'production'];
const SERVICES_LIST = ['api-service', 'frontend', 'worker-service', 'auth-service'];
const BRANCHES = ['main', 'develop', 'release/v3.2', 'hotfix/memory-leak', 'feature/user-prefs'];
const STRATEGIES = ['rolling', 'blue-green', 'canary'];

const STATUS_MAP = {
  passed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-500', label: 'Live' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500', label: 'Failed' },
  running: { icon: Play, color: 'text-blue-600', bg: 'bg-blue-500', label: 'Deploying' },
  rolledback: { icon: RotateCcw, color: 'text-amber-600', bg: 'bg-amber-500', label: 'Rolled Back' },
};

export default function DeploymentsView() {
  const {
    deployments, addDeployment, promoteDeployment, rollbackDeployment,
    services, toast,
  } = useApp();

  const [showNewDeploy, setShowNewDeploy] = useState(false);
  const [newDeploy, setNewDeploy] = useState({ service: 'api-service', branch: 'main', target: 'development', strategy: 'rolling', healthCheck: true, notes: '' });
  const [filterService, setFilterService] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const serviceNames = useMemo(() => [...new Set(services.map(s => s.name))], [services]);

  // Filter deployments
  const filteredDeploys = useMemo(() => {
    return deployments.filter(d => {
      if (filterService !== 'all' && d.service !== filterService) return false;
      if (searchQuery && !d.service.includes(searchQuery) && !d.msg.includes(searchQuery) && !d.commit.includes(searchQuery)) return false;
      if (filterStatus !== 'all') {
        const envStatuses = Object.values(d.environments).filter(Boolean).map(e => e.status);
        if (!envStatuses.includes(filterStatus)) return false;
      }
      return true;
    });
  }, [deployments, filterService, filterStatus, searchQuery]);

  const createDeploy = async () => {
    const ver = `v${Math.floor(Math.random() * 4) + 1}.${Math.floor(Math.random() * 9)}.${Math.floor(Math.random() * 99)}`;
    // Mark earlier envs as already-deployed (the user is targeting an env;
    // upstream envs are assumed live). The target env starts empty —
    // beginDeploy() on the backend will set it to 'provisioning' / 'running'
    // through the strategy state machine, and emit deployment:updated SSE
    // events as each phase advances. No client-side timer.
    const envInit = {};
    const targetIdx = ENVIRONMENTS.indexOf(newDeploy.target);
    ENVIRONMENTS.forEach((env, i) => {
      if (i < targetIdx) envInit[env] = { status: 'passed', time: 'Just now', timestamp: Date.now() };
      else envInit[env] = null;
    });

    const dep = await addDeployment({
      service: newDeploy.service, version: ver,
      msg: newDeploy.notes || `deploy from ${newDeploy.branch}`, by: 'operator',
      strategy: newDeploy.strategy,
      environments: envInit,
    });
    if (!dep?.id) { setShowNewDeploy(false); return; }

    setShowNewDeploy(false);
    toast(`Deploying ${newDeploy.service} ${ver} to ${newDeploy.target} (${newDeploy.strategy})...`);

    // Hand off to the real strategy engine. It walks the strategy's phases
    // (rolling | canary | blue-green), updates the env state, opens an
    // approval gate for production, and broadcasts SSE updates the UI
    // already consumes. If the env is gated, the call returns a gate id
    // and waits — the operator decides via the Approvals UI.
    try {
      await api.deployments.promote(dep.id, newDeploy.target);
    } catch (err) {
      toast(`Promote failed: ${err.message}`, 'error');
    }

    // Reset form
    setNewDeploy({ service: 'api-service', branch: 'main', target: 'development', strategy: 'rolling', healthCheck: true, notes: '' });
  };

  return (
    <div className="overflow-y-auto hidden-scrollbar h-full relative">
      {/* New Deploy modal */}
      {showNewDeploy && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setShowNewDeploy(false)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[520px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center"><Rocket size={14} className="mr-2" /> New Deployment</h3>
              <button onClick={() => setShowNewDeploy(false)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Service *</div>
                <select value={newDeploy.service} onChange={e => setNewDeploy(p => ({ ...p, service: e.target.value }))}
                  className="w-full border-2 border-gray-300 px-3 py-2.5 text-xs font-mono bg-white cursor-pointer focus:outline-none focus:border-gray-900 transition-colors">
                  {SERVICES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Branch *</div>
                  <select value={newDeploy.branch} onChange={e => setNewDeploy(p => ({ ...p, branch: e.target.value }))}
                    className="w-full border-2 border-gray-300 px-3 py-2.5 text-xs font-mono bg-white cursor-pointer focus:outline-none focus:border-gray-900 transition-colors">
                    {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Commit</div>
                  <div className="border-2 border-gray-200 px-3 py-2.5 text-xs font-mono text-gray-500 bg-gray-50">HEAD (latest)</div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Target Environment *</div>
                <div className="flex space-x-2">
                  {ENVIRONMENTS.map(env => (
                    <button key={env} onClick={() => setNewDeploy(p => ({ ...p, target: env }))}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2.5 border-2 cursor-pointer text-center transition-all ${
                        newDeploy.target === env ? 'bg-gray-900 text-white border-gray-900 shadow-[2px_2px_0_0_#D1D5DB]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{env}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Deployment Strategy</div>
                <div className="flex space-x-2">
                  {STRATEGIES.map(s => (
                    <button key={s} onClick={() => setNewDeploy(p => ({ ...p, strategy: s }))}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 border-2 cursor-pointer text-center transition-all ${
                        newDeploy.strategy === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between border-2 border-gray-200 p-3">
                <div className="flex items-center space-x-2">
                  <Shield size={14} className="text-gray-500" />
                  <div>
                    <div className="text-xs font-bold text-gray-900">Pre-deploy Health Check</div>
                    <div className="text-[10px] text-gray-400">Run smoke tests before promoting</div>
                  </div>
                </div>
                <button onClick={() => setNewDeploy(p => ({ ...p, healthCheck: !p.healthCheck }))}
                  className={`w-10 h-5 border-2 border-gray-900 cursor-pointer relative transition-colors shrink-0 ${newDeploy.healthCheck ? 'bg-gray-900' : 'bg-white'}`}>
                  <div className={`absolute top-0.5 w-3 h-3 transition-all ${newDeploy.healthCheck ? 'right-0.5 bg-white' : 'left-0.5 bg-gray-900'}`} />
                </button>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Deploy Notes</div>
                <textarea value={newDeploy.notes} onChange={e => setNewDeploy(p => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g., Hotfix for memory leak in POST handler..."
                  className="w-full border-2 border-gray-300 px-3 py-2 text-xs font-mono bg-white h-16 resize-none focus:outline-none focus:border-gray-900 transition-colors" />
              </div>
              {newDeploy.target === 'production' && (
                <div className="bg-amber-50 border-2 border-amber-300 p-3 flex items-start space-x-2">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[10px] text-amber-700"><strong>Production deploy.</strong> This will require approval from at least 1 team member before going live. Auto-rollback is enabled at 5% error rate.</div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <button onClick={() => setShowNewDeploy(false)} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 border-2 border-gray-300 bg-white hover:bg-gray-50 cursor-pointer">Cancel</button>
              <button onClick={createDeploy} className="text-[10px] font-bold uppercase tracking-widest px-6 py-2.5 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 cursor-pointer flex items-center">
                <Rocket size={12} className="mr-1.5" /> Deploy {newDeploy.service} to {newDeploy.target}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Deployments</h2>
          <button onClick={() => setShowNewDeploy(true)} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 flex items-center cursor-pointer">
            <Rocket size={10} className="mr-1.5" /> New Deploy
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex items-center border border-gray-200 bg-white px-2 py-1.5 flex-1 max-w-[280px]">
            <Search size={12} className="text-gray-400 mr-2 shrink-0" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search deploys..."
              className="flex-1 text-[10px] font-mono text-gray-700 outline-none bg-transparent" />
          </div>
          <select value={filterService} onChange={e => setFilterService(e.target.value)}
            className="border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest bg-white cursor-pointer focus:outline-none">
            <option value="all">All Services</option>
            {serviceNames.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest bg-white cursor-pointer focus:outline-none">
            <option value="all">All Status</option>
            <option value="passed">Live</option>
            <option value="running">Deploying</option>
            <option value="failed">Failed</option>
            <option value="rolledback">Rolled Back</option>
          </select>
          <div className="text-[10px] font-mono text-gray-400">{filteredDeploys.length} deploys</div>
        </div>

        <div className="flex items-center mb-4 px-2">
          <div className="w-[200px] shrink-0" />
          {ENVIRONMENTS.map((env, i) => (
            <div key={env} className="flex-1 flex items-center">
              <div className="flex-1 text-center"><span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{env}</span></div>
              {i < ENVIRONMENTS.length - 1 && <ArrowRight size={12} className="text-gray-300 shrink-0 mx-1" />}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {filteredDeploys.map(dep => (
            <div key={dep.id} className="border border-gray-300 bg-white shadow-[1px_1px_0_0_#111827]">
              <div className="flex items-stretch">
                <div className="w-[200px] shrink-0 p-4 border-r border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-gray-900">{dep.service}</div>
                    {dep.strategy && dep.strategy !== 'rolling' && (
                      <span className="text-[8px] font-bold uppercase tracking-widest px-1 py-0.5 border border-gray-900 bg-white text-gray-900">{dep.strategy}</span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-gray-400 mt-0.5 flex items-center"><GitBranch size={9} className="mr-1" />{dep.commit}</div>
                  <div className="text-[10px] text-gray-500 mt-1 truncate">{dep.msg}</div>
                  <div className="text-[9px] font-mono text-gray-400 mt-1.5">by {dep.by}</div>
                  <div className="text-[9px] font-mono text-gray-400">{dep.version}</div>
                </div>
                {ENVIRONMENTS.map((env) => {
                  const envData = dep.environments[env];
                  if (!envData) return (
                    <div key={env} className="flex-1 flex items-center justify-center border-r border-gray-200 last:border-r-0 bg-gray-50/50">
                      <div className="text-center"><div className="text-[10px] text-gray-300 font-mono">—</div><div className="text-[9px] text-gray-300 mt-0.5">Not deployed</div></div>
                    </div>
                  );
                  const st = STATUS_MAP[envData.status] || STATUS_MAP.passed;
                  const StIcon = st.icon;
                  return (
                    <div key={env} className={`flex-1 p-3 border-r border-gray-200 last:border-r-0 flex flex-col items-center justify-center ${envData.status === 'running' ? 'bg-blue-50/30' : ''}`}>
                      <div className="flex items-center space-x-1.5 mb-1">
                        <StIcon size={12} className={`${st.color} ${envData.status === 'running' ? 'animate-spin' : ''}`} />
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${st.color}`}>{st.label}</span>
                      </div>
                      <div className="text-[9px] font-mono text-gray-400">{dep.version}</div>
                      <div className="text-[9px] font-mono text-gray-400 flex items-center mt-0.5"><Clock size={8} className="mr-0.5" />{envData.time}</div>
                      <div className="flex items-center space-x-1.5 mt-2">
                        {envData.status === 'passed' && env !== 'production' && (
                          <button onClick={() => promoteDeployment(dep.id, env)} className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-gray-300 bg-white hover:bg-gray-50 flex items-center cursor-pointer active:translate-y-px">
                            <ArrowRight size={8} className="mr-0.5" /> Promote
                          </button>
                        )}
                        {(envData.status === 'passed' || envData.status === 'failed') && (
                          <button onClick={() => rollbackDeployment(dep.id, env)} className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-gray-300 bg-white hover:bg-gray-50 flex items-center cursor-pointer active:translate-y-px">
                            <RotateCcw size={8} className="mr-0.5" /> Rollback
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {(dep.strategy === 'canary' || dep.strategy === 'blue-green') && <ArgoPanel deploymentId={dep.id} />}
            </div>
          ))}
          {filteredDeploys.length === 0 && (
            <div className="border-2 border-dashed border-gray-300 p-8 text-center">
              <div className="text-xs text-gray-400 font-bold">No deployments match your filters</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Live Argo Rollouts panel — polls /api/deployments/:id/argo/status every 5s.
// Renders nothing (returns null) when the deployment isn't Argo-driven, so it's
// safe to mount unconditionally for any canary/BG row.
function ArgoPanel({ deploymentId }) {
  const { toast } = useApp();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const s = await api.deployments.argoStatus(deploymentId);
        if (!cancelled) setStatus(s);
      } catch { /* ignore */ }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [deploymentId]);

  if (!status) return null;

  const phaseColor = {
    Healthy: 'bg-green-50 text-green-700 border-green-200',
    Progressing: 'bg-blue-50 text-blue-700 border-blue-200',
    Paused: 'bg-amber-50 text-amber-700 border-amber-200',
    Degraded: 'bg-red-50 text-red-700 border-red-200',
  }[status.phase] || 'bg-gray-100 text-gray-700 border-gray-300';

  const promote = async (full = false) => {
    setBusy(true);
    try { await api.deployments.argoPromote(deploymentId, full); toast(full ? 'Promote-full sent' : 'Promote sent', 'success'); }
    catch (err) { toast(`Failed: ${err.message}`, 'error'); }
    setBusy(false);
  };
  const abort = async () => {
    setBusy(true);
    try { await api.deployments.argoAbort(deploymentId); toast('Abort sent', 'warning'); }
    catch (err) { toast(`Failed: ${err.message}`, 'error'); }
    setBusy(false);
  };

  return (
    <div className="border-t-2 border-dashed border-gray-300 bg-gray-50/40 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Activity size={12} className="text-gray-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700">Argo Rollouts</span>
          <span className={`text-[9px] uppercase tracking-widest font-bold border px-1.5 py-0.5 ${phaseColor}`}>{status.phase}</span>
          {status.strategy && (
            <span className="text-[9px] font-mono text-gray-500">{status.strategy}</span>
          )}
          {status.totalSteps != null && status.currentStep != null && (
            <span className="text-[9px] font-mono text-gray-500">step {status.currentStep + 1}/{status.totalSteps}</span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {status.phase === 'Paused' && (
            <button onClick={() => promote(false)} disabled={busy}
              className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white flex items-center disabled:opacity-50">
              <Play size={10} className="mr-1" /> Promote
            </button>
          )}
          {(status.phase === 'Paused' || status.phase === 'Progressing') && (
            <>
              <button onClick={() => promote(true)} disabled={busy}
                className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Promote full
              </button>
              <button onClick={abort} disabled={busy}
                className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 border border-red-300 text-red-600 hover:bg-red-50 flex items-center disabled:opacity-50">
                <Square size={10} className="mr-1" /> Abort
              </button>
            </>
          )}
        </div>
      </div>
      {status.weight != null && (
        <div className="relative h-2 bg-gray-200 border border-gray-900">
          <div className={`absolute left-0 top-0 bottom-0 transition-all ${
            status.phase === 'Healthy' ? 'bg-green-500' :
            status.phase === 'Degraded' ? 'bg-red-500' :
            status.phase === 'Paused' ? 'bg-amber-500' : 'bg-blue-500'
          }`} style={{ width: `${Math.min(100, Math.max(0, status.weight))}%` }} />
          <span className="absolute right-1 -top-3.5 text-[9px] font-mono font-bold text-gray-700">{status.weight}% canary</span>
        </div>
      )}
      {status.activeSelector && (
        <div className="text-[10px] font-mono text-gray-500 mt-1">active: <span className="text-gray-900">{status.activeSelector}</span></div>
      )}
      {status.message && status.phase !== 'Healthy' && (
        <div className="text-[10px] font-mono text-gray-500 mt-1">{status.message}</div>
      )}
    </div>
  );
}
