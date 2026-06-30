'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, FileImage, FileCode2, FileText, Printer, Check, Loader2 } from 'lucide-react';
import { exportFigure, printFigure, type FigureExportFormat } from '../lib/figureExport';

/**
 * Shared figure-export control used by every visualization (comparative heatmap,
 * copy-number chart, barcode charts, growth curve). A single button that opens a
 * small menu offering PNG / SVG / HTML / Print, so the export experience is
 * identical everywhere and researchers learn it once.
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
  label = 'Export figure',
}: {
  getTarget: () => HTMLElement | SVGSVGElement | null;
  title: string;
  filenameBase: string;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<FigureExportFormat | 'print' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(null), 2200);
  };

  const run = async (format: FigureExportFormat) => {
    const target = getTarget();
    if (!target) { flash('Nothing to export yet'); setOpen(false); return; }
    setBusy(format);
    try {
      const res = await exportFigure(target, format, title, filenameBase);
      flash(res ? `Saved ${res.toUpperCase()}` : 'Export failed');
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const doPrint = () => {
    const target = getTarget();
    if (!target) { flash('Nothing to print yet'); setOpen(false); return; }
    setBusy('print');
    const ok = printFigure(target, title);
    flash(ok ? 'Opened print dialog' : 'Print blocked by browser');
    setBusy(null);
    setOpen(false);
  };

  const items: { key: FigureExportFormat | 'print'; icon: React.ReactNode; label: string; hint: string; onClick: () => void }[] = [
    { key: 'png', icon: <FileImage className="w-3.5 h-3.5" />, label: 'PNG image', hint: 'bitmap for slides & email (2x)', onClick: () => run('png') },
    { key: 'svg', icon: <FileCode2 className="w-3.5 h-3.5" />, label: 'SVG vector', hint: 'scales crisply for manuscripts', onClick: () => run('svg') },
    { key: 'html', icon: <FileText className="w-3.5 h-3.5" />, label: 'HTML page', hint: 'self-contained, fixed-size labels', onClick: () => run('html') },
    { key: 'print', icon: <Printer className="w-3.5 h-3.5" />, label: 'Print / Save PDF', hint: 'opens the print dialog', onClick: doPrint },
  ];

  return (
    <div className="relative" ref={ref} data-figure-omit>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className={compact
          ? 'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[var(--border)] text-[var(--text-soft)] hover:bg-[var(--surface-3)] disabled:opacity-40'
          : 'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-40'}
        title="Export this visualization as PNG, SVG, HTML, or print to PDF"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        {done ? <span className="text-[var(--data-grow)] inline-flex items-center gap-1"><Check className="w-3 h-3" />{done}</span> : label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 z-50 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Export this figure</div>
          {items.map(it => (
            <button
              key={it.key}
              role="menuitem"
              onClick={it.onClick}
              disabled={busy !== null}
              className="w-full flex items-start gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--surface-3)] disabled:opacity-40"
            >
              <span className="mt-0.5 text-[var(--accent-600)]">{it.icon}</span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-[var(--text)]">{it.label}</span>
                <span className="block text-[10.5px] text-[var(--text-soft)] leading-snug">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
