'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Save, FolderOpen, Trash2 } from 'lucide-react';
import { fetchData, IS_STATIC } from '../../lib/dataSource';
import { LOGIN_PATH } from '../../lib/routes';
import { useOpsIdentity } from '../../lib/ops/useOpsIdentity';
import { decideLoad, resolveSaveMode } from '../../lib/ops/dirtyLoad';
import type { PlateDesign } from '../../lib/plateDesign';

type WorkspaceRow = { id: string; name: string };
type DesignSummaryRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  version: number;
  updated_at: string;
};

type CurrentDesign = { id: string; name: string; version: number };
type OpenConfirm = { id: string; name: string; version: number };

const SEARCH_DEBOUNCE_MS = 200;
const SUCCESS_TIMEOUT_MS = 4000;

export default function WorkspaceDesignBar({ design, onOpen, designId }: {
  design: PlateDesign;
  onOpen: (design: PlateDesign) => void;
  designId?: string;
}) {
  const identity = useOpsIdentity();

  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [designs, setDesigns] = useState<DesignSummaryRow[]>([]);
  const [designsLoading, setDesignsLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [selectedDesignId, setSelectedDesignId] = useState('');
  const [current, setCurrent] = useState<CurrentDesign | null>(null);
  const [loadedDesignId, setLoadedDesignId] = useState<string | null>(null);

  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [openConfirm, setOpenConfirm] = useState<OpenConfirm | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const lastSyncedRef = useRef(JSON.stringify(design));
  const openParamHandledRef = useRef(false);

  const refetchDesigns = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // Auto-clear transient success messages.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), SUCCESS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [success]);

  // Debounce the search box.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Load workspaces once signed in.
  useEffect(() => {
    if (identity.state !== 'signedIn') {
      setWorkspaces(null);
      setSelectedWorkspace('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchData('/api/ops/workspaces');
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error?.message || `HTTP ${res.status}`);
          setWorkspaces([]);
          return;
        }
        const rows: WorkspaceRow[] = body?.data?.workspaces ?? [];
        setWorkspaces(rows);
        setSelectedWorkspace((prev) => prev || rows[0]?.id || '');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workspaces.');
          setWorkspaces([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [identity.state]);

  // Load the design list for the selected workspace, filtered by the debounced query.
  useEffect(() => {
    if (identity.state !== 'signedIn' || !selectedWorkspace) {
      setDesigns([]);
      return;
    }
    let cancelled = false;
    setDesignsLoading(true);
    const q = debouncedQuery.trim();
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    fetchData(`/api/ops/workspaces/${encodeURIComponent(selectedWorkspace)}/designs${qs}`)
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error?.message || `HTTP ${res.status}`);
          setDesigns([]);
          return;
        }
        setDesigns(body?.data?.designs ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load designs.');
          setDesigns([]);
        }
      })
      .finally(() => { if (!cancelled) setDesignsLoading(false); });
    return () => { cancelled = true; };
  }, [identity.state, selectedWorkspace, debouncedQuery, refreshNonce]);

  const openDesignById = useCallback(async (id: string, opts?: { confirmed?: boolean }) => {
    setOpening(true);
    setError(null);
    try {
      const res = await fetchData(`/api/ops/designs/${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 404) {
          setError('That design no longer exists.');
          refetchDesigns();
        } else {
          setError(body?.error?.message || `HTTP ${res.status}`);
        }
        return;
      }
      const summary = body?.data?.design as (DesignSummaryRow & { payload: PlateDesign }) | undefined;
      if (!summary) {
        setError('Unexpected response from server.');
        return;
      }
      if (!opts?.confirmed && decideLoad(JSON.stringify(design), lastSyncedRef.current) === 'prompt') {
        setOpenConfirm({ id, name: summary.name, version: summary.version });
        return;
      }
      onOpen(summary.payload);
      lastSyncedRef.current = JSON.stringify(summary.payload);
      setCurrent({ id: summary.id, name: summary.name, version: summary.version });
      setLoadedDesignId(summary.id);
      setSelectedDesignId(summary.id);
      setOpenConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open failed.');
    } finally {
      setOpening(false);
    }
  }, [design, onOpen, refetchDesigns]);

  // Handle ?openDesign=<id> once, after we know whether the user is signed in.
  useEffect(() => {
    if (openParamHandledRef.current) return;
    if (identity.state === 'loading') return;
    openParamHandledRef.current = true;
    if (identity.state !== 'signedIn' || typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('openDesign');
    if (id) void openDesignById(id);
  }, [identity.state, openDesignById]);

  if (identity.state === 'loading') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
        <div className="h-7 w-28 rounded-md bg-[var(--border)] animate-pulse" />
        <div className="h-7 w-40 rounded-md bg-[var(--border)] animate-pulse" />
        <div className="h-7 w-24 rounded-md bg-[var(--border)] animate-pulse" />
      </div>
    );
  }

  if (identity.state === 'unavailable') {
    return (
      <p className="mt-2 text-xs text-[var(--text-soft)]">
        {IS_STATIC ? 'Workspace save is not available in this build.' : 'Workspace save is not set up on this instance.'}
      </p>
    );
  }

  if (identity.state === 'signedOut') {
    return (
      <p className="mt-2 text-xs text-[var(--text-soft)]">
        Sign in to save this design to a workspace. <Link href={LOGIN_PATH} className="underline">Sign in</Link>
      </p>
    );
  }

  if (!workspaces) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
        <div className="h-7 w-40 rounded-md bg-[var(--border)] animate-pulse" />
      </div>
    );
  }

  if (workspaces.length === 0) {
    return <p className="mt-2 text-xs text-[var(--text-soft)]">Create a workspace under User Workspace to save this design there.</p>;
  }

  const selectedRow = designs.find((d) => d.id === selectedDesignId) ?? null;

  async function runUpdate(): Promise<boolean> {
    if (!loadedDesignId) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchData(`/api/ops/designs/${encodeURIComponent(loadedDesignId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ design }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 404) {
          setLoadedDesignId(null);
          setError('That design no longer exists.');
        } else {
          setError(body?.error?.message || `HTTP ${res.status}`);
        }
        return false;
      }
      const saved = body?.data?.design as DesignSummaryRow | undefined;
      if (saved) setCurrent({ id: saved.id, name: saved.name, version: saved.version });
      lastSyncedRef.current = JSON.stringify(design);
      setSuccess('Design updated.');
      refetchDesigns();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runSaveAs(name: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetchData(`/api/ops/workspaces/${encodeURIComponent(selectedWorkspace)}/designs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, design }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message || `HTTP ${res.status}`);
        return false;
      }
      const saved = body?.data?.design as DesignSummaryRow | undefined;
      if (saved) {
        setLoadedDesignId(saved.id);
        setCurrent({ id: saved.id, name: saved.name, version: saved.version });
        setSelectedDesignId(saved.id);
      }
      lastSyncedRef.current = JSON.stringify(design);
      setSaveName('');
      setSuccess(`Saved as "${name}".`);
      refetchDesigns();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleSaveAsClick() {
    const name = saveName.trim();
    if (!name || name.length > 120) {
      setError('Type a name (1-120 characters) to save as.');
      return;
    }
    setError(null);
    void runSaveAs(name);
  }

  async function handleDirtyPromptSave() {
    if (!openConfirm) return;
    const mode = resolveSaveMode('save', loadedDesignId, saveName);
    if (mode === 'blocked') {
      setError('Type a name for your draft before saving it.');
      return;
    }
    const saved = mode === 'update' ? await runUpdate() : await runSaveAs(saveName.trim());
    if (!saved) return;
    await openDesignById(openConfirm.id, { confirmed: true });
  }

  function handleDirtyPromptDiscard() {
    if (!openConfirm) return;
    void openDesignById(openConfirm.id, { confirmed: true });
  }

  function startRename() {
    if (!selectedRow) return;
    setRenameValue(selectedRow.name);
    setRenaming(true);
    setError(null);
  }

  async function submitRename() {
    if (!selectedRow) return;
    const name = renameValue.trim();
    if (!name || name.length > 120) {
      setError('Design name must be 1-120 characters.');
      return;
    }
    setRenameBusy(true);
    setError(null);
    try {
      const res = await fetchData(`/api/ops/designs/${encodeURIComponent(selectedRow.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) {
          setError(`A design named "${name}" already exists in this workspace.`);
        } else if (res.status === 400) {
          setError('Design name must be 1-120 characters.');
        } else {
          setError(body?.error?.message || `HTTP ${res.status}`);
        }
        return;
      }
      const saved = body?.data?.design as DesignSummaryRow | undefined;
      if (saved && current?.id === saved.id) {
        setCurrent({ id: saved.id, name: saved.name, version: saved.version });
      }
      setRenaming(false);
      setSuccess(`Renamed to "${name}".`);
      refetchDesigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed.');
    } finally {
      setRenameBusy(false);
    }
  }

  function startDelete() {
    if (!selectedRow) return;
    setDeleteInput('');
    setDeleteConfirming(true);
    setError(null);
  }

  async function confirmDelete() {
    if (!selectedRow) return;
    const targetId = selectedRow.id;
    const targetName = selectedRow.name;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetchData(`/api/ops/designs/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      if (res.status === 404) {
        setError('That design no longer exists.');
        setSelectedDesignId('');
        if (current?.id === targetId) setCurrent(null);
        if (loadedDesignId === targetId) setLoadedDesignId(null);
        setDeleteConfirming(false);
        refetchDesigns();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setSelectedDesignId('');
      if (current?.id === targetId) setCurrent(null);
      if (loadedDesignId === targetId) setLoadedDesignId(null);
      setDeleteConfirming(false);
      setSuccess(`Deleted "${targetName}".`);
      refetchDesigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
      <span className="lims-label">Workspace</span>
      <select
        className="lims-select"
        value={selectedWorkspace}
        onChange={(e) => {
          setSelectedWorkspace(e.target.value);
          setSelectedDesignId('');
          setCurrent(null);
          setLoadedDesignId(null);
        }}
      >
        {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
      </select>

      <input
        className="lims-input w-40"
        aria-label="Search saved designs"
        placeholder="Search designs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {designsLoading ? (
        <span className="text-xs text-[var(--text-soft)]">Loading&hellip;</span>
      ) : designs.length === 0 ? (
        <span className="text-xs text-[var(--text-soft)]">
          {debouncedQuery.trim() ? `No designs match "${debouncedQuery.trim()}"` : 'No saved designs yet'}
        </span>
      ) : (
        <select
          className="lims-select"
          value={selectedDesignId}
          onChange={(e) => setSelectedDesignId(e.target.value)}
        >
          <option value="">Open saved design&hellip;</option>
          {designs.map((d) => <option key={d.id} value={d.id}>{d.name} (v{d.version})</option>)}
        </select>
      )}
      <button
        className="lims-btn lims-btn-secondary inline-flex items-center gap-1.5"
        disabled={!selectedDesignId || opening}
        onClick={() => selectedDesignId && void openDesignById(selectedDesignId)}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Open
      </button>

      <input
        className="lims-input w-40"
        placeholder={design.runName || 'Design name'}
        value={saveName}
        maxLength={120}
        onChange={(e) => setSaveName(e.target.value)}
      />
      <button
        className="lims-btn lims-btn-secondary inline-flex items-center gap-1.5"
        disabled={!loadedDesignId || saving}
        onClick={() => void runUpdate()}
      >
        <Save className="h-3.5 w-3.5" />
        Update
      </button>
      <button className="lims-btn lims-btn-ghost" disabled={saving} onClick={handleSaveAsClick}>
        Save as&hellip;
      </button>

      {selectedRow && !renaming && (
        <button className="lims-btn lims-btn-ghost" onClick={startRename}>Rename</button>
      )}
      {selectedRow && (
        <button className="lims-btn lims-btn-ghost inline-flex items-center gap-1.5" onClick={startDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      )}

      {renaming && selectedRow && (
        <span className="flex items-center gap-1.5">
          <input
            className="lims-input w-40"
            value={renameValue}
            maxLength={120}
            onChange={(e) => setRenameValue(e.target.value)}
          />
          <button className="lims-btn lims-btn-secondary" disabled={renameBusy} onClick={() => void submitRename()}>Rename</button>
          <button className="lims-btn lims-btn-ghost" disabled={renameBusy} onClick={() => setRenaming(false)}>Cancel</button>
        </span>
      )}

      {openConfirm && (
        <span role="alertdialog" aria-label="Unsaved changes" className="flex items-center gap-1.5 text-xs text-[var(--text-soft)]">
          You have unsaved changes. Save them before loading &quot;{openConfirm.name}&quot;?
          <button
            className="lims-btn lims-btn-secondary"
            disabled={opening || saving}
            onClick={() => void handleDirtyPromptSave()}
          >
            Save
          </button>
          <button className="lims-btn lims-btn-ghost" disabled={opening || saving} onClick={handleDirtyPromptDiscard}>Discard</button>
          <button className="lims-btn lims-btn-ghost" disabled={opening || saving} onClick={() => setOpenConfirm(null)}>Cancel</button>
        </span>
      )}

      {deleteConfirming && selectedRow && (
        <span role="alertdialog" aria-label="Confirm delete" className="flex items-center gap-1.5 text-xs text-[var(--text-soft)]">
          Type the design name to delete it permanently. <code>{selectedRow.name}</code>
          <input
            className="lims-input w-40"
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
          />
          <button
            className="lims-btn lims-btn-ghost text-red-600"
            disabled={deleting || deleteInput.trim() !== selectedRow.name}
            onClick={() => void confirmDelete()}
          >
            Delete permanently
          </button>
          <button className="lims-btn lims-btn-ghost" disabled={deleting} onClick={() => setDeleteConfirming(false)}>Cancel</button>
        </span>
      )}

      {current && <span className="text-xs text-[var(--text-faint)]">Saved as {current.name} (v{current.version})</span>}
      {designId && <span className="text-xs text-[var(--text-faint)]">Viewing local label {designId}</span>}
      {success && <span className="text-xs text-emerald-700">{success}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
