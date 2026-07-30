"use client";

/**
 * CatalogBrowser.tsx -- Phase B1 catalog implementation
 * Owns: CatalogTableList, CatalogTable
 * Consumes: apiClient (POST rows/facets/export), Phase A design-system primitives
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  ProvenanceBadge,
  Skeleton,
  Toolbar,
} from "@/components/design-system/Primitives";
import type {
  ColumnDescriptor,
  Filter,
  FilterGroup,
  RowsResult,
} from "@/shared/contracts/catalog";
import { isStaticExport } from "@/lib/static-data";
import { apiClient } from "@/lib/api-client";
import { pageSize } from "./catalog-state";

// ─── Types ───────────────────────────────────────────────────────────────────

type TableDescriptor = { name: string; columns: ColumnDescriptor[] };
type Snapshot = {
  snapshotId: string;
  label: string;
  sourceSystem: string;
  sourceUpdatedAt: string | null;
};
type SortDir = "asc" | "desc";
type SortEntry = { column: string; direction: SortDir };
type Operator = Filter["operator"];

const OPERATORS: Operator[] = [
  "eq", "neq", "contains", "startsWith",
  "gt", "gte", "lt", "lte",
  "isNull", "isNotNull",
];

const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "=", neq: "≠", contains: "contains", startsWith: "starts with",
  gt: ">", gte: "≥", lt: "<", lte: "≤",
  isNull: "is null", isNotNull: "is not null",
};

function noValue(op: Operator) { return op === "isNull" || op === "isNotNull"; }

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ─── Toast system (local, scope-only) ────────────────────────────────────────

type ToastItem = { id: number; message: string; variant: "error" | "warning" | "info" };
let toastSeq = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, variant: ToastItem["variant"] = "info") => {
    const id = ++toastSeq;
    setToasts(prev => [...prev, { id, message, variant }]);
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  }, []);
  return { toasts, push };
}

function ToastRegion({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.variant}`}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ─── CatalogTableList ─────────────────────────────────────────────────────────

export function CatalogTableList() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tables, setTables] = useState<TableDescriptor[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const curRes = await apiClient.current();
      if (!curRes.ok) { setError(curRes.error.message); return; }
      const cur = curRes.data as Snapshot;
      setSnapshot(cur);
      const tRes = await apiClient.tables(cur.snapshotId);
      if (!tRes.ok) { setError(tRes.error.message); return; }
      setTables((tRes.data as { tables: TableDescriptor[] }).tables);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isStaticExport) return;
    void load();
  }, [load]);

  const visible = useMemo(
    () => tables.filter(t =>
      t.name.toLowerCase().includes(search.trim().toLowerCase())
    ),
    [tables, search]
  );

  if (isStaticExport) {
    return (
      <main id="main-content" style={{ padding: "var(--space-8) var(--space-6)" }}>
        <InlineNotice tone="info">
          Raw table browsing requires the live server. This static build does not include
          pre-baked table snapshots. Visit the server deployment to browse tables.
        </InlineNotice>
      </main>
    );
  }

  return (
    <main id="main-content" style={{ padding: "var(--space-8) var(--space-6)" }}>
      {/* Page header */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700, marginBottom: "var(--space-1)", color: "var(--color-ink)" }}>
          Database tables
        </h1>
        {snapshot && (
          <p style={{ color: "var(--color-ink-secondary)", fontSize: "var(--text-sm)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <ProvenanceBadge label={snapshot.sourceSystem} />
            <span>Snapshot <strong>{snapshot.snapshotId}</strong></span>
            {snapshot.sourceUpdatedAt && (
              <span>· updated {new Date(snapshot.sourceUpdatedAt).toLocaleDateString()}</span>
            )}
          </p>
        )}
      </div>

      {/* Search */}
      <div style={{ marginBottom: "var(--space-5)" }}>
        <input
          className="text-input"
          type="search"
          placeholder="Search tables..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search tables"
          style={{ maxWidth: "360px", width: "100%" }}
        />
      </div>

      {/* States */}
      {loading && (
        <div aria-live="polite" aria-busy>
          <LoadingState rows={6} label="Loading tables..." />
        </div>
      )}
      {!loading && error && (
        <ErrorState message={error} onRetry={load} />
      )}
      {!loading && !error && tables.length > 0 && visible.length === 0 && (
        <EmptyState
          title="No tables match"
          description={`No tables match "${search}". Try a different search term.`}
          action={<Button variant="ghost" size="sm" onClick={() => setSearch("")}>Clear search</Button>}
        />
      )}
      {!loading && !error && tables.length === 0 && (
        <EmptyState title="No tables available" description="The catalog returned no tables for this snapshot." />
      )}

      {/* Table grid */}
      {!loading && !error && visible.length > 0 && (
        <div
          role="list"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--space-4)",
          }}
        >
          {visible.map(table => (
            <Link
              key={table.name}
              href={`/tables/${encodeURIComponent(table.name)}`}
              role="listitem"
              style={{ textDecoration: "none" }}
            >
              <div
                className="panel"
                style={{
                  padding: "var(--space-4)",
                  cursor: "pointer",
                  borderRadius: "var(--radius-md)",
                  transition: "box-shadow var(--motion-fast)",
                  outline: "none",
                }}
                data-testid={`table-card-${table.name}`}
              >
                <p style={{
                  fontWeight: 600,
                  fontSize: "var(--text-base)",
                  color: "var(--color-ink)",
                  marginBottom: "var(--space-1)",
                  fontFamily: "var(--font-mono)",
                }}>
                  {table.name}
                </p>
                <p style={{ color: "var(--color-ink-tertiary)", fontSize: "var(--text-xs)" }}>
                  {table.columns.length} column{table.columns.length !== 1 ? "s" : ""}
                </p>
                <div style={{ marginTop: "var(--space-2)", display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                  {table.columns.slice(0, 4).map(col => (
                    <Badge key={col.key} variant="neutral">{col.key}</Badge>
                  ))}
                  {table.columns.length > 4 && (
                    <Badge variant="neutral">+{table.columns.length - 4}</Badge>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

// ─── Filter builder row ───────────────────────────────────────────────────────

type FilterRowProps = {
  filter: Filter & { _id: number };
  columns: ColumnDescriptor[];
  onChange: (f: Filter & { _id: number }) => void;
  onRemove: () => void;
  addRef?: React.RefObject<HTMLButtonElement | null>;
};

function FilterRow({ filter, columns, onChange, onRemove }: FilterRowProps) {
  const handleChange = <K extends keyof Filter>(key: K, value: Filter[K]) => {
    const next = { ...filter, [key]: value };
    if (noValue(next.operator)) delete (next as Partial<Filter>).value;
    onChange(next);
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      flexWrap: "wrap",
      padding: "var(--space-2) 0",
    }}>
      {/* Column */}
      <select
        className="select-input"
        value={filter.column}
        onChange={e => handleChange("column", e.target.value)}
        aria-label="Filter column"
        style={{ minWidth: "140px" }}
      >
        {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>

      {/* Operator */}
      <select
        className="select-input"
        value={filter.operator}
        onChange={e => handleChange("operator", e.target.value as Operator)}
        aria-label="Filter operator"
      >
        {OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
      </select>

      {/* Value */}
      {!noValue(filter.operator) && (
        <input
          className="text-input"
          type="text"
          value={filter.value === undefined ? "" : String(filter.value)}
          onChange={e => handleChange("value", e.target.value)}
          placeholder="value"
          aria-label="Filter value"
          style={{ minWidth: "120px" }}
        />
      )}

      <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove this filter">
        Remove
      </Button>
    </div>
  );
}

// ─── CatalogFilters ───────────────────────────────────────────────────────────

type FilterState = { combinator: "and" | "or"; rows: (Filter & { _id: number })[] };

type CatalogFiltersProps = {
  columns: ColumnDescriptor[];
  filters: FilterState;
  onChange: (f: FilterState) => void;
};

export function CatalogFilters({ columns, filters, onChange }: Readonly<CatalogFiltersProps>) {
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const nextId = useRef(filters.rows.length + 1);

  const addFilter = () => {
    const id = nextId.current++;
    const col = columns[0];
    onChange({
      ...filters,
      rows: [...filters.rows, { _id: id, column: col?.key ?? "", operator: "eq", value: "" }],
    });
    // Focus management: after React re-renders, move focus to add button
    window.setTimeout(() => {
      addBtnRef.current?.focus();
    }, 50);
  };

  const updateFilter = (idx: number, f: Filter & { _id: number }) => {
    const rows = [...filters.rows];
    rows[idx] = f;
    onChange({ ...filters, rows });
  };

  const removeFilter = (idx: number) => {
    const rows = filters.rows.filter((_, i) => i !== idx);
    onChange({ ...filters, rows });
  };

  if (columns.length === 0) return null;

  return (
    <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
      {/* Combinator */}
      {filters.rows.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-secondary)" }}>Match</span>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
            <input
              type="radio"
              name="combinator"
              value="and"
              checked={filters.combinator === "and"}
              onChange={() => onChange({ ...filters, combinator: "and" })}
            />
            <span style={{ fontSize: "var(--text-sm)" }}>All (AND)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer" }}>
            <input
              type="radio"
              name="combinator"
              value="or"
              checked={filters.combinator === "or"}
              onChange={() => onChange({ ...filters, combinator: "or" })}
            />
            <span style={{ fontSize: "var(--text-sm)" }}>Any (OR)</span>
          </label>
        </div>
      )}

      {/* Filter rows */}
      {filters.rows.map((row, idx) => (
        <FilterRow
          key={row._id}
          filter={row}
          columns={columns}
          onChange={f => updateFilter(idx, f)}
          onRemove={() => removeFilter(idx)}
        />
      ))}

      <button
        ref={addBtnRef}
        type="button"
        className="button button-ghost button-sm"
        onClick={addFilter}
        style={{ marginTop: "var(--space-2)" }}
      >
        + Add filter
      </button>
    </div>
  );
}

// ─── CatalogFacets ────────────────────────────────────────────────────────────

type FacetData = Record<string, { value: string | number | boolean | null; count: number }[]>;

type CatalogFacetsProps = {
  facets: FacetData;
  columns: ColumnDescriptor[];
  onApplyFacet: (column: string, value: string) => void;
};

export function CatalogFacets({ facets, columns, onApplyFacet }: Readonly<CatalogFacetsProps>) {
  const cols = columns.filter(c => facets[c.key]?.length > 0);
  if (cols.length === 0) {
    return (
      <div style={{ padding: "var(--space-3)", color: "var(--color-ink-tertiary)", fontSize: "var(--text-sm)" }}>
        No facets available
      </div>
    );
  }

  return (
    <div style={{ padding: "var(--space-3)", maxHeight: "400px", overflowY: "auto" }}>
      {cols.map(col => (
        <div key={col.key} style={{ marginBottom: "var(--space-4)" }}>
          <p style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            color: "var(--color-ink-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "var(--space-1)",
          }}>
            {col.label}
          </p>
          {facets[col.key].slice(0, 10).map((item, i) => (
            <button
              key={i}
              onClick={() => onApplyFacet(col.key, displayValue(item.value))}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "var(--space-1) var(--space-2)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                fontSize: "var(--text-sm)",
                color: "var(--color-accent)",
                gap: "var(--space-4)",
                outline: "none",
              }}
              aria-label={`Filter ${col.label} = ${displayValue(item.value)} (${item.count})`}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayValue(item.value)}
              </span>
              <span style={{
                flexShrink: 0,
                fontSize: "var(--text-xs)",
                color: "var(--color-ink-tertiary)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {item.count}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── ColumnPicker ─────────────────────────────────────────────────────────────

type ColumnPickerProps = {
  columns: ColumnDescriptor[];
  visible: Set<string>;
  onChange: (visible: Set<string>) => void;
};

export function ColumnPicker({ columns, visible, onChange }: Readonly<ColumnPickerProps>) {
  const toggle = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) {
      if (next.size <= 1) return; // must keep at least one
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  const showAll = () => onChange(new Set(columns.map(c => c.key)));
  const showNone = () => onChange(new Set([columns[0]?.key ?? ""]));

  return (
    <div style={{ padding: "var(--space-3)", minWidth: "200px", maxHeight: "400px", overflowY: "auto" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <button
          onClick={showAll}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-xs)",
            color: "var(--color-accent)", padding: 0,
          }}
        >
          All
        </button>
        <span style={{ color: "var(--color-ink-tertiary)" }}>·</span>
        <button
          onClick={showNone}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-xs)",
            color: "var(--color-accent)", padding: 0,
          }}
        >
          None
        </button>
      </div>
      {columns.map(col => (
        <label
          key={col.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-1) 0",
            cursor: "pointer",
            fontSize: "var(--text-sm)",
          }}
        >
          <input
            type="checkbox"
            checked={visible.has(col.key)}
            onChange={() => toggle(col.key)}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{col.key}</span>
          {col.nullable && (
            <span style={{ color: "var(--color-ink-tertiary)", fontSize: "var(--text-xs)" }}>?</span>
          )}
        </label>
      ))}
    </div>
  );
}

// ─── RecordDrawer ─────────────────────────────────────────────────────────────

type RecordDrawerProps = {
  open: boolean;
  onClose: () => void;
  record: Record<string, unknown> | null;
  columns: ColumnDescriptor[];
  tableName: string;
};

export function RecordDrawer({ open, onClose, record, columns, tableName }: Readonly<RecordDrawerProps>) {
  return (
    <Drawer open={open} onClose={onClose} title={tableName} side="right">
      {record ? (
        <div style={{ padding: "var(--space-5)", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }} aria-label="Record fields">
            <caption style={{ position: "absolute", left: "-9999px" }}>
              Record from {tableName}
            </caption>
            <tbody>
              {columns.map(col => (
                <tr key={col.key} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th
                    scope="row"
                    style={{
                      padding: "var(--space-2) var(--space-3) var(--space-2) 0",
                      fontWeight: 600,
                      fontSize: "var(--text-xs)",
                      color: "var(--color-ink-secondary)",
                      fontFamily: "var(--font-mono)",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      verticalAlign: "top",
                      width: "40%",
                    }}
                  >
                    {col.key}
                  </th>
                  <td
                    style={{
                      padding: "var(--space-2) 0",
                      fontSize: "var(--text-sm)",
                      color: record[col.key] === null ? "var(--color-ink-tertiary)" : "var(--color-ink)",
                      wordBreak: "break-word",
                    }}
                  >
                    {displayValue(record[col.key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "var(--space-5)" }}>
          <Skeleton />
        </div>
      )}
    </Drawer>
  );
}

// ─── ExportDialog ─────────────────────────────────────────────────────────────

type ExportDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
  columns: ColumnDescriptor[];
  visibleColumns: Set<string>;
  filterSummary: string;
};

export function ExportDialog({
  open,
  onClose,
  onConfirm,
  loading,
  filterSummary,
}: Readonly<ExportDialogProps>) {
  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div className="dialog-panel">
        <div className="dialog-header">
          <h2 className="dialog-title" id="export-dialog-title">Export CSV</h2>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="Close dialog">x</button>
        </div>
        <div className="dialog-body">
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-secondary)", marginBottom: "var(--space-3)" }}>
            Export visible columns with current filters applied. Exports are limited to 10,000 rows.
          </p>
          {filterSummary && (
            <div style={{
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-surface-sunken)",
              fontSize: "var(--text-xs)",
              color: "var(--color-ink-secondary)",
              fontFamily: "var(--font-mono)",
              marginBottom: "var(--space-3)",
            }}>
              {filterSummary}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={onConfirm} loading={loading} disabled={loading}>
            {loading ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── CatalogTable (main table workspace) ─────────────────────────────────────

type TableState = {
  search: string;
  filters: FilterState;
  sort: SortEntry[];
  includeDeleted: boolean;
  cursor: string | null;
};

function buildFiltersActive(filters: FilterState): boolean {
  return filters.rows.length > 0 && filters.rows.every(r => r.column && r.operator);
}

function buildWhereClause(filters: FilterState): { combinator: "and" | "or"; filters: Filter[] } | undefined {
  const valid = filters.rows.filter(r => {
    if (!r.column || !r.operator) return false;
    if (!noValue(r.operator) && (r.value === undefined || r.value === "")) return false;
    return true;
  });
  if (valid.length === 0) return undefined;
  return {
    combinator: filters.combinator,
    filters: valid.map(({ column, operator, value }) => {
      const f: Filter = { column, operator };
      if (!noValue(operator)) f.value = value as string;
      return f;
    }),
  };
}

function filterSummaryText(filters: FilterState): string {
  const valid = filters.rows.filter(r => r.column && r.operator);
  if (valid.length === 0) return "";
  return valid
    .map(r => `${r.column} ${OPERATOR_LABELS[r.operator]}${noValue(r.operator) ? "" : ` ${String(r.value ?? "")}`}`)
    .join(` ${filters.combinator.toUpperCase()} `);
}

export function CatalogTable({ table }: Readonly<{ table: string }>) {
  const decodedTable = decodeURIComponent(table);

  // ── Snapshot / schema state ──────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [columns, setColumns] = useState<ColumnDescriptor[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());

  // ── Rows state ───────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rowsError, setRowsError] = useState("");
  const [schemaError, setSchemaError] = useState("");

  // ── Filter state ─────────────────────────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>({
    combinator: "and",
    rows: [],
  });

  // ── Facets state ─────────────────────────────────────────────────────────
  const [showFacets, setShowFacets] = useState(false);
  const [facets, setFacets] = useState<FacetData>({});
  const [facetsLoading, setFacetsLoading] = useState(false);

  // ── Column picker state ──────────────────────────────────────────────────
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // ── Query controls ───────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);

  // ── Record drawer ─────────────────────────────────────────────────────────
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastFocusedRowRef = useRef<HTMLTableRowElement | null>(null);

  // ── Export state ─────────────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // ── Toast ────────────────────────────────────────────────────────────────
  const { toasts, push: pushToast } = useToast();

  // ── Load schema ───────────────────────────────────────────────────────────
  const loadSchema = useCallback(async () => {
    setSchemaError("");
    const curRes = await apiClient.current();
    if (!curRes.ok) { setSchemaError(curRes.error.message); return null; }
    const cur = curRes.data as Snapshot;
    setSnapshot(cur);
    const tRes = await apiClient.tables(cur.snapshotId);
    if (!tRes.ok) { setSchemaError(tRes.error.message); return null; }
    const allTables = (tRes.data as { tables: TableDescriptor[] }).tables;
    const found = allTables.find(t => t.name === decodedTable);
    if (!found) { setSchemaError(`Table "${decodedTable}" not found.`); return null; }
    setColumns(found.columns);
    setVisibleColumns(new Set(found.columns.map(c => c.key)));
    return cur;
  }, [decodedTable]);

  // ── Load rows ─────────────────────────────────────────────────────────────
  const loadRows = useCallback(async (snap: Snapshot, state: TableState, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setRowsError("");

    const where = buildWhereClause(state.filters);
    const query = {
      snapshotId: snap.snapshotId,
      table: decodedTable,
      limit: pageSize,
      ...(state.search.trim() ? { search: state.search.trim() } : {}),
      ...(where ? { where } : {}),
      ...(state.sort.length ? { sort: state.sort } : {}),
      ...(state.includeDeleted ? { includeDeleted: true } : {}),
      ...(state.cursor ? { cursor: state.cursor } : {}),
    };

    const res = await apiClient.rows(query);
    if (!append) setLoading(false);
    else setLoadingMore(false);

    if (!res.ok) {
      if (res.error.code === "SNAPSHOT_NOT_FOUND") {
        setRowsError("Snapshot not found. The data may have been updated. Please go back and reload.");
      } else {
        setRowsError(res.error.message);
      }
      return;
    }

    const result = res.data as RowsResult;
    if (!append) {
      setRows(result.rows);
    } else {
      setRows(prev => [...prev, ...result.rows]);
    }
    setNextCursor(result.nextCursor);
    setTotalCount(result.totalCount);
  }, [decodedTable]);

  // ── Load facets ────────────────────────────────────────────────────────────
  const loadFacets = useCallback(async (snap: Snapshot, cols: ColumnDescriptor[], state: TableState) => {
    setFacetsLoading(true);
    const facetCols = cols
      .filter(c => c.type === "string" || c.type === "boolean")
      .slice(0, 20)
      .map(c => c.key);
    if (!facetCols.length) { setFacetsLoading(false); return; }

    const where = buildWhereClause(state.filters);
    const query = {
      snapshotId: snap.snapshotId,
      table: decodedTable,
      columns: facetCols,
      ...(state.search.trim() ? { search: state.search.trim() } : {}),
      ...(where ? { where } : {}),
      ...(state.includeDeleted ? { includeDeleted: true } : {}),
    };

    const res = await apiClient.facets(query);
    setFacetsLoading(false);
    if (res.ok) setFacets(res.data as FacetData);
  }, [decodedTable]);

  // ── Initial boot ──────────────────────────────────────────────────────────
  const [bootDone, setBootDone] = useState(false);
  const snapRef = useRef<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await loadSchema();
      if (!snap || cancelled) return;
      snapRef.current = snap;
      const state: TableState = { search: "", filters: { combinator: "and", rows: [] }, sort: [], includeDeleted: false, cursor: null };
      await loadRows(snap, state);
      setBootDone(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-query on filter/search/sort/includeDeleted change ─────────────────
  const prevStateRef = useRef({ search: "", filterState, includeDeleted: false });

  useEffect(() => {
    if (!bootDone || !snapRef.current) return;
    const prev = prevStateRef.current;
    const changed =
      prev.search !== search ||
      prev.filterState !== filterState ||
      prev.includeDeleted !== includeDeleted;
    if (!changed) return;
    prevStateRef.current = { search, filterState, includeDeleted };
    const state: TableState = { search, filters: filterState, sort: [], includeDeleted, cursor: null };
    void loadRows(snapRef.current, state);
  }, [search, filterState, includeDeleted, bootDone, loadRows]);

  // ── Load more ─────────────────────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (!snapRef.current || !nextCursor) return;
    const state: TableState = { search, filters: filterState, sort: [], includeDeleted, cursor: nextCursor };
    void loadRows(snapRef.current, state, true);
  }, [search, filterState, includeDeleted, nextCursor, loadRows]);

  // ── Toggle facets panel ───────────────────────────────────────────────────
  const toggleFacets = useCallback(() => {
    setShowFacets(prev => {
      const next = !prev;
      if (next && snapRef.current && columns.length > 0) {
        const state: TableState = { search, filters: filterState, sort: [], includeDeleted, cursor: null };
        void loadFacets(snapRef.current, columns, state);
      }
      return next;
    });
  }, [search, filterState, includeDeleted, columns, loadFacets]);

  // ── Apply facet as filter ─────────────────────────────────────────────────
  const applyFacet = useCallback((column: string, value: string) => {
    const existing = filterState.rows.find(r => r.column === column && r.operator === "eq" && String(r.value) === value);
    if (existing) return;
    const id = Date.now();
    setFilterState(prev => ({
      ...prev,
      rows: [...prev.rows, { _id: id, column, operator: "eq", value }],
    }));
    setShowFilters(true);
    setShowFacets(false);
  }, [filterState.rows]);

  // ── Row click/keyboard ────────────────────────────────────────────────────
  const openRecord = useCallback((record: Record<string, unknown>, rowEl: HTMLTableRowElement) => {
    lastFocusedRowRef.current = rowEl;
    setSelectedRecord(record);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedRecord(null);
    // Drawer already restores focus via triggerRef
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!snapRef.current) return;
    setExportLoading(true);
    const colKeys = columns.filter(c => visibleColumns.has(c.key)).map(c => c.key);
    const where = buildWhereClause(filterState);
    const query = {
      snapshotId: snapRef.current.snapshotId,
      table: decodedTable,
      limit: 10000,
      columns: colKeys.length ? colKeys : columns.map(c => c.key),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(where ? { where } : {}),
      ...(includeDeleted ? { includeDeleted: true } : {}),
    };

    const res = await apiClient.export(query);
    setExportLoading(false);

    if (!res.ok) {
      if (res.error.code === "LIMIT_EXCEEDED") {
        pushToast("Export exceeds 10,000 rows. Narrow filters and retry.", "error");
      } else {
        pushToast(`Export failed: ${res.error.message}`, "error");
      }
      setShowExport(false);
      return;
    }

    const data = res.data as { columns: string[]; csv: string };
    const blob = new Blob([data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${decodedTable}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  }, [snapRef, columns, visibleColumns, filterState, search, includeDeleted, decodedTable, pushToast]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const visibleCols = useMemo(
    () => columns.filter(c => visibleColumns.has(c.key)),
    [columns, visibleColumns]
  );
  const hasActiveFilters = buildFiltersActive(filterState) || !!search.trim();
  const filterSummary = filterSummaryText(filterState);

  const clearFilters = useCallback(() => {
    setFilterState({ combinator: "and", rows: [] });
    setSearch("");
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  if (isStaticExport) {
    return (
      <main id="main-content" style={{ padding: "var(--space-8) var(--space-6)" }}>
        <InlineNotice tone="info">
          Raw table browsing and CSV export require the live server. This static build does not
          support the database table browser. Visit the server deployment to browse tables.
        </InlineNotice>
      </main>
    );
  }

  return (
    <main id="main-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ToastRegion toasts={toasts} />

      {/* Breadcrumb + title */}
      <div style={{ padding: "var(--space-5) var(--space-6) var(--space-3)", borderBottom: "1px solid var(--color-border)" }}>
        <nav aria-label="Breadcrumb" style={{ marginBottom: "var(--space-1)" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-tertiary)" }}>
            <Link href="/tables" style={{ color: "var(--color-accent)", textDecoration: "none" }}>
              Tables
            </Link>
            {" / "}
            <span style={{ color: "var(--color-ink)" }}>{decodedTable}</span>
          </span>
        </nav>
        {snapshot && (
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-tertiary)" }}>
            Snapshot <ProvenanceBadge label={snapshot.snapshotId} />
            {totalCount !== null && (
              <span style={{ marginLeft: "var(--space-2)" }}>
                · <strong style={{ fontVariantNumeric: "tabular-nums" }}>{totalCount.toLocaleString()}</strong> row{totalCount !== 1 ? "s" : ""}
                {hasActiveFilters && " (filtered)"}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Toolbar */}
      <Toolbar style={{ padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {/* Search */}
        <input
          className="text-input"
          type="search"
          placeholder="Full-text search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search rows"
          style={{ minWidth: "220px", flex: "0 1 260px" }}
        />

        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
          {/* Filter toggle */}
          <Button
            variant={showFilters ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            aria-pressed={showFilters}
            aria-expanded={showFilters}
          >
            Filters{filterState.rows.length > 0 ? ` (${filterState.rows.length})` : ""}
          </Button>

          {/* Facets toggle */}
          <Button
            variant={showFacets ? "secondary" : "ghost"}
            size="sm"
            onClick={toggleFacets}
            aria-pressed={showFacets}
          >
            Facets
          </Button>

          {/* Columns picker */}
          <div style={{ position: "relative" }}>
            <Button
              variant={showColumnPicker ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              aria-pressed={showColumnPicker}
              aria-expanded={showColumnPicker}
            >
              Columns ({visibleColumns.size}/{columns.length})
            </Button>
            {showColumnPicker && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + var(--space-1))",
                  right: 0,
                  zIndex: 40,
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-overlay)",
                }}
              >
                <ColumnPicker
                  columns={columns}
                  visible={visibleColumns}
                  onChange={setVisibleColumns}
                />
              </div>
            )}
          </div>

          {/* Include deleted */}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", cursor: "pointer", fontSize: "var(--text-sm)" }}>
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={e => setIncludeDeleted(e.target.checked)}
              aria-label="Include deleted rows"
            />
            <span>Incl. deleted</span>
          </label>

          {/* Export */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowExport(true)}
          >
            Export CSV
          </Button>
        </div>
      </Toolbar>

      {/* Active filter summary */}
      {hasActiveFilters && (
        <div style={{
          padding: "var(--space-2) var(--space-6)",
          background: "var(--color-accent-weak)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          fontSize: "var(--text-sm)",
        }}>
          <span style={{ color: "var(--color-ink-secondary)" }}>
            Active: {filterSummary || (search.trim() ? `search "${search.trim()}"` : "filters")}
          </span>
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear all</Button>
        </div>
      )}

      {/* Filters panel */}
      {showFilters && (
        <CatalogFilters
          columns={columns}
          filters={filterState}
          onChange={setFilterState}
        />
      )}

      {/* Facets panel */}
      {showFacets && (
        <div style={{
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface-sunken)",
        }}>
          {facetsLoading ? (
            <div style={{ padding: "var(--space-4)" }}>
              <Skeleton label="Loading facets..." />
            </div>
          ) : (
            <CatalogFacets
              facets={facets}
              columns={columns}
              onApplyFacet={applyFacet}
            />
          )}
        </div>
      )}

      {/* Schema error */}
      {schemaError && (
        <div style={{ padding: "var(--space-6)" }}>
          <ErrorState message={schemaError} onRetry={() => void loadSchema()} />
        </div>
      )}

      {/* Rows error */}
      {!schemaError && rowsError && (
        <div style={{ padding: "var(--space-6)" }}>
          <div role="alert">
            <ErrorState
              message={rowsError}
              onRetry={() => {
                if (!snapRef.current) return;
                const state: TableState = { search, filters: filterState, sort: [], includeDeleted, cursor: null };
                void loadRows(snapRef.current, state);
              }}
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {!schemaError && loading && (
        <div style={{ padding: "var(--space-6)" }} aria-live="polite" aria-busy>
          <LoadingState rows={8} label="Loading rows..." />
        </div>
      )}

      {/* Empty */}
      {!schemaError && !loading && !rowsError && rows.length === 0 && bootDone && (
        <div style={{ padding: "var(--space-8)" }}>
          <EmptyState
            title="No rows match these filters"
            description={hasActiveFilters
              ? "Try adjusting or clearing the active filters."
              : "This table appears to be empty."}
            action={hasActiveFilters
              ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
              : undefined}
          />
        </div>
      )}

      {/* Table */}
      {!schemaError && !loading && rows.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <table
            className="data-table"
            style={{ minWidth: "100%" }}
            aria-busy={loadingMore}
          >
            <caption style={{ position: "absolute", left: "-9999px" }}>
              {decodedTable} — {totalCount !== null ? `${totalCount.toLocaleString()} rows` : "rows"}
            </caption>
            <thead>
              <tr>
                {visibleCols.map(col => (
                  <th
                    key={col.key}
                    scope="col"
                    style={{
                      padding: "var(--space-2) var(--space-3)",
                      textAlign: "left",
                      fontWeight: 600,
                      fontSize: "var(--text-xs)",
                      color: "var(--color-ink-secondary)",
                      background: "var(--color-surface-sunken)",
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      borderBottom: "1px solid var(--color-border-strong)",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  tabIndex={0}
                  role="row"
                  style={{ cursor: "pointer" }}
                  onClick={e => openRecord(row, e.currentTarget as HTMLTableRowElement)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openRecord(row, e.currentTarget as HTMLTableRowElement);
                    }
                  }}
                  aria-label={`Row ${rowIdx + 1}: click to view record details`}
                >
                  {visibleCols.map(col => (
                    <td
                      key={col.key}
                      style={{
                        padding: "var(--space-2) var(--space-3)",
                        fontSize: "var(--text-sm)",
                        borderBottom: "1px solid var(--color-border)",
                        color: row[col.key] === null ? "var(--color-ink-tertiary)" : "var(--color-ink)",
                        maxWidth: "260px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                      title={displayValue(row[col.key])}
                    >
                      {displayValue(row[col.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {nextCursor && !loading && !rowsError && (
        <div style={{ padding: "var(--space-4)", textAlign: "center", borderTop: "1px solid var(--color-border)" }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadMore}
            loading={loadingMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : `Load more rows`}
          </Button>
        </div>
      )}

      {/* Record drawer */}
      <RecordDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        record={selectedRecord}
        columns={visibleCols}
        tableName={decodedTable}
      />

      {/* Export dialog */}
      <ExportDialog
        open={showExport}
        onClose={() => setShowExport(false)}
        onConfirm={() => void handleExport()}
        loading={exportLoading}
        columns={columns}
        visibleColumns={visibleColumns}
        filterSummary={filterSummary}
      />
    </main>
  );
}
