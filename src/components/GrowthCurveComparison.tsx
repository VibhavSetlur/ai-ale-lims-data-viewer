'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Info, LineChart, Loader2, PanelsTopLeft, Sparkles, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ExportFigureMenu from './ExportFigureMenu';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface GrowthPoint { t: number; od: number }

interface MutationSample {
  id: string;
  name?: string;
  experiment: string;
  experiment_type?: string;
  replicate?: string;
  transfer?: number;
  condition?: string;
  strain?: string;
  donor_dna?: string;
  selection_note?: string;
  growth_curve?: GrowthPoint[];
}

type SortKey = 'experiment' | 'dna' | 'replicate' | 'transfer';
type ViewMode = 'overlay' | 'facet';
type HoverTip = { x: number; y: number; text: string; flipX: boolean; flipY: boolean };
type Series = { sample: MutationSample; points: GrowthPoint[]; color: string; label: string; subtitle: string };

const SORT_LEVELS: readonly { key: SortKey; label: string }[] = [
  { key: 'experiment', label: 'Experiment' },
  { key: 'dna', label: 'DNA' },
  { key: 'replicate', label: 'Replicate' },
  { key: 'transfer', label: 'Transfer' },
];
const SORT_LEVEL_BY_KEY = new Map(SORT_LEVELS.map(level => [level.key, level]));
const DEFAULT_SORT: SortKey[] = ['experiment', 'dna', 'replicate', 'transfer'];
const GOLDEN = 137.508;
const WIDTH = 920;
const HEIGHT = 430;
const PAD = { l: 62, r: 28, t: 24, b: 58 };

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function colorForSample(sampleId: string): string {
  return `hsl(${(hashString(sampleId) * GOLDEN) % 360} 58% 48%)`;
}

function sampleSortValue(sample: MutationSample, key: SortKey): string | number | null {
  if (key === 'experiment') return sample.experiment || null;
  if (key === 'dna') return sample.donor_dna || null;
  if (key === 'replicate') return sample.replicate || null;
  return typeof sample.transfer === 'number' ? sample.transfer : null;
}

function compareSamples(order: SortKey[]) {
  return (a: MutationSample, b: MutationSample): number => {
    for (const key of order) {
      const av = sampleSortValue(a, key);
      const bv = sampleSortValue(b, key);
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        if (av !== bv) return av - bv;
      } else {
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
      }
    }
    const at = typeof a.transfer === 'number' ? a.transfer : null;
    const bt = typeof b.transfer === 'number' ? b.transfer : null;
    if (at != null && bt != null && at !== bt) return at - bt;
    if (at == null && bt != null) return 1;
    if (at != null && bt == null) return -1;
    return sampleLabel(a).localeCompare(sampleLabel(b), undefined, { numeric: true, sensitivity: 'base' });
  };
}

function sampleLabel(sample: MutationSample): string {
  return sample.name || sample.id;
}

function sampleSubtitle(sample: MutationSample): string {
  return [
    sample.experiment,
    sample.donor_dna,
    sample.replicate ? `Rep ${sample.replicate}` : null,
    typeof sample.transfer === 'number' ? `T${sample.transfer}` : null,
    sample.condition,
  ].filter(Boolean).join(' · ');
}

function cleanCurve(curve?: GrowthPoint[]): GrowthPoint[] {
  return (curve ?? [])
    .filter(point => Number.isFinite(point.t) && Number.isFinite(point.od))
    .sort((a, b) => a.t - b.t);
}

function fmtNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(digits);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function InfoPopover({ title, children, align = 'left' }: { title: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative inline-flex" ref={ref} data-figure-omit>
      <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--accent-300)] bg-[var(--accent-50)] text-[var(--accent-700)] hover:bg-[var(--surface-3)]" title={title} aria-label={title}>
        <Info className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div className={cn('lims-popover absolute top-full z-50 mt-1 w-72 p-3 text-[11px] leading-relaxed text-[var(--text-soft)]', align === 'right' ? 'right-0' : 'left-0')}>
          <div className="mb-1 font-semibold text-[var(--text)]">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

