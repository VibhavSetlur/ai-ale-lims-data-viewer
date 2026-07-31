import { z } from "zod";

/**
 * Faithful port of the legacy /api/library-variants contract (origin/main:
 * src/app/api/library-variants/route.ts). Aggregates verAB_barcodes per
 * (Seqsample, Candidate); abundance is per-sample count fraction. Candidate
 * metadata is joined from Library_candidates when available.
 */

export interface LibraryVariant {
  variantId: string;
  gene?: string;
  library?: string;
  position?: string | number;
  label: string;
  aiGenerated: boolean;
  verAaiGenerated: boolean;
  verBaiGenerated: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

export interface LibraryVariantMeasurement {
  sampleId: string;
  seqsample: string;
  variantId: string;
  abundance: number;
  count: number;
  transfer?: number;
}

export interface LibraryVariantDataset {
  variants: LibraryVariant[];
  measurements: LibraryVariantMeasurement[];
  warnings: string[];
  source: {
    driver: "sqlite" | "mysql";
    barcodeTable: "verAB_barcodes";
    metadataTable?: "Library_candidates";
    countColumn: "Count";
    abundance: "per-sample count fraction";
  };
}

export const libraryVariantsQuerySchema = z.object({
  snapshotId: z.string().min(1),
});

export type LibraryVariantsQuery = z.infer<typeof libraryVariantsQuerySchema>;
