import { z } from "zod";

/**
 * Faithful port of the legacy /api/mutations dataset contract (origin/main:
 * src/app/api/mutations/route.ts). The ported MutationExplorer consumes this
 * shape verbatim; only the transport (now /api/v1/mutations/dataset) changed.
 */

export interface MutationSample {
  id: string;
  name: string;
  experiment: string;
  experiment_type?: string;
  seqorder?: string;
  seqorders?: string[];
  replicate?: string;
  transfer?: number;
  condition?: string;
  strain?: string;
  donor_dna?: string;
  has_barcodes?: boolean;
  verab_combinations?: number;
  selection_note?: string;
  growth_curve?: { t: number; od: number }[];
  growth_curve_source?: {
    table: "Robotic_OD";
    sample_name: string;
    transfer: number;
    points: number;
  };
  od_sources?: { type: string; source: string }[];
}

export interface MutationDetail {
  seq_id?: string;
  position_start?: number;
  position_end?: number;
  ref_seq?: string;
  new_seq?: string;
  gene_strand?: string;
  gene_position?: string;
  locus_tag?: string;
  aa_ref_seq?: string;
  aa_new_seq?: string;
  aa_position?: number;
  codon_ref_seq?: string;
  codon_new_seq?: string;
  codon_number?: number;
  size?: string;
  repeat_seq?: string;
  repeat_ref_copies?: number;
  repeat_new_copies?: number;
  genes_inactivated?: string;
  genes_overlapping?: string;
  genes_promoter?: string;
}

export interface MutationRow {
  id: string;
  gene: string;
  variant: string;
  type: string;
  metric: "frequency" | "copy_number" | string;
  values: Record<string, number>;
  snp_type?: string;
  mutation_category?: string;
  base_type?: string;
  position?: number;
  gene_product?: string;
  providedIn?: string[];
  detail?: MutationDetail;
}

export interface RegistrySummary {
  id: string;
  count: number;
  polymorphism_frequency_cutoff: number | null;
  limit_fold_coverage: number | null;
  reference: string | null;
  unregistered?: boolean;
}

export interface MutationDataset {
  samples: MutationSample[];
  mutations: MutationRow[];
  experiments: string[];
  registries?: RegistrySummary[];
  selectedRegistry?: string | null;
  warnings?: string[];
  source?: { driver: "sqlite" | "mysql"; table: string; rowsScanned: number };
  stats?: {
    sampleCount: number;
    mutationRowCount: number;
    frequencyRowCount: number;
    cnRegionCount: number;
    cnSampleCount: number;
    curveCount: number;
    hasBarcodes: boolean;
  };
}

export const mutationDatasetQuerySchema = z.object({
  snapshotId: z.string().min(1),
  experimentKey: z.string().trim().min(1).optional(),
  registryKey: z.string().trim().min(1).optional(),
});

export type MutationDatasetQuery = z.infer<typeof mutationDatasetQuerySchema>;