export default function GrowthCurveComparison({ samples, selected, loading }: { samples: MutationSample[]; selected: Set<string>; loading?: boolean }) {
  const [logScale, setLogScale] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [sortOrder, setSortOrder] = useState<SortKey[]>(DEFAULT_SORT);
  const [hoveredSampleId, setHoveredSampleId] = useState<string | null>(null);
  const [isolatedSampleIds, setIsolatedSampleIds] = useState<Set<string>>(() => new Set());
  const [tooltip, setTooltip] = useState<HoverTip | null>(null);
  const figureRef = useRef<HTMLDivElement>(null);

  const selectedSamples = useMemo(
    () => samples.filter(sample => selected.has(sample.id)).sort(compareSamples(sortOrder)),
    [samples, selected, sortOrder],
  );

  const series = useMemo<Series[]>(() => selectedSamples
    .map(sample => ({ sample, points: cleanCurve(sample.growth_curve) }))
    .filter(item => item.points.length >= 2)
    .map(item => ({
      sample: item.sample,
      points: item.points,
      color: colorForSample(item.sample.id),
      label: sampleLabel(item.sample),
      subtitle: sampleSubtitle(item.sample),
    })), [selectedSamples]);

  const missingCount = selectedSamples.length - series.length;
  const visibleIds = useMemo(() => isolatedSampleIds.size > 0 ? isolatedSampleIds : new Set(series.map(item => item.sample.id)), [isolatedSampleIds, series]);
  const visibleSeries = useMemo(() => series.filter(item => visibleIds.has(item.sample.id)), [series, visibleIds]);

  const domains = useMemo(() => {
    const points = series.flatMap(item => item.points);
    const xs = points.map(point => point.t);
    const ys = points.map(point => point.od);
    const positive = ys.filter(value => value > 0);
    const xMin = xs.length ? Math.min(...xs) : 0;
    const xMax = xs.length ? Math.max(...xs) : 1;
    const yMax = Math.max(0.05, ...ys);
    const logLo = Math.max(0.001, positive.length ? Math.min(...positive) * 0.65 : 0.001);
    return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin: 0, yMax, logLo };
  }, [series]);

  const maxOD = domains.yMax;
  const timeRange = `${fmtNumber(domains.xMin, 1)} to ${fmtNumber(domains.xMax, 1)}`;

  const moveSortLevel = (key: SortKey, delta: -1 | 1) => {
    setSortOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };
  const disableSortLevel = (key: SortKey) => setSortOrder(prev => prev.length > 1 ? prev.filter(item => item !== key) : prev);
  const enableSortLevel = (key: SortKey) => setSortOrder(prev => prev.includes(key) ? prev : [...prev, key]);
  const toggleIsolated = (sampleId: string) => setIsolatedSampleIds(prev => {
    const next = new Set(prev);
    if (next.has(sampleId)) next.delete(sampleId); else next.add(sampleId);
    return next;
  });

  const exportCsv = () => {
    const rows = series.flatMap(item => item.points.map(point => [
      item.sample.id,
      item.sample.experiment || '',
      item.sample.replicate || '',
      typeof item.sample.transfer === 'number' ? String(item.sample.transfer) : '',
      String(point.t),
      String(point.od),
    ]));
    const csv = [['sample_id', 'experiment', 'replicate', 'transfer', 't', 'od'], ...rows]
      .map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `growth-curves-${series.length}samples.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleNearestPoint = (event: React.MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    const target = figureRef.current;
    if (!svg || !target || visibleSeries.length === 0) return;
    const svgRect = svg.getBoundingClientRect();
    const figRect = target.getBoundingClientRect();
    const pointerX = ((event.clientX - svgRect.left) / Math.max(1, svgRect.width)) * WIDTH;
    const pointerY = ((event.clientY - svgRect.top) / Math.max(1, svgRect.height)) * HEIGHT;
    const scales = makeScales(domains, logScale, WIDTH, HEIGHT, PAD);
    let best: { series: Series; point: GrowthPoint; dist: number; sx: number; sy: number } | null = null;
    for (const item of visibleSeries) {
      for (const point of item.points) {
        const sx = scales.x(point.t);
        const sy = scales.y(point.od);
        const dist = Math.hypot(pointerX - sx, pointerY - sy);
        if (!best || dist < best.dist) best = { series: item, point, dist, sx, sy };
      }
    }
    if (!best) return;
    const scaleX = svgRect.width / WIDTH;
    const scaleY = svgRect.height / HEIGHT;
    const x = svgRect.left - figRect.left + best.sx * scaleX;
    const y = svgRect.top - figRect.top + best.sy * scaleY;
    setHoveredSampleId(best.series.sample.id);
    setTooltip({
      x,
      y,
      flipX: x > figRect.width - 240,
      flipY: y < 80,
      text: `${best.series.label}\n${best.series.subtitle}\nt ${fmtNumber(best.point.t, 2)} · OD ${fmtNumber(best.point.od, 3)}`,
    });
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 p-3">
        <div className="lims-surface flex h-full min-h-[320px] items-center justify-center rounded-xl text-[13px] text-[var(--text-soft)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading growth curves...
        </div>
      </div>
    );
  }

  if (selectedSamples.length === 0) {
    return (
      <div className="flex-1 min-h-0 p-3">
        <div className="lims-surface flex h-full min-h-[360px] items-center justify-center rounded-xl p-6 text-center">
          <div className="max-w-xl">
            <LineChart className="mx-auto mb-3 h-8 w-8 text-[var(--data-grow)]" />
            <h3 className="text-[15px] font-semibold text-[var(--text)]">Select samples to compare growth curves</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-soft)]">Choose samples in the Samples tab, then return here to overlay OD600 curves or inspect compact facets for the selected set.</p>
          </div>
        </div>
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <Notice title="No OD curves for the selected samples" text="The selected samples do not have at least two numeric Robotic_OD points. Try choosing transfers that show OD sparklines in the Samples tab." />
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)] p-3">
      <section className="lims-surface flex min-h-full flex-col gap-3 rounded-xl p-4 shadow-sm">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <LineChart className="h-4 w-4 shrink-0 text-[var(--data-grow)]" />
              <h2 className="truncate text-[15px] font-semibold text-[var(--text)]">Compare Growth Curves</h2>
              <InfoPopover title="About this view" align="right">
                Overlays OD600 growth curves for your selected samples. The x value is the server-normalized numeric t field, usually hours when timepoint data exists and otherwise the ordinal reading index. Colors are stable per sample, and legend clicks isolate one or more samples.
              </InfoPopover>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-soft)]">Overlay selected OD600 curves on a shared axis, switch linear or log Y, inspect facets, reorder samples by priority factors, and export CSV or figures.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <Stat value={series.length.toLocaleString()} label="plotted" />
            <Stat value={missingCount.toLocaleString()} label="without curve" />
            <Stat value={fmtNumber(maxOD, 3)} label="max OD" />
            <Stat value={timeRange} label="t range" />
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2" data-figure-omit>
          <div className="flex items-center gap-1">
            <button type="button" data-on={!logScale} onClick={() => setLogScale(false)} className="lims-toggle">Linear Y</button>
            <button type="button" data-on={logScale} onClick={() => setLogScale(true)} className="lims-toggle">Log Y</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-on={viewMode === 'overlay'} onClick={() => setViewMode('overlay')} className="lims-toggle"><LineChart className="h-3.5 w-3.5" />Overlay all</button>
            <button type="button" data-on={viewMode === 'facet'} onClick={() => setViewMode('facet')} className="lims-toggle"><PanelsTopLeft className="h-3.5 w-3.5" />Small multiples</button>
          </div>
          <button type="button" onClick={exportCsv} className="lims-btn lims-btn-secondary" disabled={series.length === 0} title="Export long-format growth-curve points as CSV">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <ExportFigureMenu getTarget={() => figureRef.current} title={`AI-ALE growth curves ${viewMode}`} filenameBase={`growth-curves-${viewMode}-${logScale ? 'log' : 'linear'}`} disabled={series.length === 0} compact />
          <div className="min-w-[180px] flex-1 text-[11px] text-[var(--text-faint)]">X uses the normalized t value from the mutations data: hours when present, otherwise reading index.</div>
        </div>

        <SortPriorityRow order={sortOrder} onMove={moveSortLevel} onDisable={disableSortLevel} onEnable={enableSortLevel} onReset={() => setSortOrder(DEFAULT_SORT)} />

        {missingCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {missingCount.toLocaleString()} selected sample{missingCount === 1 ? '' : 's'} have no OD curve and are not plotted.
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
          <div className="min-w-0 space-y-3">
            <div ref={figureRef} className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm" onMouseLeave={() => { setTooltip(null); setHoveredSampleId(null); }}>
              {tooltip && <FloatingTooltip tip={tooltip} />}
              <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-soft)]">
                  <span className="font-semibold text-[var(--text)]">{viewMode === 'overlay' ? 'Shared-axis overlay' : 'Small multiples'}</span>
                  <span className="lims-chip">{series.length} curves</span>
                  <span className="lims-chip">{logScale ? 'log Y' : 'linear Y'}</span>
                  {isolatedSampleIds.size > 0 && <span className="lims-chip lims-chip-accent">{isolatedSampleIds.size} isolated</span>}
                </div>
              </div>
              {viewMode === 'overlay' ? (
                <OverlayChart series={series} domains={domains} logScale={logScale} hoveredSampleId={hoveredSampleId} visibleIds={visibleIds} onHover={setHoveredSampleId} onPointerMove={handleNearestPoint} />
              ) : (
                <FacetGrid series={series} domains={domains} logScale={logScale} hoveredSampleId={hoveredSampleId} visibleIds={visibleIds} onHover={setHoveredSampleId} />
              )}
            </div>
          </div>
          <SampleLegend series={series} isolated={isolatedSampleIds} hoveredSampleId={hoveredSampleId} onHover={setHoveredSampleId} onToggle={toggleIsolated} />
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="lims-stat"><span className="lims-stat-val">{value}</span><span className="lims-stat-lbl">{label}</span></div>;
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex-1 min-h-0 p-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[12px] leading-relaxed text-[var(--text-soft)]">
        <div className="mb-1 flex items-center gap-2 font-semibold text-[var(--text)]"><Sparkles className="h-4 w-4 text-[var(--data-grow)]" />{title}</div>
        <div>{text}</div>
      </div>
    </div>
  );
}

function SortPriorityRow({ order, onMove, onDisable, onEnable, onReset }: { order: SortKey[]; onMove: (key: SortKey, delta: -1 | 1) => void; onDisable: (key: SortKey) => void; onEnable: (key: SortKey) => void; onReset: () => void }) {
  const disabled = SORT_LEVELS.map(level => level.key).filter(key => !order.includes(key));
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[11px] text-[var(--text-soft)]" data-figure-omit>
      <span className="lims-label mr-1" title="Samples are sorted by the enabled factors from priority 1 onward.">Sort samples by</span>
      {order.map((key, idx) => (
        <span key={key} className="inline-flex items-center gap-0.5 rounded border border-[var(--accent-300)] bg-[var(--accent-50)] py-0.5 pl-1.5 pr-1 text-[var(--accent-700)]">
          <span className="tabular-nums text-[10px] opacity-70">{idx + 1}.</span>
          <span>{SORT_LEVEL_BY_KEY.get(key)?.label ?? key}</span>
          <button type="button" onClick={() => onMove(key, -1)} disabled={idx === 0} className="rounded p-0.5 hover:bg-[var(--surface)] disabled:opacity-30" title="Move to higher priority"><ChevronUp className="h-3 w-3" /></button>
          <button type="button" onClick={() => onMove(key, 1)} disabled={idx === order.length - 1} className="rounded p-0.5 hover:bg-[var(--surface)] disabled:opacity-30" title="Move to lower priority"><ChevronDown className="h-3 w-3" /></button>
          <button type="button" onClick={() => onDisable(key)} disabled={order.length <= 1} className="rounded p-0.5 hover:bg-[var(--surface)] disabled:opacity-30" title="Disable this sort factor"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {disabled.length > 0 && <span className="ml-1 text-[var(--text-faint)]">add:</span>}
      {disabled.map(key => <button key={key} type="button" onClick={() => onEnable(key)} className="lims-toggle !py-1">+ {SORT_LEVEL_BY_KEY.get(key)?.label ?? key}</button>)}
      <button type="button" onClick={onReset} className="lims-btn lims-btn-ghost !py-1">reset</button>
    </div>
  );
}

function makeScales(domains: { xMin: number; xMax: number; yMin: number; yMax: number; logLo: number }, logScale: boolean, width: number, height: number, pad: typeof PAD) {
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (value: number) => pad.l + ((value - domains.xMin) / Math.max(1e-9, domains.xMax - domains.xMin)) * innerW;
  const logMin = Math.log10(domains.logLo);
  const logMax = Math.log10(Math.max(domains.logLo * 1.1, domains.yMax));
  const y = (value: number) => {
    if (logScale) {
      const safe = Math.max(domains.logLo, value);
      return pad.t + innerH - ((Math.log10(safe) - logMin) / Math.max(1e-9, logMax - logMin)) * innerH;
    }
    return pad.t + innerH - ((value - domains.yMin) / Math.max(1e-9, domains.yMax - domains.yMin)) * innerH;
  };
  return { x, y, innerW, innerH };
}

function yTicks(max: number, logScale: boolean, logLo: number): number[] {
  if (logScale) {
    const ticks = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3].filter(value => value >= logLo * 0.99 && value <= max * 1.01);
    return ticks.length ? ticks : [logLo, max];
  }
  return [0, 0.25, 0.5, 0.75, 1].map(frac => max * frac);
}

function xTicks(min: number, max: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map(frac => min + (max - min) * frac);
}

function linePath(points: GrowthPoint[], scales: ReturnType<typeof makeScales>): string {
  return points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${scales.x(point.t).toFixed(1)} ${scales.y(point.od).toFixed(1)}`).join(' ');
}

