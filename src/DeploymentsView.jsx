import { useState } from 'react';
import { Rocket, CheckCircle2, XCircle, Clock, GitBranch, RotateCcw, ArrowRight, Play, X, AlertTriangle, Shield } from 'lucide-react';

const ENVIRONMENTS = ['development', 'staging', 'production'];
const SERVICES_LIST = ['api-service', 'frontend', 'worker-service', 'auth-service'];
const BRANCHES = ['main', 'develop', 'release/v3.2', 'hotfix/memory-leak', 'feature/user-prefs'];
const STRATEGIES = ['rolling', 'blue-green', 'canary'];

const INITIAL_DEPLOYS = [
  { id: 'd-001', service: 'api-service', version: 'v2.3.1', commit: 'a8f3c21', msg: 'fix: POST handler memory', by: 'ARC-R Engine', environments: { development: { status: 'passed', time: '12m ago' }, staging: { status: 'passed', time: '8m ago' }, production: { status: 'running', time: '2m ago' } } },
  { id: 'd-002', service: 'frontend', version: 'v3.1.0', commit: 'f2b8d09', msg: 'feat: user preferences UI', by: 'v.kavali', environments: { development: { status: 'passed', time: '2h ago' }, staging: { status: 'passed', time: '1h ago' }, production: { status: 'passed', time: '45m ago' } } },
  { id: 'd-003', service: 'frontend', version: 'v3.0.9', commit: 'c4e1a77', msg: 'chore: bundle optimization', by: 'v.kavali', environments: { development: { status: 'passed', time: '3h ago' }, staging: { status: 'failed', time: '1h ago' }, production: null } },
  { id: 'd-004', service: 'worker-service', version: 'v1.8.2', commit: 'b9d2e44', msg: 'perf: batch processing', by: 'ci-bot', environments: { development: { status: 'passed', time: '5h ago' }, staging: { status: 'passed', time: '4h ago' }, production: { status: 'passed', time: '3h ago' } } },
  { id: 'd-005', service: 'auth-service', version: 'v2.1.0', commit: 'e7f1b33', msg: 'sec: token rotation update', by: 'security-bot', environments: { development: { status: 'passed', time: '8h ago' }, staging: { status: 'passed', time: '7h ago' }, production: { status: 'passed', time: '6h ago' } } },
];

const STATUS_MAP = {
  passed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-500', label: 'Live' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500', label: 'Failed' },
  running: { icon: Play, color: 'text-blue-600', bg: 'bg-blue-500', label: 'Deploying' },
  rolledback: { icon: RotateCcw, color: 'text-amber-600', bg: 'bg-amber-500', label: 'Rolled Back' },
};

