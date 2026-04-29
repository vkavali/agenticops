import { useEffect, useState } from 'react';
import { GitMerge, RefreshCw, Plus, X } from 'lucide-react';
import api from './api';
import { useApp } from './store';
import { PageHeader, Badge, MetricCard, EmptyState, fmtAgo } from './components/views';

export default function GitOpsView() {
  const { gitopsApps, setGitopsApps, cloudConnectors, toast } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: '', repo_full_name: '', manifest_path: '.', target_cluster: '', cluster_connector_id: '', auto_sync: true });
  const k8sConnectors = (cloudConnectors || []).filter(c => c.provider === 'kubernetes');
  const [selected, setSelected] = useState(null);
  const [appDetail, setAppDetail] = useState(null);

  useEffect(() => {
    if (!selected) { setAppDetail(null); return; }
    api.gitops.getApp(selected).then(setAppDetail).catch(() => {});
  }, [selected]);

  const drift = gitopsApps.filter(a => a.last_sync_status === 'drift-detected').length;
  const failed = gitopsApps.filter(a => a.last_sync_status === 'failed').length;

  const submit = async () => {
    if (!draft.name || !draft.repo_full_name) return toast('name and repo required', 'warning');
    try {
      const a = await api.gitops.createApp(draft);
      setGitopsApps(prev => [a, ...prev]);
      setShowCreate(false); setDraft({ name: '', repo_full_name: '', manifest_path: '.', target_cluster: '', auto_sync: true });
      toast('App registered', 'success');
    } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
  };

  const sync = async (id) => {
    await api.gitops.sync(id); toast('Sync triggered', 'info');
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <PageHeader
          icon={GitMerge} title="GitOps"
          subtitle="manifest-tree drift detection · 60s sweep"
          actions={
            <button onClick={() => setShowCreate(true)}
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border-2 border-gray-900 hover:bg-gray-900 hover:text-white flex items-center">
              <Plus size={10} className="mr-1.5" /> Register App
            </button>
          }
        />
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Apps" value={gitopsApps.length} />
            <MetricCard label="Drift detected" value={drift} danger={drift > 0} />
            <MetricCard label="Failed syncs" value={failed} danger={failed > 0} />
          </div>

          {gitopsApps.length === 0 ? (
            <EmptyState message="No GitOps apps registered" hint="Each app links a repo + manifest path. The sweep clones, hashes the manifest tree, and emits drift events. A real K8s plug-in hooks into gitops:sync-applied to actually apply." />
          ) : (
            <div className="space-y-2">
              {gitopsApps.map(a => (
                <div key={a.id} onClick={() => setSelected(a.id)}
                  className={`border-2 bg-white p-3 cursor-pointer transition-all ${
                    selected === a.id ? 'border-gray-900 shadow-[4px_4px_0_0_#111827]' : 'border-gray-300 hover:border-gray-900 shadow-[1px_1px_0_0_#111827]'
                  }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{a.name}</div>
                      <div className="text-[11px] font-mono text-gray-500 mt-0.5">
                        {a.repo_full_name} · {a.manifest_path} {a.target_cluster && <>→ {a.target_cluster}</>}
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Badge value={a.last_sync_status || 'pending'} />
                      <span className="text-[10px] font-mono text-gray-500">{fmtAgo(a.last_sync_at ? Number(a.last_sync_at) : null)}</span>
                      <button onClick={(e) => { e.stopPropagation(); sync(a.id); }}
                        className="text-[10px] text-gray-700 hover:text-gray-900 font-bold uppercase tracking-widest"><RefreshCw size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && appDetail && (
        <div className="w-[400px] border-l-2 border-gray-900 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest">{appDetail.name}</h3>
            <button onClick={() => setSelected(null)}><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Sync history</div>
            {(appDetail.syncs || []).length === 0 ? (
              <div className="text-xs text-gray-500">No syncs recorded yet.</div>
            ) : (
              <div className="space-y-1">
                {appDetail.syncs.map(s => (
                  <div key={s.id} className="border border-gray-200 p-2 text-[11px] flex items-center justify-between">
                    <div>
                      <Badge value={s.status} />
                      <span className="ml-2 font-mono text-gray-500">{s.revision ? s.revision.slice(0, 12) : '—'}</span>
                    </div>
                    <div className="text-[10px] font-mono text-gray-400">{fmtAgo(s.started_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/25 z-[80] flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white border-2 border-gray-900 shadow-[8px_8px_0_0_#111827] w-[480px]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest">Register App</h3>
              <button onClick={() => setShowCreate(false)}><X size={14} /></button>
            </div>
            <div className="p-4 space-y-3">
              <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              <Field label="Repo (owner/repo)"><input value={draft.repo_full_name} onChange={e => setDraft({ ...draft, repo_full_name: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs font-mono" /></Field>
              <Field label="Manifest path"><input value={draft.manifest_path} onChange={e => setDraft({ ...draft, manifest_path: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs font-mono" /></Field>
              <Field label="Target cluster (label)"><input value={draft.target_cluster} onChange={e => setDraft({ ...draft, target_cluster: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs" /></Field>
              <Field label="K8s connector (real kubectl apply)">
                <select value={draft.cluster_connector_id} onChange={e => setDraft({ ...draft, cluster_connector_id: e.target.value })} className="w-full px-2 py-1 border border-gray-300 text-xs">
                  <option value="">— none (drift events only, no real apply) —</option>
                  {k8sConnectors.map(c => <option key={c.id} value={c.id}>{c.name} ({c.region || 'no region'})</option>)}
                </select>
              </Field>
              <label className="flex items-center text-xs">
                <input type="checkbox" checked={draft.auto_sync} onChange={e => setDraft({ ...draft, auto_sync: e.target.checked })} className="mr-2" />
                Auto-sync on drift
              </label>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end space-x-2">
              <button onClick={() => setShowCreate(false)} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 border border-gray-300">Cancel</button>
              <button onClick={submit} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-gray-900 text-white">Register</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Field({ label, children }) { return <div><div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{label}</div>{children}</div>; }
