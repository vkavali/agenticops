import { useState, useEffect, useRef } from 'react';
import {
  Plus, Play, CheckCircle2, XCircle, Clock, GitBranch, Trash2, ChevronRight, ChevronDown,
  Code, Shield, Rocket, TestTube, Eye, X, Save, FileCode2, Settings2, History, Terminal,
  Pause, RotateCcw, Timer, Webhook, Calendar, GripVertical, Pencil
} from 'lucide-react';
import { useApp, generateId } from './store';
import ConfirmDialog from './components/ConfirmDialog';

const STAGE_PALETTE = [
  { type: 'build', label: 'Build', icon: Code, color: 'bg-blue-50', borderColor: 'border-blue-300', textColor: 'text-blue-700' },
  { type: 'test', label: 'Test', icon: TestTube, color: 'bg-amber-50', borderColor: 'border-amber-300', textColor: 'text-amber-700' },
  { type: 'security', label: 'Security Scan', icon: Shield, color: 'bg-purple-50', borderColor: 'border-purple-300', textColor: 'text-purple-700' },
  { type: 'deploy', label: 'Deploy', icon: Rocket, color: 'bg-emerald-50', borderColor: 'border-emerald-300', textColor: 'text-emerald-700' },
  { type: 'approval', label: 'Approval Gate', icon: Eye, color: 'bg-rose-50', borderColor: 'border-rose-300', textColor: 'text-rose-700' },
  { type: 'script', label: 'Custom Script', icon: FileCode2, color: 'bg-gray-50', borderColor: 'border-gray-300', textColor: 'text-gray-700' },
];

const RUN_STATUS = {
  passed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-500' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500' },
  running: { icon: Play, color: 'text-blue-600', bg: 'bg-blue-500' },
  skipped: { icon: Pause, color: 'text-gray-400', bg: 'bg-gray-300' },
};

