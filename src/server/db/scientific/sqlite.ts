import Database from "better-sqlite3";
import { AppError } from "../../../shared/errors/AppError";
import type { ExportQuery, FacetsQuery, Filter, RowsQuery, RowsResult } from "../../../shared/contracts/catalog";
import { CURRENT_SNAPSHOT_ID } from "../../../modules/snapshots/catalog/repository";
import type { ScientificRepository, TableDescriptor } from "./types";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

function quote(identifier: string): string { return `"${identifier}"`; }
function csv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export class SqliteScientificRepository implements ScientificRepository {
  private readonly db: Database.Database;
  private readonly tables: Map<string, TableDescriptor>;

  public constructor(path: string) {
    try {
      this.db = new Database(path, { readonly: true, fileMustExist: true });
      this.db.pragma("query_only = ON");
      const names = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: unknown }[];
      this.tables = new Map(names.map(({ name }) => {
        if (typeof name !== "string" || !IDENTIFIER.test(name)) throw new AppError("DEPENDENCY_UNAVAILABLE", "Scientific catalog is unavailable.", undefined, { retryable: true });
        const columnInfo = this.db.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: unknown; type: unknown; notnull: unknown }[];
        const columns = columnInfo.map((column) => ({
          key: String(column.name), label: String(column.name), type: String(column.type).toLowerCase().includes("int") || String(column.type).toLowerCase().includes("real") ? "number" as const : "string" as const, nullable: Number(column.notnull) === 0,
        }));
        return [name, { name, columns }];
      }));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Scientific catalog is unavailable.", error, { retryable: true });
    }
  }

  public probe() { this.db.prepare("SELECT 1").get(); return { available: true as const }; }
  public provenance() { return { snapshotId: CURRENT_SNAPSHOT_ID, label: "legacy SQLite", sourceSystem: "SQLite snapshot", sourceRevision: null, sourceSha256: "0".repeat(64), sourceUpdatedAt: null, receivedAt: new Date(0).toISOString(), materializedAt: null, schemaVersion: "legacy", schemaFingerprint: "legacy", manifestDigest: null }; }
  public capabilities() { return { snapshotId: CURRENT_SNAPSHOT_ID, hasBarcodes: this.tables.has("verAB_barcodes"), capabilities: { catalog: { available: true } } }; }
  public listTables() { return [...this.tables.values()]; }

  private table(name: string): TableDescriptor {
    const table = this.tables.get(name);
    if (table === undefined) throw new AppError("NOT_FOUND", "Table not found.");
    return table;
  }
  private column(table: TableDescriptor, name: string): string {
    if (!table.columns.some((column) => column.key === name)) throw new AppError("INVALID_INPUT", "Unknown column.");
    return quote(name);
  }
  private conditions(table: TableDescriptor, query: Pick<RowsQuery, "search" | "where" | "includeDeleted">): { sql: string; values: unknown[] } {
    const parts: string[] = []; const values: unknown[] = [];
    if (!query.includeDeleted && table.columns.some((column) => column.key === "deleted")) parts.push(`${quote("deleted")} = 0`);
    if (query.search) {
      const searchable = table.columns.filter((column) => column.type === "string").map((column) => `CAST(${quote(column.key)} AS TEXT) LIKE ?`);
      if (searchable.length) { parts.push(`(${searchable.join(" OR ")})`); values.push(...searchable.map(() => `%${query.search!.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)); }
    }
    if (query.where) {
      const filters = query.where.filters.map((filter) => this.filter(table, filter, values));
      parts.push(`(${filters.join(query.where.combinator === "and" ? " AND " : " OR ")})`);
    }
    return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", values };
  }
  private filter(table: TableDescriptor, filter: Filter, values: unknown[]): string {
    const column = this.column(table, filter.column);
    if (filter.operator === "isNull") return `${column} IS NULL`;
    if (filter.operator === "isNotNull") return `${column} IS NOT NULL`;
    if (filter.operator === "contains" || filter.operator === "startsWith") { values.push(`${filter.operator === "contains" ? "%" : ""}${String(filter.value).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); return `CAST(${column} AS TEXT) LIKE ? ESCAPE '\\'`; }
    const operator = ({ eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const)[filter.operator];
    values.push(filter.value); return `${column} ${operator} ?`;
  }
  private ordered(table: TableDescriptor, query: RowsQuery): string {
    const sort = query.sort?.map(({ column, direction }) => `${this.column(table, column)} ${direction.toUpperCase()}`) ?? [];
    const tie = table.columns[0]?.key;
    if (tie && !query.sort?.some((item) => item.column === tie)) sort.push(`${quote(tie)} ASC`);
    return sort.length ? ` ORDER BY ${sort.join(", ")}` : "";
  }
  public getRows(query: RowsQuery): RowsResult {
    if (query.snapshotId !== CURRENT_SNAPSHOT_ID) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    if (query.cursor) throw new AppError("INVALID_INPUT", "Cursor pagination is not available for this snapshot.");
    const table = this.table(query.table); const conditions = this.conditions(table, query);
    const totalCount = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${quote(table.name)}${conditions.sql}`).get(...conditions.values) as { count: number }).count);
    const rows = this.db.prepare(`SELECT * FROM ${quote(table.name)}${conditions.sql}${this.ordered(table, query)} LIMIT ?`).all(...conditions.values, query.limit) as Record<string, unknown>[];
    return { columns: table.columns, rows, nextCursor: null, totalCount };
  }
  public getFacets(query: FacetsQuery) {
    if (query.snapshotId !== CURRENT_SNAPSHOT_ID) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    const table = this.table(query.table); const conditions = this.conditions(table, query); const result: Record<string, { value: string | number | boolean | null; count: number }[]> = {};
    for (const name of query.columns) {
      const column = this.column(table, name);
      result[name] = this.db.prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM ${quote(table.name)}${conditions.sql} GROUP BY ${column} ORDER BY count DESC, value ASC LIMIT 100`).all(...conditions.values) as typeof result[string];
    }
    return result;
  }
  public exportRows(query: ExportQuery) {
    const result = this.getRows(query); const table = this.table(query.table);
    const columns = query.columns.map((name) => { this.column(table, name); return table.columns.find((column) => column.key === name)!; });
    const csvText = [columns.map((column) => csv(column.label)).join(","), ...result.rows.map((row) => columns.map((column) => csv(row[column.key])).join(","))].join("\r\n");
    return { columns, csv: csvText };
  }
}
