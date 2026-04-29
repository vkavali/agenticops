import { useState } from 'react';
import { Flag, Pause, Play, Square, Plus, X } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, MetricCard, EmptyState } from './components/views';

export default function FlagsView() {
  const { flags, setFlags, slos, toast } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ key: '', name: '', type: 'boolean', default_value: false, rolled_out_value: true });
  const [showRollout, setShowRollout] = useState(null);
  const [rolloutDraft, setRolloutDraft] = useState({ target_pct: 100, increment_pct: 10, increment_interval_ms: 600000, slo_id: '' });

  const create = async () => {
    if (!draft.key || !draft.name) return toast('key and name required', 'warning');
    try {
      const f = await api.flags.create(draft);
      setFlags(prev => [{ ...f, rollout: null }, ...prev]);
      setShowCreate(false);
      setDraft({ key: '', name: '', type: 'boolean', default_value: false, rolled_out_value: true });
      toast(`Flag ${f.key} created`, 'success');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const startRollout = async (flagId) => {
    try {
      await api.flags.startRollout(flagId, {
        ...rolloutDraft,
        slo_id: rolloutDraft.slo_id || null,
      });
      setShowRollout(null);
      toast('Rollout started — auto-pause 1.5×, auto-rollback 2×', 'info');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const pause = async (id) => { await api.flags.pauseRollout(id, 'manual'); toast('Rollout paused', 'warning'); };
  const resume = async (id) => { await api.flags.resumeRollout(id); toast('Rollout resumed', 'info'); };
  const rollback = async (id) => { await api.flags.rollbackRollout(id, 'manual'); toast('Rollout rolled back', 'warning'); };

  const active = flags.filter(f => f.rollout && f.rollout.status === 'running').length;
  const paused = flags.filter(f => f.rollout && f.rollout.status === 'paused').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Flag} title="Feature Flags"
        subtitle="targeting rules · gradual rollout · SLO auto-rollback"
        actions={
          <button onClick={() => setShowCreate(true)}
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white flex items-center">
            <Plus size={10} className="mr-1.5" /> New Flag
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Flags" value={flags.length} />
          <MetricCard label="Active rollouts" value={active} />
          <MetricCard label="Paused" value={paused} danger={paused > 0} />
        </div>

        {flags.length === 0 ? (
          <EmptyState message="No flags yet" hint="Each flag has a default + rolled-out variant. Rollouts ramp percentage on a schedule and auto-pause/rollback on linked SLO burn." />
        ) : (
          <div className="space-y-2">
            {flags.map(f => (
              <div key={f.id} className="border-2 border-gray-900 bg-white p-3 shadow-[2px_2px_0_0_#111827]">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold font-mono text-gray-900">{f.key}</span>
                      <Badge value={f.type} kind="info" />
                      {!f.enabled && <Badge value="disabled" />}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{f.name}</div>
                    <div className="text-[10px] font-mono text-gray-400 mt-1">
                      default: <span className="text-gray-700">{JSON.stringify(f.default_value)}</span>
                      {f.rolled_out_value !== null && <> → rollout: <span className="text-gray-700">{JSON.stringify(f.rolled_out_value)}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {f.rollout ? (
                      <>
                        <RolloutBar pct={Number(f.rollout.current_pct)} status={f.rollout.status} />
                        <Badge value={f.rollout.status} />
                        {f.rollout.status === 'running' && (
                          <button onClick={() => pause(f.rollout.id)} className="text-amber-600"><Pause size={12} /></button>
                        )}
                        {f.rollout.status === 'paused' && (
                          <button onClick={() => resume(f.rollout.id)} className="text-green-600"><Play size={12} /></button>
                        )}
                        {(f.rollout.status === 'running' || f.rollout.status === 'paused') && (
                          <button onClick={() => rollback(f.rollout.id)} className="text-red-600"><Square size={12} /></button>
                        )}
                      </>
                    ) : (
                      <button onClick={() => setShowRollout(f.id)}
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-gray-900 hover:bg-gray-900 hover:text-white">
                        Start Rollout
                      </button>
                    )}
                  </div>
                </div>
                {f.rollout?.pause_reason && (
                  <div className="mt-2 text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-1 border border-amber-200">
                    {f.rollout.pause_reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="New Flag" onClose={() => setShowCreate(false)} onSubmit={create} submitLabel="Create">
          <Field label="Key (used in code)"><input value={draft.key} onChange={e => setDraft({ ...draft, key: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs font-mono" placeholder="enable-new-checkout" /></Field>
          <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
          <Field label="Type">
            <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
              {['boolean', 'string', 'number', 'json'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default value"><input value={JSON.stringify(draft.default_value)} onChange={e => { try { setDraft({ ...draft, default_value: JSON.parse(e.target.value) }); } catch {} }} className="w-full px-2 py-1 border border-gray-300 text-xs font-mono" /></Field>
            <Field label="Rolled-out value"><input value={JSON.stringify(draft.rolled_out_value)} onChange={e => { try { setDraft({ ...draft, rolled_out_value: JSON.parse(e.target.value) }); } catch {} }} className="w-full px-2 py-1 border border-gray-300 text-xs font-mono" /></Field>
          </div>
        </Modal>
      )}

      {showRollout && (
        <Modal title="Start Rollout" onClose={() => setShowRollout(null)} onSubmit={() => startRollout(showRollout)} submitLabel="Start">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target %"><input type="number" value={rolloutDraft.target_pct} onChange={e => setRolloutDraft({ ...rolloutDraft, target_pct: +e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
            <Field label="Increment %"><input type="number" value={rolloutDraft.increment_pct} onChange={e => setRolloutDraft({ ...rolloutDraft, increment_pct: +e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
          </div>
          <Field label="Interval (minutes)"><input type="number" value={Math.round(rolloutDraft.increment_interval_ms / 60000)} onChange={e => setRolloutDraft({ ...rolloutDraft, increment_interval_ms: +e.target.value * 60000 })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
          <Field label="Abort on SLO burn (auto-pause 1.5×, rollback 2×)">
            <select value={rolloutDraft.slo_id} onChange={e => setRolloutDraft({ ...rolloutDraft, slo_id: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
              <option value="">— none —</option>
              {slos.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function RolloutBar({ pct, status }) {
  const fill = status === 'rolled-back' ? 'bg-red-500' : status === 'paused' ? 'bg-amber-500' : status === 'complete' ? 'bg-green-500' : 'bg-blue-500';
  return (
    <div className="w-32 h-2 border border-gray-900 bg-gray-100 relative">
      <div className={`absolute left-0 top-0 bottom-0 ${fill} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      <span className="absolute -top-3.5 right-0 text-[9px] font-mono font-bold text-gray-700">{pct.toFixed(0)}%</span>
    </div>
  );
}
function Field({ label, children }) { return <div><div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{label}</div>{children}</div>; }
function Modal({ title, children, onClose, onSubmit, submitLabel }) {
  return (
    <div className="fixed inset-0 bg-black/25 z-[80] flex items-center justify-center" onClick={onClose}>
      <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[480px]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest">{title}</h3>
          <button onClick={onClose}><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
        <div className="p-4 border-t border-gray-200 flex justify-end space-x-2">
          <button onClick={onClose} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 border border-gray-300">Cancel</button>
          <button onClick={onSubmit} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-gray-900 text-white">{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
