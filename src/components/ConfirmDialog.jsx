import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/25 z-[90] flex items-center justify-center" onClick={onCancel}>
      <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[400px]" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          {danger && (
            <div className="flex items-center space-x-2 mb-3">
              <div className="bg-red-100 p-1.5 border border-red-200">
                <AlertTriangle size={16} className="text-red-600" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            </div>
          )}
          {!danger && <h3 className="text-sm font-bold text-gray-900 mb-3">{title}</h3>}
          <p className="text-xs text-gray-600 leading-relaxed">{message}</p>
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-2">
          <button
            onClick={onCancel}
            className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2 cursor-pointer shadow-[2px_2px_0_0_#D1D5DB] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
