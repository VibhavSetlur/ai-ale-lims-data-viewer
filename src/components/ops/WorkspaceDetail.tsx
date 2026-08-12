'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bot, FlaskConical, LogIn } from 'lucide-react';
import { fetchData, IS_STATIC } from '../../lib/dataSource';
import { WORKSPACES_PATH, LOGIN_PATH } from '../../lib/routes';

type WorkspaceRow = { id: string; name: string; created_at: string; updated_at: string };
type DesignSummaryRow = { id: string; workspace_id: string; name: string; version: number; updated_at: string };

type LoadState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'error'; status: number; message: string }
  | { phase: 'ready'; workspace: WorkspaceRow };

type DesignsState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; designs: DesignSummaryRow[] };

const SEARCH_DEBOUNCE_MS = 250;

export default function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [designsState, setDesignsState] = useState<DesignsState>({ phase: 'loading' });
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const currentQueryRef = useRef('');

  useEffect(() => {
    if (IS_STATIC) return;
    let cancelled = false;
    (async () => {
      try {
        const wsRes = await fetchData(`/api/ops/workspaces/${encodeURIComponent(workspaceId)}`, { credentials: 'same-origin' });
        if (wsRes.status === 401) {
          if (!cancelled) setState({ phase: 'unauthenticated' });
          return;
        }
        const wsBody = await wsRes.json();
        if (!wsRes.ok) {
          if (!cancelled) setState({ phase: 'error', status: wsRes.status, message: wsBody?.error?.message || `HTTP ${wsRes.status}` });
          return;
        }
        if (!cancelled) setState({ phase: 'ready', workspace: wsBody.data.workspace });
      } catch (err) {
        if (!cancelled) setState({ phase: 'error', status: 0, message: err instanceof Error ? err.message : 'Unknown error' });
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Debounce the search box.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Load the design list, filtered server-side by the debounced query. Guard
  // against out-of-order responses by ignoring any reply whose query is no
  // longer the current one.
  useEffect(() => {
    if (IS_STATIC || state.phase !== 'ready') return;
    let cancelled = false;
    const q = debouncedQuery.trim();
    currentQueryRef.current = q;
    setDesignsState({ phase: 'loading' });
    setRowError(null);
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    (async () => {
      try {
        const res = await fetchData(`/api/ops/workspaces/${encodeURIComponent(workspaceId)}/designs${qs}`, { credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (cancelled || currentQueryRef.current !== q) return;
        if (!res.ok) {
          setDesignsState({ phase: 'error', message: body?.error?.message || `HTTP ${res.status}` });
          return;
        }
        setDesignsState({ phase: 'ready', designs: body?.data?.designs ?? [] });
      } catch (err) {
        if (!cancelled && currentQueryRef.current === q) {
          setDesignsState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, state.phase, debouncedQuery, refreshNonce]);

  async function submitRename(id: string) {
    const name = renameValue.trim();
    if (!name || name.length > 120) {
      setRowError('Design name must be 1-120 characters.');
      return;
    }
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetchData(`/api/ops/designs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError(body?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setRenamingId(null);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Rename failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDesign(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetchData(`/api/ops/designs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRowError(body?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setBusyId(null);
    }
  }

  if (IS_STATIC) {
    return (
      <Notice icon={AlertTriangle} title="Not available in this build">
        <p>Workspaces require the server-mode viewer.</p>
      </Notice>
    );
  }

  if (state.phase === 'loading') {
    return (
      <Notice icon={FlaskConical} title="Loading workspace&hellip;">
        <p className="text-[var(--text-soft)]">One moment.</p>
      </Notice>
    );
  }

  if (state.phase === 'unauthenticated') {
    return (
      <Notice icon={LogIn} title="Sign in required">
        <p className="mb-3">Sign in to view this workspace.</p>
        <Link href={LOGIN_PATH} className="lims-btn lims-btn-primary">Go to sign-in</Link>
      </Notice>
    );
  }

  if (state.phase === 'error') {
    return (
      <Notice icon={AlertTriangle} title="Could not load this workspace">
        <p className="mb-3">{state.message}</p>
        <Link href={WORKSPACES_PATH} className="lims-btn lims-btn-secondary">Back to User Workspace</Link>
      </Notice>
    );
  }

  const { workspace } = state;
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)] p-3">
      <section className="lims-surface min-h-full rounded-xl p-4 shadow-sm">
        <header className="border-b border-[var(--border)] pb-3 mb-4">
          <h1 className="text-lg font-semibold text-[var(--text)]">{workspace.name}</h1>
          <p className="text-xs text-[var(--text-soft)] mt-1">Last updated {new Date(workspace.updated_at).toLocaleString()}</p>
        </header>

        <h2 className="lims-label mb-2">Saved plate designs</h2>
        <input
          className="lims-input w-full max-w-xs mb-3"
          aria-label="Search saved designs"
          placeholder="Search designs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {rowError && <p className="text-xs text-red-600 mb-2">{rowError}</p>}

        {designsState.phase === 'loading' ? (
          <p className="text-sm text-[var(--text-soft)] mb-6">Loading designs&hellip;</p>
        ) : designsState.phase === 'error' ? (
          <p className="text-sm text-red-600 mb-6">{designsState.message}</p>
        ) : designsState.designs.length === 0 ? (
          <p className="text-sm text-[var(--text-soft)] mb-6">
            {debouncedQuery.trim()
              ? `No designs match "${debouncedQuery.trim()}".`
              : 'No plate designs saved to this workspace yet. Save one from the Plate Design workspace.'}
          </p>
        ) : (
          <ul className="space-y-2 mb-6">
            {designsState.designs.map((design) => {
              const isBusy = busyId === design.id;
              const isRenaming = renamingId === design.id;
              return (
                <li
                  key={design.id}
                  className="lims-panel flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  {isRenaming ? (
                    <input
                      className="lims-input flex-1 min-w-0"
                      value={renameValue}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                    />
                  ) : (
                    <span className="text-sm text-[var(--text)] flex-1 min-w-0 truncate">{design.name}</span>
                  )}
                  <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
                    v{design.version} &middot; {new Date(design.updated_at).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isRenaming ? (
                      <>
                        <button className="lims-btn lims-btn-secondary" disabled={isBusy} onClick={() => void submitRename(design.id)}>Save</button>
                        <button className="lims-btn lims-btn-ghost" disabled={isBusy} onClick={() => setRenamingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <Link href={`/plates/local?openDesign=${encodeURIComponent(design.id)}`} className="lims-btn lims-btn-secondary">
                          Open
                        </Link>
                        <button
                          className="lims-btn lims-btn-ghost"
                          disabled={isBusy}
                          onClick={() => { setRenamingId(design.id); setRenameValue(design.name); setRowError(null); }}
                        >
                          Rename
                        </button>
                        <button
                          className="lims-btn lims-btn-ghost text-red-600"
                          disabled={isBusy}
                          onClick={() => void deleteDesign(design.id, design.name)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="lims-panel rounded-lg border border-[var(--border)] p-3 flex items-start gap-2">
          <Bot className="w-4 h-4 mt-0.5 text-[var(--text-faint)] shrink-0" />
          <p className="text-xs text-[var(--text-soft)]">
            Assistant is not available yet. It makes no model calls and cannot change any data.
          </p>
        </div>
      </section>
    </div>
  );
}

function Notice({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="lims-surface rounded-xl p-6 max-w-md w-full shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-5 h-5 text-[var(--text-soft)]" />
          <h1 className="text-lg font-semibold text-[var(--text)]">{title}</h1>
        </div>
        <div className="text-sm text-[var(--text)]">{children}</div>
      </div>
    </div>
  );
}
