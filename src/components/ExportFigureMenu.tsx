'use client';

import React, { useState } from 'react';
import { Check, Download, FileImage, Loader2 } from 'lucide-react';
import type { FigureSpec } from '../lib/figureSpec';
import FigureExportModal from './FigureExportModal';

/**
 * Shared figure-export control used by visualizations. The visible UI routes
 * exports through a preview modal. Callers can provide a FigureSpec for a
 * dedicated renderer, or fall back to the existing DOM export path.
 *
 * `getTarget` is called at click time (not render time) so the caller can return
 * the currently-rendered chart node (refs may be null on first paint).
 */
export default function ExportFigureMenu({
  getTarget,
  title,
  filenameBase,
  disabled,
  compact,
  label = 'Export image',
  buildSpec,
  onBeforeExport,
  onAfterExport,
}: {
  getTarget: () => HTMLElement | SVGSVGElement | null;
  title: string;
  filenameBase: string;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  buildSpec?: () => FigureSpec | null;
  // Optional hooks so a caller can neutralize transient UI state before the
  // figure is captured, then restore it after.
  onBeforeExport?: () => void;
  onAfterExport?: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [spec, setSpec] = useState<FigureSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(null), 2200);
  };

  const openPreview = () => {
    setBusy(true);
    try {
      const nextSpec = buildSpec?.() ?? null;
      if (!nextSpec && !getTarget()) {
        flash('Nothing to export yet');
        return;
      }
      setSpec(nextSpec);
      setModalOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" data-figure-omit>
      <button
        onClick={openPreview}
        disabled={disabled || busy}
        className={compact
          ? 'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[var(--border)] text-[var(--text-soft)] hover:bg-[var(--surface-3)] disabled:opacity-40'
          : 'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-40'}
        title="Preview and export this visualization as PNG or SVG"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : done ? <Check className="w-3 h-3 text-[var(--data-grow)]" /> : <Download className="w-3 h-3" />}
        {done ? <span className="text-[var(--data-grow)]">{done}</span> : label}
      </button>
      <FigureExportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        spec={spec}
        getTarget={getTarget}
        title={title}
        filenameBase={filenameBase}
        onBeforeExport={onBeforeExport}
        onAfterExport={onAfterExport}
        onDone={flash}
      />
      <span className="sr-only"><FileImage className="w-3 h-3" />Figure image export</span>
    </div>
  );
}
