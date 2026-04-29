import { useState } from 'react';
import { Target, Plus, X } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, MetricCard, EmptyState, fmtPct } from './components/views';

export default function SlosView() {
  const { slos, setSlos, sloEvals, services, toast } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    name: '', service: '', sli_type: 'availability', target_pct: 99.5,
    window_ms: 30 * 24 * 3600 * 1000, latency_threshold_ms: 1000,
    burn_rate_alert_threshold: 2.0,
  });

  const submit = async () => {
    if (!draft.name || !draft.service) return toast('name and service required', 'warning');
    try {
      const slo = await api.slos.create(draft);
      setSlos(prev => [slo, ...prev]);
      setShowCreate(false);
      toast(`SLO ${slo.name} created`, 'success');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const burning = slos.filter(s => {
    const ev = sloEvals[s.id];
    return ev && Number(ev.burn_rate) >= 1.0;
  }).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Target} title="SLOs & Error Budgets"
        subtitle="60s evaluator · burn-rate auto-incidents"
        actions={
          <button onClick={() => setShowCreate(true)}
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white flex items-center">
            <Plus size={10} className="mr-1.5" /> New SLO
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="SLOs" value={slos.length} />
          <MetricCard label="Burning" value={burning} danger={burning > 0} />
          <MetricCard label="Healthy" value={slos.length - burning} />
        </div>

        {slos.length === 0 ? (
          <EmptyState message="No SLOs defined" hint="Each SLO computes an SLI from health_checks and tracks an error budget. When burn ≥ threshold, a critical incident opens automatically." />
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b-2 border-gray-900">
              <tr><Th>Name</Th><Th>Service</Th><Th>Type</Th><Th>Target</Th><Th>SLI</Th><Th>Budget</Th><Th>Burn</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {slos.map(s => {
                const ev = sloEvals[s.id];
                const burn = ev ? Number(ev.burn_rate) : null;
                return (
                  <tr key={s.id} className="border-b border-gray-200">
                    <Td className="font-bold text-gray-900">{s.name}</Td>
                    <Td className="font-mono">{s.service}</Td>
                    <Td><Badge value={s.sli_type} kind="info" /></Td>
                    <Td className="font-mono">{fmtPct(Number(s.target_pct), 2)}</Td>
                    <Td className="font-mono">{ev ? fmtPct(Number(ev.sli), 2) : '—'}</Td>
                    <Td className="font-mono">{ev ? fmtPct(Number(ev.error_budget_remaining_pct), 1) : '—'}</Td>
                    <Td className={`font-mono font-bold ${burn != null && burn >= 2 ? 'text-red-600' : burn != null && burn >= 1 ? 'text-amber-600' : 'text-green-600'}`}>
                      {burn != null ? `${burn.toFixed(2)}×` : '—'}
                    </Td>
                    <Td>{burn != null
                      ? burn >= 2 ? <Badge value="critical" /> : burn >= 1 ? <Badge value="warning" /> : <Badge value="ok" kind="passed" />
                      : <Badge value="—" kind="default" />}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/25 z-[80] flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[480px]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest">New SLO</h3>
              <button onClick={() => setShowCreate(false)}><X size={14} /></button>
            </div>
            <div className="p-4 space-y-3">
              <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              <Field label="Service">
                <select value={draft.service} onChange={e => setDraft({ ...draft, service: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
                  <option value="">— pick a service —</option>
                  {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="SLI Type">
                <select value={draft.sli_type} onChange={e => setDraft({ ...draft, sli_type: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
                  <option value="availability">availability</option>
                  <option value="latency">latency</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Target (%)"><input type="number" step="0.01" value={draft.target_pct} onChange={e => setDraft({ ...draft, target_pct: +e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
                <Field label="Window (days)"><input type="number" value={Math.round(draft.window_ms / 86400000)} onChange={e => setDraft({ ...draft, window_ms: +e.target.value * 86400000 })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              </div>
              {draft.sli_type === 'latency' && (
                <Field label="Latency threshold (ms)"><input type="number" value={draft.latency_threshold_ms} onChange={e => setDraft({ ...draft, latency_threshold_ms: +e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              )}
              <Field label="Alert burn rate"><input type="number" step="0.1" value={draft.burn_rate_alert_threshold} onChange={e => setDraft({ ...draft, burn_rate_alert_threshold: +e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
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
function Field({ label, children }) { return <div><div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{label}</div>{children}</div>; }
function Th({ children }) { return <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2 ${className}`}>{children}</td>; }