function Axis({ domains, logScale, width = WIDTH, height = HEIGHT, pad = PAD, small = false }: { domains: { xMin: number; xMax: number; yMin: number; yMax: number; logLo: number }; logScale: boolean; width?: number; height?: number; pad?: typeof PAD; small?: boolean }) {
  const scales = makeScales(domains, logScale, width, height, pad);
  return (
    <g>
      {yTicks(domains.yMax, logScale, domains.logLo).map(tick => {
        const y = scales.y(tick);
        return <g key={`y-${tick}`}><line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--border)" /><text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize={small ? 9 : 10} fill="var(--text-faint)">{fmtNumber(tick, tick < 0.1 ? 3 : 2)}</text></g>;
      })}
      {xTicks(domains.xMin, domains.xMax).map(tick => {
        const x = scales.x(tick);
        return <g key={`x-${tick}`}><line x1={x} x2={x} y1={pad.t} y2={pad.t + scales.innerH} stroke="var(--border)" opacity="0.55" /><text x={x} y={height - pad.b + 20} textAnchor="middle" fontSize={small ? 9 : 10} fill="var(--text-faint)">{fmtNumber(tick, 1)}</text></g>;
      })}
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + scales.innerH} stroke="var(--border-strong)" />
      <line x1={pad.l} x2={width - pad.r} y1={pad.t + scales.innerH} y2={pad.t + scales.innerH} stroke="var(--border-strong)" />
      {!small && <text x={pad.l + scales.innerW / 2} y={height - 14} textAnchor="middle" fontSize="11" fill="var(--text-soft)">time or reading index (t)</text>}
      {!small && <text x="16" y={pad.t + scales.innerH / 2} textAnchor="middle" transform={`rotate(-90 16 ${pad.t + scales.innerH / 2})`} fontSize="11" fill="var(--text-soft)">OD600</text>}
    </g>
  );
}

