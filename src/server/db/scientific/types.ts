import type { CapabilityManifest } from "../../../shared/contracts/capability";
import type { ColumnDescriptor, ExportQuery, FacetsQuery, RowsQuery, RowsResult } from "../../../shared/contracts/catalog";
import type { SnapshotProvenance } from "../../../shared/contracts/provenance";

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
}
