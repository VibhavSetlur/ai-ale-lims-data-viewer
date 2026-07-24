'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Info, LineChart, Loader2, PanelsTopLeft, Sparkles, X, GitCompare, Boxes, MousePointerClick } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ExportFigureMenu from './ExportFigureMenu';
import { fetchData } from '@/lib/dataSource';
import type { FigureSpec } from '@/lib/figureSpec';

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

/* ---------- Transfer-series (faceted OD-vs-transfer) types ---------- */

// Mirror of /api/growth-series response. Kept local so the component owns its
// own contract; the endpoint's exported interfaces are the source of truth.
interface GrowthSeriesPoint { transfer: number; od: number; maxOd: number }
interface GrowthSeriesLineage {
  lineageId: string;
  experiment: string;
  genotypeLabel: string;
  replicate?: string;
  condition?: string;
  strain?: string;
  points: GrowthSeriesPoint[];
}
interface GrowthSeriesDataset {
  aggregation: 'endpoint';
  transferRange: { min: number; max: number };
  lineages: GrowthSeriesLineage[];
  warnings: string[];
}

type Aggregation = 'endpoint' | 'max';
type PrimaryMode = 'series' | 'within';

// Fixed 5-color replicate palette so color == replicate in EVERY panel.
const REPLICATE_COLORS: Record<string, string> = {
  '1': '#2563eb', // blue
  '2': '#16a34a', // green
  '3': '#ea580c', // orange
  '4': '#9333ea', // purple
  '5': '#dc2626', // red
};
const REPLICATE_ORDER = ['1', '2', '3', '4', '5'];
function replicateColor(rep: string | undefined): string {
  return (rep && REPLICATE_COLORS[rep]) || '#64748b';
}

const NO_DNA_LABEL = 'No DNA';

// Facet panel geometry (small multiples).
const FW = 300;
const FH = 190;
const FPAD = { l: 42, r: 12, t: 12, b: 30 };

// Client-side lineage parse: "TFMN1.fba.1.T5.P" -> "TFMN1.fba.1". Mirrors
// parseLineageTransfer in the mutations route so we can map a selected seq_sample
// id back to its Robotic_OD lineage (sample_name) without a server round trip.
function seqSampleToLineage(seqSample: string): string | null {
  const m = seqSample.match(/\.T(\d+)(?=\.|$)/);
  if (!m || m.index === undefined) return null;
  return seqSample.slice(0, m.index);
}