function OverlayChart({ series, domains, logScale, hoveredSampleId, visibleIds, onHover, onPointerMove }: { series: Series[]; domains: { xMin: number; xMax: number; yMin: number; yMax: number; logLo: number }; logScale: boolean; hoveredSampleId: string | null; visibleIds: Set<string>; onHover: (id: string | null) => void; onPointerMove: (event: React.MouseEvent<SVGRectElement>) => void }) {
  const scales = makeScales(domains, logScale, WIDTH, HEIGHT, PAD);
  return (
    <div className="overflow-x-auto p-3">
      <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label="Selected sample OD600 growth curves" style={{ minWidth: 660 }}>
        <Axis domains={domains} logScale={logScale} />
        {series.map(item => {
          const active = visibleIds.has(item.sample.id);
          const focused = hoveredSampleId === item.sample.id;
          const dim = !active || (hoveredSampleId !== null && !focused);
          return (
            <g key={item.sample.id} onMouseEnter={() => onHover(item.sample.id)} onMouseLeave={() => onHover(null)}>
              <path d={linePath(item.points, scales)} fill="none" stroke={item.color} strokeWidth={focused ? 3.4 : 2.1} opacity={dim ? 0.16 : 0.92} />
              {item.points.map((point, idx) => <circle key={`${item.sample.id}-${idx}`} cx={scales.x(point.t)} cy={scales.y(point.od)} r={focused ? 4 : 2.4} fill={item.color} stroke="var(--surface)" strokeWidth="1.2" opacity={dim ? 0.16 : 0.95} />)}
            </g>
          );
        })}
        <rect x={PAD.l} y={PAD.t} width={scales.innerW} height={scales.innerH} fill="transparent" onMouseMove={onPointerMove} onMouseLeave={() => onHover(null)} />
      </svg>
    </div>
  );
}

