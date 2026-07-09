'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart3, ChevronDown, ChevronRight, ChevronUp, Clipboard,
  Download, Grid3X3, Info, Loader2, Sparkles, X,
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
  verAaiGenerated?: boolean;
  verBaiGenerated?: boolean;
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

type ChartMode = 'bars' | 'heatmap';
type MetricMode = 'abundance' | 'count';
type SortKey = 'experiment' | 'condition' | 'strain' | 'dna' | 'replicate' | 'transfer';
type HoverTip = { x: number; y: number; text: string; flipX: boolean; flipY: boolean };
type VariantWithStats = LibraryVariant & { totalAbundance: number; totalCount: number; maxAbundance: number; maxCount: number; present: number };
type VariantSortMode = 'total' | 'alpha';
type ColumnBand = { levelKey: SortKey; levelLabel: string; cells: { key: string; label: string; colCount: number; rows: MutationSample[]; fullRows: MutationSample[] }[] };

const SORT_LEVELS: readonly { key: SortKey; label: string }[] = [
  { key: 'experiment', label: 'Experiment' },
  { key: 'condition', label: 'Condition' },
  { key: 'strain', label: 'Strain' },
  { key: 'dna', label: 'DNA' },
  { key: 'replicate', label: 'Replicate' },
  { key: 'transfer', label: 'Transfer' },
];
const SORT_LEVEL_BY_KEY = new Map(SORT_LEVELS.map(level => [level.key, level]));
const DEFAULT_SORT: SortKey[] = ['experiment', 'condition', 'strain', 'dna', 'replicate', 'transfer'];
const TOP_OPTIONS = [10, 20, 50, 0] as const;
const GOLDEN = 137.508;
const FILL_SAT = 45;
const FILL_LIGHT = 52;
const BAR_COL_W = 58;
const BAR_PAD_L = 64;
const BAR_PAD_R = 26;
const BAR_PAD_T = 18;
const BAR_PAD_B = 92;
const HEATMAP_BAND_H = 24;

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

function boolFromUnknown(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
  }
  return false;
}

function variantAiA(variant: LibraryVariant): boolean {
  return boolFromUnknown(variant.verAaiGenerated ?? variant.metadata['verA AI-generated']);
}

function variantAiB(variant: LibraryVariant): boolean {
  return boolFromUnknown(variant.verBaiGenerated ?? variant.metadata['verB AI-generated']);
}

function variantHasPartnerAi(variant: LibraryVariant): boolean {
  return variantAiA(variant) || variantAiB(variant) || boolFromUnknown(variant.aiGenerated);
}

function groupValue(sample: MutationSample, key: SortKey): string | number | null {
  if (key === 'experiment') return sample.experiment || null;
  if (key === 'condition') return sample.condition || null;
  if (key === 'strain') return sample.strain || null;
  if (key === 'dna') return sample.donor_dna || null;
  if (key === 'replicate') return sample.replicate || null;
  return typeof sample.transfer === 'number' ? sample.transfer : null;
}

function groupLabel(sample: MutationSample, key: SortKey): string {
  const value = groupValue(sample, key);
  if (value == null || value === '') return 'none';
  return key === 'transfer' ? `T${value}` : String(value);
}