// Order genotype panels: single-mutation genotypes first (alpha), then combos
// (contain a comma), then "No DNA" last. Within each bucket, alpha.
function genotypeSortRank(label: string): number {
  if (label === NO_DNA_LABEL) return 2;
  if (label.includes(',')) return 1;
  return 0;
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

/* ---------- Per-genotype quantitative summary (cheap from points[]) ---------- */

interface GenotypeMetric {
  genotype: string;
  replicateCount: number;
  finalTransfer: number;
  finalMean: number;   // mean endpoint OD at the final transfer across replicates
  finalMin: number;
  finalMax: number;
  maxOd: number;       // max OD reached across all replicates + transfers
  maxOdTransfer: number;
  recoveryTransfer: number | null; // first transfer OD climbs back above earlyMin*factor
}

const RECOVERY_FACTOR = 2; // "recovered" = OD rises to >= 2x its early minimum.

// Compute a genotype's summary from its replicate lineages using the currently
// selected aggregation value (endpoint or max OD). All O(points).
function computeGenotypeMetric(
  genotype: string,
  lineages: GrowthSeriesLineage[],
  value: (p: GrowthSeriesPoint) => number,
): GenotypeMetric {
  let finalTransfer = -Infinity;
  for (const l of lineages) for (const p of l.points) if (p.transfer > finalTransfer) finalTransfer = p.transfer;
  if (!Number.isFinite(finalTransfer)) finalTransfer = 0;

  const finalVals: number[] = [];
  let maxOd = 0, maxOdTransfer = finalTransfer;
  for (const l of lineages) {
    for (const p of l.points) {
      const v = value(p);
      if (v > maxOd) { maxOd = v; maxOdTransfer = p.transfer; }
    }
    const fp = l.points.find(p => p.transfer === finalTransfer);
    if (fp) finalVals.push(value(fp));
  }
  const finalMean = finalVals.length ? finalVals.reduce((a, b) => a + b, 0) / finalVals.length : 0;
  const finalMin = finalVals.length ? Math.min(...finalVals) : 0;
  const finalMax = finalVals.length ? Math.max(...finalVals) : 0;

  // Recovery transfer: use the replicate-mean trend per transfer. Find the early
  // minimum (first third of the transfer span), then the first later transfer
  // whose mean rises to >= RECOVERY_FACTOR * that minimum.
  const byTransfer = new Map<number, number[]>();
  for (const l of lineages) for (const p of l.points) {
    const arr = byTransfer.get(p.transfer);
    const v = value(p);
    if (arr) arr.push(v); else byTransfer.set(p.transfer, [v]);
  }
  const trend = Array.from(byTransfer.entries())
    .map(([t, vs]) => ({ t, mean: vs.reduce((a, b) => a + b, 0) / vs.length }))
    .sort((a, b) => a.t - b.t);
  let recoveryTransfer: number | null = null;
  if (trend.length >= 3) {
    const earlyCount = Math.max(1, Math.floor(trend.length / 3));
    const early = trend.slice(0, earlyCount);
    let minT = early[0].t, minV = early[0].mean;
    for (const e of early) if (e.mean < minV) { minV = e.mean; minT = e.t; }
    const threshold = Math.max(minV * RECOVERY_FACTOR, minV + 1e-6);
    for (const e of trend) {
      if (e.t > minT && e.mean >= threshold) { recoveryTransfer = e.t; break; }
    }
  }

  return {
    genotype,
    replicateCount: lineages.length,
    finalTransfer,
    finalMean, finalMin, finalMax,
    maxOd, maxOdTransfer,
    recoveryTransfer,
  };
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

interface GrowthCurveComparisonProps {
  samples: MutationSample[];
  selected: Set<string>;
  loading?: boolean;
  experiment?: string;
  setSelected?: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTab?: (tab: 'samples' | 'compare' | 'growth' | 'libraryVariants' | 'copynumber') => void;
  hasBarcodes?: boolean;
}

export default function GrowthCurveComparison(props: GrowthCurveComparisonProps) {
  const { samples, selected, loading, experiment = '', setSelected, setTab, hasBarcodes = false } = props;
  const [primaryMode, setPrimaryMode] = useState<PrimaryMode>('series');

  // Transfer-series view state (primary faceted view).
  const [series1, setSeries1] = useState<GrowthSeriesDataset | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesAgg, setSeriesAgg] = useState<Aggregation>('endpoint');
  const [seriesLog, setSeriesLog] = useState(true);            // default LOG for the faceted view
  const [sharedAxes, setSharedAxes] = useState(true);          // shared vs per-panel autoscale
  const [fullFigure, setFullFigure] = useState(false);         // publication mode: ignore selection
  const [hoveredRep, setHoveredRep] = useState<string | null>(null);
  const [isolatedReps, setIsolatedReps] = useState<Set<string>>(() => new Set());
  const [seriesTip, setSeriesTip] = useState<HoverTip | null>(null);
  const seriesFigureRef = useRef<HTMLDivElement>(null);

  // Arrangement + figure controls (drive both screen and export layout).
  const [columns, setColumns] = useState<number>(3);
  const [figureTitle, setFigureTitle] = useState<string>('');
  const [hiddenGenotypes, setHiddenGenotypes] = useState<Set<string>>(() => new Set());
  const [genotypeOrder, setGenotypeOrder] = useState<string[]>([]);
  const [focusGenotype, setFocusGenotype] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState<boolean>(true);
  const [showBand, setShowBand] = useState<boolean>(false);
  const [crossMsg, setCrossMsg] = useState<string | null>(null);
  const crossMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCross = (msg: string) => {
    setCrossMsg(msg);
    if (crossMsgTimer.current) clearTimeout(crossMsgTimer.current);
    crossMsgTimer.current = setTimeout(() => setCrossMsg(null), 2600);
  };

  // Fetch the transfer-series dataset (via fetchData so static mode works). Uses
  // the same experiment filter as the loaded mutations dataset.
  useEffect(() => {
    let cancelled = false;
    setSeriesLoading(true);
    setSeriesError(null);
    const url = experiment
      ? `/api/growth-series?experiment=${encodeURIComponent(experiment)}`
      : '/api/growth-series';
    fetchData(url)
      .then(r => r.json())
      .then((json: GrowthSeriesDataset & { error?: string }) => {
        if (cancelled) return;
        if (json && json.error) { setSeriesError(json.error); setSeries1(null); }
        else setSeries1(json as GrowthSeriesDataset);
      })
      .catch(err => {
        if (cancelled) return;
        setSeriesError(err instanceof Error ? err.message : 'Failed to load growth series');
        setSeries1(null);
      })
      .finally(() => { if (!cancelled) setSeriesLoading(false); });
    return () => { cancelled = true; };
  }, [experiment]);

  const [logScale, setLogScale] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [sortOrder, setSortOrder] = useState<SortKey[]>(DEFAULT_SORT);
  const [hoveredSampleId, setHoveredSampleId] = useState<string | null>(null);
  const [isolatedSampleIds, setIsolatedSampleIds] = useState<Set<string>>(() => new Set());
  const [tooltip, setTooltip] = useState<HoverTip | null>(null);
  const figureRef = useRef<HTMLDivElement>(null);

  // Map selected seq_sample ids -> Robotic_OD lineage ids (sample_name).
  const selectedLineageIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of selected) {
      const lin = seqSampleToLineage(id);
      if (lin) set.add(lin);
    }
    return set;
  }, [selected]);

  // Sequenced seq_sample ids per lineage, computed from samples[]. Only these
  // exist as clickable ids in the other tabs, so cross-view buttons union these.
  const sequencedIdsByLineage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of samples) {
      const lin = seqSampleToLineage(s.id);
      if (!lin) continue;
      const arr = map.get(lin);
      if (arr) arr.push(s.id); else map.set(lin, [s.id]);
    }
    return map;
  }, [samples]);

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

  const buildWithinGrowthSpec = (): FigureSpec | null => {
    const plotted = visibleSeries.length > 0 ? visibleSeries : series;
    if (plotted.length === 0) return null;
    if (viewMode === 'facet') {
      return {
        kind: 'multiLinePanels',
        title: 'Selected OD600 growth curves',
        subtitle: `${plotted.length} selected sample curves, ${logScale ? 'log' : 'linear'} Y scale`,
        xTitle: 'Time or reading index (t)',
        yTitle: 'OD600',
        legendTitle: 'Samples',
        width: Math.max(1100, Math.min(2200, 300 + Math.min(3, plotted.length) * 360)),
        height: Math.max(760, Math.min(2400, 230 + Math.ceil(plotted.length / Math.min(3, Math.max(1, plotted.length))) * 250)),
        logY: logScale,
        showPoints: true,
        sharedY: true,
        panels: plotted.map(item => ({
          id: item.sample.id,
          label: item.label,
          subtitle: item.subtitle,
          series: [{ id: item.sample.id, label: item.label, color: item.color, points: item.points.map(point => ({ x: point.t, y: point.od })) }],
        })),
        caption: 'OD600 curves use the normalized Robotic_OD t field. Growth summaries are descriptive observed points, not fitted kinetic model parameters.',
      };
    }
    return {
      kind: 'lineChart',
      title: 'Selected OD600 growth curves',
      subtitle: `${plotted.length} selected sample curves, ${logScale ? 'log' : 'linear'} Y scale`,
      xTitle: 'Time or reading index (t)',
      yTitle: 'OD600',
      legendTitle: 'Samples',
      width: 1200,
      height: 820,
      logY: logScale,
      showPoints: true,
      series: plotted.map(item => ({ id: item.sample.id, label: item.label, color: item.color, points: item.points.map(point => ({ x: point.t, y: point.od })) })),
      caption: 'OD600 curves use the normalized Robotic_OD t field. Growth summaries are descriptive observed points, not fitted kinetic model parameters.',
    };
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

  /* ---------- Transfer-series derived state (faceted view) ---------- */

  const allLineages = series1?.lineages ?? [];

  // Which lineages to plot: full-figure mode plots everything; explorer mode
  // (default) reflows to lineages that map from the current selection.
  const plottedLineages = useMemo(() => {
    if (fullFigure) return allLineages;
    if (selectedLineageIds.size === 0) return [];
    return allLineages.filter(l => selectedLineageIds.has(l.lineageId));
  }, [allLineages, fullFigure, selectedLineageIds]);

  // Facet by genotypeLabel, ordered: single mutation, combos, No DNA. This is
  // the DEFAULT (natural) order; user reordering / hiding is layered on top.
  const naturalFacets = useMemo(() => {
    const byGenotype = new Map<string, GrowthSeriesLineage[]>();
    for (const l of plottedLineages) {
      const arr = byGenotype.get(l.genotypeLabel);
      if (arr) arr.push(l); else byGenotype.set(l.genotypeLabel, [l]);
    }
    const entries = Array.from(byGenotype.entries());
    entries.sort((a, b) => {
      const ra = genotypeSortRank(a[0]);
      const rb = genotypeSortRank(b[0]);
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });
    // Stable replicate order within a panel.
    for (const [, arr] of entries) {
      arr.sort((x, y) => {
        const rx = x.replicate ? parseInt(x.replicate, 10) : 99;
        const ry = y.replicate ? parseInt(y.replicate, 10) : 99;
        if (rx !== ry) return rx - ry;
        return x.lineageId.localeCompare(y.lineageId);
      });
    }
    return entries;
  }, [plottedLineages]);

  // All genotypes present (natural order), used to build the arrangement chips.
  const allGenotypes = useMemo(() => naturalFacets.map(([g]) => g), [naturalFacets]);

  // Effective panel order: user order for known genotypes, then any new ones in
  // natural order. Prunes genotypes that vanished from the data.
  const orderedGenotypes = useMemo(() => {
    const present = new Set(allGenotypes);
    const fromUser = genotypeOrder.filter(g => present.has(g));
    const seen = new Set(fromUser);
    const appended = allGenotypes.filter(g => !seen.has(g));
    return [...fromUser, ...appended];
  }, [allGenotypes, genotypeOrder]);

  // Panels actually drawn: ordered, minus hidden, unless focusing one genotype.
  const facets = useMemo(() => {
    const byGenotype = new Map(naturalFacets);
    const order = focusGenotype && byGenotype.has(focusGenotype)
      ? [focusGenotype]
      : orderedGenotypes.filter(g => !hiddenGenotypes.has(g));
    return order
      .filter(g => byGenotype.has(g))
      .map(g => [g, byGenotype.get(g)!] as [string, GrowthSeriesLineage[]]);
  }, [naturalFacets, orderedGenotypes, hiddenGenotypes, focusGenotype]);

  const moveGenotype = (g: string, delta: -1 | 1) => {
    setGenotypeOrder(() => {
      const base = orderedGenotypes;
      const idx = base.indexOf(g);
      if (idx < 0) return base;
      const target = idx + delta;
      if (target < 0 || target >= base.length) return base;
      const next = [...base];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };
  const toggleGenotypeHidden = (g: string) => setHiddenGenotypes(prev => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });
  const resetArrangement = () => {
    setGenotypeOrder([]);
    setHiddenGenotypes(new Set());
    setFocusGenotype(null);
  };

  const seriesPoint = (p: GrowthSeriesPoint): number => (seriesAgg === 'max' ? p.maxOd : p.od);

  // Global (shared) domain across all plotted lineages for the current aggregation.
  const globalDomain = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMax = 0;
    const positives: number[] = [];
    for (const l of plottedLineages) {
      for (const p of l.points) {
        if (p.transfer < xMin) xMin = p.transfer;
        if (p.transfer > xMax) xMax = p.transfer;
        const v = seriesPoint(p);
        if (v > yMax) yMax = v;
        if (v > 0) positives.push(v);
      }
    }
    if (!Number.isFinite(xMin)) { xMin = series1?.transferRange.min ?? 0; xMax = series1?.transferRange.max ?? 1; }
    const logLo = Math.max(0.001, positives.length ? Math.min(...positives) * 0.7 : 0.001);
    return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin: 0, yMax: Math.max(0.05, yMax), logLo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plottedLineages, seriesAgg, series1]);

  // Reps present across plotted lineages, for the shared legend.
  const presentReps = useMemo(() => {
    const set = new Set<string>();
    for (const l of plottedLineages) if (l.replicate) set.add(l.replicate);
    return REPLICATE_ORDER.filter(r => set.has(r));
  }, [plottedLineages]);

  // Per-genotype summary metrics for the visible (facet-ordered) panels.
  const genotypeMetrics = useMemo(
    () => facets.map(([g, lineages]) => computeGenotypeMetric(g, lineages, seriesPoint)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facets, seriesAgg],
  );

  const repVisible = (rep: string | undefined): boolean =>
    isolatedReps.size === 0 || (!!rep && isolatedReps.has(rep));

  const toggleRep = (rep: string) => setIsolatedReps(prev => {
    const next = new Set(prev);
    if (next.has(rep)) next.delete(rep); else next.add(rep);
    return next;
  });

  // Cross-view helpers: union all sequenced ids for a set of lineages.
  const idsForLineages = (lineageIds: string[]): string[] => {
    const out: string[] = [];
    for (const lin of lineageIds) {
      const ids = sequencedIdsByLineage.get(lin);
      if (ids) out.push(...ids);
    }
    return out;
  };
  const lineageHasSequenced = (lin: string): boolean => (sequencedIdsByLineage.get(lin)?.length ?? 0) > 0;

  const selectLineages = (lineageIds: string[]) => {
    if (!setSelected) return;
    const add = idsForLineages(lineageIds);
    if (add.length === 0) { flashCross('No sequenced samples for these lineages'); return; }
    setSelected(prev => { const next = new Set(prev); for (const id of add) next.add(id); return next; });
    flashCross(`Added ${add.length} sequenced sample${add.length === 1 ? '' : 's'} to selection`);
  };
  const TARGET_LABEL: Record<'compare' | 'libraryVariants', string> = {
    compare: 'Compare Mutations',
    libraryVariants: 'Library Variants',
  };
  const showIn = (lineageIds: string[], target: 'compare' | 'libraryVariants') => {
    if (!setSelected) return;
    const add = idsForLineages(lineageIds);
    if (add.length === 0) { flashCross('No sequenced samples for these lineages'); return; }
    setSelected(prev => { const next = new Set(prev); for (const id of add) next.add(id); return next; });
    flashCross(`Selected ${add.length} sample${add.length === 1 ? '' : 's'}, opening ${TARGET_LABEL[target]}`);
    setTab?.(target);
  };

  const downloadCsv = (rows: string[][], filename: string) => {
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const dlUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = dlUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(dlUrl);
  };

  // CSV of the actually-plotted lineages (drives the "appears broken" fix: the
  // button exports what is on screen, faceted/hidden panels included via facets).
  const exportSeriesCsv = () => {
    const drawn = facets.flatMap(([, lineages]) => lineages);
    const rows: string[][] = [['lineageId', 'genotype', 'replicate', 'transfer', 'endpoint_od', 'max_od']];
    for (const l of drawn) {
      for (const p of l.points) {
        rows.push([l.lineageId, l.genotypeLabel, l.replicate || '', String(p.transfer), String(p.od), String(p.maxOd)]);
      }
    }
    downloadCsv(rows, `growth-series-${drawn.length}lineages-${seriesAgg}.csv`);
  };

  // CSV of the per-genotype summary table (matches what the UI shows).
  const buildGrowthSeriesSpec = (): FigureSpec | null => {
    if (facets.length === 0) return null;
    return {
      kind: 'multiLinePanels',
      title: figureTitle.trim() || 'Endpoint OD by transfer, faceted by genotype',
      subtitle: `${facets.length} genotype panels, ${plottedLineages.length} lineages, ${seriesAgg === 'max' ? 'max OD' : 'endpoint OD'}, ${seriesLog ? 'log' : 'linear'} Y, ${sharedAxes ? 'shared axes' : 'per-panel axes'}`,
      xTitle: 'Transfer',
      yTitle: seriesAgg === 'max' ? 'Max OD600' : 'Endpoint OD600',
      legendTitle: 'Replicate',
      width: Math.max(1100, Math.min(2400, 250 + Math.min(3, facets.length) * 360)),
      height: Math.max(760, Math.min(2600, 230 + Math.ceil(facets.length / Math.min(3, Math.max(1, facets.length))) * 260)),
      logY: seriesLog,
      showPoints: false,
      sharedY: sharedAxes,
      panels: facets.map(([genotype, lineages]) => ({
        id: genotype,
        label: genotype,
        subtitle: `${lineages.length} replicate lineage${lineages.length === 1 ? '' : 's'}`,
        series: lineages
          .filter(lineage => repVisible(lineage.replicate))
          .map(lineage => ({
            id: lineage.lineageId,
            label: lineage.replicate ? `Rep ${lineage.replicate}` : lineage.lineageId,
            color: replicateColor(lineage.replicate),
            points: lineage.points.map(point => ({ x: point.transfer, y: seriesPoint(point) })),
          })),
      })),
      caption: 'Growth series are endpoint or maximum OD600 values read from Robotic_OD by transfer. Values are descriptive observed measurements, not fitted kinetic model parameters.',
    };
  };

  const exportSummaryCsv = () => {
    const rows: string[][] = [[
      'genotype', 'replicates', 'final_transfer',
      `final_${seriesAgg}_od_mean`, `final_${seriesAgg}_od_min`, `final_${seriesAgg}_od_max`,
      `max_${seriesAgg}_od`, 'max_od_transfer', 'recovery_transfer',
    ]];
    for (const m of genotypeMetrics) {
      rows.push([
        m.genotype, String(m.replicateCount), String(m.finalTransfer),
        fmtNumber(m.finalMean, 3), fmtNumber(m.finalMin, 3), fmtNumber(m.finalMax, 3),
        fmtNumber(m.maxOd, 3), String(m.maxOdTransfer),
        m.recoveryTransfer === null ? 'n/a' : String(m.recoveryTransfer),
      ]);
    }
    downloadCsv(rows, `growth-series-summary-${genotypeMetrics.length}genotypes-${seriesAgg}.csv`);
  };

  /* ---------- Render: primary mode = transfer series (faceted) ---------- */
  if (primaryMode === 'series') {
    return (
      <TransferSeriesView
        loading={seriesLoading || !!loading}
        error={seriesError}
        dataset={series1}
        facets={facets}
        plottedCount={plottedLineages.length}
        totalLineageCount={allLineages.length}
        seriesAgg={seriesAgg}
        setSeriesAgg={setSeriesAgg}
        seriesLog={seriesLog}
        setSeriesLog={setSeriesLog}
        sharedAxes={sharedAxes}
        setSharedAxes={setSharedAxes}
        fullFigure={fullFigure}
        setFullFigure={setFullFigure}
        globalDomain={globalDomain}
        seriesPoint={seriesPoint}
        presentReps={presentReps}
        hoveredRep={hoveredRep}
        setHoveredRep={setHoveredRep}
        isolatedReps={isolatedReps}
        toggleRep={toggleRep}
        repVisible={repVisible}
        selectionEmpty={selectedLineageIds.size === 0}
        selectedSampleCount={selected.size}
        tip={seriesTip}
        setTip={setSeriesTip}
        figureRef={seriesFigureRef}
        onExportCsv={exportSeriesCsv}
        onExportSummaryCsv={exportSummaryCsv}
        onSwitchToWithin={() => setPrimaryMode('within')}
        buildSpec={buildGrowthSeriesSpec}
        // arrangement + figure
        columns={columns}
        setColumns={setColumns}
        figureTitle={figureTitle}
        setFigureTitle={setFigureTitle}
        allGenotypes={orderedGenotypes}
        hiddenGenotypes={hiddenGenotypes}
        toggleGenotypeHidden={toggleGenotypeHidden}
        moveGenotype={moveGenotype}
        focusGenotype={focusGenotype}
        setFocusGenotype={setFocusGenotype}
        resetArrangement={resetArrangement}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        showBand={showBand}
        setShowBand={setShowBand}
        genotypeMetrics={genotypeMetrics}
        // selection controls
        onClearSelection={() => setSelected?.(new Set())}
        onPlotFull={() => setFullFigure(true)}
        hasSetSelected={!!setSelected}
        // cross-view
        hasSetTab={!!setTab}
        hasBarcodes={hasBarcodes}
        crossMsg={crossMsg}
        lineageHasSequenced={lineageHasSequenced}
        selectLineages={selectLineages}
        showIn={showIn}
      />
    );
  }

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
          <button type="button" onClick={() => setPrimaryMode('series')} className="lims-btn lims-btn-secondary" title="Return to the faceted OD-vs-transfer figure">
            <PanelsTopLeft className="h-3.5 w-3.5" /> Transfer series
          </button>
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
          <ExportFigureMenu getTarget={() => figureRef.current} title={`AI-ALE growth curves ${viewMode}`} filenameBase={`growth-curves-${viewMode}-${logScale ? 'log' : 'linear'}`} disabled={series.length === 0} compact buildSpec={buildWithinGrowthSpec} />
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

