import type { CapabilityManifest } from "@/shared/contracts/capability";
import type { SnapshotProvenance } from "@/shared/contracts/provenance";

export const mockCapabilities: CapabilityManifest = {
  snapshotId: "mock-read-only-20260729", hasBarcodes: false,
  capabilities: { barcodes: { available: false, reason: "Barcode records are not included in this read-only preview." } },
};

export const mockProvenance: SnapshotProvenance = {
  snapshotId: "mock-read-only-20260729", label: "Read-only route preview", sourceSystem: "Mock scientific service", sourceRevision: null,
  sourceSha256: "0000000000000000000000000000000000000000000000000000000000000000", sourceUpdatedAt: null,
  receivedAt: "2026-07-29T00:00:00.000Z", materializedAt: null, schemaVersion: "preview-1", schemaFingerprint: "mock-route-shell", manifestDigest: null,
};

export const mockTables = [
  { name: "experiments", description: "Experiment metadata and source identifiers.", rows: 12 },
  { name: "samples", description: "Sample-level research records.", rows: 48 },
  { name: "mutations", description: "Observed mutation annotations.", rows: 126 },
];

export function tablePreview(tableName: string) {
  return mockTables.find((table) => table.name === tableName);
}
