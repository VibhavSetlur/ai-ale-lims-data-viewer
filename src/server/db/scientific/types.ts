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

type Async<T> = T | Promise<T>;

export interface ScientificRepository {
  probe(): Async<{ available: true }>;
  provenance(): Async<SnapshotProvenance>;
  capabilities(): Async<CapabilityManifest>;
  listTables(): Async<TableDescriptor[]>;
  getRows(query: RowsQuery): Async<RowsResult>;
  getFacets(query: FacetsQuery): Async<Record<string, FacetValue[]>>;
  exportRows(query: ExportQuery): Async<{ columns: ColumnDescriptor[]; csv: string }>;
  cohort(query: CohortQuery): Async<CohortResult>;
  compareMutations(query: MutationReadRequest): Async<AnalysisResult>;
  compareGrowth(query: MutationReadRequest): Async<AnalysisResult>;
  compareLibraryVariants(query: MutationReadRequest): Async<AnalysisResult>;
  compareCopyNumber(query: MutationReadRequest): Async<AnalysisResult>;
  factors(snapshotId: string): Async<{ experiments: string[]; factors: Record<string, string[]>; warnings: string[]; provenance: SnapshotProvenance }>;
}
