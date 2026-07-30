import { z } from "zod";

export const capabilityManifestSchema = z.object({
  snapshotId: z.string().trim().min(1).max(128),
  hasBarcodes: z.boolean(),
  capabilities: z.record(z.string(), z.object({ available: z.boolean(), reason: z.string().trim().min(1).max(256).optional() })),
});

export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
