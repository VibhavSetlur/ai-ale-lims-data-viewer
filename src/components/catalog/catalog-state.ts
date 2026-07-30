import type { ColumnDescriptor, Filter, RowsQuery } from "@/shared/contracts/catalog";

export const pageSize = 100;
export const firstPageCursor = "";
export const noValue = (operator: Filter["operator"]) => operator === "isNull" || operator === "isNotNull";
export const filterLabel = (filter: Filter) => `${filter.column} ${filter.operator}${filter.value === undefined ? "" : ` ${String(filter.value)}`}`;
export const schemaDescription = (column: ColumnDescriptor) => `${column.key} · ${column.type} · ${column.nullable ? "nullable" : "required"}`;
export const rowsQuery = (table: string, snapshotId: string, state: Pick<RowsQuery, "search" | "where" | "sort" | "includeDeleted" | "cursor">): RowsQuery => ({ snapshotId, table, limit: pageSize, ...state });
