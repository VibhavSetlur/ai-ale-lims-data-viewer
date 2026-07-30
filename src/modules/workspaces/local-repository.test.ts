import { describe, expect, it } from "vitest";
import { WORKSPACE_STORAGE_KEY, createWorkspace, duplicateWorkspace, loadStore, parseStore, renameWorkspace, saveStore, serializeStore } from "./local-repository";

const storage = (initial: Record<string, string> = {}): Storage => {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: key => void data.delete(key), clear: () => data.clear(), key: index => [...data.keys()][index] ?? null, get length() { return data.size; } };
};

describe("local workspace repository", () => {
  it("recovers with an empty usable store without replacing unreadable new-key data", () => {
    const local = storage({ [WORKSPACE_STORAGE_KEY]: "not json" });
    const result = loadStore(local);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.value?.workspaces).toEqual([]);
    expect(local.getItem(WORKSPACE_STORAGE_KEY)).toBe("not json");
  });

  it("drops malformed records but rejects duplicate IDs", () => {
    const base = { schemaVersion: 1, migratedLegacyPlate: false, workspaces: [{ invalid: true }] };
    expect(parseStore(base)?.workspaces).toEqual([]);
    const created = createWorkspace(parseStore(base)!);
    expect(created.ok).toBe(true);
    if (created.ok) {
      const validWorkspace = { ...created.value.workspaces[0], document: { ...created.value.workspaces[0].document, run: { name: "Run" } } };
      const duplicateIds = { ...created.value, workspaces: [validWorkspace, validWorkspace] };
      expect(parseStore(duplicateIds)).toBeUndefined();
      expect(loadStore(storage({ [WORKSPACE_STORAGE_KEY]: JSON.stringify(duplicateIds) })).ok).toBe(false);
      expect(serializeStore(created.value)).toContain(created.value.workspaces[0].id);
    }
  });

  it("renames and duplicates through validated persistence", () => {
    const local = storage(); const initial = loadStore(local); expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const created = createWorkspace(initial.value, "Original"); expect(created.ok).toBe(true);
    if (!created.ok) return;
    const renamed = renameWorkspace(created.value, created.value.workspaces[0].id, "Renamed"); expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const duplicate = duplicateWorkspace(renamed.value, renamed.value.workspaces[0].id); expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(saveStore(local, duplicate.value).ok).toBe(true);
  });
});
