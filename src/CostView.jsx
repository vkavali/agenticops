import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, RefreshCw, X } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, MetricCard, EmptyState, fmtUSD, fmtPct, fmtAgo } from './components/views';

export default function CostView() {
  const { costAnomalies, costRecommendations, setCostAnomalies, setCostRecommendations, toast } = useApp();
  const [byService, setByService] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.cost.byService().then(setByService).catch(() => {});
  }, []);

  const total30d = byService.reduce((s, r) => s + (r.last_30d || 0), 0);
  const total7d = byService.reduce((s, r) => s + (r.last_7d || 0), 0);

  const triggerSweep = async () => {
    setRefreshing(true);
    try {
      await api.cost.sweep();
      toast('Cost sweep triggered', 'info');
      const [anom, recs, by] = await Promise.all([
        api.cost.anomalies(), api.cost.recommendations(), api.cost.byService(),
      ]);
      setCostAnomalies(anom); setCostRecommendations(recs); setByService(by);
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
    setRefreshing(false);
  };

  const resolveAnomaly = async (id) => {
    await api.cost.resolveAnomaly(id);
    setCostAnomalies(prev => prev.filter(a => a.id !== id));
  };
  const dismissRec = async (id) => {
    await api.cost.dismissRecommendation(id);
    setCostRecommendations(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={DollarSign} title="Cost Management"
        subtitle="anomaly detection · idle resources · spend by service"
        actions={
          <button onClick={triggerSweep} disabled={refreshing}
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white transition-colors flex items-center">
            <RefreshCw size={10} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} /> Sweep
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Last 30d" value={fmtUSD(total30d)} />
          <MetricCard label="Last 7d" value={fmtUSD(total7d)} />
          <MetricCard label="Open anomalies" value={costAnomalies.length} danger={costAnomalies.length > 0} />
        </div>

        <Section title="Anomalies" subtitle="≥25% over 14-day baseline">
          {costAnomalies.length === 0 ? (
            <EmptyState message="No active cost anomalies" hint="Detector compares yesterday's spend per service to a 14-day baseline." />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b-2 border-gray-900">
                <tr><Th>Provider</Th><Th>Service</Th><Th>Observed</Th><Th>Baseline</Th><Th>Delta</Th><Th>Detected</Th><Th></Th></tr>
              </thead>
              <tbody>
                {costAnomalies.map(a => (
                  <tr key={a.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <Td>{a.provider}</Td><Td className="font-mono">{a.service}</Td>
                    <Td className="font-mono text-red-600 font-bold">{fmtUSD(Number(a.observed_cost))}</Td>
                    <Td className="font-mono text-gray-500">{fmtUSD(Number(a.baseline_cost))}</Td>
                    <Td className="font-mono text-red-600 font-bold">+{fmtPct(Number(a.delta_pct), 0)}</Td>
                    <Td className="text-gray-500">{fmtAgo(Number(a.detected_at))}</Td>
                    <Td><button onClick={() => resolveAnomaly(a.id)} className="text-[10px] font-bold text-gray-500 hover:text-gray-900"><X size={12} /></button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Recommendations" subtitle="estimated monthly savings">
          {costRecommendations.length === 0 ? (
            <EmptyState message="No idle-resource recommendations" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {costRecommendations.map(r => (
                <div key={r.id} className="border-2 border-gray-900 bg-white p-3 shadow-[2px_2px_0_0_#111827]">
                  <div className="flex items-start justify-between mb-1">
                    <div className="text-xs font-bold text-gray-900">{r.resource}</div>
                    <Badge value={r.kind} kind="info" />
                  </div>
                  <div className="text-[11px] text-gray-600 mb-2">{r.rationale}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase font-bold tracking-widest text-gray-500">
                      Save <span className="text-green-600">{fmtUSD(r.estimated_monthly_savings)}</span>/mo
                    </div>
                    <button onClick={() => dismissRec(r.id)} className="text-[10px] text-gray-500 hover:text-gray-900">dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Spend by service" subtitle="top services by 30-day total">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b-2 border-gray-900">
              <tr><Th>Provider</Th><Th>Service</Th><Th>Last 7d</Th><Th>Last 30d</Th><Th>Trend</Th></tr>
            </thead>
            <tbody>
              {byService.slice(0, 20).map((r, i) => (
                <tr key={i} className="border-b border-gray-200">
                  <Td>{r.provider}</Td><Td className="font-mono">{r.service}</Td>
                  <Td className="font-mono">{fmtUSD(r.last_7d)}</Td>
                  <Td className="font-mono">{fmtUSD(r.last_30d)}</Td>
                  <Td>
                    {r.last_7d * 4.3 > r.last_30d * 1.1
                      ? <TrendingUp size={12} className="text-red-500" />
                      : <span className="text-gray-400">—</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-900">{title}</h3>
        {subtitle && <div className="text-[10px] text-gray-500 font-mono">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
function Th({ children }) { return <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2 ${className}`}>{children}</td>; }
