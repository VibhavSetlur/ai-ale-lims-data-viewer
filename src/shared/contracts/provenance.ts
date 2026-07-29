export type SnapshotSource =
  | { status: "known"; sourceName: string; sourceRevision: string; receivedAt: string }
  | { status: "unknown" };

export interface SnapshotProvenance {
  snapshotId: string;
  source: SnapshotSource;
  materializedAt: string | null;
}
