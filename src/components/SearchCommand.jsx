import { useState, useEffect, useRef } from 'react';
import { Search, BarChart3, Network, Rocket, Activity, LayoutTemplate, Settings2, ChevronRight } from 'lucide-react';
import { useApp } from '../store';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3, keywords: ['home', 'overview', 'command center'] },
  { id: 'pipelines', label: 'Pipelines', icon: LayoutTemplate, keywords: ['ci', 'build', 'test', 'stages'] },
  { id: 'deployments', label: 'Deployments', icon: Rocket, keywords: ['deploy', 'release', 'promote', 'rollback'] },
  { id: 'topology', label: 'Infrastructure', icon: Network, keywords: ['infra', 'topology', 'nodes', 'aws', 'lambda'] },
  { id: 'incidents', label: 'Incidents', icon: Activity, keywords: ['alert', 'issue', 'outage', 'error'] },
  { id: 'settings', label: 'Settings', icon: Settings2, keywords: ['config', 'team', 'secrets', 'security', 'environment'] },
];

export default function SearchCommand({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const { pipelines, incidents, services, deployments } = useApp();

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.toLowerCase().trim();

  // Build searchable items
  const results = [];

  // Navigation
  NAV_ITEMS.forEach(item => {
    if (!q || item.label.toLowerCase().includes(q) || item.keywords.some(k => k.includes(q))) {
      results.push({ type: 'nav', id: item.id, label: item.label, icon: item.icon, action: () => { onNavigate(item.id); onClose(); } });
    }
  });

  // Pipelines
  if (q) {
    pipelines.forEach(p => {
      if (p.name.toLowerCase().includes(q)) {
        results.push({ type: 'pipeline', id: p.id, label: p.name, sublabel: `${p.runs.length} runs · ${p.branch}`, icon: LayoutTemplate, action: () => { onNavigate('pipelines', p.id); onClose(); } });
      }
    });
  }

  // Incidents
  if (q) {
    incidents.forEach(i => {
      if (i.id.toLowerCase().includes(q) || i.title.toLowerCase().includes(q)) {
        results.push({ type: 'incident', id: i.id, label: `${i.id}: ${i.title}`, sublabel: `${i.status} · ${i.severity}`, icon: Activity, action: () => { onNavigate('incidents', i.id); onClose(); } });
      }
    });
  }

  // Services
  if (q) {
    services.forEach(s => {
      if (s.name.toLowerCase().includes(q)) {
        results.push({ type: 'service', id: s.id, label: s.name, sublabel: `${s.status} · ${s.version}`, icon: Network, action: () => { onNavigate('topology'); onClose(); } });
      }
    });
  }

  const handleSelect = (result) => {
    result.action();
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-[80] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[540px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b border-gray-200">
          <Search size={16} className="text-gray-400 shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, pipelines, incidents, services..."
            className="flex-1 text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent font-medium"
          />
          <kbd className="text-[9px] font-mono text-gray-400 bg-gray-100 border border-gray-200 px-1.5 py-0.5 ml-2">ESC</kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto hidden-scrollbar flex-1">
          {results.length === 0 && q && (
            <div className="p-6 text-center text-xs text-gray-400 font-bold">No results found for "{query}"</div>
          )}

          {/* Nav section */}
          {results.filter(r => r.type === 'nav').length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Pages</div>
              {results.filter(r => r.type === 'nav').map(r => {
                const Icon = r.icon;
                return (
                  <button key={r.id} onClick={() => handleSelect(r)}
                    className="w-full flex items-center px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors text-left group">
                    <Icon size={14} className="text-gray-400 group-hover:text-gray-900 mr-3 shrink-0" />
                    <span className="text-xs font-bold text-gray-700 group-hover:text-gray-900 flex-1">{r.label}</span>
                    <ChevronRight size={12} className="text-gray-300 group-hover:text-gray-500" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Dynamic results */}
          {['pipeline', 'incident', 'service'].map(type => {
            const items = results.filter(r => r.type === type);
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <div className="px-4 pt-3 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">{type}s</div>
                {items.map(r => {
                  const Icon = r.icon;
                  return (
                    <button key={r.id} onClick={() => handleSelect(r)}
                      className="w-full flex items-center px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors text-left group">
                      <Icon size={14} className="text-gray-400 group-hover:text-gray-900 mr-3 shrink-0" />
                      <div className="flex-1 overflow-hidden">
                        <div className="text-xs font-bold text-gray-700 group-hover:text-gray-900 truncate">{r.label}</div>
                        {r.sublabel && <div className="text-[10px] font-mono text-gray-400 truncate">{r.sublabel}</div>}
                      </div>
                      <ChevronRight size={12} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center space-x-4">
          <span className="text-[9px] font-mono text-gray-400">↑↓ navigate</span>
          <span className="text-[9px] font-mono text-gray-400">↵ select</span>
          <span className="text-[9px] font-mono text-gray-400">esc close</span>
        </div>
      </div>
    </div>
  );
}