function compareSamples(order: SortKey[]) {
  return (a: MutationSample, b: MutationSample): number => {
    for (const key of order) {
      const av = groupValue(a, key);
      const bv = groupValue(b, key);
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
  return [sample.experiment, sample.condition, sample.strain, sample.donor_dna, sample.replicate ? `Rep ${sample.replicate}` : null, typeof sample.transfer === 'number' ? `T${sample.transfer}` : null]
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
  const [variantSort, setVariantSort] = useState<VariantSortMode>('total');
  const [showHeatmapValues, setShowHeatmapValues] = useState(false);
  const [showGroupedHeaders, setShowGroupedHeaders] = useState(true);
  const [sortOrder, setSortOrder] = useState<SortKey[]>(DEFAULT_SORT);
  const [hoveredVariantId, setHoveredVariantId] = useState<string | null>(null);
  const [isolatedVariantIds, setIsolatedVariantIds] = useState<Set<string>>(() => new Set());
  // Snapshot of legend state saved during export so figures render un-muted.
  const exportRestore = useRef<{ hovered: string | null; isolated: Set<string> } | null>(null);
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
      .sort((a, b) => {
        if (variantSort === 'alpha') return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
        return (effectiveMetric === 'count' ? b.totalCount - a.totalCount : b.totalAbundance - a.totalAbundance) || a.label.localeCompare(b.label, undefined, { numeric: true });
      });
  }, [dataset, measurements, effectiveMetric, variantSort]);

  const visibleVariants = useMemo(() => topN <= 0 ? rankedVariants : rankedVariants.slice(0, topN), [rankedVariants, topN]);
  const visibleVariantIds = useMemo(() => new Set(visibleVariants.map(variant => variant.variantId)), [visibleVariants]);
  const maxValue = useMemo(() => Math.max(0.000001, ...visibleVariants.flatMap(variant => selectedSamples.map(sample => {
    const cell = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`);
    return effectiveMetric === 'count' ? cell?.count ?? 0 : cell?.abundance ?? 0;
  }))), [effectiveMetric, selectedSamples, valueBySampleVariant, visibleVariants]);
  const colors = useMemo(() => new Map(visibleVariants.map(variant => [variant.variantId, colorForCandidate(variant.label)])), [visibleVariants]);
  const activeVariantIds = isolatedVariantIds.size > 0 ? isolatedVariantIds : visibleVariantIds;
  const aiCount = visibleVariants.filter(variantHasPartnerAi).length;
  const verAAiCount = visibleVariants.filter(variantAiA).length;
  const verBAiCount = visibleVariants.filter(variantAiB).length;
  const anyAi = aiCount > 0;
  const columnBands = useMemo<ColumnBand[]>(() => buildColumnBands(selectedSamples, selectedSamples, sortOrder), [selectedSamples, sortOrder]);
  const topMeanVariant = useMemo(() => {
    if (visibleVariants.length === 0 || selectedSamples.length === 0) return null;
    return visibleVariants.reduce<{ variant: VariantWithStats; mean: number } | null>((best, variant) => {
      const total = selectedSamples.reduce((sum, sample) => {
        const cell = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`);
        return sum + (effectiveMetric === 'count' ? cell?.count ?? 0 : cell?.abundance ?? 0);
      }, 0);
      const mean = total / Math.max(1, selectedSamples.length);
      return !best || mean > best.mean ? { variant, mean } : best;
    }, null);
  }, [effectiveMetric, selectedSamples, valueBySampleVariant, visibleVariants]);
  const valueRange = useMemo(() => {
    const values = visibleVariants.flatMap(variant => selectedSamples.map(sample => {
      const cell = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`);
      return effectiveMetric === 'count' ? cell?.count ?? 0 : cell?.abundance ?? 0;
    }));
    if (values.length === 0) return 'n/a';
    return `${fmtValue(Math.min(...values), effectiveMetric)} to ${fmtValue(Math.max(...values), effectiveMetric)}`;
  }, [effectiveMetric, selectedSamples, valueBySampleVariant, visibleVariants]);

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
    const header = ['variant', 'library', 'ai_generated', 'verA_ai_generated', 'verB_ai_generated', 'metric', ...selectedSamples.map(sampleLabel)];
    const rows = visibleVariants.map(variant => [
      variant.label,
      metadataText(variant.metadata.Library ?? variant.library),
      variantHasPartnerAi(variant) ? 'yes' : 'no',
      variantAiA(variant) ? 'yes' : 'no',
      variantAiB(variant) ? 'yes' : 'no',
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
                Compares verAB library-variant abundance across your selected samples. Colors are stable per variant identity, grouped headers follow the sample sort priority, and AI badges mark the specific verA or verB partner from Library_candidates metadata.
              </InfoPopover>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-soft)]">Barcode-style vertical bars and heatmap, sortable experimental-factor headers, CSV export, figure export, and Library_candidates metadata in one view.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <Stat value={selectedSamples.length.toLocaleString()} label="samples" />
            <Stat value={visibleVariants.length.toLocaleString()} label={topN <= 0 ? 'variants' : `of ${rankedVariants.length}`} />
            <Stat value={aiCount.toLocaleString()} label="AI variants" />
            <Stat value={`${verAAiCount}/${verBAiCount}`} label="verA/verB AI" />
            <Stat value={topMeanVariant ? fmtValue(topMeanVariant.mean, effectiveMetric) : 'n/a'} label="top mean" />
            <Stat value={valueRange} label="range" />
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2" data-figure-omit>
          <div className="flex items-center gap-1">
            <ModeButton active={mode === 'bars'} onClick={() => setMode('bars')} icon={<BarChart3 className="h-3.5 w-3.5" />}>Vertical bars</ModeButton>
            <ModeButton active={mode === 'heatmap'} onClick={() => setMode('heatmap')} icon={<Grid3X3 className="h-3.5 w-3.5" />}>Heatmap</ModeButton>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-soft)]">
            <span className="lims-label">Top variants</span>
            <select className="lims-select" value={topN} onChange={event => setTopN(Number(event.target.value))}>
              {TOP_OPTIONS.map(option => <option key={option} value={option}>{option === 0 ? 'All' : `Top ${option}`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-soft)]">
            <span className="lims-label">Sort variants</span>
            <select className="lims-select" value={variantSort} onChange={event => setVariantSort(event.target.value as VariantSortMode)}>
              <option value="total">Total abundance desc</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </label>
          <button type="button" className="lims-toggle" data-on={showGroupedHeaders} onClick={() => setShowGroupedHeaders(value => !value)}>Grouped headers</button>
          {mode === 'heatmap' && (
            <button type="button" className="lims-toggle" data-on={showHeatmapValues} onClick={() => setShowHeatmapValues(value => !value)}>Show values</button>
          )}
          {hasCounts && (
            <div className="flex items-center gap-1">
              <button type="button" className="lims-toggle" data-on={effectiveMetric === 'abundance'} onClick={() => setMetric('abundance')}>Relative %</button>
              <button type="button" className="lims-toggle" data-on={effectiveMetric === 'count'} onClick={() => setMetric('count')}>Count</button>
            </div>
          )}
          <button type="button" onClick={exportCsv} className="lims-btn lims-btn-secondary" disabled={visibleVariants.length === 0} title="Export the current variant by sample matrix as CSV">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <ExportFigureMenu
            getTarget={() => figureRef.current}
            title={`AI-ALE library variants ${mode}`}
            filenameBase={`library-variants-${mode}-${effectiveMetric}`}
            disabled={visibleVariants.length === 0}
            compact
            onBeforeExport={() => { exportRestore.current = { hovered: hoveredVariantId, isolated: isolatedVariantIds }; setHoveredVariantId(null); setIsolatedVariantIds(new Set()); }}
            onAfterExport={() => { const r = exportRestore.current; if (r) { setHoveredVariantId(r.hovered); setIsolatedVariantIds(r.isolated); exportRestore.current = null; } }}
          />
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
                  <span className="font-semibold text-[var(--text)]">{mode === 'bars' ? 'Vertical stacked bars' : 'Variant heatmap'}</span>
                  <span className="lims-chip">{visibleVariants.length} variants</span>
                  <span className="lims-chip">{selectedSamples.length} samples</span>
                  {topMeanVariant && <span className="lims-chip" title={topMeanVariant.variant.label}>Top mean: {topMeanVariant.variant.label}</span>}
                  {anyAi && <span className="lims-pill lims-pill-ai">AI badge marks the specific verA or verB partner</span>}
                </div>
              </div>
              {mode === 'bars' && <BarsChart variants={visibleVariants} samples={selectedSamples} colors={colors} metric={effectiveMetric} maxValue={maxValue} valueFor={valueFor} hoveredVariantId={hoveredVariantId} activeVariantIds={activeVariantIds} onHoverVariant={setHoveredVariantId} onTip={setTipFromPointer} columnBands={columnBands} showGroupedHeaders={showGroupedHeaders} />}
              {mode === 'heatmap' && <HeatmapChart variants={visibleVariants} samples={selectedSamples} colors={colors} metric={effectiveMetric} maxValue={maxValue} valueFor={valueFor} hoveredVariantId={hoveredVariantId} activeVariantIds={activeVariantIds} onHoverVariant={setHoveredVariantId} onTip={setTipFromPointer} showValues={showHeatmapValues} columnBands={columnBands} showGroupedHeaders={showGroupedHeaders} />}
            </div>
            {mode === 'bars' && <VariantLegend variants={visibleVariants} colors={colors} isolated={isolatedVariantIds} hoveredVariantId={hoveredVariantId} onHover={setHoveredVariantId} onToggle={toggleIsolated} />}
          </div>

          <MetadataPanel variants={visibleVariants} colors={colors} expanded={expandedMetadata} setExpanded={setExpandedMetadata} hoveredVariantId={hoveredVariantId} onHover={setHoveredVariantId} onCopy={copyValue} sampleCount={selectedSamples.length} />
        </div>
      </section>
    </div>
  );
}

function buildColumnBands(visibleSamples: MutationSample[], allSamples: MutationSample[], groupOrder: SortKey[]): ColumnBand[] {
  return groupOrder.map((levelKey, levelIdx) => {
    const cells: ColumnBand['cells'] = [];
    for (const sample of visibleSamples) {
      const composite = groupOrder.slice(0, levelIdx + 1).map(key => metadataText(groupValue(sample, key))).join('||');
      const label = groupLabel(sample, levelKey);
      const prev = cells[cells.length - 1];
      if (prev?.key === composite) {
        prev.colCount += 1;
        prev.rows.push(sample);
      } else {
        const fullRows = allSamples.filter(full => groupOrder.slice(0, levelIdx + 1).map(key => metadataText(groupValue(full, key))).join('||') === composite);
        cells.push({ key: composite, label, colCount: 1, rows: [sample], fullRows });
      }
    }
    return { levelKey, levelLabel: SORT_LEVEL_BY_KEY.get(levelKey)?.label ?? levelKey, cells };
  });
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
      <span className="lims-label mr-1" title="Samples are sorted by the enabled factors from priority 1 onward. Grouped chart headers use the same order.">Sort and group samples by</span>
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

function AiBadge() {
  return <span className="lims-pill lims-pill-ai shrink-0 !px-1 !py-0 text-[8px] leading-3 opacity-90">AI</span>;
}

function VariantLabel({ variant, color, rank, compact = false }: { variant: LibraryVariant; color: string; rank?: number; compact?: boolean }) {
  const parsed = parseCandidate(variant.label);
  const meta = variant.metadata;
  const aLabel = metadataText(meta.verA_name) || parsed?.a || metadataText(meta.verA);
  const bLabel = metadataText(meta.verB_name) || parsed?.b || metadataText(meta.verB);
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={`${variant.label}\nverA: ${aLabel || 'unknown'} ${variantAiA(variant) ? '(AI-generated)' : '(not AI-generated)'}\nverB: ${bLabel || 'unknown'} ${variantAiB(variant) ? '(AI-generated)' : '(not AI-generated)'}`}>
      {rank != null && <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-faint)]">{rank}.</span>}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />
      {parsed ? (
        <span className={cn('grid shrink min-w-0 grid-cols-1 gap-0.5 font-mono leading-none', compact ? 'w-[74px]' : 'w-[92px]')}>
          <span className="flex min-w-0 items-center gap-0.5 rounded bg-[var(--surface-3)] px-1 py-0.5 text-[9.5px] font-semibold text-[var(--text)]"><span className="truncate">{parsed.a}</span>{variantAiA(variant) && <AiBadge />}</span>
          <span className="flex min-w-0 items-center gap-0.5 rounded bg-[var(--surface-3)] px-1 py-0.5 text-[9.5px] font-semibold text-[var(--text)]"><span className="truncate">{parsed.b}</span>{variantAiB(variant) && <AiBadge />}</span>
        </span>
      ) : (
        <span className={cn('lims-id truncate font-semibold', compact ? 'max-w-[120px]' : 'max-w-[220px]')}>{variant.label}</span>
      )}
    </div>
  );
}

function isDimmed(variantId: string, hoveredVariantId: string | null, activeVariantIds: Set<string>): boolean {
  if (!activeVariantIds.has(variantId)) return true;
  return hoveredVariantId !== null && hoveredVariantId !== variantId;
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
  columnBands: ColumnBand[];
  showGroupedHeaders: boolean;
}

function BandsHeaderStrip({ bands, sampleCount, colWidth, padLeft, padRight }: { bands: ColumnBand[]; sampleCount: number; colWidth: number; padLeft: number; padRight: number }) {
  const gridTemplateColumns = `${padLeft}px repeat(${sampleCount}, ${colWidth}px) ${padRight}px`;
  return (
    <div className="space-y-0.5 text-[9px] uppercase tracking-wide text-[var(--text-faint)]" style={{ width: padLeft + sampleCount * colWidth + padRight }}>
      {bands.map(band => (
        <div key={band.levelKey} className="grid gap-0.5" style={{ gridTemplateColumns }}>
          <div className="flex items-center justify-end pr-2 font-semibold">{band.levelLabel}</div>
          {band.cells.map(cell => (
            <div key={cell.key} className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-center" style={{ gridColumn: `span ${cell.colCount}` }} title={`${band.levelLabel}: ${cell.label}\n${cell.rows.length} sample${cell.rows.length === 1 ? '' : 's'}`}>
              <div className="truncate">{cell.label}</div>
            </div>
          ))}
          <div />
        </div>
      ))}
    </div>
  );
}

function BarsChart({ variants, samples, colors, metric, maxValue, valueFor, hoveredVariantId, activeVariantIds, onHoverVariant, onTip, columnBands, showGroupedHeaders }: ChartProps) {
  const chartHeight = 390;
  const width = Math.max(720, BAR_PAD_L + samples.length * BAR_COL_W + BAR_PAD_R);
  const innerH = chartHeight - BAR_PAD_T - BAR_PAD_B;
  const baseY = BAR_PAD_T + innerH;
  const sampleTotals = samples.map(sample => variants.reduce((sum, variant) => sum + valueFor(sample.id, variant.variantId), 0));
  const yMax = Math.max(maxValue, ...sampleTotals, metric === 'abundance' ? 0.01 : 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const groupComposites = samples.map(sample => columnBands[0]?.cells.find(cell => cell.rows.some(row => row.id === sample.id))?.key ?? '');
  return (
    <div className="overflow-x-auto p-3">
      <div className="space-y-2" style={{ width }}>
        {showGroupedHeaders && <BandsHeaderStrip bands={columnBands} sampleCount={samples.length} colWidth={BAR_COL_W} padLeft={BAR_PAD_L} padRight={BAR_PAD_R} />}
        <svg width={width} height={chartHeight} role="img" aria-label="Library variant vertical stacked bars">
          {ticks.map(tick => {
            const y = baseY - tick * innerH;
            return <g key={tick}><line x1={BAR_PAD_L} x2={width - BAR_PAD_R} y1={y} y2={y} stroke="var(--border)" /><text x={BAR_PAD_L - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--text-faint)">{fmtValue(yMax * tick, metric)}</text></g>;
          })}
          <text x={14} y={BAR_PAD_T + innerH / 2} transform={`rotate(-90 14 ${BAR_PAD_T + innerH / 2})`} textAnchor="middle" fontSize="10" fill="var(--text-soft)">{metric === 'count' ? 'count' : 'relative abundance'}</text>
          <line x1={BAR_PAD_L} x2={BAR_PAD_L} y1={BAR_PAD_T} y2={baseY} stroke="var(--border-strong)" />
          <line x1={BAR_PAD_L} x2={width - BAR_PAD_R} y1={baseY} y2={baseY} stroke="var(--border-strong)" />
          {samples.slice(1).map((sample, idx) => {
            if (groupComposites[idx] === groupComposites[idx + 1]) return null;
            const x = BAR_PAD_L + (idx + 1) * BAR_COL_W;
            return <line key={`div-${sample.id}`} x1={x} x2={x} y1={BAR_PAD_T} y2={baseY + 8} stroke="var(--border-strong)" strokeDasharray="4 4" opacity="0.7" />;
          })}
          {samples.map((sample, sampleIdx) => {
            const slotX = BAR_PAD_L + sampleIdx * BAR_COL_W;
            const barW = Math.min(34, BAR_COL_W * 0.62);
            const x = slotX + (BAR_COL_W - barW) / 2;
            let yCursor = baseY;
            return (
              <g key={sample.id}>
                {variants.map(variant => {
                  const value = valueFor(sample.id, variant.variantId);
                  if (value <= 0) return null;
                  const h = Math.max(0.5, (value / yMax) * innerH);
                  yCursor -= h;
                  const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
                  const dim = isDimmed(variant.variantId, hoveredVariantId, activeVariantIds);
                  return (
                    <rect key={variant.variantId} x={x} y={yCursor} width={barW} height={h} rx={h > 4 ? 1.5 : 0} fill={color} opacity={dim ? 0.18 : 0.92} stroke="rgba(15,23,42,0.18)" strokeWidth={h > 6 ? 0.4 : 0} onMouseEnter={event => { onHoverVariant(variant.variantId); onTip(event, `${variant.label}\n${sampleLabel(sample)}\n${fmtValue(value, metric)}\nverA: ${variantAiA(variant) ? 'AI-generated' : 'not AI-generated'}\nverB: ${variantAiB(variant) ? 'AI-generated' : 'not AI-generated'}`); }} />
                  );
                })}
                <text x={slotX + BAR_COL_W / 2} y={baseY + 18} textAnchor="end" transform={`rotate(-42 ${slotX + BAR_COL_W / 2} ${baseY + 18})`} fontSize="10" fill="var(--text-soft)">{sampleLabel(sample).slice(0, 18)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function HeatmapChart({ variants, samples, colors, metric, maxValue, valueFor, hoveredVariantId, onHoverVariant, onTip, showValues, columnBands, showGroupedHeaders }: ChartProps & { showValues: boolean }) {
  const bandRows = showGroupedHeaders ? columnBands : [];
  const headerTop = bandRows.length * HEATMAP_BAND_H;
  return (
    <div className="overflow-auto p-3">
      <div className="sticky left-0 mb-3 flex w-fit items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-soft)]">
        <span className="lims-label">Color scale</span>
        <span>0</span><span className="relative h-3 w-36 overflow-hidden rounded bg-[var(--surface-3)] ring-1 ring-[var(--border)]"><span className="absolute inset-0 bg-[var(--accent-600)] opacity-25" /><span className="absolute inset-y-0 right-0 w-1/3 bg-[var(--accent-600)] opacity-90" /></span><span>{fmtValue(maxValue, metric)}</span>
      </div>
      <table className="border-separate text-[11px]" style={{ borderSpacing: 2 }}>
        <thead>
          {bandRows.map((band, idx) => (
            <tr key={band.levelKey}>
              <th className="sticky left-0 z-40 min-w-[110px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-left text-[9px] uppercase tracking-wide text-[var(--text-faint)]" style={{ top: idx * HEATMAP_BAND_H }}>{band.levelLabel}</th>
              {band.cells.map(cell => (
                <th key={cell.key} colSpan={cell.colCount} className="sticky z-30 max-w-[180px] border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-center text-[9px] uppercase tracking-wide text-[var(--text-faint)]" style={{ top: idx * HEATMAP_BAND_H }} title={`${band.levelLabel}: ${cell.label}\n${cell.rows.length} sample${cell.rows.length === 1 ? '' : 's'}`}>
                  <div className="truncate">{cell.label}</div>
                </th>
              ))}
            </tr>
          ))}
          <tr>
            <th className="sticky left-0 z-40 h-28 min-w-[110px] border border-[var(--border)] bg-[var(--surface)] p-2 text-left align-bottom text-[10px] uppercase tracking-wide text-[var(--text-faint)]" style={{ top: headerTop }}>sample_name</th>
            {samples.map(sample => (
              <th key={sample.id} className="sticky z-30 h-28 min-w-[34px] max-w-[34px] border border-[var(--border)] bg-[var(--surface)] p-0 align-bottom" style={{ top: headerTop }}>
                <div className="flex h-28 w-[34px] items-end justify-center pb-1">
                  {/* Vertical (not slanted) so the full sample_name fits the column box. */}
                  <div className="max-h-[104px] truncate font-mono text-[10px] leading-none text-[var(--text)]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }} title={`${sampleLabel(sample)}\n${sampleSubtitle(sample)}`}>{sampleLabel(sample)}</div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((variant, idx) => {
            const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
            // Heatmap intentionally never mutes cells: full color always, so it
            // stays poster-readable and exports at full opacity. (The interactive
            // legend/isolate dimming is a bar-chart-only affordance.)
            return (
              <tr key={variant.variantId} className={idx % 2 === 1 ? 'bg-[var(--surface-2)]/45' : undefined} onMouseEnter={() => onHoverVariant(variant.variantId)} onMouseLeave={() => onHoverVariant(null)}>
                <td className={cn('sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] p-2', hoveredVariantId === variant.variantId && 'bg-[var(--accent-50)]')}><VariantLabel variant={variant} color={color} rank={idx + 1} compact /></td>
                {samples.map(sample => {
                  const value = valueFor(sample.id, variant.variantId);
                  const alpha = value > 0 ? Math.max(0.12, Math.min(1, value / maxValue)) : 0.04;
                  const textColor = alpha > 0.58 ? textColorFor(color) : 'var(--text)';
                  return (
                    <td key={sample.id} className="border border-[var(--border)] p-0 text-center" onMouseEnter={event => { onHoverVariant(variant.variantId); onTip(event, `${variant.label}\n${sampleLabel(sample)}\n${fmtValue(value, metric)}\nverA: ${variantAiA(variant) ? 'AI-generated' : 'not AI-generated'}\nverB: ${variantAiB(variant) ? 'AI-generated' : 'not AI-generated'}`); }}>
                      <div className="relative flex h-7 w-[34px] items-center justify-center overflow-hidden rounded text-[9px] font-semibold tabular-nums" title={`${variant.label}\n${sampleLabel(sample)}\n${fmtValue(value, metric)}`} style={{ color: textColor }}>
                        <span className="absolute inset-0" style={{ backgroundColor: color, opacity: alpha }} />
                        <span className="relative z-10">{showValues ? fmtValue(value, metric) : ''}</span>
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

function VariantLegend({ variants, colors, isolated, hoveredVariantId, onHover, onToggle }: { variants: VariantWithStats[]; colors: Map<string, string>; isolated: Set<string>; hoveredVariantId: string | null; onHover: (variantId: string | null) => void; onToggle: (variantId: string) => void }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]"><span className="font-semibold text-[var(--text)]">Interactive legend</span><span className="text-[11px] text-[var(--text-soft)]">Hover to highlight. Click to isolate one or more variants.</span><span className="lims-pill lims-pill-ai">AI marks the specific verA or verB partner</span>{isolated.size > 0 && <span className="lims-chip lims-chip-accent">{isolated.size} isolated</span>}</div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto pr-1">
        {variants.map(variant => {
          const color = colors.get(variant.variantId) ?? colorForCandidate(variant.label);
          const pressed = isolated.has(variant.variantId);
          const dim = hoveredVariantId !== null && hoveredVariantId !== variant.variantId;
          return (
            <button key={variant.variantId} type="button" aria-pressed={pressed} onClick={() => onToggle(variant.variantId)} onMouseEnter={() => onHover(variant.variantId)} onMouseLeave={() => onHover(null)} className={cn('lims-toggle max-w-full !py-1', pressed && 'ring-1 ring-[var(--accent-500)]', dim && 'opacity-45')} data-on={pressed} title={variant.label}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="min-w-0 truncate font-mono">{parseCandidate(variant.label) ? variant.label.replace('-', ' / ') : variant.label}</span>
              {variantAiA(variant) && <span className="lims-pill lims-pill-ai opacity-80">verA AI</span>}
              {variantAiB(variant) && <span className="lims-pill lims-pill-ai opacity-80">verB AI</span>}
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
        <div className="text-[11px] text-[var(--text-soft)]">Library_candidates fields for the visible Top N set. AI status is split by verA and verB partner.</div>
      </div>
      <div className="max-h-[680px] overflow-auto p-2">
        <table className="w-full table-fixed border-separate text-[11px]" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10 bg-[var(--surface)] text-left text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            <tr><th className="w-[42%] border-b border-[var(--border)] p-2">Variant</th><th className="w-[22%] border-b border-[var(--border)] p-2">Library</th><th className="w-[28%] border-b border-[var(--border)] p-2">verA / verB</th><th className="w-[8%] border-b border-[var(--border)] p-2" /></tr>
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
                  <tr className={cn('transition-colors', idx % 2 === 1 && 'bg-[var(--surface-2)]/45', focused ? 'bg-[var(--accent-50)]' : 'hover:bg-[var(--surface-2)]')} onMouseEnter={() => onHover(variant.variantId)} onMouseLeave={() => onHover(null)}>
                    <td className="border-b border-[var(--border)] p-2 align-top"><VariantLabel variant={variant} color={color} rank={idx + 1} compact /><div className="mt-1 text-[10px] tabular-nums text-[var(--text-faint)]">present {variant.present}/{sampleCount} · max {fmtValue(variant.maxAbundance, 'abundance')}</div></td>
                    <MetaCell value={library} onCopy={onCopy} />
                    <td className="border-b border-[var(--border)] p-2 align-top"><div className="grid gap-1"><PartnerMeta label="verA" name={aName} type={aType} ai={variantAiA(variant)} /><PartnerMeta label="verB" name={bName} type={bType} ai={variantAiB(variant)} /></div></td>
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

function PartnerMeta({ label, name, type, ai }: { label: 'verA' | 'verB'; name: string; type: string; ai: boolean }) {
  return (
    <div className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1">
      <div className="flex min-w-0 items-center gap-1"><span className="lims-label">{label}</span>{ai && <span className="lims-pill lims-pill-ai opacity-90">AI-generated</span>}</div>
      <div className="truncate" title={name}>{name || '—'}</div>
      <div className="truncate text-[var(--text-faint)]" title={`${type}${ai ? ' · AI-generated' : ' · not AI-generated'}`}>{type}{type ? ' · ' : ''}{ai ? 'AI-generated' : 'not AI-generated'}</div>
    </div>
  );
}

function MetaCell({ value, onCopy }: { value: string; onCopy: (value: string) => void }) {
  return (
    <td className="min-w-0 border-b border-[var(--border)] p-2 align-top">
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
