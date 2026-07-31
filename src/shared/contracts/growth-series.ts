import { z } from "zod";

/**
 * Faithful port of the legacy /api/growth-series contract (origin/main:
 * src/app/api/growth-series/route.ts). OD-vs-transfer growth series keyed by
 * ALE lineage (Robotic_OD.sample_name); one line per replicate. Default
 * aggregation is endpoint OD (reading at max timepoint, contam excluded), with
 * max OD carried so the UI can toggle without a refetch.
 */

export interface GrowthSeriesPoint {
  transfer: number;
  od: number;
  maxOd: number;
}

export interface GrowthSeriesLineage {
  lineageId: string;
  experiment: string;
  genotypeLabel: string;
  replicate?: string;
  condition?: string;
  strain?: string;
  points: GrowthSeriesPoint[];
}

export interface GrowthSeriesDataset {
  aggregation: "endpoint";
  transferRange: { min: number; max: number };
  lineages: GrowthSeriesLineage[];
  warnings: string[];
  source?: {
    driver: "sqlite" | "mysql";
    table: "Robotic_OD";
    rowsScanned: number;
  };
}

export const growthSeriesQuerySchema = z.object({
  snapshotId: z.string().min(1),
  experimentKey: z.string().trim().min(1).optional(),
});

export type GrowthSeriesQuery = z.infer<typeof growthSeriesQuerySchema>;
