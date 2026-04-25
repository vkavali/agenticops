import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, X, ThumbsUp, XCircle } from 'lucide-react';

const INITIAL_INCIDENTS = [
  {
    id: 'INC-2847', title: 'Heap Memory Exhaustion — POST Handler', service: 'lambda-post', severity: 'critical', status: 'active', opened: '14m ago', assignee: 'ARC-R Engine',
    description: 'OutOfMemoryError on lambda-post. Current allocation (128MB) insufficient for payload size after v2.3 deploy.',
    timeline: [
      { time: '10:44:05', event: 'Alert triggered by CloudWatch alarm', type: 'alert' },
      { time: '10:44:08', event: 'ARC-R Engine auto-assigned', type: 'system' },
      { time: '10:44:12', event: 'Root cause identified: memory_size = 128MB', type: 'analysis' },
      { time: '10:44:15', event: 'IaC patch generated (memory_size → 256MB)', type: 'fix' },
      { time: '10:44:20', event: 'Awaiting operator approval', type: 'pending' },
    ],
  },
  {
    id: 'INC-2846', title: 'Elevated P99 Latency — API Gateway', service: 'api-gw', severity: 'warning', status: 'resolved', opened: '2h ago', resolved: '1h 45m ago', assignee: 'ops-team',
    description: 'P99 latency exceeded 500ms threshold on /api/v2/users endpoint. Caused by cold starts after scaling event.',
    timeline: [
      { time: '08:15:00', event: 'Latency threshold breach detected', type: 'alert' },
      { time: '08:18:00', event: 'Provisioned concurrency auto-scaled', type: 'fix' },
      { time: '08:30:00', event: 'Latency normalized. Incident resolved.', type: 'resolved' },
    ],
  },
  {
    id: 'INC-2845', title: 'DynamoDB Throttling — Read Capacity', service: 'dynamo', severity: 'warning', status: 'resolved', opened: '6h ago', resolved: '5h ago', assignee: 'ARC-R Engine',
    description: 'ReadCapacityUnitsExceeded on DynamoDB Core table. Auto-scaling policy lag during traffic spike.',
    timeline: [
      { time: '04:22:00', event: 'Throttling events detected (>50/min)', type: 'alert' },
      { time: '04:25:00', event: 'On-demand capacity mode enabled', type: 'fix' },
      { time: '05:00:00', event: 'Throttling resolved. Incident closed.', type: 'resolved' },
    ],
  },
];

export default function IncidentsView() {
  const [selected, setSelected] = useState(null);
  const [incidents, setIncidents] = useState(INITIAL_INCIDENTS);

  const acknowledge = (id) => {
    setIncidents(prev => prev.map(i => {
      if (i.id !== id) return i;
      return { ...i, status: 'acknowledged', timeline: [...i.timeline, { time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }), event: 'Incident acknowledged by operator', type: 'system' }] };
    }));
  };

  const resolve = (id) => {
    setIncidents(prev => prev.map(i => {
      if (i.id !== id) return i;
      return { ...i, status: 'resolved', resolved: 'Just now', timeline: [...i.timeline, { time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }), event: 'Incident resolved by operator', type: 'resolved' }] };
    }));
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto hidden-scrollbar">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Incident Log</h2>
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
              {incidents.filter(i => i.status === 'active' || i.status === 'acknowledged').length} Active · {incidents.length} Total
            </div>
          </div>
          <div className="space-y-3">
            {incidents.map(inc => (
              <div key={inc.id} onClick={() => setSelected(inc.id === selected ? null : inc.id)}
                className={`border bg-white cursor-pointer transition-all duration-150 ${
                  inc.id === selected ? 'border-gray-900 shadow-[4px_4px_0_0_#111827] -translate-x-[2px] -translate-y-[2px]'
                    : inc.severity === 'critical' && inc.status === 'active' ? 'border-red-500 shadow-[2px_2px_0_0_#DC2626] hover:-translate-x-[1px] hover:-translate-y-[1px]'
                    : 'border-gray-300 shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px]'
                }`}>
                <div className={`h-1 w-full ${
                  inc.status === 'active' && inc.severity === 'critical' ? 'bg-red-500' :
                  inc.status === 'acknowledged' ? 'bg-amber-500' :
                  'bg-green-500'
                }`} />
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono font-bold text-gray-400">{inc.id}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${
                        inc.status === 'active' ? 'bg-red-50 text-red-600 border-red-200' :
                        inc.status === 'acknowledged' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                        'bg-green-50 text-green-700 border-green-200'
                      }`}>{inc.status}</span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-400 flex items-center"><Clock size={10} className="mr-1" />{inc.opened}</span>
                  </div>
                  <div className="text-xs font-bold text-gray-900 mb-1">{inc.title}</div>
                  <div className="text-[10px] text-gray-500">
                    <span className="font-mono">{inc.service}</span> · Assigned to <span className="font-bold text-gray-700">{inc.assignee}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      <div className={`w-[400px] bg-white border-l-2 border-gray-900 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.05)] transition-transform duration-300 ${selected ? 'translate-x-0' : 'translate-x-full'}`}>
        {selected && (() => {
          const inc = incidents.find(i => i.id === selected);
          if (!inc) return null;
          return (
            <>
              <div className="p-5 border-b border-gray-200 bg-gray-50 shrink-0">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] font-mono font-bold text-gray-400">{inc.id}</span>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">{inc.title}</h3>
                <p className="text-xs text-gray-600 leading-relaxed">{inc.description}</p>

                {/* Action buttons */}
                {inc.status !== 'resolved' && (
                  <div className="flex items-center space-x-2 mt-4">
                    {inc.status === 'active' && (
                      <button onClick={() => acknowledge(inc.id)}
                        className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center cursor-pointer shadow-[2px_2px_0_0_#D97706] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]">
                        <ThumbsUp size={10} className="mr-1" /> Acknowledge
                      </button>
                    )}
                    <button onClick={() => resolve(inc.id)}
                      className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-green-400 bg-green-50 text-green-700 hover:bg-green-100 flex items-center cursor-pointer shadow-[2px_2px_0_0_#16A34A] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]">
                      <CheckCircle2 size={10} className="mr-1" /> Resolve
                    </button>
                  </div>
                )}
                {inc.status === 'resolved' && (
                  <div className="mt-3 flex items-center text-[10px] font-bold text-green-600"><CheckCircle2 size={12} className="mr-1" /> Resolved {inc.resolved}</div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto hidden-scrollbar p-5">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Timeline</h4>
                <div className="space-y-0 relative">
                  <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gray-200" />
                  {inc.timeline.map((t, i) => (
                    <div key={i} className="flex items-start space-x-3 pb-4 relative">
                      <div className={`w-[11px] h-[11px] border-2 shrink-0 mt-0.5 z-10 ${
                        t.type === 'alert' ? 'bg-red-500 border-red-500' :
                        t.type === 'fix' ? 'bg-amber-500 border-amber-500' :
                        t.type === 'resolved' ? 'bg-green-500 border-green-500' :
                        'bg-white border-gray-400'
                      }`} />
                      <div>
                        <div className="text-[10px] font-mono text-gray-400 mb-0.5">{t.time}</div>
                        <div className="text-xs text-gray-700">{t.event}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
