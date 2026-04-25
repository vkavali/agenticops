import { useState, useEffect } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Zap, GitBranch, Clock, BarChart3, Rocket,
  Shield, TrendingUp, TrendingDown, ExternalLink, Server, Globe, RefreshCw, ChevronRight
} from 'lucide-react';

const HEALTH_SCORE = 94.2;

const STATS = [
  { label: 'Uptime (30d)', value: '99.97%', icon: Activity, trend: '+0.02%', good: true },
  { label: 'Error Rate', value: '0.31%', icon: AlertTriangle, trend: '-0.12%', good: true },
  { label: 'P99 Latency', value: '142ms', icon: Zap, trend: '+8ms', good: false },
  { label: 'Deploys Today', value: '7', icon: Rocket, trend: '+3', good: true },
];

const RECENT_DEPLOYS = [
  { id: 'd-1', service: 'api-service', env: 'production', commit: 'a8f3c21', msg: 'fix: POST handler memory', status: 'running', time: '2m ago', by: 'ARC-R' },
  { id: 'd-2', service: 'api-service', env: 'staging', commit: 'a8f3c21', msg: 'fix: POST handler memory', status: 'passed', time: '8m ago', by: 'ARC-R' },
  { id: 'd-3', service: 'frontend', env: 'production', commit: 'f2b8d09', msg: 'feat: user preferences', status: 'passed', time: '45m ago', by: 'v.kavali' },
  { id: 'd-4', service: 'frontend', env: 'staging', commit: 'c4e1a77', msg: 'chore: bundle optimization', status: 'failed', time: '1h ago', by: 'v.kavali' },
  { id: 'd-5', service: 'worker-service', env: 'production', commit: 'b9d2e44', msg: 'perf: batch processing', status: 'passed', time: '3h ago', by: 'ci-bot' },
];

const ACTIVE_INCIDENTS = [
  { id: 'INC-2847', title: 'Heap Memory Exhaustion — POST Handler', severity: 'critical', time: '14m ago' },
];

const PIPELINE_STATS = { total: 12, passed: 9, failed: 2, running: 1 };

const SERVICES = [
  { name: 'api-service', status: 'deploying', version: 'v2.3.1', instances: '3/3', cpu: '42%', memory: '67%' },
  { name: 'frontend', status: 'healthy', version: 'v3.1.0', instances: '2/2', cpu: '12%', memory: '34%' },
  { name: 'worker-service', status: 'healthy', version: 'v1.8.2', instances: '4/4', cpu: '78%', memory: '55%' },
  { name: 'auth-service', status: 'healthy', version: 'v2.1.0', instances: '2/2', cpu: '8%', memory: '21%' },
];

const RECENT_ACTIVITY = [
  { time: '2m ago', event: 'ARC-R started deploy of api-service v2.3.1 to production', type: 'deploy' },
  { time: '8m ago', event: 'api-service v2.3.1 deployed to staging successfully', type: 'deploy' },
  { time: '14m ago', event: 'INC-2847 opened: Heap Memory Exhaustion on POST Handler', type: 'incident' },
  { time: '14m ago', event: 'ARC-R detected anomaly: OutOfMemoryError on lambda-post', type: 'alert' },
  { time: '45m ago', event: 'frontend v3.1.0 deployed to production by v.kavali', type: 'deploy' },
  { time: '1h ago', event: 'Pipeline frontend/build-test #31 failed (test stage)', type: 'pipeline' },
  { time: '3h ago', event: 'worker-service v1.8.2 deployed to production by ci-bot', type: 'deploy' },
  { time: '6h ago', event: 'INC-2845 resolved: DynamoDB throttling fixed', type: 'incident' },
];

