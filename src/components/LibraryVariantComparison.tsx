'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart3, ChevronDown, ChevronRight, ChevronUp, Clipboard,
  Download, Grid3X3, Info, Loader2, Sparkles, TrendingUp, X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { fetchData } from '../lib/dataSource';
import ExportFigureMenu from './ExportFigureMenu';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface MutationSample {
  id: string;
  name: string;
  experiment: string;
  experiment_type?: string;
  replicate?: string;
  transfer?: number;
  condition?: string;
  strain?: string;
  donor_dna?: string;
  selection_note?: string;
  growth_curve?: { t: number; od: number }[];
}

interface LibraryVariant {
  variantId: string;
  gene?: string;
  library?: string;
  position?: string | number;
  label: string;
  aiGenerated: boolean;
  metadata: Record<string, unknown>;
}

interface LibraryVariantMeasurement {
  sampleId: string;
  seqsample: string;
  variantId: string;
  abundance: number;
  count?: number;
  transfer?: number;
}

interface LibraryVariantDataset {
  variants: LibraryVariant[];
  measurements: LibraryVariantMeasurement[];
  warnings?: string[];
  source?: { abundance?: string; countColumn?: string; metadataTable?: string };
  error?: string;
}

type ChartMode = 'bars' | 'heatmap' | 'lines';
type MetricMode = 'abundance' | 'count';
type SortKey = 'experiment' | 'dna' | 'replicate' | 'transfer';
type HoverTip = { x: number; y: number; text: string; flipX: boolean; flipY: boolean };
type VariantWithStats = LibraryVariant & { totalAbundance: number; totalCount: number; maxAbundance: number; maxCount: number; present: number };

const SORT_LEVELS: readonly { key: SortKey; label: string }[] = [
  { key: 'experiment', label: 'Experiment' },
  { key: 'dna', label: 'DNA' },
  { key: 'replicate', label: 'Replicate' },
  { key: 'transfer', label: 'Transfer' },
];
const SORT_LEVEL_BY_KEY = new Map(SORT_LEVELS.map(level => [level.key, level]));
const DEFAULT_SORT: SortKey[] = ['experiment', 'dna', 'replicate', 'transfer'];
const TOP_OPTIONS = [10, 20, 50, 0] as const;
const GOLDEN = 137.508;
const FILL_SAT = 45;
const FILL_LIGHT = 52;

function parseCandidate(label: string): { a: string; b: string } | null {
  const match = label.match(/^(A\d+)-(B\d+)$/i);
  return match ? { a: match[1].toUpperCase(), b: match[2].toUpperCase() } : null;
}

function colorFor(idx: number, total: number): string {
  void total;
  return `hsl(${(idx * GOLDEN) % 360} ${FILL_SAT}% ${FILL_LIGHT}%)`;
}

