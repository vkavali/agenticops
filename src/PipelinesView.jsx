import { useState, useEffect } from 'react';
import {
  Plus, Play, CheckCircle2, XCircle, Clock, GitBranch, Trash2, ChevronRight, ChevronDown,
  Code, Shield, Rocket, TestTube, Eye, X, Save, FileCode2, Settings2, History, Terminal,
  Pause, RotateCcw, Timer, Webhook, Calendar
} from 'lucide-react';

const STAGE_PALETTE = [
  { type: 'build', label: 'Build', icon: Code, color: 'bg-blue-50', borderColor: 'border-blue-300', textColor: 'text-blue-700' },
  { type: 'test', label: 'Test', icon: TestTube, color: 'bg-amber-50', borderColor: 'border-amber-300', textColor: 'text-amber-700' },
  { type: 'security', label: 'Security Scan', icon: Shield, color: 'bg-purple-50', borderColor: 'border-purple-300', textColor: 'text-purple-700' },
  { type: 'deploy', label: 'Deploy', icon: Rocket, color: 'bg-emerald-50', borderColor: 'border-emerald-300', textColor: 'text-emerald-700' },
  { type: 'approval', label: 'Approval Gate', icon: Eye, color: 'bg-rose-50', borderColor: 'border-rose-300', textColor: 'text-rose-700' },
  { type: 'script', label: 'Custom Script', icon: FileCode2, color: 'bg-gray-50', borderColor: 'border-gray-300', textColor: 'text-gray-700' },
];

const STAGE_DEFAULTS = {
  build: { name: 'Build', image: 'node:20-alpine', commands: ['npm ci', 'npm run build'], timeout: '10m' },
  test: { name: 'Unit Tests', image: 'node:20-alpine', commands: ['npm test -- --coverage'], timeout: '15m' },
  security: { name: 'Security Scan', image: 'aquasec/trivy:latest', commands: ['trivy fs --severity HIGH,CRITICAL .'], timeout: '5m' },
  deploy: { name: 'Deploy', image: 'hashicorp/terraform:latest', commands: ['terraform init', 'terraform apply -auto-approve'], timeout: '20m', env: 'staging' },
  approval: { name: 'Manual Approval', approvers: ['ops-team'], timeout: '1h' },
  script: { name: 'Custom Script', image: 'alpine:latest', commands: ['echo "Hello"'], timeout: '5m' },
};

