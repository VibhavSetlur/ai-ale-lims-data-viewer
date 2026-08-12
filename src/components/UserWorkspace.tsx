'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BriefcaseBusiness, LogIn, LogOut, AlertTriangle, Plus } from 'lucide-react';
import { fetchData, IS_STATIC } from '../lib/dataSource';
import { workspacePath, LOGIN_PATH } from '../lib/routes';

type WorkspaceRow = { id: string; name: string; created_at: string; updated_at: string };
type MeResponse = { authenticated: boolean; user?: { orcid: string; displayName: string | null } };

type LoadState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; user: { orcid: string; displayName: string | null }; workspaces: WorkspaceRow[] };

export default function UserWorkspace() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const meRes = await fetchData('/api/auth/me');
      const meBody: { data?: MeResponse } = await meRes.json().catch(() => ({}));
      if (!meBody.data?.authenticated) {
        setState({ phase: 'unauthenticated' });
        return;
      }
      const wsRes = await fetchData('/api/ops/workspaces');
      const wsBody = await wsRes.json();
      if (!wsRes.ok) {
        setState({ phase: 'error', message: wsBody?.error?.message || `HTTP ${wsRes.status}` });
        return;
      }
      setState({ phase: 'ready', user: meBody.data.user!, workspaces: wsBody.data.workspaces });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  useEffect(() => {
    if (IS_STATIC) return;
    load();
  }, []);

  async function handleSignOut() {
    await fetchData('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setState({ phase: 'unauthenticated' });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || name.length > 120) {
      setCreateError('Name must be 1-120 characters.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetchData('/api/ops/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(body?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setNewName('');
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  }

  if (IS_STATIC) {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-[var(--ink-300)]" />
        <h1 className="text-lg font-semibold text-[var(--text)]">User Workspace</h1>
        <p>Not available in this build. Workspaces require the server-mode viewer.</p>
      </Shell>
    );
  }

  if (state.phase === 'loading') {
    return (
      <Shell>
        <BriefcaseBusiness className="w-10 h-10 text-[var(--ink-300)]" />
        <h1 className="text-lg font-semibold text-[var(--text)]">User Workspace</h1>
        <p>Loading&hellip;</p>
      </Shell>
    );
  }

  if (state.phase === 'unauthenticated') {
    return (
      <Shell>
        <BriefcaseBusiness className="w-10 h-10 text-[var(--ink-300)]" />
        <h1 className="text-lg font-semibold text-[var(--text)]">User Workspace</h1>
        <p>Sign in with ORCID to create a personal workspace for saved plate designs.</p>
        <Link href={LOGIN_PATH} className="lims-btn lims-btn-primary inline-flex items-center gap-2 mt-2">
          <LogIn className="w-4 h-4" />
          Sign in
        </Link>
      </Shell>
    );
  }

  if (state.phase === 'error') {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-[var(--ink-300)]" />
        <h1 className="text-lg font-semibold text-[var(--text)]">User Workspace</h1>
        <p>{state.message}</p>
      </Shell>
    );
  }

  const { user, workspaces } = state;
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)] p-3">
      <section className="lims-surface min-h-full rounded-xl p-4 shadow-sm">
        <header className="border-b border-[var(--border)] pb-3 mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text)]">User Workspace</h1>
            <p className="text-xs text-[var(--text-soft)] mt-1">
              Signed in as ORCID {user.orcid}{user.displayName ? ` (${user.displayName})` : ''}
            </p>
          </div>
          <button onClick={handleSignOut} className="lims-btn lims-btn-secondary inline-flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </header>

        <h2 className="lims-label mb-2">Your workspaces</h2>
        {workspaces.length === 0 ? (
          <p className="text-sm text-[var(--text-soft)] mb-4">
            No workspaces yet. A workspace holds your saved plate designs. Create one below.
          </p>
        ) : (
          <ul className="space-y-2 mb-4">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <Link
                  href={workspacePath(ws.id)}
                  className="lims-panel flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-3)] transition-colors"
                >
                  <span className="text-sm text-[var(--text)]">{ws.name}</span>
                  <span className="text-xs text-[var(--text-faint)]">{new Date(ws.updated_at).toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreate} className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1">
            <label htmlFor="ws-name" className="lims-label">New workspace name</label>
            <input
              id="ws-name"
              className="lims-input"
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. My ALE runs"
            />
          </div>
          <button type="submit" disabled={creating} className="lims-btn lims-btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create
          </button>
        </form>
        {createError && <p className="text-xs text-red-600 mt-2">{createError}</p>}
      </section>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--surface)] rounded-lg border border-[var(--border)] text-[var(--text-soft)] text-sm gap-2" style={{ boxShadow: 'var(--shadow-sm)' }}>
      {children}
    </div>
  );
}