function colorForCandidate(label: string): string {
  const parsed = parseCandidate(label);
  if (!parsed) {
    let hash = 0;
    for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(hash) % 360} ${FILL_SAT}% ${FILL_LIGHT}%)`;
  }
  const a = Number.parseInt(parsed.a.slice(1), 10) || 0;
  const b = Number.parseInt(parsed.b.slice(1), 10) || 0;
  return colorFor(a * 97 + b, 1);
}

function textColorFor(hslColor: string): string {
  const match = hslColor.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!match) return '#ffffff';
  const hue = Number.parseFloat(match[1]);
  const light = Number.parseFloat(match[3]);
  const threshold = hue >= 45 && hue <= 200 ? 52 : 62;
  return light >= threshold ? '#0f172a' : '#ffffff';
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
    return (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: 'base' });
  };
}

function fmtValue(value: number, metric: MetricMode): string {
  if (!Number.isFinite(value) || value <= 0) return metric === 'count' ? '0' : '0%';
  if (metric === 'count') return Math.round(value).toLocaleString();
  if (value < 0.001) return '<0.1%';
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function sampleLabel(sample: MutationSample): string {
  return sample.name || sample.id;
}

function sampleSubtitle(sample: MutationSample): string {
  return [sample.experiment, sample.donor_dna, sample.replicate ? `Rep ${sample.replicate}` : null, typeof sample.transfer === 'number' ? `T${sample.transfer}` : null]
    .filter(Boolean).join(' · ');
}

function metadataText(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parseMetadataJson(value: unknown): Record<string, unknown> | string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return String(parsed);
  } catch {
    return value;
  }
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

export default function LibraryVariantComparison({ samples, selected, loading: samplesLoading }: { samples: MutationSample[]; selected: Set<string>; loading?: boolean }) {
  const [dataset, setDataset] = useState<LibraryVariantDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChartMode>('bars');
  const [metric, setMetric] = useState<MetricMode>('abundance');
  const [topN, setTopN] = useState<number>(20);
  const [sortOrder, setSortOrder] = useState<SortKey[]>(DEFAULT_SORT);
  const [hoveredVariantId, setHoveredVariantId] = useState<string | null>(null);
  const [isolatedVariantIds, setIsolatedVariantIds] = useState<Set<string>>(() => new Set());
  const [tooltip, setTooltip] = useState<HoverTip | null>(null);
  const [expandedMetadata, setExpandedMetadata] = useState<Set<string>>(() => new Set());
  const figureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchData('/api/library-variants')
      .then(async response => {
        const json: unknown = await response.json();
        const payload = json as LibraryVariantDataset;
        if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
        if (alive) setDataset(payload);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load library variant data');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selectedSamples = useMemo(
    () => samples.filter(sample => selected.has(sample.id)).sort(compareSamples(sortOrder)),
    [samples, selected, sortOrder],
  );
  const selectedSampleIds = useMemo(() => new Set(selectedSamples.map(sample => sample.id)), [selectedSamples]);
  const measurements = useMemo(
    () => (dataset?.measurements ?? []).filter(measurement => selectedSampleIds.has(measurement.sampleId)),
    [dataset?.measurements, selectedSampleIds],
  );
  const hasCounts = useMemo(() => measurements.some(measurement => typeof measurement.count === 'number' && Number.isFinite(measurement.count)), [measurements]);

  const effectiveMetric: MetricMode = hasCounts ? metric : 'abundance';

  const valueBySampleVariant = useMemo(() => {
    const map = new Map<string, { abundance: number; count: number }>();
    for (const measurement of measurements) {
      map.set(`${measurement.sampleId}|${measurement.variantId}`, {
        abundance: Number(measurement.abundance) || 0,
        count: Number(measurement.count) || 0,
      });
    }
    return map;
  }, [measurements]);

  const rankedVariants = useMemo<VariantWithStats[]>(() => {
    if (!dataset) return [];
    const stats = new Map<string, { totalAbundance: number; totalCount: number; maxAbundance: number; maxCount: number; present: Set<string> }>();
    for (const measurement of measurements) {
      const entry = stats.get(measurement.variantId) ?? { totalAbundance: 0, totalCount: 0, maxAbundance: 0, maxCount: 0, present: new Set<string>() };
      const abundance = Number(measurement.abundance) || 0;
      const count = Number(measurement.count) || 0;
      entry.totalAbundance += abundance;
      entry.totalCount += count;
      entry.maxAbundance = Math.max(entry.maxAbundance, abundance);
      entry.maxCount = Math.max(entry.maxCount, count);
      if (abundance > 0 || count > 0) entry.present.add(measurement.sampleId);
      stats.set(measurement.variantId, entry);
    }
    return dataset.variants
      .map(variant => {
        const entry = stats.get(variant.variantId) ?? { totalAbundance: 0, totalCount: 0, maxAbundance: 0, maxCount: 0, present: new Set<string>() };
        return { ...variant, totalAbundance: entry.totalAbundance, totalCount: entry.totalCount, maxAbundance: entry.maxAbundance, maxCount: entry.maxCount, present: entry.present.size };
      })
      .filter(variant => variant.totalAbundance > 0 || variant.totalCount > 0)
      .sort((a, b) => (effectiveMetric === 'count' ? b.totalCount - a.totalCount : b.totalAbundance - a.totalAbundance) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [dataset, measurements, effectiveMetric]);

  const visibleVariants = useMemo(() => topN <= 0 ? rankedVariants : rankedVariants.slice(0, topN), [rankedVariants, topN]);
  const visibleVariantIds = useMemo(() => new Set(visibleVariants.map(variant => variant.variantId)), [visibleVariants]);
  const maxValue = useMemo(() => Math.max(0.000001, ...visibleVariants.flatMap(variant => selectedSamples.map(sample => {
    const cell = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`);
    return effectiveMetric === 'count' ? cell?.count ?? 0 : cell?.abundance ?? 0;
  }))), [effectiveMetric, selectedSamples, valueBySampleVariant, visibleVariants]);
  const colors = useMemo(() => new Map(visibleVariants.map(variant => [variant.variantId, colorForCandidate(variant.label)])), [visibleVariants]);
  const activeVariantIds = isolatedVariantIds.size > 0 ? isolatedVariantIds : visibleVariantIds;
  const anyAi = visibleVariants.some(variant => variant.aiGenerated);

  const setTipFromPointer = (event: React.MouseEvent<HTMLElement | SVGElement>, text: string) => {
    const target = figureRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setTooltip({ x, y, text, flipX: x > rect.width - 240, flipY: y < 72 });
  };

  const valueFor = (sampleId: string, variantId: string): number => {
    const cell = valueBySampleVariant.get(`${sampleId}|${variantId}`);
    return effectiveMetric === 'count' ? cell?.count ?? 0 : cell?.abundance ?? 0;
  };

  const exportCsv = () => {
    const header = ['variant', 'library', 'ai_generated', 'metric', ...selectedSamples.map(sampleLabel)];
    const rows = visibleVariants.map(variant => [
      variant.label,
      metadataText(variant.metadata.Library ?? variant.library),
      variant.aiGenerated ? 'yes' : 'no',
      effectiveMetric === 'count' ? 'count' : 'relative_abundance',
      ...selectedSamples.map(sample => String(valueFor(sample.id, variant.variantId))),
    ]);
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `library-variants-${effectiveMetric}-${visibleVariants.length}variants-${selectedSamples.length}samples.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const moveSortLevel = (key: SortKey, delta: -1 | 1) => {
    setSortOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };
  const disableSortLevel = (key: SortKey) => setSortOrder(prev => prev.length > 1 ? prev.filter(k => k !== key) : prev);
  const enableSortLevel = (key: SortKey) => setSortOrder(prev => prev.includes(key) ? prev : [...prev, key]);
  const toggleIsolated = (variantId: string) => setIsolatedVariantIds(prev => {
    const next = new Set(prev);
    if (next.has(variantId)) next.delete(variantId); else next.add(variantId);
    return next;
  });
  const copyValue = (value: string) => { void navigator.clipboard?.writeText(value); };

  if (samplesLoading || loading) {
    return (
      <div className="flex-1 min-h-0 p-3">
        <div className="lims-surface flex h-full min-h-[320px] items-center justify-center rounded-xl text-[13px] text-[var(--text-soft)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading library variants...
        </div>
      </div>
    );
  }

  if (error) {
    return <Notice tone="warn" title="Could not load library variants." text={error} />;
  }

  if (selectedSamples.length === 0) {
    return (
      <div className="flex-1 min-h-0 p-3">
        <div className="lims-surface flex h-full min-h-[360px] items-center justify-center rounded-xl p-6 text-center">
          <div className="max-w-xl">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-[var(--accent-600)]" />
            <h3 className="text-[15px] font-semibold text-[var(--text)]">Select samples to compare library variants</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-soft)]">
              Choose samples in the Samples tab, then return here to compare verAB library-variant abundance across the same selected set.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!dataset || dataset.variants.length === 0 || measurements.length === 0 || visibleVariants.length === 0) {
    return <Notice tone="info" title="No verAB library variant data for these samples" text="The selected samples do not have matching verAB_barcodes measurements. Try a different selected sample set or confirm that barcode data is present for this database snapshot." />;
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)] p-3">
      <section className="lims-surface flex min-h-full flex-col gap-3 rounded-xl p-4 shadow-sm">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent-600)]" />
              <h2 className="truncate text-[15px] font-semibold text-[var(--text)]">Compare Library Variants</h2>
              <InfoPopover title="About this view" align="right">
                Compares verAB library-variant abundance across your selected samples. Colors are stable per variant identity, and variants inferred from AI-generated library candidates are marked with an AI badge.
              </InfoPopover>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-soft)]">Stable colors, responsive charts, sortable sample priority, CSV export, figure export, and Library_candidates metadata in one view.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <Stat value={selectedSamples.length.toLocaleString()} label="samples" />
            <Stat value={visibleVariants.length.toLocaleString()} label={topN <= 0 ? 'variants' : `of ${rankedVariants.length}`} />
            <Stat value={anyAi ? 'yes' : 'no'} label="AI marked" />
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2" data-figure-omit>
          <div className="flex items-center gap-1">
            <ModeButton active={mode === 'bars'} onClick={() => setMode('bars')} icon={<BarChart3 className="h-3.5 w-3.5" />}>Bars</ModeButton>
            <ModeButton active={mode === 'heatmap'} onClick={() => setMode('heatmap')} icon={<Grid3X3 className="h-3.5 w-3.5" />}>Heatmap</ModeButton>
            <ModeButton active={mode === 'lines'} onClick={() => setMode('lines')} icon={<TrendingUp className="h-3.5 w-3.5" />}>Lines</ModeButton>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-soft)]">
            <span className="lims-label">Top variants</span>
            <select className="lims-select" value={topN} onChange={event => setTopN(Number(event.target.value))}>
              {TOP_OPTIONS.map(option => <option key={option} value={option}>{option === 0 ? 'All' : `Top ${option}`}</option>)}
            </select>
          </label>
          {hasCounts && (
            <div className="flex items-center gap-1">
              <button type="button" className="lims-toggle" data-on={effectiveMetric === 'abundance'} onClick={() => setMetric('abundance')}>Relative %</button>
              <button type="button" className="lims-toggle" data-on={effectiveMetric === 'count'} onClick={() => setMetric('count')}>Count</button>
            </div>
          )}
          <button type="button" onClick={exportCsv} className="lims-btn lims-btn-secondary" disabled={visibleVariants.length === 0} title="Export the current variant by sample matrix as CSV">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <ExportFigureMenu getTarget={() => figureRef.current} title={`AI-ALE library variants ${mode}`} filenameBase={`library-variants-${mode}-${effectiveMetric}`} disabled={visibleVariants.length === 0} compact />
          <div className="ml-auto text-[11px] tabular-nums text-[var(--text-faint)]">{effectiveMetric === 'count' ? 'Counts' : 'Per-sample relative abundance'}</div>
        </div>

        <SortPriorityRow order={sortOrder} onMove={moveSortLevel} onDisable={disableSortLevel} onEnable={enableSortLevel} onReset={() => setSortOrder(DEFAULT_SORT)} />

        {(dataset.warnings?.length ?? 0) > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 break-words">{dataset.warnings!.join(' ')}</div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <div className="min-w-0 space-y-3">
            <div ref={figureRef} className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm" onMouseLeave={() => { setTooltip(null); setHoveredVariantId(null); }}>
              {tooltip && <FloatingTooltip tip={tooltip} />}
              <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-soft)]">
                  <span className="font-semibold text-[var(--text)]">{mode === 'bars' ? 'Grouped bars' : mode === 'heatmap' ? 'Variant heatmap' : 'Variant trajectories'}</span>
                  <span className="lims-chip">{visibleVariants.length} variants</span>
                  <span className="lims-chip">{selectedSamples.length} samples</span>
                  {anyAi && <span className="lims-pill lims-pill-ai">AI = candidate metadata marked AI-generated</span>}
                </div>
              </div>
              {mode === 'bars' && <BarsChart variants={visibleVariants} samples={selectedSamples} colors={colors} metric={effectiveMetric} maxValue={maxValue} valueFor={valueFor} hoveredVariantId={hoveredVariantId} activeVariantIds={activeVariantIds} onHoverVariant={setHoveredVariantId} onTip={setTipFromPointer} />}
              {mode === 'heatmap' && <HeatmapChart variants={visibleVariants} samples={selectedSamples} colors={colors} metric={effectiveMetric} maxValue={maxValue} valueFor={valueFor} hoveredVariantId={hoveredVariantId} activeVariantIds={activeVariantIds} onHoverVariant={setHoveredVariantId} onTip={setTipFromPointer} />}
              {mode === 'lines' && <LinesChart variants={visibleVariants} samples={selectedSamples} colors={colors} metric={effectiveMetric} maxValue={maxValue} valueFor={valueFor} hoveredVariantId={hoveredVariantId} activeVariantIds={activeVariantIds} onHoverVariant={setHoveredVariantId} onTip={setTipFromPointer} />}
            </div>
            <VariantLegend variants={visibleVariants} colors={colors} isolated={isolatedVariantIds} hoveredVariantId={hoveredVariantId} onHover={setHoveredVariantId} onToggle={toggleIsolated} />
          </div>

          <MetadataPanel variants={visibleVariants} colors={colors} expanded={expandedMetadata} setExpanded={setExpandedMetadata} hoveredVariantId={hoveredVariantId} onHover={setHoveredVariantId} onCopy={copyValue} sampleCount={selectedSamples.length} />
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="lims-stat"><span className="lims-stat-val">{value}</span><span className="lims-stat-lbl">{label}</span></div>;
}

function ModeButton({ active, onClick, children, icon }: { active: boolean; onClick: () => void; children: React.ReactNode; icon: React.ReactNode }) {
  return <button type="button" onClick={onClick} data-on={active} className="lims-toggle">{icon}{children}</button>;
}

function Notice({ tone, title, text }: { tone: 'warn' | 'info'; title: string; text: string }) {
  return (
    <div className="flex-1 min-h-0 p-3">
      <div className={cn('rounded-xl border p-4 text-[12px] leading-relaxed', tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-soft)]')}>
        <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{title}</div>
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
      {order.map((key, idx) => {
        const level = SORT_LEVEL_BY_KEY.get(key);
        return (
          <span key={key} className="inline-flex items-center gap-0.5 rounded border border-[var(--accent-300)] bg-[var(--accent-50)] py-0.5 pl-1.5 pr-1 text-[var(--accent-700)]">
            <span className="tabular-nums text-[10px] opacity-70">{idx + 1}.</span>
            <span>{level?.label ?? key}</span>
            <button type="button" onClick={() => onMove(key, -1)} disabled={idx === 0} className="rounded p-0.5 hover:bg-[var(--surface)] disabled:opacity-30" title="Move to higher priority"><ChevronUp className="h-3 w-3" /></button>
            <button type="button" onClick={() => onMove(key, 1)} disabled={idx === order.length - 1} className="rounded p-0.5 hover:bg-[var(--surface)] disabled:opacity-30" title="Move to lower priority"><ChevronDown className="h-3 w-3" /></button>
            <button type="button" onClick={() => onDisable(key)} disabled={order.length <= 1} className="rounded p-0.5 hover:bg-[var(--surface)] disabled:opacity-30" title="Disable this sort factor"><X className="h-3 w-3" /></button>
          </span>
        );
      })}
      {disabled.length > 0 && <span className="ml-1 text-[var(--text-faint)]">add:</span>}
      {disabled.map(key => <button key={key} type="button" onClick={() => onEnable(key)} className="lims-toggle !py-1">+ {SORT_LEVEL_BY_KEY.get(key)?.label ?? key}</button>)}
      <button type="button" onClick={onReset} className="lims-btn lims-btn-ghost !py-1">reset</button>
    </div>
  );
}

function VariantLabel({ variant, color, rank, compact = false }: { variant: LibraryVariant; color: string; rank?: number; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {rank != null && <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-faint)]">{rank}.</span>}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />
      <span className={cn('lims-id truncate font-semibold', compact ? 'max-w-[120px]' : 'max-w-[220px]')} title={variant.label}>{variant.label}</span>
      {variant.aiGenerated && <span className="lims-pill lims-pill-ai shrink-0">AI</span>}
    </div>
  );
}

function isDimmed(variantId: string, hoveredVariantId: string | null, activeVariantIds: Set<string>): boolean {
  if (!activeVariantIds.has(variantId)) return true;
  return hoveredVariantId !== null && hoveredVariantId !== variantId;
}

function BarsChart({ variants, samples, colors, metric, maxValue, valueFor, hoveredVariantId, activeVariantIds, onHoverVariant, onTip }: ChartProps) {
  const minWidth = Math.max(720, 180 + samples.length * 96);
  return (
    <div className="overflow-x-auto p-3">
      <div className="space-y-3" style={{ minWidth }}>
        <div className="grid gap-2 text-[10px] uppercase tracking-wide text-[var(--text-faint)]" style={{ gridTemplateColumns: `180px repeat(${samples.length}, minmax(84px, 1fr))` }}>
          <div>Variant</div>
          {samples.map(sample => <div key={sample.id} className="truncate text-center" title={`${sampleLabel(sample)}\n${sampleSubtitle(sample)}`}>{sampleLabel(sample)}</div>)}
        </div>
        {variants.map((variant, idx) => {
          const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
          const dim = isDimmed(variant.variantId, hoveredVariantId, activeVariantIds);
          return (
            <div key={variant.variantId} className={cn('grid items-center gap-2 rounded-lg px-2 py-1.5 transition-colors', hoveredVariantId === variant.variantId && 'bg-[var(--accent-50)]')} style={{ gridTemplateColumns: `180px repeat(${samples.length}, minmax(84px, 1fr))` }} onMouseEnter={() => onHoverVariant(variant.variantId)} onMouseLeave={() => onHoverVariant(null)}>
              <VariantLabel variant={variant} color={color} rank={idx + 1} />
              {samples.map(sample => {
                const value = valueFor(sample.id, variant.variantId);
                const width = value > 0 ? Math.max(2, (value / maxValue) * 100) : 0;
                return (
                  <div key={sample.id} className="min-w-0" onMouseEnter={event => onTip(event, `${variant.label}\n${sampleLabel(sample)}\n${fmtValue(value, metric)}`)}>
                    <div className="h-7 rounded bg-[var(--surface-3)] p-1 ring-1 ring-inset ring-[var(--border)]">
                      <div className="flex h-full items-center justify-end rounded px-1 text-[10px] font-semibold tabular-nums transition-opacity" style={{ width: `${width}%`, minWidth: value > 0 ? 6 : 0, backgroundColor: color, color: textColorFor(color), opacity: dim ? 0.18 : 1 }}>
                        {width > 34 ? fmtValue(value, metric) : ''}
                      </div>
                    </div>
                    <div className="mt-0.5 truncate text-right text-[10px] tabular-nums text-[var(--text-faint)]">{width <= 34 ? fmtValue(value, metric) : ''}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChartProps {
  variants: VariantWithStats[];
  samples: MutationSample[];
  colors: Map<string, string>;
  metric: MetricMode;
  maxValue: number;
  valueFor: (sampleId: string, variantId: string) => number;
  hoveredVariantId: string | null;
  activeVariantIds: Set<string>;
  onHoverVariant: (variantId: string | null) => void;
  onTip: (event: React.MouseEvent<HTMLElement | SVGElement>, text: string) => void;
}

function HeatmapChart({ variants, samples, colors, metric, maxValue, valueFor, hoveredVariantId, activeVariantIds, onHoverVariant, onTip }: ChartProps) {
  return (
    <div className="overflow-auto p-3">
      <div className="mb-3 flex items-center gap-2 text-[11px] text-[var(--text-soft)]">
        <span className="lims-label">Scale</span>
        <span>0</span><span className="h-2 w-32 rounded bg-gradient-to-r from-[var(--surface-3)] to-[var(--accent-600)] ring-1 ring-[var(--border)]" /><span>{fmtValue(maxValue, metric)}</span>
      </div>
      <table className="border-separate text-[11px]" style={{ borderSpacing: 0 }}>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[190px] border-b border-r border-[var(--border)] bg-[var(--surface)] p-2 text-left text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Variant</th>
            {samples.map(sample => (
              <th key={sample.id} className="sticky top-0 z-20 h-28 min-w-[74px] max-w-[74px] border-b border-l border-[var(--border)] bg-[var(--surface)] p-1 align-bottom">
                <div className="flex h-24 items-end justify-center">
                  <div className="w-20 -rotate-55 truncate text-left font-mono text-[10.5px] text-[var(--text)]" title={`${sampleLabel(sample)}\n${sampleSubtitle(sample)}`}>{sampleLabel(sample)}</div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((variant, idx) => {
            const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
            const dim = isDimmed(variant.variantId, hoveredVariantId, activeVariantIds);
            return (
              <tr key={variant.variantId} onMouseEnter={() => onHoverVariant(variant.variantId)} onMouseLeave={() => onHoverVariant(null)}>
                <td className={cn('sticky left-0 z-10 border-b border-r border-[var(--border)] bg-[var(--surface)] p-2', hoveredVariantId === variant.variantId && 'bg-[var(--accent-50)]')}><VariantLabel variant={variant} color={color} rank={idx + 1} /></td>
                {samples.map(sample => {
                  const value = valueFor(sample.id, variant.variantId);
                  const alpha = Math.max(0.04, Math.min(1, value / maxValue));
                  return (
                    <td key={sample.id} className="border-b border-l border-[var(--border)] p-0.5 text-center" onMouseEnter={event => onTip(event, `${variant.label}\n${sampleLabel(sample)}\n${fmtValue(value, metric)}`)}>
                      <div className="flex h-8 min-w-[64px] items-center justify-center rounded text-[10px] font-semibold tabular-nums transition-opacity" style={{ backgroundColor: `color-mix(in srgb, ${color} ${Math.round(alpha * 82)}%, var(--surface))`, color: alpha > 0.55 ? textColorFor(color) : 'var(--text)', opacity: dim ? 0.18 : 1 }}>
                        {fmtValue(value, metric)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LinesChart({ variants, samples, colors, metric, maxValue, valueFor, hoveredVariantId, activeVariantIds, onHoverVariant, onTip }: ChartProps) {
  const width = Math.max(760, samples.length * 82 + 120);
  const height = 360;
  const pad = { l: 58, r: 24, t: 22, b: 84 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  return (
    <div className="overflow-x-auto p-3">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label="Library variant trajectories" style={{ minWidth: width }}>
        {[0, 0.25, 0.5, 0.75, 1].map(tick => {
          const y = pad.t + innerH - tick * innerH;
          return <g key={tick}><line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--border)" /><text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--text-faint)">{fmtValue(maxValue * tick, metric)}</text></g>;
        })}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + innerH} stroke="var(--border-strong)" />
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} stroke="var(--border-strong)" />
        {variants.map(variant => {
          const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
          const points = samples.map((sample, idx) => {
            const x = samples.length === 1 ? pad.l + innerW / 2 : pad.l + (idx / (samples.length - 1)) * innerW;
            const value = valueFor(sample.id, variant.variantId);
            const y = pad.t + innerH - (value / maxValue) * innerH;
            return { x, y, value, sample };
          });
          const dim = isDimmed(variant.variantId, hoveredVariantId, activeVariantIds);
          const focused = hoveredVariantId === variant.variantId;
          return (
            <g key={variant.variantId} onMouseEnter={() => onHoverVariant(variant.variantId)} onMouseLeave={() => onHoverVariant(null)}>
              <polyline fill="none" stroke={color} strokeWidth={focused ? 3.5 : variant.aiGenerated ? 2.6 : 2.2} strokeDasharray={variant.aiGenerated ? '6 4' : undefined} points={points.map(point => `${point.x},${point.y}`).join(' ')} opacity={dim ? 0.16 : 0.92} />
              {points.map(point => <circle key={`${variant.variantId}-${point.sample.id}`} cx={point.x} cy={point.y} r={focused ? 4.5 : 3.2} fill={color} stroke="var(--surface)" strokeWidth="1.5" opacity={dim ? 0.16 : 1} onMouseEnter={event => onTip(event, `${variant.label}\n${sampleLabel(point.sample)}\n${fmtValue(point.value, metric)}`)} />)}
            </g>
          );
        })}
        {samples.map((sample, idx) => {
          const x = samples.length === 1 ? pad.l + innerW / 2 : pad.l + (idx / (samples.length - 1)) * innerW;
          return <text key={sample.id} x={x} y={height - 18} textAnchor="end" transform={`rotate(-38 ${x} ${height - 18})`} fontSize="10" fill="var(--text-soft)">{sampleLabel(sample).slice(0, 18)}</text>;
        })}
      </svg>
    </div>
  );
}

function VariantLegend({ variants, colors, isolated, hoveredVariantId, onHover, onToggle }: { variants: VariantWithStats[]; colors: Map<string, string>; isolated: Set<string>; hoveredVariantId: string | null; onHover: (variantId: string | null) => void; onToggle: (variantId: string) => void }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]"><span className="font-semibold text-[var(--text)]">Interactive legend</span><span className="text-[11px] text-[var(--text-soft)]">Hover to highlight. Click to isolate one or more variants.</span>{isolated.size > 0 && <span className="lims-chip lims-chip-accent">{isolated.size} isolated</span>}</div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto pr-1">
        {variants.map(variant => {
          const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
          const pressed = isolated.has(variant.variantId);
          const dim = hoveredVariantId !== null && hoveredVariantId !== variant.variantId;
          return (
            <button key={variant.variantId} type="button" aria-pressed={pressed} onClick={() => onToggle(variant.variantId)} onMouseEnter={() => onHover(variant.variantId)} onMouseLeave={() => onHover(null)} className={cn('lims-toggle max-w-full !py-1', pressed && 'ring-1 ring-[var(--accent-500)]', dim && 'opacity-45')} data-on={pressed} title={variant.label}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="truncate font-mono">{variant.label}</span>
              {variant.aiGenerated && <span className="lims-pill lims-pill-ai">AI</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetadataPanel({ variants, colors, expanded, setExpanded, hoveredVariantId, onHover, onCopy, sampleCount }: { variants: VariantWithStats[]; colors: Map<string, string>; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; hoveredVariantId: string | null; onHover: (variantId: string | null) => void; onCopy: (value: string) => void; sampleCount: number }) {
  const toggleExpanded = (id: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <aside className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <div className="font-semibold text-[13px] text-[var(--text)]">Variant metadata</div>
        <div className="text-[11px] text-[var(--text-soft)]">Library_candidates fields for the visible Top N set.</div>
      </div>
      <div className="max-h-[680px] overflow-auto p-2">
        <table className="w-full table-fixed border-separate text-[11px]" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10 bg-[var(--surface)] text-left text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            <tr><th className="w-[42%] border-b border-[var(--border)] p-1.5">Variant</th><th className="w-[22%] border-b border-[var(--border)] p-1.5">Library</th><th className="w-[28%] border-b border-[var(--border)] p-1.5">verA / verB</th><th className="w-[8%] border-b border-[var(--border)] p-1.5" /></tr>
          </thead>
          <tbody>
            {variants.map((variant, idx) => {
              const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
              const isOpen = expanded.has(variant.variantId);
              const meta = variant.metadata;
              const library = metadataText(meta.Library ?? variant.library);
              const aName = metadataText(meta.verA_name || meta.verA);
              const bName = metadataText(meta.verB_name || meta.verB);
              const aType = metadataText(meta.verA_type);
              const bType = metadataText(meta.verB_type);
              const focused = hoveredVariantId === variant.variantId;
              return (
                <React.Fragment key={variant.variantId}>
                  <tr className={cn('transition-colors', focused ? 'bg-[var(--accent-50)]' : 'hover:bg-[var(--surface-2)]')} onMouseEnter={() => onHover(variant.variantId)} onMouseLeave={() => onHover(null)}>
                    <td className="border-b border-[var(--border)] p-1.5 align-top"><VariantLabel variant={variant} color={color} rank={idx + 1} compact /><div className="mt-1 text-[10px] tabular-nums text-[var(--text-faint)]">present {variant.present}/{sampleCount} · max {fmtValue(variant.maxAbundance, 'abundance')}</div></td>
                    <MetaCell value={library} onCopy={onCopy} />
                    <td className="border-b border-[var(--border)] p-1.5 align-top"><div className="truncate" title={aName}>{aName || '—'}</div><div className="truncate text-[var(--text-faint)]" title={aType}>{aType}</div><div className="mt-1 truncate" title={bName}>{bName || '—'}</div><div className="truncate text-[var(--text-faint)]" title={bType}>{bType}</div></td>
                    <td className="border-b border-[var(--border)] p-1.5 align-top"><button type="button" onClick={() => toggleExpanded(variant.variantId)} className="rounded p-1 hover:bg-[var(--surface-3)]" title="Show full metadata">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button></td>
                  </tr>
                  {isOpen && <tr><td colSpan={4} className="border-b border-[var(--border)] bg-[var(--surface-2)] p-2"><ExpandedMetadata metadata={meta} onCopy={onCopy} /></td></tr>}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

function MetaCell({ value, onCopy }: { value: string; onCopy: (value: string) => void }) {
  return (
    <td className="min-w-0 border-b border-[var(--border)] p-1.5 align-top">
      <div className="flex min-w-0 items-center gap-1">
        <span className="truncate" title={value}>{value || '—'}</span>
        {value && <button type="button" onClick={() => onCopy(value)} className="shrink-0 rounded p-0.5 text-[var(--text-faint)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]" title="Copy full value"><Clipboard className="h-3 w-3" /></button>}
      </div>
    </td>
  );
}

function ExpandedMetadata({ metadata, onCopy }: { metadata: Record<string, unknown>; onCopy: (value: string) => void }) {
  const entries = Object.entries(metadata).filter(([, value]) => value != null && value !== '');
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => {
        const parsed = key === 'verA_metadata' || key === 'verB_metadata' ? parseMetadataJson(value) : null;
        if (parsed && typeof parsed === 'object') {
          return (
            <details key={key} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2" open>
              <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text)]">{key.replaceAll('_', ' ')}</summary>
              <div className="mt-2 grid grid-cols-[100px_minmax(0,1fr)] gap-1">
                {Object.entries(parsed).map(([subKey, subValue]) => <MetadataPair key={subKey} k={subKey} v={metadataText(subValue)} onCopy={onCopy} />)}
              </div>
            </details>
          );
        }
        return <MetadataPair key={key} k={key} v={metadataText(parsed ?? value)} onCopy={onCopy} />;
      })}
    </div>
  );
}

function MetadataPair({ k, v, onCopy }: { k: string; v: string; onCopy: (value: string) => void }) {
  return (
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-1 text-[10.5px]">
      <div className="truncate text-[var(--text-faint)]" title={k}>{k.replaceAll('_', ' ')}</div>
      <div className="flex min-w-0 items-center gap-1"><span className="truncate" title={v}>{v || '—'}</span>{v && <button type="button" onClick={() => onCopy(v)} className="shrink-0 rounded p-0.5 text-[var(--text-faint)] hover:bg-[var(--surface-3)]"><Clipboard className="h-3 w-3" /></button>}</div>
    </div>
  );
}

function FloatingTooltip({ tip }: { tip: HoverTip }) {
  return (
    <div className="pointer-events-none absolute z-40 rounded bg-slate-900/95 px-2 py-1 font-mono text-[11px] text-white shadow-lg ring-1 ring-black/20" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.flipX ? 'calc(-100% - 18px)' : '18px'}, ${tip.flipY ? '20px' : 'calc(-100% - 14px)'})`, whiteSpace: 'pre' }}>
      {tip.text}
    </div>
  );
}