/* =====================================================================
   TransferSeriesView: faceted OD-vs-transfer small multiples (Phase 1)
   ===================================================================== */

interface SeriesDomain { xMin: number; xMax: number; yMin: number; yMax: number; logLo: number }

// Integer transfer ticks; keep the panel readable by thinning when the range is
// wide (0..33 -> every 5th plus endpoints).
function transferTicks(xMin: number, xMax: number): number[] {
  const span = xMax - xMin;
  if (span <= 0) return [xMin];
  const step = span > 20 ? 5 : span > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = Math.ceil(xMin); t <= xMax; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);
  return ticks;
}

function seriesLogTicks(max: number, logLo: number): number[] {
  const ticks = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3].filter(v => v >= logLo * 0.99 && v <= max * 1.01);
  return ticks.length ? ticks : [logLo, max];
}

interface TransferSeriesViewProps {
  loading: boolean;
  error: string | null;
  dataset: GrowthSeriesDataset | null;
  facets: [string, GrowthSeriesLineage[]][];
  plottedCount: number;
  totalLineageCount: number;
  seriesAgg: Aggregation;
  setSeriesAgg: (a: Aggregation) => void;
  seriesLog: boolean;
  setSeriesLog: (b: boolean) => void;
  sharedAxes: boolean;
  setSharedAxes: (b: boolean) => void;
  fullFigure: boolean;
  setFullFigure: (b: boolean) => void;
  globalDomain: SeriesDomain;
  seriesPoint: (p: GrowthSeriesPoint) => number;
  presentReps: string[];
  hoveredRep: string | null;
  setHoveredRep: (r: string | null) => void;
  isolatedReps: Set<string>;
  toggleRep: (r: string) => void;
  repVisible: (rep: string | undefined) => boolean;
  selectionEmpty: boolean;
  selectedSampleCount: number;
  tip: HoverTip | null;
  setTip: (t: HoverTip | null) => void;
  figureRef: React.RefObject<HTMLDivElement | null>;
  onExportCsv: () => void;
  onExportSummaryCsv: () => void;
  onSwitchToWithin: () => void;
  buildSpec: () => FigureSpec | null;
  // arrangement + figure
  columns: number;
  setColumns: (n: number) => void;
  figureTitle: string;
  setFigureTitle: (s: string) => void;
  allGenotypes: string[];
  hiddenGenotypes: Set<string>;
  toggleGenotypeHidden: (g: string) => void;
  moveGenotype: (g: string, delta: -1 | 1) => void;
  focusGenotype: string | null;
  setFocusGenotype: (g: string | null) => void;
  resetArrangement: () => void;
  showSummary: boolean;
  setShowSummary: (b: boolean) => void;
  showBand: boolean;
  setShowBand: (b: boolean) => void;
  genotypeMetrics: GenotypeMetric[];
  // selection controls
  onClearSelection: () => void;
  onPlotFull: () => void;
  hasSetSelected: boolean;
  hasSetTab: boolean;
  hasBarcodes: boolean;
  crossMsg: string | null;
  lineageHasSequenced: (lin: string) => boolean;
  selectLineages: (lineageIds: string[]) => void;
  showIn: (lineageIds: string[], target: 'compare' | 'libraryVariants') => void;
}

