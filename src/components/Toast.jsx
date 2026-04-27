import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useApp } from '../store';

const SEVERITY_STYLES = {
  success: { border: 'border-green-500', bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2, shadow: 'shadow-[4px_4px_0_0_#16A34A]' },
  warning: { border: 'border-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', icon: AlertTriangle, shadow: 'shadow-[4px_4px_0_0_#D97706]' },
  error: { border: 'border-red-500', bg: 'bg-red-50', text: 'text-red-700', icon: AlertTriangle, shadow: 'shadow-[4px_4px_0_0_#DC2626]' },
  info: { border: 'border-gray-900', bg: 'bg-white', text: 'text-gray-900', icon: Info, shadow: 'shadow-[4px_4px_0_0_#111827]' },
};

export default function ToastContainer() {
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col space-y-2 pointer-events-none">
      {toasts.map((t) => {
        const style = SEVERITY_STYLES[t.severity] || SEVERITY_STYLES.info;
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto border-2 ${style.border} ${style.bg} ${style.shadow} px-4 py-3 flex items-center space-x-2 min-w-[240px] max-w-[360px] animate-slide-in`}
          >
            <Icon size={14} className={`${style.text} shrink-0`} />
            <span className={`text-xs font-bold ${style.text} flex-1`}>{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-gray-400 hover:text-gray-900 cursor-pointer shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
