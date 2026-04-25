import { useState } from 'react';
import {
  Shield, Globe, Bell, Users, Server, Key, GitBranch, Cloud, Webhook,
  Plus, Trash2, Eye, EyeOff, CheckCircle2, XCircle, X, Copy, RefreshCw,
  Rocket, Settings2, ChevronDown, ChevronRight, AlertTriangle, Lock, Mail, Smartphone
} from 'lucide-react';

// ─── DATA ────────────────────────────────────────────────
const INIT_ENVS = [
  { id: 'env-1', name: 'development', region: 'us-east-1', url: 'https://dev.agenticops.io', autoPromote: false, approvals: false, healthCheck: 'https://dev.agenticops.io/health', vars: [{ key: 'NODE_ENV', value: 'development' }, { key: 'LOG_LEVEL', value: 'debug' }] },
  { id: 'env-2', name: 'staging', region: 'us-east-1', url: 'https://staging.agenticops.io', autoPromote: false, approvals: true, healthCheck: 'https://staging.agenticops.io/health', vars: [{ key: 'NODE_ENV', value: 'staging' }, { key: 'LOG_LEVEL', value: 'info' }] },
  { id: 'env-3', name: 'production', region: 'us-east-1', url: 'https://app.agenticops.io', autoPromote: false, approvals: true, healthCheck: 'https://app.agenticops.io/health', vars: [{ key: 'NODE_ENV', value: 'production' }, { key: 'LOG_LEVEL', value: 'warn' }, { key: 'RATE_LIMIT', value: '1000' }] },
];

const INIT_INTEGRATIONS = [
  { id: 'int-1', name: 'GitHub', type: 'git', icon: '⌥', status: 'connected', account: 'agenticops-org', lastSync: '2m ago' },
  { id: 'int-2', name: 'AWS', type: 'cloud', icon: '☁', status: 'connected', account: '***4821', lastSync: '30s ago' },
  { id: 'int-3', name: 'Slack', type: 'notification', icon: '#', status: 'connected', account: '#deployments', lastSync: '1m ago' },
  { id: 'int-4', name: 'PagerDuty', type: 'notification', icon: '📟', status: 'disconnected', account: '—', lastSync: '—' },
  { id: 'int-5', name: 'GCP', type: 'cloud', icon: '◈', status: 'disconnected', account: '—', lastSync: '—' },
  { id: 'int-6', name: 'Azure', type: 'cloud', icon: '◆', status: 'disconnected', account: '—', lastSync: '—' },
  { id: 'int-7', name: 'GitLab', type: 'git', icon: '◉', status: 'disconnected', account: '—', lastSync: '—' },
  { id: 'int-8', name: 'Datadog', type: 'monitoring', icon: '🐕', status: 'disconnected', account: '—', lastSync: '—' },
];

const INIT_SECRETS = [
  { id: 's-1', key: 'DATABASE_URL', value: 'postgresql://***', created: '30d ago', rotated: '7d ago' },
  { id: 's-2', key: 'JWT_SECRET', value: 'sk_live_***', created: '90d ago', rotated: '30d ago' },
  { id: 's-3', key: 'AWS_ACCESS_KEY', value: 'AKIA***', created: '60d ago', rotated: '14d ago' },
  { id: 's-4', key: 'STRIPE_API_KEY', value: 'sk_live_***', created: '45d ago', rotated: '45d ago' },
  { id: 's-5', key: 'REDIS_URL', value: 'redis://***', created: '30d ago', rotated: '7d ago' },
];

const INIT_TEAM = [
  { id: 'u-1', name: 'Vamsi Kavali', email: 'v.kavali@agenticops.io', role: 'owner', status: 'active', lastLogin: '2m ago' },
  { id: 'u-2', name: 'ARC-R Engine', email: 'arcr@system.internal', role: 'admin', status: 'active', lastLogin: 'Always on' },
  { id: 'u-3', name: 'CI Bot', email: 'ci-bot@agenticops.io', role: 'deployer', status: 'active', lastLogin: '8m ago' },
  { id: 'u-4', name: 'Security Bot', email: 'security@agenticops.io', role: 'auditor', status: 'active', lastLogin: '1h ago' },
];

const INIT_WEBHOOKS = [
  { id: 'wh-1', url: 'https://hooks.slack.com/services/T0X/B0X/xxx', events: ['deploy.success', 'deploy.failed'], active: true },
  { id: 'wh-2', url: 'https://api.pagerduty.com/webhooks/v3/xxx', events: ['incident.critical'], active: false },
];

