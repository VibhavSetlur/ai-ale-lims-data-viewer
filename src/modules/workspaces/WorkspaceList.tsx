"use client";
/* eslint-disable react-hooks/set-state-in-effect -- localStorage hydration initializes client-only catalog state. */
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Button,
  InlineNotice,
  Metric,
  PageHeader,
  Panel,
  SectionHeader,
  Toolbar,
} from "@/components/design-system/Primitives";
import {
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  loadStore,
  renameWorkspace,
  saveStore,
} from "./local-repository";
import type { LocalWorkspaceStoreV1 } from "./contracts";

export function WorkspaceList() {
  const [store, setStore] = useState<LocalWorkspaceStoreV1>();
  const [error, setError] = useState("");
  const load = () => {
    const result = loadStore(window.localStorage);
    if (result.ok) setStore(result.value);
    else {
      setStore(result.value);
      setError(result.message);
    }
  };
  useEffect(() => {
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "viewer2.workspaces.v1") load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const persist = (next: LocalWorkspaceStoreV1) => {
    const saved = saveStore(window.localStorage, next);
    if (saved.ok) setStore(saved.value);
    else setError(saved.message);
  };
  const create = () => {
    if (!store) return;
    const next = createWorkspace(store);
    if (!next.ok) return setError(next.message);
    persist(next.value);
  };
  const rename = (id: string, current: string) => {
    if (!store) return;
    const name = prompt("Workspace name", current);
    if (name === null) return;
    const next = renameWorkspace(store, id, name);
    if (!next.ok) return setError(next.message);
    persist(next.value);
  };
  const duplicate = (id: string) => {
    if (!store) return;
    const next = duplicateWorkspace(store, id);
    if (!next.ok) return setError(next.message);
    persist(next.value);
  };
  const remove = (id: string) => {
    if (!store || !confirm("Delete this browser-local workspace?")) return;
    persist(deleteWorkspace(store, id));
  };
  const count = store?.workspaces.length ?? 0;
  return (
    <section aria-labelledby="workspaces-title">
      <PageHeader eyebrow="BROWSER-LOCAL" title="Saved / Local workspaces">
        <p id="workspaces-title" className="lede">
          Browser-local only. These plate drafts never write to LIMS and remain
          available only in this browser.
        </p>
      </PageHeader>
      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
      <Toolbar>
        <Button onClick={create} disabled={!store}>
          Create workspace
        </Button>
        <Metric
          label="Local workspaces"
          value={count}
          detail="Stored in this browser"
        />
      </Toolbar>
      {!store && (
        <p className="empty-state" aria-live="polite">
          Loading browser-local workspaces…
        </p>
      )}
      {store && !count && (
        <Panel>
          <SectionHeader
            eyebrow="GET STARTED"
            title="No local workspaces yet"
          />
          <p>
            Create a workspace to begin a 96-well plate design. Export JSON to
            move a draft safely to another browser.
          </p>
          <Button onClick={create}>Create first workspace</Button>
        </Panel>
      )}
      <div className="workspace-list">
        {store?.workspaces.map((workspace) => (
          <Panel key={workspace.id} className="workspace-card">
            <SectionHeader eyebrow="LOCAL DRAFT" title={workspace.name}>
              <Link className="text-link" href={`/plates/${workspace.id}`}>
                Open design
              </Link>
            </SectionHeader>
            <p className="muted">
              Updated {new Date(workspace.document.updatedAt).toLocaleString()}{" "}
              · {workspace.document.plates.length} plate
              {workspace.document.plates.length === 1 ? "" : "s"}
            </p>
            <Toolbar>
              <Button
                variant="secondary"
                onClick={() => rename(workspace.id, workspace.name)}
              >
                Rename
              </Button>
              <Button
                variant="secondary"
                onClick={() => duplicate(workspace.id)}
              >
                Duplicate
              </Button>
              <Button variant="quiet" onClick={() => remove(workspace.id)}>
                Delete
              </Button>
            </Toolbar>
          </Panel>
        ))}
      </div>
    </section>
  );
}
