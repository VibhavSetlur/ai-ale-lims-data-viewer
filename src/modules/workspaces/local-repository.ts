import { createPlateDocument, validatePlateDocument } from "@/modules/plates/document";
import { STORAGE_KEY as LEGACY_KEY } from "@/modules/plates/state";
import type { Snapshot } from "@/modules/plates/types";
import type { LocalWorkspaceStoreV1, LocalWorkspaceV1, StorageResult } from "./contracts";

export const WORKSPACE_STORAGE_KEY = "viewer2.workspaces.v1";
const MAX_WORKSPACES = 25;
const MAX_SNAPSHOTS = 20;
const MAX_TEXT = 160;
const emptyStore = (): LocalWorkspaceStoreV1 => ({ schemaVersion: 1, workspaces: [], migratedLegacyPlate: false });
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_TEXT && !/[\x00-\x1f\x7f]/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && text(value) && !Number.isNaN(Date.parse(value));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const snapshots = (value: unknown): Snapshot[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_SNAPSHOTS) return undefined;
  const parsed: Snapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const snapshot = item as Record<string, unknown>;
    if (!text(snapshot.id) || !text(snapshot.name) || !timestamp(snapshot.savedAt)) return undefined;
    const document = validatePlateDocument(snapshot.document);
    if (!document.document) return undefined;
    parsed.push({ id: String(snapshot.id).trim(), name: String(snapshot.name).trim(), savedAt: String(snapshot.savedAt).trim(), document: document.document });
  }
  return parsed;
};
function parseWorkspace(value: unknown): LocalWorkspaceV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || source.kind !== "plate-design" || !text(source.id) || !text(source.name) || !timestamp(source.createdAt) || !timestamp(source.updatedAt)) return undefined;
  const document = validatePlateDocument(source.document); const saved = snapshots(source.snapshots);
  return document.document && saved ? { schemaVersion: 1, id: String(source.id).trim(), kind: "plate-design", name: String(source.name).trim(), createdAt: String(source.createdAt).trim(), updatedAt: String(source.updatedAt).trim(), document: document.document, snapshots: saved } : undefined;
}
export function parseStore(value: unknown): LocalWorkspaceStoreV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || !Array.isArray(source.workspaces) || source.workspaces.length > MAX_WORKSPACES || typeof source.migratedLegacyPlate !== "boolean") return undefined;
  const ids = new Set<string>(); const workspaces: LocalWorkspaceV1[] = [];
  for (const raw of source.workspaces) { const workspace = parseWorkspace(raw); if (!workspace) continue; if (ids.has(workspace.id)) return undefined; ids.add(workspace.id); workspaces.push(workspace); }
  workspaces.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const activeWorkspaceId = text(source.activeWorkspaceId) && ids.has(String(source.activeWorkspaceId).trim()) ? String(source.activeWorkspaceId).trim() : undefined;
  return { schemaVersion: 1, ...(activeWorkspaceId ? { activeWorkspaceId } : {}), workspaces, migratedLegacyPlate: source.migratedLegacyPlate };
}
export const serializeStore = (store: LocalWorkspaceStoreV1) => JSON.stringify({ ...store, workspaces: [...store.workspaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
const failure = (error: unknown): StorageResult<never> => ({ ok: false, code: error instanceof DOMException && error.name === "QuotaExceededError" ? "STORAGE_QUOTA" : "STORAGE_UNAVAILABLE", message: error instanceof DOMException && error.name === "QuotaExceededError" ? "Browser storage is full. Your changes were not saved." : "Browser storage is unavailable. Your changes were not saved." });
export function loadStore(storage: Storage): StorageResult<LocalWorkspaceStoreV1> {
  let raw: string | null;
  try { raw = storage.getItem(WORKSPACE_STORAGE_KEY); } catch (error) { return failure(error); }
  if (raw !== null) { try { const store = parseStore(JSON.parse(raw)); return store ? { ok: true, value: store } : { ok: false, code: "STORAGE_UNAVAILABLE", message: "Saved workspace data is unreadable. It was not changed." }; } catch { return { ok: false, code: "STORAGE_UNAVAILABLE", message: "Saved workspace data is unreadable. It was not changed." }; } }
  let legacy: string | null;
  try { legacy = storage.getItem(LEGACY_KEY); } catch (error) { return failure(error); }
  const store = emptyStore();
  if (legacy) try { const old = JSON.parse(legacy) as { document?: unknown; snapshots?: unknown }; const document = validatePlateDocument(old.document); const saved = snapshots(old.snapshots); if (document.document && saved) { const now = new Date().toISOString(); const workspace: LocalWorkspaceV1 = { schemaVersion: 1, id: crypto.randomUUID(), kind: "plate-design", name: document.document.name, createdAt: now, updatedAt: now, document: document.document, snapshots: saved }; store.workspaces = [workspace]; store.activeWorkspaceId = workspace.id; } } catch { /* invalid legacy data is retained untouched */ }
  store.migratedLegacyPlate = true;
  return saveStore(storage, store);
}
export function saveStore(storage: Storage, store: LocalWorkspaceStoreV1): StorageResult<LocalWorkspaceStoreV1> { try { storage.setItem(WORKSPACE_STORAGE_KEY, serializeStore(store)); return { ok: true, value: store }; } catch (error) { return failure(error); } }
export function createWorkspace(store: LocalWorkspaceStoreV1, name = "Untitled plate design", document?: LocalWorkspaceV1["document"]): StorageResult<LocalWorkspaceStoreV1> { if (store.workspaces.length >= MAX_WORKSPACES) return { ok: false, code: "STORAGE_QUOTA", message: "A maximum of 25 browser-local workspaces is allowed." }; const now = new Date().toISOString(); const workspace: LocalWorkspaceV1 = { schemaVersion: 1, id: crypto.randomUUID(), kind: "plate-design", name, createdAt: now, updatedAt: now, document: document ?? createPlateDocument(), snapshots: [] }; return { ok: true, value: { ...store, activeWorkspaceId: workspace.id, workspaces: [workspace, ...store.workspaces] } }; }
export const updateWorkspace = (store: LocalWorkspaceStoreV1, workspace: LocalWorkspaceV1): LocalWorkspaceStoreV1 => ({ ...store, activeWorkspaceId: workspace.id, workspaces: [{ ...clone(workspace), updatedAt: new Date().toISOString(), snapshots: workspace.snapshots.slice(0, MAX_SNAPSHOTS) }, ...store.workspaces.filter(item => item.id !== workspace.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
export function duplicateWorkspace(store: LocalWorkspaceStoreV1, id: string): StorageResult<LocalWorkspaceStoreV1> { const source = store.workspaces.find(item => item.id === id); if (!source) return { ok: false, code: "STORAGE_UNAVAILABLE", message: "Workspace was not found." }; return createWorkspace(store, `${source.name} copy`, clone(source.document)); }
export function deleteWorkspace(store: LocalWorkspaceStoreV1, id: string): LocalWorkspaceStoreV1 { const workspaces = store.workspaces.filter(item => item.id !== id); return { ...store, workspaces, activeWorkspaceId: workspaces[0]?.id }; }
