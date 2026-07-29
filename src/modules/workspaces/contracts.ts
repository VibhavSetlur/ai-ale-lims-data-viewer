import type { PlateDocumentV1, Snapshot } from "@/modules/plates/types";

export type LocalWorkspaceV1 = { schemaVersion: 1; id: string; kind: "plate-design"; name: string; createdAt: string; updatedAt: string; document: PlateDocumentV1; snapshots: Snapshot[] };
export type LocalWorkspaceStoreV1 = { schemaVersion: 1; activeWorkspaceId?: string; workspaces: LocalWorkspaceV1[]; migratedLegacyPlate: boolean };
export type StorageFailure = { ok: false; code: "STORAGE_UNAVAILABLE" | "STORAGE_QUOTA"; message: string };
export type StorageSuccess<T> = { ok: true; value: T };
export type StorageResult<T> = StorageSuccess<T> | StorageFailure;
