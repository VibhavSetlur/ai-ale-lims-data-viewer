"use client";
/* eslint-disable react-hooks/set-state-in-effect -- route resolution starts after browser-only storage hydration. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorkspace, loadStore, saveStore } from "@/modules/workspaces/local-repository";

export default function PlatesPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    const loaded = loadStore(window.localStorage);
    // loadStore returns a usable store even on a soft failure (unreadable data
    // is backed up and replaced with an empty store), so fall back to that
    // value instead of dead-ending on the error.
    const store = loaded.ok ? loaded.value : loaded.value;
    if (!store) {
      setError(loaded.ok ? "" : loaded.message);
      return;
    }
    const existing =
      store.workspaces.find((workspace) => workspace.id === store.activeWorkspaceId) ??
      store.workspaces[0];
    if (existing) {
      router.replace(`/plates/${existing.id}`);
      return;
    }
    const next = createWorkspace(store);
    if (!next.ok) return setError(next.message);
    const saved = saveStore(window.localStorage, next.value);
    if (!saved.ok) return setError(saved.message);
    router.replace(`/plates/${next.value.activeWorkspaceId}`);
  }, [router]);
  return error ? <p role="alert">{error}</p> : <p>Opening browser-local workspace...</p>;
}
