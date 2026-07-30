"use client";

/**
 * ColumnPicker.tsx -- Phase B1 column visibility picker
 * Extracted from CatalogBrowser.tsx for the spec requirement of separate files.
 */

import type { ColumnDescriptor } from "@/shared/contracts/catalog";

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
