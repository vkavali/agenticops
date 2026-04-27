import { useState, useRef } from 'react';
import {
  Shield, Globe, Bell, Users, Server, Key, GitBranch, Cloud, Webhook,
  Plus, Trash2, Eye, EyeOff, CheckCircle2, XCircle, X, Copy, RefreshCw,
  Rocket, Settings2, ChevronDown, ChevronRight, AlertTriangle, Lock, Mail, Smartphone
} from 'lucide-react';
import { useApp, generateId } from './store';
import ConfirmDialog from './components/ConfirmDialog';

// ─── SECTIONS ────────────────────────────────────────────
const SECTIONS = [
  { id: 'environments', label: 'Environments', icon: Globe },
  { id: 'integrations', label: 'Integrations', icon: Cloud },
  { id: 'secrets', label: 'Secrets & Vars', icon: Key },
  { id: 'team', label: 'Team & Access', icon: Users },
  { id: 'deploy-policies', label: 'Deploy Policies', icon: Rocket },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'api-keys', label: 'API Keys', icon: Lock },
  { id: 'general', label: 'General', icon: Settings2 },
];

// ─── COMPONENT ───────────────────────────────────────────
export default function SettingsView() {
  const {
    envs, setEnvs, integrations, setIntegrations, secrets, setSecrets,
    team, setTeam, webhooks, setWebhooks, policies, setPolicies,
    security, setSecurity, alerts, setAlerts, apiKeys, setApiKeys,
    general, setGeneral, toast, addActivity, resetStore,
  } = useApp();

  const [section, setSection] = useState('environments');
  const [expandedEnv, setExpandedEnv] = useState(null);
  const [showReveal, setShowReveal] = useState({});
  const [showAddModal, setShowAddModal] = useState(null);
  const [modalValues, setModalValues] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);

  const sec = SECTIONS.find(s => s.id === section);
  const SecIcon = sec?.icon;

  const openAddModal = (config) => {
    setModalValues({});
    config.fields.forEach(f => { if (f.default) setModalValues(prev => ({ ...prev, [f.key]: f.default })); });
    setShowAddModal(config);
  };

  const handleModalAdd = () => {
    if (showAddModal?.onAdd) showAddModal.onAdd(modalValues);
    setShowAddModal(null);
    setModalValues({});
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => toast('Failed to copy', 'warning'));
  };

  return (
    <div className="flex h-full relative">
      {/* Confirm Dialog */}
      {confirmAction && <ConfirmDialog title={confirmAction.title} message={confirmAction.message} confirmLabel={confirmAction.label} onConfirm={() => { confirmAction.action(); setConfirmAction(null); }} onCancel={() => setConfirmAction(null)} />}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setShowAddModal(null)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[420px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">{showAddModal.title}</h3>
              <button onClick={() => setShowAddModal(null)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
            </div>
            <div className="space-y-3 mb-6">
              {showAddModal.fields.map(f => (
                <div key={f.key}>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{f.label}</div>
                  {f.type === 'select' ? (
                    <select value={modalValues[f.key] || f.default || ''} onChange={e => setModalValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full border border-gray-200 px-3 py-2 text-xs font-mono bg-gray-50 cursor-pointer focus:outline-none focus:border-gray-900">
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type || 'text'} placeholder={f.placeholder} value={modalValues[f.key] || ''}
                      onChange={e => setModalValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full border border-gray-200 px-3 py-2 text-xs font-mono bg-gray-50 focus:outline-none focus:border-gray-900" />
                  )}
                </div>
              ))}
            </div>
            <button onClick={handleModalAdd}
              className="w-full text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 cursor-pointer flex items-center justify-center">
              <Plus size={12} className="mr-1.5" /> {showAddModal.buttonLabel || 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="w-56 border-r border-gray-300 bg-white shrink-0 flex flex-col overflow-y-auto hidden-scrollbar">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Configuration</h2>
        </div>
        <nav className="flex-1 py-2 px-3">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            return (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`w-full flex items-center px-2 py-2 mb-0.5 text-xs font-bold transition-all cursor-pointer ${
                  section === s.id ? 'text-gray-900 bg-gray-50 border-l-2 border-gray-900' : 'text-gray-500 hover:text-gray-900 border-l-2 border-transparent'
                }`}>
                <Icon size={13} className="mr-2 shrink-0" />{s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto hidden-scrollbar p-6">
        <div className="max-w-[800px]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center">
              {SecIcon && <SecIcon size={16} className="mr-2" />} {sec?.label}
            </h3>
          </div>

          {/* ═══ ENVIRONMENTS ═══ */}
          {section === 'environments' && (
            <div className="space-y-3">
              {envs.map(env => (
                <div key={env.id} className="border border-gray-300 bg-white shadow-[1px_1px_0_0_#111827]">
                  <div onClick={() => setExpandedEnv(expandedEnv === env.id ? null : env.id)}
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 ${env.name === 'production' ? 'bg-green-500' : env.name === 'staging' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                      <div>
                        <div className="text-xs font-bold text-gray-900 uppercase">{env.name}</div>
                        <div className="text-[10px] font-mono text-gray-400">{env.url}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-[9px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5">{env.region}</span>
                      <span className="text-[9px] font-mono text-gray-400">{env.vars.length} vars</span>
                      {expandedEnv === env.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                  </div>
                  {expandedEnv === env.id && (
                    <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <EditField label="Region" value={env.region} onChange={v => setEnvs(p => p.map(e => e.id === env.id ? { ...e, region: v } : e))} />
                        <EditField label="URL" value={env.url} onChange={v => setEnvs(p => p.map(e => e.id === env.id ? { ...e, url: v } : e))} />
                        <EditField label="Health Check" value={env.healthCheck} onChange={v => setEnvs(p => p.map(e => e.id === env.id ? { ...e, healthCheck: v } : e))} />
                        <div className="flex items-center justify-between border border-gray-200 bg-white p-3">
                          <span className="text-[10px] font-bold text-gray-400 uppercase">Require Approvals</span>
                          <Toggle value={env.approvals} onChange={() => { setEnvs(p => p.map(e => e.id === env.id ? { ...e, approvals: !e.approvals } : e)); toast(`${env.name}: approvals ${!env.approvals ? 'enabled' : 'disabled'}`); }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Environment Variables</span>
                          <button onClick={() => openAddModal({
                            title: `Add Variable — ${env.name}`, buttonLabel: 'Add Variable',
                            fields: [{ key: 'key', label: 'Key', placeholder: 'MY_VARIABLE' }, { key: 'value', label: 'Value', placeholder: 'value' }],
                            onAdd: (vals) => { setEnvs(p => p.map(e => e.id === env.id ? { ...e, vars: [...e.vars, { key: vals.key || 'NEW_VAR', value: vals.value || '' }] } : e)); toast('Variable added'); }
                          })} className="text-[9px] font-bold text-gray-500 hover:text-gray-900 flex items-center cursor-pointer"><Plus size={10} className="mr-0.5" /> Add</button>
                        </div>
                        <div className="space-y-1">
                          {env.vars.map((v, i) => (
                            <div key={i} className="flex items-center justify-between bg-white border border-gray-200 px-3 py-1.5">
                              <span className="text-[10px] font-mono font-bold text-gray-700">{v.key}</span>
                              <div className="flex items-center space-x-2">
                                <input type="text" value={v.value} onChange={e => { const newVars = [...env.vars]; newVars[i] = { ...newVars[i], value: e.target.value }; setEnvs(p => p.map(en => en.id === env.id ? { ...en, vars: newVars } : en)); }}
                                  className="text-[10px] font-mono text-gray-500 bg-transparent border-none outline-none w-24 text-right" />
                                <button onClick={() => { setEnvs(p => p.map(e => e.id === env.id ? { ...e, vars: e.vars.filter((_, j) => j !== i) } : e)); toast('Variable removed'); }}
                                  className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={10} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => setConfirmAction({ title: 'Delete Environment', message: `Are you sure you want to delete "${env.name}"? This cannot be undone.`, label: 'Delete', action: () => { setEnvs(p => p.filter(e => e.id !== env.id)); setExpandedEnv(null); toast(`Environment "${env.name}" deleted`, 'warning'); } })}
                        className="text-[10px] font-bold text-red-500 hover:text-red-700 flex items-center cursor-pointer"><Trash2 size={10} className="mr-1" /> Delete Environment</button>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => openAddModal({
                title: 'Create Environment', buttonLabel: 'Create',
                fields: [{ key: 'name', label: 'Name', placeholder: 'qa' }, { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'] }, { key: 'url', label: 'URL', placeholder: 'https://qa.agenticops.io' }],
                onAdd: (vals) => { setEnvs(p => [...p, { id: generateId('env-'), name: vals.name || 'new-env', region: vals.region || 'us-east-1', url: vals.url || '', autoPromote: false, approvals: false, healthCheck: '', vars: [] }]); toast('Environment created', 'success'); addActivity(`Environment "${vals.name || 'new-env'}" created`, 'system'); }
              })} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer transition-all flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Add Environment
              </button>
            </div>
          )}

          {/* ═══ INTEGRATIONS ═══ */}
          {section === 'integrations' && (
            <div className="grid grid-cols-2 gap-3">
              {integrations.map(int => (
                <div key={int.id} className={`border bg-white p-4 transition-all ${int.status === 'connected' ? 'border-gray-300 shadow-[1px_1px_0_0_#111827]' : 'border-gray-200 opacity-70'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">{int.icon}</span>
                      <div><div className="text-xs font-bold text-gray-900">{int.name}</div><div className="text-[9px] font-mono text-gray-400 uppercase">{int.type}</div></div>
                    </div>
                    <div className={`flex items-center space-x-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${int.status === 'connected' ? 'text-green-700 bg-green-50 border-green-200' : 'text-gray-400 bg-gray-50 border-gray-200'}`}>
                      {int.status === 'connected' ? <CheckCircle2 size={9} /> : <XCircle size={9} />}<span>{int.status}</span>
                    </div>
                  </div>
                  {int.status === 'connected' ? (
                    <div className="space-y-1 mb-3">
                      <div className="flex justify-between text-[10px]"><span className="text-gray-400">Account</span><span className="font-mono text-gray-700">{int.account}</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-gray-400">Last Sync</span><span className="font-mono text-gray-700">{int.lastSync}</span></div>
                    </div>
                  ) : <div className="h-8" />}
                  <button onClick={() => {
                    setIntegrations(p => p.map(i => i.id === int.id ? { ...i, status: i.status === 'connected' ? 'disconnected' : 'connected', account: i.status === 'connected' ? '—' : 'connected-account', lastSync: i.status === 'connected' ? '—' : 'Just now' } : i));
                    toast(`${int.name} ${int.status === 'connected' ? 'disconnected' : 'connected'}`, int.status === 'connected' ? 'warning' : 'success');
                    addActivity(`Integration ${int.name} ${int.status === 'connected' ? 'disconnected' : 'connected'}`, 'system');
                  }} className={`w-full text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border cursor-pointer text-center ${int.status === 'connected' ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'}`}>
                    {int.status === 'connected' ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ═══ SECRETS ═══ */}
          {section === 'secrets' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 p-3 flex items-start space-x-2">
                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[10px] text-amber-700">Secret values are encrypted at rest. Only users with <span className="font-bold">admin</span> or <span className="font-bold">owner</span> roles can view or rotate secrets.</div>
              </div>
              {secrets.map(s => (
                <div key={s.id} className="border border-gray-300 bg-white flex items-center justify-between p-3 shadow-[1px_1px_0_0_#111827]">
                  <div className="flex items-center space-x-3">
                    <Key size={12} className="text-gray-400" />
                    <div>
                      <div className="text-[10px] font-mono font-bold text-gray-900">{s.key}</div>
                      <div className="text-[9px] font-mono text-gray-400">Created {s.created} · Rotated {s.rotated}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono text-gray-400">{showReveal[s.id] ? s.value : '●●●●●●●●'}</span>
                    <button onClick={() => setShowReveal(p => ({ ...p, [s.id]: !p[s.id] }))} className="text-gray-400 hover:text-gray-900 cursor-pointer">
                      {showReveal[s.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button onClick={() => copyToClipboard(s.value)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><Copy size={12} /></button>
                    <button onClick={() => { setSecrets(p => p.map(ss => ss.id === s.id ? { ...ss, rotated: 'Just now', value: Math.random().toString(36).slice(2, 10) + '***' } : ss)); toast(`${s.key} rotated`, 'success'); addActivity(`Secret ${s.key} rotated`, 'system'); }}
                      className="text-gray-400 hover:text-gray-900 cursor-pointer"><RefreshCw size={12} /></button>
                    <button onClick={() => setConfirmAction({ title: 'Delete Secret', message: `Are you sure you want to delete "${s.key}"? This cannot be undone.`, label: 'Delete', action: () => { setSecrets(p => p.filter(ss => ss.id !== s.id)); toast(`${s.key} deleted`, 'warning'); } })}
                      className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
              <button onClick={() => openAddModal({
                title: 'Add Secret', buttonLabel: 'Create Secret',
                fields: [{ key: 'key', label: 'Key', placeholder: 'API_KEY' }, { key: 'value', label: 'Value', placeholder: 'secret-value', type: 'password' }],
                onAdd: (vals) => { setSecrets(p => [...p, { id: generateId('s-'), key: vals.key || 'NEW_SECRET', value: vals.value || '***', created: 'Just now', rotated: 'Just now' }]); toast('Secret created', 'success'); addActivity(`Secret ${vals.key || 'NEW_SECRET'} created`, 'system'); }
              })} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Add Secret
              </button>
            </div>
          )}

          {/* ═══ TEAM ═══ */}
          {section === 'team' && (
            <div className="space-y-3">
              {team.map(u => (
                <div key={u.id} className="border border-gray-300 bg-white flex items-center justify-between p-4 shadow-[1px_1px_0_0_#111827]">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gray-900 text-white flex items-center justify-center text-xs font-bold">{u.name.split(' ').map(n => n[0]).join('')}</div>
                    <div><div className="text-xs font-bold text-gray-900">{u.name}</div><div className="text-[10px] font-mono text-gray-400">{u.email}</div></div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] font-mono text-gray-400">Last: {u.lastLogin}</span>
                    <select value={u.role} onChange={e => { setTeam(p => p.map(t => t.id === u.id ? { ...t, role: e.target.value } : t)); toast(`${u.name} role → ${e.target.value}`); addActivity(`${u.name} role changed to ${e.target.value}`, 'system'); }}
                      className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border cursor-pointer ${
                        u.role === 'owner' ? 'bg-gray-900 text-white border-gray-900' :
                        u.role === 'admin' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        u.role === 'deployer' ? 'bg-green-50 text-green-700 border-green-200' :
                        'bg-gray-50 text-gray-600 border-gray-200'
                      }`}>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="deployer">Deployer</option>
                      <option value="auditor">Auditor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    {u.role !== 'owner' && (
                      <button onClick={() => setConfirmAction({ title: 'Remove Member', message: `Remove ${u.name} from the team?`, label: 'Remove', action: () => { setTeam(p => p.filter(t => t.id !== u.id)); toast(`${u.name} removed`, 'warning'); addActivity(`${u.name} removed from team`, 'system'); } })}
                        className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={() => openAddModal({
                title: 'Invite Team Member', buttonLabel: 'Send Invite',
                fields: [{ key: 'name', label: 'Full Name', placeholder: 'John Doe' }, { key: 'email', label: 'Email', placeholder: 'user@company.com', type: 'email' }, { key: 'role', label: 'Role', type: 'select', default: 'deployer', options: ['admin', 'deployer', 'auditor', 'viewer'] }],
                onAdd: (vals) => { setTeam(p => [...p, { id: generateId('u-'), name: vals.name || 'Invited User', email: vals.email || 'invited@company.com', role: vals.role || 'deployer', status: 'invited', lastLogin: '—' }]); toast('Invite sent', 'success'); addActivity(`${vals.name || 'New member'} invited to team`, 'system'); }
              })} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Invite Member
              </button>
            </div>
          )}

          {/* ═══ DEPLOY POLICIES ═══ */}
          {section === 'deploy-policies' && (
            <div className="space-y-4">
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Deployment Strategy</div>
                <div className="flex space-x-2">
                  {['rolling', 'blue-green', 'canary'].map(s => (
                    <button key={s} onClick={() => { setPolicies(p => ({ ...p, deployStrategy: s })); toast(`Strategy → ${s}`); }}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 border cursor-pointer transition-all text-center ${
                        policies.deployStrategy === s ? 'bg-gray-900 text-white border-gray-900 shadow-[2px_2px_0_0_#D1D5DB]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ToggleField label="Auto-Rollback" value={policies.autoRollback} onChange={() => { setPolicies(p => ({ ...p, autoRollback: !p.autoRollback })); toast(`Auto-Rollback ${!policies.autoRollback ? 'enabled' : 'disabled'}`); }} />
                <EditField label="Rollback Threshold" value={policies.rollbackThreshold} onChange={v => setPolicies(p => ({ ...p, rollbackThreshold: v }))} />
                <ToggleField label="Approval Required" value={policies.approvalRequired} onChange={() => { setPolicies(p => ({ ...p, approvalRequired: !p.approvalRequired })); toast(`Approval ${!policies.approvalRequired ? 'required' : 'not required'}`); }} />
                <EditField label="Min Approvers" value={String(policies.minApprovers)} onChange={v => setPolicies(p => ({ ...p, minApprovers: parseInt(v) || 1 }))} />
                <EditField label="Deploy Window" value={policies.deployWindow} onChange={v => setPolicies(p => ({ ...p, deployWindow: v }))} />
                <ToggleField label="Deploy Freeze" value={policies.freezePeriod} onChange={() => { setPolicies(p => ({ ...p, freezePeriod: !p.freezePeriod })); toast(`Deploy Freeze ${!policies.freezePeriod ? 'enabled' : 'disabled'}`, !policies.freezePeriod ? 'warning' : 'info'); }} />
                <EditField label="Max Concurrent Deploys" value={String(policies.maxConcurrent)} onChange={v => setPolicies(p => ({ ...p, maxConcurrent: parseInt(v) || 1 }))} />
                <EditField label="Health Check Timeout" value={policies.healthCheckTimeout} onChange={v => setPolicies(p => ({ ...p, healthCheckTimeout: v }))} />
                <EditField label="Warmup Period" value={policies.warmupPeriod} onChange={v => setPolicies(p => ({ ...p, warmupPeriod: v }))} />
              </div>
            </div>
          )}

          {/* ═══ SECURITY ═══ */}
          {section === 'security' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <ToggleField label="Require MFA" value={security.mfa} onChange={() => { setSecurity(p => ({ ...p, mfa: !p.mfa })); toast(`MFA ${!security.mfa ? 'enabled' : 'disabled'}`); }} />
                <ToggleField label="SSO Enabled" value={security.sso} onChange={() => { setSecurity(p => ({ ...p, sso: !p.sso })); toast(`SSO ${!security.sso ? 'enabled' : 'disabled'}`); }} />
                <EditField label="SSO Provider" value={security.ssoProvider} onChange={v => setSecurity(p => ({ ...p, ssoProvider: v }))} />
                <EditField label="Session TTL" value={security.sessionTtl} onChange={v => setSecurity(p => ({ ...p, sessionTtl: v }))} />
                <EditField label="IP Whitelist" value={security.ipWhitelist} onChange={v => setSecurity(p => ({ ...p, ipWhitelist: v }))} />
                <ToggleField label="Audit Logging" value={security.auditLog} onChange={() => { setSecurity(p => ({ ...p, auditLog: !p.auditLog })); toast(`Audit logging ${!security.auditLog ? 'enabled' : 'disabled'}`); }} />
                <EditField label="Secret Rotation" value={security.secretRotation} onChange={v => setSecurity(p => ({ ...p, secretRotation: v }))} />
                <ToggleField label="RBAC Enforcement" value={security.rbac} onChange={() => { setSecurity(p => ({ ...p, rbac: !p.rbac })); toast(`RBAC ${!security.rbac ? 'enabled' : 'disabled'}`); }} />
              </div>
            </div>
          )}

          {/* ═══ NOTIFICATIONS ═══ */}
          {section === 'notifications' && (
            <div className="space-y-3">
              {alerts.map(a => (
                <div key={a.id} className={`border bg-white flex items-center justify-between p-3 transition-all ${a.enabled ? 'border-gray-300 shadow-[1px_1px_0_0_#111827]' : 'border-gray-200 opacity-60'}`}>
                  <div className="flex items-center space-x-3">
                    <Toggle value={a.enabled} onChange={() => { setAlerts(p => p.map(al => al.id === a.id ? { ...al, enabled: !al.enabled } : al)); toast(`${a.name} ${!a.enabled ? 'enabled' : 'disabled'}`); }} />
                    <div>
                      <div className="text-xs font-bold text-gray-900">{a.name}</div>
                      <div className="text-[10px] font-mono text-gray-400 flex items-center space-x-2">
                        <span className={`px-1 py-0.5 border text-[9px] font-bold uppercase ${
                          a.severity === 'critical' ? 'bg-red-50 text-red-600 border-red-200' :
                          a.severity === 'warning' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                          'bg-gray-50 text-gray-500 border-gray-200'
                        }`}>{a.severity}</span>
                        <span>→ {a.channel}: {a.target}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setConfirmAction({ title: 'Delete Alert', message: `Delete alert rule "${a.name}"?`, label: 'Delete', action: () => { setAlerts(p => p.filter(al => al.id !== a.id)); toast(`Alert "${a.name}" deleted`, 'warning'); } })}
                    className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                </div>
              ))}
              <button onClick={() => openAddModal({
                title: 'Create Alert Rule', buttonLabel: 'Create',
                fields: [{ key: 'name', label: 'Name', placeholder: 'CPU > 90%' }, { key: 'severity', label: 'Severity', type: 'select', default: 'warning', options: ['critical', 'warning', 'info'] }, { key: 'channel', label: 'Channel', type: 'select', default: 'slack', options: ['slack', 'pagerduty', 'email', 'webhook'] }, { key: 'target', label: 'Target', placeholder: '#channel or email' }],
                onAdd: (vals) => { setAlerts(p => [...p, { id: generateId('a-'), name: vals.name || 'New Alert', channel: vals.channel || 'slack', target: vals.target || '#alerts', severity: vals.severity || 'warning', enabled: true }]); toast('Alert rule created', 'success'); }
              })} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Add Alert Rule
              </button>
            </div>
          )}

          {/* ═══ WEBHOOKS ═══ */}
          {section === 'webhooks' && (
            <div className="space-y-3">
              {webhooks.map(wh => (
                <div key={wh.id} className={`border bg-white p-4 ${wh.active ? 'border-gray-300 shadow-[1px_1px_0_0_#111827]' : 'border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Toggle value={wh.active} onChange={() => { setWebhooks(p => p.map(w => w.id === wh.id ? { ...w, active: !w.active } : w)); toast(`Webhook ${!wh.active ? 'enabled' : 'disabled'}`); }} />
                      <span className="text-[10px] font-mono text-gray-700 truncate max-w-[300px]">{wh.url}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button onClick={() => toast('Test webhook sent', 'success')} className="text-[9px] font-bold text-gray-500 border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50 cursor-pointer">Test</button>
                      <button onClick={() => { setWebhooks(p => p.filter(w => w.id !== wh.id)); toast('Webhook deleted', 'warning'); }}
                        className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">{wh.events.map(e => (
                    <span key={e} className="text-[9px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 border border-gray-200">{e}</span>
                  ))}</div>
                </div>
              ))}
              <button onClick={() => openAddModal({
                title: 'Add Webhook', buttonLabel: 'Create Webhook',
                fields: [{ key: 'url', label: 'URL', placeholder: 'https://...' }, { key: 'events', label: 'Events (comma separated)', placeholder: 'deploy.success, deploy.failed' }],
                onAdd: (vals) => { setWebhooks(p => [...p, { id: generateId('wh-'), url: vals.url || 'https://new-webhook.com', events: (vals.events || 'deploy.success').split(',').map(e => e.trim()), active: true }]); toast('Webhook created', 'success'); }
              })} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Add Webhook
              </button>
            </div>
          )}

          {/* ═══ API KEYS ═══ */}
          {section === 'api-keys' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 p-3 flex items-start space-x-2">
                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[10px] text-amber-700">API keys grant programmatic access. Treat them like passwords. Revoked keys cannot be recovered.</div>
              </div>
              {apiKeys.map(k => (
                <div key={k.id} className="border border-gray-300 bg-white flex items-center justify-between p-4 shadow-[1px_1px_0_0_#111827]">
                  <div>
                    <div className="text-xs font-bold text-gray-900">{k.name}</div>
                    <div className="text-[10px] font-mono text-gray-400 mt-0.5">{showReveal[k.id] ? k.key : `${k.prefix}●●●●●●●●`} · Created {k.created} · Last used {k.lastUsed}</div>
                    <div className="flex items-center space-x-1 mt-1">{k.scopes.map(s => (
                      <span key={s} className="text-[9px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 border border-gray-200">{s}</span>
                    ))}</div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => setShowReveal(p => ({ ...p, [k.id]: !p[k.id] }))} className="text-gray-400 hover:text-gray-900 cursor-pointer">
                      {showReveal[k.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button onClick={() => copyToClipboard(k.key)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><Copy size={12} /></button>
                    <button onClick={() => setConfirmAction({ title: 'Revoke API Key', message: `Revoke "${k.name}"? This cannot be undone.`, label: 'Revoke', action: () => { setApiKeys(p => p.filter(kk => kk.id !== k.id)); toast(`${k.name} revoked`, 'warning'); addActivity(`API key "${k.name}" revoked`, 'system'); } })}
                      className="text-[10px] font-bold text-red-500 border border-red-300 px-2 py-1 hover:bg-red-50 cursor-pointer">Revoke</button>
                  </div>
                </div>
              ))}
              <button onClick={() => openAddModal({
                title: 'Generate API Key', buttonLabel: 'Generate Key',
                fields: [{ key: 'name', label: 'Key Name', placeholder: 'My API Key' }, { key: 'scopes', label: 'Scopes', type: 'select', default: 'read', options: ['read', 'read,deploy', 'read,deploy,admin'] }],
                onAdd: (vals) => {
                  const key = 'ak_' + Math.random().toString(36).slice(2, 18);
                  setApiKeys(p => [...p, { id: generateId('k-'), name: vals.name || 'New Key', prefix: 'ak_', key, created: 'Just now', lastUsed: '—', scopes: (vals.scopes || 'read').split(',') }]);
                  toast('API key generated — copy it now!', 'success');
                  addActivity(`API key "${vals.name || 'New Key'}" generated`, 'system');
                }
              })} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Generate New Key
              </button>
            </div>
          )}

          {/* ═══ GENERAL ═══ */}
          {section === 'general' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <EditField label="Organization Name" value={general.orgName} onChange={v => setGeneral(p => ({ ...p, orgName: v }))} />
                <EditField label="Timezone" value={general.timezone} onChange={v => setGeneral(p => ({ ...p, timezone: v }))} />
                <EditField label="Sync Interval" value={general.syncInterval} onChange={v => setGeneral(p => ({ ...p, syncInterval: v }))} />
                <EditField label="Data Retention" value={general.dataRetention} onChange={v => setGeneral(p => ({ ...p, dataRetention: v }))} />
              </div>
              <div className="border-t border-gray-200 pt-4 mt-4">
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">Danger Zone</div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setConfirmAction({ title: 'Reset All Data', message: 'This will reset all data to defaults. Your customizations will be lost. Are you sure?', label: 'Reset', action: () => resetStore() })}
                    className="text-[10px] font-bold text-red-600 border-2 border-red-300 px-3 py-1.5 hover:bg-red-50 cursor-pointer">Reset All Data</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HELPER COMPONENTS ───────────────────────────────────
function EditField({ label, value, onChange }) {
  return (
    <div className="border border-gray-200 bg-white p-3">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</div>
      {onChange ? (
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
          className="w-full text-xs font-mono text-gray-700 bg-transparent border-none outline-none" />
      ) : (
        <div className="text-xs font-mono text-gray-700">{value}</div>
      )}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={onChange} className={`w-10 h-5 border-2 border-gray-900 cursor-pointer relative transition-colors shrink-0 ${value ? 'bg-gray-900' : 'bg-white'}`}>
      <div className={`absolute top-0.5 w-3 h-3 transition-all ${value ? 'right-0.5 bg-white' : 'left-0.5 bg-gray-900'}`} />
    </button>
  );
}

function ToggleField({ label, value, onChange }) {
  return (
    <div className="border border-gray-200 bg-white p-3 flex items-center justify-between">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}
