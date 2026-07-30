export const COHORT_SELECTION_STORAGE_KEY = "viewer2.research-cohort.v1";
const MAX_SAMPLE_KEYS = 500;

export type CohortSelection = {
  schemaVersion: 1;
  snapshotId: string;
  experimentKey: string;
  registryKey?: string;
  sampleKeys: string[];
};

type StorageResult = { ok: true; value?: CohortSelection } | { ok: false; message: string };

const identifier = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 128 && !/[\x00-\x1f\x7f]/.test(value);

export function parseCohortSelection(value: unknown): CohortSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || !identifier(source.snapshotId) || !identifier(source.experimentKey) || !Array.isArray(source.sampleKeys) || source.sampleKeys.length > MAX_SAMPLE_KEYS) return undefined;
  if (source.registryKey !== undefined && !identifier(source.registryKey)) return undefined;
  const sampleKeys = source.sampleKeys.map(key => typeof key === "string" ? key.trim() : "");
  if (sampleKeys.some(key => !identifier(key)) || new Set(sampleKeys).size !== sampleKeys.length) return undefined;
  return { schemaVersion: 1, snapshotId: source.snapshotId.trim(), experimentKey: source.experimentKey.trim(), ...(source.registryKey ? { registryKey: String(source.registryKey).trim() } : {}), sampleKeys };
}

export function loadCohortSelection(storage: Storage, snapshotId: string): StorageResult {
  try {
    const raw = storage.getItem(COHORT_SELECTION_STORAGE_KEY);
    if (!raw) return { ok: true };
    const selection = parseCohortSelection(JSON.parse(raw));
    return selection?.snapshotId === snapshotId ? { ok: true, value: selection } : { ok: true };
  } catch {
    return { ok: false, message: "Saved cohort selection could not be read. It was not changed." };
  }
}

export function saveCohortSelection(storage: Storage, selection: CohortSelection): StorageResult {
  if (!parseCohortSelection(selection)) return { ok: false, message: "Cohort selection is invalid and was not saved." };
  try { storage.setItem(COHORT_SELECTION_STORAGE_KEY, JSON.stringify(selection)); return { ok: true, value: selection }; }
  catch { return { ok: false, message: "Browser storage is unavailable. Cohort selection remains available for this page." }; }
}

export function validateCohortSelection(selection: CohortSelection | undefined, available: { experiments: { key: string }[]; registries: { key: string }[]; samples: { key: string }[] }): CohortSelection | undefined {
  if (!selection || !available.experiments.some(item => item.key === selection.experimentKey)) return undefined;
  if (selection.registryKey && !available.registries.some(item => item.key === selection.registryKey)) return undefined;
  const sampleSet = new Set(available.samples.map(item => item.key));
  const sampleKeys = selection.sampleKeys.filter(key => sampleSet.has(key));
  return { ...selection, sampleKeys };
}