const INIT_POLICIES = {
  deployStrategy: 'rolling',
  autoRollback: true,
  rollbackThreshold: '5% error rate',
  approvalRequired: true,
  minApprovers: 1,
  deployWindow: '06:00 - 22:00 UTC',
  freezePeriod: false,
  maxConcurrent: 2,
  healthCheckTimeout: '60s',
  warmupPeriod: '30s',
};

const INIT_SECURITY = {
  mfa: true,
  sso: true,
  ssoProvider: 'Okta',
  sessionTtl: '8h',
  ipWhitelist: '10.0.0.0/8, 172.16.0.0/12',
  auditLog: true,
  secretRotation: '90 days',
  rbac: true,
};

const INIT_ALERTS = [
  { id: 'a-1', name: 'Deploy Failed', channel: 'slack', target: '#deployments', severity: 'critical', enabled: true },
  { id: 'a-2', name: 'Error Rate > 5%', channel: 'pagerduty', target: 'ops-team', severity: 'critical', enabled: true },
  { id: 'a-3', name: 'Latency P99 > 500ms', channel: 'slack', target: '#monitoring', severity: 'warning', enabled: true },
  { id: 'a-4', name: 'Deploy Success', channel: 'slack', target: '#deployments', severity: 'info', enabled: false },
  { id: 'a-5', name: 'Secret Rotation Due', channel: 'email', target: 'v.kavali@agenticops.io', severity: 'warning', enabled: true },
];