const PIPELINES_DATA = [
  {
    id: 'pipe-1', name: 'api-service / deploy', branch: 'main', lastRun: 'passed', lastRunTime: '8m ago',
    trigger: { type: 'push', branch: 'main' }, schedule: null,
    stages: [
      { id: 's1', type: 'build', ...STAGE_DEFAULTS.build },
      { id: 's2', type: 'test', ...STAGE_DEFAULTS.test },
      { id: 's3', type: 'security', ...STAGE_DEFAULTS.security },
      { id: 's4', type: 'deploy', name: 'Deploy Staging', ...STAGE_DEFAULTS.deploy },
      { id: 's5', type: 'approval', ...STAGE_DEFAULTS.approval },
      { id: 's6', type: 'deploy', name: 'Deploy Production', ...STAGE_DEFAULTS.deploy, env: 'production' },
    ],
    runs: [
      { id: 'r-1', number: '#47', commit: 'a8f3c21', msg: 'fix: POST handler memory', status: 'passed', duration: '4m 18s', time: '8m ago', by: 'ARC-R', stageResults: [
        { name: 'Build', status: 'passed', duration: '34s', logs: ['> npm ci\n✓ 847 packages installed\n> npm run build\n✓ Build completed in 12.4s\nOutput: dist/ (2.3MB)'] },
        { name: 'Unit Tests', status: 'passed', duration: '1m 12s', logs: ['> npm test -- --coverage\n\nTest Suites: 24 passed, 24 total\nTests:       142 passed, 142 total\nCoverage:    87.3%\n\n✓ All tests passed'] },
        { name: 'Security Scan', status: 'passed', duration: '22s', logs: ['> trivy fs --severity HIGH,CRITICAL .\n\nTotal: 0 vulnerabilities\n✓ No HIGH or CRITICAL vulnerabilities found'] },
        { name: 'Deploy Staging', status: 'passed', duration: '1m 45s', logs: ['> terraform init\n✓ Initialized\n> terraform apply\nApply complete! Resources: 2 added, 1 changed\n✓ Deployed to staging'] },
        { name: 'Manual Approval', status: 'passed', duration: '15s', logs: ['Approved by: ARC-R Engine (auto-approval)'] },
        { name: 'Deploy Production', status: 'passed', duration: '1m 50s', logs: ['> terraform apply\nApply complete! Resources: 2 added, 1 changed\n✓ Deployed to production\nHealth check: 200 OK'] },
      ]},
      { id: 'r-2', number: '#46', commit: 'f2b8d09', msg: 'feat: user preferences endpoint', status: 'passed', duration: '4m 02s', time: '45m ago', by: 'v.kavali', stageResults: [
        { name: 'Build', status: 'passed', duration: '31s', logs: ['Build completed'] },
        { name: 'Unit Tests', status: 'passed', duration: '1m 08s', logs: ['142 tests passed'] },
        { name: 'Security Scan', status: 'passed', duration: '20s', logs: ['0 vulnerabilities'] },
        { name: 'Deploy Staging', status: 'passed', duration: '1m 40s', logs: ['Deployed to staging'] },
        { name: 'Manual Approval', status: 'passed', duration: '12m', logs: ['Approved by: v.kavali'] },
        { name: 'Deploy Production', status: 'passed', duration: '1m 43s', logs: ['Deployed to production'] },
      ]},
      { id: 'r-3', number: '#45', commit: 'b1c4e88', msg: 'refactor: handler middleware', status: 'passed', duration: '3m 55s', time: '3h ago', by: 'ci-bot', stageResults: [] },
    ],
  },
  {
    id: 'pipe-2', name: 'frontend / build-test', branch: 'main', lastRun: 'failed', lastRunTime: '1h ago',
    trigger: { type: 'push', branch: 'main' }, schedule: '0 */6 * * *',
    stages: [
      { id: 's1', type: 'build', ...STAGE_DEFAULTS.build, commands: ['npm ci', 'npm run build:prod'] },
      { id: 's2', type: 'test', ...STAGE_DEFAULTS.test },
      { id: 's3', type: 'deploy', name: 'Deploy CDN', ...STAGE_DEFAULTS.deploy },
    ],
    runs: [
      { id: 'r-4', number: '#31', commit: 'c4e1a77', msg: 'chore: bundle optimization', status: 'failed', duration: '2m 44s', time: '1h ago', by: 'v.kavali', stageResults: [
        { name: 'Build', status: 'passed', duration: '38s', logs: ['Build completed'] },
        { name: 'Unit Tests', status: 'failed', duration: '1m 06s', logs: ['FAIL src/components/Dashboard.test.tsx\n\n● Dashboard › renders health score\n  Expected: 94.2\n  Received: undefined\n\nTest Suites: 1 failed, 23 passed, 24 total\nTests: 3 failed, 139 passed, 142 total\n\n✗ Tests failed'] },
        { name: 'Deploy CDN', status: 'skipped', duration: '—', logs: ['Skipped: previous stage failed'] },
      ]},
      { id: 'r-5', number: '#30', commit: 'e9a2f11', msg: 'feat: dark mode support', status: 'passed', duration: '3m 10s', time: '6h ago', by: 'v.kavali', stageResults: [] },
    ],
  },
  {
    id: 'pipe-3', name: 'worker-service / deploy', branch: 'main', lastRun: 'passed', lastRunTime: '3h ago',
    trigger: { type: 'tag', pattern: 'v*' }, schedule: null,
    stages: [
      { id: 's1', type: 'build', ...STAGE_DEFAULTS.build, image: 'golang:1.22' },
      { id: 's2', type: 'test', ...STAGE_DEFAULTS.test, image: 'golang:1.22', commands: ['go test ./...'] },
      { id: 's3', type: 'security', ...STAGE_DEFAULTS.security },
      { id: 's4', type: 'deploy', ...STAGE_DEFAULTS.deploy },
    ],
    runs: [
      { id: 'r-6', number: '#19', commit: 'b9d2e44', msg: 'perf: batch processing', status: 'passed', duration: '5m 02s', time: '3h ago', by: 'ci-bot', stageResults: [] },
    ],
  },
];

