export interface CapabilityManifest {
  snapshotId: string;
  hasBarcodes: boolean;
  capabilities: Readonly<Record<string, boolean>>;
}