function FacetGrid({ series, domains, logScale, hoveredSampleId, visibleIds, onHover }: { series: Series[]; domains: { xMin: number; xMax: number; yMin: number; yMax: number; logLo: number }; logScale: boolean; hoveredSampleId: string | null; visibleIds: Set<string>; onHover: (id: string | null) => void }) {
  const width = 320;
  const height = 210;
  const pad = { l: 44, r: 16, t: 18, b: 34 };
  const scales = makeScales(domains, logScale, width, height, pad);
  return (
    <div className="grid max-h-[680px] grid-cols-1 gap-3 overflow-auto p-3 sm:grid-cols-2 2xl:grid-cols-3">
      {series.map(item => {
        const active = visibleIds.has(item.sample.id);
        const focused = hoveredSampleId === item.sample.id;
        return (
          <div key={item.sample.id} className={cn('min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 transition-opacity', !active && 'opacity-35', hoveredSampleId && !focused && 'opacity-45')} onMouseEnter={() => onHover(item.sample.id)} onMouseLeave={() => onHover(null)}>
            <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[11px]"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate font-semibold text-[var(--text)]" title={`${item.label}\n${item.subtitle}`}>{item.label}</span></div>
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label={`${item.label} OD600 growth curve`}>
              <Axis domains={domains} logScale={logScale} width={width} height={height} pad={pad} small />
              <path d={linePath(item.points, scales)} fill="none" stroke={item.color} strokeWidth={focused ? 3 : 2.1} opacity="0.95" />
              {item.points.map((point, idx) => <circle key={idx} cx={scales.x(point.t)} cy={scales.y(point.od)} r={focused ? 3.5 : 2.4} fill={item.color} stroke="var(--surface)" strokeWidth="1" />)}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function SampleLegend({ series, isolated, hoveredSampleId, onHover, onToggle }: { series: Series[]; isolated: Set<string>; hoveredSampleId: string | null; onHover: (sampleId: string | null) => void; onToggle: (sampleId: string) => void }) {
  return (
    <aside className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm" data-figure-omit>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]"><span className="font-semibold text-[var(--text)]">Interactive legend</span><span className="text-[11px] text-[var(--text-soft)]">Hover to highlight. Click to isolate.</span></div>
      <div className="flex max-h-[620px] flex-col gap-1.5 overflow-auto pr-1">
        {series.map(item => {
          const pressed = isolated.has(item.sample.id);
          const dim = hoveredSampleId !== null && hoveredSampleId !== item.sample.id;
          return (
            <button key={item.sample.id} type="button" aria-pressed={pressed} onClick={() => onToggle(item.sample.id)} onMouseEnter={() => onHover(item.sample.id)} onMouseLeave={() => onHover(null)} data-on={pressed} className={cn('lims-toggle min-w-0 justify-start !py-1.5 text-left', pressed && 'ring-1 ring-[var(--accent-500)]', dim && 'opacity-45')} title={`${item.label}\n${item.subtitle}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="min-w-0 flex-1"><span className="block truncate font-mono text-[11px]">{item.label}</span><span className="block truncate text-[10px] text-[var(--text-faint)]">{item.subtitle}</span></span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function FloatingTooltip({ tip }: { tip: HoverTip }) {
  return (
    <div className="pointer-events-none absolute z-40 rounded bg-slate-900/95 px-2 py-1 font-mono text-[11px] text-white shadow-lg ring-1 ring-black/20" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.flipX ? 'calc(-100% - 18px)' : '18px'}, ${tip.flipY ? '20px' : 'calc(-100% - 14px)'})`, whiteSpace: 'pre' }}>
      {tip.text}
    </div>
  );
}
