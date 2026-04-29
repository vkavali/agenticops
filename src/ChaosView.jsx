import { useEffect, useState } from 'react';
import { Zap, Plus, Square, Play, X } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, EmptyState, MetricCard, fmtAgo } from './components/views';

export default function ChaosView() {
  const { chaosExperiments, setChaosExperiments, slos, services, toast } = useApp();
  const [runs, setRuns] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: '', target_service: '', fault_type: 'latency', duration_ms: 60000, blast_radius_pct: 10, abort_on_slo_id: '' });

  useEffect(() => {
    api.chaos.listRuns(100).then(setRuns).catch(() => {});
  }, []);

  const submit = async () => {
    if (!draft.name || !draft.target_service) return toast('name and target required', 'warning');
    try {
      const exp = await api.chaos.createExperiment({
        ...draft, abort_on_slo_id: draft.abort_on_slo_id || null,
      });
      setChaosExperiments(prev => [exp, ...prev]);
      setShowCreate(false); setDraft({ name: '', target_service: '', fault_type: 'latency', duration_ms: 60000, blast_radius_pct: 10, abort_on_slo_id: '' });
      toast('Experiment created', 'success');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const runExperiment = async (id) => {
    try {
      const r = await api.chaos.runExperiment(id);
      toast(`Run requested — gate ${r.gateId} pending`, 'warning');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const abort = async (runId) => {
    await api.chaos.abortRun(runId, 'manual');
    toast('Run aborted', 'warning');
    api.chaos.listRuns(100).then(setRuns).catch(() => {});
  };

  const activeRun = runs.find(r => r.status === 'running');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Zap} title="Chaos Engineering"
        subtitle="experiments · gated execution · auto-abort on SLO burn"
        actions={
          <button onClick={() => setShowCreate(true)}
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white flex items-center">
            <Plus size={10} className="mr-1.5" /> New Experiment
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Experiments" value={chaosExperiments.length} />
          <MetricCard label="Active runs" value={activeRun ? 1 : 0} danger={!!activeRun} />
          <MetricCard label="Aborted (last 100)" value={runs.filter(r => r.status === 'aborted').length} />
        </div>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-900 mb-2">Experiments</h3>
          {chaosExperiments.length === 0 ? (
            <EmptyState message="No experiments yet" hint="Each experiment declares a target service, fault type, blast radius, and an optional SLO whose burn auto-aborts the run." />
          ) : (
            <div className="space-y-2">
              {chaosExperiments.map(e => (
                <div key={e.id} className="border-2 border-gray-900 bg-white p-3 shadow-[2px_2px_0_0_#111827] flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-gray-900">{e.name}</div>
                    <div className="text-[11px] font-mono text-gray-500 mt-0.5">
                      {e.fault_type} on <span className="text-gray-900">{e.target_service}</span> ·
                      blast {e.blast_radius_pct}% · {Math.round(Number(e.duration_ms)/1000)}s
                      {e.abort_on_slo_id && <span> · abort on SLO <span className="text-gray-900">{e.abort_on_slo_id}</span></span>}
                    </div>
                    {e.hypothesis && <div className="text-[11px] italic text-gray-600 mt-1">{e.hypothesis}</div>}
                  </div>
                  <button onClick={() => runExperiment(e.id)}
                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-gray-900 text-white hover:bg-gray-800 flex items-center">
                    <Play size={10} className="mr-1.5" /> Request Run
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-900 mb-2">Recent runs</h3>
          {runs.length === 0 ? (
            <EmptyState message="No runs yet" />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b-2 border-gray-900">
                <tr><Th>Status</Th><Th>Experiment</Th><Th>Started</Th><Th>Duration</Th><Th>Reason</Th><Th></Th></tr>
              </thead>
              <tbody>
                {runs.slice(0, 30).map(r => {
                  const dur = r.finished_at ? `${Math.round((r.finished_at - r.started_at)/1000)}s` : 'in-flight';
                  return (
                    <tr key={r.id} className="border-b border-gray-200">
                      <Td><Badge value={r.status} /></Td>
                      <Td className="font-mono text-gray-500">{r.experiment_id.slice(0, 18)}</Td>
                      <Td className="text-gray-500">{fmtAgo(r.started_at)}</Td>
                      <Td className="font-mono">{dur}</Td>
                      <Td className="text-gray-500">{r.abort_reason || '—'}</Td>
                      <Td>{r.status === 'running' && (
                        <button onClick={() => abort(r.id)} className="text-red-600"><Square size={12} /></button>
                      )}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/25 z-[80] flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[480px]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest">New Experiment</h3>
              <button onClick={() => setShowCreate(false)}><X size={14} /></button>
            </div>
            <div className="p-4 space-y-3">
              <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              <Field label="Target service">
                <select value={draft.target_service} onChange={e => setDraft({ ...draft, target_service: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
                  <option value="">— pick a service —</option>
                  {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Fault type">
                <select value={draft.fault_type} onChange={e => setDraft({ ...draft, fault_type: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
                  {['latency', 'error-rate', 'pod-kill', 'cpu-stress', 'network-loss'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Blast radius (%)"><input type="number" value={draft.blast_radius_pct} onChange={e => setDraft({ ...draft, blast_radius_pct: +e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
                <Field label="Duration (s)"><input type="number" value={Math.round(draft.duration_ms/1000)} onChange={e => setDraft({ ...draft, duration_ms: +e.target.value * 1000 })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              </div>
              <Field label="Abort on SLO (optional)">
                <select value={draft.abort_on_slo_id} onChange={e => setDraft({ ...draft, abort_on_slo_id: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
                  <option value="">— none —</option>
                  {slos.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end space-x-2">
              <button onClick={() => setShowCreate(false)} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 border border-gray-300">Cancel</button>
              <button onClick={submit} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-gray-900 text-white">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
function Th({ children }) { return <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2 ${className}`}>{children}</td>; }
