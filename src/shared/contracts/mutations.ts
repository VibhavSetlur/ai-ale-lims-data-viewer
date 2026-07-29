import { z } from "zod";
import { capabilityManifestSchema } from "./capability";
import { snapshotProvenanceSchema } from "./provenance";

const identifier = z.string().trim().min(1).max(128);
export const mutationReadRequestSchema = z.object({ snapshotId: identifier, experimentKey: identifier, registryKey: identifier.optional(), sampleKeys: z.array(identifier).min(1).max(500) });
export const cohortQuerySchema = z.object({ snapshotId: identifier, experimentKey: identifier.optional(), registryKey: identifier.optional() });
export const mutationComparisonRequestSchema = mutationReadRequestSchema.extend({ minimumFrequency: z.number().min(0).max(1).optional() });
export const analysisResultSchema = z.object({ rows: z.array(z.record(z.string(), z.unknown())), summary: z.record(z.string(), z.unknown()), warnings: z.array(z.string()), derivationVersion: z.literal("v1"), capabilities: capabilityManifestSchema, provenance: snapshotProvenanceSchema });
export const cohortResultSchema = z.object({ experiments: z.array(z.unknown()), registries: z.array(z.unknown()), samples: z.array(z.unknown()), facets: z.record(z.string(), z.unknown()), selectedKeyValidity: z.record(z.string(), z.boolean()), warnings: z.array(z.string()), capabilities: capabilityManifestSchema, provenance: snapshotProvenanceSchema });
export type MutationReadRequest = z.infer<typeof mutationReadRequestSchema>;
export type CohortQuery = z.infer<typeof cohortQuerySchema>;
export type CohortResult = z.infer<typeof cohortResultSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
