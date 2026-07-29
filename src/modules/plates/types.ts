export const PLATE_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const PLATE_COLUMNS = Array.from({ length: 12 }, (_, index) => index + 1) as number[];
export type WellId = `${(typeof PLATE_ROWS)[number]}${number}`;
export type PlateCondition = { id: string; name: string; color: string; notes?: string };
export type WellAssignment = { conditionId: string; assignedAt: string };
export type PlateDocumentV1 = {
  schemaVersion: 1;
  id: string;
  name: string;
  run: { name: string; notes?: string };
  conditions: PlateCondition[];
  plates: { id: string; label: string; wells: Record<WellId, WellAssignment | null> }[];
  updatedAt: string;
};
export type ValidationError = { path: string; message: string };
export type Snapshot = { id: string; name: string; savedAt: string; document: PlateDocumentV1 };
export type PlateState = { document: PlateDocumentV1; snapshots: Snapshot[]; past: PlateDocumentV1[]; future: PlateDocumentV1[]; notice?: string; error?: string };
