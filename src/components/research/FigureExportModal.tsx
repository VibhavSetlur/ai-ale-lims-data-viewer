'use client';

import React, { useMemo, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { exportFigure } from '@/lib/figureExport';
import {
  defaultOptionsForSpec,
  downloadBlob,
  FIGURE_THEME_PRESETS,
  figureFilename,
  figureSpecToPngBlob,
  renderFigureSpecSvg,
  type FigureRenderOptions,
  type FigureSpec,
  type FigureThemeId,
} from '@/lib/figureSpec';

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export default function FigureExportModal({
  open,
  onClose,
  spec,
  getTarget,
  title,
  filenameBase,
  onBeforeExport,
  onAfterExport,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  spec?: FigureSpec | null;
  getTarget: () => HTMLElement | SVGSVGElement | null;
  title: string;
  filenameBase: string;
  onBeforeExport?: () => void;
  onAfterExport?: () => void;
  onDone?: (message: string) => void;
}) {
  const defaults = useMemo(() => spec ? defaultOptionsForSpec(spec) : null, [spec]);
  const [options, setOptions] = useState<FigureRenderOptions | null>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- New figure defaults initialize the modal.
    setOptions(defaults);
    setError(null);
  }, [defaults, open]);

  const svgText = useMemo(() => spec && options ? renderFigureSpecSvg(spec, options) : '', [spec, options]);
  const previewUrl = useMemo(() => {
    if (!svgText) return '';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  }, [svgText]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- New SVG clears its prior preview error.
    setPreviewError(false);
  }, [previewUrl]);

  if (!open) return null;

  const patch = <K extends keyof FigureRenderOptions>(key: K, value: FigureRenderOptions[K]) => {
    setOptions(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const applyTheme = (themeId: FigureThemeId) => {
    const preset = FIGURE_THEME_PRESETS[themeId];
    setOptions(prev => prev ? { ...prev, ...preset, themeId } : prev);
  };

  const download = async (format: 'png' | 'svg') => {
    setBusy(true);
    setError(null);
    try {
      if (onBeforeExport) { onBeforeExport(); await nextFrame(); }
      if (spec && options) {
        if (format === 'svg') {
          const blob = new Blob([renderFigureSpecSvg(spec, options)], { type: 'image/svg+xml;charset=utf-8' });
          downloadBlob(figureFilename(filenameBase, 'svg'), blob);
          onDone?.('Saved SVG');
        } else {
          const blob = await figureSpecToPngBlob(spec, options, 3);
          downloadBlob(figureFilename(filenameBase), blob);
          onDone?.('Saved PNG');
        }
        onClose();
      } else {
        const target = getTarget();
        if (!target) throw new Error('Nothing to export yet');
        const result = await exportFigure(target, format, title, filenameBase);
        if (result !== format) throw new Error(`${format.toUpperCase()} export failed`);
        onDone?.(`Saved ${format.toUpperCase()}`);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${format.toUpperCase()} export failed`);
    } finally {
      onAfterExport?.();
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3" role="dialog" aria-modal="true" aria-label="Export figure" data-figure-omit>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[var(--text)]">Export figure</div>
            <div className="text-[11px] text-[var(--text-soft)]">Preview, edit labels and design, then download PNG or SVG.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-[var(--text-soft)] hover:bg-[var(--surface-3)]" aria-label="Close export preview"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-[360px] overflow-auto bg-slate-100 p-4 dark:bg-slate-950/30">
            <div className="mx-auto w-fit rounded-lg bg-white p-2 shadow ring-1 ring-slate-200">
              {previewUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG data URL is generated locally for preview. */}
          <img src={previewUrl} alt="Figure preview" className="max-h-[68vh] max-w-full" onLoad={() => setPreviewError(false)} onError={() => setPreviewError(true)} />
                  {previewError && <div className="mt-2 text-[12px] text-red-600">Preview failed to render. Try a different format or reduce the selection.</div>}
                </>
              ) : (
                <div className="flex h-[420px] w-[640px] max-w-full items-center justify-center rounded border border-dashed border-slate-300 bg-white p-8 text-center text-[13px] text-slate-500">
                  This view uses the existing DOM PNG exporter. The exported PNG will use the current on-screen figure after export-safe cleanup.
                </div>
              )}
            </div>
          </div>

          <aside className="min-h-0 overflow-auto border-l border-[var(--border)] bg-[var(--surface)] p-4">
            {options ? (
              <div className="space-y-4">
                <Field label="Title"><input className="lims-input w-full" value={options.title} onChange={event => patch('title', event.target.value)} /></Field>
                <Field label="Subtitle"><textarea className="lims-input min-h-16 w-full" value={options.subtitle ?? ''} onChange={event => patch('subtitle', event.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="X title"><input className="lims-input w-full" value={options.xTitle ?? ''} onChange={event => patch('xTitle', event.target.value)} /></Field>
                  <Field label="Y title"><input className="lims-input w-full" value={options.yTitle ?? ''} onChange={event => patch('yTitle', event.target.value)} /></Field>
                </div>
                <Field label="Legend title"><input className="lims-input w-full" value={options.legendTitle ?? ''} onChange={event => patch('legendTitle', event.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Width" value={options.width} min={520} max={2600} step={20} onChange={value => patch('width', value)} />
                  <NumberField label="Height" value={options.height} min={420} max={2200} step={20} onChange={value => patch('height', value)} />
                  <NumberField label="Font scale" value={options.fontScale} min={0.7} max={1.6} step={0.05} onChange={value => patch('fontScale', value)} />
                  <NumberField label="Cell size" value={options.cellSize} min={12} max={80} step={1} onChange={value => patch('cellSize', value)} />
                </div>
                <Field label="Theme preset">
                  <select className="lims-input w-full" value={options.themeId ?? ''} onChange={event => event.target.value && applyTheme(event.target.value as FigureThemeId)}>
                    <option value="">Custom</option>
                    {Object.entries(FIGURE_THEME_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <ColorField label="Background" value={options.background} onChange={value => patch('background', value)} />
                  <ColorField label="Plot background" value={options.plotBackground ?? options.background} onChange={value => patch('plotBackground', value)} />
                  <ColorField label="Grid" value={options.gridColor ?? options.borderColor} onChange={value => patch('gridColor', value)} />
                  <ColorField label="Empty cells" value={options.emptyColor} onChange={value => patch('emptyColor', value)} />
                  <ColorField label="AI marker" value={options.aiMarkerColor} onChange={value => patch('aiMarkerColor', value)} />
                  <ColorField label="Border" value={options.borderColor} onChange={value => patch('borderColor', value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="lims-toggle" data-on={options.showLegend} onClick={() => patch('showLegend', !options.showLegend)}>Show legend</button>
                  <button type="button" className="lims-toggle" data-on={options.showValues} onClick={() => patch('showValues', !options.showValues)}>Show values</button>
                </div>
                <Field label="Caption"><textarea className="lims-input min-h-16 w-full" value={options.caption ?? ''} onChange={event => patch('caption', event.target.value)} /></Field>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] leading-relaxed text-[var(--text-soft)]">
                Fallback mode. This view has not been migrated to FigureSpec yet, so it will use the existing client-side DOM exporter for PNG or SVG.
              </div>
            )}
            {error && <div className="mt-4 rounded border border-red-200 bg-red-50 p-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <button type="button" className="lims-btn lims-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="lims-btn lims-btn-ghost" onClick={() => download('svg')} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download SVG
          </button>
          <button type="button" className="lims-btn lims-btn-primary" onClick={() => download('png')} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-[var(--text-soft)]"><span className="mb-1 block">{label}</span>{children}</label>;
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizes the local number draft with its external value.
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, next));
    setDraft(String(clamped));
    onChange(clamped);
  };

  return (
    <Field label={label}>
      <input
        type="number"
        className="lims-input w-full"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <input type="color" value={value} onChange={event => onChange(event.target.value)} className="h-8 w-9 rounded border border-[var(--border)] bg-transparent p-0.5" />
        <input className="lims-input min-w-0 flex-1 font-mono" value={value} onChange={event => onChange(event.target.value)} />
      </div>
    </Field>
  );
}
