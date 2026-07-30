"use client";

/**
 * ExportDialog.tsx -- Phase B1 export confirmation dialog
 * Extracted from CatalogBrowser.tsx for the spec requirement of separate files.
 * Uses Dialog primitive for proper focus trap, Escape, and focus restore.
 * Enforces UI max 100 columns with a visible error when exceeded.
 */

import {
  Button,
  Dialog,
  InlineNotice,
} from "@/components/design-system/Primitives";
import type { ColumnDescriptor } from "@/shared/contracts/catalog";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum columns allowed for a single export */
export const MAX_EXPORT_COLUMNS = 100;

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
  columns,
  visibleColumns,
  filterSummary,
}: Readonly<ExportDialogProps>) {
  const selectedCount = columns.filter(c => visibleColumns.has(c.key)).length || columns.length;
  const tooManyColumns = selectedCount > MAX_EXPORT_COLUMNS;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export CSV"
      description="Export visible columns with current filters applied. Exports are limited to 10,000 rows."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            loading={loading}
            disabled={loading || tooManyColumns}
          >
            {loading ? "Exporting..." : "Export CSV"}
          </Button>
        </>
      }
    >
      {tooManyColumns && (
        <div style={{ marginBottom: "var(--space-3)" }}>
          <InlineNotice tone="warning">
            {selectedCount} columns selected exceeds the {MAX_EXPORT_COLUMNS}-column export limit.
            Use the Columns picker to reduce visible columns before exporting.
          </InlineNotice>
        </div>
      )}
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
    </Dialog>
  );
}
