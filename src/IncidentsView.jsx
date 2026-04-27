import { useState, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Clock, X, ThumbsUp, XCircle, Plus, Search, Filter, MessageSquare, ArrowUpCircle, ArrowDownCircle, Send } from 'lucide-react';
import { useApp, generateId } from './store';

export default function IncidentsView() {
  const {
    incidents, createIncident, acknowledgeIncident, resolveIncident,
    addIncidentComment, updateIncident, services, toast,
  } = useApp();

  const [selected, setSelected] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newIncident, setNewIncident] = useState({ title: '', service: '', severity: 'warning', description: '', assignee: 'ops-team' });
  const [commentText, setCommentText] = useState('');
  const commentRef = useRef(null);

  const serviceNames = useMemo(() => [...new Set(services.map(s => s.name))], [services]);

  // Filter incidents
  const filtered = useMemo(() => {
    return incidents.filter(i => {
      if (filterStatus !== 'all' && i.status !== filterStatus) return false;
      if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false;
      if (searchQuery && !i.id.toLowerCase().includes(searchQuery.toLowerCase()) && !i.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [incidents, filterStatus, filterSeverity, searchQuery]);

  const selectedInc = incidents.find(i => i.id === selected);

  const handleCreate = () => {
    if (!newIncident.title.trim()) { toast('Title is required', 'warning'); return; }
    createIncident(newIncident);
    setShowCreate(false);
    setNewIncident({ title: '', service: '', severity: 'warning', description: '', assignee: 'ops-team' });
  };

  const handleComment = () => {
    if (!commentText.trim() || !selected) return;
    addIncidentComment(selected, commentText.trim());
    setCommentText('');
    toast('Comment added');
  };

  const handleEscalate = (id) => {
    const inc = incidents.find(i => i.id === id);
    if (!inc) return;
    const next = inc.severity === 'warning' ? 'critical' : 'warning';
    updateIncident(id, { severity: next });
    addIncidentComment(id, `Severity changed: ${inc.severity} → ${next}`);
    toast(`${id} severity → ${next}`, next === 'critical' ? 'error' : 'info');
  };

  return (
    <div className="flex h-full">
      {/* Create Incident Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[480px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center"><AlertTriangle size={14} className="mr-2" /> Create Incident</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Title *</div>
                <input type="text" value={newIncident.title} onChange={e => setNewIncident(p => ({ ...p, title: e.target.value }))} placeholder="e.g., Elevated error rate on api-service"
                  className="w-full border-2 border-gray-300 px-3 py-2.5 text-xs font-mono bg-white focus:outline-none focus:border-gray-900" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Service</div>
                  <select value={newIncident.service} onChange={e => setNewIncident(p => ({ ...p, service: e.target.value }))}
                    className="w-full border-2 border-gray-300 px-3 py-2.5 text-xs font-mono bg-white cursor-pointer focus:outline-none focus:border-gray-900">
                    <option value="">Select...</option>
                    {serviceNames.map(s => <option key={s} value={s}>{s}</option>)}
                    <option value="lambda-post">lambda-post</option>
                    <option value="api-gw">api-gw</option>
                    <option value="dynamo">dynamo</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Severity</div>
                  <div className="flex space-x-2">
                    {['warning', 'critical'].map(s => (
                      <button key={s} onClick={() => setNewIncident(p => ({ ...p, severity: s }))}
                        className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 border-2 cursor-pointer text-center ${
                          newIncident.severity === s
                            ? s === 'critical' ? 'bg-red-600 text-white border-red-600' : 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Description</div>
                <textarea value={newIncident.description} onChange={e => setNewIncident(p => ({ ...p, description: e.target.value }))} placeholder="Describe the issue..."
                  className="w-full border-2 border-gray-300 px-3 py-2 text-xs font-mono bg-white h-20 resize-none focus:outline-none focus:border-gray-900" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Assign To</div>
                <select value={newIncident.assignee} onChange={e => setNewIncident(p => ({ ...p, assignee: e.target.value }))}
                  className="w-full border-2 border-gray-300 px-3 py-2.5 text-xs font-mono bg-white cursor-pointer focus:outline-none focus:border-gray-900">
                  <option value="ops-team">ops-team</option>
                  <option value="ARC-R Engine">ARC-R Engine</option>
                  <option value="v.kavali">v.kavali</option>
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-2">
              <button onClick={() => setShowCreate(false)} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer">Cancel</button>
              <button onClick={handleCreate} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 cursor-pointer flex items-center">
                <AlertTriangle size={10} className="mr-1" /> Create Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incident List */}
      <div className="flex-1 overflow-y-auto hidden-scrollbar">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Incident Log</h2>
            <div className="flex items-center space-x-3">
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                {incidents.filter(i => i.status === 'active' || i.status === 'acknowledged').length} Active · {incidents.length} Total
              </div>
              <button onClick={() => setShowCreate(true)} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-gray-900 text-white shadow-[2px_2px_0_0_#D1D5DB] hover:bg-gray-800 cursor-pointer flex items-center">
                <Plus size={10} className="mr-1" /> Create
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center space-x-3 mb-4">
            <div className="flex items-center border border-gray-200 bg-white px-2 py-1.5 flex-1 max-w-[280px]">
              <Search size={12} className="text-gray-400 mr-2 shrink-0" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search incidents..."
                className="flex-1 text-[10px] font-mono text-gray-700 outline-none bg-transparent" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest bg-white cursor-pointer focus:outline-none">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
              className="border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest bg-white cursor-pointer focus:outline-none">
              <option value="all">All Severity</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
            </select>
          </div>

          <div className="space-y-3">
            {filtered.map(inc => (
              <div key={inc.id} onClick={() => setSelected(inc.id === selected ? null : inc.id)}
                className={`border bg-white cursor-pointer transition-all duration-150 ${
                  inc.id === selected ? 'border-gray-900 shadow-[4px_4px_0_0_#111827] -translate-x-[2px] -translate-y-[2px]'
                    : inc.severity === 'critical' && inc.status === 'active' ? 'border-red-500 shadow-[2px_2px_0_0_#DC2626] hover:-translate-x-[1px] hover:-translate-y-[1px]'
                    : 'border-gray-300 shadow-[1px_1px_0_0_#111827] hover:shadow-[2px_2px_0_0_#111827] hover:-translate-x-[1px] hover:-translate-y-[1px]'
                }`}>
                <div className={`h-1 w-full ${
                  inc.status === 'active' && inc.severity === 'critical' ? 'bg-red-500' :
                  inc.status === 'active' && inc.severity === 'warning' ? 'bg-amber-500' :
                  inc.status === 'acknowledged' ? 'bg-amber-500' :
                  'bg-green-500'
                }`} />
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono font-bold text-gray-400">{inc.id}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${
                        inc.severity === 'critical' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'
                      }`}>{inc.severity}</span>
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
            {filtered.length === 0 && (
              <div className="border-2 border-dashed border-gray-300 p-8 text-center">
                <div className="text-xs text-gray-400 font-bold">No incidents match your filters</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      <div className={`w-[400px] bg-white border-l-2 border-gray-900 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.05)] transition-transform duration-300 shrink-0 ${selected ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedInc && (
          <>
            <div className="p-5 border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex justify-between items-start mb-3">
                <span className="text-[10px] font-mono font-bold text-gray-400">{selectedInc.id}</span>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
              </div>
              <h3 className="text-sm font-bold text-gray-900 mb-1">{selectedInc.title}</h3>
              <p className="text-xs text-gray-600 leading-relaxed">{selectedInc.description}</p>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="text-[10px]"><span className="text-gray-400">Service:</span> <span className="font-mono font-bold text-gray-700">{selectedInc.service}</span></div>
                <div className="text-[10px]"><span className="text-gray-400">Severity:</span> <span className={`font-bold ${selectedInc.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>{selectedInc.severity}</span></div>
                <div className="text-[10px]"><span className="text-gray-400">Assignee:</span> <span className="font-bold text-gray-700">{selectedInc.assignee}</span></div>
                <div className="text-[10px]"><span className="text-gray-400">Opened:</span> <span className="font-mono text-gray-700">{selectedInc.opened}</span></div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center space-x-2 mt-4 flex-wrap gap-y-2">
                {selectedInc.status === 'active' && (
                  <button onClick={() => acknowledgeIncident(selectedInc.id)}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center cursor-pointer shadow-[2px_2px_0_0_#D97706] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]">
                    <ThumbsUp size={10} className="mr-1" /> Acknowledge
                  </button>
                )}
                {selectedInc.status !== 'resolved' && (
                  <button onClick={() => resolveIncident(selectedInc.id)}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-green-400 bg-green-50 text-green-700 hover:bg-green-100 flex items-center cursor-pointer shadow-[2px_2px_0_0_#16A34A] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]">
                    <CheckCircle2 size={10} className="mr-1" /> Resolve
                  </button>
                )}
                {selectedInc.status !== 'resolved' && (
                  <button onClick={() => handleEscalate(selectedInc.id)}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center cursor-pointer">
                    {selectedInc.severity === 'warning' ? <ArrowUpCircle size={10} className="mr-1" /> : <ArrowDownCircle size={10} className="mr-1" />}
                    {selectedInc.severity === 'warning' ? 'Escalate' : 'De-escalate'}
                  </button>
                )}
                {selectedInc.status === 'resolved' && (
                  <div className="flex items-center text-[10px] font-bold text-green-600"><CheckCircle2 size={12} className="mr-1" /> Resolved {selectedInc.resolved}</div>
                )}
              </div>

              {/* Assignee change */}
              {selectedInc.status !== 'resolved' && (
                <div className="mt-3">
                  <select value={selectedInc.assignee} onChange={e => {
                    updateIncident(selectedInc.id, { assignee: e.target.value });
                    addIncidentComment(selectedInc.id, `Reassigned to ${e.target.value}`);
                    toast(`Reassigned to ${e.target.value}`);
                  }} className="text-[10px] font-mono text-gray-600 border border-gray-200 px-2 py-1 bg-white cursor-pointer focus:outline-none">
                    <option value="ops-team">ops-team</option>
                    <option value="ARC-R Engine">ARC-R Engine</option>
                    <option value="v.kavali">v.kavali</option>
                    <option value="security-bot">security-bot</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto hidden-scrollbar p-5">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Timeline</h4>
              <div className="space-y-0 relative">
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gray-200" />
                {selectedInc.timeline.map((t, i) => (
                  <div key={i} className="flex items-start space-x-3 pb-4 relative">
                    <div className={`w-[11px] h-[11px] border-2 shrink-0 mt-0.5 z-10 ${
                      t.type === 'alert' ? 'bg-red-500 border-red-500' :
                      t.type === 'fix' ? 'bg-amber-500 border-amber-500' :
                      t.type === 'resolved' ? 'bg-green-500 border-green-500' :
                      t.type === 'comment' ? 'bg-blue-500 border-blue-500' :
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

            {/* Comment input */}
            {selectedInc.status !== 'resolved' && (
              <div className="p-3 border-t border-gray-200 bg-gray-50 shrink-0">
                <div className="flex items-center space-x-2">
                  <input ref={commentRef} type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleComment(); }}
                    placeholder="Add a comment..."
                    className="flex-1 text-xs font-mono text-gray-700 border border-gray-200 px-3 py-2 bg-white focus:outline-none focus:border-gray-900" />
                  <button onClick={handleComment} disabled={!commentText.trim()}
                    className="p-2 bg-gray-900 text-white hover:bg-gray-800 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                    <Send size={12} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
