import Database from "better-sqlite3";
import { AppError } from "../../../shared/errors/AppError";
import type { ExportQuery, FacetsQuery, Filter, RowsQuery, RowsResult } from "../../../shared/contracts/catalog";
import type { AnalysisResult, CohortQuery, CohortResult, MutationReadRequest } from "../../../shared/contracts/mutations";
import { deriveCopyNumberComparison, deriveGrowthComparison, deriveLibraryVariants, deriveMutationComparison } from "../../../modules/mutations/derivations";
import { createHash } from "node:crypto";
import { getCurrentSnapshot, CURRENT_SNAPSHOT_ID } from "../../../modules/snapshots/catalog/repository";
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
  public provenance() { const snapshot = getCurrentSnapshot(); const schemaFingerprint = createHash("sha256").update([...this.tables.values()].map((table) => `${table.name}:${table.columns.map((column) => `${column.key}:${column.type}:${column.nullable}`).join(",")}`).join("\\n")).digest("hex"); return { snapshotId: snapshot.snapshotId, label: snapshot.label, sourceSystem: snapshot.sourceSystem, sourceRevision: null, sourceSha256: snapshot.sha256, sourceUpdatedAt: null, receivedAt: snapshot.createdAt, materializedAt: null, schemaVersion: String(snapshot.schemaVersion), schemaFingerprint, manifestDigest: snapshot.manifestDigest }; }
  public capabilities() { const barcodeTable = this.tables.get("verAB_barcodes"); const hasBarcodes = barcodeTable !== undefined && Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${quote(barcodeTable.name)}`).get() as { count: number }).count) > 0; return { snapshotId: CURRENT_SNAPSHOT_ID, hasBarcodes, capabilities: { catalog: { available: true }, barcodes: hasBarcodes ? { available: true } : { available: false, reason: "No barcode records are available in this snapshot." } } }; }
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
  private snapshot(snapshotId: string) { if (snapshotId !== CURRENT_SNAPSHOT_ID) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found."); }
  private has(table: string, ...columns: string[]) { const descriptor = this.tables.get(table); return descriptor !== undefined && columns.every((column) => descriptor.columns.some((item) => item.key === column)); }
  private rows(table: string, columns: string[], where: string, values: unknown[]) { if (!this.has(table, ...columns)) return null; return this.db.prepare(`SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)} WHERE ${where}`).all(...values) as Record<string, unknown>[]; }
  public cohort(query: CohortQuery): CohortResult {
    this.snapshot(query.snapshotId); const warnings: string[] = [];
    const experiments = this.has("Mutations", "Experiment") ? this.db.prepare(`SELECT DISTINCT "Experiment" AS key FROM "Mutations" WHERE "Experiment" IS NOT NULL ORDER BY "Experiment"`).all() : [];
    const registries = this.has("Mutations", "Breseq_registry_ID") ? this.db.prepare(`SELECT DISTINCT "Breseq_registry_ID" AS key FROM "Mutations" WHERE "Breseq_registry_ID" IS NOT NULL ORDER BY "Breseq_registry_ID"`).all() : [];
    const clauses = ["\"Seq_sample\" IS NOT NULL"]; const values: unknown[] = [];
    if (query.experimentKey && this.has("Mutations", "Experiment")) { clauses.push("\"Experiment\" = ?"); values.push(query.experimentKey); }
    if (query.registryKey && this.has("Mutations", "Breseq_registry_ID")) { clauses.push("\"Breseq_registry_ID\" = ?"); values.push(query.registryKey); }
    const samples = this.has("Mutations", "Seq_sample") ? this.db.prepare(`SELECT DISTINCT "Seq_sample" AS key FROM "Mutations" WHERE ${clauses.join(" AND ")} ORDER BY "Seq_sample"`).all(...values) : [];
    if (!this.has("Mutations", "Seq_sample")) warnings.push("Mutation sample records are unavailable in this snapshot.");
    return { experiments, registries, samples, facets: {}, selectedKeyValidity: {}, warnings, capabilities: this.capabilities(), provenance: this.provenance() };
  }
  private analysis(query: MutationReadRequest, kind: "mutations" | "growth" | "library" | "copy"): AnalysisResult {
    this.snapshot(query.snapshotId); const warnings: string[] = []; const caps = this.capabilities(); const placeholders = query.sampleKeys.map(() => "?").join(","); let rows: Record<string, unknown>[] = [];
    if (kind === "mutations" && (!this.has("Mutations", "Experiment") || (query.registryKey && !this.has("Mutations", "Breseq_registry_ID")))) warnings.push("The requested mutation scope is unavailable in this snapshot.");
    if (kind === "mutations") { const scopeAvailable = this.has("Mutations", "Experiment") && (!query.registryKey || this.has("Mutations", "Breseq_registry_ID")); const raw = scopeAvailable ? this.rows("Mutations", ["Seq_sample", "gene_name", "position", "frequency", "type"], `"Seq_sample" IN (${placeholders}) AND "Experiment" = ?${query.registryKey ? " AND \"Breseq_registry_ID\" = ?" : ""}`, [...query.sampleKeys, query.experimentKey, ...(query.registryKey ? [query.registryKey] : [])]) : null; if (!raw) warnings.push("Mutation records with the required columns are unavailable."); else rows = deriveMutationComparison(raw.map((r) => ({ sampleKey: String(r.Seq_sample), gene: r.gene_name == null ? null : String(r.gene_name), position: Number.isFinite(Number(r.position)) ? Number(r.position) : null, frequency: Number.isFinite(Number(r.frequency)) ? Number(r.frequency) : null, type: r.type == null ? null : String(r.type) }))); }
    if (kind === "growth") { const raw = this.rows("Robotic_OD", ["sample_name", "transfer", "od", "timepoint"], `"sample_name" IN (${placeholders}) AND "od" IS NOT NULL`, query.sampleKeys); if (!raw) warnings.push("Growth records are unavailable."); else rows = deriveGrowthComparison(raw.filter((r) => Number.isFinite(Number(r.transfer)) && Number.isFinite(Number(r.od))).map((r) => ({ sampleKey: String(r.sample_name), transfer: Number(r.transfer), od: Number(r.od), timepoint: Number.isFinite(Number(r.timepoint)) ? Number(r.timepoint) : null }))); }
    if (kind === "library") { if (!caps.hasBarcodes) throw new AppError("CAPABILITY_UNAVAILABLE", "Library variants are unavailable because this snapshot has no barcode records."); const raw = this.rows("verAB_barcodes", ["Seqsample", "Candidate", "Count"], `"Seqsample" IN (${placeholders})`, query.sampleKeys); if (!raw) warnings.push("Barcode records with the required columns are unavailable."); else rows = deriveLibraryVariants(raw.filter((r) => Number.isFinite(Number(r.Count))).map((r) => ({ sampleKey: String(r.Seqsample), variant: String(r.Candidate ?? "unassigned"), count: Number(r.Count) }))); }
    if (kind === "copy") { const raw = this.rows("Copy_numbers", ["Seqsample", "Region_name", "Region_CN"], `"Seqsample" IN (${placeholders}) AND "Region_CN" IS NOT NULL`, query.sampleKeys); if (!raw) warnings.push("Copy-number records are unavailable."); else rows = deriveCopyNumberComparison(raw.filter((r) => r.Region_name != null && Number.isFinite(Number(r.Region_CN))).map((r) => ({ sampleKey: String(r.Seqsample), region: String(r.Region_name), value: Number(r.Region_CN) }))); }
    if (!rows.length && !warnings.length) warnings.push("No matching records were found for the selected samples."); return { rows, summary: { resultCount: rows.length, sampleCount: query.sampleKeys.length }, warnings, derivationVersion: "v1", capabilities: caps, provenance: this.provenance() };
  }
  public compareMutations(query: MutationReadRequest) { return this.analysis(query, "mutations"); }
  public compareGrowth(query: MutationReadRequest) { return this.analysis(query, "growth"); }
  public compareLibraryVariants(query: MutationReadRequest) { return this.analysis(query, "library"); }
  public compareCopyNumber(query: MutationReadRequest) { return this.analysis(query, "copy"); }
  public factors(snapshotId: string) { this.snapshot(snapshotId); const warnings: string[] = []; const experiments = this.has("Mutations", "Experiment") ? (this.db.prepare(`SELECT DISTINCT "Experiment" AS value FROM "Mutations" WHERE "Experiment" IS NOT NULL ORDER BY "Experiment"`).all() as { value: string }[]).map((row) => row.value) : []; if (!experiments.length) warnings.push("Experiment factors are unavailable."); return { experiments, factors: { experiment: experiments, media: [], strain: [], transformingDNA: [] }, warnings, provenance: this.provenance() }; }
}
