import { useEffect, useState } from 'react';
import { Lock, KeyRound, ShieldCheck } from 'lucide-react';

// GitHub mark inlined — lucide-react@1.11 dropped the Github brand icon and
// for this single button we'd rather not pull in @lucide/icons or a logo dep.
function GitHubMark({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.17a11 11 0 0 1 5.79 0c2.21-1.48 3.18-1.17 3.18-1.17.62 1.59.23 2.76.11 3.05.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.05.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z"/>
    </svg>
  );
}
import api, { getToken, setToken } from './api';

// Token-gate: blocks the app until a valid bearer token is in localStorage.
//
// Login methods (queried from /api/auth/methods at mount):
//   - GitHub OAuth   → redirect to /api/auth/github/start, server returns
//                      via /#token=<raw>
//   - OIDC SSO (per config) → /api/auth/oidc/start/:configId, returns ID-token
//                              via /#token=<jwt>
//   - Token paste    → fallback for CLI / scripts / power users
//
// On callback the URL fragment carries the token (fragments are not sent
// to the server). We extract it on first paint, store in localStorage, then
// fall through to the standard /api/auth/me check.

function extractFragmentToken() {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const m = hash.match(/[#&]token=([^&]+)/);
  if (!m) return null;
  // Clear the fragment so the token doesn't linger in the URL bar / history.
  const cleanHash = hash.replace(/(^|&)token=[^&]+/, '').replace(/^#&/, '#');
  const newUrl = window.location.pathname + window.location.search + (cleanHash === '#' ? '' : cleanHash);
  window.history.replaceState(null, '', newUrl);
  return decodeURIComponent(m[1]);
}

export default function TokenGate({ children, onAuth }) {
  // If we just bounced back from an OAuth callback, capture the token before
  // anything else looks at localStorage.
  const fragmentToken = extractFragmentToken();
  if (fragmentToken) setToken(fragmentToken);

  const [status, setStatus] = useState(() => (fragmentToken || getToken()) ? 'checking' : 'needs-token');
  const [methods, setMethods] = useState([]);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);

  // Once we know we need to log in, fetch which buttons to render.
  useEffect(() => {
    if (status === 'needs-token') {
      api.authMethods?.().then(r => setMethods(r?.methods || [])).catch(() => setMethods([]));
    }
  }, [status]);

  // Validate any existing token against /api/auth/me.
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

  function startMethod(m) {
    if (m.kind === 'github') {
      window.location.href = '/api/auth/github/start';
    } else if (m.kind === 'oidc') {
      window.location.href = `/api/auth/oidc/start/${encodeURIComponent(m.config_id)}`;
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
        <div className="flex items-center mb-5">
          <Lock size={18} className="text-gray-900 mr-2" />
          <h1 className="text-sm font-bold uppercase tracking-widest">AgenticOps</h1>
        </div>

        {/* Login method buttons — GitHub + per-OIDC-config */}
        {methods.length > 0 && !showTokenForm && (
          <div className="space-y-2 mb-4">
            {methods.map((m, i) => (
              <button
                key={i}
                onClick={() => startMethod(m)}
                className="w-full flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold uppercase tracking-widest py-2.5 transition-colors"
              >
                {m.kind === 'github' && <GitHubMark size={14} className="mr-2" />}
                {m.kind === 'oidc' && <ShieldCheck size={14} className="mr-2" />}
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Token paste — collapsed by default when other methods exist. */}
        {!showTokenForm && methods.length > 0 && (
          <button
            onClick={() => setShowTokenForm(true)}
            className="w-full text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 py-2"
          >
            Or paste an API token →
          </button>
        )}

        {(showTokenForm || methods.length === 0) && (
          <>
            <p className="text-xs text-gray-600 mb-4">
              {methods.length === 0
                ? 'No login methods configured. Paste an API token to continue. Ask an admin to mint one with '
                : 'Paste an API token. Useful for CLI / script access. '}
              {methods.length === 0 && (
                <code className="bg-gray-100 px-1 py-0.5 border border-gray-200 font-mono text-[10px]">POST /api/tokens</code>
              )}
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
                Sign in with token
              </button>
              {methods.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowTokenForm(false)}
                  className="w-full mt-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900 py-1"
                >
                  ← Back to login options
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
