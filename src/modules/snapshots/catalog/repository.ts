import { AppError } from "../../../shared/errors/AppError";
import type { PublicSnapshotCatalogRecord, SnapshotCatalogRecord, SnapshotList } from "./types";

const DEV_FULL_SNAPSHOT: SnapshotCatalogRecord = {
  snapshotId: "dev-full-20260726-a86df340",
  label: "dev-full",
  sourceSystem: "NSpAHR / Natascha Spahr",
  sourcePath: "data/lims_indexed.db",
  sha256: "a86df34081b2eb2ee583227aa9e45cda32ff58d9e87d17ff68ccc2aaf866f347",
  fileSizeBytes: 267169792,
  fileMtime: "2026-07-26T19:45:03.734Z",
  sourceUpdatedAt: "2026-07-23T15:52:51.530330",
  schemaVersion: 0,
  schemaFingerprint: null,
  tableCount: 27,
  tableCounts: {
    mutations: 264466,
    seqSamples: 2177,
    samples: 1258,
    experiments: 52,
    dnaConstructs: 149,
    strains: 1112,
    verABBarcodes: 10047,
  },
  capabilities: { hasBarcodes: true },
  status: "metadata-fixture",
  audience: "development",
  createdAt: "2026-07-29T00:00:00.000Z",
  manifestDigest: null,
  materializationStatus: "planned",
  publicationStatus: "planned",
};

const snapshots = [DEV_FULL_SNAPSHOT];

function toPublic(record: SnapshotCatalogRecord): PublicSnapshotCatalogRecord {
  const { sourcePath: _sourcePath, ...publicRecord } = record;
  return publicRecord;
}

export function listSnapshots(): SnapshotList {
  return {
    snapshots: snapshots.map(toPublic),
    defaultSnapshotId: DEV_FULL_SNAPSHOT.snapshotId,
  };
}

export function getCurrentSnapshot(): PublicSnapshotCatalogRecord {
  return toPublic(DEV_FULL_SNAPSHOT);
}

export function getSnapshot(snapshotId: string): PublicSnapshotCatalogRecord {
  const snapshot = snapshots.find((candidate) => candidate.snapshotId === snapshotId);
  if (snapshot === undefined) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
  return toPublic(snapshot);
}
