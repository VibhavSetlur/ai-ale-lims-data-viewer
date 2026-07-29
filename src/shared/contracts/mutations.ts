import { z } from "zod";
import { capabilityManifestSchema } from "./capability";
import { snapshotProvenanceSchema } from "./provenance";

const identifier = z.string().trim().min(1).max(128);

export const mutationReadRequestSchema = z.object({
  snapshotId: identifier,
  experimentKey: identifier,
  registryKey: identifier.optional(),
  sampleKeys: z.array(identifier).min(1).max(500),
});

export const cohortResultSchema = z.object({
  experiments: z.array(z.unknown()),
  registries: z.array(z.unknown()),
  samples: z.array(z.unknown()),
  facets: z.record(z.string(), z.unknown()),
  selectedKeyValidity: z.record(z.string(), z.boolean()),
  capabilities: capabilityManifestSchema,
  provenance: snapshotProvenanceSchema,
});

export type MutationReadRequest = z.infer<typeof mutationReadRequestSchema>;
export type CohortResult = z.infer<typeof cohortResultSchema>;
