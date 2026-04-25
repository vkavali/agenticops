import { useState, useCallback } from 'react';
import {
  Network, Zap, Database, Activity, AlertTriangle,
  CheckCircle2, Globe, Box, Bell, Users,
  X, Fingerprint, ChevronRight, Rocket,
  Settings2, Wrench, GitCommit, FileCode2, Command, LayoutTemplate,
  BarChart3, ZoomIn, ZoomOut, Maximize2
} from 'lucide-react';
import DashboardView from './DashboardView';
import IncidentsView from './IncidentsView';
import PipelinesView from './PipelinesView';
import DeploymentsView from './DeploymentsView';
import SettingsView from './SettingsView';

// ============================================================
// NODE TYPE DEFINITIONS
// ============================================================
const NODE_TYPES = {
  users:   { icon: Users,       fill: 'bg-gray-50' },
  cdn:     { icon: Globe,       fill: 'bg-blue-50' },
  api:     { icon: Network,     fill: 'bg-indigo-50' },
  lambda:  { icon: Zap,         fill: 'bg-amber-50' },
  db:      { icon: Database,    fill: 'bg-emerald-50' },
  storage: { icon: Box,         fill: 'bg-teal-50' },
  auth:    { icon: Fingerprint, fill: 'bg-rose-50' },
  monitor: { icon: Activity,    fill: 'bg-purple-50' },
  notify:  { icon: Bell,        fill: 'bg-orange-50' },
};

// ============================================================
// TOPOLOGY DATA
// ============================================================
const INITIAL_NODES = [
  { id: 'users',       type: 'users',   name: 'Global Traffic',    x: 50,   y: 350, status: 'healthy' },
  { id: 'cloudfront',  type: 'cdn',     name: 'CloudFront Edge',   x: 250,  y: 350, status: 'healthy' },
  { id: 's3-static',   type: 'storage', name: 'S3 Frontend',       x: 450,  y: 350, status: 'healthy' },
  { id: 'cognito',     type: 'auth',    name: 'Cognito Pool',      x: 450,  y: 550, status: 'healthy' },
  { id: 'api-gw',      type: 'api',     name: 'API Gateway',       x: 250,  y: 200, status: 'healthy' },
  { id: 'lambda-get',  type: 'lambda',  name: 'GET Handler',       x: 450,  y: 50,  status: 'healthy' },
  { id: 'lambda-post', type: 'lambda',  name: 'POST Handler',      x: 450,  y: 200, status: 'critical' },
  { id: 'lambda-auth', type: 'lambda',  name: 'Authorizer',        x: 450,  y: 450, status: 'healthy' },
  { id: 'lambda-proc', type: 'lambda',  name: 'Async Processor',   x: 650,  y: 200, status: 'healthy' },
  { id: 'dynamo',      type: 'db',      name: 'DynamoDB Core',     x: 850,  y: 50,  status: 'healthy' },
  { id: 's3-assets',   type: 'storage', name: 'S3 Assets',         x: 850,  y: 200, status: 'healthy' },
  { id: 'cloudwatch',  type: 'monitor', name: 'CloudWatch',        x: 850,  y: 450, status: 'healthy' },
  { id: 'sns',         type: 'notify',  name: 'SNS Topics',        x: 1050, y: 450, status: 'healthy' },
];

