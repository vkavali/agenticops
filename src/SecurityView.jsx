import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, MetricCard, EmptyState, fmtAgo } from './components/views';

export default function SecurityView() {
  const { securityScans } = useApp();
  const [findings, setFindings] = useState([]);
  const [filter, setFilter] = useState('open');

  useEffect(() => {
    api.security.listFindings({ status: filter, limit: 200 }).then(setFindings).catch(() => {});
  }, [filter]);

  const counts = securityScans.reduce((acc, s) => ({
    critical: acc.critical + (s.findings_critical || 0),
    high:     acc.high     + (s.findings_high || 0),
    medium:   acc.medium   + (s.findings_medium || 0),
    low:      acc.low      + (s.findings_low || 0),
  }), { critical: 0, high: 0, medium: 0, low: 0 });

  const resolveFinding = async (id) => {
    await api.security.resolveFinding(id);
    setFindings(prev => prev.filter(f => f.id !== id));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={ShieldCheck} title="Security" subtitle="SAST · DAST · SCA · secrets · IaC scans" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Critical" value={counts.critical} danger={counts.critical > 0} />
          <MetricCard label="High" value={counts.high} danger={counts.high > 0} />
          <MetricCard label="Medium" value={counts.medium} />
          <MetricCard label="Low" value={counts.low} />
        </div>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-900 mb-2">Recent scans</h3>
          {securityScans.length === 0 ? (
            <EmptyState message="No scans recorded" hint="Pipeline scanner steps (Trivy, Semgrep, Snyk) POST results to /api/security/scans." />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b-2 border-gray-900">
                <tr><Th>Type</Th><Th>Target</Th><Th>Status</Th><Th>Crit</Th><Th>High</Th><Th>Med</Th><Th>Low</Th><Th>When</Th></tr>
              </thead>
              <tbody>
                {securityScans.slice(0, 30).map(s => (
                  <tr key={s.id} className="border-b border-gray-200">
                    <Td><Badge value={s.scan_type} kind="info" /></Td>
                    <Td className="font-mono">{s.target}</Td>
                    <Td><Badge value={s.status} /></Td>
                    <Td className="font-mono font-bold text-red-600">{s.findings_critical || 0}</Td>
                    <Td className="font-mono font-bold text-orange-600">{s.findings_high || 0}</Td>
                    <Td className="font-mono">{s.findings_medium || 0}</Td>
                    <Td className="font-mono">{s.findings_low || 0}</Td>
                    <Td className="text-gray-500">{fmtAgo(Number(s.started_at))}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-900">Findings</h3>
            <select value={filter} onChange={e => setFilter(e.target.value)} className="text-[10px] border border-gray-300 px-2 py-1 font-mono">
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="ignored">ignored</option>
            </select>
          </div>
          {findings.length === 0 ? (
            <EmptyState message={`No ${filter} findings`} />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b-2 border-gray-900">
                <tr><Th>Severity</Th><Th>Rule</Th><Th>Title</Th><Th>Target</Th><Th>File</Th><Th></Th></tr>
              </thead>
              <tbody>
                {findings.slice(0, 50).map(f => (
                  <tr key={f.id} className="border-b border-gray-200">
                    <Td><Badge value={f.severity} kind={f.severity} /></Td>
                    <Td className="font-mono text-gray-500">{f.rule_id || '—'}</Td>
                    <Td className="text-gray-900">{f.title}</Td>
                    <Td className="font-mono text-gray-500">{f.target}</Td>
                    <Td className="font-mono text-gray-500">{f.file_path}{f.line ? `:${f.line}` : ''}</Td>
                    <Td>
                      {f.status === 'open' && (
                        <button onClick={() => resolveFinding(f.id)} className="text-[10px] font-bold text-green-600 hover:underline">resolve</button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
function Th({ children }) { return <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2 ${className}`}>{children}</td>; }