export default function DeploymentsView() {
  const [deployments, setDeployments] = useState(INITIAL_DEPLOYS);
  const [notification, setNotification] = useState(null);
  const [showNewDeploy, setShowNewDeploy] = useState(false);
  const [newDeploy, setNewDeploy] = useState({ service: 'api-service', branch: 'main', target: 'development', strategy: 'rolling', healthCheck: true, notes: '' });

  const notify = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 2500); };

  const promote = (depId, fromEnv) => {
    const envIndex = ENVIRONMENTS.indexOf(fromEnv);
    if (envIndex >= ENVIRONMENTS.length - 1) return;
    const toEnv = ENVIRONMENTS[envIndex + 1];
    setDeployments(prev => prev.map(d => {
      if (d.id !== depId) return d;
      const envs = { ...d.environments };
      envs[toEnv] = { status: 'running', time: 'Just now' };
      setTimeout(() => {
        setDeployments(p => p.map(dd => {
          if (dd.id !== depId) return dd;
          const e = { ...dd.environments }; e[toEnv] = { status: 'passed', time: 'Just now' };
          return { ...dd, environments: e };
        }));
      }, 2000);
      return { ...d, environments: envs };
    }));
    notify(`Promoting ${deployments.find(d => d.id === depId)?.service} to ${toEnv}...`);
  };

  const rollback = (depId, env) => {
    setDeployments(prev => prev.map(d => {
      if (d.id !== depId) return d;
      const envs = { ...d.environments }; envs[env] = { status: 'rolledback', time: 'Just now' };
      return { ...d, environments: envs };
    }));
    notify(`Rolled back ${deployments.find(d => d.id === depId)?.service} in ${env}`);
  };

  const createDeploy = () => {
    const commit = Math.random().toString(36).slice(2, 9);
    const ver = `v${Math.floor(Math.random() * 4) + 1}.${Math.floor(Math.random() * 9)}.${Math.floor(Math.random() * 99)}`;
    const envInit = {};
    const targetIdx = ENVIRONMENTS.indexOf(newDeploy.target);
    ENVIRONMENTS.forEach((env, i) => {
      if (i < targetIdx) envInit[env] = { status: 'passed', time: 'Just now' };
      else if (i === targetIdx) envInit[env] = { status: 'running', time: 'Just now' };
      else envInit[env] = null;
    });
    const dep = {
      id: `d-${Date.now()}`, service: newDeploy.service, version: ver, commit,
      msg: newDeploy.notes || `deploy from ${newDeploy.branch}`, by: 'operator',
      environments: envInit,
    };
    setDeployments([dep, ...deployments]);
    setShowNewDeploy(false);
    notify(`Deploying ${dep.service} ${ver} to ${newDeploy.target} (${newDeploy.strategy})...`);
    setTimeout(() => {
      setDeployments(p => p.map(d => d.id !== dep.id ? d : { ...d, environments: { ...d.environments, [newDeploy.target]: { status: 'passed', time: 'Just now' } } }));
    }, 3000);
  };

  return (
    <div className="overflow-y-auto hidden-scrollbar h-full relative">
      {/* Notification toast */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 border-2 border-gray-900 bg-white px-4 py-3 shadow-[4px_4px_0_0_#111827] text-xs font-bold text-gray-900 animate-pulse">{notification}</div>
      )}

      {/* New Deploy modal — comprehensive form */}
      {showNewDeploy && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setShowNewDeploy(false)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[520px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center"><Rocket size={14} className="mr-2" /> New Deployment</h3>
              <button onClick={() => setShowNewDeploy(false)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Service */}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Service *</div>
                <select value={newDeploy.service} onChange={e => setNewDeploy(p => ({ ...p, service: e.target.value }))}
                  className="w-full border-2 border-gray-300 px-3 py-2.5 text-xs font-mono bg-white cursor-pointer focus:outline-none focus:border-gray-900 transition-colors">
                  {SERVICES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* Branch + Commit */}
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
              {/* Target Environment */}
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
              {/* Strategy */}
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
              {/* Pre-deploy health check */}
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
              {/* Notes */}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Deploy Notes</div>
                <textarea value={newDeploy.notes} onChange={e => setNewDeploy(p => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g., Hotfix for memory leak in POST handler..."
                  className="w-full border-2 border-gray-300 px-3 py-2 text-xs font-mono bg-white h-16 resize-none focus:outline-none focus:border-gray-900 transition-colors" />
              </div>
              {/* Warning for production */}
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
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Deployments</h2>
          <button onClick={() => setShowNewDeploy(true)} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 flex items-center cursor-pointer">
            <Rocket size={10} className="mr-1.5" /> New Deploy
          </button>
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
          {deployments.map(dep => (
            <div key={dep.id} className="border border-gray-300 bg-white shadow-[1px_1px_0_0_#111827]">
              <div className="flex items-stretch">
                <div className="w-[200px] shrink-0 p-4 border-r border-gray-200 bg-gray-50">
                  <div className="text-xs font-bold text-gray-900">{dep.service}</div>
                  <div className="text-[10px] font-mono text-gray-400 mt-0.5 flex items-center"><GitBranch size={9} className="mr-1" />{dep.commit}</div>
                  <div className="text-[10px] text-gray-500 mt-1 truncate">{dep.msg}</div>
                  <div className="text-[9px] font-mono text-gray-400 mt-1.5">by {dep.by}</div>
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
                          <button onClick={() => promote(dep.id, env)} className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-gray-300 bg-white hover:bg-gray-50 flex items-center cursor-pointer active:translate-y-px">
                            <ArrowRight size={8} className="mr-0.5" /> Promote
                          </button>
                        )}
                        {(envData.status === 'passed' || envData.status === 'failed') && (
                          <button onClick={() => rollback(dep.id, env)} className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-gray-300 bg-white hover:bg-gray-50 flex items-center cursor-pointer active:translate-y-px">
                            <RotateCcw size={8} className="mr-0.5" /> Rollback
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