const RUN_STATUS = {
  passed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-500' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500' },
  running: { icon: Play, color: 'text-blue-600', bg: 'bg-blue-500' },
  skipped: { icon: Pause, color: 'text-gray-400', bg: 'bg-gray-300' },
};

export default function PipelinesView() {
  const [pipelines, setPipelines] = useState(PIPELINES_DATA);
  const [selPipeId, setSelPipeId] = useState(PIPELINES_DATA[0].id);
  const [stages, setStages] = useState(PIPELINES_DATA[0].stages);
  const [selectedStage, setSelectedStage] = useState(null);
  const [showYaml, setShowYaml] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [activePanel, setActivePanel] = useState('builder'); // builder | runs | config
  const [expandedRun, setExpandedRun] = useState(null);
  const [expandedStageLog, setExpandedStageLog] = useState(null);
  const [runStageProgress, setRunStageProgress] = useState([]);

  const notify = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 2500); };
  const selPipe = pipelines.find(p => p.id === selPipeId);

  const selectPipeline = (p) => { setSelPipeId(p.id); setStages(p.stages); setSelectedStage(null); setShowYaml(false); setActivePanel('builder'); };
  const addStage = (type) => { setStages([...stages, { id: `s${Date.now()}`, type, ...STAGE_DEFAULTS[type] }]); };
  const removeStage = (id) => { setStages(stages.filter(s => s.id !== id)); if (selectedStage?.id === id) setSelectedStage(null); };

  const handleSave = () => { setIsSaved(true); setPipelines(p => p.map(pp => pp.id === selPipeId ? { ...pp, stages } : pp)); notify('Pipeline saved'); setTimeout(() => setIsSaved(false), 2000); };

  const handleRun = () => {
    if (isRunning) return;
    setIsRunning(true);
    setActivePanel('runs');
    const stageNames = stages.map(s => s.name);
    setRunStageProgress([]);

    // Simulate stage-by-stage execution
    stageNames.forEach((name, i) => {
      setTimeout(() => {
        setRunStageProgress(prev => [...prev, { name, status: 'running', duration: '—', logs: [`> Executing ${name}...`] }]);
      }, i * 1200);
      setTimeout(() => {
        setRunStageProgress(prev => prev.map((s, j) => j === i ? { ...s, status: 'passed', duration: `${(Math.random() * 60 + 10).toFixed(0)}s`, logs: [...s.logs, `✓ ${name} completed successfully`] } : s));
      }, i * 1200 + 1000);
    });

    setTimeout(() => {
      setIsRunning(false);
      const newRun = { id: `r-${Date.now()}`, number: `#${48 + Math.floor(Math.random() * 10)}`, commit: Math.random().toString(36).slice(2,9), msg: 'triggered manually', status: 'passed', duration: `${stageNames.length}m ${Math.floor(Math.random()*50)}s`, time: 'Just now', by: 'operator', stageResults: stageNames.map(n => ({ name: n, status: 'passed', duration: `${(Math.random()*60+10).toFixed(0)}s`, logs: [`✓ ${n} completed`] })) };
      setPipelines(p => p.map(pp => pp.id === selPipeId ? { ...pp, lastRun: 'passed', lastRunTime: 'Just now', runs: [newRun, ...pp.runs] } : pp));
      setRunStageProgress([]);
      notify('Pipeline completed successfully');
    }, stageNames.length * 1200 + 1200);
  };

  const addPipeline = () => {
    const newP = { id: `pipe-${Date.now()}`, name: `new-pipeline-${pipelines.length + 1}`, branch: 'main', lastRun: 'passed', lastRunTime: 'new', trigger: { type: 'push', branch: 'main' }, schedule: null, stages: [], runs: [] };
    setPipelines([...pipelines, newP]); setSelPipeId(newP.id); setStages([]); notify('Pipeline created');
  };

  const generateYaml = () => {
    let y = `# ${selPipe?.name}\n# Auto-generated by AgenticOps\n\npipeline:\n  name: "${selPipe?.name}"\n  trigger:\n    type: ${selPipe?.trigger?.type}\n    branch: ${selPipe?.trigger?.branch || selPipe?.trigger?.pattern || 'main'}\n`;
    if (selPipe?.schedule) y += `  schedule: "${selPipe.schedule}"\n`;
    y += '\n  stages:\n';
    stages.forEach(s => { y += `    - name: "${s.name}"\n      type: ${s.type}\n`; if (s.image) y += `      image: ${s.image}\n`; if (s.commands) y += `      commands:\n${s.commands.map(c => `        - ${c}`).join('\n')}\n`; if (s.timeout) y += `      timeout: ${s.timeout}\n`; if (s.env) y += `      environment: ${s.env}\n`; y += '\n'; });
    return y;
  };

  return (
    <div className="flex h-full relative">
      {notification && <div className="fixed top-4 right-4 z-50 border-2 border-gray-900 bg-white px-4 py-3 shadow-[4px_4px_0_0_#111827] text-xs font-bold text-gray-900 animate-pulse">{notification}</div>}

      {/* Pipeline List */}
      <div className="w-[240px] border-r border-gray-300 bg-white shrink-0 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pipelines</h2>
          <button onClick={addPipeline} className="p-1 border border-gray-300 hover:bg-gray-50 cursor-pointer"><Plus size={12} /></button>
        </div>
        <div className="flex-1 overflow-y-auto hidden-scrollbar">
          {pipelines.map(p => {
            const st = RUN_STATUS[p.lastRun] || RUN_STATUS.passed; const StIcon = st.icon;
            return (
              <button key={p.id} onClick={() => selectPipeline(p)}
                className={`w-full text-left p-3 border-b border-gray-100 cursor-pointer transition-all ${selPipeId === p.id ? 'bg-gray-50 border-l-2 border-l-gray-900' : 'hover:bg-gray-50 border-l-2 border-l-transparent'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-900 truncate">{p.name}</span>
                  <StIcon size={12} className={st.color} />
                </div>
                <div className="text-[10px] font-mono text-gray-400 mt-0.5 flex items-center">
                  <GitBranch size={9} className="mr-1" />{p.branch} · {p.lastRunTime}
                </div>
                <div className="flex items-center space-x-1 mt-1">
                  {p.trigger && <span className="text-[8px] font-mono text-gray-400 bg-gray-100 px-1 py-0.5">{p.trigger.type}</span>}
                  {p.schedule && <span className="text-[8px] font-mono text-gray-400 bg-blue-50 px-1 py-0.5 text-blue-600"><Calendar size={7} className="inline mr-0.5" />cron</span>}
                  <span className="text-[8px] font-mono text-gray-400 bg-gray-100 px-1 py-0.5">{p.runs?.length || 0} runs</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="h-12 border-b border-gray-200 flex items-center justify-between px-4 bg-white shrink-0">
          <div className="flex items-center space-x-2">
            <h3 className="text-xs font-bold text-gray-900">{selPipe?.name}</h3>
            <span className="text-[9px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 border border-gray-200">{stages.length} stages</span>
            {/* Panel Tabs */}
            <div className="flex items-center ml-4 border border-gray-200">
              {[{ id: 'builder', label: 'Builder', icon: Code }, { id: 'runs', label: 'Runs', icon: History }, { id: 'config', label: 'Config', icon: Settings2 }].map(t => {
                const TIcon = t.icon;
                return (
                  <button key={t.id} onClick={() => setActivePanel(t.id)}
                    className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 flex items-center cursor-pointer transition-all ${activePanel === t.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    <TIcon size={9} className="mr-1" /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {activePanel === 'builder' && (
              <button onClick={() => setShowYaml(!showYaml)} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-gray-300 bg-white hover:bg-gray-50 flex items-center cursor-pointer">
                <FileCode2 size={10} className="mr-1" /> {showYaml ? 'Canvas' : 'YAML'}
              </button>
            )}
            <button onClick={handleSave}
              className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border flex items-center cursor-pointer transition-all ${isSaved ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 bg-white hover:bg-gray-50'}`}>
              <Save size={10} className="mr-1" /> {isSaved ? '✓ Saved' : 'Save'}
            </button>
            <button onClick={handleRun}
              className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 shadow-[2px_2px_0_0_#D1D5DB] flex items-center cursor-pointer transition-all ${isRunning ? 'bg-blue-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>
              <Play size={10} className={`mr-1 ${isRunning ? 'animate-spin' : ''}`} /> {isRunning ? 'Running...' : 'Run Pipeline'}
            </button>
          </div>
        </div>

        {/* ═══ BUILDER PANEL ═══ */}
        {activePanel === 'builder' && (
          showYaml ? (
            <div className="flex-1 bg-[#111827] p-6 overflow-y-auto hidden-scrollbar">
              <pre className="text-[11px] font-mono text-gray-300 leading-relaxed whitespace-pre">{generateYaml()}</pre>
            </div>
          ) : (
            <div className="flex-1 overflow-auto hidden-scrollbar bg-[#F9FAFB]">
              <div className="p-6 min-h-full">
                <div className="mb-6">
                  <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Add Stage</div>
                  <div className="flex items-center space-x-2 flex-wrap">
                    {STAGE_PALETTE.map(s => { const Icon = s.icon; return (
                      <button key={s.type} onClick={() => addStage(s.type)}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 border ${s.borderColor} ${s.color} ${s.textColor} text-[10px] font-bold cursor-pointer hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#111827] transition-all`}>
                        <Icon size={11} /> <span>{s.label}</span>
                      </button>
                    ); })}
                  </div>
                </div>
                <div className="flex items-start space-x-0 overflow-x-auto pb-4">
                  {stages.map((stage, i) => {
                    const pal = STAGE_PALETTE.find(p => p.type === stage.type); const Icon = pal.icon; const isSelected = selectedStage?.id === stage.id;
                    return (
                      <div key={stage.id} className="flex items-center shrink-0">
                        <div onClick={() => setSelectedStage(isSelected ? null : stage)}
                          className={`w-[160px] border bg-white cursor-pointer transition-all relative ${isSelected ? 'border-gray-900 shadow-[4px_4px_0_0_#111827] -translate-x-[2px] -translate-y-[2px]' : `${pal.borderColor} shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px]`}`}>
                          <div className={`h-1.5 w-full ${pal.color} border-b ${pal.borderColor}`} />
                          <div className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center space-x-1.5">
                                <div className={`p-1 border ${pal.borderColor} ${pal.color}`}><Icon size={11} className={pal.textColor} /></div>
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{pal.label}</span>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); removeStage(stage.id); }} className="text-gray-300 hover:text-red-500 cursor-pointer p-0.5"><Trash2 size={10} /></button>
                            </div>
                            <div className="text-xs font-bold text-gray-900 truncate">{stage.name}</div>
                            {stage.image && <div className="text-[9px] font-mono text-gray-400 mt-0.5 truncate">{stage.image}</div>}
                            {stage.timeout && <div className="text-[9px] font-mono text-gray-400">timeout: {stage.timeout}</div>}
                          </div>
                        </div>
                        {i < stages.length - 1 && (
                          <div className="flex items-center px-1 shrink-0">
                            <div className="w-8 h-0.5 bg-gray-300 relative"><div className="absolute inset-0 bg-gray-900 h-0.5 marching-ants" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #111827 0px, #111827 4px, transparent 4px, transparent 12px)', animationDuration: '1s' }} /></div>
                            <ChevronRight size={10} className="text-gray-400 -ml-1" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {stages.length === 0 && <div className="border-2 border-dashed border-gray-300 p-8 text-center w-full"><div className="text-xs text-gray-400 font-bold">No stages. Click above to add.</div></div>}
                </div>
              </div>
            </div>
          )
        )}

        {/* ═══ RUN HISTORY PANEL ═══ */}
        {activePanel === 'runs' && (
          <div className="flex-1 overflow-y-auto hidden-scrollbar bg-[#F9FAFB] p-6">
            {/* Live progress during a run */}
            {isRunning && runStageProgress.length > 0 && (
              <div className="border-2 border-blue-400 bg-white mb-4 shadow-[3px_3px_0_0_#2563EB]">
                <div className="p-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-700 flex items-center"><Play size={12} className="mr-1.5 animate-spin" /> Running Now</span>
                  <span className="text-[10px] font-mono text-blue-500">{runStageProgress.filter(s => s.status === 'passed').length}/{stages.length} stages</span>
                </div>
                <div className="p-3 space-y-1">
                  {runStageProgress.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
                      <div className="flex items-center space-x-2">
                        {s.status === 'running' ? <Play size={10} className="text-blue-500 animate-spin" /> : <CheckCircle2 size={10} className="text-green-500" />}
                        <span className="text-xs font-bold text-gray-900">{s.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400">{s.duration}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past Runs */}
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Run History</div>
            <div className="space-y-2">
              {(selPipe?.runs || []).map(run => {
                const st = RUN_STATUS[run.status]; const StIcon = st.icon; const isExpanded = expandedRun === run.id;
                return (
                  <div key={run.id} className={`border bg-white ${run.status === 'failed' ? 'border-red-300 shadow-[1px_1px_0_0_#DC2626]' : 'border-gray-300 shadow-[1px_1px_0_0_#111827]'}`}>
                    <div onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="flex items-center space-x-3">
                        <StIcon size={14} className={st.color} />
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-gray-900">{run.number}</span>
                            <span className="text-[10px] font-mono text-gray-400 flex items-center"><GitBranch size={9} className="mr-0.5" />{run.commit}</span>
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{run.msg}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="text-[10px] font-mono text-gray-400">{run.by}</span>
                        <span className="text-[10px] font-mono text-gray-400 flex items-center"><Timer size={9} className="mr-0.5" />{run.duration}</span>
                        <span className="text-[10px] font-mono text-gray-400 flex items-center"><Clock size={9} className="mr-0.5" />{run.time}</span>
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    </div>

                    {isExpanded && run.stageResults.length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        {/* Stage progress bar */}
                        <div className="px-3 pt-3 flex items-center space-x-1">
                          {run.stageResults.map((sr, i) => {
                            const sSt = RUN_STATUS[sr.status] || RUN_STATUS.passed;
                            return <div key={i} className={`flex-1 h-2 ${sSt.bg}`} />;
                          })}
                        </div>
                        {/* Stage list */}
                        <div className="p-3 space-y-1">
                          {run.stageResults.map((sr, i) => {
                            const sSt = RUN_STATUS[sr.status] || RUN_STATUS.passed; const SIcon = sSt.icon;
                            const isLogOpen = expandedStageLog === `${run.id}-${i}`;
                            return (
                              <div key={i}>
                                <div onClick={() => setExpandedStageLog(isLogOpen ? null : `${run.id}-${i}`)}
                                  className="flex items-center justify-between py-2 px-2 hover:bg-white cursor-pointer transition-colors border-b border-gray-100">
                                  <div className="flex items-center space-x-2">
                                    <SIcon size={12} className={sSt.color} />
                                    <span className="text-xs font-bold text-gray-900">{sr.name}</span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] font-mono text-gray-400">{sr.duration}</span>
                                    <Terminal size={10} className="text-gray-400" />
                                  </div>
                                </div>
                                {isLogOpen && sr.logs.length > 0 && (
                                  <div className="bg-[#111827] p-3 mx-2 mb-2 border-2 border-gray-900">
                                    <pre className="text-[10px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">{sr.logs.join('\n')}</pre>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {(!selPipe?.runs || selPipe.runs.length === 0) && (
                <div className="border-2 border-dashed border-gray-300 p-8 text-center">
                  <div className="text-xs text-gray-400 font-bold">No runs yet. Click "Run Pipeline" to start.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ CONFIG PANEL ═══ */}
        {activePanel === 'config' && selPipe && (
          <div className="flex-1 overflow-y-auto hidden-scrollbar bg-[#F9FAFB] p-6">
            <div className="max-w-[600px] space-y-4">
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Trigger</div>
                <div className="flex space-x-2">
                  {['push', 'pull_request', 'tag', 'manual'].map(t => (
                    <button key={t} onClick={() => { setPipelines(p => p.map(pp => pp.id === selPipeId ? { ...pp, trigger: { ...pp.trigger, type: t } } : pp)); notify(`Trigger → ${t}`); }}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-1.5 border cursor-pointer text-center ${selPipe.trigger?.type === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Branch Filter</div>
                <div className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-3 py-2">{selPipe.trigger?.branch || selPipe.trigger?.pattern || 'main'}</div>
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Schedule (Cron)</div>
                  <ToggleSmall value={!!selPipe.schedule} onChange={() => { setPipelines(p => p.map(pp => pp.id === selPipeId ? { ...pp, schedule: pp.schedule ? null : '0 */6 * * *' } : pp)); notify(selPipe.schedule ? 'Schedule disabled' : 'Schedule enabled'); }} />
                </div>
                {selPipe.schedule && <div className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-3 py-2">{selPipe.schedule}</div>}
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Notification on Failure</div>
                <div className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-3 py-2">#deployments (Slack)</div>
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Concurrency</div>
                <div className="text-xs text-gray-700">Max <span className="font-mono font-bold">1</span> concurrent run. Queue additional triggers.</div>
              </div>
              <button onClick={() => { setPipelines(p => p.filter(pp => pp.id !== selPipeId)); if (pipelines.length > 1) { const next = pipelines.find(pp => pp.id !== selPipeId); setSelPipeId(next.id); setStages(next.stages); } notify('Pipeline deleted'); }}
                className="text-[10px] font-bold text-red-500 border border-red-300 px-3 py-1.5 hover:bg-red-50 cursor-pointer flex items-center"><Trash2 size={10} className="mr-1" /> Delete Pipeline</button>
            </div>
          </div>
        )}
      </div>

      {/* Stage Config Panel (right) */}
      {selectedStage && activePanel === 'builder' && !showYaml && (
        <div className="w-[280px] bg-white border-l-2 border-gray-900 flex flex-col shadow-[-5px_0_20px_rgba(0,0,0,0.03)] shrink-0">
          {(() => { const pal = STAGE_PALETTE.find(p => p.type === selectedStage.type); const Icon = pal.icon; return (<>
            <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2"><div className={`p-1 border ${pal.borderColor} ${pal.color}`}><Icon size={12} className={pal.textColor} /></div><span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{pal.label}</span></div>
                <button onClick={() => setSelectedStage(null)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
              </div>
              <h3 className="text-sm font-bold text-gray-900">{selectedStage.name}</h3>
            </div>
            <div className="flex-1 overflow-y-auto hidden-scrollbar p-4 space-y-4">
              <CField label="Stage Name" value={selectedStage.name} />
              {selectedStage.image && <CField label="Container Image" value={selectedStage.image} />}
              {selectedStage.timeout && <CField label="Timeout" value={selectedStage.timeout} />}
              {selectedStage.env && <CField label="Environment" value={selectedStage.env} />}
              {selectedStage.commands && (<div><div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Commands</div><div className="bg-[#111827] border-2 border-gray-900 p-3 font-mono text-[10px] text-gray-300 space-y-1">{selectedStage.commands.map((c, i) => <div key={i} className="flex"><span className="text-gray-500 mr-2 select-none">$</span>{c}</div>)}</div></div>)}
              {selectedStage.approvers && (<div><div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Approvers</div>{selectedStage.approvers.map((a, i) => <div key={i} className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 mb-1">{a}</div>)}</div>)}
            </div>
          </>); })()}
        </div>
      )}
    </div>
  );
}

function CField({ label, value }) {
  return (<div><div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</div><div className="text-xs font-mono text-gray-900 bg-gray-50 border border-gray-200 px-3 py-2">{value}</div></div>);
}

function ToggleSmall({ value, onChange }) {
  return (<button onClick={onChange} className={`w-8 h-4 border-2 border-gray-900 cursor-pointer relative transition-colors shrink-0 ${value ? 'bg-gray-900' : 'bg-white'}`}><div className={`absolute top-px w-2.5 h-2.5 transition-all ${value ? 'right-px bg-white' : 'left-px bg-gray-900'}`} /></button>);
}
