export type SnapshotStatus = "metadata-fixture";
export type SnapshotAudience = "development";

export interface SnapshotCapabilities {
  hasBarcodes: boolean;
}

export interface SnapshotTableCounts {
  mutations: number;
  seqSamples: number;
  samples: number;
  experiments: number;
  dnaConstructs: number;
  strains: number;
  verABBarcodes: number;
}

interface SnapshotMetadata {
  snapshotId: string;
  label: string;
  sourceSystem: string;
  sha256: string;
  fileSizeBytes: number;
  fileMtime: string;
  sourceUpdatedAt: string;
  schemaVersion: number;
  schemaFingerprint: null;
  tableCount: number;
  tableCounts: SnapshotTableCounts;
  capabilities: SnapshotCapabilities;
  status: SnapshotStatus;
  audience: SnapshotAudience;
  createdAt: string;
  manifestDigest: null;
  materializationStatus: "planned";
  publicationStatus: "planned";
}

export interface SnapshotCatalogRecord extends SnapshotMetadata {
  sourcePath: string;
}

export interface PublicSnapshotCatalogRecord extends SnapshotMetadata {}

export interface SnapshotList {
  snapshots: PublicSnapshotCatalogRecord[];
  defaultSnapshotId: string;
}
