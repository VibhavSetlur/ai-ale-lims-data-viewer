"use client";

/**
 * RecordDrawer.tsx -- Phase B1 record detail drawer
 * Extracted from CatalogBrowser.tsx for the spec requirement of separate files.
 * Uses Drawer primitive which provides focus trap, Escape, and focus restore.
 */

import {
  Drawer,
  Skeleton,
} from "@/components/design-system/Primitives";
import type { ColumnDescriptor } from "@/shared/contracts/catalog";

// ─── RecordDrawer ─────────────────────────────────────────────────────────────

type RecordDrawerProps = {
  open: boolean;
  onClose: () => void;
  record: Record<string, unknown> | null;
  columns: ColumnDescriptor[];
  tableName: string;
};

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

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