export default function DashboardView({ onNavigate }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [lastSync, setLastSync] = useState(4);

  useEffect(() => {
    const t = setInterval(() => setLastSync(p => p >= 30 ? 0 : p + 1), 1000);
    return () => clearInterval(t);
  }, []);

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
            {/* Time Range Selector */}
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
            <div className="text-3xl font-bold font-mono text-gray-900">{HEALTH_SCORE}</div>
            <div className="text-[10px] font-mono text-green-600 font-bold mt-1 flex items-center"><TrendingUp size={10} className="mr-1" /> +1.2 from yesterday</div>
            <div className="mt-2 w-full h-1.5 bg-gray-100 border border-gray-200"><div className="h-full bg-gray-900" style={{ width: `${HEALTH_SCORE}%` }} /></div>
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
            {SERVICES.map(s => (
              <div key={s.name} onClick={() => onNavigate('topology')} className="border border-gray-300 bg-white p-3 shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-gray-900">{s.name}</span>
                  <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${
                    s.status === 'healthy' ? 'bg-green-50 text-green-700 border-green-200' :
                    s.status === 'deploying' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    'bg-red-50 text-red-700 border-red-200'
                  }`}>{s.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  <div><div className="text-[8px] text-gray-400 uppercase">CPU</div><div className="text-[10px] font-mono font-bold text-gray-700">{s.cpu}</div></div>
                  <div><div className="text-[8px] text-gray-400 uppercase">MEM</div><div className="text-[10px] font-mono font-bold text-gray-700">{s.memory}</div></div>
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
              {RECENT_DEPLOYS.map(d => (
                <div key={d.id} onClick={() => onNavigate('deployments')} className={`border bg-white p-2.5 cursor-pointer transition-all hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] ${
                  d.status === 'failed' ? 'border-red-300' : d.status === 'running' ? 'border-blue-300' : 'border-gray-200'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className={`w-1.5 h-1.5 shrink-0 ${d.status === 'passed' ? 'bg-green-500' : d.status === 'failed' ? 'bg-red-500' : 'bg-blue-500 animate-pulse'}`} />
                    <div className="overflow-hidden flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-900">{d.service}</span>
                        <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${d.env === 'production' ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{d.env}</span>
                      </div>
                      <div className="text-[9px] font-mono text-gray-400 truncate mt-0.5">{d.commit} · {d.msg}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="col-span-1">
            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center mb-3"><Clock size={12} className="mr-2 text-gray-900" /> Activity Feed</h2>
            <div className="space-y-0 relative">
              <div className="absolute left-[4px] top-2 bottom-2 w-px bg-gray-200" />
              {RECENT_ACTIVITY.map((a, i) => (
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
              {ACTIVE_INCIDENTS.map(inc => (
                <div key={inc.id} onClick={() => onNavigate('incidents')} className="border-2 border-red-500 bg-white p-3 shadow-[3px_3px_0_0_#DC2626] cursor-pointer hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-[10px] font-mono font-bold text-gray-400">{inc.id}</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200">Critical</span>
                  </div>
                  <div className="text-xs font-bold text-gray-900">{inc.title}</div>
                  <div className="text-[10px] font-mono text-gray-400 mt-1">{inc.time}</div>
                </div>
              ))}
            </div>

            {/* Pipelines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center"><BarChart3 size={12} className="mr-2 text-gray-900" /> Pipelines</h2>
                <button onClick={() => onNavigate('pipelines')} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 flex items-center cursor-pointer">All <ExternalLink size={9} className="ml-0.5" /></button>
              </div>
              <div onClick={() => onNavigate('pipelines')} className="border border-gray-300 bg-white shadow-[1px_1px_0_0_#111827] cursor-pointer hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all">
                <div className="grid grid-cols-3 divide-x divide-gray-200">
                  <div className="p-2.5 text-center"><div className="text-lg font-bold font-mono text-green-600">{PIPELINE_STATS.passed}</div><div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Passed</div></div>
                  <div className="p-2.5 text-center"><div className="text-lg font-bold font-mono text-red-600">{PIPELINE_STATS.failed}</div><div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Failed</div></div>
                  <div className="p-2.5 text-center"><div className="text-lg font-bold font-mono text-blue-600">{PIPELINE_STATS.running}</div><div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Running</div></div>
                </div>
                <div className="border-t border-gray-200 p-2.5"><div className="w-full h-1.5 bg-gray-100 flex overflow-hidden"><div className="bg-green-500 h-full" style={{ width: `${(PIPELINE_STATS.passed/PIPELINE_STATS.total)*100}%` }} /><div className="bg-red-500 h-full" style={{ width: `${(PIPELINE_STATS.failed/PIPELINE_STATS.total)*100}%` }} /><div className="bg-blue-500 h-full" style={{ width: `${(PIPELINE_STATS.running/PIPELINE_STATS.total)*100}%` }} /></div></div>
              </div>
            </div>

            {/* Security */}
            <div>
              <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center"><Shield size={12} className="mr-2 text-gray-900" /> Security</h2>
              <div onClick={() => onNavigate('settings')} className="border border-gray-300 bg-white p-3 shadow-[1px_1px_0_0_#111827] cursor-pointer hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px] transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xl font-bold font-mono text-gray-900">92<span className="text-sm text-gray-400">/100</span></div>
                  <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-200">Good</span>
                </div>
                <div className="space-y-1 text-[10px] font-mono">
                  <div className="flex justify-between"><span className="text-gray-500">IAM Policies</span><span className="text-green-600 font-bold">✓ Pass</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Dependencies</span><span className="text-amber-600 font-bold">2 CVEs</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Secrets Rotation</span><span className="text-green-600 font-bold">✓ Current</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
