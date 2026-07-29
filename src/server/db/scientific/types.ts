import type { CapabilityManifest } from "../../../shared/contracts/capability";
import type { ColumnDescriptor, ExportQuery, FacetsQuery, RowsQuery, RowsResult } from "../../../shared/contracts/catalog";
import type { SnapshotProvenance } from "../../../shared/contracts/provenance";
import type { AnalysisResult, CohortQuery, CohortResult, MutationReadRequest } from "../../../shared/contracts/mutations";

export interface TableDescriptor {
  name: string;
  columns: ColumnDescriptor[];
}

export interface FacetValue {
  value: string | number | boolean | null;
  count: number;
}

export interface ScientificRepository {
  probe(): { available: true };
  provenance(): SnapshotProvenance;
  capabilities(): CapabilityManifest;
  listTables(): TableDescriptor[];
  getRows(query: RowsQuery): RowsResult;
  getFacets(query: FacetsQuery): Record<string, FacetValue[]>;
  exportRows(query: ExportQuery): { columns: ColumnDescriptor[]; csv: string };
  cohort(query: CohortQuery): CohortResult;
  compareMutations(query: MutationReadRequest): AnalysisResult;
  compareGrowth(query: MutationReadRequest): AnalysisResult;
  compareLibraryVariants(query: MutationReadRequest): AnalysisResult;
  compareCopyNumber(query: MutationReadRequest): AnalysisResult;
  factors(snapshotId: string): { experiments: string[]; factors: Record<string, string[]>; warnings: string[]; provenance: SnapshotProvenance };
}
