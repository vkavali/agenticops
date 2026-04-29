import { useEffect, useState } from 'react';
import { Boxes, RefreshCw } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Grade, MetricCard, EmptyState, fmtAgo } from './components/views';

const METRIC_LABELS = {
  slo_compliance: 'SLO',
  incident_health: 'Incidents',
  deploy_freshness: 'Deploys',
  security_posture: 'Security',
};

export default function CatalogView() {
  const { catalogServices, setCatalogServices, toast } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const recompute = async () => {
    setRefreshing(true);
    try {
      await api.idp.recompute();
      toast('Scorecard recompute triggered', 'info');
      // Give the sweep a few seconds to land before re-fetching.
      setTimeout(async () => {
        const fresh = await api.idp.listServices();
        setCatalogServices(fresh);
        setRefreshing(false);
      }, 4000);
    } catch (err) {
      toast(`Failed: ${err.message}`, 'error'); setRefreshing(false);
    }
  };

  const overallGrade = (cards) => {
    if (!cards || cards.length === 0) return '—';
    const grades = cards.map(c => c.grade).filter(Boolean);
    if (grades.length === 0) return '—';
    // Average letter grade by their numeric values
    const num = { A: 90, B: 80, C: 70, D: 60, F: 40 };
    const avg = grades.reduce((s, g) => s + (num[g] || 0), 0) / grades.length;
    if (avg >= 90) return 'A'; if (avg >= 80) return 'B';
    if (avg >= 70) return 'C'; if (avg >= 60) return 'D';
    return 'F';
  };

  const aGrades = catalogServices.filter(s => overallGrade(s.scorecards) === 'A').length;
  const fGrades = catalogServices.filter(s => overallGrade(s.scorecards) === 'F').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Boxes} title="Service Catalog"
        subtitle="scorecards · ownership · tier · 30-min auto-recompute"
        actions={
          <button onClick={recompute} disabled={refreshing}
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white flex items-center">
            <RefreshCw size={10} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} /> Recompute
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Services" value={catalogServices.length} />
          <MetricCard label="A-grade" value={aGrades} />
          <MetricCard label="F-grade" value={fGrades} danger={fGrades > 0} />
        </div>

        {catalogServices.length === 0 ? (
          <EmptyState message="No services in catalog" hint="Services in the existing services table appear here automatically. Each scorecard derives from SLOs, incidents, deployments, and security findings." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {catalogServices.map(s => {
              const overall = overallGrade(s.scorecards);
              return (
                <div key={s.id} className="border-2 border-gray-900 bg-white p-4 shadow-[2px_2px_0_0_#111827]">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{s.name}</div>
                      <div className="text-[11px] font-mono text-gray-500 mt-0.5">
                        {s.tier && <span>tier <span className="text-gray-900">{s.tier}</span> · </span>}
                        {s.owner && <span>owned by <span className="text-gray-900">{s.owner}</span></span>}
                        {!s.owner && !s.tier && <span>no metadata</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <Grade value={overall} />
                      <div className="text-[9px] uppercase tracking-widest text-gray-400">overall</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 pt-3 border-t border-gray-200">
                    {(s.scorecards || []).map(c => (
                      <div key={c.metric} className="text-center">
                        <Grade value={c.grade} />
                        <div className="text-[9px] uppercase tracking-widest text-gray-500 mt-0.5">{METRIC_LABELS[c.metric] || c.metric}</div>
                        <div className="text-[9px] font-mono text-gray-400">{Number(c.value).toFixed(0)}</div>
                      </div>
                    ))}
                  </div>
                  {s.scorecards?.[0] && (
                    <div className="text-[10px] font-mono text-gray-400 mt-3">
                      computed {fmtAgo(Number(s.scorecards[0].computed_at))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
