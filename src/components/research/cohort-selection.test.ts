import { describe, expect, it } from "vitest";
import { COHORT_SELECTION_STORAGE_KEY, loadCohortSelection, parseCohortSelection, saveCohortSelection, validateCohortSelection } from "./cohort-selection";

const selection = { schemaVersion: 1 as const, snapshotId: "snapshot-1", experimentKey: "experiment-1", registryKey: "registry-1", sampleKeys: ["sample-1", "sample-2"] };
const available = { experiments: [{ key: "experiment-1" }], registries: [{ key: "registry-1" }], samples: [{ key: "sample-1" }] };
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) } as Storage; };

describe("cohort selection persistence", () => {
  it("validates and persists a versioned snapshot-scoped selection", () => { const browser = storage(); expect(saveCohortSelection(browser, selection)).toMatchObject({ ok: true }); expect(loadCohortSelection(browser, "snapshot-1")).toMatchObject({ ok: true, value: selection }); expect(loadCohortSelection(browser, "snapshot-2")).toEqual({ ok: true }); });
  it("rejects malformed or duplicate stored keys", () => { expect(parseCohortSelection({ ...selection, sampleKeys: ["sample-1", "sample-1"] })).toBeUndefined(); const browser = storage(); browser.setItem(COHORT_SELECTION_STORAGE_KEY, "not json"); expect(loadCohortSelection(browser, "snapshot-1")).toMatchObject({ ok: false }); });
  it("removes samples no longer supplied by the snapshot while preserving valid scope", () => expect(validateCohortSelection(selection, available)).toEqual({ ...selection, sampleKeys: ["sample-1"] }));
});