const INITIAL_LINKS = [
  { source: 'users',       target: 'cloudfront',   speed: '3s' },
  { source: 'users',       target: 'cognito',      speed: '4s',   dashed: true },
  { source: 'cloudfront',  target: 's3-static',    speed: '3s' },
  { source: 'cloudfront',  target: 'api-gw',       speed: '2s' },
  { source: 'api-gw',      target: 'lambda-get',   speed: '2.5s' },
  { source: 'api-gw',      target: 'lambda-post',  speed: '1s',   isError: true },
  { source: 'api-gw',      target: 'lambda-auth',  speed: '2.5s' },
  { source: 'lambda-auth', target: 'cognito',      speed: '2.5s' },
  { source: 'lambda-post', target: 'lambda-proc',  speed: '0s',   isBroken: true },
  { source: 'lambda-get',  target: 'dynamo',       speed: '2.5s' },
  { source: 'lambda-proc', target: 'dynamo',       speed: '2.5s' },
  { source: 'lambda-proc', target: 's3-assets',    speed: '3s' },
  { source: 'lambda-post', target: 'cloudwatch',   speed: '1.2s', isError: true, dashed: true },
  { source: 'cloudwatch',  target: 'sns',          speed: '2s',   dashed: true },
];

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [remediated, setRemediated] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Build SVG connection paths
  const getConnections = () => {
    return INITIAL_LINKS.map((link, i) => {
      const source = nodes.find(n => n.id === link.source);
      const target = nodes.find(n => n.id === link.target);
      if (!source || !target) return null;

      // Offset for p-10 (40px) padding on the node container
      const PAD = 40;
      const startX = source.x + 75 + PAD;
      const startY = source.y + 35 + PAD;
      const endX   = target.x + PAD;
      const endY   = target.y + 35 + PAD;

      const controlDist = Math.max(Math.abs(endX - startX) / 2, 30);
      const path = `M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`;

      let strokeColor = '#D1D5DB';
      if (link.isError && !remediated) strokeColor = '#EF4444';
      if (link.isBroken && !remediated) return null;
      if (remediated && (link.isError || link.isBroken)) strokeColor = '#10B981';

      return { id: `link-${i}`, path, speed: link.speed, dashed: link.dashed, strokeColor };
    }).filter(Boolean);
  };

  const handleAIOverride = () => {
    setIsFixing(true);
    setTimeout(() => {
      setIsFixing(false);
      setRemediated(true);
      setNodes(prev => prev.map(n => n.id === 'lambda-post' ? { ...n, status: 'healthy' } : n));
    }, 2500);
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const SelectedNodeIcon = selectedNode ? NODE_TYPES[selectedNode.type]?.icon : null;

  // Zoom state for infrastructure canvas
  const [zoom, setZoom] = useState(0.75);
  const zoomIn = () => setZoom(z => Math.min(2, +(z + 0.15).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(0.3, +(z - 0.15).toFixed(2)));
  const zoomFit = () => setZoom(0.65);
  const handleWheel = useCallback((e) => { e.preventDefault(); setZoom(z => { const next = z + (e.deltaY > 0 ? -0.08 : 0.08); return Math.max(0.3, Math.min(2, +next.toFixed(2))); }); }, []);

  return (
    <div className="flex h-screen bg-[#F9FAFB] text-gray-900 font-sans selection:bg-gray-200 overflow-hidden relative">

      {/* ========== SIDEBAR ========== */}
      <aside className="w-16 hover:w-64 transition-all duration-300 border-r border-gray-300 bg-white flex flex-col z-40 group shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="h-14 flex items-center justify-center group-hover:justify-start px-4 border-b border-gray-300">
          <Command size={18} className="text-gray-900 shrink-0" />
          <span className="ml-3 text-sm font-bold tracking-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            AgenticOps
          </span>
        </div>
        <nav className="flex-1 py-4 space-y-2 px-3 overflow-hidden">
          <NavItem icon={<BarChart3 size={16} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<LayoutTemplate size={16} />} label="Pipelines" active={activeTab === 'pipelines'} onClick={() => setActiveTab('pipelines')} />
          <NavItem icon={<Rocket size={16} />} label="Deployments" active={activeTab === 'deployments'} onClick={() => setActiveTab('deployments')} />
          <NavItem icon={<Network size={16} />} label="Infrastructure" active={activeTab === 'topology'} onClick={() => setActiveTab('topology')} />
          <NavItem icon={<Activity size={16} />} label="Incidents" active={activeTab === 'incidents'} onClick={() => setActiveTab('incidents')} />
          <NavItem icon={<Settings2 size={16} />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
      </aside>

      {/* ========== MAIN CONTENT ========== */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden z-10 relative">

        {/* Header Bar */}
        <header className="h-14 border-b border-gray-300 flex items-center justify-between px-6 bg-white shrink-0">
          <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-widest">
            <span>Environments</span>
            <ChevronRight size={14} className="mx-2 text-gray-400" />
            <span className="text-gray-900">Production</span>
          </div>
          <div className="flex items-center space-x-4">
            {!remediated && (
              <div className="flex items-center space-x-2 text-[10px] uppercase tracking-widest px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 font-bold">
                <AlertTriangle size={10} />
                <span>1 Incident Active</span>
              </div>
            )}
            <div className="flex items-center space-x-2 text-[10px] uppercase tracking-widest px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 font-bold">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span>Live Synced</span>
            </div>
          </div>
        </header>

        {/* ========== TAB CONTENT ========== */}
        {activeTab === 'dashboard' ? (
          <div className="flex-1 overflow-hidden"><DashboardView onNavigate={setActiveTab} /></div>
        ) : activeTab === 'topology' ? (
          <div className="flex-1 relative overflow-auto hidden-scrollbar bg-[#F9FAFB]" onClick={() => setSelectedNodeId(null)} onWheel={handleWheel}>
            <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', transition: 'transform 0.15s ease-out' }}>
              <div className="relative min-w-[1400px] min-h-[800px]">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#E5E7EB_1px,transparent_1px),linear-gradient(to_bottom,#E5E7EB_1px,transparent_1px)] bg-[size:20px_20px]" />
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">{getConnections().map(conn => (<g key={conn.id}><path d={conn.path} fill="none" stroke={conn.strokeColor} strokeWidth="2" strokeDasharray={conn.dashed ? '4,4' : 'none'} />{conn.speed !== '0s' && (<path d={conn.path} fill="none" stroke="#111827" strokeWidth="2" strokeDasharray="4 12" className="marching-ants opacity-30" style={{ animationDuration: conn.speed }} />)}</g>))}</svg>
                <div className="relative p-10">
                  <div className="absolute top-[20px] left-[200px] w-[580px] h-[560px] border-2 border-dashed border-gray-300 bg-white/40 pointer-events-none"><div className="absolute -top-3 left-4 px-2 bg-[#F9FAFB] text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">API_LAYER</div></div>
                  <div className="absolute top-[20px] left-[810px] w-[200px] h-[280px] border-2 border-dashed border-gray-300 bg-white/40 pointer-events-none"><div className="absolute -top-3 left-4 px-2 bg-[#F9FAFB] text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">DATA_LAYER</div></div>
                  <div className="absolute top-[400px] left-[810px] w-[440px] h-[160px] border-2 border-dashed border-gray-300 bg-white/40 pointer-events-none"><div className="absolute -top-3 left-4 px-2 bg-[#F9FAFB] text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">OBSERVABILITY</div></div>
                  {nodes.map(node => { const lib = NODE_TYPES[node.type]; const isSelected = selectedNodeId === node.id; const isFailed = node.status === 'critical' && !remediated; const Icon = lib.icon; return (<div key={node.id} onClick={(e) => { e.stopPropagation(); setSelectedNodeId(node.id); }} style={{ left: node.x, top: node.y, position: 'absolute' }} className={`w-[150px] bg-white border cursor-pointer outline-none select-none z-10 transition-all duration-150 ${isFailed ? 'border-red-600 shadow-[4px_4px_0_0_#DC2626]' : isSelected ? 'border-gray-900 shadow-[4px_4px_0_0_#111827] -translate-x-[2px] -translate-y-[2px] z-20' : 'border-gray-900 shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px]'}`}><div className={`h-1.5 w-full border-b border-gray-900 ${isFailed ? 'bg-red-500' : 'bg-gray-900'}`} /><div className="p-3 flex items-start space-x-2"><div className={`p-1.5 border border-gray-900 shrink-0 ${lib.fill}`}><Icon size={16} className={isFailed ? 'text-red-600' : 'text-gray-900'} strokeWidth={2} /></div><div className="overflow-hidden"><div className={`text-xs font-bold truncate leading-tight ${isFailed ? 'text-red-600' : 'text-gray-900'}`}>{node.name}</div><div className="text-[9px] text-gray-500 font-mono mt-0.5 truncate uppercase">{node.id}</div></div></div><div className="absolute top-1/2 -left-1 w-2 h-2 bg-white border border-gray-900 -translate-y-1/2" /><div className="absolute top-1/2 -right-1 w-2 h-2 bg-gray-900 border border-gray-900 -translate-y-1/2" /></div>); })}
                </div>
              </div>
            </div>
            {/* Zoom Controls - absolute within the relative topology container */}
            <div className="absolute bottom-6 right-6 z-30 flex flex-col items-center border-2 border-gray-900 bg-white shadow-[4px_4px_0_0_#111827]">
              <button onClick={(e) => { e.stopPropagation(); zoomIn(); }} className="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-200" title="Zoom In"><ZoomIn size={16} /></button>
              <div className="text-[10px] font-mono font-bold text-gray-500 px-2 py-1 select-none">{Math.round(zoom * 100)}%</div>
              <button onClick={(e) => { e.stopPropagation(); zoomOut(); }} className="p-2 hover:bg-gray-50 cursor-pointer border-t border-gray-200" title="Zoom Out"><ZoomOut size={16} /></button>
              <button onClick={(e) => { e.stopPropagation(); zoomFit(); }} className="p-2 hover:bg-gray-50 cursor-pointer border-t border-gray-200" title="Fit to Screen"><Maximize2 size={16} /></button>
            </div>
          </div>
        ) : activeTab === 'pipelines' ? (
          <div className="flex-1 overflow-hidden"><PipelinesView /></div>
        ) : activeTab === 'deployments' ? (
          <div className="flex-1 overflow-hidden"><DeploymentsView /></div>
        ) : activeTab === 'incidents' ? (
          <div className="flex-1 overflow-hidden"><IncidentsView /></div>
        ) : activeTab === 'settings' ? (
          <div className="flex-1 overflow-hidden"><SettingsView /></div>
        ) : null}

        {/* ========== INSPECTOR PANEL ========== */}
        <div className={`absolute right-0 top-0 bottom-0 w-[480px] bg-white border-l-2 border-gray-900 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.05)] transition-transform duration-300 ease-in-out z-30 ${selectedNode ? 'translate-x-0' : 'translate-x-full'}`}>
          {selectedNode && (
            <>
              {/* Header */}
              <div className="p-5 border-b border-gray-200 bg-gray-50 shrink-0">
                <div className="flex justify-between items-start mb-4">
                  <div className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border ${
                    selectedNode.status === 'critical' && !remediated
                      ? 'bg-red-50 text-red-600 border-red-200'
                      : 'bg-green-50 text-green-700 border-green-200'
                  }`}>
                    {selectedNode.status === 'critical' && !remediated
                      ? <><AlertTriangle size={12} className="mr-1.5" /> Degraded State</>
                      : <><CheckCircle2 size={12} className="mr-1.5" /> Nominal State</>
                    }
                  </div>
                  <button
                    onClick={() => setSelectedNodeId(null)}
                    className="text-gray-400 hover:text-gray-900 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                <h2 className="text-xl font-bold text-gray-900 flex items-center mb-1">
                  {SelectedNodeIcon && <SelectedNodeIcon size={20} className="mr-2 text-gray-900" strokeWidth={2} />}
                  {selectedNode.name}
                </h2>
                <div className="text-xs text-gray-500 font-mono mt-1 select-all">
                  arn:aws:{selectedNode.type}:us-east-1:123456789:{selectedNode.id}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto hidden-scrollbar">

                {/* ===== RESOLUTION PATCH MODULE ===== */}
                {selectedNode.status === 'critical' && (
                  <div className="p-5 border-b border-gray-200 bg-white">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center mb-4">
                      <Wrench size={12} className="mr-2 text-gray-900" /> Automated Resolution Plan
                    </h4>

                    {remediated ? (
                      <div className="border-2 border-green-500 bg-green-50 p-4">
                        <div className="flex items-center text-green-700 font-bold text-sm mb-2">
                          <CheckCircle2 size={16} className="mr-2" /> Patch Applied Successfully
                        </div>
                        <p className="text-xs text-green-600 font-mono mb-4">
                          {'>'} memory_size updated (128 → 256)<br />
                          {'>'} cloudwatch_alarm threshold updated
                        </p>
                        <button className="text-xs text-gray-900 font-bold uppercase tracking-widest border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50 flex items-center transition-colors">
                          <GitCommit size={14} className="mr-2" /> View Infrastructure Diff
                        </button>
                      </div>
                    ) : isFixing ? (
                      <div className="border-2 border-gray-900 bg-gray-50 p-4">
                        <div className="flex items-center text-gray-900 font-bold text-sm mb-4">
                          <div className="w-3.5 h-3.5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mr-2" />
                          Executing IaC Modification
                        </div>
                        <div className="space-y-1.5 text-xs font-mono text-gray-600">
                          <div>{'>'} generating terraform patch...</div>
                          <div>{'>'} applying aws_lambda_function.main...</div>
                          <div className="animate-pulse">{'>'} awaiting remote state lock...</div>
                        </div>
                      </div>
                    ) : (
                      <div className="border-2 border-red-500 bg-white p-5 shadow-[4px_4px_0_0_#DC2626] relative">
                        <div className="flex items-start mb-4">
                          <div className="bg-red-100 p-1.5 border border-red-200 mr-3 shrink-0">
                            <AlertTriangle size={16} className="text-red-600" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-gray-900 mb-1">Heap Memory Exhaustion</div>
                            <p className="text-xs text-gray-600 leading-relaxed">
                              Function invocations are dropping due to{' '}
                              <code className="bg-red-50 text-red-600 px-1 py-0.5 font-mono border border-red-200 text-[10px]">
                                OutOfMemoryError
                              </code>
                              . Current allocation (128MB) is insufficient for payload size.
                            </p>
                          </div>
                        </div>

                        {/* IaC Diff */}
                        <div className="bg-gray-50 border border-gray-200 font-mono text-[10px] p-3 mb-5 overflow-hidden">
                          <div className="text-gray-400 mb-2 select-none"># Proposed IaC Patch</div>
                          <div className="text-red-600 bg-red-50 px-2 py-0.5 flex">
                            <span className="w-4 shrink-0 select-none">-</span>
                            memory_size = 128
                          </div>
                          <div className="text-green-600 bg-green-50 px-2 py-0.5 flex">
                            <span className="w-4 shrink-0 select-none">+</span>
                            memory_size = 256
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            Cost Impact: <span className="text-gray-900">+$1.20/mo</span>
                          </div>
                          <button
                            onClick={handleAIOverride}
                            className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold transition-colors shadow-[2px_2px_0_0_#D1D5DB] active:translate-y-px active:shadow-none cursor-pointer"
                          >
                            Execute Patch
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ===== TELEMETRY ===== */}
                <div className="p-5 border-b border-gray-200">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
                    <BarChart3 size={12} className="mr-2 text-gray-900" /> Telemetry (Last 1h)
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard
                      label="Throughput"
                      value="24.5"
                      unit="k/m"
                      danger={false}
                    />
                    <MetricCard
                      label="P99 Latency"
                      value={selectedNode.status === 'critical' && !remediated ? '5,020' : '142'}
                      unit="ms"
                      danger={selectedNode.status === 'critical' && !remediated}
                    />
                    <MetricCard
                      label="Error Rate"
                      value={selectedNode.status === 'critical' && !remediated ? '23.4' : '0.02'}
                      unit="%"
                      danger={selectedNode.status === 'critical' && !remediated}
                    />
                    <MetricCard
                      label="Memory"
                      value={selectedNode.status === 'critical' && !remediated ? '128' : '256'}
                      unit="MB"
                      danger={selectedNode.status === 'critical' && !remediated}
                    />
                  </div>
                </div>

                {/* ===== SPARKLINE CHART ===== */}
                <div className="p-5 border-b border-gray-200">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center">
                    <Activity size={12} className="mr-2 text-gray-900" /> Invocation Rate
                  </h4>
                  <SparklineChart
                    isError={selectedNode.status === 'critical' && !remediated}
                  />
                </div>

                {/* ===== TERMINAL LOG OUTPUT ===== */}
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center">
                      <FileCode2 size={12} className="mr-2 text-gray-900" /> Standard Output
                    </h4>
                    <div className="flex items-center text-gray-900 font-bold text-[9px] uppercase tracking-widest bg-gray-100 px-2 py-0.5 border border-gray-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5" /> Tailing
                    </div>
                  </div>

                  <div className="bg-[#111827] border-2 border-gray-900 p-4 font-mono text-[10px] h-64 overflow-y-auto space-y-2 hidden-scrollbar">
                    <LogLine ts="10:43:58" color="gray-500">START RequestId: 2c4d-8a01</LogLine>
                    <LogLine ts="10:43:58" color="gray-300">
                      <span className="text-blue-400">INFO</span> Initializing handler context
                    </LogLine>
                    <LogLine ts="10:43:59" color="gray-300">
                      <span className="text-blue-400">INFO</span> Processing payload from 10.0.4.32
                    </LogLine>

                    {selectedNode.status === 'critical' && !remediated ? (
                      <>
                        <LogLine ts="10:44:01" color="yellow-400">
                          WARN Max memory threshold (90%) exceeded.
                        </LogLine>
                        <LogLine ts="10:44:03" color="red-400">
                          ERROR Exception in thread "main" java.lang.OutOfMemoryError: Java heap space
                        </LogLine>
                        <div className="text-red-400 pl-4 font-mono text-[10px]">
                          at com.nexus.api.PostHandler.process(PostHandler.java:42)
                        </div>
                        <div className="text-red-400 pl-4 font-mono text-[10px]">
                          at com.nexus.api.Router.dispatch(Router.java:118)
                        </div>
                        <LogLine ts="10:44:05" color="gray-500">
                          END RequestId: 2c4d-8a01
                        </LogLine>
                        <div className="text-red-300/70 mt-2 font-mono text-[10px]">
                          REPORT RequestId: 2c4d Duration: 5002ms Billed: 5000ms Mem: 128MB Max: 128MB
                        </div>
                        <LogLine ts="10:44:06" color="gray-500">START RequestId: 8a9b-4f32</LogLine>
                        <LogLine ts="10:44:08" color="red-400">
                          ERROR OutOfMemoryError: Java heap space (repeated)
                        </LogLine>
                      </>
                    ) : (
                      <>
                        <LogLine ts="10:44:01" color="gray-300">
                          <span className="text-blue-400">INFO</span> Database transaction committed.
                        </LogLine>
                        <LogLine ts="10:44:01" color="gray-300">
                          <span className="text-green-400">INFO</span> Response 200 OK (142ms)
                        </LogLine>
                        <LogLine ts="10:44:01" color="gray-500">
                          END RequestId: 2c4d-8a01
                        </LogLine>
                        <div className="text-gray-400 mt-2 font-mono text-[10px]">
                          REPORT RequestId: 2c4d Duration: 142ms Billed: 143ms Mem: 256MB Max: 140MB
                        </div>
                      </>
                    )}

                    <div className="text-gray-500 pt-2 flex items-center animate-pulse">
                      <span className="mr-2 text-white font-bold">{'>'}</span> Polling...
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function NavItem({ icon, label, active = false, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center p-2 transition-all duration-150 overflow-hidden cursor-pointer ${
        active
          ? 'text-gray-900 border-l-2 border-gray-900 bg-gray-50'
          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 border-l-2 border-transparent'
      }`}
    >
      <div className="flex-shrink-0 flex items-center justify-center w-8">{icon}</div>
      <span className="ml-3 text-xs font-bold tracking-tight whitespace-nowrap">{label}</span>
    </button>
  );
}

function MetricCard({ label, value, unit, danger }) {
  return (
    <div className="border border-gray-200 p-3 bg-gray-50">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${danger ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
        <span className="text-xs text-gray-500 font-normal ml-0.5">{unit}</span>
      </div>
    </div>
  );
}

function LogLine({ ts, color, children }) {
  return (
    <div className={`text-${color}`}>
      <span className="text-gray-600 mr-2 select-none">2026-04-24T{ts}Z</span>
      {children}
    </div>
  );
}

function SparklineChart({ isError }) {
  // Generate a realistic-looking sparkline
  const points = [];
  const w = 400;
  const h = 50;
  const steps = 40;

  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w;
    let base = isError ? 35 : 15;
    let noise = Math.sin(i * 0.8) * 8 + Math.sin(i * 2.1) * 4 + Math.cos(i * 0.3) * 6;

    // If error, add a dramatic spike in the middle
    if (isError && i > steps * 0.6) {
      noise += (i - steps * 0.6) * 1.5;
    }

    const y = Math.max(2, Math.min(h - 2, base + noise));
    points.push(`${x},${y}`);
  }

  const polyline = points.join(' ');
  const fillPoints = `0,${h} ${polyline} ${w},${h}`;

  return (
    <div className="border border-gray-200 bg-gray-50 p-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12">
        <polygon points={fillPoints} fill={isError ? '#FEE2E2' : '#F0FDF4'} />
        <polyline
          points={polyline}
          fill="none"
          stroke={isError ? '#EF4444' : '#111827'}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {isError && (
          <line x1={w * 0.6} y1="0" x2={w * 0.6} y2={h} stroke="#EF4444" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        )}
      </svg>
      <div className="flex justify-between mt-1.5 text-[9px] font-mono text-gray-400 uppercase tracking-wider">
        <span>-60m</span>
        {isError && <span className="text-red-500 font-bold">▲ Anomaly Onset</span>}
        <span>Now</span>
      </div>
    </div>
  );
}