function TransferSeriesView(p: TransferSeriesViewProps) {
  if (p.loading) {
    return (
      <div className="flex-1 min-h-0 p-3">
        <div className="lims-surface flex h-full min-h-[320px] items-center justify-center rounded-xl text-[13px] text-[var(--text-soft)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading growth series...
        </div>
      </div>
    );
  }

  const warn = p.dataset?.warnings?.[0] || p.error;
  const noData = !p.dataset || p.dataset.lineages.length === 0;

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)] p-3">
      <section className="lims-surface flex min-h-full flex-col gap-3 rounded-xl p-4 shadow-sm">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <PanelsTopLeft className="h-4 w-4 shrink-0 text-[var(--data-grow)]" />
              <h2 className="truncate text-[15px] font-semibold text-[var(--text)]">Compare Growth Curves</h2>
              <InfoPopover title="Transfer series (endpoint OD by transfer)" align="right">
                Small multiples faceted by genotype (Transforming_DNA). Each panel holds up to five replicate lines colored by replicate number. X is the ALE transfer (integer); Y is OD on a log scale by default. Endpoint OD is the reading at the last timepoint of each transfer; toggle to max OD without refetching. In explorer mode the panels reflow to your selected samples; use Load full figure for every lineage.
              </InfoPopover>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-soft)]">Publication-style OD-vs-transfer figure: one panel per genotype, replicate-colored lines, log Y, endpoint or max OD, shared or per-panel axes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <Stat value={p.facets.length.toLocaleString()} label="genotypes" />
            <Stat value={p.plottedCount.toLocaleString()} label="lineages" />
            <Stat value={p.totalLineageCount.toLocaleString()} label="total lineages" />
            <Stat value={`${p.dataset?.transferRange.min ?? 0}..${p.dataset?.transferRange.max ?? 0}`} label="transfers" />
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2" data-figure-omit>
          <div className="flex items-center gap-1">
            <button type="button" data-on={p.seriesAgg === 'endpoint'} onClick={() => p.setSeriesAgg('endpoint')} className="lims-toggle">Endpoint OD</button>
            <button type="button" data-on={p.seriesAgg === 'max'} onClick={() => p.setSeriesAgg('max')} className="lims-toggle">Max OD</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-on={!p.seriesLog} onClick={() => p.setSeriesLog(false)} className="lims-toggle">Linear Y</button>
            <button type="button" data-on={p.seriesLog} onClick={() => p.setSeriesLog(true)} className="lims-toggle">Log Y</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-on={p.sharedAxes} onClick={() => p.setSharedAxes(true)} className="lims-toggle">Shared axes</button>
            <button type="button" data-on={!p.sharedAxes} onClick={() => p.setSharedAxes(false)} className="lims-toggle">Per-panel</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-on={!p.fullFigure} onClick={() => p.setFullFigure(false)} className="lims-toggle">Selected only</button>
            <button type="button" data-on={p.fullFigure} onClick={() => p.setFullFigure(true)} className="lims-toggle" title="Plot every lineage from the endpoint, ignoring selection">Full figure</button>
          </div>
          <button type="button" onClick={p.onExportCsv} className="lims-btn lims-btn-secondary" disabled={p.plottedCount === 0} title="Export long-format growth series as CSV">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <ExportFigureMenu getTarget={() => p.figureRef.current} title="AI-ALE growth series by genotype" filenameBase={`growth-series-${p.seriesAgg}-${p.seriesLog ? 'log' : 'linear'}`} disabled={p.plottedCount === 0} compact buildSpec={p.buildSpec} />
          <button type="button" onClick={p.onSwitchToWithin} className="lims-btn lims-btn-ghost" title="Switch to the within-transfer overlay of your selected samples">
            <LineChart className="h-3.5 w-3.5" /> Within-transfer curves
          </button>
        </div>

        {warn && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {warn}
          </div>
        )}

        {/* Shared replicate legend */}
        {p.presentReps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[11px]" data-figure-omit>
            <span className="lims-label mr-1">Replicate</span>
            {p.presentReps.map(rep => {
              const pressed = p.isolatedReps.has(rep);
              const dim = p.hoveredRep !== null && p.hoveredRep !== rep;
              return (
                <button key={rep} type="button" aria-pressed={pressed} onClick={() => p.toggleRep(rep)} onMouseEnter={() => p.setHoveredRep(rep)} onMouseLeave={() => p.setHoveredRep(null)} data-on={pressed} className={cn('lims-toggle !py-1', pressed && 'ring-1 ring-[var(--accent-500)]', dim && 'opacity-45')}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: replicateColor(rep) }} />
                  Rep {rep}
                </button>
              );
            })}
            <span className="ml-1 text-[var(--text-faint)]">hover to highlight, click to isolate</span>
          </div>
        )}

        {/* Empty-selection prompt with a one-click full figure */}
        {!noData && p.plottedCount === 0 && (
          <div className="lims-surface flex min-h-[280px] flex-1 items-center justify-center rounded-xl p-6 text-center">
            <div className="max-w-xl">
              <MousePointerClick className="mx-auto mb-3 h-8 w-8 text-[var(--data-grow)]" />
              <h3 className="text-[15px] font-semibold text-[var(--text)]">Select samples to reflow the figure</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-soft)]">
                {p.selectionEmpty
                  ? 'Choose samples in the Samples tab and their genotype panels appear here. Or plot the whole experiment now.'
                  : 'Your selected samples did not map to any Robotic_OD lineage. Plot the whole experiment instead.'}
              </p>
              <button type="button" onClick={() => p.setFullFigure(true)} className="lims-btn lims-btn-primary mt-4">
                <PanelsTopLeft className="h-4 w-4" /> Load full figure (all {p.totalLineageCount} lineages)
              </button>
            </div>
          </div>
        )}

        {noData && (
          <Notice title="No growth series available" text="No Robotic_OD data was returned for this experiment. Endpoint OD is read directly from Robotic_OD, so an empty result usually means the experiment has no OD readings." />
        )}

        {/* Faceted grid */}
        {p.plottedCount > 0 && (
          <div ref={p.figureRef} className="relative min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm" onMouseLeave={() => p.setTip(null)}>
            {p.tip && <FloatingTooltip tip={p.tip} />}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-soft)]">
              <span className="font-semibold text-[var(--text)]">Endpoint OD by transfer, faceted by genotype</span>
              <span className="lims-chip">{p.facets.length} panels</span>
              <span className="lims-chip">{p.seriesAgg === 'max' ? 'max OD' : 'endpoint OD'}</span>
              <span className="lims-chip">{p.seriesLog ? 'log Y' : 'linear Y'}</span>
              <span className="lims-chip">{p.sharedAxes ? 'shared axes' : 'per-panel'}</span>
              {p.fullFigure && <span className="lims-chip lims-chip-accent">full figure</span>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {p.facets.map(([genotype, lineages]) => (
                <FacetPanel
                  key={genotype}
                  genotype={genotype}
                  lineages={lineages}
                  seriesLog={p.seriesLog}
                  sharedAxes={p.sharedAxes}
                  globalDomain={p.globalDomain}
                  seriesPoint={p.seriesPoint}
                  hoveredRep={p.hoveredRep}
                  repVisible={p.repVisible}
                  figureRef={p.figureRef}
                  setTip={p.setTip}
                  hasSetSelected={p.hasSetSelected}
                  hasSetTab={p.hasSetTab}
                  hasBarcodes={p.hasBarcodes}
                  lineageHasSequenced={p.lineageHasSequenced}
                  selectLineages={p.selectLineages}
                  showIn={p.showIn}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function seriesScales(domain: SeriesDomain, log: boolean) {
  const innerW = FW - FPAD.l - FPAD.r;
  const innerH = FH - FPAD.t - FPAD.b;
  const x = (v: number) => FPAD.l + ((v - domain.xMin) / Math.max(1e-9, domain.xMax - domain.xMin)) * innerW;
  const logMin = Math.log10(domain.logLo);
  const logMax = Math.log10(Math.max(domain.logLo * 1.1, domain.yMax));
  const y = (v: number) => {
    if (log) {
      const safe = Math.max(domain.logLo, v);
      return FPAD.t + innerH - ((Math.log10(safe) - logMin) / Math.max(1e-9, logMax - logMin)) * innerH;
    }
    return FPAD.t + innerH - ((v - domain.yMin) / Math.max(1e-9, domain.yMax - domain.yMin)) * innerH;
  };
  return { x, y, innerW, innerH };
}

interface FacetPanelProps {
  genotype: string;
  lineages: GrowthSeriesLineage[];
  seriesLog: boolean;
  sharedAxes: boolean;
  globalDomain: SeriesDomain;
  seriesPoint: (p: GrowthSeriesPoint) => number;
  hoveredRep: string | null;
  repVisible: (rep: string | undefined) => boolean;
  figureRef: React.RefObject<HTMLDivElement | null>;
  setTip: (t: HoverTip | null) => void;
  hasSetSelected: boolean;
  hasSetTab: boolean;
  hasBarcodes: boolean;
  lineageHasSequenced: (lin: string) => boolean;
  selectLineages: (lineageIds: string[]) => void;
  showIn: (lineageIds: string[], target: 'compare' | 'libraryVariants') => void;
}

function FacetPanel(pp: FacetPanelProps) {
  const { genotype, lineages, seriesLog, sharedAxes, globalDomain, seriesPoint } = pp;

  // Per-panel domain (autoscale) when sharedAxes is off.
  const domain: SeriesDomain = useMemo(() => {
    if (sharedAxes) return globalDomain;
    let xMin = Infinity, xMax = -Infinity, yMax = 0;
    const positives: number[] = [];
    for (const l of lineages) for (const pt of l.points) {
      if (pt.transfer < xMin) xMin = pt.transfer;
      if (pt.transfer > xMax) xMax = pt.transfer;
      const v = seriesPoint(pt);
      if (v > yMax) yMax = v;
      if (v > 0) positives.push(v);
    }
    if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; }
    const logLo = Math.max(0.001, positives.length ? Math.min(...positives) * 0.7 : 0.001);
    return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin: 0, yMax: Math.max(0.05, yMax), logLo };
  }, [sharedAxes, globalDomain, lineages, seriesPoint]);

  const scales = seriesScales(domain, seriesLog);

  // Sequenced ids across all lineages in this panel (for panel-level buttons).
  const seqLineages = lineages.filter(l => pp.lineageHasSequenced(l.lineageId)).map(l => l.lineageId);
  const canCross = pp.hasSetSelected && seqLineages.length > 0;

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    const target = pp.figureRef.current;
    if (!svg || !target) return;
    const svgRect = svg.getBoundingClientRect();
    const figRect = target.getBoundingClientRect();
    const px = ((event.clientX - svgRect.left) / Math.max(1, svgRect.width)) * FW;
    const py = ((event.clientY - svgRect.top) / Math.max(1, svgRect.height)) * FH;
    let best: { lin: GrowthSeriesLineage; pt: GrowthSeriesPoint; d: number; sx: number; sy: number } | null = null;
    for (const l of lineages) {
      if (!pp.repVisible(l.replicate)) continue;
      for (const pt of l.points) {
        const sx = scales.x(pt.transfer);
        const sy = scales.y(seriesPoint(pt));
        const d = Math.hypot(px - sx, py - sy);
        if (!best || d < best.d) best = { lin: l, pt, d, sx, sy };
      }
    }
    if (!best) return;
    const x = svgRect.left - figRect.left + best.sx * (svgRect.width / FW);
    const y = svgRect.top - figRect.top + best.sy * (svgRect.height / FH);
    pp.setTip({
      x, y,
      flipX: x > figRect.width - 220,
      flipY: y < 70,
      text: `${best.lin.lineageId}\n${best.lin.genotypeLabel} · Rep ${best.lin.replicate ?? '?'}\nT${best.pt.transfer} · OD ${fmtNumber(seriesPoint(best.pt), 3)}`,
    });
  };

  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-1.5">
        <span className="truncate font-mono text-[11px] font-semibold text-[var(--text)]" title={genotype}>{genotype}</span>
        <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{lineages.length} rep{lineages.length === 1 ? '' : 's'}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${FW} ${FH}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label={`${genotype} OD by transfer`}>
        {/* axes */}
        {(seriesLog ? seriesLogTicks(domain.yMax, domain.logLo) : [0, 0.25, 0.5, 0.75, 1].map(f => domain.yMax * f)).map(tick => {
          const y = scales.y(tick);
          return <g key={`y-${tick}`}><line x1={FPAD.l} x2={FW - FPAD.r} y1={y} y2={y} stroke="var(--border)" /><text x={FPAD.l - 5} y={y + 3} textAnchor="end" fontSize={8} fill="var(--text-faint)">{fmtNumber(tick, tick < 0.1 ? 3 : 2)}</text></g>;
        })}
        {transferTicks(domain.xMin, domain.xMax).map(tick => {
          const x = scales.x(tick);
          return <g key={`x-${tick}`}><line x1={x} x2={x} y1={FPAD.t} y2={FPAD.t + scales.innerH} stroke="var(--border)" opacity="0.5" /><text x={x} y={FH - FPAD.b + 14} textAnchor="middle" fontSize={8} fill="var(--text-faint)">{tick}</text></g>;
        })}
        <line x1={FPAD.l} x2={FPAD.l} y1={FPAD.t} y2={FPAD.t + scales.innerH} stroke="var(--border-strong)" />
        <line x1={FPAD.l} x2={FW - FPAD.r} y1={FPAD.t + scales.innerH} y2={FPAD.t + scales.innerH} stroke="var(--border-strong)" />
        <text x={FPAD.l + scales.innerW / 2} y={FH - 2} textAnchor="middle" fontSize={8} fill="var(--text-soft)">transfer</text>
        {/* replicate lines */}
        {lineages.map(l => {
          const visible = pp.repVisible(l.replicate);
          const focused = pp.hoveredRep !== null && pp.hoveredRep === l.replicate;
          const dim = !visible || (pp.hoveredRep !== null && !focused);
          const color = replicateColor(l.replicate);
          const d = l.points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${scales.x(pt.transfer).toFixed(1)} ${scales.y(seriesPoint(pt)).toFixed(1)}`).join(' ');
          return (
            <path key={l.lineageId} d={d} fill="none" stroke={color} strokeWidth={focused ? 2.6 : 1.6} opacity={dim ? 0.14 : 0.92} />
          );
        })}
        <rect x={FPAD.l} y={FPAD.t} width={scales.innerW} height={scales.innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => pp.setTip(null)} />
      </svg>
      {/* cross-view buttons (only for sequenced lineages) */}
      {canCross && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1" data-figure-omit>
          <button type="button" onClick={() => pp.selectLineages(seqLineages)} className="lims-toggle !py-1 !text-[10px]" title="Add all sequenced samples for this genotype's lineages to the selection">
            <MousePointerClick className="h-3 w-3" /> Select
          </button>
          {pp.hasSetTab && (
            <button type="button" onClick={() => pp.showIn(seqLineages, 'compare')} className="lims-toggle !py-1 !text-[10px]" title="Select these lineages and open Compare Mutations">
              <GitCompare className="h-3 w-3" /> Mutations
            </button>
          )}
          {pp.hasSetTab && pp.hasBarcodes && (
            <button type="button" onClick={() => pp.showIn(seqLineages, 'libraryVariants')} className="lims-toggle !py-1 !text-[10px]" title="Select these lineages and open Library Variants">
              <Boxes className="h-3 w-3" /> Variants
            </button>
          )}

        </div>
      )}
    </div>
  );
}
