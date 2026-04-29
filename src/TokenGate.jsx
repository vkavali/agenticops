import { useEffect, useState } from 'react';
import { Lock, KeyRound } from 'lucide-react';
import api, { getToken, setToken } from './api';

// Token-gate: blocks the app until a valid bearer token is in localStorage.
// On success, calls onAuth({role, label, tokenId}) and renders children.
export default function TokenGate({ children, onAuth }) {
  // Compute initial status synchronously so we don't setState inside an effect.
  const [status, setStatus] = useState(() => getToken() ? 'checking' : 'needs-token');
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status !== 'checking') return;
    let cancelled = false;
    api.me().then(me => {
      if (cancelled) return;
      onAuth?.(me);
      setStatus('ok');
    }).catch(err => {
      if (cancelled) return;
      if (err.status === 401 || err.status === 403) {
        setToken('');
        setStatus('needs-token');
      } else {
        setError(err.message);
        setStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [status, onAuth]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setToken(input.trim());
    try {
      const me = await api.me();
      onAuth?.(me);
      setStatus('ok');
    } catch (err) {
      setToken('');
      setError(err.status === 401 ? 'Invalid token' : err.message);
    }
  }

  if (status === 'ok') return children;

  if (status === 'checking') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F9FAFB]">
        <div className="text-xs font-mono text-gray-400 uppercase tracking-widest">Authenticating…</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[#F9FAFB] font-sans">
      <div className="w-[400px] bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] p-6">
        <div className="flex items-center mb-4">
          <Lock size={18} className="text-gray-900 mr-2" />
          <h1 className="text-sm font-bold uppercase tracking-widest">AgenticOps</h1>
        </div>
        <p className="text-xs text-gray-600 mb-4">
          Enter your API token to continue. Ask an admin to mint one with{' '}
          <code className="bg-gray-100 px-1 py-0.5 border border-gray-200 font-mono text-[10px]">POST /api/tokens</code>.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="relative mb-3">
            <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="password"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="aops_…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 text-xs font-mono focus:outline-none focus:border-gray-900"
            />
          </div>
          {error && (
            <div className="text-[11px] text-red-600 font-mono mb-3 border border-red-200 bg-red-50 p-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-full bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white text-xs font-bold uppercase tracking-widest py-2 transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
