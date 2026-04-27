import { useState, useEffect, useMemo } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Zap, Clock, BarChart3, Rocket,
  Shield, TrendingUp, TrendingDown, ExternalLink, Server, RefreshCw, ChevronRight
} from 'lucide-react';
import { useApp, getTimeAgo, computeSecurityScore } from './store';

export default function DashboardView({ onNavigate }) {
  const {
    healthScore, deploysToday, pipelineStats, activity, deployments,
    incidents, services, security, securityScore, activeIncidentCount,
  } = useApp();

  const [timeRange, setTimeRange] = useState('24h');
  const [lastSync, setLastSync] = useState(4);

  useEffect(() => {
    const t = setInterval(() => setLastSync(p => p >= 30 ? 0 : p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Filter data by time range
  const timeMs = useMemo(() => {
    const map = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return map[timeRange] || 86400000;
  }, [timeRange]);

  const filteredActivity = useMemo(() => activity.filter(a => !a.timestamp || Date.now() - a.timestamp < timeMs), [activity, timeMs]);
  const filteredDeploys = useMemo(() => deployments.filter(d => Date.now() - d.timestamp < timeMs), [deployments, timeMs]);
  const recentDeploys = filteredDeploys.slice(0, 5);

  // Stats
  const errorRate = activeIncidentCount > 0 ? (0.31 + activeIncidentCount * 0.15).toFixed(2) : '0.02';
  const p99Latency = activeIncidentCount > 0 ? 142 + activeIncidentCount * 40 : 142;
  const uptime = activeIncidentCount === 0 ? '99.99' : activeIncidentCount === 1 ? '99.97' : '99.91';

  const STATS = [
    { label: 'Uptime (30d)', value: `${uptime}%`, icon: Activity, trend: activeIncidentCount === 0 ? '+0.04%' : '-0.02%', good: activeIncidentCount === 0 },
    { label: 'Error Rate', value: `${errorRate}%`, icon: AlertTriangle, trend: activeIncidentCount > 0 ? '+0.12%' : '-0.12%', good: activeIncidentCount === 0 },
    { label: 'P99 Latency', value: `${p99Latency}ms`, icon: Zap, trend: activeIncidentCount > 0 ? `+${activeIncidentCount * 40}ms` : '-3ms', good: activeIncidentCount === 0 },
    { label: 'Deploys Today', value: `${deploysToday}`, icon: Rocket, trend: `+${Math.max(0, deploysToday - 3)}`, good: true },
  ];

  const activeIncidents = incidents.filter(i => i.status === 'active' || i.status === 'acknowledged');

  // Security items
  const secItems = [
    { label: 'IAM Policies', pass: security.rbac },
    { label: 'Dependencies', pass: true, cves: 2 },
    { label: 'Secrets Rotation', pass: true },
  ];

  return (
    <div className="overflow-y-auto hidden-scrollbar h-full">
      <div className="max-w-[1200px] mx-auto p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">Command Center</h1>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mt-0.5 flex items-center">
              Production · us-east-1 · <RefreshCw size={9} className={`mx-1 ${lastSync < 2 ? 'animate-spin text-green-500' : ''}`} /> Synced {lastSync}s ago
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex items-center border border-gray-200">
              {['1h', '6h', '24h', '7d', '30d'].map(r => (
                <button key={r} onClick={() => setTimeRange(r)}
                  className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 cursor-pointer transition-all ${timeRange === r ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{r}</button>
              ))}
            </div>
            <button onClick={() => onNavigate('deployments')} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 cursor-pointer flex items-center">
              <Rocket size={12} className="mr-1.5" /> Quick Deploy
            </button>
          </div>
        </div>

        {/* Health + Stats */}
        <div className="grid grid-cols-5 gap-3 mb-5">
          <div className="border-2 border-gray-900 bg-white p-4 shadow-[4px_4px_0_0_#111827]">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">System Health</div>
            <div className="text-3xl font-bold font-mono text-gray-900">{healthScore}</div>
            <div className={`text-[10px] font-mono font-bold mt-1 flex items-center ${healthScore >= 95 ? 'text-green-600' : healthScore >= 85 ? 'text-amber-600' : 'text-red-600'}`}>
              {healthScore >= 90 ? <TrendingUp size={10} className="mr-1" /> : <TrendingDown size={10} className="mr-1" />}
              {healthScore >= 95 ? 'Excellent' : healthScore >= 85 ? 'Good' : 'Needs Attention'}
            </div>
            <div className="mt-2 w-full h-1.5 bg-gray-100 border border-gray-200"><div className={`h-full ${healthScore >= 90 ? 'bg-gray-900' : healthScore >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${healthScore}%` }} /></div>
          </div>
          {STATS.map(stat => { const Icon = stat.icon; return (
            <div key={stat.label} className="border border-gray-300 bg-white p-3 shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all cursor-default">
              <div className="flex items-center justify-between mb-1"><div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stat.label}</div><Icon size={12} className="text-gray-400" /></div>
              <div className="text-xl font-bold font-mono text-gray-900">{stat.value}</div>
              <div className={`text-[10px] font-mono font-bold mt-0.5 flex items-center ${stat.good ? 'text-green-600' : 'text-red-600'}`}>
                {stat.good ? <TrendingUp size={9} className="mr-1" /> : <TrendingDown size={9} className="mr-1" />}{stat.trend}
              </div>
            </div>
          ); })}
        </div>

        {/* Service Status Bar */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center"><Server size={12} className="mr-2 text-gray-900" /> Services</h2>
            <button onClick={() => onNavigate('topology')} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 flex items-center cursor-pointer">Infrastructure <ChevronRight size={10} /></button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {services.map(s => (
              <div key={s.name} onClick={() => onNavigate('topology')} className="border border-gray-300 bg-white p-3 shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-gray-900">{s.name}</span>
                  <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${
                    s.status === 'healthy' ? 'bg-green-50 text-green-700 border-green-200' :
                    s.status === 'deploying' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    s.status === 'degraded' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-red-50 text-red-700 border-red-200'
                  }`}>{s.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  <div><div className="text-[8px] text-gray-400 uppercase">CPU</div><div className="text-[10px] font-mono font-bold text-gray-700">{s.cpu}%</div></div>
                  <div><div className="text-[8px] text-gray-400 uppercase">MEM</div><div className="text-[10px] font-mono font-bold text-gray-700">{s.memory}%</div></div>
                  <div><div className="text-[8px] text-gray-400 uppercase">INST</div><div className="text-[10px] font-mono font-bold text-gray-700">{s.instances}</div></div>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono text-gray-400">
                  <span>{s.version}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Three Column Grid */}
        <div className="grid grid-cols-3 gap-5">

          {/* Recent Deployments */}
          <div className="col-span-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center"><Rocket size={12} className="mr-2 text-gray-900" /> Deploys</h2>
              <button onClick={() => onNavigate('deployments')} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 flex items-center cursor-pointer">All <ExternalLink size={9} className="ml-0.5" /></button>
            </div>
            <div className="space-y-1.5">
              {recentDeploys.map(d => {
                const latestEnv = Object.entries(d.environments).filter(([, v]) => v).sort((a, b) => (b[1]?.timestamp || 0) - (a[1]?.timestamp || 0))[0];
                const envStatus = latestEnv?.[1]?.status || 'passed';
                return (
                <div key={d.id} onClick={() => onNavigate('deployments')} className={`border bg-white p-2.5 cursor-pointer transition-all hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] ${
                  envStatus === 'failed' ? 'border-red-300' : envStatus === 'running' ? 'border-blue-300' : 'border-gray-200'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className={`w-1.5 h-1.5 shrink-0 ${envStatus === 'passed' ? 'bg-green-500' : envStatus === 'failed' ? 'bg-red-500' : envStatus === 'rolledback' ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`} />
                    <div className="overflow-hidden flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-900">{d.service}</span>
                        <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${latestEnv?.[0] === 'production' ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{latestEnv?.[0] || '—'}</span>
                      </div>
                      <div className="text-[9px] font-mono text-gray-400 truncate mt-0.5">{d.commit} · {d.msg}</div>
                    </div>
                  </div>
                </div>
              );})}
              {recentDeploys.length === 0 && (
                <div className="border border-dashed border-gray-300 p-4 text-center text-[10px] text-gray-400 font-bold">No deploys in this time window</div>
              )}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="col-span-1">
            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center mb-3"><Clock size={12} className="mr-2 text-gray-900" /> Activity Feed</h2>
            <div className="space-y-0 relative">
              <div className="absolute left-[4px] top-2 bottom-2 w-px bg-gray-200" />
              {filteredActivity.slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-start space-x-3 pb-3 relative cursor-default">
                  <div className={`w-[9px] h-[9px] border-2 shrink-0 mt-1 z-10 ${
                    a.type === 'incident' ? 'bg-red-500 border-red-500' :
                    a.type === 'alert' ? 'bg-amber-500 border-amber-500' :
                    a.type === 'pipeline' ? 'bg-purple-500 border-purple-500' :
                    'bg-gray-900 border-gray-900'
                  }`} />
                  <div>
                    <div className="text-[9px] font-mono text-gray-400">{a.time}</div>
                    <div className="text-[10px] text-gray-700 leading-snug">{a.event}</div>
                  </div>
                </div>
              ))}
              {filteredActivity.length === 0 && (
                <div className="text-[10px] text-gray-400 font-bold pl-6">No activity in this time window</div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Incidents */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center"><AlertTriangle size={12} className="mr-2 text-gray-900" /> Incidents</h2>
                <button onClick={() => onNavigate('incidents')} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 flex items-center cursor-pointer">All <ExternalLink size={9} className="ml-0.5" /></button>
              </div>
              {activeIncidents.length > 0 ? activeIncidents.slice(0, 2).map(inc => (
                <div key={inc.id} onClick={() => onNavigate('incidents')} className="border-2 border-red-500 bg-white p-3 shadow-[3px_3px_0_0_#DC2626] cursor-pointer hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all mb-2">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-[10px] font-mono font-bold text-gray-400">{inc.id}</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200">{inc.severity}</span>
                  </div>
                  <div className="text-xs font-bold text-gray-900">{inc.title}</div>
                  <div className="text-[10px] font-mono text-gray-400 mt-1">{inc.opened}</div>
                </div>
              )) : (
                <div className="border border-green-300 bg-green-50 p-3 text-center">
                  <div className="flex items-center justify-center text-[10px] font-bold text-green-700"><CheckCircle2 size={12} className="mr-1" /> All Clear</div>
                  <div className="text-[9px] text-green-600 mt-0.5">No active incidents</div>
                </div>
              )}
            </div>

            {/* Pipelines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center"><BarChart3 size={12} className="mr-2 text-gray-900" /> Pipelines</h2>
                <button onClick={() => onNavigate('pipelines')} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 flex items-center cursor-pointer">All <ExternalLink size={9} className="ml-0.5" /></button>
              </div>
              <div onClick={() => onNavigate('pipelines')} className="border border-gray-300 bg-white shadow-[1px_1px_0_0_#111827] cursor-pointer hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all">
                <div className="grid grid-cols-3 divide-x divide-gray-200">
                  <div className="p-2.5 text-center"><div className="text-lg font-bold font-mono text-green-600">{pipelineStats.passed}</div><div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Passed</div></div>
                  <div className="p-2.5 text-center"><div className="text-lg font-bold font-mono text-red-600">{pipelineStats.failed}</div><div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Failed</div></div>
                  <div className="p-2.5 text-center"><div className="text-lg font-bold font-mono text-blue-600">{pipelineStats.running}</div><div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Running</div></div>
                </div>
                <div className="border-t border-gray-200 p-2.5"><div className="w-full h-1.5 bg-gray-100 flex overflow-hidden"><div className="bg-green-500 h-full" style={{ width: `${pipelineStats.total ? (pipelineStats.passed/pipelineStats.total)*100 : 0}%` }} /><div className="bg-red-500 h-full" style={{ width: `${pipelineStats.total ? (pipelineStats.failed/pipelineStats.total)*100 : 0}%` }} /><div className="bg-blue-500 h-full" style={{ width: `${pipelineStats.total ? (pipelineStats.running/pipelineStats.total)*100 : 0}%` }} /></div></div>
              </div>
            </div>

            {/* Security */}
            <div>
              <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center"><Shield size={12} className="mr-2 text-gray-900" /> Security</h2>
              <div onClick={() => onNavigate('settings')} className="border border-gray-300 bg-white p-3 shadow-[1px_1px_0_0_#111827] cursor-pointer hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xl font-bold font-mono text-gray-900">{securityScore}<span className="text-sm text-gray-400">/100</span></div>
                  <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${securityScore >= 90 ? 'bg-green-50 text-green-700 border-green-200' : securityScore >= 70 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{securityScore >= 90 ? 'Good' : securityScore >= 70 ? 'Fair' : 'Poor'}</span>
                </div>
                <div className="space-y-1 text-[10px] font-mono">
                  <div className="flex justify-between"><span className="text-gray-500">MFA Enforced</span><span className={`font-bold ${security.mfa ? 'text-green-600' : 'text-red-600'}`}>{security.mfa ? '✓ Yes' : '✗ No'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">RBAC Active</span><span className={`font-bold ${security.rbac ? 'text-green-600' : 'text-red-600'}`}>{security.rbac ? '✓ Yes' : '✗ No'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Audit Logging</span><span className={`font-bold ${security.auditLog ? 'text-green-600' : 'text-amber-600'}`}>{security.auditLog ? '✓ Active' : '⚠ Off'}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
