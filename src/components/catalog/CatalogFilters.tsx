"use client";

/**
 * CatalogFilters.tsx -- Phase B1 filter builder panel
 * Extracted from CatalogBrowser.tsx for the spec requirement of separate files.
 */

import React, { useRef } from "react";
import { Button } from "@/components/design-system/Primitives";
import type { ColumnDescriptor, Filter } from "@/shared/contracts/catalog";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilterState = { combinator: "and" | "or"; rows: (Filter & { _id: number })[] };

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

export function noValue(op: Operator): boolean {
  return op === "isNull" || op === "isNotNull";
}

// ─── FilterRow ────────────────────────────────────────────────────────────────

type FilterRowProps = {
  filter: Filter & { _id: number };
  columns: ColumnDescriptor[];
  onChange: (f: Filter & { _id: number }) => void;
  onRemove: () => void;
};

function FilterRow({ filter, columns, onChange, onRemove }: Readonly<FilterRowProps>) {
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
