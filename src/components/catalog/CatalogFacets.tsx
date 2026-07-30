"use client";

/**
 * CatalogFacets.tsx -- Phase B1 facets panel
 * Extracted from CatalogBrowser.tsx for the spec requirement of separate files.
 */

import type { ColumnDescriptor } from "@/shared/contracts/catalog";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FacetData = Record<string, { value: string | number | boolean | null; count: number }[]>;

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ─── CatalogFacets ────────────────────────────────────────────────────────────

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
