// Shared primitives for the Phase 3 views — keeps individual view files tight.
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

export function PageHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="border-b border-gray-300 bg-white px-6 py-4 flex items-center justify-between">
      <div className="flex items-center">
        {Icon && <Icon size={18} className="text-gray-900 mr-3" />}
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest">{title}</h1>
          {subtitle && <div className="text-[11px] text-gray-500 font-mono mt-0.5">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center space-x-2">{actions}</div>}
    </div>
  );
}

const SEVERITY_STYLES = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  medium:   'bg-amber-50 text-amber-700 border-amber-200',
  low:      'bg-blue-50 text-blue-700 border-blue-200',
  warning:  'bg-amber-50 text-amber-700 border-amber-200',
  info:     'bg-blue-50 text-blue-700 border-blue-200',
  passed:   'bg-green-50 text-green-700 border-green-200',
  failed:   'bg-red-50 text-red-700 border-red-200',
  running:  'bg-blue-50 text-blue-700 border-blue-200',
  active:   'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-green-50 text-green-700 border-green-200',
  open:     'bg-amber-50 text-amber-700 border-amber-200',
  pending:  'bg-gray-50 text-gray-700 border-gray-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  complete: 'bg-green-50 text-green-700 border-green-200',
  paused:   'bg-amber-50 text-amber-700 border-amber-200',
  'in-sync':         'bg-green-50 text-green-700 border-green-200',
  'drift-detected':  'bg-amber-50 text-amber-700 border-amber-200',
  synced:    'bg-green-50 text-green-700 border-green-200',
  applied:   'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-300',
  default:   'bg-gray-100 text-gray-700 border-gray-300',
};

export function Badge({ value, kind }) {
  const cls = SEVERITY_STYLES[kind || value] || SEVERITY_STYLES.default;
  return (
    <span className={`inline-block px-1.5 py-0.5 border text-[9px] uppercase tracking-widest font-bold ${cls}`}>
      {value}
    </span>
  );
}

const GRADE_COLORS = {
  A: 'text-green-600', B: 'text-green-500', C: 'text-amber-500', D: 'text-orange-500', F: 'text-red-600',
};
export function Grade({ value }) {
  return <span className={`font-mono font-bold text-lg ${GRADE_COLORS[value] || 'text-gray-400'}`}>{value || '—'}</span>;
}

export function MetricCard({ label, value, unit, danger }) {
  return (
    <div className="border border-gray-200 p-3 bg-gray-50">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${danger ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
        {unit && <span className="text-xs text-gray-500 font-normal ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ message, hint }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <AlertCircle size={28} className="text-gray-300 mb-3" />
      <div className="text-sm font-bold text-gray-700">{message}</div>
      {hint && <div className="text-xs text-gray-500 font-mono mt-2 max-w-md">{hint}</div>}
    </div>
  );
}

export function StatusIcon({ ok }) {
  return ok
    ? <CheckCircle2 size={14} className="text-green-600" />
    : <AlertTriangle size={14} className="text-red-600" />;
}

// USD short formatter
export function fmtUSD(n) {
  if (n == null) return '—';
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n, digits = 1) {
  if (n == null) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

export function fmtAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