export default function PipelinesView() {
  const {
    pipelines, updatePipeline, addPipelineRun, addPipeline, deletePipeline,
    toast, STAGE_DEFAULTS,
  } = useApp();

  const [selPipeId, setSelPipeId] = useState(pipelines[0]?.id);
  const [stages, setStages] = useState(pipelines[0]?.stages || []);
  const [selectedStage, setSelectedStage] = useState(null);
  const [showYaml, setShowYaml] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [activePanel, setActivePanel] = useState('builder');
  const [expandedRun, setExpandedRun] = useState(null);
  const [expandedStageLog, setExpandedStageLog] = useState(null);
  const [runStageProgress, setRunStageProgress] = useState([]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const nameRef = useRef(null);

  const selPipe = pipelines.find(p => p.id === selPipeId);

  // Sync stages when pipeline changes
  useEffect(() => {
    if (selPipe) setStages(selPipe.stages);
  }, [selPipeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPipeline = (p) => { setSelPipeId(p.id); setStages(p.stages); setSelectedStage(null); setShowYaml(false); setActivePanel('builder'); };
  const addStage = (type) => { setStages([...stages, { id: generateId('s-'), type, ...STAGE_DEFAULTS[type] }]); };
  const removeStage = (id) => { setStages(stages.filter(s => s.id !== id)); if (selectedStage?.id === id) setSelectedStage(null); };

  const handleSave = () => {
    setIsSaved(true);
    updatePipeline(selPipeId, { stages });
    toast('Pipeline saved', 'success');
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleRun = async () => {
    if (isRunning || !selPipe) return;
    // Persist any in-progress stage edits before triggering the run.
    if (selPipe.stages !== stages) {
      try { await updatePipeline(selPipeId, { stages }); } catch { /* toast already raised */ }
    }
    setIsRunning(true);
    setActivePanel('runs');
    setRunStageProgress([]);
    try {
      // Real backend run. With a linked repo, executor.js clones it and
      // runs each stage's commands; without one, it logs a simulated run
      // and reports the same. Either way, the run record reflects real
      // exit codes, and the stage state machine streams over SSE
      // (pipeline:run / pipeline:stage / pipeline:log / pipeline:finished),
      // which the store consumes to refresh the run list. The button
      // re-enables on the finished event.
      await addPipelineRun(selPipeId, { msg: 'triggered manually', by: 'operator' });
      toast('Pipeline run started', 'success');
    } catch (err) {
      toast(`Failed to start: ${err.message}`, 'error');
    } finally {
      // Don't keep the local "running" state forever — even if SSE drops,
      // the run row is in the DB. A short timeout so the spinner doesn't
      // get stuck on a UI that missed the finished event.
      setTimeout(() => setIsRunning(false), 1500);
    }
  };

  const handleAddPipeline = async () => {
    // Default scaffold: no stages, no repo. Operators add stages via the
    // builder and connect a repo from the Settings → GitHub flow. Until a
    // repo + stages are configured, runs go through executor.js's
    // simulation path so the row still gets the right shape.
    const p = await addPipeline({
      name: `new-pipeline-${pipelines.length + 1}`,
      branch: 'main',
      stages: [],
    });
    if (!p?.id) return;
    setSelPipeId(p.id);
    setStages([]);
  };

  const handleDeletePipeline = () => {
    if (pipelines.length <= 1) { toast('Cannot delete the last pipeline', 'warning'); return; }
    setConfirmDelete(selPipeId);
  };

  const confirmDeletePipeline = () => {
    const next = pipelines.find(p => p.id !== confirmDelete);
    deletePipeline(confirmDelete);
    if (next) { setSelPipeId(next.id); setStages(next.stages); }
    setConfirmDelete(null);
  };

  const startRename = () => { setEditingName(true); setNameInput(selPipe?.name || ''); setTimeout(() => nameRef.current?.focus(), 50); };
  const finishRename = () => { if (nameInput.trim()) { updatePipeline(selPipeId, { name: nameInput.trim() }); } setEditingName(false); };

  // Stage editing
  const updateStageField = (field, value) => {
    setStages(prev => prev.map(s => s.id === selectedStage?.id ? { ...s, [field]: value } : s));
    setSelectedStage(prev => prev ? { ...prev, [field]: value } : prev);
  };

  // Stage drag reorder
  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newStages = [...stages];
    const [moved] = newStages.splice(dragIdx, 1);
    newStages.splice(idx, 0, moved);
    setStages(newStages);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const generateYaml = () => {
    let y = `# ${selPipe?.name}\n# Auto-generated by AgenticOps\n\npipeline:\n  name: "${selPipe?.name}"\n  trigger:\n    type: ${selPipe?.trigger?.type}\n    branch: ${selPipe?.trigger?.branch || selPipe?.trigger?.pattern || 'main'}\n`;
    if (selPipe?.schedule) y += `  schedule: "${selPipe.schedule}"\n`;
    y += '\n  stages:\n';
    stages.forEach(s => { y += `    - name: "${s.name}"\n      type: ${s.type}\n`; if (s.image) y += `      image: ${s.image}\n`; if (s.commands) y += `      commands:\n${s.commands.map(c => `        - ${c}`).join('\n')}\n`; if (s.timeout) y += `      timeout: ${s.timeout}\n`; if (s.env) y += `      environment: ${s.env}\n`; y += '\n'; });
    return y;
  };

  if (!selPipe) return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">No pipelines found</div>;

  return (
    <div className="flex h-full relative">
      {confirmDelete && <ConfirmDialog title="Delete Pipeline" message={`Are you sure you want to delete "${selPipe?.name}"? This action cannot be undone. All run history will be lost.`} confirmLabel="Delete" onConfirm={confirmDeletePipeline} onCancel={() => setConfirmDelete(null)} />}

      {/* Pipeline List */}
      <div className="w-[240px] border-r border-gray-300 bg-white shrink-0 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pipelines</h2>
          <button onClick={handleAddPipeline} className="p-1 border border-gray-300 hover:bg-gray-50 cursor-pointer"><Plus size={12} /></button>
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
            {editingName ? (
              <input ref={nameRef} value={nameInput} onChange={e => setNameInput(e.target.value)} onBlur={finishRename} onKeyDown={e => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setEditingName(false); }}
                className="text-xs font-bold text-gray-900 border-b-2 border-gray-900 outline-none bg-transparent px-1 py-0.5" />
            ) : (
              <h3 className="text-xs font-bold text-gray-900 flex items-center cursor-pointer group" onClick={startRename}>
                {selPipe.name} <Pencil size={10} className="ml-1.5 text-gray-300 group-hover:text-gray-600" />
              </h3>
            )}
            <span className="text-[9px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 border border-gray-200">{stages.length} stages</span>
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
                      <div key={stage.id} className="flex items-center shrink-0" draggable onDragStart={() => handleDragStart(i)} onDragOver={(e) => handleDragOver(e, i)} onDragEnd={handleDragEnd}>
                        <div onClick={() => setSelectedStage(isSelected ? null : stage)}
                          className={`w-[160px] border bg-white cursor-pointer transition-all relative ${isSelected ? 'border-gray-900 shadow-[4px_4px_0_0_#111827] -translate-x-[2px] -translate-y-[2px]' : `${pal.borderColor} shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px]`} ${dragIdx === i ? 'opacity-50' : ''}`}>
                          <div className={`h-1.5 w-full ${pal.color} border-b ${pal.borderColor} flex items-center justify-end px-1`}>
                            <GripVertical size={8} className="text-gray-300 cursor-grab" />
                          </div>
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
                        <div className="px-3 pt-3 flex items-center space-x-1">
                          {run.stageResults.map((sr, i) => { const sSt = RUN_STATUS[sr.status] || RUN_STATUS.passed; return <div key={i} className={`flex-1 h-2 ${sSt.bg}`} />; })}
                        </div>
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
                    <button key={t} onClick={() => { updatePipeline(selPipeId, p => ({ ...p, trigger: { ...p.trigger, type: t } })); toast(`Trigger → ${t}`); }}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-1.5 border cursor-pointer text-center ${selPipe.trigger?.type === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Branch Filter</div>
                <input
                  type="text"
                  value={selPipe.trigger?.branch || selPipe.trigger?.pattern || 'main'}
                  onChange={e => updatePipeline(selPipeId, p => ({ ...p, trigger: { ...p.trigger, branch: e.target.value } }))}
                  className="w-full text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-3 py-2 focus:outline-none focus:border-gray-900"
                />
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Schedule (Cron)</div>
                  <ToggleSmall value={!!selPipe.schedule} onChange={() => { updatePipeline(selPipeId, p => ({ ...p, schedule: p.schedule ? null : '0 */6 * * *' })); toast(selPipe.schedule ? 'Schedule disabled' : 'Schedule enabled'); }} />
                </div>
                {selPipe.schedule && <input type="text" value={selPipe.schedule} onChange={e => updatePipeline(selPipeId, { schedule: e.target.value })} className="w-full text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-3 py-2 focus:outline-none focus:border-gray-900" />}
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Notification on Failure</div>
                <div className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-3 py-2">#deployments (Slack)</div>
              </div>
              <div className="border border-gray-300 bg-white p-4 shadow-[1px_1px_0_0_#111827]">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Concurrency</div>
                <div className="text-xs text-gray-700">Max <span className="font-mono font-bold">1</span> concurrent run. Queue additional triggers.</div>
              </div>
              <button onClick={handleDeletePipeline}
                className="text-[10px] font-bold text-red-500 border border-red-300 px-3 py-1.5 hover:bg-red-50 cursor-pointer flex items-center"><Trash2 size={10} className="mr-1" /> Delete Pipeline</button>
            </div>
          </div>
        )}
      </div>

      {/* Stage Config Panel (right) — now fully editable */}
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
              <EditField label="Stage Name" value={selectedStage.name} onChange={v => updateStageField('name', v)} />
              {selectedStage.image !== undefined && <EditField label="Container Image" value={selectedStage.image} onChange={v => updateStageField('image', v)} />}
              {selectedStage.timeout !== undefined && <EditField label="Timeout" value={selectedStage.timeout} onChange={v => updateStageField('timeout', v)} />}
              {selectedStage.env !== undefined && <EditField label="Environment" value={selectedStage.env} onChange={v => updateStageField('env', v)} />}
              {selectedStage.commands && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Commands</div>
                    <button onClick={() => updateStageField('commands', [...selectedStage.commands, 'echo "new"'])} className="text-[9px] font-bold text-gray-500 hover:text-gray-900 flex items-center cursor-pointer"><Plus size={10} className="mr-0.5" /> Add</button>
                  </div>
                  <div className="space-y-1">
                    {selectedStage.commands.map((c, i) => (
                      <div key={i} className="flex items-center space-x-1">
                        <span className="text-[10px] font-mono text-gray-400 shrink-0">$</span>
                        <input type="text" value={c} onChange={e => { const cmds = [...selectedStage.commands]; cmds[i] = e.target.value; updateStageField('commands', cmds); }}
                          className="flex-1 text-[10px] font-mono text-gray-900 bg-gray-50 border border-gray-200 px-2 py-1 focus:outline-none focus:border-gray-900" />
                        <button onClick={() => { const cmds = selectedStage.commands.filter((_, j) => j !== i); updateStageField('commands', cmds); }} className="text-gray-300 hover:text-red-500 cursor-pointer shrink-0"><Trash2 size={9} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedStage.approvers && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Approvers</div>
                    <button onClick={() => updateStageField('approvers', [...selectedStage.approvers, 'new-team'])} className="text-[9px] font-bold text-gray-500 hover:text-gray-900 flex items-center cursor-pointer"><Plus size={10} className="mr-0.5" /> Add</button>
                  </div>
                  {selectedStage.approvers.map((a, i) => (
                    <div key={i} className="flex items-center space-x-1 mb-1">
                      <input type="text" value={a} onChange={e => { const app = [...selectedStage.approvers]; app[i] = e.target.value; updateStageField('approvers', app); }}
                        className="flex-1 text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 focus:outline-none focus:border-gray-900" />
                      <button onClick={() => updateStageField('approvers', selectedStage.approvers.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 cursor-pointer"><Trash2 size={9} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>); })()}
        </div>
      )}
    </div>
  );
}

function EditField({ label, value, onChange }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</div>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
        className="w-full text-xs font-mono text-gray-900 bg-gray-50 border border-gray-200 px-3 py-2 focus:outline-none focus:border-gray-900 transition-colors" />
    </div>
  );
}

function ToggleSmall({ value, onChange }) {
  return (<button onClick={onChange} className={`w-8 h-4 border-2 border-gray-900 cursor-pointer relative transition-colors shrink-0 ${value ? 'bg-gray-900' : 'bg-white'}`}><div className={`absolute top-px w-2.5 h-2.5 transition-all ${value ? 'right-px bg-white' : 'left-px bg-gray-900'}`} /></button>);
}
