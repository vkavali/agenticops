import { useState } from 'react';
import { Database, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, MetricCard, EmptyState, fmtAgo } from './components/views';

export default function DbOpsView() {
  const { dbMigrations, setDbMigrations, toast } = useApp();
  const [analyzing, setAnalyzing] = useState(false);
  const [sql, setSql] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');

  const analyze = async () => {
    setAnalyzing(true);
    try { setAnalysis(await api.dbops.analyze(sql)); }
    catch (err) { toast(`Failed: ${err.message}`, 'error'); }
    setAnalyzing(false);
  };

  const submit = async () => {
    if (!name || !version || !sql) return toast('name, version, sql required', 'warning');
    try {
      const m = await api.dbops.submitMigration({ name, version, sql_text: sql });
      setDbMigrations(prev => [m, ...prev]);
      toast(`Migration submitted — score ${m.safety_score}, gate ${m.gate_id}`, m.safety_score < 50 ? 'warning' : 'success');
      setSql(''); setName(''); setVersion(''); setAnalysis(null);
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const pending = dbMigrations.filter(m => m.status === 'pending').length;
  const applied = dbMigrations.filter(m => m.status === 'applied').length;
  const blocked = dbMigrations.filter(m => Number(m.safety_score) < 50 && m.status === 'pending').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Database} title="Database DevOps" subtitle="schema migration tracking + heuristic safety analyzer" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Pending" value={pending} />
          <MetricCard label="Applied" value={applied} />
          <MetricCard label="Hazardous (<50)" value={blocked} danger={blocked > 0} />
        </div>

        <Section title="Submit migration" subtitle="paste SQL — the analyzer flags hazards before a gate is created">
          <div className="border-2 border-gray-900 bg-white p-4 shadow-[2px_2px_0_0_#111827] space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Migration name" value={name} onChange={e => setName(e.target.value)} className="px-2 py-1 border border-gray-300 text-xs" />
              <input placeholder="Version (e.g. 0042)" value={version} onChange={e => setVersion(e.target.value)} className="px-2 py-1 border border-gray-300 text-xs font-mono" />
            </div>
            <textarea
              placeholder="-- ALTER TABLE foo ADD COLUMN bar INT NOT NULL DEFAULT 0;"
              value={sql} onChange={e => setSql(e.target.value)}
              className="w-full h-32 px-2 py-1 border border-gray-300 text-xs font-mono"
            />
            {analysis && (
              <div className={`border-2 p-3 ${analysis.score < 50 ? 'border-red-500 bg-red-50' : analysis.score < 80 ? 'border-amber-500 bg-amber-50' : 'border-green-500 bg-green-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-gray-700">Safety score</div>
                  <div className={`text-2xl font-mono font-bold ${analysis.score < 50 ? 'text-red-600' : analysis.score < 80 ? 'text-amber-600' : 'text-green-600'}`}>{analysis.score}</div>
                </div>
                {analysis.warnings.length === 0 ? (
                  <div className="flex items-center text-xs text-green-700"><CheckCircle2 size={12} className="mr-1.5" /> No hazards detected</div>
                ) : (
                  <div className="space-y-1.5">
                    {analysis.warnings.map(w => (
                      <div key={w.code} className="flex items-start text-[11px]">
                        <AlertTriangle size={11} className={`mr-1.5 mt-0.5 shrink-0 ${
                          w.level === 'critical' ? 'text-red-600' :
                          w.level === 'high' ? 'text-orange-600' :
                          w.level === 'medium' ? 'text-amber-600' : 'text-blue-500'
                        }`} />
                        <div><span className="font-mono text-gray-500">[{w.code}]</span> {w.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end space-x-2">
              <button onClick={analyze} disabled={!sql || analyzing}
                className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 border border-gray-300 disabled:opacity-50">
                Analyze
              </button>
              <button onClick={submit} disabled={!sql || !name || !version}
                className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-gray-900 text-white disabled:bg-gray-300">
                Submit + Create Gate
              </button>
            </div>
          </div>
        </Section>

        <Section title="Migration history">
          {dbMigrations.length === 0 ? (
            <EmptyState message="No migrations yet" />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b-2 border-gray-900">
                <tr><Th>Status</Th><Th>Version</Th><Th>Name</Th><Th>Score</Th><Th>Warnings</Th><Th>When</Th></tr>
              </thead>
              <tbody>
                {dbMigrations.map(m => (
                  <tr key={m.id} className="border-b border-gray-200">
                    <Td><Badge value={m.status} /></Td>
                    <Td className="font-mono">{m.version}</Td>
                    <Td>{m.name}</Td>
                    <Td className={`font-mono font-bold ${
                      Number(m.safety_score) < 50 ? 'text-red-600' :
                      Number(m.safety_score) < 80 ? 'text-amber-600' : 'text-green-600'
                    }`}>{m.safety_score}</Td>
                    <Td className="font-mono text-gray-500">{(m.safety_warnings || []).length}</Td>
                    <Td className="text-gray-500">{fmtAgo(Number(m.created_at))}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
