import { z } from "zod";

export const snapshotProvenanceSchema = z.object({
  snapshotId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(256),
  sourceSystem: z.string().trim().min(1).max(256),
  sourceRevision: z.string().trim().min(1).max(256).nullable(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceUpdatedAt: z.string().datetime().nullable(),
  receivedAt: z.string().datetime(),
  materializedAt: z.string().datetime().nullable(),
  schemaVersion: z.string().trim().min(1).max(128),
  schemaFingerprint: z.string().trim().min(1).max(256),
  manifestDigest: z.string().trim().min(1).max(256).nullable(),
});

export type SnapshotProvenance = z.infer<typeof snapshotProvenanceSchema>;