const INIT_KEYS = [
  { id: 'k-1', name: 'Production API Key', prefix: 'ak_prod_', created: '30d ago', lastUsed: '2m ago', scopes: ['read', 'deploy'] },
  { id: 'k-2', name: 'CI/CD Pipeline Key', prefix: 'ak_ci_', created: '60d ago', lastUsed: '8m ago', scopes: ['read', 'deploy', 'admin'] },
];

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
  const [section, setSection] = useState('environments');
  const [notification, setNotification] = useState(null);
  const [envs, setEnvs] = useState(INIT_ENVS);
  const [integrations, setIntegrations] = useState(INIT_INTEGRATIONS);
  const [secrets, setSecrets] = useState(INIT_SECRETS);
  const [team, setTeam] = useState(INIT_TEAM);
  const [webhooks, setWebhooks] = useState(INIT_WEBHOOKS);
  const [policies, setPolicies] = useState(INIT_POLICIES);
  const [security, setSecurity] = useState(INIT_SECURITY);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [apiKeys, setApiKeys] = useState(INIT_KEYS);
  const [expandedEnv, setExpandedEnv] = useState(null);
  const [showReveal, setShowReveal] = useState({});
  const [showAddModal, setShowAddModal] = useState(null);
  const [general, setGeneral] = useState({ orgName: 'AgenticOps', timezone: 'UTC', syncInterval: '30s', dataRetention: '90 days' });

  const notify = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 2500); };

  const sec = SECTIONS.find(s => s.id === section);
  const SecIcon = sec?.icon;

  return (
    <div className="flex h-full relative">
      {notification && <div className="fixed top-4 right-4 z-50 border-2 border-gray-900 bg-white px-4 py-3 shadow-[4px_4px_0_0_#111827] text-xs font-bold text-gray-900 animate-pulse">{notification}</div>}

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
                    <select className="w-full border border-gray-200 px-3 py-2 text-xs font-mono bg-gray-50 cursor-pointer" defaultValue={f.default}>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type || 'text'} placeholder={f.placeholder} defaultValue={f.default || ''}
                      className="w-full border border-gray-200 px-3 py-2 text-xs font-mono bg-gray-50 focus:outline-none focus:border-gray-900" />
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => { showAddModal.onAdd(); setShowAddModal(null); }}
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
                        <Field label="Region" value={env.region} />
                        <Field label="URL" value={env.url} />
                        <Field label="Health Check" value={env.healthCheck} />
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-gray-400 uppercase">Require Approvals</span>
                          <Toggle value={env.approvals} onChange={() => { setEnvs(p => p.map(e => e.id === env.id ? { ...e, approvals: !e.approvals } : e)); notify(`${env.name}: approvals ${!env.approvals ? 'enabled' : 'disabled'}`); }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Environment Variables</span>
                          <button onClick={() => {
                            setShowAddModal({ title: `Add Variable — ${env.name}`, buttonLabel: 'Add Variable',
                              fields: [{ key: 'key', label: 'Key', placeholder: 'MY_VARIABLE' }, { key: 'value', label: 'Value', placeholder: 'value' }],
                              onAdd: () => { setEnvs(p => p.map(e => e.id === env.id ? { ...e, vars: [...e.vars, { key: 'NEW_VAR', value: 'value' }] } : e)); notify('Variable added'); }
                            });
                          }} className="text-[9px] font-bold text-gray-500 hover:text-gray-900 flex items-center cursor-pointer"><Plus size={10} className="mr-0.5" /> Add</button>
                        </div>
                        <div className="space-y-1">
                          {env.vars.map((v, i) => (
                            <div key={i} className="flex items-center justify-between bg-white border border-gray-200 px-3 py-1.5">
                              <span className="text-[10px] font-mono font-bold text-gray-700">{v.key}</span>
                              <div className="flex items-center space-x-2">
                                <span className="text-[10px] font-mono text-gray-400">{v.value}</span>
                                <button onClick={() => { setEnvs(p => p.map(e => e.id === env.id ? { ...e, vars: e.vars.filter((_, j) => j !== i) } : e)); notify('Variable removed'); }}
                                  className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={10} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => { setEnvs(p => p.filter(e => e.id !== env.id)); setExpandedEnv(null); notify(`Environment "${env.name}" deleted`); }}
                        className="text-[10px] font-bold text-red-500 hover:text-red-700 flex items-center cursor-pointer"><Trash2 size={10} className="mr-1" /> Delete Environment</button>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => {
                setShowAddModal({ title: 'Create Environment', buttonLabel: 'Create',
                  fields: [{ key: 'name', label: 'Name', placeholder: 'qa' }, { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'] }, { key: 'url', label: 'URL', placeholder: 'https://qa.agenticops.io' }],
                  onAdd: () => { const e = { id: `env-${Date.now()}`, name: 'new-env', region: 'us-east-1', url: 'https://new.agenticops.io', autoPromote: false, approvals: false, healthCheck: '', vars: [] }; setEnvs(p => [...p, e]); notify('Environment created'); }
                });
              }} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer transition-all flex items-center justify-center">
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
                      <div>
                        <div className="text-xs font-bold text-gray-900">{int.name}</div>
                        <div className="text-[9px] font-mono text-gray-400 uppercase">{int.type}</div>
                      </div>
                    </div>
                    <div className={`flex items-center space-x-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${int.status === 'connected' ? 'text-green-700 bg-green-50 border-green-200' : 'text-gray-400 bg-gray-50 border-gray-200'}`}>
                      {int.status === 'connected' ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                      <span>{int.status}</span>
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
                    notify(`${int.name} ${int.status === 'connected' ? 'disconnected' : 'connected'}`);
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
                    <button onClick={() => { notify(`${s.key} rotated`); setSecrets(p => p.map(ss => ss.id === s.id ? { ...ss, rotated: 'Just now' } : ss)); }}
                      className="text-gray-400 hover:text-gray-900 cursor-pointer"><RefreshCw size={12} /></button>
                    <button onClick={() => { setSecrets(p => p.filter(ss => ss.id !== s.id)); notify(`${s.key} deleted`); }}
                      className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
              <button onClick={() => {
                setShowAddModal({ title: 'Add Secret', buttonLabel: 'Create Secret',
                  fields: [{ key: 'key', label: 'Key', placeholder: 'API_KEY' }, { key: 'value', label: 'Value', placeholder: 'secret-value', type: 'password' }],
                  onAdd: () => { setSecrets(p => [...p, { id: `s-${Date.now()}`, key: 'NEW_SECRET', value: '***', created: 'Just now', rotated: 'Just now' }]); notify('Secret created'); }
                });
              }} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
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
                    <div>
                      <div className="text-xs font-bold text-gray-900">{u.name}</div>
                      <div className="text-[10px] font-mono text-gray-400">{u.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] font-mono text-gray-400">Last: {u.lastLogin}</span>
                    <select value={u.role} onChange={e => { setTeam(p => p.map(t => t.id === u.id ? { ...t, role: e.target.value } : t)); notify(`${u.name} role → ${e.target.value}`); }}
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
                      <button onClick={() => { setTeam(p => p.filter(t => t.id !== u.id)); notify(`${u.name} removed`); }}
                        className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={() => {
                setShowAddModal({ title: 'Invite Team Member', buttonLabel: 'Send Invite',
                  fields: [{ key: 'email', label: 'Email', placeholder: 'user@company.com', type: 'email' }, { key: 'role', label: 'Role', type: 'select', default: 'deployer', options: ['admin', 'deployer', 'auditor', 'viewer'] }],
                  onAdd: () => { setTeam(p => [...p, { id: `u-${Date.now()}`, name: 'Invited User', email: 'invited@company.com', role: 'deployer', status: 'invited', lastLogin: '—' }]); notify('Invite sent'); }
                });
              }} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
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
                    <button key={s} onClick={() => { setPolicies(p => ({ ...p, deployStrategy: s })); notify(`Strategy → ${s}`); }}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 border cursor-pointer transition-all text-center ${
                        policies.deployStrategy === s ? 'bg-gray-900 text-white border-gray-900 shadow-[2px_2px_0_0_#D1D5DB]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ToggleField label="Auto-Rollback" value={policies.autoRollback} onChange={() => setPolicies(p => ({ ...p, autoRollback: !p.autoRollback }))} onNotify={notify} />
                <Field label="Rollback Threshold" value={policies.rollbackThreshold} />
                <ToggleField label="Approval Required" value={policies.approvalRequired} onChange={() => setPolicies(p => ({ ...p, approvalRequired: !p.approvalRequired }))} onNotify={notify} />
                <Field label="Min Approvers" value={policies.minApprovers} />
                <Field label="Deploy Window" value={policies.deployWindow} />
                <ToggleField label="Deploy Freeze" value={policies.freezePeriod} onChange={() => setPolicies(p => ({ ...p, freezePeriod: !p.freezePeriod }))} onNotify={notify} />
                <Field label="Max Concurrent Deploys" value={policies.maxConcurrent} />
                <Field label="Health Check Timeout" value={policies.healthCheckTimeout} />
                <Field label="Warmup Period" value={policies.warmupPeriod} />
              </div>
            </div>
          )}

          {/* ═══ SECURITY ═══ */}
          {section === 'security' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <ToggleField label="Require MFA" value={security.mfa} onChange={() => { setSecurity(p => ({ ...p, mfa: !p.mfa })); notify(`MFA ${!security.mfa ? 'enabled' : 'disabled'}`); }} />
                <ToggleField label="SSO Enabled" value={security.sso} onChange={() => { setSecurity(p => ({ ...p, sso: !p.sso })); notify(`SSO ${!security.sso ? 'enabled' : 'disabled'}`); }} />
                <Field label="SSO Provider" value={security.ssoProvider} />
                <Field label="Session TTL" value={security.sessionTtl} />
                <Field label="IP Whitelist" value={security.ipWhitelist} />
                <ToggleField label="Audit Logging" value={security.auditLog} onChange={() => { setSecurity(p => ({ ...p, auditLog: !p.auditLog })); notify(`Audit logging ${!security.auditLog ? 'enabled' : 'disabled'}`); }} />
                <Field label="Secret Rotation" value={security.secretRotation} />
                <ToggleField label="RBAC Enforcement" value={security.rbac} onChange={() => { setSecurity(p => ({ ...p, rbac: !p.rbac })); notify(`RBAC ${!security.rbac ? 'enabled' : 'disabled'}`); }} />
              </div>
            </div>
          )}

          {/* ═══ NOTIFICATIONS ═══ */}
          {section === 'notifications' && (
            <div className="space-y-3">
              {alerts.map(a => (
                <div key={a.id} className={`border bg-white flex items-center justify-between p-3 transition-all ${a.enabled ? 'border-gray-300 shadow-[1px_1px_0_0_#111827]' : 'border-gray-200 opacity-60'}`}>
                  <div className="flex items-center space-x-3">
                    <Toggle value={a.enabled} onChange={() => { setAlerts(p => p.map(al => al.id === a.id ? { ...al, enabled: !al.enabled } : al)); notify(`${a.name} ${!a.enabled ? 'enabled' : 'disabled'}`); }} />
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
                  <button onClick={() => { setAlerts(p => p.filter(al => al.id !== a.id)); notify(`Alert "${a.name}" deleted`); }}
                    className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                </div>
              ))}
              <button onClick={() => {
                setShowAddModal({ title: 'Create Alert Rule', buttonLabel: 'Create',
                  fields: [{ key: 'name', label: 'Name', placeholder: 'CPU > 90%' }, { key: 'severity', label: 'Severity', type: 'select', default: 'warning', options: ['critical', 'warning', 'info'] }, { key: 'channel', label: 'Channel', type: 'select', default: 'slack', options: ['slack', 'pagerduty', 'email', 'webhook'] }, { key: 'target', label: 'Target', placeholder: '#channel or email' }],
                  onAdd: () => { setAlerts(p => [...p, { id: `a-${Date.now()}`, name: 'New Alert', channel: 'slack', target: '#alerts', severity: 'warning', enabled: true }]); notify('Alert rule created'); }
                });
              }} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
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
                      <Toggle value={wh.active} onChange={() => { setWebhooks(p => p.map(w => w.id === wh.id ? { ...w, active: !w.active } : w)); notify(`Webhook ${!wh.active ? 'enabled' : 'disabled'}`); }} />
                      <span className="text-[10px] font-mono text-gray-700 truncate max-w-[300px]">{wh.url}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button onClick={() => notify('Test sent')} className="text-[9px] font-bold text-gray-500 border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50 cursor-pointer">Test</button>
                      <button onClick={() => { setWebhooks(p => p.filter(w => w.id !== wh.id)); notify('Webhook deleted'); }}
                        className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">{wh.events.map(e => (
                    <span key={e} className="text-[9px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 border border-gray-200">{e}</span>
                  ))}</div>
                </div>
              ))}
              <button onClick={() => {
                setShowAddModal({ title: 'Add Webhook', buttonLabel: 'Create Webhook',
                  fields: [{ key: 'url', label: 'URL', placeholder: 'https://...' }, { key: 'events', label: 'Events (comma separated)', placeholder: 'deploy.success, deploy.failed' }],
                  onAdd: () => { setWebhooks(p => [...p, { id: `wh-${Date.now()}`, url: 'https://new-webhook.com', events: ['deploy.success'], active: true }]); notify('Webhook created'); }
                });
              }} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
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
                    <div className="text-[10px] font-mono text-gray-400 mt-0.5">{k.prefix}●●●●●●●● · Created {k.created} · Last used {k.lastUsed}</div>
                    <div className="flex items-center space-x-1 mt-1">{k.scopes.map(s => (
                      <span key={s} className="text-[9px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 border border-gray-200">{s}</span>
                    ))}</div>
                  </div>
                  <button onClick={() => { setApiKeys(p => p.filter(kk => kk.id !== k.id)); notify(`${k.name} revoked`); }}
                    className="text-[10px] font-bold text-red-500 border border-red-300 px-2 py-1 hover:bg-red-50 cursor-pointer">Revoke</button>
                </div>
              ))}
              <button onClick={() => {
                setShowAddModal({ title: 'Generate API Key', buttonLabel: 'Generate Key',
                  fields: [{ key: 'name', label: 'Key Name', placeholder: 'My API Key' }, { key: 'scopes', label: 'Scopes', type: 'select', default: 'read', options: ['read', 'read,deploy', 'read,deploy,admin'] }],
                  onAdd: () => { setApiKeys(p => [...p, { id: `k-${Date.now()}`, name: 'New Key', prefix: 'ak_new_', created: 'Just now', lastUsed: '—', scopes: ['read'] }]); notify('API key generated'); }
                });
              }} className="w-full border-2 border-dashed border-gray-300 p-3 text-center text-[10px] font-bold text-gray-400 hover:text-gray-900 hover:border-gray-900 cursor-pointer flex items-center justify-center">
                <Plus size={12} className="mr-1" /> Generate New Key
              </button>
            </div>
          )}

          {/* ═══ GENERAL ═══ */}
          {section === 'general' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Organization Name" value={general.orgName} />
                <Field label="Timezone" value={general.timezone} />
                <Field label="Sync Interval" value={general.syncInterval} />
                <Field label="Data Retention" value={general.dataRetention} />
              </div>
              <div className="border-t border-gray-200 pt-4 mt-4">
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">Danger Zone</div>
                <button onClick={() => notify('This would delete all data. Are you sure?')}
                  className="text-[10px] font-bold text-red-600 border-2 border-red-300 px-3 py-1.5 hover:bg-red-50 cursor-pointer">Delete Organization</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HELPER COMPONENTS ───────────────────────────────────
function Field({ label, value }) {
  return (
    <div className="border border-gray-200 bg-white p-3">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-xs font-mono text-gray-700">{value}</div>
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

function ToggleField({ label, value, onChange, onNotify }) {
  return (
    <div className="border border-gray-200 bg-white p-3 flex items-center justify-between">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
      <Toggle value={value} onChange={() => { onChange(); if (onNotify) onNotify(`${label} ${!value ? 'enabled' : 'disabled'}`); }} />
    </div>
  );
}
