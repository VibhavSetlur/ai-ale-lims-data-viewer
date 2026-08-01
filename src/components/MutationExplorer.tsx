'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckSquare, Square, Search, X, AlertCircle, FlaskConical, GitCompare, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, Filter, Download, Info,
  ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, FoldVertical, UnfoldVertical,
  TrendingUp, Dna, ExternalLink, Layers, Sparkles,
} from 'lucide-react';
import GrowthCurveComparison from './GrowthCurveComparison';
import ViewInfo from './ViewInfo';
import LibraryVariantComparison from './LibraryVariantComparison';
import { fetchData, IS_STATIC } from '../lib/dataSource';
import ExportFigureMenu from './ExportFigureMenu';
import type { FigureSpec } from '../lib/figureSpec';
import type { MutationRouteTab } from '../lib/routes';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface MutationSample {
  id: string;
  name: string;
  experiment: string;
  experiment_type?: string;
  seqorder?: string;
  seqorders?: string[];
  replicate?: string;
  transfer?: number;
  condition?: string;
  strain?: string;
  donor_dna?: string;
  has_barcodes?: boolean;
  verab_combinations?: number;
  selection_note?: string;
  growth_curve?: { t: number; od: number }[];
  growth_curve_source?: {
    table: 'Robotic_OD';
    sample_name: string;
    transfer: number;
    points: number;
  };
  od_sources?: { type: string; source: string }[];
}

// Seqorder is the one multi-valued facet: a sample can belong to several
// sequencing orders (e.g. a WGS mutation order + a Plasmidsaurus amplicon
// barcode order). Union the array field with the legacy single string so a
// sample shows up under EVERY seqorder it belongs to.
// Note: seqorder values must not contain commas for GROUP_CONCAT split to work;
// current data uses underscore-delimited identifiers so this is safe.
function seqorderVals(s: MutationSample): string[] {
  const set = new Set<string>();
  for (const v of s.seqorders ?? []) if (v) set.add(v);
  if (s.seqorder) set.add(s.seqorder);
  return [...set];
}

// Rich structural detail for the Comparative-view mutation popup. Mirrors the
// MutationDetail shape the /api/mutations route already attaches to each row.
// Every field is optional: different sample groups can be on different reference
// genomes, so we always surface seq_id alongside positions to disambiguate.
interface MutationDetail {
  seq_id?: string;            // contig / reference sequence the coordinate sits on
  position_start?: number;
  position_end?: number;
  ref_seq?: string;
  new_seq?: string;
  gene_strand?: string;
  gene_position?: string;
  locus_tag?: string;
  aa_ref_seq?: string;
  aa_new_seq?: string;
  aa_position?: number;
  codon_ref_seq?: string;
  codon_new_seq?: string;
  codon_number?: number;
  size?: string;
  repeat_seq?: string;
  repeat_ref_copies?: number;
  repeat_new_copies?: number;
  genes_inactivated?: string;
  genes_overlapping?: string;
  genes_promoter?: string;
}

interface MutationRow {
  id: string;
  gene: string;
  variant: string;
  type: string;
  metric: string;
  values: Record<string, number>;
  snp_type?: string;
  mutation_category?: string;
  base_type?: string;
  position?: number;
  gene_product?: string;
  // Sample IDs whose donor DNA provided this mutation (supplied in the growth
  // condition, not spontaneous). Cells for these samples get an outline; the popup
  // flags them. Provided-but-0% shows an outline with no fill.
  providedIn?: string[];
  detail?: MutationDetail;
}

interface RegistrySummary {
  id: string;
  count: number;
  polymorphism_frequency_cutoff: number | null;
  limit_fold_coverage: number | null;
  reference: string | null;
  unregistered?: boolean;
}

interface MutationDataset {
  samples: MutationSample[];
  mutations: MutationRow[];
  experiments?: string[];
  registries?: RegistrySummary[];
  selectedRegistry?: string | null;
  warnings?: string[];
  stats?: {
    sampleCount: number;
    mutationRowCount: number;
    frequencyRowCount: number;
    cnRegionCount: number;
    cnSampleCount: number;
    curveCount: number;
    hasBarcodes?: boolean;
  };
}

// Kept as a local alias of the canonical route tab union so every internal
// usage below stays literally in sync with `src/lib/routes.ts`.
type Tab = MutationRouteTab;

const SELECTED_KEY = 'lims:mutation:selected';
const TAB_KEY = 'lims:mutation:tab';
const EXPERIMENT_KEY = 'lims:mutation:experiment';
const REGISTRY_KEY = 'lims:mutation:registry';
const COMPARE_FILTERS_KEY = 'lims:mutation:compareFilters';
const SAMPLE_FILTERS_KEY = 'lims:mutation:sampleFilters';
const COLLAPSED_GROUPS_KEY = 'lims:mutation:collapsedGroups';

// Tighter Comparative defaults: drop synonymous/intergenic/pseudogene noise on
// first paint so the explorer opens to a useful view. Researchers can clear/
// re-add classes via the pills. (Once they touch the filter, their override is
// persisted to localStorage and these defaults stop applying.)
const DEFAULT_SNP_TYPES = ['nonsynonymous', 'nonsense', 'small_indel', 'large_deletion'];

type CompareFilters = {
  mutFilter: string;
  metricFilter: 'all' | 'frequency' | 'copy_number';
  snpTypes: string[]; // serialized Set
  minFreq: number;
  minPresence: number;
  hideEmpty: boolean;
  hideEmptySamples: boolean;
  sortKey: 'gene' | 'variant' | 'type' | 'position' | 'maxFreq' | 'spread' | 'presence' | null;
  sortDir: 'asc' | 'desc';
  groupOrder: string[]; // ordered, enabled column grouping levels (see GROUP_LEVELS)
  selectedMutations: string[]; // serialized Set of MutationRow.id the user checked for the compare-subset
  compareMutationsOnly: boolean; // when true, render only the checked subset
};

// Column grouping levels the biologist can pick from for the Comparative View.
// Each level maps a stable key to the sample field it reads and a short label.
// The ordered list of ENABLED keys (groupOrder) drives both the column sort and
// the sticky header bands. 'transfer' sorts numerically (T1 < T6 < T11 < T25).
const GROUP_LEVELS = [
  { key: 'experiment', field: 'experiment', label: 'Experiment' },
  { key: 'condition', field: 'condition', label: 'Condition' },
  { key: 'strain', field: 'strain', label: 'Strain' },
  { key: 'dna', field: 'donor_dna', label: 'DNA' },
  { key: 'replicate', field: 'replicate', label: 'Replicate' },
  { key: 'transfer', field: 'transfer', label: 'Transfer' },
] as const;

type GroupLevelKey = typeof GROUP_LEVELS[number]['key'];
const GROUP_LEVEL_KEYS = GROUP_LEVELS.map(l => l.key) as GroupLevelKey[];
const GROUP_LEVEL_BY_KEY = new Map(GROUP_LEVELS.map(l => [l.key, l]));
// Default matches Natascha's example: experiment > condition > strain > dna > replicate.
const DEFAULT_GROUP_ORDER: GroupLevelKey[] = ['experiment', 'condition', 'strain', 'dna', 'replicate'];

// Read the value a sample contributes for a given grouping level, as a string
// (used for grouping/labels) plus a numeric hint for transfer ordering.
function groupValue(s: MutationSample, key: GroupLevelKey): string {
  if (key === 'transfer') return typeof s.transfer === 'number' ? String(s.transfer) : '';
  const level = GROUP_LEVEL_BY_KEY.get(key);
  if (!level) return '';
  const v = (s as unknown as Record<string, unknown>)[level.field];
  return typeof v === 'string' ? v : (v == null ? '' : String(v));
}

// Build a comparator from an ordered list of grouping levels. Text levels use
// localeCompare; transfer compares numerically so T1 < T6 < T11 < T25. After all
// levels tie we fall back to transfer-number then name for stable ordering.
function makeGroupComparator(order: GroupLevelKey[]) {
  return (a: MutationSample, b: MutationSample): number => {
    for (const key of order) {
      if (key === 'transfer') {
        const at = typeof a.transfer === 'number' ? a.transfer : Infinity;
        const bt = typeof b.transfer === 'number' ? b.transfer : Infinity;
        if (at !== bt) return at - bt;
        continue;
      }
      const av = groupValue(a, key);
      const bv = groupValue(b, key);
      if (av !== bv) return av.localeCompare(bv);
    }
    // Stable fallbacks: transfer number, then name.
    const at = typeof a.transfer === 'number' ? a.transfer : Infinity;
    const bt = typeof b.transfer === 'number' ? b.transfer : Infinity;
    if (at !== bt) return at - bt;
    return a.name.localeCompare(b.name);
  };
}

// Types we want to surface as filter pills, in research-priority order.
const SNP_TYPE_OPTIONS = [
  'nonsynonymous', 'nonsense', 'small_indel', 'large_deletion',
  'synonymous', 'intergenic', 'pseudogene', 'noncoding',
] as const;

function formatMetric(value: number | undefined, metric: string): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  if (metric === 'frequency') return `${Math.round(value * 100)}%`;
  if (metric === 'copy_number') return value.toFixed(1);
  return String(value);
}

// Badge color for a mutation class. nonsynonymous=amber, synonymous=slate,
// nonsense/indel/large_deletion=red, intergenic=violet, everything else neutral.
function snpTypeBadgeClass(snpType?: string): string {
  const t = (snpType ?? '').toLowerCase();
  if (t === 'nonsynonymous') return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
  if (t === 'synonymous') return 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600';
  if (t === 'nonsense' || t === 'small_indel' || t === 'large_deletion' || t.includes('indel') || t.includes('deletion'))
    return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
  if (t === 'intergenic') return 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700';
  return 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600';
}

// Continuous heatmap color scaled to a [min,max] domain. Frequency cells pass the
// fixed 0..1 domain so 50% always has the same color. Copy-number rows pass their
// row-local min/max so region-specific amplification gradients stay readable.
function rampStyle(value: number, min: number, max: number, metric: string): React.CSSProperties {
  if (!Number.isFinite(value)) return {};
  const span = max - min;
  const t = span > 1e-9 ? Math.max(0, Math.min(1, (value - min) / span)) : (value > 0 ? 1 : 0);
  // frequency -> blue scale, copy_number -> emerald scale, others -> slate.
  const hue = metric === 'copy_number' ? 160 : metric === 'frequency' ? 214 : 215;
  const sat = metric === 'other' ? 8 : 70;
  // lightness from 96% (low) to 38% (high) so high values are saturated/dark.
  const light = 96 - t * 58;
  const bg = `hsl(${hue} ${sat}% ${light}%)`;
  const text = light < 62 ? '#ffffff' : metric === 'copy_number' ? '#064e3b' : '#1e3a5f';
  return { backgroundColor: bg, color: text };
}


/* ---- Growth-curve metrics -------------------------------------------------
   Pure helper that extracts the standard parameters a microbiologist reads off
   an OD600-vs-time curve. This is a SIMPLE, model-free estimator (point-to-point
   slopes on the log curve), NOT a Gompertz/Richards/logistic fit. The numbers
   are honest descriptive statistics of the observed points, useful for ranking
   and comparison, but should not be presented as fitted kinetic constants.

   Heuristics (documented honestly, do not overclaim):
   - maxOD (carrying capacity K): the maximum observed OD600. Real K would be the
     asymptote of a fitted model; with sparse points we use the observed max.
   - muMax (max specific growth rate, per hour): the largest slope of ln(OD)
     between two consecutive measured points, i.e. max over i of
     (ln(od[i+1]) - ln(od[i])) / (t[i+1] - t[i]). This is the steepest single
     interval, so it is sensitive to noise on closely spaced points; it is a
     lower-effort stand-in for a sliding-window regression.
   - doublingTimeH: ln(2)/muMax (undefined when muMax <= 0).
   - lagTimeH: a robust heuristic, NOT a tangent-line intercept. We take the
     first time at which OD has risen to >= 2x the initial/baseline OD (the
     minimum of the first few points). This approximates the end of the lag
     phase; it is coarser than the classic geometric lag definition.
   - aucod: area under the OD-vs-time curve by the trapezoid rule (OD*hours).
   - expIdx: index i of the steepest ln-OD interval (so the modal can highlight
     which points produced muMax). The exponential window is points [i, i+1].
*/
type GrowthMetrics = {
  maxOD: number | null;
  muMax: number | null;
  doublingTimeH: number | null;
  lagTimeH: number | null;
  aucod: number | null;
  nPoints: number;
  tSpan: number | null;
  expIdx: number | null;   // start index of steepest ln-OD interval
  minOD: number | null;
  tMin: number | null;
  tMax: number | null;
};

function computeGrowthMetrics(data?: { t: number; od: number }[]): GrowthMetrics {
  const empty: GrowthMetrics = {
    maxOD: null, muMax: null, doublingTimeH: null, lagTimeH: null, aucod: null,
    nPoints: data?.length ?? 0, tSpan: null, expIdx: null, minOD: null, tMin: null, tMax: null,
  };
  if (!data || data.length < 2) return empty;
  // Defensive copy sorted by time so slope/AUC math is monotonic in t.
  const pts = [...data].filter(d => Number.isFinite(d.t) && Number.isFinite(d.od)).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return { ...empty, nPoints: pts.length };

  const ods = pts.map(p => p.od);
  const ts = pts.map(p => p.t);
  const maxOD = Math.max(...ods);
  const minOD = Math.min(...ods);
  const tMin = ts[0];
  const tMax = ts[ts.length - 1];
  const tSpan = tMax - tMin;

  // muMax: steepest ln(OD) slope across consecutive points. Skip intervals with
  // non-positive OD (ln undefined) or zero/negative dt.
  let muMax: number | null = null;
  let expIdx: number | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const dt = ts[i + 1] - ts[i];
    if (dt <= 0 || ods[i] <= 0 || ods[i + 1] <= 0) continue;
    const slope = (Math.log(ods[i + 1]) - Math.log(ods[i])) / dt;
    if (muMax === null || slope > muMax) { muMax = slope; expIdx = i; }
  }
  const doublingTimeH = muMax !== null && muMax > 0 ? Math.LN2 / muMax : null;

  // lagTimeH: first time OD reaches >= 2x the baseline (min of first up-to-3 pts).
  const baseline = Math.min(...ods.slice(0, Math.min(3, ods.length)));
  let lagTimeH: number | null = null;
  if (baseline > 0) {
    const thresh = baseline * 2;
    for (let i = 0; i < pts.length; i++) {
      if (ods[i] >= thresh) { lagTimeH = ts[i]; break; }
    }
  }

  // AUC by trapezoid rule (OD * hours).
  let aucod = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    aucod += ((ods[i] + ods[i + 1]) / 2) * (ts[i + 1] - ts[i]);
  }

  return {
    maxOD, muMax, doublingTimeH, lagTimeH, aucod,
    nPoints: pts.length, tSpan, expIdx, minOD, tMin, tMax,
  };
}

// Small formatter so n/a renders consistently everywhere a metric is shown.
function fmtMetric(v: number | null, digits = 2, suffix = ''): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(digits)}${suffix}`;
}

function GrowthCurveSparkline({
  data, odSources, width = 88, height = 38, yMaxOverride, xMinOverride, xMaxOverride,
  sample, onExpand,
}: {
  data?: { t: number; od: number }[];
  odSources?: { type: string; source: string }[];
  width?: number; height?: number;
  yMaxOverride?: number; xMinOverride?: number; xMaxOverride?: number;
  sample?: MutationSample;
  onExpand?: (s: MutationSample) => void;
}) {
  const clickable = !!(onExpand && sample);
  if (!data || data.length < 2) {
    // No numeric series in the DB. If the LIMS tracked an OD measurement
    // upstream, show a small "OD" badge with the source filename in the
    // tooltip - researchers can then track down the actual file.
    if (odSources && odSources.length > 0) {
      const tooltip = odSources
        .map(s => `${s.type.replace('OD_series_', '')}: ${s.source}`)
        .join('\n') + '\n(numeric series not in DB mirror)';
      const badge = (
        <div
          className={cn(
            'flex items-center justify-center text-[9px] font-semibold rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
            clickable && 'cursor-pointer hover:ring-1 hover:ring-amber-400',
          )}
          style={{ width, height }}
          title={clickable ? tooltip + '\nClick to expand growth curve' : tooltip}
          aria-label={tooltip}
        >
          OD ref
        </div>
      );
      if (clickable) {
        return (
          <button type="button" onClick={() => onExpand!(sample!)} className="block p-0 m-0 bg-transparent border-0">
            {badge}
          </button>
        );
      }
      return badge;
    }
    return <div className="text-[9px] text-[var(--text-faint)] italic flex items-center justify-center" style={{ width, height }}>no curve</div>;
  }
  const xs = data.map(d => d.t);
  const ys = data.map(d => d.od);
  const xMin = xMinOverride ?? Math.min(...xs);
  const xMax = xMaxOverride ?? Math.max(...xs);
  const yMin = 0;
  const yMax = yMaxOverride ?? Math.max(0.05, Math.max(...ys));
  const pad = 3;
  const sx = (x: number) => pad + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * (height - pad * 2);
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${sx(d.t).toFixed(1)} ${sy(d.od).toFixed(1)}`).join(' ');
  // Filled area: line path closed down to the baseline so the curve shape reads
  // at a glance even at 70px wide.
  const areaPath = `${linePath} L ${sx(data[data.length - 1].t).toFixed(1)} ${(height - pad).toFixed(1)} L ${sx(data[0].t).toFixed(1)} ${(height - pad).toFixed(1)} Z`;

  // The max-OD point (carrying-capacity marker).
  const maxY = Math.max(...ys);
  const maxPt = data.reduce((best, d) => (d.od > best.od ? d : best), data[0]);
  const capY = sy(maxY);

  // Heavy metric calc lives only in the tooltip string (one per sparkline, cheap
  // enough; the full work happens in the modal).
  const m = computeGrowthMetrics(data);
  const tooltip =
    `OD max ${fmtMetric(m.maxOD)} (K) | mu ${fmtMetric(m.muMax, 3, '/h')} | ` +
    `doubling ${fmtMetric(m.doublingTimeH, 2, ' h')} | ` +
    `t ${fmtMetric(m.tMin, 1)}-${fmtMetric(m.tMax, 1)} h, ${m.nPoints} pts` +
    (clickable ? '\nClick to expand growth curve' : '');

  const svg = (
    <svg width={width} height={height} className="block" aria-label={tooltip}>
      <title>{tooltip}</title>
      {/* y=0 baseline */}
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--border)" strokeWidth="0.5" />
      {/* carrying-capacity (max OD) reference line */}
      <line x1={pad} y1={capY} x2={width - pad} y2={capY} stroke="var(--data-grow)" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.45" />
      {/* filled area under curve */}
      <path d={areaPath} fill="var(--data-grow)" opacity="0.12" stroke="none" />
      {/* curve */}
      <path d={linePath} fill="none" stroke="var(--data-grow)" strokeWidth="1.4" />
      {/* max-OD marker */}
      <circle cx={sx(maxPt.t)} cy={sy(maxPt.od)} r="1.8" fill="var(--data-grow)" stroke="white" strokeWidth="0.5" />
    </svg>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => onExpand!(sample!)}
        className="block p-0 m-0 bg-transparent border-0 cursor-pointer rounded hover:ring-1 hover:ring-[var(--data-grow)]/60"
        title="Click to expand growth curve"
      >
        {svg}
      </button>
    );
  }
  return svg;
}

function sortSamples(samples: MutationSample[]): MutationSample[] {
  return [...samples].sort((a, b) => {
    const ae = a.experiment || '';
    const be = b.experiment || '';
    if (ae !== be) return ae.localeCompare(be);
    const ar = a.replicate || '';
    const br = b.replicate || '';
    if (ar !== br) return ar.localeCompare(br);
    const ad = a.donor_dna || '';
    const bd = b.donor_dna || '';
    if (ad !== bd) return ad.localeCompare(bd);
    // Sort by transfer NUMBER whenever both samples have one (not just ALE):
    // any time-course experiment benefits from T1 < T6 < T11 < T25 ordering
    // instead of the lexicographic T1 < T11 < T18 < T25 < T6.
    if (typeof a.transfer === 'number' && typeof b.transfer === 'number' && a.transfer !== b.transfer) {
      return a.transfer - b.transfer;
    }
    // Then by selection variant ('P' before 'S1','S2','L1','L2','C') so colonies group together.
    const aSel = a.selection_note || '';
    const bSel = b.selection_note || '';
    if (aSel !== bSel) return aSel.localeCompare(bSel);
    return a.name.localeCompare(b.name);
  });
}

interface MutationExplorerProps {
  // When supplied, the URL (via the parent route) is authoritative for the
  // active tab and overrides the persisted localStorage restore below. When
  // omitted (the static-mode root landing default), prior standalone
  // behavior, localStorage restore, no callback, is unchanged.
  activeTab?: MutationRouteTab;
  onTabChange?: (tab: MutationRouteTab) => void;
}

export default function MutationExplorer({ activeTab, onTabChange }: MutationExplorerProps = {}) {
  const [tab, setTab] = useState<Tab>(activeTab ?? 'samples');
  const [data, setData] = useState<MutationDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [experiment, setExperiment] = useState<string>(''); // '' = all experiments
  const [registry, setRegistry] = useState<string>('');     // '' = let the API pick the modal registry
  // When the CN callout is clicked we jump to Comparative AND force its metric
  // filter to copy_number. A bump counter lets the panel react even if the user
  // later changes the filter and clicks the callout again.
  const [forceMetric, setForceMetric] = useState<{ metric: 'copy_number'; nonce: number } | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  // Cross-component navigation: the Guide dispatches `aiale:navigate`
  // CustomEvents to jump straight to a tab (and optionally a sub-mode). This
  // keeps the help system decoupled from this component's internal tab state.
  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: Tab } | undefined;
      if (detail?.tab && (detail.tab === 'samples' || detail.tab === 'compare' || detail.tab === 'growth' || detail.tab === 'libraryVariants' || detail.tab === 'copynumber')) {
        if (detail.tab === 'libraryVariants' && data?.stats?.hasBarcodes !== true) return;
        setTab(detail.tab);
      }
    };
    window.addEventListener('aiale:navigate', onNav as EventListener);
    return () => window.removeEventListener('aiale:navigate', onNav as EventListener);
  }, [data?.stats?.hasBarcodes]);

  useEffect(() => {
    try {
      const s = localStorage.getItem(SELECTED_KEY);
      if (s) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser-local selection.
        setSelected(new Set(JSON.parse(s)));
      }
      // A supplied activeTab (route-driven) overrides the persisted restore;
      // it is applied by the sync effect below instead.
      if (activeTab === undefined) {
        const t = localStorage.getItem(TAB_KEY);
        if (t === 'compare' || t === 'samples' || t === 'growth' || t === 'libraryVariants' || t === 'copynumber') setTab(t);
      }
      const e = localStorage.getItem(EXPERIMENT_KEY);
      if (e !== null) setExperiment(e);
      const r = localStorage.getItem(REGISTRY_KEY);
      if (r !== null) setRegistry(r);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once at mount; activeTab is read intentionally as a one-time initial override.
  }, []);

  useEffect(() => { try { localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected])); } catch {} }, [selected]);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch {} }, [tab]);

  // Route-driven sync: whenever the parent supplies a tab (canonical URL
  // navigation, Back/Forward), mirror it into local state. If the requested
  // tab is Library Variants but the loaded dataset has no barcode data, fall
  // back to Sample Selection and tell the parent so the URL is corrected too
  // Never render a fabricated/blank barcode view.
  useEffect(() => {
    if (activeTab === undefined) return;
    if (activeTab === 'libraryVariants' && data && data.stats && !data.stats.hasBarcodes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Requested tab is unavailable in this snapshot.
      setTab('samples');
      onTabChange?.('samples');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mirrors the route-supplied tab into local state.
    setTab(activeTab);
  }, [activeTab, data, onTabChange]);

  // Standalone (no route control, e.g. the static-mode root default) gating:
  // if the active dataset has no barcode data (e.g. the TFMN1 publication
  // snapshot DB omits verAB_barcodes) and a persisted tab restored us onto
  // Library Variants, move to Sample Selection rather than show a blank pane.
  useEffect(() => {
    if (activeTab !== undefined) return;
    if (tab === 'libraryVariants' && data && data.stats && !data.stats.hasBarcodes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restored tab is unavailable in this snapshot.
      setTab('samples');
    }
  }, [tab, data, activeTab]);
  useEffect(() => { try { localStorage.setItem(EXPERIMENT_KEY, experiment); } catch {} }, [experiment]);
  useEffect(() => { try { localStorage.setItem(REGISTRY_KEY, registry); } catch {} }, [registry]);

  const load = async (expFilter: string, regFilter: string) => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (expFilter) qs.set('experiment', expFilter);
      if (regFilter) qs.set('registry', regFilter);
      const url = qs.toString() ? `/api/mutations?${qs.toString()}` : '/api/mutations';
      const res = await fetchData(url);
      const json = await res.json();
      if (json.error) { setError(json.error); setData({ samples: [], mutations: [], experiments: [] }); }
      else setData(json as MutationDataset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mutation dataset');
      setData({ samples: [], mutations: [], experiments: [] });
    } finally { setLoading(false); }
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts request-driven mutation loading.
    load(experiment, registry);
  }, [experiment, registry]);

  // Changing the experiment also resets the registry: the set of available
  // registries differs by experiment, so a stale pin would silently fall back
  // to the modal-registry warning every time.
  const onExperimentChange = (next: string) => { setRegistry(''); setExperiment(next); };

  // Single entry point for every internal tab switch (tab bar clicks and the
  // in-panel shortcut buttons below). Updates local state immediately for a
  // responsive UI, then notifies the parent so canonical routes / Back-
  // Forward stay in sync. Persistence (TAB_KEY effect above) and the
  // `aiale:navigate` event listener are unaffected.
  const selectTab = (next: Tab) => {
    setTab(next);
    onTabChange?.(next);
  };

  // Prune selected IDs that no longer exist in the dataset.
  useEffect(() => {
    if (!data) return;
    const valid = new Set(data.samples.map(s => s.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selected) {
      if (valid.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Removes IDs absent from refreshed data.
      setSelected(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Pruning only occurs when external data changes.
  }, [data]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2">
        <div className="flex min-w-0 items-stretch overflow-x-auto">
          <TabButton active={tab === 'samples'} onClick={() => selectTab('samples')} icon={<FlaskConical className="w-3.5 h-3.5" />} tour="tab-samples">
            Sample Selection
            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface-3)] text-[var(--text-soft)] tabular-nums">{data?.samples.length ?? 0}</span>
          </TabButton>
          <TabButton active={tab === 'compare'} onClick={() => selectTab('compare')} icon={<GitCompare className="w-3.5 h-3.5" />} tour="tab-compare">
            Compare Mutations
            <span className={cn(
              "ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums",
              selected.size > 0 ? "bg-[var(--accent-600)] text-white" : "bg-[var(--surface-3)] text-[var(--text-soft)]"
            )}>{selected.size}</span>
          </TabButton>
          <TabButton active={tab === 'growth'} onClick={() => selectTab('growth')} icon={<TrendingUp className="w-3.5 h-3.5" />} tour="tab-growth-curves">
            Compare Growth Curves
            <span className={cn(
              "ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums",
              selected.size > 0 ? "bg-[var(--data-grow)] text-white" : "bg-[var(--surface-3)] text-[var(--text-soft)]"
            )}>{selected.size}</span>
          </TabButton>
          {data?.stats?.hasBarcodes && (
            <TabButton active={tab === 'libraryVariants'} onClick={() => selectTab('libraryVariants')} icon={<Sparkles className="w-3.5 h-3.5" />} tour="tab-library-variants">
              Compare Library Variants
              <span className={cn(
                "ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums",
                selected.size > 0 ? "bg-violet-600 text-white" : "bg-[var(--surface-3)] text-[var(--text-soft)]"
              )}>{selected.size}</span>
            </TabButton>
          )}
          <TabButton active={tab === 'copynumber'} onClick={() => selectTab('copynumber')} icon={<Dna className="w-3.5 h-3.5" />} tour="tab-copynumber">
            Copy Number
            {(data?.stats?.cnRegionCount ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums lims-pill-cn">{data!.stats!.cnRegionCount}</span>
            )}
          </TabButton>
        </div>
        {<div className="flex items-center gap-1.5 pr-1" data-tour="experiment-controls">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-soft)]">
            <span className="lims-label">Experiment</span>
            <select
              value={experiment}
              onChange={e => onExperimentChange(e.target.value)}
              className="lims-input !w-auto !py-1 !text-[11.5px]"
              title="Scope the loaded dataset to one experiment for faster queries"
            >
              <option value="">all ({data?.experiments?.length ?? '?'})</option>
              {(data?.experiments ?? []).map(e => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-soft)]" title={IS_STATIC ? 'In the public static build, each experiment shows its primary breseq run. Switching runs needs the interactive server build.' : 'Breseq parameter set. Each registry is one breseq run; the dataset can contain calls from multiple runs. Pick one to view at a time.'}>
            <span className="lims-label">Registry</span>
            <select
              value={registry}
              onChange={e => setRegistry(e.target.value)}
              disabled={IS_STATIC || !data?.registries || data.registries.length <= 1}
              className="lims-input !w-auto !py-1 !text-[11.5px] disabled:opacity-60 disabled:cursor-not-allowed font-mono"
            >
              <option value="">
                {data?.selectedRegistry
                  ? `auto · ${data.selectedRegistry.replace(/^breseq_/, '')}`
                  : `auto (${data?.registries?.length ?? 0})`}
              </option>
              {(data?.registries ?? []).map(r => {
                const shortId = r.id.replace(/^breseq_/, '');
                const cutoff = r.polymorphism_frequency_cutoff !== null
                  ? ` · poly≥${r.polymorphism_frequency_cutoff}`
                  : '';
                const tag = r.unregistered ? ' · params not registered yet' : cutoff;
                return (
                  <option key={r.id} value={r.id}>
                    {shortId}{tag} · {r.count.toLocaleString()} calls
                  </option>
                );
              })}
            </select>
          </label>
          {tab === 'samples' && selected.size > 0 && (
            <button onClick={() => selectTab('compare')} className="lims-btn lims-btn-primary" title="Compare the selected samples">
              Compare {selected.size} →
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="lims-btn lims-btn-ghost" title="Clear selection">
              Clear
            </button>
          )}
          <button onClick={() => load(experiment, registry)} className="lims-btn lims-btn-ghost p-1.5" title="Reload mutation dataset">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>}
      </div>

      {/* Compact context strip: stats + dataset-notes toggle in ONE thin row */}
      {!error && data?.stats && (
        <div className="flex items-center gap-4 flex-wrap px-3 h-8 border-b border-[var(--border)] bg-[var(--surface-2)] text-[11px]" data-tour="stats-strip">
          <StatPill label="samples" value={data.stats.sampleCount} />
          <StatPill label="mutations" value={data.stats.frequencyRowCount} accent="mut" />
          <StatPill label="OD curves" value={data.stats.curveCount} accent={data.stats.curveCount > 0 ? 'grow' : undefined} />
          <StatPill
            label={data.stats.cnRegionCount === 1 ? 'CN region' : 'CN regions'}
            value={data.stats.cnRegionCount}
            accent={data.stats.cnRegionCount > 0 ? 'cn' : undefined}
          />
          {data?.warnings && data.warnings.length > 0 && (
            <button
              onClick={() => setShowNotes(v => !v)}
              data-on={showNotes}
              className="lims-toggle !py-0.5 !px-1.5 !text-[10.5px]"
              title="Dataset notes from the loader"
            >
              <Info className="w-3 h-3" />
              {data.warnings.length} note{data.warnings.length === 1 ? '' : 's'}
              {showNotes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
          {data.stats.cnRegionCount > 0 && tab !== 'copynumber' && (
            <button
              onClick={() => { selectTab('copynumber'); }}
              className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-[10.5px] font-medium"
              title="Open the dedicated copy-number trend view"
            >
              <Dna className="w-3 h-3" />
              copy-number →
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 m-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-[12px] rounded border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Could not load mutation dataset.</div>
            <div className="text-[11px] mt-0.5 opacity-80">{error}</div>
            <div className="text-[11px] mt-1 opacity-80">Pulled from the <span className="font-mono">Mutations</span> table in the configured LIMS database. Check that <span className="font-mono">SQLITE_PATH</span> / <span className="font-mono">MYSQL_URL</span> points at the mirror that contains the breseq calls.</div>
          </div>
        </div>
      )}

      {/* Dataset notes only render when toggled; they never steal table space. */}
      {!error && showNotes && data?.warnings && data.warnings.length > 0 && (
        <div className="flex items-start gap-2 mx-3 mt-2 p-2 bg-amber-50/70 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-[11px] rounded border border-amber-200 dark:border-amber-800">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <ul className="list-disc list-inside opacity-90 space-y-0.5 flex-1">
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <button onClick={() => setShowNotes(false)} className="shrink-0 opacity-60 hover:opacity-100" title="Hide notes">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Keep tabs mounted so their state (filters, scroll, selection)
            persists when the user flips between them. Hidden via CSS only. */}
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'samples' ? '' : 'hidden')}>
          <SampleSelectionPanel
            samples={data?.samples ?? []}
            mutations={data?.mutations ?? []}
            selected={selected}
            setSelected={setSelected}
            search={search}
            setSearch={setSearch}
            loading={loading}
            onCompareSelected={() => selectTab('compare')}
            hasBarcodes={data?.stats?.hasBarcodes === true}
          />
        </div>
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'compare' ? '' : 'hidden')}>
          <ComparativePanel
            samples={data?.samples ?? []}
            mutations={data?.mutations ?? []}
            selected={selected}
            setSelected={setSelected}
            onJumpToSelection={() => selectTab('samples')}
            loading={loading}
            forceMetric={forceMetric}
          />
        </div>
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'growth' ? '' : 'hidden')}>
          <GrowthCurveComparison
            samples={data?.samples ?? []}
            selected={selected}
            loading={loading}
            experiment={experiment}
            setSelected={setSelected}
            setTab={selectTab}
            hasBarcodes={data?.stats?.hasBarcodes === true}
          />
        </div>
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'libraryVariants' ? '' : 'hidden')}>
          <LibraryVariantComparison
            samples={data?.samples ?? []}
            selected={selected}
            loading={loading}
          />
        </div>
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'copynumber' ? '' : 'hidden')}>
          <CopyNumberPanel
            samples={data?.samples ?? []}
            mutations={data?.mutations ?? []}
            loading={loading}
            cnRegionCount={data?.stats?.cnRegionCount ?? 0}
            currentExperiment={experiment}
            availableExperiments={data?.experiments ?? []}
            onLoadExperiment={onExperimentChange}
            onCompareCN={() => {
              setForceMetric({ metric: 'copy_number', nonce: Date.now() });
              selectTab('compare');
            }}
            onPickSamples={() => selectTab('samples')}
          />
        </div>

      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children, tour }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode; tour?: string }) {
  return (
    <button onClick={onClick} data-active={active} data-tour={tour} className="lims-tab">
      {icon}
      {children}
    </button>
  );
}

/* ---------------- Sample Selection panel ---------------- */

type ChipKey = 'experiment' | 'replicate' | 'donor_dna' | 'strain' | 'condition' | 'seqorder' | 'verab';

type SampleFilters = {
  chips: Record<ChipKey, string[]>;
  selectedOnly: boolean;
  transferMin: number | null;
  transferMax: number | null;
};

const EMPTY_SAMPLE_FILTERS: SampleFilters = {
  chips: { experiment: [], replicate: [], donor_dna: [], strain: [], condition: [], seqorder: [], verab: [] },
  selectedOnly: false,
  transferMin: null,
  transferMax: null,
};

function ChipRow({
  label, options, active, onToggle, onClear,
}: {
  label: string;
  options: { value: string; count: number }[];
  active: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
      <span className="text-slate-500 dark:text-gray-400 font-medium uppercase tracking-wider text-[10px] w-20 shrink-0">{label}</span>
      {options.map(o => {
        const on = active.has(o.value);
        return (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={cn(
              'px-1.5 py-0.5 rounded border text-[11px] transition-colors max-w-[200px] truncate',
              on
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300'
            )}
            title={`${o.value} (${o.count} samples)`}
          >
            {o.value} <span className="text-slate-400 dark:text-gray-500 tabular-nums">{o.count}</span>
          </button>
        );
      })}
      {active.size > 0 && (
        <button onClick={onClear} className="text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200 text-[10.5px]">
          clear
        </button>
      )}
    </div>
  );
}

function SampleSelectionPanel({
  samples, mutations, selected, setSelected, search, setSearch, loading, onCompareSelected, hasBarcodes,
}: {
  samples: MutationSample[]; mutations: MutationRow[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  search: string; setSearch: (s: string) => void; loading: boolean;
  onCompareSelected: () => void;
  hasBarcodes: boolean;
}) {
  const [filters, setFilters] = useState<SampleFilters>(EMPTY_SAMPLE_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // The sample whose growth-curve sparkline was clicked; drives the modal.
  const [growthCurveSample, setGrowthCurveSample] = useState<MutationSample | null>(null);
  // The sample whose NAME was clicked; drives the rich sample-detail modal.
  const [detailSample, setDetailSample] = useState<MutationSample | null>(null);
  const [detailDonorDna, setDetailDonorDna] = useState<string | null>(null);
  const [detailStrain, setDetailStrain] = useState<string | null>(null);

  // Rehydrate filter + collapse state from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAMPLE_FILTERS_KEY);
      if (raw) {
        const f = JSON.parse(raw) as Partial<SampleFilters>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser-local sample filters.
        setFilters({
          chips: {
            experiment: f.chips?.experiment ?? [],
            replicate: f.chips?.replicate ?? [],
            donor_dna: f.chips?.donor_dna ?? [],
            strain: f.chips?.strain ?? [],
            condition: f.chips?.condition ?? [],
            seqorder: f.chips?.seqorder ?? [],
            verab: f.chips?.verab ?? [],
          },
          // "Selected only" is a transient view toggle, never restored on load:
          // restoring it true opens the table empty (nothing is selected yet).
          selectedOnly: false,
          transferMin: typeof f.transferMin === 'number' ? f.transferMin : null,
          transferMax: typeof f.transferMax === 'number' ? f.transferMax : null,
        });
      }
      const c = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      if (c) setCollapsed(new Set(JSON.parse(c) as string[]));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SAMPLE_FILTERS_KEY, JSON.stringify(filters)); } catch {}
  }, [filters, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsed])); } catch {}
  }, [collapsed, hydrated]);

  const mutationCountBySample = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of mutations) {
      for (const [sid, v] of Object.entries(row.values)) {
        if (typeof v === 'number' && v > 0) m.set(sid, (m.get(sid) ?? 0) + 1);
      }
    }
    return m;
  }, [mutations]);

  // Faceted chip options: each facet lists only values that still have matching
  // samples given the OTHER active facets (cross-filtering), so picking one factor
  // hides now-irrelevant choices in the others. A facet never hides its own
  // siblings, and a currently-selected value is always kept visible.
  const chipOptions = useMemo(() => {
    const keys: ChipKey[] = ['experiment', 'replicate', 'donor_dna', 'strain', 'condition', 'seqorder', 'verab'];
    const sel: Record<ChipKey, Set<string>> = {
      experiment: new Set(filters.chips.experiment),
      replicate: new Set(filters.chips.replicate),
      donor_dna: new Set(filters.chips.donor_dna),
      strain: new Set(filters.chips.strain),
      condition: new Set(filters.chips.condition),
      seqorder: new Set(filters.chips.seqorder),
      verab: new Set(filters.chips.verab),
    };
    const fieldVal = (s: MutationSample, k: ChipKey): string =>
      k === 'experiment' ? s.experiment
      : k === 'replicate' ? (s.replicate ?? '')
      : k === 'donor_dna' ? (s.donor_dna ?? '')
      : k === 'strain' ? (s.strain ?? '')
      : k === 'seqorder' ? (s.seqorder ?? '')
      : k === 'verab' ? (s.has_barcodes ? 'has verAB' : '')
      : (s.condition ?? '');
    // A sample matches the chip filters, OPTIONALLY ignoring one facet (so each
    // facet's own selection doesn't hide its sibling options). This is faceted
    // search: picking TFMN1 narrows the strain/DNA/replicate/condition lists to
    // what TFMN1 actually used, while the experiment list itself stays complete.
    const matchesExcept = (s: MutationSample, except: ChipKey): boolean => {
      for (const k of keys) {
        if (k === except) continue;
        if (sel[k].size === 0) continue;
        if (k === 'seqorder') {
          if (!seqorderVals(s).some(v => sel[k].has(v))) return false;
          continue;
        }
        if (!sel[k].has(fieldVal(s, k))) return false;
      }
      return true;
    };
    const toList = (k: ChipKey) => {
      const counts = new Map<string, number>();
      for (const s of samples) {
        if (!matchesExcept(s, k)) continue;
        if (k === 'seqorder') {
          for (const v of seqorderVals(s)) counts.set(v, (counts.get(v) ?? 0) + 1);
          continue;
        }
        const v = fieldVal(s, k);
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      // Always keep an option that is itself currently selected, even if the
      // cross-filter would otherwise drop it (so a selection never silently
      // vanishes from view); show it with its narrowed count (0 if none remain).
      for (const v of sel[k]) if (!counts.has(v)) counts.set(v, 0);
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };
    return {
      experiment: toList('experiment'),
      replicate: toList('replicate'),
      donor_dna: toList('donor_dna'),
      strain: toList('strain'),
      condition: toList('condition'),
      seqorder: toList('seqorder'),
      verab: toList('verab'),
    };
  }, [samples, filters.chips]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = sortSamples(samples);
      const chipSet = {
      experiment: new Set(filters.chips.experiment),
      replicate: new Set(filters.chips.replicate),
      donor_dna: new Set(filters.chips.donor_dna),
      strain: new Set(filters.chips.strain),
      condition: new Set(filters.chips.condition),
      seqorder: new Set(filters.chips.seqorder),
      verab: new Set(filters.chips.verab),
    };
    return sorted.filter(s => {
      if (filters.selectedOnly && !selected.has(s.id)) return false;
      if (chipSet.experiment.size > 0 && !chipSet.experiment.has(s.experiment)) return false;
      if (chipSet.replicate.size > 0 && !chipSet.replicate.has(s.replicate ?? '')) return false;
      if (chipSet.donor_dna.size > 0 && !chipSet.donor_dna.has(s.donor_dna ?? '')) return false;
      if (chipSet.strain.size > 0 && !chipSet.strain.has(s.strain ?? '')) return false;
      if (chipSet.condition.size > 0 && !chipSet.condition.has(s.condition ?? '')) return false;
      if (chipSet.seqorder.size > 0 && !seqorderVals(s).some(v => chipSet.seqorder.has(v))) return false;
      if (chipSet.verab.size > 0 && !chipSet.verab.has(s.has_barcodes ? 'has verAB' : '')) return false;
      if (filters.transferMin !== null && (s.transfer ?? -Infinity) < filters.transferMin) return false;
      if (filters.transferMax !== null && (s.transfer ?? Infinity) > filters.transferMax) return false;
      if (q) {
        const hay = `${s.name} ${s.experiment} ${s.strain ?? ''} ${s.donor_dna ?? ''} ${s.condition ?? ''} ${s.replicate ?? ''} ${seqorderVals(s).join(' ')} ${s.has_barcodes ? 'verAB barcode' : ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [samples, search, filters, selected]);

  const allOnPageSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allOnPageSelected) filtered.forEach(s => next.delete(s.id));
    else filtered.forEach(s => next.add(s.id));
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const grouped: { key: string; label: string; rows: MutationSample[] }[] = useMemo(() => {
    const out: { key: string; label: string; rows: MutationSample[] }[] = [];
    let curKey = '';
    for (const s of filtered) {
      const key = `${s.experiment}||${s.replicate ?? ''}||${s.donor_dna ?? ''}`;
      if (key !== curKey) {
        const label = [
          s.experiment,
          s.replicate ? `Replicate ${s.replicate}` : null,
          s.donor_dna,
        ].filter(Boolean).join(' · ');
        out.push({ key, label, rows: [] });
        curKey = key;
      }
      out[out.length - 1].rows.push(s);
    }
    return out;
  }, [filtered]);

  const toggleGroup = (rows: MutationSample[]) => {
    const allSel = rows.every(s => selected.has(s.id));
    const next = new Set(selected);
    if (allSel) rows.forEach(r => next.delete(r.id));
    else rows.forEach(r => next.add(r.id));
    setSelected(next);
  };

  const toggleCollapse = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsed(next);
  };
  const collapseAll = () => setCollapsed(new Set(grouped.map(g => g.key)));
  const expandAll = () => setCollapsed(new Set());

  // Select first + last transfer per group - useful for time-course experiments
  // where you usually want the endpoints, not every intermediate.
  const selectEndpoints = () => {
    const next = new Set(selected);
    for (const g of grouped) {
      const withT = g.rows.filter(r => typeof r.transfer === 'number');
      if (withT.length < 1) continue;
      const minT = Math.min(...withT.map(r => r.transfer as number));
      const maxT = Math.max(...withT.map(r => r.transfer as number));
      for (const r of withT) {
        if (r.transfer === minT || r.transfer === maxT) next.add(r.id);
      }
    }
    setSelected(next);
  };

  const toggleChip = (k: ChipKey, v: string) => {
    setFilters(prev => {
      const arr = prev.chips[k];
      const next = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
      return { ...prev, chips: { ...prev.chips, [k]: next } };
    });
  };
  const filterToFacet = (k: ChipKey, v: string) => {
    setFilters(prev => ({ ...prev, chips: { ...prev.chips, [k]: [v] }, selectedOnly: false }));
    setSearch('');
  };
  const selectFacetSamples = (k: 'donor_dna' | 'strain', v: string, compare = false) => {
    const ids = samples.filter(s => (k === 'donor_dna' ? s.donor_dna : s.strain) === v).map(s => s.id);
    setSelected(new Set(ids));
    if (compare && ids.length > 0) onCompareSelected();
  };
  const clearChip = (k: ChipKey) => {
    setFilters(prev => ({ ...prev, chips: { ...prev.chips, [k]: [] } }));
  };
  const clearAllFilters = () => setFilters(EMPTY_SAMPLE_FILTERS);

  const anyFilterActive =
    !!search.trim() ||
    filters.selectedOnly ||
    filters.transferMin !== null ||
    filters.transferMax !== null ||
    (Object.values(filters.chips) as string[][]).some(arr => arr.length > 0);

  // How many facet filters are active right now (chips + transfer range), so the
  // collapsed Filters button can show a badge instead of hiding active filters.
  const activeFacetCount =
    (Object.values(filters.chips) as string[][]).reduce((n, arr) => n + arr.length, 0) +
    (filters.transferMin !== null || filters.transferMax !== null ? 1 : 0);

  // Peers for the growth-curve modal: filtered samples sharing the focused
  // sample's experiment + replicate + donor_dna (the cheapest same-group key).
  const growthPeers = useMemo(() => {
    if (!growthCurveSample) return [];
    const key = (s: MutationSample) => `${s.experiment}|${s.replicate ?? ''}|${s.donor_dna ?? ''}`;
    const k = key(growthCurveSample);
    return filtered.filter(s => key(s) === k);
  }, [growthCurveSample, filtered]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2"><ViewInfo title="Sample Selection" description="Filter and select samples for mutation, growth, library-variant, and copy-number comparisons." detail="Options reflect the loaded read-only snapshot." /></div>
      {/* Search + summary row */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 flex items-center gap-2 bg-white dark:bg-gray-800 flex-wrap">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, strain, experiment, replicate, donor, condition…"
            className="lims-input pl-8 pr-7 !py-1.5"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text)]" title="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(v => !v)}
          data-on={showFilters}
          className="lims-toolbtn"
          title="Show or hide chip filters"
        >
          <Filter className="w-3 h-3" /> Filters
          {activeFacetCount > 0 && (
            <span className="ml-0.5 px-1 rounded-full bg-[var(--accent-600)] text-white text-[9.5px] font-semibold tabular-nums leading-none py-0.5">
              {activeFacetCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setFilters(prev => ({ ...prev, selectedOnly: !prev.selectedOnly }))}
          data-on={filters.selectedOnly}
          className="lims-toolbtn"
          title="Show only samples you've selected"
        >
          {filters.selectedOnly ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          Selected only
        </button>
        <button onClick={expandAll} className="lims-toolbtn" title="Expand every group">
          <UnfoldVertical className="w-3 h-3" /> Expand
        </button>
        <button onClick={collapseAll} className="lims-toolbtn" title="Collapse every group">
          <FoldVertical className="w-3 h-3" /> Collapse
        </button>
        <button
          onClick={selectEndpoints}
          className="lims-toolbtn"
          title="Select the first and last transfer per group (useful for time-course endpoints)"
          disabled={grouped.length === 0}
        >
          Select endpoints
        </button>
        {anyFilterActive && (
          <button
            onClick={() => { clearAllFilters(); setSearch(''); }}
            className="lims-btn lims-btn-ghost !text-[11px]"
            title="Clear search + all chip filters"
          >
            Reset all
          </button>
        )}
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="lims-btn lims-btn-ghost !text-[11px]"
            title="Clear all samples from your selection"
          >
            <X className="w-3 h-3" /> Clear selection ({selected.size})
          </button>
        )}
        <div className="text-[11px] text-[var(--text-soft)] ml-auto tabular-nums whitespace-nowrap">
          {selected.size} selected · {filtered.length}/{samples.length} shown · {grouped.length} group{grouped.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Chip filter rows */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 space-y-1.5">
          <ChipRow label="Experiment" options={chipOptions.experiment} active={new Set(filters.chips.experiment)}
                   onToggle={v => toggleChip('experiment', v)} onClear={() => clearChip('experiment')} />
          <ChipRow label="Replicate" options={chipOptions.replicate} active={new Set(filters.chips.replicate)}
                   onToggle={v => toggleChip('replicate', v)} onClear={() => clearChip('replicate')} />
          <ChipRow label="Donor DNA" options={chipOptions.donor_dna} active={new Set(filters.chips.donor_dna)}
                   onToggle={v => toggleChip('donor_dna', v)} onClear={() => clearChip('donor_dna')} />
          <ChipRow label="Strain" options={chipOptions.strain} active={new Set(filters.chips.strain)}
                   onToggle={v => toggleChip('strain', v)} onClear={() => clearChip('strain')} />
          <ChipRow label="Condition" options={chipOptions.condition} active={new Set(filters.chips.condition)}
                   onToggle={v => toggleChip('condition', v)} onClear={() => clearChip('condition')} />
          <ChipRow label="Seqorder" options={chipOptions.seqorder} active={new Set(filters.chips.seqorder)}
                   onToggle={v => toggleChip('seqorder', v)} onClear={() => clearChip('seqorder')} />
          <ChipRow label="verAB" options={chipOptions.verab} active={new Set(filters.chips.verab)}
                   onToggle={v => toggleChip('verab', v)} onClear={() => clearChip('verab')} />
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-slate-500 dark:text-gray-400 font-medium uppercase tracking-wider text-[10px] w-20 shrink-0">Transfer</span>
            <input
              type="number" placeholder="min"
              value={filters.transferMin ?? ''}
              onChange={e => setFilters(prev => ({ ...prev, transferMin: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-16 text-[11px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums"
            />
            <span className="text-slate-400 dark:text-gray-500">to</span>
            <input
              type="number" placeholder="max"
              value={filters.transferMax ?? ''}
              onChange={e => setFilters(prev => ({ ...prev, transferMax: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-16 text-[11px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums"
            />
            {(filters.transferMin !== null || filters.transferMax !== null) && (
              <button onClick={() => setFilters(prev => ({ ...prev, transferMin: null, transferMax: null }))}
                      className="text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200 text-[10.5px]">clear</button>
            )}
          </div>
        </div>
      )}

      {/* Sample table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10 bg-[var(--surface-2)] backdrop-blur border-b border-[var(--border)]">
            <tr className="text-left text-[var(--text-soft)]">
              <th className="px-2 py-1.5 w-8">
                <button onClick={toggleAll} className="flex items-center justify-center w-6 h-6 hover:bg-[var(--surface-3)] rounded" title={allOnPageSelected ? 'Deselect all (filtered)' : 'Select all (filtered)'}>
                  {allOnPageSelected ? <CheckSquare className="w-4 h-4 text-[var(--accent-600)]" /> : <Square className="w-4 h-4 text-[var(--text-faint)]" />}
                </button>
              </th>
              <th className="px-2 py-1.5 font-semibold">Sample</th>
              <th className="px-2 py-1.5 font-semibold">Experiment</th>
              <th className="px-2 py-1.5 font-semibold">Replicate</th>
              <th className="px-2 py-1.5 font-semibold">Donor DNA</th>
              <th className="px-2 py-1.5 font-semibold">Strain</th>
              <th className="px-2 py-1.5 font-semibold">Condition</th>
              <th className="px-2 py-1.5 font-semibold text-right">Transfer</th>
              {hasBarcodes && (
                <th className="px-2 py-1.5 font-semibold text-right" title="Distinct verA-verB combinations detected for this sample">verAB combos</th>
              )}
              <th className="px-2 py-1.5 font-semibold text-right">Mutations</th>
              <th className="px-2 py-1.5 font-semibold text-right">Growth curve</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={hasBarcodes ? 11 : 10} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={hasBarcodes ? 11 : 10} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">
                {samples.length === 0
                  ? 'No mutation samples available.'
                  : anyFilterActive
                    ? 'No samples match the current filters. Try clearing some.'
                    : 'No samples match your filter.'}
              </td></tr>
            )}
            {!loading && grouped.map(group => {
              const allSel = group.rows.every(r => selected.has(r.id));
              const someSel = !allSel && group.rows.some(r => selected.has(r.id));
              const selectedInGroup = group.rows.reduce((acc, r) => acc + (selected.has(r.id) ? 1 : 0), 0);
              const isCollapsed = collapsed.has(group.key);
              return (
                <React.Fragment key={group.key}>
                  <tr className="bg-[var(--surface-3)] text-[11px] uppercase tracking-wider text-[var(--text-soft)]">
                    <td className="px-2 py-1">
                      <button
                        onClick={() => toggleGroup(group.rows)}
                        className="flex items-center justify-center w-6 h-6 hover:bg-[var(--border)] rounded"
                        title={allSel ? 'Deselect this group' : 'Select this group'}
                      >
                        {allSel
                          ? <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-600)]" />
                          : someSel
                            ? <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-500)] opacity-60" />
                            : <Square className="w-3.5 h-3.5 text-[var(--text-faint)]" />}
                      </button>
                    </td>
                    <td colSpan={hasBarcodes ? 10 : 9} className="px-1 py-1">
                      <button
                        onClick={() => toggleCollapse(group.key)}
                        className="flex items-center gap-1 font-semibold hover:text-[var(--text)]"
                        title={isCollapsed ? 'Expand group' : 'Collapse group'}
                      >
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {group.label}
                        <span className="ml-1 normal-case text-[var(--text-faint)] font-normal tabular-nums">
                          ({selectedInGroup > 0 ? `${selectedInGroup}/` : ''}{group.rows.length})
                        </span>
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed && group.rows.map(s => {
                    const isSel = selected.has(s.id);
                    const muts = mutationCountBySample.get(s.id) ?? 0;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => toggleOne(s.id)}
                        className={cn(
                          'cursor-pointer border-b border-[var(--border)]',
                          isSel ? 'bg-[var(--accent-50)]' : 'hover:bg-[var(--surface-2)]'
                        )}
                      >
                        <td className="px-2 py-1 align-middle">
                          {isSel ? <CheckSquare className="w-4 h-4 text-[var(--accent-600)]" /> : <Square className="w-4 h-4 text-[var(--text-faint)]" />}
                        </td>
                        <td className="px-2 py-1 lims-id text-[var(--text)]">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDetailSample(s); }}
                            className="text-left hover:text-[var(--accent-600)] hover:underline decoration-dotted underline-offset-2 cursor-pointer"
                            title="Open sample detail"
                          >
                            {s.name}
                          </button>
                          {s.has_barcodes && (
                            <span className="ml-1 inline-flex items-center px-1 py-px rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-[9.5px] font-semibold text-emerald-700 dark:text-emerald-300 align-middle">verAB</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.experiment}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.replicate ?? ''}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">
                          {s.donor_dna ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDetailDonorDna(s.donor_dna ?? null); }}
                              className="inline-flex items-center gap-1 max-w-[220px] text-left font-mono hover:text-[var(--accent-600)] hover:underline decoration-dotted underline-offset-2"
                              title="Open donor DNA detail"
                            >
                              <Dna className="w-3 h-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              <span className="truncate">{s.donor_dna}</span>
                            </button>
                          ) : ''}
                        </td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">
                          {s.strain ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDetailStrain(s.strain ?? null); }}
                              className="inline-flex items-center gap-1 max-w-[180px] text-left font-mono hover:text-[var(--accent-600)] hover:underline decoration-dotted underline-offset-2"
                              title="Open strain detail"
                            >
                              <FlaskConical className="w-3 h-3 shrink-0 text-violet-600 dark:text-violet-400" />
                              <span className="truncate">{s.strain}</span>
                            </button>
                          ) : ''}
                        </td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.condition ?? ''}</td>
                         <td className="px-2 py-1 text-right tabular-nums text-[var(--text)]">{s.transfer ?? ''}</td>
                         {hasBarcodes && (
                           <td className="px-2 py-1 text-right tabular-nums">
                             {s.has_barcodes && (s.verab_combinations ?? 0) > 0
                               ? <span className="tabular-nums text-[var(--text)]">{(s.verab_combinations ?? 0).toLocaleString()}</span>
                                 : <span className="text-[var(--text-faint)]">-</span>}

                           </td>
                         )}
                          <td className="px-2 py-1 text-right tabular-nums">
                            {muts > 0 ? (
                              <span className="inline-block px-1.5 py-0.5 rounded lims-pill-mut text-[10.5px] font-semibold">{muts}</span>
                            ) : <span className="text-[var(--text-faint)]">-</span>}
                         </td>
                        <td className="px-2 py-1">
                          <div className="flex justify-end">
                            <GrowthCurveSparkline data={s.growth_curve} odSources={s.od_sources} width={70} height={26} sample={s} onExpand={setGrowthCurveSample} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {growthCurveSample && (
        <GrowthCurveModal
          sample={growthCurveSample}
          peers={growthPeers}
          onClose={() => setGrowthCurveSample(null)}
        />
      )}
      {detailSample && (
        <SampleDetailModal
          sample={detailSample}
          mutations={mutations}
          allMutationCount={mutationCountBySample.get(detailSample.id) ?? 0}
          onClose={() => setDetailSample(null)}
          onOpenGrowth={(s) => setGrowthCurveSample(s)}
        />
      )}
      {detailDonorDna && (
        <DonorDnaDetailModal
          donorDna={detailDonorDna}
          samples={samples}
          mutations={mutations}
          onClose={() => setDetailDonorDna(null)}
          onFilter={() => filterToFacet('donor_dna', detailDonorDna)}
          onSelect={() => selectFacetSamples('donor_dna', detailDonorDna)}
          onCompare={() => selectFacetSamples('donor_dna', detailDonorDna, true)}
          onOpenGrowth={(s) => { setDetailDonorDna(null); setGrowthCurveSample(s); }}
        />
      )}
      {detailStrain && (
        <StrainDetailModal
          strain={detailStrain}
          samples={samples}
          mutations={mutations}
          onClose={() => setDetailStrain(null)}
          onFilter={() => filterToFacet('strain', detailStrain)}
          onSelect={() => selectFacetSamples('strain', detailStrain)}
          onCompare={() => selectFacetSamples('strain', detailStrain, true)}
          onOpenGrowth={(s) => { setDetailStrain(null); setGrowthCurveSample(s); }}
        />
      )}
    </div>
  );
}

/* ---------------- Comparative Panel ---------------- */

type SortKey = 'gene' | 'variant' | 'type' | 'position' | 'maxFreq' | 'spread' | 'presence' | null;
type SortDir = 'asc' | 'desc';

function ComparativePanel({
  samples, mutations, selected, setSelected, onJumpToSelection, loading, forceMetric,
}: {
  samples: MutationSample[]; mutations: MutationRow[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  onJumpToSelection: () => void; loading: boolean;
  forceMetric?: { metric: 'copy_number'; nonce: number } | null;
}) {
  const [mutFilter, setMutFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState<'all' | 'frequency' | 'copy_number'>('all');
  // Default to the high-signal classes so first-paint isn't a wall of synonymous/intergenic noise.
  const [snpTypes, setSnpTypes] = useState<Set<string>>(new Set(DEFAULT_SNP_TYPES));
  const [minFreq, setMinFreq] = useState(0);
  const [minPresence, setMinPresence] = useState(0);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hideEmptySamples, setHideEmptySamples] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('maxFreq');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [groupOrder, setGroupOrder] = useState<GroupLevelKey[]>(DEFAULT_GROUP_ORDER);
  // User-curated subset of mutation rows (by MutationRow.id) plus a toggle that
  // filters the rendered rows down to that subset. The selection persists when
  // the toggle is off, so users can build a set then flip the view on and off.
  const [selectedMutations, setSelectedMutations] = useState<Set<string>>(new Set());
  const [compareMutationsOnly, setCompareMutationsOnly] = useState(false);
  // Compact headers collapse the per-sample metadata rows (condition + growth
  // sparkline) so the heatmap gets more vertical room. The grouping bands stay
  // (they carry experiment/condition/strain context) but condition/OD rows hide.
  const [compactHeaders, setCompactHeaders] = useState(false);
  // The mutation whose name was clicked; drives the rich detail modal.
  const [detailMutation, setDetailMutation] = useState<MutationRow | null>(null);
  // The sample whose growth-curve sparkline was clicked; drives the growth modal.
  const [growthCurveSample, setGrowthCurveSample] = useState<MutationSample | null>(null);
  // The sample whose column-header name was clicked; drives the sample-detail modal.
  const [detailSample, setDetailSample] = useState<MutationSample | null>(null);
  const [detailGroup, setDetailGroup] = useState<{ levelKey: GroupLevelKey; levelLabel: string; label: string; rows: MutationSample[] } | null>(null);
  const heatmapFigureRef = useRef<HTMLDivElement | null>(null);
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  // Distinct mutation-call count per sample (>0 value), matching the count the
  // sample-detail modal shows. Single pass over the mutation rows.
  const mutationCountBySample = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of mutations) {
      for (const [sid, v] of Object.entries(row.values)) {
        if (typeof v === 'number' && v > 0) m.set(sid, (m.get(sid) ?? 0) + 1);
      }
    }
    return m;
  }, [mutations]);

  // Rehydrate filters from localStorage on first mount. Once the user has
  // touched the filters their persisted state takes precedence over defaults.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPARE_FILTERS_KEY);
      if (raw) {
        const f = JSON.parse(raw) as Partial<CompareFilters>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser-local comparison filters.
        if (typeof f.mutFilter === 'string') setMutFilter(f.mutFilter);
        if (f.metricFilter === 'all' || f.metricFilter === 'frequency' || f.metricFilter === 'copy_number') setMetricFilter(f.metricFilter);
        if (Array.isArray(f.snpTypes)) setSnpTypes(new Set(f.snpTypes));
        if (typeof f.minFreq === 'number') setMinFreq(f.minFreq);
        if (typeof f.minPresence === 'number') setMinPresence(f.minPresence);
        if (typeof f.hideEmpty === 'boolean') setHideEmpty(f.hideEmpty);
        if (typeof f.hideEmptySamples === 'boolean') setHideEmptySamples(f.hideEmptySamples);
        if (f.sortKey === null || ['gene','variant','type','position','maxFreq','spread','presence'].includes(f.sortKey as string)) setSortKey(f.sortKey as SortKey);
        if (f.sortDir === 'asc' || f.sortDir === 'desc') setSortDir(f.sortDir);
        if (Array.isArray(f.groupOrder)) {
          // Keep only known keys, de-duplicate, preserve the user's order.
          const seen = new Set<string>();
          const cleaned = f.groupOrder.filter((k): k is GroupLevelKey =>
            GROUP_LEVEL_KEYS.includes(k as GroupLevelKey) && !seen.has(k) && (seen.add(k), true)
          );
          if (cleaned.length > 0) setGroupOrder(cleaned);
        }
        if (Array.isArray(f.selectedMutations)) setSelectedMutations(new Set(f.selectedMutations.filter((x): x is string => typeof x === 'string')));
        if (typeof f.compareMutationsOnly === 'boolean') setCompareMutationsOnly(f.compareMutationsOnly);
      }
    } catch {}
    setFiltersHydrated(true);
  }, []);

  // Persist filters back to localStorage on every change (after hydration).
  useEffect(() => {
    if (!filtersHydrated) return;
    try {
      const payload: CompareFilters = {
        mutFilter, metricFilter, snpTypes: [...snpTypes], minFreq, minPresence, hideEmpty, hideEmptySamples, sortKey, sortDir, groupOrder,
        selectedMutations: [...selectedMutations], compareMutationsOnly,
      };
      localStorage.setItem(COMPARE_FILTERS_KEY, JSON.stringify(payload));
    } catch {}
  }, [filtersHydrated, mutFilter, metricFilter, snpTypes, minFreq, minPresence, hideEmpty, hideEmptySamples, sortKey, sortDir, groupOrder, selectedMutations, compareMutationsOnly]);

  const toggleSnpType = (t: string) => {
    const next = new Set(snpTypes);
    if (next.has(t)) next.delete(t); else next.add(t);
    setSnpTypes(next);
  };

  // External request (from the Copy Number tab "compare these" action) to force
  // the metric filter to copy_number. Keyed on nonce so repeated clicks re-apply
  // even after the user manually changes the filter in between.
  const lastForceNonce = React.useRef<number | null>(null);
  useEffect(() => {
    if (forceMetric && forceMetric.nonce !== lastForceNonce.current) {
      lastForceNonce.current = forceMetric.nonce;
      setMetricFilter(forceMetric.metric);
    }
  }, [forceMetric]);

  // Distinct mutation classes present in this dataset (in research-priority order).
  // We filter on the rendered `m.type` (which is snp_type || mutation_category || base_type),
  // so indels labeled 'small_indel' / 'large_deletion' surface alongside SNP classes.
  const availableSnpTypes = useMemo(() => {
    const present = new Set<string>();
    for (const m of mutations) if (m.type) present.add(m.type);
    const ordered = SNP_TYPE_OPTIONS.filter(t => present.has(t));
    const extras = [...present].filter(t => !SNP_TYPE_OPTIONS.includes(t as typeof SNP_TYPE_OPTIONS[number])).sort();
    return [...ordered, ...extras];
  }, [mutations]);

  // Column order for the Comparative View is driven by the user's chosen
  // grouping levels (groupOrder), NOT the global sortSamples used elsewhere.
  const selectedSamples = useMemo(() => {
    const map = new Map(samples.map(s => [s.id, s]));
    const picked = [...selected].map(id => map.get(id)).filter(Boolean) as MutationSample[];
    return [...picked].sort(makeGroupComparator(groupOrder));
  }, [samples, selected, groupOrder]);

  // shared y-max and x-extent so growth curves are visually comparable across columns.
  // Uses visibleSamples (declared below); JS hoisting handles the cycle since
  // both are useMemo values referenced at render time. We re-derive when either changes.
  const curveScale = useMemo(() => {
    let yMax = 0;
    let xMin = Infinity, xMax = -Infinity;
    for (const s of selectedSamples) {
      if (!s.growth_curve) continue;
      for (const p of s.growth_curve) {
        if (p.od > yMax) yMax = p.od;
        if (p.t < xMin) xMin = p.t;
        if (p.t > xMax) xMax = p.t;
      }
    }
    if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; }
    return { yMax: Math.max(0.05, yMax), xMin, xMax };
  }, [selectedSamples]);

  const filteredMutations = useMemo(() => {
    const q = mutFilter.trim().toLowerCase();
    return mutations
      .filter(m => metricFilter === 'all' || m.metric === metricFilter)
      .filter(m => snpTypes.size === 0 || snpTypes.has(m.type))
      .filter(m => {
        if (!q) return true;
        return `${m.gene} ${m.variant} ${m.type} ${m.id} ${m.gene_product ?? ''}`.toLowerCase().includes(q);
      })
      .filter(m => {
        if (selectedSamples.length === 0) return true;
        if (hideEmpty) {
          const anyVal = selectedSamples.some(s => typeof m.values[s.id] === 'number');
          if (!anyVal) return false;
        }
        if (minFreq > 0) {
          const maxInSel = selectedSamples.reduce((acc, s) => {
            const v = m.values[s.id];
            return typeof v === 'number' && v > acc ? v : acc;
          }, 0);
          if (maxInSel < minFreq) return false;
        }
        const present = selectedSamples.reduce((acc, s) => acc + (typeof m.values[s.id] === 'number' && m.values[s.id] > 0 ? 1 : 0), 0);
        return present >= minPresence;
      });
  }, [mutations, mutFilter, metricFilter, snpTypes, minFreq, minPresence, hideEmpty, selectedSamples]);

  const sortedMutations = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const base = !sortKey ? [...filteredMutations] : [...filteredMutations].sort((a, b) => {
      if (sortKey === 'gene') return dir * (a.gene.localeCompare(b.gene) || a.variant.localeCompare(b.variant));
      if (sortKey === 'variant') return dir * a.variant.localeCompare(b.variant);
      if (sortKey === 'type') return dir * a.type.localeCompare(b.type);
      if (sortKey === 'position') {
        // Genome position is a numeric coordinate; missing positions sort to the end regardless of direction.
        const ap = typeof a.position === 'number' ? a.position : (dir === 1 ? Infinity : -Infinity);
        const bp = typeof b.position === 'number' ? b.position : (dir === 1 ? Infinity : -Infinity);
        if (ap !== bp) return dir * (ap - bp);
        return a.gene.localeCompare(b.gene) || a.variant.localeCompare(b.variant);
      }
      const aVals = selectedSamples.map(s => a.values[s.id]).filter(v => typeof v === 'number') as number[];
      const bVals = selectedSamples.map(s => b.values[s.id]).filter(v => typeof v === 'number') as number[];
      if (sortKey === 'maxFreq') {
        const am = aVals.length ? Math.max(...aVals) : -Infinity;
        const bm = bVals.length ? Math.max(...bVals) : -Infinity;
        return dir * (am - bm);
      }
      if (sortKey === 'spread') {
        const am = aVals.length ? Math.max(...aVals) - Math.min(...aVals) : -Infinity;
        const bm = bVals.length ? Math.max(...bVals) - Math.min(...bVals) : -Infinity;
        return dir * (am - bm);
      }
      if (sortKey === 'presence') {
        const ap = selectedSamples.reduce((acc, s) => acc + (typeof a.values[s.id] === 'number' && a.values[s.id] > 0 ? 1 : 0), 0);
        const bp = selectedSamples.reduce((acc, s) => acc + (typeof b.values[s.id] === 'number' && b.values[s.id] > 0 ? 1 : 0), 0);
        return dir * (ap - bp);
      }
      return 0;
    });
    // Copy-number rows always pin to the TOP (a researcher reads amplification
    // first), keeping their own relative order; everything else follows in the
    // chosen sort. Stable partition preserves order within each group.
    const cn: MutationRow[] = [];
    const rest: MutationRow[] = [];
    for (const m of base) (m.metric === 'copy_number' ? cn : rest).push(m);
    return cn.length ? [...cn, ...rest] : base;
  }, [filteredMutations, sortKey, sortDir, selectedSamples]);

  // Compose the curated-subset filter on TOP of the sorted/filtered list. When
  // compareMutationsOnly is on we render only the rows the user checked (that
  // still survive the active filters); otherwise we render all sorted rows.
  const renderedMutations = useMemo(() => {
    if (!compareMutationsOnly) return sortedMutations;
    return sortedMutations.filter(m => selectedMutations.has(m.id));
  }, [sortedMutations, compareMutationsOnly, selectedMutations]);

  // How many of the currently-visible (filtered+sorted) rows are checked, plus
  // an all/none helper for the header select-all affordance.
  const checkedVisibleCount = useMemo(
    () => sortedMutations.reduce((acc, m) => acc + (selectedMutations.has(m.id) ? 1 : 0), 0),
    [sortedMutations, selectedMutations]
  );
  const allVisibleChecked = sortedMutations.length > 0 && checkedVisibleCount === sortedMutations.length;

  const toggleMutation = (id: string) => {
    setSelectedMutations(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Select-all / clear over the currently filtered (sortedMutations) set.
  const toggleAllMutations = () => {
    setSelectedMutations(prev => {
      if (sortedMutations.length > 0 && sortedMutations.every(m => prev.has(m.id))) {
        // All filtered rows already checked -> clear only those.
        const next = new Set(prev);
        for (const m of sortedMutations) next.delete(m.id);
        return next;
      }
      const next = new Set(prev);
      for (const m of sortedMutations) next.add(m.id);
      return next;
    });
  };

  // Esc closes the detail modal (handled at panel level so it works regardless of focus).
  useEffect(() => {
    if (!detailMutation) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailMutation(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailMutation]);

  // Hide empty columns: samples whose every visible mutation cell has no value.
  // The "visible" set of mutations is renderedMutations (post-filter, post-sort,
  // post curated-subset). We only consult m.values, not styling.
  const visibleSamples = useMemo(() => {
    if (!hideEmptySamples) return selectedSamples;
    if (renderedMutations.length === 0) return selectedSamples;
    return selectedSamples.filter(s =>
      renderedMutations.some(m => typeof m.values[s.id] === 'number')
    );
  }, [selectedSamples, renderedMutations, hideEmptySamples]);

  const hiddenSampleCount = selectedSamples.length - visibleSamples.length;

  // Peers for the growth-curve modal: visible samples sharing the focused
  // sample's experiment + replicate + donor_dna (same-group replicates/timepoints).
  const growthPeers = useMemo(() => {
    if (!growthCurveSample) return [];
    const key = (s: MutationSample) => `${s.experiment}|${s.replicate ?? ''}|${s.donor_dna ?? ''}`;
    const k = key(growthCurveSample);
    return visibleSamples.filter(s => key(s) === k);
  }, [growthCurveSample, visibleSamples]);

  // Frequency cells always use the scientific absolute domain: 0% to 100%.
  // Only copy-number rows use data-dependent ranges below.
  const frequencyRange = { min: 0, max: 1 };

  // Per-ROW min/max (copy_number rows) across the visible samples.
  const rowRange = (m: MutationRow): { min: number; max: number } => {
    let min = Infinity, max = -Infinity;
    for (const s of visibleSamples) {
      const v = m.values[s.id];
      if (typeof v === 'number' && !Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    return Number.isFinite(min) ? { min, max } : { min: 0, max: 1 };
  };

  // Column grouping for the sticky header: one band PER enabled level in
  // groupOrder (outermost first). Adjacent columns that share the same value for
  // ALL levels up to and including that band merge into one band cell (colSpan).
  // Built from visibleSamples so hidden columns drop out and parent bands
  // collapse when every member is hidden.
  const columnBands = useMemo(() => {
    interface BandCell { key: string; label: string; colCount: number; rows: MutationSample[]; fullRows: MutationSample[] }
    // For each band level, walk visibleSamples and start a new cell whenever the
    // composite key (this level + all outer levels) changes, so nesting is honored.
    return groupOrder.map((levelKey, levelIdx) => {
      const cells: BandCell[] = [];
      let prevComposite: string | null = null;
      visibleSamples.forEach((s) => {
        const composite = groupOrder
          .slice(0, levelIdx + 1)
          .map(k => groupValue(s, k))
          .join('||');
        const last = cells[cells.length - 1];
        if (last && composite === prevComposite) {
          last.colCount++;
          last.rows.push(s);
        } else {
          const raw = groupValue(s, levelKey);
          const fullRows = selectedSamples.filter(full => groupOrder.slice(0, levelIdx + 1).map(k => groupValue(full, k)).join('||') === composite);
          cells.push({ key: `${levelKey}:${composite}`, label: raw, colCount: 1, rows: [s], fullRows });
        }
        prevComposite = composite;
      });
      const level = GROUP_LEVEL_BY_KEY.get(levelKey);
      return { levelKey, levelLabel: level ? level.label : levelKey, cells };
    });
  }, [visibleSamples, selectedSamples, groupOrder]);

  // Grouping-level controls: move a level up/down within the active order,
  // disable it (remove from order), or enable it (append to the order).
  const moveGroupLevel = (key: GroupLevelKey, dir: -1 | 1) => {
    setGroupOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };
  const disableGroupLevel = (key: GroupLevelKey) => {
    setGroupOrder(prev => (prev.length <= 1 ? prev : prev.filter(k => k !== key)));
  };
  const enableGroupLevel = (key: GroupLevelKey) => {
    setGroupOrder(prev => (prev.includes(key) ? prev : [...prev, key]));
  };
  const disabledGroupLevels = GROUP_LEVEL_KEYS.filter(k => !groupOrder.includes(k));

  const toggleSort = (key: NonNullable<SortKey>) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      // Ascending feels natural for labels / coordinates; descending for value-based keys.
      const asc = key === 'gene' || key === 'variant' || key === 'type' || key === 'position';
      setSortDir(asc ? 'asc' : 'desc');
    }
  };

  const buildHeatmapFigureSpec = (): FigureSpec => {
    const rowRanges = new Map(renderedMutations.map(m => [m.id, m.metric === 'copy_number' ? rowRange(m) : frequencyRange]));
    return {
      kind: 'mutationHeatmap',
      title: `AI-ALE comparative heatmap (${visibleSamples.length} samples)`,
      subtitle: `${renderedMutations.length} rows after filters. Frequency rows use a fixed 0% to 100% scale; copy-number rows use per-row ranges.`,
      xTitle: 'Selected samples',
      yTitle: 'Mutation or copy-number region',
      legendTitle: 'Cell value',
      caption: 'AI-ALE LIMS viewer comparative export from the current filtered selection. Amber outlines mark mutations provided in donor DNA.',
      samples: visibleSamples.map(s => ({
        id: s.id,
        label: s.name,
        group: groupOrder.map(k => groupValue(s, k)).filter(Boolean).join(' / '),
        transfer: typeof s.transfer === 'number' ? s.transfer : null,
      })),
      mutations: renderedMutations.map(m => {
        const range = rowRanges.get(m.id) ?? frequencyRange;
        return {
          id: m.id,
          label: `${m.gene} / ${m.variant}`,
          subtitle: `${m.type} / ${m.metric}`,
          metric: m.metric,
          min: range.min,
          max: range.max,
          checked: selectedMutations.has(m.id),
        };
      }),
      values: renderedMutations.flatMap(m => visibleSamples.map(s => {
        const v = m.values[s.id];
        const provided = !!m.providedIn && m.providedIn.includes(s.id);
        return {
          mutationId: m.id,
          sampleId: s.id,
          value: typeof v === 'number' && !Number.isNaN(v) ? v : undefined,
          valueLabel: typeof v === 'number' && !Number.isNaN(v) ? formatMetric(v, m.metric) : undefined,
          provided,
        };
      })),
    };
  };

  const exportCsv = () => {
    // Export the columns the user is actually looking at - if they hid empties,
    // those samples aren't in the CSV either.
    const cols = visibleSamples;
    const rows: string[][] = [];
    // metadata rows
    rows.push(['', '', '', '', 'experiment', ...cols.map(s => s.experiment)]);
    rows.push(['', '', '', '', 'replicate', ...cols.map(s => s.replicate ?? '')]);
    rows.push(['', '', '', '', 'donor_dna', ...cols.map(s => s.donor_dna ?? '')]);
    rows.push(['', '', '', '', 'condition', ...cols.map(s => s.condition ?? '')]);
    rows.push(['', '', '', '', 'transfer', ...cols.map(s => (typeof s.transfer === 'number' ? String(s.transfer) : ''))]);
    rows.push(['gene', 'variant', 'type', 'metric', 'sample →', ...cols.map(s => s.name)]);
    for (const m of renderedMutations) {
      rows.push([
        m.gene, m.variant, m.type, m.metric, '',
        ...cols.map(s => {
          const v = m.values[s.id];
          if (typeof v !== 'number') return '';
          return m.metric === 'frequency' ? v.toFixed(4) : v.toFixed(2);
        }),
      ]);
    }
    const csv = rows.map(r => r.map(c => {
      const needsQuote = /[",\n]/.test(c);
      const safe = c.replace(/"/g, '""');
      return needsQuote ? `"${safe}"` : safe;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mutation-comparison-${cols.length}samples.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading && selectedSamples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-gray-500 text-sm">
        Loading mutation dataset…
      </div>
    );
  }

  if (selectedSamples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-gray-400 text-sm flex-col gap-3 p-6">
        <GitCompare className="w-10 h-10 text-slate-300 dark:text-gray-600" />
        <p className="font-medium text-slate-600 dark:text-gray-300">Nothing to compare yet</p>
        <p className="text-[12px] text-center max-w-sm text-slate-500 dark:text-gray-400">
          Choose two or more samples and their mutations line up side by side here, one column per sample, so you can spot which calls appear, disappear, or shift in frequency across the time course.
        </p>
        <button onClick={onJumpToSelection} className="px-3 py-1.5 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">
          Pick samples →
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2"><ViewInfo title="Compare Mutations" description="Compare mutation frequencies and copy-number measurements across selected samples in one matrix." detail="Frequencies use fixed 0-100%; copy-number rows use their displayed numeric scale." /></div>
      {/* Controls */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center gap-2 flex-wrap" data-tour="compare-controls">
        <div className="relative">
          <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
          <input
            value={mutFilter}
            onChange={e => setMutFilter(e.target.value)}
            placeholder="Filter mutations (gene, variant, type…)"
            className="pl-8 pr-2 py-1 text-[12px] border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none w-60"
          />
        </div>
        <select
          value={metricFilter}
          onChange={e => setMetricFilter(e.target.value as 'all' | 'frequency' | 'copy_number')}
          className="text-[12px] border border-slate-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none"
        >
          <option value="all">All metrics</option>
          <option value="frequency">Frequency only</option>
          <option value="copy_number">Copy number only</option>
        </select>
        <label className="text-[11px] text-slate-600 dark:text-gray-300 flex items-center gap-1.5">
          min. samples present
          <input
            type="number" min={0} max={selectedSamples.length}
            value={minPresence}
            onChange={e => setMinPresence(Math.max(0, Math.min(selectedSamples.length, parseInt(e.target.value || '0', 10))))}
            className="w-14 text-[12px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums"
          />
        </label>
        <label className="text-[11px] text-slate-600 dark:text-gray-300 flex items-center gap-1.5" title="Hide rows whose maximum frequency across selected samples is below this threshold">
          min. frequency
          <input
            type="number" min={0} max={1} step={0.05}
            value={minFreq}
            onChange={e => setMinFreq(Math.max(0, Math.min(1, parseFloat(e.target.value || '0'))))}
            className="w-16 text-[12px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums"
          />
        </label>
        <label className="text-[11px] text-slate-600 dark:text-gray-300 flex items-center gap-1" title="Drop mutation rows whose visible cells are all empty">
          <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} className="accent-blue-600" />
          hide empty rows
        </label>
        <label className="text-[11px] text-slate-600 dark:text-gray-300 flex items-center gap-1" title="Drop sample columns whose every visible mutation cell has no value (useful for screening for a mutation across the full DB)">
          <input type="checkbox" checked={hideEmptySamples} onChange={e => setHideEmptySamples(e.target.checked)} className="accent-blue-600" />
          hide empty columns
        </label>

        <div className="text-[11px] text-slate-500 dark:text-gray-400 ml-auto tabular-nums">
          {hiddenSampleCount > 0
            ? <>{visibleSamples.length}/{selectedSamples.length} samples · {renderedMutations.length}/{mutations.length} mutations</>
            : <>{selectedSamples.length} samples · {renderedMutations.length}/{mutations.length} mutations</>
          }
        </div>
        <button
          onClick={() => setCompareMutationsOnly(v => !v)}
          disabled={selectedMutations.size === 0 && !compareMutationsOnly}
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors',
            compareMutationsOnly
              ? 'border-blue-400 dark:border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
              : 'border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed'
          )}
          title={compareMutationsOnly
            ? 'Showing only the checked mutation subset. Click to show all (selection kept).'
            : 'Show only the mutations you checked. Selection is kept when toggled off.'}
        >
          <GitCompare className="w-3 h-3" />
          {compareMutationsOnly
            ? <>Showing {renderedMutations.length} selected · show all</>
            : <>Compare {selectedMutations.size} mutation{selectedMutations.size === 1 ? '' : 's'}</>}
        </button>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 dark:text-gray-300 border border-slate-300 dark:border-gray-600 rounded hover:bg-slate-50 dark:hover:bg-gray-700"
          title="Export the current comparison as CSV"
          disabled={renderedMutations.length === 0}
        >
          <Download className="w-3 h-3" />
          CSV
        </button>
        <ExportFigureMenu
          getTarget={() => heatmapFigureRef.current}
          title={`AI-ALE comparative heatmap (${visibleSamples.length} samples)`}
          filenameBase={`comparative-heatmap-${visibleSamples.length}samples`}
          disabled={renderedMutations.length === 0}
          buildSpec={buildHeatmapFigureSpec}
        />
      </div>

      {/* SNP type filter pills */}
      {availableSnpTypes.length > 0 && (
        <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 flex-wrap">
          <span className="mr-1">Mutation class:</span>
          {availableSnpTypes.map(t => {
            const active = snpTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleSnpType(t)}
                className={cn(
                  'px-1.5 py-0.5 rounded border text-[11px] transition-colors',
                  active
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300'
                )}
                title={`Filter to ${t} mutations`}
              >
                {t}
              </button>
            );
          })}
          {snpTypes.size > 0 && (
            <button onClick={() => setSnpTypes(new Set())} className="ml-1 text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200">clear</button>
          )}
          <span className="ml-auto text-slate-400 dark:text-gray-500">
            {snpTypes.size === 0 ? 'showing all classes' : `${snpTypes.size} class(es) selected`}
          </span>
        </div>
      )}

      {/* Group by: ordered column-grouping levels with reorder + enable/disable */}
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 flex-wrap">
        <span className="mr-1" title="Choose how sample columns are grouped and ordered (outermost level first).">Group columns by:</span>
        {groupOrder.map((key, idx) => {
          const level = GROUP_LEVEL_BY_KEY.get(key);
          return (
            <span
              key={key}
              className="inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5 rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            >
              <span className="text-[10px] tabular-nums opacity-60">{idx + 1}.</span>
              <span className="text-[11px]">{level ? level.label : key}</span>
              <button
                onClick={() => moveGroupLevel(key, -1)}
                disabled={idx === 0}
                className="text-blue-500 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 disabled:opacity-30 disabled:cursor-default"
                title="Move outward (higher priority)"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => moveGroupLevel(key, 1)}
                disabled={idx === groupOrder.length - 1}
                className="text-blue-500 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 disabled:opacity-30 disabled:cursor-default"
                title="Move inward (lower priority)"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              <button
                onClick={() => disableGroupLevel(key)}
                disabled={groupOrder.length <= 1}
                className="text-blue-400 dark:text-blue-500 hover:text-red-500 disabled:opacity-30 disabled:cursor-default"
                title="Remove this grouping level"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        {disabledGroupLevels.length > 0 && (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="ml-1 text-slate-400 dark:text-gray-500">add:</span>
            {disabledGroupLevels.map(key => {
              const level = GROUP_LEVEL_BY_KEY.get(key);
              return (
                <button
                  key={key}
                  onClick={() => enableGroupLevel(key)}
                  className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300 text-[11px]"
                  title={`Group columns by ${level ? level.label : key}`}
                >
                  + {level ? level.label : key}
                </button>
              );
            })}
          </span>
        )}
        <button
          onClick={() => setGroupOrder(DEFAULT_GROUP_ORDER)}
          className="ml-1 text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200"
          title="Reset grouping to the default order"
        >
          reset
        </button>
      </div>

      {/* Sort chips */}
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 flex-wrap">
        <span className="mr-1">Sort mutations by:</span>
        <SortChip label="gene" active={sortKey === 'gene'} dir={sortDir} onClick={() => toggleSort('gene')} />
        <SortChip label="variant" active={sortKey === 'variant'} dir={sortDir} onClick={() => toggleSort('variant')} />
        <SortChip label="type" active={sortKey === 'type'} dir={sortDir} onClick={() => toggleSort('type')} />
        <SortChip label="position" active={sortKey === 'position'} dir={sortDir} onClick={() => toggleSort('position')} />
        <SortChip label="max value" active={sortKey === 'maxFreq'} dir={sortDir} onClick={() => toggleSort('maxFreq')} />
        <SortChip label="spread" active={sortKey === 'spread'} dir={sortDir} onClick={() => toggleSort('spread')} />
        <SortChip label="# samples present" active={sortKey === 'presence'} dir={sortDir} onClick={() => toggleSort('presence')} />
        {sortKey && (
          <button onClick={() => setSortKey(null)} className="ml-1 text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200">unsort</button>
        )}
        <button
          onClick={() => setCompactHeaders(c => !c)}
          className={cn('ml-auto flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium',
            compactHeaders
              ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-600')}
          title="Compact headers: hide the per-sample condition and growth-curve rows to give the heatmap more vertical room. Copy number rows stay pinned at the top."
        >
          {compactHeaders ? 'Compact headers: on' : 'Compact headers: off'}
        </button>
      </div>

      {/* Comparison table.
          border-separate (not border-collapse) is REQUIRED for sticky headers:
          with border-collapse, browsers paint collapsed borders in a layer that
          lets scrolling cell colors bleed through the 1px seams behind sticky
          cells regardless of z-index. border-separate + spacing 0 makes every
          sticky cell paint its own full opaque background with no seams. */}
      <div ref={heatmapFigureRef} className="flex-1 min-h-0 overflow-auto relative">
        <table className="text-[12px] border-separate" style={{ borderSpacing: 0 }}>
          {/* Sticky top: column groups + sample info rows + growth curves */}
          <thead className="sticky top-0 z-30 bg-white dark:bg-gray-800">
            {/* Grouping bands: one row per enabled grouping level (outermost first).
                Compact mode shows ONLY the outermost band to reclaim vertical space. */}
            {(compactHeaders ? columnBands.slice(0, 1) : columnBands).map((band, bandIdx) => (
              <tr key={band.levelKey}>
                <th className={cn(
                  'sticky left-0 z-40 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400',
                  bandIdx === 0
                    ? 'bg-slate-100 dark:bg-gray-800 min-w-[200px]'
                    : 'bg-slate-50 dark:bg-gray-900'
                )}>
                  {band.levelLabel}
                </th>
                {band.cells.map(cell => (
                  <th
                    key={cell.key}
                    colSpan={cell.colCount}
                    onClick={() => setDetailGroup({ levelKey: band.levelKey, levelLabel: band.levelLabel, label: cell.label || '-', rows: cell.fullRows })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailGroup({ levelKey: band.levelKey, levelLabel: band.levelLabel, label: cell.label || '-', rows: cell.fullRows });
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    className={cn(
                      'border-b border-l border-slate-200 dark:border-gray-700 px-2 py-1 text-[11px] whitespace-nowrap text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20',
                      bandIdx === 0
                        ? 'bg-slate-100 dark:bg-gray-800 font-semibold text-slate-700 dark:text-gray-200'
                        : 'bg-slate-50 dark:bg-gray-900 font-medium text-slate-600 dark:text-gray-300'
                    )}
                    title={`Open ${band.levelLabel} group details (${cell.rows.length} visible of ${cell.fullRows.length} selected sample${cell.fullRows.length === 1 ? '' : 's'})`}
                    >
                      {cell.label || '-'}

                  </th>
                ))}
              </tr>
            ))}
            {/* Sample name + transfer */}
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                Sample
              </th>
              {visibleSamples.map(s => (
                <th key={s.id} className="border-b border-l border-slate-200 dark:border-gray-700 px-1.5 py-1 whitespace-nowrap min-w-[88px] max-w-[160px] overflow-hidden bg-white dark:bg-gray-800">
                  <div className="flex items-start justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => setDetailSample(s)}
                      className="text-[11px] font-mono text-slate-800 dark:text-gray-100 leading-tight truncate text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline decoration-dotted underline-offset-2 cursor-pointer"
                      title={`${s.name}\nOpen sample detail`}
                    >{s.name}</button>
                    <button
                      type="button"
                      onClick={() => { const next = new Set(selected); next.delete(s.id); setSelected(next); }}
                      className="text-slate-300 dark:text-gray-600 hover:text-red-500"
                      title="Remove from comparison"
                      aria-label={`Remove ${s.name} from comparison`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-1">
                    {s.strain && <span>{s.strain}</span>}
                    {typeof s.transfer === 'number' && <span className="px-1 rounded bg-slate-100 dark:bg-gray-700">t={s.transfer}</span>}
                  </div>
                </th>
              ))}
            </tr>
            {/* Condition (hidden in compact mode) */}
            {!compactHeaders && (
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                Condition
              </th>
              {visibleSamples.map(s => (
                <th key={s.id} className="border-b border-l border-slate-200 dark:border-gray-700 px-1.5 py-1 text-[10.5px] font-normal text-slate-500 dark:text-gray-400 text-center bg-white dark:bg-gray-800 whitespace-nowrap">
                  {s.condition ?? ''}
                </th>
              ))}
            </tr>
            )}
            {/* Growth curve sparklines */}
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b-2 border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400"
                  title="OD growth curves are scaled to a shared y-axis so they're directly comparable across columns.">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    OD growth
                    <span className="ml-1 text-slate-300 dark:text-gray-600 font-normal normal-case">(max {curveScale.yMax.toFixed(2)})</span>
                  </span>
                  <span className="flex items-center gap-1 normal-case">
                    <button
                      onClick={toggleAllMutations}
                      disabled={sortedMutations.length === 0}
                      className="flex items-center justify-center w-5 h-5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-30"
                      title={allVisibleChecked ? 'Clear all checked (filtered)' : 'Check all (filtered)'}
                    >
                      {allVisibleChecked
                        ? <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        : checkedVisibleCount > 0
                          ? <CheckSquare className="w-3.5 h-3.5 text-blue-500/60 dark:text-blue-400/60" />
                          : <Square className="w-3.5 h-3.5 text-slate-300 dark:text-gray-600" />}
                    </button>
                    {checkedVisibleCount > 0 && (
                      <span className="text-[9px] tabular-nums font-normal text-slate-400 dark:text-gray-500">{checkedVisibleCount}</span>
                    )}
                  </span>
                </div>
              </th>
              {visibleSamples.map(s => (
                <th key={s.id} className="border-b-2 border-l border-slate-200 dark:border-gray-700 px-1 py-1 bg-white dark:bg-gray-800">
                  {/* Growth curves stay visible in compact mode; only the text
                      metadata rows (experiment/condition/strain/DNA/replicate) are
                      collapsed to reclaim vertical space. */}
                  <div className="flex justify-center">
                    <GrowthCurveSparkline
                      data={s.growth_curve}
                      odSources={s.od_sources}
                      width={84}
                      height={36}
                      yMaxOverride={curveScale.yMax}
                      xMinOverride={curveScale.xMin}
                      xMaxOverride={curveScale.xMax}
                      sample={s}
                      onExpand={setGrowthCurveSample}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Scrollable mutation rows */}
          <tbody>
            {renderedMutations.length === 0 && (
              <tr><td colSpan={visibleSamples.length + 1} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">
                {mutations.length === 0
                  ? 'No mutations in the dataset.'
                  : compareMutationsOnly
                    ? 'No checked mutations match the current filters. Check rows or toggle "show all".'
                    : 'No mutations match the current filters.'}
              </td></tr>
            )}
            {renderedMutations.map(m => {
              const isChecked = selectedMutations.has(m.id);
              // Copy-number rows scale their color by the ROW's own min/max across
              // samples; frequency cells use a fixed 0% to 100% domain.
              const cnRange = m.metric === 'copy_number' ? rowRange(m) : null;
              return (
              <tr
                key={m.id}
                className={cn(
                  'border-b border-slate-100 dark:border-gray-700/60',
                  isChecked ? 'bg-amber-50/80 dark:bg-amber-900/20' : 'hover:bg-slate-50/60 dark:hover:bg-gray-700/30'
                )}
              >
                <th
                  className={cn(
                    'sticky left-0 z-20 border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left whitespace-nowrap min-w-[200px] max-w-[280px]',
                    isChecked
                      ? 'bg-amber-50 dark:bg-amber-950 border-t-2 border-b-2 border-l-2 border-r-2 !border-t-amber-400 !border-b-amber-400 !border-l-amber-400 !border-r-amber-400 dark:!border-t-amber-500 dark:!border-b-amber-500 dark:!border-l-amber-500 dark:!border-r-amber-500'
                      : 'bg-white dark:bg-gray-800'
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMutation(m.id); }}
                      className="mt-0.5 flex items-center justify-center shrink-0"
                      title={isChecked ? 'Uncheck this mutation' : 'Check this mutation for comparison'}
                      aria-pressed={isChecked}
                    >
                      {isChecked
                        ? <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        : <Square className="w-4 h-4 text-slate-300 dark:text-gray-600 hover:text-slate-400 dark:hover:text-gray-500" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDetailMutation(m); }}
                      className="leading-tight text-left min-w-0 group cursor-pointer"
                      title="Click for details"
                    >
                      <div className="text-[12px] font-medium text-slate-800 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:underline decoration-dotted underline-offset-2">
                        {m.metric === 'copy_number' && <span className="mr-1 px-1 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[9px] font-semibold uppercase align-middle" title="Copy number region (pinned to top)">CN</span>}
                        {m.providedIn && m.providedIn.length > 0 && <span className="mr-1 px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-semibold uppercase align-middle ring-1 ring-amber-400/60" title={`Provided as donor DNA in ${m.providedIn.length} sample${m.providedIn.length === 1 ? '' : 's'} (supplied, not spontaneous)`}>provided</span>}
                        {m.gene} <span className="font-normal text-slate-500 dark:text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400">/ {m.variant}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate">
                        {m.type} · {m.metric}
                        {m.detail?.seq_id ? <span className="ml-1 font-mono text-slate-400 dark:text-gray-500">{m.detail.seq_id}</span> : null}
                        {m.gene_product ? <span className="ml-1 italic text-slate-500 dark:text-gray-400">· {m.gene_product}</span> : null}
                      </div>
                    </button>
                  </div>
                </th>
                {visibleSamples.map((s, sampleIdx) => {
                  const v = m.values[s.id];
                  const hasVal = typeof v === 'number' && !Number.isNaN(v);
                  // PROVIDED: this mutation was supplied as donor DNA in this sample's
                  // growth condition (Henry). Outline the cell. Provided but 0%/absent
                  // = outline with no fill (provided, not observed).
                  const provided = !!m.providedIn && m.providedIn.includes(s.id);
                  const providedUnobserved = provided && (!hasVal || v === 0);
                  // Scaled gradient: per-row range for CN, fixed 0..1 for frequency.
                  const range = cnRange ?? frequencyRange;
                  const style = hasVal ? rampStyle(v, range.min, range.max, m.metric) : undefined;
                  // Amber inset ring marks a provided cell without recoloring the fill.
                  const providedStyle = provided
                    ? { ...style, boxShadow: 'inset 0 0 0 2px #d97706, inset 0 0 0 3px rgba(255,255,255,0.55)' }
                    : style;
                  return (
                    <td
                      key={s.id}
                      style={providedStyle}
                      className={cn(
                        'border-l border-slate-100 dark:border-gray-700/60 px-1.5 py-1 text-center tabular-nums text-[11.5px] relative',
                        isChecked && 'border-t-2 border-b-2 border-l-2 !border-t-amber-400 !border-b-amber-400 !border-l-amber-400 dark:!border-t-amber-500 dark:!border-b-amber-500 dark:!border-l-amber-500',
                        isChecked && sampleIdx === visibleSamples.length - 1 && 'border-r-2 !border-r-amber-400 dark:!border-r-amber-500',
                        !hasVal && !provided && 'text-slate-300 dark:text-gray-600 bg-slate-50/50 dark:bg-gray-800/40'
                      )}
                      title={
                        (provided ? `PROVIDED in donor DNA (${s.donor_dna || 'donor'})${providedUnobserved ? ', not observed (0%)' : ''}. ` : '') +
                        (hasVal
                          ? `${m.gene} ${m.variant} in ${s.name}: ${formatMetric(v, m.metric)}${m.metric === 'frequency' ? ` (raw ${v.toFixed(3)})` : ''} · color scaled to ${m.metric === 'copy_number' ? `this copy-number row range ${range.min.toFixed(1)} to ${range.max.toFixed(1)}` : 'fixed frequency range 0% to 100%'}`
                          : `${m.gene} ${m.variant} in ${s.name}: no data`)
                      }
                    >
                      {hasVal ? formatMetric(v, m.metric) : (providedUnobserved ? <span className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold" title="provided in donor DNA, 0% abundance">0%</span> : '-')}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detailGroup && (
        <CompareGroupDetailModal
          group={detailGroup}
          mutations={mutations}
          selected={selected}
          onClose={() => setDetailGroup(null)}
          onSelectGroup={() => {
            const next = new Set(selected);
            for (const s of detailGroup.rows) next.add(s.id);
            setSelected(next);
            setDetailGroup(null);
          }}
          onRemoveGroup={() => {
            const next = new Set(selected);
            for (const s of detailGroup.rows) next.delete(s.id);
            setSelected(next);
            setDetailGroup(null);
          }}
          onOpenGrowth={(s) => { setDetailGroup(null); setGrowthCurveSample(s); }}
        />
      )}
      {detailMutation && (
        <MutationDetailModal
          mutation={detailMutation}
          samples={visibleSamples}
          groupOrder={groupOrder}
          onClose={() => setDetailMutation(null)}
        />
      )}
      {growthCurveSample && (
        <GrowthCurveModal
          sample={growthCurveSample}
          peers={growthPeers}
          onClose={() => setGrowthCurveSample(null)}
        />
      )}
      {detailSample && (
        <SampleDetailModal
          sample={detailSample}
          mutations={mutations}
          allMutationCount={mutationCountBySample.get(detailSample.id) ?? 0}
          onClose={() => setDetailSample(null)}
          onOpenGrowth={(s) => setGrowthCurveSample(s)}
        />
      )}
    </div>
  );
}

/* ---------------- Mutation detail modal ----------------
   Large, scrollable rich popup opened by clicking a mutation name in the
   Comparative View. Renders a genome-browser-style track plus richer biological
   diagrams (coordinate axis, directional gene track, variant lollipop/span,
   codon/amino-acid change, indel/repeat schematic, protein-position schematic,
   clean per-sample frequency) instead of a flat table. Every field is
   optional-guarded. Because different sample groups can be on different reference
   genomes, every coordinate is labeled with its seq_id (the reference contig the
   position sits on). All heavy SVG geometry is memoized so the modal opens
   instantly and stays responsive while scrolling. Self-contained SVG, no libs. */

// 1-letter -> 3-letter amino acid names (germline data uses single-letter codes;
// '*' is a stop codon). Used by the codon / AA change visual.
const AA_THREE: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', E: 'Glu', Q: 'Gln',
  G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe',
  P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Stop',
};
function aaThree(a?: string): string {
  if (!a) return '?';
  return AA_THREE[a.toUpperCase()] ?? a;
}

// Classify a coding SNP for codon visual coloring. Falls back to comparing the
// AA codes when snp_type is missing.
function aaEffect(aaRef?: string, aaNew?: string, snpType?: string): 'synonymous' | 'missense' | 'nonsense' | 'unknown' {
  const t = (snpType ?? '').toLowerCase();
  if (t === 'synonymous') return 'synonymous';
  if (t === 'nonsense') return 'nonsense';
  if (t === 'nonsynonymous') return aaNew === '*' ? 'nonsense' : 'missense';
  if (aaRef && aaNew) {
    if (aaNew === '*') return 'nonsense';
    return aaRef === aaNew ? 'synonymous' : 'missense';
  }
  return 'unknown';
}

// Parse the germline gene_position string into structured residue/nt context for
// the protein-position schematic. Handles the observed shapes:
//   "263"                          -> coding nt position, no length
//   "coding (354..355/963 nt)"     -> coding nt span + gene length
//   "coding (246-248/1890 nt)"     -> coding nt span + gene length
//   "pseudogene (610/891 nt)"      -> pseudogene nt + length
//   "intergenic (+6/-537)"         -> distances to flanking genes (no length)
type GenePosInfo = {
  kind: 'coding' | 'pseudogene' | 'intergenic' | 'plain' | 'unknown';
  ntStart?: number;     // 1-based nt position within the gene
  ntEnd?: number;
  ntLength?: number;    // total gene length in nt
  upstream?: number;    // intergenic distance to the left flanking gene
  downstream?: number;  // intergenic distance to the right flanking gene
  raw?: string;
};
function parseGenePosition(gp?: string): GenePosInfo {
  if (!gp) return { kind: 'unknown' };
  const raw = gp.trim();
  // intergenic (+6/-537)
  const ig = raw.match(/intergenic\s*\(([+-]?\d+)\s*\/\s*([+-]?\d+)\)/i);
  if (ig) {
    return { kind: 'intergenic', upstream: Number(ig[1]), downstream: Number(ig[2]), raw };
  }
  // coding / pseudogene (start[..|-]end / length nt)  or (pos / length nt)
  const cd = raw.match(/(coding|pseudogene)\s*\((\d+)(?:[.\-]+(\d+))?\s*\/\s*(\d+)\s*nt\)/i);
  if (cd) {
    const start = Number(cd[2]);
    const end = cd[3] ? Number(cd[3]) : start;
    return {
      kind: cd[1].toLowerCase() === 'pseudogene' ? 'pseudogene' : 'coding',
      ntStart: start, ntEnd: end, ntLength: Number(cd[4]), raw,
    };
  }
  // plain integer (coding nt position, no length)
  if (/^\d+$/.test(raw)) return { kind: 'plain', ntStart: Number(raw), ntEnd: Number(raw), raw };
  return { kind: 'unknown', raw };
}

// Small labeled "ref -> new" colored mono blocks used for sequence and codon change.
function ChangeBlocks({ from, to, fromLabel, toLabel }: { from?: string; to?: string; fromLabel?: string; toLabel?: string }) {
  const show = (from && from.length > 0) || (to && to.length > 0);
  if (!show) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-mono text-[15px] px-2 py-1 rounded bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800 break-all max-w-[260px]">
          {from && from.length > 0 ? from : '·'}
        </span>
        {fromLabel ? <span className="text-[10px] text-[var(--text-soft)]">{fromLabel}</span> : null}
      </div>
      <ArrowRight className="w-4 h-4 text-[var(--text-soft)] shrink-0" />
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-mono text-[15px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800 break-all max-w-[260px]">
          {to && to.length > 0 ? to : '·'}
        </span>
        {toLabel ? <span className="text-[10px] text-[var(--text-soft)]">{toLabel}</span> : null}
      </div>
    </div>
  );
}

function ModalSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-3">
      <div className="flex items-baseline gap-2 mb-2">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-soft)]">{title}</h4>
        {hint ? <span className="text-[10.5px] text-[var(--text-faint)]">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/* ---- Growth-curve modal ----------------------------------------------------
   Large, scrollable popup opened by clicking a growth-curve sparkline. Mirrors
   the MutationDetailModal pattern (fixed inset-0 backdrop, max-w-3xl card, close
   on backdrop / X / Esc). Renders a genome-browser-quality OD600-vs-time chart
   with labeled axes, gridlines, the exponential phase highlighted, a metrics
   panel, a linear-vs-log Y toggle (log is the microbiology-standard view where
   exponential growth is a straight line), and an overlay that compares same-group
   peer curves on one axis. Self-contained SVG, all geometry memoized. */

// Distinct hues for overlaid peer curves (the focused curve stays emerald).
const PEER_HUES = [
  '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d',
  '#dc2626', '#0d9488', '#9333ea', '#ca8a04', '#4f46e5', '#e11d48',
];

function GrowthCurveModal({
  sample, peers, onClose,
}: {
  sample: MutationSample;
  peers: MutationSample[];
  onClose: () => void;
}) {
  const [logScale, setLogScale] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  // Index of the focus-curve datum currently under the crosshair / hovered dot.
  // A single index keeps interactivity cheap (one state update per move).
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Peer the user is hovering in the legend or on the canvas: that curve is
  // raised to full opacity + thickened while the others dim.
  const [hoveredPeerId, setHoveredPeerId] = useState<string | null>(null);
  // Peer toggled (clicked) to stay emphasized even without an active hover.
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const growthSvgRef = useRef<SVGSVGElement | null>(null);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const data = sample.growth_curve;
  const hasCurve = !!(data && data.length >= 2);

  const metrics = useMemo(() => computeGrowthMetrics(data), [data]);

  // Peers that actually carry a numeric series, excluding the focused sample,
  // capped at 12 overlaid curves for legibility.
  const PEER_CAP = 12;
  const overlayPeers = useMemo(() => {
    return peers
      .filter(p => p.id !== sample.id && p.growth_curve && p.growth_curve.length >= 2);
  }, [peers, sample.id]);
  const shownPeers = overlayPeers.slice(0, PEER_CAP);
  const hiddenPeerCount = overlayPeers.length - shownPeers.length;

  // Chart geometry + scales, memoized. Y domain spans the focused curve AND any
  // overlaid peers so every curve fits on the shared axis.
  const chart = useMemo(() => {
    const W = 660, H = 300;
    const padL = 52, padR = 16, padT = 16, padB = 40;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    if (!hasCurve) return null;

    const seriesForDomain = [data!, ...(showOverlay ? shownPeers.map(p => p.growth_curve!) : [])];
    let xMin = Infinity, xMax = -Infinity, yMax = 0, yMinPos = Infinity;
    for (const s of seriesForDomain) {
      for (const p of s) {
        if (p.t < xMin) xMin = p.t;
        if (p.t > xMax) xMax = p.t;
        if (p.od > yMax) yMax = p.od;
        if (p.od > 0 && p.od < yMinPos) yMinPos = p.od;
      }
    }
    if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; }
    if (xMax <= xMin) xMax = xMin + 1;
    yMax = Math.max(yMax, 0.05);
    if (!Number.isFinite(yMinPos)) yMinPos = 0.01;
    // For log mode, floor at a sensible lower OD so the axis is readable.
    const logLo = Math.max(0.001, Math.min(yMinPos, yMax / 1000));
    const logHi = yMax;

    const sx = (t: number) => padL + ((t - xMin) / (xMax - xMin)) * innerW;
    const syLinear = (od: number) => padT + innerH - (od / yMax) * innerH;
    const syLog = (od: number) => {
      const v = Math.max(logLo, od);
      const f = (Math.log(v) - Math.log(logLo)) / (Math.log(logHi) - Math.log(logLo));
      return padT + innerH - f * innerH;
    };
    const sy = logScale ? syLog : syLinear;

    // X ticks: nice step aiming for ~6 ticks.
    const xRange = xMax - xMin;
    const xRaw = xRange / 6;
    const xMag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, xRaw))));
    const xNorm = xRaw / xMag;
    const xMul = xNorm <= 1 ? 1 : xNorm <= 2 ? 2 : xNorm <= 5 ? 5 : 10;
    const xStep = Math.max(1e-6, xMul * xMag);
    const xTicks: number[] = [];
    const xFirst = Math.ceil(xMin / xStep) * xStep;
    for (let t = xFirst; t <= xMax + 1e-9 && xTicks.length < 14; t += xStep) xTicks.push(t);

    // Y ticks differ by mode.
    let yTicks: number[];
    if (logScale) {
      // Decade ticks across the log domain.
      yTicks = [];
      const decLo = Math.floor(Math.log10(logLo));
      const decHi = Math.ceil(Math.log10(logHi));
      for (let d = decLo; d <= decHi; d++) {
        const base = Math.pow(10, d);
        if (base >= logLo * 0.999 && base <= logHi * 1.001) yTicks.push(base);
      }
      if (yTicks.length < 2) yTicks = [logLo, logHi];
    } else {
      const yRaw = yMax / 5;
      const yMag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, yRaw))));
      const yNorm = yRaw / yMag;
      const yMul = yNorm <= 1 ? 1 : yNorm <= 2 ? 2 : yNorm <= 5 ? 5 : 10;
      const yStep = Math.max(1e-6, yMul * yMag);
      yTicks = [];
      for (let v = 0; v <= yMax + 1e-9 && yTicks.length < 12; v += yStep) yTicks.push(v);
    }

    const linePath = (s: { t: number; od: number }[]) =>
      s.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.t).toFixed(1)} ${sy(p.od).toFixed(1)}`).join(' ');
    const focusPath = linePath(data!);
    const areaPath = `${focusPath} L ${sx(data![data!.length - 1].t).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${sx(data![0].t).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

    // Exponential-phase segment (the steepest ln-OD interval that produced muMax).
    let expSeg: string | null = null;
    if (metrics.expIdx !== null && data![metrics.expIdx] && data![metrics.expIdx + 1]) {
      const a = data![metrics.expIdx];
      const b = data![metrics.expIdx + 1];
      expSeg = `M ${sx(a.t).toFixed(1)} ${sy(a.od).toFixed(1)} L ${sx(b.t).toFixed(1)} ${sy(b.od).toFixed(1)}`;
    }

    const capY = metrics.maxOD !== null ? sy(metrics.maxOD) : null;

    // Per-point screen coords for the focus curve (drives hover dots + crosshair
    // snapping). Computed once here so mouse-move handling stays allocation-free.
    const focusPts = data!.map(p => ({ t: p.t, od: p.od, x: sx(p.t), y: sy(p.od) }));

    return {
      W, H, padL, padR, padT, padB, innerW, innerH,
      xMin, xMax, yMax, sx, sy, xTicks, yTicks,
      focusPath, areaPath, expSeg, capY, focusPts,
      // Pair each overlay path with its peer id + hue so hover/focus emphasis can
      // target an individual curve.
      peerPaths: showOverlay
        ? shownPeers.map((p, i) => ({ id: p.id, name: p.name, d: linePath(p.growth_curve!), hue: PEER_HUES[i % PEER_HUES.length] }))
        : [],
    };
  }, [data, hasCurve, logScale, showOverlay, shownPeers, metrics]);

  const chips: { label: string; value?: string | number }[] = [
    { label: 'experiment', value: sample.experiment },
    { label: 'strain', value: sample.strain },
    { label: 'condition', value: sample.condition },
    { label: 'replicate', value: sample.replicate },
    { label: 'transfer', value: sample.transfer },
    { label: 'donor DNA', value: sample.donor_dna },
  ];

  // Map a cursor X (in SVG user units) to the nearest focus datum index. The
  // invisible plot-area <rect> reports cursor position relative to the SVG, so we
  // search focusPts by screen X (which already encodes the active linear/log
  // scale, so this works identically in both modes).
  const handlePlotMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!chart || chart.focusPts.length === 0) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Account for the SVG being scaled by CSS (max-w-full h-auto) to user units.
    const scaleX = chart.W / rect.width;
    const cursorX = (e.clientX - rect.left) * scaleX;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < chart.focusPts.length; i++) {
      const dx = Math.abs(chart.focusPts[i].x - cursorX);
      if (dx < bestDist) { bestDist = dx; best = i; }
    }
    setHoverIndex(prev => (prev === best ? prev : best));
  };

  const hoverPt = chart && hoverIndex !== null ? chart.focusPts[hoverIndex] ?? null : null;

  const buildGrowthFigureSpec = (): FigureSpec | null => {
    if (!data || data.length < 2) return null;
    const overlay = showOverlay ? shownPeers.map((p, i) => ({
      id: p.id,
      label: p.name,
      color: PEER_HUES[i % PEER_HUES.length],
      emphasis: p.id === focusedPeerId || p.id === hoveredPeerId,
      points: (p.growth_curve ?? []).map(point => ({ x: point.t, y: point.od })),
    })) : [];
    return {
      kind: 'lineChart',
      title: `Growth curve for ${sample.name}`,
      subtitle: `${logScale ? 'Log-scaled' : 'Linear'} OD600 over time${overlay.length ? ` with ${overlay.length} same-group peer curve${overlay.length === 1 ? '' : 's'}` : ''}.`,
      xTitle: 'Time (h)',
      yTitle: logScale ? 'OD600 (log)' : 'OD600',
      legendTitle: 'Growth curves',
      caption: 'AI-ALE LIMS viewer growth-curve export. Metrics are descriptive estimates from observed OD600 points, not fitted kinetic-model parameters.',
      logY: logScale,
      showPoints: true,
      series: [
        { id: sample.id, label: sample.name, color: '#059669', emphasis: true, points: data.map(point => ({ x: point.t, y: point.od })) },
        ...overlay,
      ],
      referenceLines: metrics.maxOD !== null ? [{ y: metrics.maxOD, label: `K = ${fmtMetric(metrics.maxOD, 3)}`, color: '#059669', dash: true }] : [],
    };
  };

  const metricCards: { label: string; value: string; caption: string }[] = [
    { label: 'Max OD600 (K)', value: fmtMetric(metrics.maxOD, 3), caption: 'observed carrying capacity (curve max)' },
    { label: 'Max growth rate mu', value: fmtMetric(metrics.muMax, 3, ' /h'), caption: 'steepest ln(OD) slope between points' },
    { label: 'Doubling time', value: fmtMetric(metrics.doublingTimeH, 2, ' h'), caption: 'ln(2) / mu, at max growth rate' },
    { label: 'Lag time', value: fmtMetric(metrics.lagTimeH, 2, ' h'), caption: 'first t where OD reaches 2x baseline' },
    { label: 'AUC', value: fmtMetric(metrics.aucod, 3, ' OD*h'), caption: 'area under OD vs time (trapezoid)' },
    { label: 'Data points', value: String(metrics.nPoints), caption: 'measured OD600 readings' },
    { label: 'Time span', value: fmtMetric(metrics.tSpan, 1, ' h'), caption: `t = ${fmtMetric(metrics.tMin, 1)} to ${fmtMetric(metrics.tMax, 1)} h` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <TrendingUp className="w-4 h-4 text-[var(--data-grow)] shrink-0" />
              <span className="font-mono text-[18px] font-semibold text-[var(--text)] break-all">{sample.name}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.filter(c => c.value !== undefined && c.value !== null && c.value !== '').map(c => (
                <span key={c.label} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text-soft)]">
                  <span className="text-[var(--text-faint)] uppercase tracking-wide mr-1">{c.label}</span>
                  <span className="font-mono text-[var(--text)]">{String(c.value)}</span>
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-soft)] hover:text-[var(--text)]"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: main content (scrolls) on the left, peer compare list as an
            independently-scrolling sidebar on the right so overlaid curves stay
            in view while you scroll through and hover samples to compare. */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-4 scroll-smooth">
          {/* Chart */}
          <ModalSection title="Growth curve" hint="OD600 vs time (h)">
            {!hasCurve ? (
              <div className="text-[12px] text-[var(--text-soft)] space-y-2">
                <div className="italic text-[var(--text-faint)]">numeric series not in this dataset</div>
                {sample.od_sources && sample.od_sources.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[var(--text-soft)]">OD measurement was tracked upstream in:</div>
                    <ul className="font-mono text-[11px] space-y-0.5">
                      {sample.od_sources.map((s, i) => (
                        <li key={i} className="text-[var(--text)]">
                          <span className="text-amber-700 dark:text-amber-300">{s.type.replace('OD_series_', '')}</span>: {s.source}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-[var(--text-faint)]">No OD source reference available either.</div>
                )}
              </div>
            ) : chart ? (
              <>
                {/* Toggles */}
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <div className="inline-flex rounded border border-[var(--border)] overflow-hidden text-[11px]">
                    <button
                      onClick={() => setLogScale(false)}
                      className={cn('px-2 py-0.5', !logScale ? 'bg-[var(--data-grow)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-soft)]')}
                    >Linear</button>
                    <button
                      onClick={() => setLogScale(true)}
                      className={cn('px-2 py-0.5', logScale ? 'bg-[var(--data-grow)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-soft)]')}
                      title="Log(OD) makes exponential growth a straight line - the standard microbiology view"
                    >Log (ln OD)</button>
                  </div>
                  {overlayPeers.length > 0 && (
                    <button
                      onClick={() => setShowOverlay(v => !v)}
                      className={cn('px-2 py-0.5 rounded border text-[11px]', showOverlay
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                        : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-soft)]')}
                    >{showOverlay ? 'Hide group overlay' : 'Show group overlay'}</button>
                  )}
                  <ExportFigureMenu
                    getTarget={() => growthSvgRef.current}
                    title={`Growth curve for ${sample.name}`}
                    filenameBase={`growth-curve-${sample.name}`}
                    buildSpec={buildGrowthFigureSpec}
                    compact
                  />
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {logScale ? 'Log axis: exponential phase reads as a straight line.' : 'Linear axis.'}
                  </span>
                </div>

                <div className="relative inline-block max-w-full">
                <svg ref={growthSvgRef} width={chart.W} height={chart.H} className="block max-w-full h-auto select-none" role="img" aria-label={`Growth curve for ${sample.name}`}>
                  {/* Gridlines + Y ticks */}
                  {chart.yTicks.map((v, i) => {
                    const y = chart.sy(v);
                    return (
                      <g key={`y${i}`}>
                        <line x1={chart.padL} y1={y} x2={chart.W - chart.padR} y2={y} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
                        <text x={chart.padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--text-faint)" className="font-mono">{v < 0.01 ? v.toExponential(0) : v.toFixed(v < 0.1 ? 3 : 2)}</text>
                      </g>
                    );
                  })}
                  {/* X ticks + gridlines */}
                  {chart.xTicks.map((t, i) => {
                    const x = chart.sx(t);
                    return (
                      <g key={`x${i}`}>
                        <line x1={x} y1={chart.padT} x2={x} y2={chart.padT + chart.innerH} stroke="var(--border)" strokeWidth="0.5" opacity="0.3" />
                        <line x1={x} y1={chart.padT + chart.innerH} x2={x} y2={chart.padT + chart.innerH + 4} stroke="var(--text-faint)" strokeWidth="0.75" />
                        <text x={x} y={chart.padT + chart.innerH + 15} textAnchor="middle" fontSize="9" fill="var(--text-faint)" className="font-mono">{t % 1 === 0 ? t.toFixed(0) : t.toFixed(1)}</text>
                      </g>
                    );
                  })}
                  {/* Axes */}
                  <line x1={chart.padL} y1={chart.padT} x2={chart.padL} y2={chart.padT + chart.innerH} stroke="var(--text-soft)" strokeWidth="1" />
                  <line x1={chart.padL} y1={chart.padT + chart.innerH} x2={chart.W - chart.padR} y2={chart.padT + chart.innerH} stroke="var(--text-soft)" strokeWidth="1" />
                  {/* Axis labels */}
                  <text x={chart.padL + chart.innerW / 2} y={chart.H - 4} textAnchor="middle" fontSize="11" fill="var(--text-soft)" fontWeight="600">Time (h)</text>
                  <text x={12} y={chart.padT + chart.innerH / 2} textAnchor="middle" fontSize="11" fill="var(--text-soft)" fontWeight="600" transform={`rotate(-90 12 ${chart.padT + chart.innerH / 2})`}>{logScale ? 'OD600 (log)' : 'OD600'}</text>

                  {/* Carrying-capacity (max OD) dashed line */}
                  {chart.capY !== null && (
                    <g>
                      <line x1={chart.padL} y1={chart.capY} x2={chart.W - chart.padR} y2={chart.capY} stroke="var(--data-grow)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
                      <text x={chart.W - chart.padR - 2} y={chart.capY - 3} textAnchor="end" fontSize="9" fill="var(--data-grow)" className="font-mono">K = {fmtMetric(metrics.maxOD, 3)}</text>
                    </g>
                  )}

                  {/* Overlay peer curves (thin, faded, distinct hues). The
                      hovered/focused peer is raised to full opacity + thickened;
                      the rest dim so the emphasized curve stands out. */}
                  {chart.peerPaths.map((pp) => {
                    const emphasized = pp.id === hoveredPeerId || pp.id === focusedPeerId;
                    const anyEmphasis = hoveredPeerId !== null || focusedPeerId !== null;
                    return (
                      <path
                        key={`peer${pp.id}`}
                        d={pp.d}
                        fill="none"
                        stroke={pp.hue}
                        strokeWidth={emphasized ? 2.4 : 1}
                        opacity={emphasized ? 0.95 : anyEmphasis ? 0.15 : 0.45}
                        style={{ cursor: 'pointer', transition: 'opacity 120ms, stroke-width 120ms' }}
                        onMouseEnter={() => setHoveredPeerId(pp.id)}
                        onMouseLeave={() => setHoveredPeerId(prev => (prev === pp.id ? null : prev))}
                        onClick={() => setFocusedPeerId(prev => (prev === pp.id ? null : pp.id))}
                      >
                        <title>{pp.name}</title>
                      </path>
                    );
                  })}

                  {/* Focus area + line */}
                  {!showOverlay || overlayPeers.length === 0 ? (
                    <path d={chart.areaPath} fill="var(--data-grow)" opacity="0.12" stroke="none" />
                  ) : null}
                  <path d={chart.focusPath} fill="none" stroke="var(--data-grow)" strokeWidth="2.2" />

                  {/* Exponential-phase highlight (where muMax came from) */}
                  {chart.expSeg && (
                    <path d={chart.expSeg} fill="none" stroke="#ea580c" strokeWidth="3.5" opacity="0.85" />
                  )}

                  {/* Hover crosshair (vertical line at the snapped time) */}
                  {hoverPt && (
                    <line
                      x1={hoverPt.x} y1={chart.padT} x2={hoverPt.x} y2={chart.padT + chart.innerH}
                      stroke="var(--data-grow)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7"
                      pointerEvents="none"
                    />
                  )}

                  {/* Focus data points. The hovered point enlarges with a ring;
                      each is individually hoverable and updates the same index. */}
                  {chart.focusPts.map((p, i) => {
                    const active = hoverIndex === i;
                    return (
                      <g key={i}>
                        {active && (
                          <circle cx={p.x} cy={p.y} r="6" fill="var(--data-grow)" opacity="0.2" pointerEvents="none" />
                        )}
                        <circle
                          cx={p.x} cy={p.y} r={active ? 4 : 2.6}
                          fill="var(--data-grow)" stroke="white" strokeWidth={active ? 1 : 0.6}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={() => setHoverIndex(i)}
                        >
                          <title>t = {p.t.toFixed(2)} h, OD600 = {p.od.toFixed(3)}</title>
                        </circle>
                      </g>
                    );
                  })}

                  {/* Invisible full-plot overlay drives the crosshair + nearest-
                      point tooltip on mouse move. Painted last so it sits on top. */}
                  <rect
                    x={chart.padL} y={chart.padT} width={chart.innerW} height={chart.innerH}
                    fill="transparent"
                    style={{ cursor: 'crosshair' }}
                    onMouseMove={handlePlotMove}
                    onMouseLeave={() => setHoverIndex(null)}
                  />
                </svg>

                {/* Floating tooltip near the hovered point (HTML, positioned over
                    the SVG via the relative wrapper; coords scaled to rendered px). */}
                {hoverPt && (
                  <div
                    className="pointer-events-none absolute z-10 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 shadow-lg text-[10.5px] leading-tight"
                    style={{
                      left: `${(hoverPt.x / chart.W) * 100}%`,
                      top: `${(hoverPt.y / chart.H) * 100}%`,
                      transform: 'translate(-50%, -120%)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div className="font-mono text-[var(--text)]">t = {hoverPt.t.toFixed(2)} h</div>
                    <div className="font-mono text-[var(--data-grow)]">OD600 = {hoverPt.od.toFixed(3)}</div>
                    {logScale && hoverPt.od > 0 && (
                      <div className="font-mono text-[var(--text-faint)]">ln(OD) = {Math.log(hoverPt.od).toFixed(3)}</div>
                    )}
                  </div>
                )}
                </div>

                {/* Legend */}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-soft)]">
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-[2px] bg-[var(--data-grow)]" /> {sample.name} (focus)</span>
                  {chart.expSeg && <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-[3px]" style={{ background: '#ea580c' }} /> exponential phase (mu)</span>}
                  {chart.capY !== null && <span className="inline-flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-[var(--data-grow)]" /> carrying capacity K</span>}
                </div>
              </>
            ) : null}
          </ModalSection>

          {/* Metrics */}
          {hasCurve && (
            <ModalSection title="Growth metrics" hint="simple descriptive estimates, not a kinetic-model fit">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {metricCards.map(c => (
                  <div key={c.label} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5">
                    <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">{c.label}</div>
                    <div className="font-mono text-[14px] font-semibold text-[var(--text)] tabular-nums">{c.value}</div>
                    <div className="text-[9px] text-[var(--text-faint)] leading-tight mt-0.5">{c.caption}</div>
                  </div>
                ))}
              </div>
              <details className="mt-2 text-[10.5px] text-[var(--text-soft)] leading-snug">
                <summary className="cursor-pointer text-[var(--accent-700)] hover:underline select-none">How is each value computed? (click)</summary>
                <div className="mt-1.5 space-y-1 rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <p>These are <b>descriptive statistics of the observed OD600 points</b>, computed in the browser from the numeric series. They are not Gompertz/logistic/Richards model fits, and nothing is invented: if no numeric series exists, the chart above says so.</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li><b>Max OD600 (K)</b> = the largest observed OD600 (not a fitted asymptote).</li>
                    <li><b>Max growth rate mu</b> = the steepest slope of ln(OD) between two consecutive points: max of (ln(OD[i+1]) - ln(OD[i])) / (t[i+1] - t[i]). The interval that produced it is highlighted on the curve.</li>
                    <li><b>Doubling time</b> = ln(2) / mu, at that maximum rate.</li>
                    <li><b>Lag time</b> = first time OD reaches at least 2x the baseline (minimum of the first few points). A coarse heuristic, not a tangent intercept.</li>
                    <li><b>AUC</b> = trapezoid-rule area under the OD-vs-time curve (OD*hours).</li>
                  </ul>
                  <p className="text-[var(--text-faint)]">Source: numeric rows from the LIMS <span className="font-mono">Robotic_OD</span> table, matched to this sample by ALE lineage and transfer.</p>
                </div>
              </details>
            </ModalSection>
          )}

        </div>
        {/* Peer compare sidebar: independently scrollable so the chart + its
            overlaid curves stay in view. Hover a sample to emphasize its curve;
            click to pin it. */}
        {overlayPeers.length > 0 && (
          <div className="w-60 shrink-0 border-l border-[var(--border)] flex flex-col min-h-0 bg-[var(--surface-2)]">
            <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
              <div className="text-[12px] font-semibold text-[var(--text)]">Compare with group</div>
              <div className="text-[10px] text-[var(--text-faint)] mt-0.5 leading-snug">
                {overlayPeers.length} peer{overlayPeers.length === 1 ? '' : 's'} sharing experiment, replicate and donor DNA. Hover to emphasize, click to pin.
              </div>
              <label className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-[var(--text-soft)] cursor-pointer">
                <input type="checkbox" checked={showOverlay} onChange={() => setShowOverlay(v => !v)} className="w-3 h-3" />
                Overlay peer curves
              </label>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto py-1">
              {shownPeers.map((p, i) => {
                const emphasized = p.id === hoveredPeerId || p.id === focusedPeerId;
                const isFocused = p.id === focusedPeerId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      'w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] transition-colors',
                      emphasized ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-3)]/60',
                    )}
                    title={`${p.name}\nHover to emphasize, click to ${isFocused ? 'release' : 'pin'} this curve`}
                    onMouseEnter={() => setHoveredPeerId(p.id)}
                    onMouseLeave={() => setHoveredPeerId(prev => (prev === p.id ? null : prev))}
                    onClick={() => setFocusedPeerId(prev => (prev === p.id ? null : p.id))}
                  >
                    <span
                      className="inline-block w-4 shrink-0 rounded"
                      style={{ background: PEER_HUES[i % PEER_HUES.length], height: emphasized ? 4 : 2.5 }}
                    />
                    <span className={cn('font-mono truncate flex-1', emphasized ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-soft)]')}>{p.name}</span>
                    {isFocused && <span className="text-[9px] text-[var(--data-grow)] shrink-0">pinned</span>}
                  </button>
                );
              })}
              {hiddenPeerCount > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-[var(--text-faint)]">{hiddenPeerCount} more hidden (capped at {PEER_CAP} for legibility).</div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

type FacetSummary = {
  rows: MutationSample[];
  experiments: { value: string; count: number }[];
  strains: { value: string; count: number }[];
  donors: { value: string; count: number }[];
  conditions: { value: string; count: number }[];
  replicates: { value: string; count: number }[];
  transfers: number[];
  growthCount: number;
  mutationRows: { mutation: MutationRow; present: number; provided: number; maxValue: number; sequence: string }[];
  providedRows: { mutation: MutationRow; present: number; provided: number; maxValue: number; sequence: string }[];
};

function countValues(rows: MutationSample[], get: (s: MutationSample) => string | undefined): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of rows) {
    const v = get(s);
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function mutationSequenceSummary(m: MutationRow): string {
  const d = m.detail;
  if (!d) return '';
  const parts = [
    d.ref_seq || d.new_seq ? `${d.ref_seq || '?'} -> ${d.new_seq || '?'}` : '',
    d.codon_ref_seq || d.codon_new_seq ? `codon ${d.codon_ref_seq || '?'} -> ${d.codon_new_seq || '?'}` : '',
    d.aa_ref_seq || d.aa_new_seq ? `aa ${d.aa_ref_seq || '?'}${d.aa_position ?? '?'}${d.aa_new_seq || '?'}` : '',
    d.repeat_seq ? `repeat ${d.repeat_seq}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function buildFacetSummary(rows: MutationSample[], mutations: MutationRow[]): FacetSummary {
  const ids = new Set(rows.map(s => s.id));
  const mutationRows = mutations
    .map(m => {
      let present = 0;
      let maxValue = 0;
      for (const [sid, v] of Object.entries(m.values)) {
        if (!ids.has(sid) || typeof v !== 'number' || v <= 0) continue;
        present++;
        if (v > maxValue) maxValue = v;
      }
      let provided = 0;
      for (const sid of m.providedIn ?? []) if (ids.has(sid)) provided++;
      return { mutation: m, present, provided, maxValue, sequence: mutationSequenceSummary(m) };
    })
    .filter(r => r.present > 0 || r.provided > 0)
    .sort((a, b) => b.provided - a.provided || b.present - a.present || b.maxValue - a.maxValue || a.mutation.gene.localeCompare(b.mutation.gene));
  return {
    rows,
    experiments: countValues(rows, s => s.experiment),
    strains: countValues(rows, s => s.strain),
    donors: countValues(rows, s => s.donor_dna),
    conditions: countValues(rows, s => s.condition),
    replicates: countValues(rows, s => s.replicate),
    transfers: [...new Set(rows.map(s => s.transfer).filter((v): v is number => typeof v === 'number'))].sort((a, b) => a - b),
    growthCount: rows.filter(s => (s.growth_curve?.length ?? 0) >= 2).length,
    mutationRows,
    providedRows: mutationRows.filter(r => r.provided > 0),
  };
}

function SummaryChips({ label, rows, empty = 'none' }: { label: string; rows: { value: string; count: number }[]; empty?: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-faint)] mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {rows.length ? rows.slice(0, 18).map(r => (
          <span key={r.value} className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--border)] text-[10.5px]">
            <span className="font-mono text-[var(--text)]">{r.value}</span> <span className="text-[var(--text-faint)] tabular-nums">{r.count}</span>
          </span>
        )) : <span className="text-[11px] text-[var(--text-faint)] italic">{empty}</span>}
        {rows.length > 18 && <span className="text-[10.5px] text-[var(--text-faint)]">+{rows.length - 18} more</span>}
      </div>
    </div>
  );
}

function FacetActionBar({ onFilter, onSelect, onCompare, count }: { onFilter: () => void; onSelect: () => void; onCompare: () => void; count: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={onFilter} className="lims-btn lims-btn-ghost !text-[11px]">Filter table</button>
      <button onClick={onSelect} className="lims-btn lims-btn-ghost !text-[11px]">Select {count}</button>
      <button onClick={onCompare} disabled={count === 0} className="lims-btn lims-btn-primary !text-[11px] disabled:opacity-50">Compare selected</button>
    </div>
  );
}

function SequenceAvailabilityPanel({ kind, rows, checked }: { kind: 'donor DNA' | 'strain'; rows: FacetSummary['mutationRows']; checked: string[] }) {
  const withSeq = rows.filter(r => r.sequence).slice(0, 12);
  return (
    <ModalSection title="Sequence" hint="mutation-level snippets only">
      <div className="space-y-2 text-[12px] text-[var(--text-soft)]">
        <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/20 px-3 py-2 text-amber-800 dark:text-amber-200">
          Full {kind} construct/genome sequence is not exposed by the curated mutations API used by this view. This panel can only show mutation-level sequence fields already present on mutation rows: {checked.map(c => <span key={c} className="font-mono">{c}</span>).reduce<React.ReactNode[]>((acc, cur, i) => i === 0 ? [cur] : [...acc, ', ', cur], [])}.
        </div>
        {withSeq.length > 0 ? (
          <div>
            <div className="text-[11px] text-[var(--text-faint)] mb-1">Mutation-level sequence snippets available in this group:</div>
            <div className="max-h-40 overflow-y-auto rounded border border-[var(--border)] divide-y divide-[var(--border)]">
              {withSeq.map(r => (
                <div key={r.mutation.id} className="px-2 py-1.5 flex items-start gap-2">
                  <span className="font-mono text-[11px] text-[var(--text)] min-w-0 flex-1 truncate">{r.mutation.gene} / {r.mutation.variant}</span>
                  <span className="font-mono text-[11px] text-[var(--text-soft)] text-right">{r.sequence}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <div className="text-[var(--text-faint)] italic">No mutation-level sequence snippets are present for this group either.</div>}
      </div>
    </ModalSection>
  );
}

function MutationMiniTable({ rows, sampleCount, empty }: { rows: FacetSummary['mutationRows']; sampleCount: number; empty: string }) {
  const shown = rows.slice(0, 20);
  if (shown.length === 0) return <div className="text-[12px] text-[var(--text-faint)] italic">{empty}</div>;
  return (
    <div className="max-h-64 overflow-y-auto rounded border border-[var(--border)]">
      <table className="w-full text-[11.5px]">
        <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-soft)]">
          <tr>
            <th className="px-2 py-1 text-left">Mutation</th>
            <th className="px-2 py-1 text-right">Present</th>
            <th className="px-2 py-1 text-right">Provided</th>
            <th className="px-2 py-1 text-right">Max</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(r => (
            <tr key={r.mutation.id} className="border-t border-[var(--border)]">
              <td className="px-2 py-1 min-w-0">
                <div className="font-mono text-[var(--text)] truncate">{r.mutation.gene} / {r.mutation.variant}</div>
                <div className="text-[10px] text-[var(--text-faint)] truncate">{r.mutation.type}{r.mutation.gene_product ? ` | ${r.mutation.gene_product}` : ''}</div>
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{r.present}/{sampleCount}</td>
              <td className="px-2 py-1 text-right tabular-nums">{r.provided}</td>
              <td className="px-2 py-1 text-right tabular-nums">{r.maxValue.toFixed(r.maxValue <= 1 ? 3 : 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && <div className="px-2 py-1 text-[10.5px] text-[var(--text-faint)] border-t border-[var(--border)]">Showing first {shown.length} of {rows.length}. Use Comparative View for the full list.</div>}
    </div>
  );
}

function FacetSamplesTable({ rows, onOpenGrowth }: { rows: MutationSample[]; onOpenGrowth: (s: MutationSample) => void }) {
  return (
    <div className="max-h-56 overflow-y-auto rounded border border-[var(--border)]">
      <table className="w-full text-[11.5px]">
        <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-soft)]">
          <tr>
            <th className="px-2 py-1 text-left">Sample</th>
            <th className="px-2 py-1 text-left">Experiment</th>
            <th className="px-2 py-1 text-left">Rep</th>
            <th className="px-2 py-1 text-right">T</th>
            <th className="px-2 py-1 text-right">Growth</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 80).map(s => (
            <tr key={s.id} className="border-t border-[var(--border)]">
              <td className="px-2 py-1 font-mono text-[var(--text)]">{s.name}</td>
              <td className="px-2 py-1 text-[var(--text-soft)]">{s.experiment}</td>
              <td className="px-2 py-1 text-[var(--text-soft)]">{s.replicate ?? ''}</td>
              <td className="px-2 py-1 text-right tabular-nums">{s.transfer ?? ''}</td>
              <td className="px-2 py-1 text-right">
                {(s.growth_curve?.length ?? 0) >= 2 ? <button onClick={() => onOpenGrowth(s)} className="text-emerald-600 dark:text-emerald-400 hover:underline">open</button> : <span className="text-[var(--text-faint)]">none</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 80 && <div className="px-2 py-1 text-[10.5px] text-[var(--text-faint)] border-t border-[var(--border)]">Showing first 80 of {rows.length} samples.</div>}
    </div>
  );
}

function CompareGroupDetailModal({
  group, mutations, selected, onClose, onSelectGroup, onRemoveGroup, onOpenGrowth,
}: {
  group: { levelKey: GroupLevelKey; levelLabel: string; label: string; rows: MutationSample[] };
  mutations: MutationRow[];
  selected: Set<string>;
  onClose: () => void;
  onSelectGroup: () => void;
  onRemoveGroup: () => void;
  onOpenGrowth: (s: MutationSample) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const summary = useMemo(() => buildFacetSummary(group.rows, mutations), [group.rows, mutations]);
  const selectedCount = group.rows.reduce((acc, s) => acc + (selected.has(s.id) ? 1 : 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="compare-group-title">
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="w-4 h-4 text-blue-600 shrink-0" />
              <span id="compare-group-title" className="font-semibold">{group.levelLabel}</span>
              <span className="font-mono text-[16px] break-all">{group.label}</span>
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-soft)]">{group.rows.length} sample{group.rows.length === 1 ? '' : 's'} · {selectedCount} currently selected</div>
          </div>
          <button onClick={onClose} className="shrink-0 p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-soft)] hover:text-[var(--text)]" title="Close (Esc)"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={onSelectGroup} className="lims-btn lims-btn-primary !text-[11px]">Select group</button>
            <button onClick={onRemoveGroup} className="lims-btn lims-btn-ghost !text-[11px]">Remove group</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <StatCard label="Samples" value={String(group.rows.length)} />
            <StatCard label="Selected" value={`${selectedCount}/${group.rows.length}`} />
            <StatCard label="Mutations" value={String(summary.mutationRows.length)} />
            <StatCard label="Provided" value={String(summary.providedRows.length)} />
            <StatCard label="Growth curves" value={`${summary.growthCount}/${group.rows.length}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <SummaryChips label="Experiments" rows={summary.experiments} />
            <SummaryChips label="Strains" rows={summary.strains} />
            <SummaryChips label="Donor DNA" rows={summary.donors} />
            <SummaryChips label="Conditions" rows={summary.conditions} />
          </div>
          <ModalSection title="Mutation summary" hint="observed or provided mutation rows across this group">
            <MutationMiniTable rows={summary.mutationRows} sampleCount={group.rows.length} empty="No mutation rows are present for this group in the loaded dataset." />
          </ModalSection>
          <ModalSection title="Samples" hint="matching columns in the Comparative View">
            <FacetSamplesTable rows={sortSamples(group.rows)} onOpenGrowth={onOpenGrowth} />
          </ModalSection>
        </div>
      </div>
    </div>
  );
}

function DonorDnaDetailModal({
  donorDna, samples, mutations, onClose, onFilter, onSelect, onCompare, onOpenGrowth,
}: {
  donorDna: string;
  samples: MutationSample[];
  mutations: MutationRow[];
  onClose: () => void;
  onFilter: () => void;
  onSelect: () => void;
  onCompare: () => void;
  onOpenGrowth: (s: MutationSample) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows = useMemo(() => sortSamples(samples.filter(s => s.donor_dna === donorDna)), [samples, donorDna]);
  const summary = useMemo(() => buildFacetSummary(rows, mutations), [rows, mutations]);
  const growthMetrics = useMemo(() => rows.map(s => computeGrowthMetrics(s.growth_curve)).filter(m => m.maxOD !== null), [rows]);
  const avgMaxOD = growthMetrics.length ? growthMetrics.reduce((a, m) => a + (m.maxOD ?? 0), 0) / growthMetrics.length : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><Dna className="w-4 h-4 text-emerald-600" /><span className="font-mono text-[18px] font-semibold break-all">{donorDna}</span></div>
            <div className="mt-1 text-[11px] text-[var(--text-soft)]">Donor DNA context across {rows.length} sample{rows.length === 1 ? '' : 's'}</div>
          </div>
          <button onClick={onClose} className="shrink-0 p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-soft)] hover:text-[var(--text)]" title="Close (Esc)"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <FacetActionBar onFilter={onFilter} onSelect={onSelect} onCompare={onCompare} count={rows.length} />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <StatCard label="Samples" value={String(rows.length)} />
            <StatCard label="Experiments" value={String(summary.experiments.length)} />
            <StatCard label="Strains" value={String(summary.strains.length)} />
            <StatCard label="Provided muts" value={String(summary.providedRows.length)} />
            <StatCard label="Growth curves" value={`${summary.growthCount}/${rows.length}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <SummaryChips label="Experiments" rows={summary.experiments} />
            <SummaryChips label="Strains" rows={summary.strains} />
            <SummaryChips label="Conditions" rows={summary.conditions} />
            <SummaryChips label="Replicates" rows={summary.replicates} />
          </div>
          <ModalSection title="Growth coverage" hint="descriptive only">
            <div className="text-[12px] text-[var(--text-soft)]">{summary.growthCount} of {rows.length} samples have numeric OD curves. Average max OD: <span className="font-mono text-[var(--text)]">{fmtMetric(avgMaxOD, 3)}</span>.</div>
          </ModalSection>
          <ModalSection title="Provided mutation summary" hint="from donor DNA matching already present in the mutation dataset">
            <MutationMiniTable rows={summary.providedRows} sampleCount={rows.length} empty="No mutations in this loaded dataset are marked as provided by this donor DNA." />
          </ModalSection>
          <SequenceAvailabilityPanel kind="donor DNA" rows={summary.providedRows.length ? summary.providedRows : summary.mutationRows} checked={['Mutation.detail.ref_seq/new_seq', 'Mutation.detail.codon_ref_seq/codon_new_seq', 'Mutation.detail.aa_ref_seq/aa_new_seq']} />
          <ModalSection title="Samples" hint="matching samples in the current dataset">
            <FacetSamplesTable rows={rows} onOpenGrowth={onOpenGrowth} />
          </ModalSection>
        </div>
      </div>
    </div>
  );
}

function StrainDetailModal({
  strain, samples, mutations, onClose, onFilter, onSelect, onCompare, onOpenGrowth,
}: {
  strain: string;
  samples: MutationSample[];
  mutations: MutationRow[];
  onClose: () => void;
  onFilter: () => void;
  onSelect: () => void;
  onCompare: () => void;
  onOpenGrowth: (s: MutationSample) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows = useMemo(() => sortSamples(samples.filter(s => s.strain === strain)), [samples, strain]);
  const summary = useMemo(() => buildFacetSummary(rows, mutations), [rows, mutations]);
  const growthMetrics = useMemo(() => rows.map(s => computeGrowthMetrics(s.growth_curve)).filter(m => m.maxOD !== null), [rows]);
  const avgMaxOD = growthMetrics.length ? growthMetrics.reduce((a, m) => a + (m.maxOD ?? 0), 0) / growthMetrics.length : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><FlaskConical className="w-4 h-4 text-violet-600" /><span className="font-mono text-[18px] font-semibold break-all">{strain}</span></div>
            <div className="mt-1 text-[11px] text-[var(--text-soft)]">Strain context across {rows.length} sample{rows.length === 1 ? '' : 's'}</div>
          </div>
          <button onClick={onClose} className="shrink-0 p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-soft)] hover:text-[var(--text)]" title="Close (Esc)"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <FacetActionBar onFilter={onFilter} onSelect={onSelect} onCompare={onCompare} count={rows.length} />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <StatCard label="Samples" value={String(rows.length)} />
            <StatCard label="Experiments" value={String(summary.experiments.length)} />
            <StatCard label="Donor DNAs" value={String(summary.donors.length)} />
            <StatCard label="Mutations" value={String(summary.mutationRows.length)} />
            <StatCard label="Growth curves" value={`${summary.growthCount}/${rows.length}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <SummaryChips label="Experiments" rows={summary.experiments} />
            <SummaryChips label="Donor DNA" rows={summary.donors} />
            <SummaryChips label="Conditions" rows={summary.conditions} />
            <SummaryChips label="Replicates" rows={summary.replicates} />
          </div>
          <ModalSection title="Transfer coverage" hint="sequenced transfer numbers in this loaded dataset">
            <div className="flex flex-wrap gap-1">{summary.transfers.length ? summary.transfers.map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--border)] font-mono text-[11px]">T{t}</span>) : <span className="text-[12px] text-[var(--text-faint)] italic">no transfer values</span>}</div>
          </ModalSection>
          <ModalSection title="Growth coverage" hint="descriptive only">
            <div className="text-[12px] text-[var(--text-soft)]">{summary.growthCount} of {rows.length} samples have numeric OD curves. Average max OD: <span className="font-mono text-[var(--text)]">{fmtMetric(avgMaxOD, 3)}</span>.</div>
          </ModalSection>
          <ModalSection title="Mutation summary" hint="observed or provided mutation rows in matching samples">
            <MutationMiniTable rows={summary.mutationRows} sampleCount={rows.length} empty="No mutation rows are present for this strain in the loaded dataset." />
          </ModalSection>
          <SequenceAvailabilityPanel kind="strain" rows={summary.mutationRows} checked={['Mutation.detail.ref_seq/new_seq', 'Mutation.detail.codon_ref_seq/codon_new_seq', 'Mutation.detail.aa_ref_seq/aa_new_seq']} />
          <ModalSection title="Samples" hint="matching samples in the current dataset">
            <FacetSamplesTable rows={rows} onOpenGrowth={onOpenGrowth} />
          </ModalSection>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
      <div className="font-mono text-[15px] font-semibold text-[var(--text)] tabular-nums">{value}</div>
    </div>
  );
}

/* ---- Sample detail modal ---------------------------------------------------
   Rich, interactive popup opened by clicking a sample NAME (the row checkbox /
   rest of the row still toggles selection). Mirrors the MutationDetailModal /
   GrowthCurveModal pattern (fixed inset-0 backdrop, max-w-3xl scrollable card,
   close on backdrop / X / Esc). Shows: header chips, a metadata grid, an
   embedded clickable growth sparkline with the key growth metrics, and the
   sample's mutation-call count. Clicking the sparkline chains to the full
   GrowthCurveModal via onOpenGrowth. Self-contained; metrics memoized. */
function SampleDetailModal({
  sample, mutations, allMutationCount, onClose, onOpenGrowth,
}: {
  sample: MutationSample;
  mutations: MutationRow[];
  allMutationCount: number;
  onClose: () => void;
  onOpenGrowth: (s: MutationSample) => void;
}) {
  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const data = sample.growth_curve;
  const hasCurve = !!(data && data.length >= 2);
  const metrics = useMemo(() => computeGrowthMetrics(data), [data]);

  // Header chips: only render the ones present. Colors follow the established
  // semantics (emerald growth context lives in the chart; sample facets are
  // neutral slate, with strain/condition/donor given subtle accents).
  const chips: { label: string; value?: string | number; cls?: string }[] = [
    { label: 'experiment', value: sample.experiment, cls: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300' },
    { label: 'strain', value: sample.strain, cls: 'bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300' },
    { label: 'condition', value: sample.condition, cls: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300' },
    { label: 'replicate', value: sample.replicate },
    { label: 'transfer', value: sample.transfer },
    { label: 'donor DNA', value: sample.donor_dna },
    { label: 'selection', value: sample.selection_note },
  ];

  // Metadata grid: every documented field, "n/a" when absent.
  const naOr = (v: string | number | undefined | null) =>
    v === undefined || v === null || v === '' ? 'n/a' : String(v);
  const metaRows: { label: string; value: string }[] = [
    { label: 'Experiment', value: naOr(sample.experiment) },
    { label: 'Experiment type', value: naOr(sample.experiment_type) },
    { label: 'Strain', value: naOr(sample.strain) },
    { label: 'Condition', value: naOr(sample.condition) },
    { label: 'Donor DNA', value: naOr(sample.donor_dna) },
    { label: 'Replicate', value: naOr(sample.replicate) },
    { label: 'Transfer', value: naOr(sample.transfer) },
    { label: 'Selection note', value: naOr(sample.selection_note) },
  ];

  const metricCards: { label: string; value: string }[] = [
    { label: 'Max OD (K)', value: fmtMetric(metrics.maxOD, 3) },
    { label: 'Growth rate mu', value: fmtMetric(metrics.muMax, 3, ' /h') },
    { label: 'Doubling time', value: fmtMetric(metrics.doublingTimeH, 2, ' h') },
    { label: 'Lag time', value: fmtMetric(metrics.lagTimeH, 2, ' h') },
    { label: 'AUC', value: fmtMetric(metrics.aucod, 2, ' OD*h') },
  ];
  const sampleMutationRows = useMemo(() => mutations
    .map(m => ({ mutation: m, value: m.values[sample.id], provided: !!m.providedIn?.includes(sample.id) }))
    .filter(r => (typeof r.value === 'number' && r.value > 0) || r.provided)
    .sort((a, b) => Number(b.provided) - Number(a.provided) || ((typeof b.value === 'number' ? b.value : 0) - (typeof a.value === 'number' ? a.value : 0)) || a.mutation.gene.localeCompare(b.mutation.gene)), [mutations, sample.id]);

  // Clicking the embedded sparkline chains to the full growth modal. Simplest:
  // close this modal, then open the growth one (the parent wires onOpenGrowth to
  // setGrowthCurveSample).
  const openGrowth = () => { onClose(); onOpenGrowth(sample); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sample-detail-title"
    >
      <div
        className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto scroll-smooth"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <FlaskConical className="w-4 h-4 text-[var(--accent-600)] shrink-0" />
              <span id="sample-detail-title" className="font-mono text-[18px] font-semibold text-[var(--text)] break-all">{sample.name}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.filter(c => c.value !== undefined && c.value !== null && c.value !== '').map(c => (
                <span key={c.label} className={cn('text-[10px] px-1.5 py-0.5 rounded border', c.cls ?? 'bg-[var(--surface-3)] border-[var(--border)] text-[var(--text-soft)]')}>
                  <span className="uppercase tracking-wide mr-1 opacity-70">{c.label}</span>
                  <span className="font-mono">{String(c.value)}</span>
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-soft)] hover:text-[var(--text)]"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Metadata grid */}
          <section>
            <div className="flex items-baseline gap-2 mb-2">
              <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-soft)]">Sample metadata</h4>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {metaRows.map(r => (
                <div key={r.label} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5">
                  <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">{r.label}</div>
                  <div className={cn('font-mono text-[12px] break-words', r.value === 'n/a' ? 'text-[var(--text-faint)] italic' : 'text-[var(--text)]')}>{r.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Growth */}
          <ModalSection title="Growth" hint={hasCurve ? 'OD600 vs time (h) - click chart to expand' : 'no numeric series in this dataset'}>
            {hasCurve ? (
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="shrink-0">
                  <GrowthCurveSparkline data={data} odSources={sample.od_sources} width={320} height={120} sample={sample} onExpand={() => openGrowth()} />
                  <div className="text-[10px] text-[var(--text-faint)] mt-1">Click to open the full interactive growth curve.</div>
                </div>
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                  {metricCards.map(c => (
                    <div key={c.label} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5">
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">{c.label}</div>
                      <div className="font-mono text-[13px] font-semibold text-[var(--text)] tabular-nums">{c.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-[var(--text-soft)] space-y-2">
                <div className="italic text-[var(--text-faint)]">numeric series not in this dataset</div>
                {sample.od_sources && sample.od_sources.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[var(--text-soft)]">OD measurement was tracked upstream in:</div>
                    <ul className="font-mono text-[11px] space-y-0.5">
                      {sample.od_sources.map((s, i) => (
                        <li key={i} className="text-[var(--text)]">
                          <span className="text-amber-700 dark:text-amber-300">{s.type.replace('OD_series_', '')}</span>: {s.source}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-[var(--text-faint)]">No OD source reference available either.</div>
                )}
              </div>
            )}
          </ModalSection>

          {/* Mutation load */}
          <ModalSection title="Mutation load" hint="distinct mutation calls detected in this sample">
            <div className="flex items-center gap-3">
              <span className={cn('inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 rounded font-mono text-[18px] font-semibold',
                allMutationCount > 0 ? 'lims-pill-mut' : 'bg-[var(--surface-3)] text-[var(--text-faint)]')}>
                {allMutationCount}
              </span>
              <span className="text-[12px] text-[var(--text-soft)]">
                {allMutationCount === 1 ? '1 mutation call in this sample' : `${allMutationCount} mutation calls in this sample`}
              </span>
            </div>
          </ModalSection>

          <ModalSection title="Sample mutations" hint="observed values plus provided donor-DNA rows for this sample">
            {sampleMutationRows.length === 0 ? (
              <div className="text-[12px] text-[var(--text-faint)] italic">No mutation rows are present for this sample in the loaded dataset.</div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded border border-[var(--border)]">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-soft)]">
                    <tr>
                      <th className="px-2 py-1 text-left">Mutation</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-right">Value</th>
                      <th className="px-2 py-1 text-right">Provided</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleMutationRows.slice(0, 80).map(r => (
                      <tr key={r.mutation.id} className="border-t border-[var(--border)]">
                        <td className="px-2 py-1 min-w-0">
                          <div className="font-mono text-[var(--text)] truncate">{r.mutation.gene} / {r.mutation.variant}</div>
                          {r.mutation.gene_product && <div className="text-[10px] text-[var(--text-faint)] truncate italic">{r.mutation.gene_product}</div>}
                        </td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{r.mutation.type}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{typeof r.value === 'number' ? formatMetric(r.value, r.mutation.metric) : '-'}</td>
                        <td className="px-2 py-1 text-right">{r.provided ? <span className="text-amber-600 dark:text-amber-400 font-semibold">yes</span> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sampleMutationRows.length > 80 && <div className="px-2 py-1 text-[10.5px] text-[var(--text-faint)] border-t border-[var(--border)]">Showing first 80 of {sampleMutationRows.length}. Use Comparative View for all rows.</div>}
              </div>
            )}
          </ModalSection>
        </div>
      </div>
    </div>
  );
}

/* ---- Genome-browser-style track ----------------------------------------
   Self-contained SVG. Draws (top to bottom): a coordinate AXIS with bp tick
   marks for a local window around the mutation, a directional GENE TRACK
   (arrow-shaped block respecting gene_strand; both flanking genes for
   intergenic calls), and a VARIANT TRACK (amber lollipop for a point SNP,
   shaded red span for an indel/deletion) aligned to the axis. Hover tooltips
   (native <title>) on the gene and variant elements. All geometry is computed
   from the memoized `geom` object so the component itself stays cheap. */
type GenomeGeom = {
  hasPos: boolean;
  isPoint: boolean;
  isIntergenic: boolean;
  windowStart: number;
  windowEnd: number;
  ticks: number[];
  scale: number;
  padX: number;
  innerW: number;
  markA: number;       // px of variant start
  markB: number;       // px of variant end
  strandRight: boolean;
  strandLeft: boolean;
  // intergenic flanking strands (left/right gene direction)
  leftStrandRight?: boolean;
  rightStrandRight?: boolean;
  geneName?: string;
  leftGene?: string;
  rightGene?: string;
};

function GenomeBrowserTrack({
  geom, seqId, posLabel, refSeq, newSeq, sizeStr,
}: {
  geom: GenomeGeom;
  seqId?: string;
  posLabel: string;
  refSeq?: string;
  newSeq?: string;
  sizeStr?: string;
}) {
  const W = 680, H = 168;
  const axisY = 36;
  const geneY = 74, geneH = 26;
  const varY = 128;
  const { padX, scale, windowStart, ticks, markA, markB, isPoint, isIntergenic } = geom;
  const variantIsSpan = !isPoint;
  const varColor = variantIsSpan ? 'fill-red-500' : 'fill-amber-500';
  const varStroke = variantIsSpan ? 'stroke-red-600' : 'stroke-amber-600';
  const x = (bp: number) => padX + (bp - windowStart) * scale;
  const changeText = `${refSeq && refSeq.length ? refSeq : '\u00B7'} \u2192 ${newSeq && newSeq.length ? newSeq : '\u00B7'}`;

  // Directional gene block as an arrow polygon (points the way of the strand).
  const geneArrow = (gx0: number, gx1: number, pointsRight: boolean, label?: string, key?: string) => {
    const tip = Math.min(12, Math.max(4, (gx1 - gx0) * 0.18));
    const top = geneY, bot = geneY + geneH;
    const pts = pointsRight
      ? `${gx0},${top} ${gx1 - tip},${top} ${gx1},${(top + bot) / 2} ${gx1 - tip},${bot} ${gx0},${bot}`
      : `${gx1},${top} ${gx0 + tip},${top} ${gx0},${(top + bot) / 2} ${gx0 + tip},${bot} ${gx1},${bot}`;
    const labelX = (gx0 + gx1) / 2;
    return (
      <g key={key}>
        <polygon points={pts} className="fill-blue-500/25 stroke-blue-500 dark:fill-blue-400/20 dark:stroke-blue-400" strokeWidth={1.5}>
          {label ? <title>{label} ({pointsRight ? "5' to 3' (+)" : "3' to 5' (-)"})</title> : null}
        </polygon>
        {label && (gx1 - gx0) > 46 ? (
          <text x={labelX} y={geneY + geneH / 2 + 4} textAnchor="middle" fontSize="11" className="fill-[var(--text)] font-mono pointer-events-none">{label}</text>
        ) : null}
      </g>
    );
  };

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block select-none" role="img"
           aria-label={`Genome browser track: ${posLabel} on ${seqId ?? 'unknown reference'}, ${changeText}`}>
        {/* reference / contig label */}
        <text x={padX} y={16} fontSize="11" className="fill-[var(--text-soft)] font-mono">
          {seqId ?? 'reference unknown'}
        </text>
        <text x={W - padX} y={16} textAnchor="end" fontSize="10" className="fill-[var(--text-faint)]">bp (reference coordinates)</text>

        {/* axis baseline */}
        <line x1={padX} y1={axisY} x2={W - padX} y2={axisY} className="stroke-[var(--border)]" strokeWidth={1} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + 5} className="stroke-[var(--text-faint)]" strokeWidth={1} />
            <text x={x(t)} y={axisY - 5} textAnchor="middle" fontSize="9" className="fill-[var(--text-faint)]">{Math.round(t).toLocaleString()}</text>
          </g>
        ))}

        {/* gene track */}
        <text x={padX} y={geneY - 6} fontSize="9" className="fill-[var(--text-faint)] uppercase tracking-wider">gene</text>
        {isIntergenic ? (
          <>
            {/* left flanking gene fills from window start to just before the variant */}
            {geneArrow(padX, Math.max(padX + 8, markA - 18), geom.leftStrandRight ?? true, geom.leftGene, 'lg')}
            {/* right flanking gene from just after the variant to window end */}
            {geneArrow(Math.min(W - padX - 8, markB + 18), W - padX, geom.rightStrandRight ?? true, geom.rightGene, 'rg')}
            {/* intergenic gap label */}
            <text x={(markA + markB) / 2} y={geneY + geneH + 14} textAnchor="middle" fontSize="9" className="fill-[var(--text-faint)]">intergenic</text>
          </>
        ) : (
          geneArrow(padX, W - padX, geom.strandRight || !geom.strandLeft, geom.geneName, 'g')
        )}

        {/* variant track */}
        <text x={padX} y={varY - 14} fontSize="9" className="fill-[var(--text-faint)] uppercase tracking-wider">variant</text>
        {/* connector from gene/axis down to variant */}
        {variantIsSpan ? (
          <>
            <rect x={Math.min(markA, markB)} y={geneY - 4} width={Math.max(3, Math.abs(markB - markA))} height={varY - geneY + 8}
                  className={cn(varColor, 'opacity-20')} />
            <rect x={Math.min(markA, markB)} y={varY - 6} width={Math.max(3, Math.abs(markB - markA))} height={12} rx={2}
                  className={cn(varColor, varStroke)} strokeWidth={1}>
              <title>{posLabel}{sizeStr ? ` (${sizeStr} bp)` : ''}: {changeText}</title>
            </rect>
            <text x={(markA + markB) / 2} y={varY + 22} textAnchor="middle" fontSize="10" className="fill-[var(--text)] font-mono">{changeText}</text>
          </>
        ) : (
          <>
            <line x1={markA} y1={geneY - 4} x2={markA} y2={varY} className={varStroke} strokeWidth={1.5} strokeDasharray="2 2" />
            <line x1={markA} y1={varY} x2={markA} y2={varY - 16} className={varStroke} strokeWidth={2} />
            <circle cx={markA} cy={varY - 20} r={6} className={cn(varColor, varStroke)} strokeWidth={1.5}>
              <title>{posLabel}: {changeText}</title>
            </circle>
            <text x={markA} y={varY + 18} textAnchor="middle" fontSize="10" className="fill-[var(--text)] font-mono">{changeText}</text>
          </>
        )}
      </svg>

      {/* legend */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[var(--text-soft)]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm border border-blue-500 bg-blue-500/25 dark:bg-blue-400/20" /> gene (arrow = strand)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> point SNP
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-red-500" /> indel / deletion span
        </span>
        <span className="text-[var(--text-faint)]">window {Math.round(geom.windowStart).toLocaleString()} to {Math.round(geom.windowEnd).toLocaleString()} bp</span>
      </div>
    </div>
  );
}

/* ---- Codon / amino-acid change visual ----------------------------------
   Shows the 3-base codon as boxes with the changed base(s) highlighted, then
   the amino acid before -> after with 3-letter names. Colored by effect:
   synonymous = slate, missense = amber, nonsense = red. */
function CodonChangeViz({
  codonRef, codonNew, aaRef, aaNew, aaPosition, snpType,
}: {
  codonRef?: string; codonNew?: string; aaRef?: string; aaNew?: string; aaPosition?: number; snpType?: string;
}) {
  const effect = aaEffect(aaRef, aaNew, snpType);
  const effClasses =
    effect === 'synonymous' ? 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
    : effect === 'nonsense' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
    : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
  const effLabel =
    effect === 'synonymous' ? 'synonymous (silent)'
    : effect === 'nonsense' ? 'nonsense (premature stop)'
    : effect === 'missense' ? 'missense (nonsynonymous)'
    : 'amino-acid change';

  const cr = (codonRef ?? '').toUpperCase();
  const cn0 = (codonNew ?? '').toUpperCase();
  const len = Math.max(cr.length, cn0.length, 0);
  const codonBox = (seq: string, otherSeq: string, role: 'ref' | 'new') => {
    if (!seq) return <span className="font-mono text-[13px] text-[var(--text-faint)]">codon n/a</span>;
    return (
      <div className="flex gap-1">
        {Array.from({ length: len }).map((_, i) => {
          const ch = seq[i] ?? '\u00B7';
          const changed = (seq[i] ?? '') !== (otherSeq[i] ?? '');
          const base = role === 'ref' ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800'
                                       : 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800';
          const hi = role === 'ref' ? 'bg-red-500 text-white border-red-600'
                                    : 'bg-emerald-500 text-white border-emerald-600';
          return (
            <span key={i} className={cn('w-7 h-8 grid place-items-center rounded border font-mono text-[15px] font-semibold', changed ? hi : base)}>
              {ch}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col items-center gap-1">
          {codonBox(cr, cn0, 'ref')}
          <span className="text-[10px] text-[var(--text-soft)]">codon (ref)</span>
        </div>
        <ArrowRight className="w-4 h-4 mb-3 text-[var(--text-soft)] shrink-0" />
        <div className="flex flex-col items-center gap-1">
          {codonBox(cn0, cr, 'new')}
          <span className="text-[10px] text-[var(--text-soft)]">codon (new)</span>
        </div>
      </div>

      {(aaRef || aaNew) && (
        <div className="flex items-center gap-2 flex-wrap text-[14px]">
          <span className="font-mono px-2 py-1 rounded bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">
            {aaThree(aaRef)} ({aaRef ?? '?'})
          </span>
          <ArrowRight className="w-4 h-4 text-[var(--text-soft)] shrink-0" />
          <span className="font-mono px-2 py-1 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">
            {aaThree(aaNew)} ({aaNew ?? '?'})
          </span>
          {typeof aaPosition === 'number' ? (
            <span className="text-[12px] text-[var(--text-soft)]">at residue <span className="font-mono text-[var(--text)]">{aaPosition}</span></span>
          ) : null}
        </div>
      )}
      <span className={cn('self-start text-[11px] px-1.5 py-0.5 rounded border font-medium', effClasses)}>{effLabel}</span>
    </div>
  );
}

/* ---- Indel / deletion schematic ----------------------------------------
   For small indels and large deletions: draws the reference bases with the
   deleted span struck through (red) or the inserted bases highlighted (green).
   Robust when only a size is known (no explicit ref/new sequence). */
function IndelSchematic({
  refSeq, newSeq, sizeStr, snpType,
}: { refSeq?: string; newSeq?: string; sizeStr?: string; snpType?: string }) {
  const r = refSeq ?? '';
  const n = newSeq ?? '';
  const isDeletion = r.length > n.length || (snpType ?? '').toLowerCase().includes('deletion');
  const isInsertion = n.length > r.length;
  const seqRow = (seq: string, role: 'del' | 'ins' | 'ref') => {
    if (!seq) return null;
    const cls =
      role === 'del' ? 'bg-red-100 text-red-700 border-red-300 line-through dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
      : role === 'ins' ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
      : 'bg-[var(--surface-3)] text-[var(--text)] border-[var(--border)]';
    return (
      <div className="flex flex-wrap gap-0.5">
        {seq.split('').map((c, i) => (
          <span key={i} className={cn('w-6 h-7 grid place-items-center rounded border font-mono text-[13px]', cls)}>{c}</span>
        ))}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      {r ? (
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-[var(--text-soft)]">reference</span>
          {seqRow(r, isDeletion ? 'del' : 'ref')}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[11px] text-[var(--text-soft)]">observed</span>
        {n ? seqRow(n, isInsertion ? 'ins' : 'ref') : <span className="font-mono text-[13px] text-[var(--text-faint)]">(bases removed)</span>}
      </div>
      <div className="text-[11.5px] text-[var(--text-soft)]">
        {isDeletion ? 'Deletion' : isInsertion ? 'Insertion' : 'Indel'}
        {sizeStr ? <> of <span className="font-mono text-[var(--text)]">{sizeStr}</span> bp</> : null}
        {' '}(reference bases struck through were removed; highlighted bases were inserted).
      </div>
    </div>
  );
}

/* ---- Repeat expansion / contraction schematic --------------------------
   Draws the repeat unit as a row of blocks for ref copies vs new copies so
   expansion/contraction is visible at a glance. */
function RepeatSchematic({
  unit, refCopies, newCopies,
}: { unit?: string; refCopies?: number; newCopies?: number }) {
  const rc = typeof refCopies === 'number' ? refCopies : undefined;
  const nc = typeof newCopies === 'number' ? newCopies : undefined;
  const cap = 24; // never render more than this many blocks per row
  const row = (count: number | undefined, role: 'ref' | 'new') => {
    if (count === undefined) return <span className="font-mono text-[12px] text-[var(--text-faint)]">?</span>;
    const shown = Math.min(count, cap);
    const cls = role === 'ref'
      ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
      : 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700';
    return (
      <div className="flex items-center gap-0.5 flex-wrap">
        {Array.from({ length: shown }).map((_, i) => (
          <span key={i} className={cn('h-6 px-1 grid place-items-center rounded-sm border font-mono text-[11px]', cls)}>
            {unit ?? '\u25A0'}
          </span>
        ))}
        {count > cap ? <span className="text-[11px] text-[var(--text-soft)]">+{count - cap} more</span> : null}
      </div>
    );
  };
  const delta = (rc !== undefined && nc !== undefined) ? nc - rc : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[11px] text-[var(--text-soft)]">ref ({rc ?? '?'}x)</span>
        {row(rc, 'ref')}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[11px] text-[var(--text-soft)]">new ({nc ?? '?'}x)</span>
        {row(nc, 'new')}
      </div>
      <div className="text-[11.5px] text-[var(--text-soft)]">
        {unit ? <>Repeat unit <span className="font-mono text-[var(--text)]">{unit}</span>. </> : null}
        {delta !== undefined ? (delta > 0 ? `Expansion of +${delta} copies.` : delta < 0 ? `Contraction of ${delta} copies.` : 'No copy-number change.') : 'Copy-number change.'}
      </div>
    </div>
  );
}

/* ---- Protein / gene-length position schematic --------------------------
   A horizontal gene-length bar with the mutated residue/nt marked, so the user
   can see WHERE in the protein/gene the change falls. Uses parsed gene_position
   (nt span + total length). Falls back gracefully when length is unknown. */
function ProteinSchematic({ info, aaPosition }: { info: GenePosInfo; aaPosition?: number }) {
  const W = 680, H = 52, padX = 28, barY = 18, barH = 16;
  const innerW = W - 2 * padX;
  const length = info.ntLength;
  const hasLength = typeof length === 'number' && length > 0;
  const start = info.ntStart ?? (typeof aaPosition === 'number' ? aaPosition * 3 - 2 : undefined);
  const end = info.ntEnd ?? start;
  if (!hasLength || start === undefined || end === undefined) {
    return (
      <div className="text-[12px] text-[var(--text-soft)]">
        {info.raw ? <>Gene position: <span className="font-mono text-[var(--text)]">{info.raw}</span>{!hasLength ? ' (gene length unknown, no scaled schematic)' : ''}</> : 'Gene length not available.'}
      </div>
    );
  }
  const scale = innerW / length;
  const mx0 = padX + (Math.max(1, start) - 1) * scale;
  const mx1 = padX + Math.min(length, end) * scale;
  const aaTotal = Math.round(length / 3);
  const aaPos = typeof aaPosition === 'number' ? aaPosition : Math.ceil(start / 3);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block select-none" role="img"
           aria-label={`Protein position: residue ${aaPos} of ${aaTotal}`}>
        <rect x={padX} y={barY} width={innerW} height={barH} rx={3}
              className="fill-blue-500/15 stroke-blue-500/60 dark:fill-blue-400/10 dark:stroke-blue-400/50" strokeWidth={1} />
        {/* mutation marker */}
        <rect x={mx0} y={barY - 3} width={Math.max(3, mx1 - mx0)} height={barH + 6} rx={2} className="fill-amber-500 stroke-amber-600" strokeWidth={1}>
          <title>residue {aaPos} of {aaTotal}</title>
        </rect>
        {/* end labels */}
        <text x={padX} y={barY - 4} fontSize="9" textAnchor="start" className="fill-[var(--text-faint)]">N-term (1)</text>
        <text x={W - padX} y={barY - 4} fontSize="9" textAnchor="end" className="fill-[var(--text-faint)]">{aaTotal} aa (C-term)</text>
        <text x={Math.min(W - padX, Math.max(padX, (mx0 + mx1) / 2))} y={barY + barH + 14} fontSize="10" textAnchor="middle" className="fill-[var(--text)]">
          residue {aaPos}
        </text>
      </svg>
    </div>
  );
}

const PROJECT_ORGANISM_NCBI_QUERY = 'Acinetobacter baylyi';

function ncbiSearchUrl(query: string): string {
  return `https://www.ncbi.nlm.nih.gov/search/all/?term=${encodeURIComponent(query)}`;
}

function ncbiNucleotideUrl(seqId: string): string {
  return `https://www.ncbi.nlm.nih.gov/nuccore/${encodeURIComponent(seqId)}`;
}

function looksLikeNcbiAccession(seqId?: string): boolean {
  if (!seqId) return false;
  return /^[A-Z]{1,2}_?\d{5,}(\.\d+)?$/.test(seqId.trim());
}

function mutationNcbiQuery(mutation: MutationRow, d: MutationDetail, posLabel: string): string {
  return [
    d.locus_tag,
    mutation.gene,
    mutation.gene_product,
    d.seq_id,
    posLabel !== 'n/a' ? posLabel : undefined,
    PROJECT_ORGANISM_NCBI_QUERY,
  ].filter(Boolean).join(' ');
}

function ExternalAction({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[11px] text-[var(--text)]"
      title={title}
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  );
}

function MutationDetailModal({
  mutation, samples, groupOrder, onClose,
}: {
  mutation: MutationRow;
  samples: MutationSample[];
  groupOrder: GroupLevelKey[];
  onClose: () => void;
}) {
  const d = useMemo(() => mutation.detail ?? {}, [mutation.detail]);
  const snpType = mutation.snp_type ?? mutation.type;

  // Close on Esc. Listener is added once per open modal; cheap and responsive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [showAllFields, setShowAllFields] = useState(false);

  // ---- Memoized derived facts (cheap, but keep them stable across renders). ----
  const facts = useMemo(() => {
    const posStart = typeof d.position_start === 'number' ? d.position_start : (typeof mutation.position === 'number' ? mutation.position : undefined);
    const posEnd = typeof d.position_end === 'number' ? d.position_end : posStart;
    const hasPos = posStart !== undefined;
    const isPoint = posStart !== undefined && posEnd !== undefined && posStart === posEnd;
    const gp = parseGenePosition(d.gene_position);
    const isIntergenic = gp.kind === 'intergenic'
      || (mutation.gene ?? '').includes('/')
      || (snpType ?? '').toLowerCase() === 'intergenic';
    const hasCodon = !!((d.codon_ref_seq && d.codon_ref_seq.length > 0) || (d.codon_new_seq && d.codon_new_seq.length > 0));
    const hasAA = !!((d.aa_ref_seq && d.aa_ref_seq.length > 0) || (d.aa_new_seq && d.aa_new_seq.length > 0));
    const isCoding = (hasCodon || hasAA) && !isIntergenic;
    const t = (snpType ?? '').toLowerCase();
    const sizeStr = typeof d.size === 'string' ? d.size.replace(/\.0$/, '') : (d.size != null ? String(d.size) : undefined);
    const isIndel = t.includes('indel') || t.includes('deletion') || t.includes('insertion')
      || (!isPoint && hasPos)
      || (typeof d.repeat_ref_copies === 'number' && typeof d.repeat_new_copies === 'number');
    const hasRepeat = !!(d.repeat_seq || typeof d.repeat_ref_copies === 'number' || typeof d.repeat_new_copies === 'number');
    const posLabel = hasPos
      ? (isPoint ? `${posStart!.toLocaleString()}` : `${posStart!.toLocaleString()} to ${posEnd!.toLocaleString()}`)
      : 'n/a';
    return { posStart, posEnd, hasPos, isPoint, gp, isIntergenic, hasCodon, hasAA, isCoding, sizeStr, isIndel, hasRepeat, posLabel };
  }, [d, mutation.position, mutation.gene, snpType]);

  const { posStart, posEnd, hasPos, isPoint, gp, isIntergenic, isCoding, sizeStr, isIndel, hasRepeat, posLabel } = facts;
  const ncbiQuery = useMemo(() => mutationNcbiQuery(mutation, d, posLabel), [mutation, d, posLabel]);
  const seqIdForLink = d.seq_id;
  const ncbiAccessionHref = looksLikeNcbiAccession(seqIdForLink) && seqIdForLink ? ncbiNucleotideUrl(seqIdForLink) : null;
  const ncbiSearchHref = ncbiSearchUrl(ncbiQuery || `${mutation.gene} ${mutation.variant}`);
  const breseqContextHref = 'https://github.com/barricklab/breseq';

  // ---- Memoized genome-browser geometry (the heaviest derived object). ----
  const geom = useMemo<GenomeGeom>(() => {
    const padX = 28, W = 680;
    const innerW = W - 2 * padX;
    if (posStart === undefined || posEnd === undefined) {
      return {
        hasPos: false, isPoint: false, isIntergenic, windowStart: 0, windowEnd: 1,
        ticks: [], scale: 1, padX, innerW, markA: padX, markB: padX,
        strandRight: false, strandLeft: false,
      };
    }
    const span = Math.max(0, posEnd - posStart);
    // Window scales with feature size: +/- ~60 bp for a point, a few x the span for indels.
    const pad = isPoint ? 60 : Math.max(span * 2, 40);
    const windowStart = posStart - pad;
    const windowEnd = posEnd + pad;
    const scale = innerW / Math.max(1, windowEnd - windowStart);
    const markA = padX + (posStart - windowStart) * scale;
    const markB = padX + (posEnd - windowStart) * scale;

    // Nice-ish tick marks: aim for ~6 ticks at a rounded step.
    const rangeBp = windowEnd - windowStart;
    const rawStep = rangeBp / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
    const norm = rawStep / mag;
    const niceMul = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    const step = Math.max(1, niceMul * mag);
    const ticks: number[] = [];
    const first = Math.ceil(windowStart / step) * step;
    for (let t = first; t <= windowEnd && ticks.length < 12; t += step) ticks.push(t);

    // Strand parsing. For intergenic ("></<" etc) split into left/right.
    const gs = d.gene_strand ?? '';
    const strandRight = gs.includes('>') && !gs.includes('<');
    const strandLeft = gs.includes('<') && !gs.includes('>');
    let leftStrandRight: boolean | undefined;
    let rightStrandRight: boolean | undefined;
    if (gs.includes('/')) {
      const [l, r] = gs.split('/');
      leftStrandRight = (l ?? '').includes('>');
      rightStrandRight = (r ?? '').includes('>');
    }
    const geneParts = (mutation.gene ?? '').split('/');
    const leftGene = geneParts[0]?.trim() || undefined;
    const rightGene = geneParts[1]?.trim() || undefined;

    return {
      hasPos: true, isPoint, isIntergenic, windowStart, windowEnd, ticks, scale, padX, innerW,
      markA, markB, strandRight, strandLeft, leftStrandRight, rightStrandRight,
      geneName: isIntergenic ? undefined : (mutation.gene ?? d.locus_tag),
      leftGene, rightGene,
    };
  }, [posStart, posEnd, isPoint, isIntergenic, d.gene_strand, d.locus_tag, mutation.gene]);

  // Per-sample frequency, grouped by the first outer grouping level used in the
  // table so the user sees a familiar layout. Single pass over samples (O(n)).
  const grouped = useMemo(() => {
    const order = groupOrder.length > 0 ? [groupOrder[0]] : [];
    const byKey = new Map<string, { label: string; samples: MutationSample[] }>();
    for (const s of samples) {
      const label = order.length > 0 ? (groupValue(s, order[0]) || '(none)') : 'All samples';
      let entry = byKey.get(label);
      if (!entry) { entry = { label, samples: [] }; byKey.set(label, entry); }
      entry.samples.push(s);
    }
    return [...byKey.values()];
  }, [samples, groupOrder]);

  const maxFreq = useMemo(() => {
    let mx = 0;
    for (const s of samples) {
      const v = mutation.values[s.id];
      if (typeof v === 'number' && v > mx) mx = v;
    }
    return mx;
  }, [samples, mutation.values]);

  // All raw detail fields for the collapsible "all fields" section (memoized).
  const rawFields = useMemo<[string, string][]>(() => {
    const out: [string, string][] = [];
    const push = (k: string, v: unknown) => {
      if (v === undefined || v === null || v === '') return;
      out.push([k, String(v)]);
    };
    push('id', mutation.id);
    push('gene', mutation.gene);
    push('variant', mutation.variant);
    push('type', mutation.type);
    push('metric', mutation.metric);
    push('snp_type', mutation.snp_type);
    push('mutation_category', mutation.mutation_category);
    push('base_type', mutation.base_type);
    push('gene_product', mutation.gene_product);
    push('seq_id', d.seq_id);
    push('position_start', d.position_start);
    push('position_end', d.position_end);
    push('ref_seq', d.ref_seq);
    push('new_seq', d.new_seq);
    push('gene_strand', d.gene_strand);
    push('gene_position', d.gene_position);
    push('locus_tag', d.locus_tag);
    push('aa_ref_seq', d.aa_ref_seq);
    push('aa_new_seq', d.aa_new_seq);
    push('aa_position', d.aa_position);
    push('codon_ref_seq', d.codon_ref_seq);
    push('codon_new_seq', d.codon_new_seq);
    push('codon_number', d.codon_number);
    push('size', d.size);
    push('repeat_seq', d.repeat_seq);
    push('repeat_ref_copies', d.repeat_ref_copies);
    push('repeat_new_copies', d.repeat_new_copies);
    push('genes_inactivated', d.genes_inactivated);
    push('genes_overlapping', d.genes_overlapping);
    push('genes_promoter', d.genes_promoter);
    return out;
  }, [mutation, d]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto scroll-smooth"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[18px] font-semibold text-[var(--text)] break-all">{mutation.gene}</span>
              {mutation.variant ? (
                <span className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-soft)] border border-[var(--border)]">{mutation.variant}</span>
              ) : null}
              <span className={cn('text-[11px] px-1.5 py-0.5 rounded border font-medium', snpTypeBadgeClass(snpType))}>{snpType || 'unknown'}</span>
            </div>
            {mutation.gene_product ? (
              <div className="text-[12px] italic text-[var(--text-soft)] mt-1 truncate">{mutation.gene_product}</div>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-soft)] hover:text-[var(--text)]"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <ModalSection title="Reference context" hint="external links are generated from fields in this mutation row">
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
                <div><span className="text-[var(--text-soft)]">Reference seq_id</span> <span className="font-mono text-[var(--text)] break-all">{d.seq_id ?? 'n/a'}</span></div>
                <div><span className="text-[var(--text-soft)]">Coordinate</span> <span className="font-mono text-[var(--text)]">{posLabel}</span></div>
                <div><span className="text-[var(--text-soft)]">Gene</span> <span className="font-mono text-[var(--text)] break-all">{mutation.gene || 'n/a'}</span></div>
                <div><span className="text-[var(--text-soft)]">Locus tag</span> <span className="font-mono text-[var(--text)] break-all">{d.locus_tag ?? 'n/a'}</span></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ncbiAccessionHref && (
                  <ExternalAction href={ncbiAccessionHref} label="NCBI nucleotide" title={`Open ${d.seq_id} in NCBI Nucleotide`} />
                )}
                <ExternalAction href={ncbiSearchHref} label="NCBI search" title={`Search NCBI for: ${ncbiQuery}`} />
                <ExternalAction href={breseqContextHref} label="breseq docs" title="Open breseq documentation. This dataset does not expose per-run breseq report URLs in the mutation popup yet." />
              </div>
              <div className="text-[11px] text-[var(--text-faint)] leading-relaxed">
                NCBI links are conservative: a direct nucleotide link is shown only when <span className="font-mono">seq_id</span> looks like an accession; otherwise use the search link with gene, locus, product, reference, and coordinate context. The breseq button is documentation/context, not a run-specific report link, because no report URL is exposed in this curated API payload.
              </div>
            </div>
          </ModalSection>

          {/* Genome browser track (centerpiece) */}
          <ModalSection
            title="Genome browser"
            hint={d.seq_id ? `reference ${d.seq_id}` : 'reference unknown'}
          >
            {hasPos ? (
              <GenomeBrowserTrack
                geom={geom}
                seqId={d.seq_id}
                posLabel={posLabel}
                refSeq={d.ref_seq}
                newSeq={d.new_seq}
                sizeStr={sizeStr}

              />
            ) : (
              <div className="text-[12px] text-[var(--text-faint)]">Position not available for this call, so the genome track cannot be drawn.</div>
            )}
            <div className="mt-2 text-[12px] text-[var(--text-soft)] flex flex-wrap gap-x-4 gap-y-1">
              <span>Coordinate: <span className="font-mono text-[var(--text)]">{posLabel}</span></span>
              <span>Reference (seq_id): <span className="font-mono text-[var(--text)]">{d.seq_id ?? 'n/a'}</span></span>
              {sizeStr ? <span>Size: <span className="font-mono text-[var(--text)]">{sizeStr} bp</span></span> : null}
              <span className="text-[var(--text-faint)]">{isIntergenic ? 'intergenic' : isPoint ? 'point mutation' : 'spans a range'}</span>
            </div>
          </ModalSection>

          {/* Sequence change */}
          <ModalSection title="Sequence change" hint={d.seq_id ? `ref ${d.seq_id}` : undefined}>
            {isIndel && (d.ref_seq || d.new_seq || sizeStr) ? (
              <IndelSchematic refSeq={d.ref_seq} newSeq={d.new_seq} sizeStr={sizeStr} snpType={snpType} />
            ) : (d.ref_seq || d.new_seq) ? (
              <ChangeBlocks from={d.ref_seq} to={d.new_seq} fromLabel="reference" toLabel="observed" />
            ) : (
              <div className="text-[12px] text-[var(--text-faint)]">No base-level ref/new sequence recorded for this call.</div>
            )}
            {hasRepeat && (
              <div className="mt-3">
                <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-soft)] mb-1.5">Tandem repeat</div>
                <RepeatSchematic unit={d.repeat_seq} refCopies={d.repeat_ref_copies} newCopies={d.repeat_new_copies} />
              </div>
            )}
          </ModalSection>

          {/* Protein / codon change */}
          {isCoding ? (
            <ModalSection title="Protein change" hint={typeof d.codon_number === 'number' ? `codon ${d.codon_number}` : undefined}>
              <CodonChangeViz
                codonRef={d.codon_ref_seq}
                codonNew={d.codon_new_seq}
                aaRef={d.aa_ref_seq}
                aaNew={d.aa_new_seq}
                aaPosition={d.aa_position}
                snpType={snpType}
              />
              {(gp.kind === 'coding' || gp.kind === 'pseudogene' || gp.kind === 'plain' || typeof d.aa_position === 'number') && (
                <div className="mt-3">
                  <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-soft)] mb-1.5">Position in protein</div>
                  <ProteinSchematic info={gp} aaPosition={d.aa_position} />
                </div>
              )}
            </ModalSection>
          ) : (
            <ModalSection title="Protein change">
              <div className="text-[12px] text-[var(--text-faint)]">
                {isIntergenic ? 'Intergenic: between genes, no codon or amino-acid change.' : 'Non-coding: no codon or amino-acid change.'}
              </div>
            </ModalSection>
          )}

          {/* Gene context */}
          <ModalSection title="Gene context">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
              {d.locus_tag ? (<><dt className="text-[var(--text-soft)]">Locus tag</dt><dd className="font-mono text-[var(--text)] sm:text-right break-all">{d.locus_tag}</dd></>) : null}
              {d.gene_position ? (<><dt className="text-[var(--text-soft)]">Gene position</dt><dd className="font-mono text-[var(--text)] sm:text-right break-all">{d.gene_position}</dd></>) : null}
              {d.gene_strand ? (<><dt className="text-[var(--text-soft)]">Strand</dt><dd className="font-mono text-[var(--text)] sm:text-right">{d.gene_strand}{geom.strandRight ? ' (+ / forward)' : geom.strandLeft ? ' (- / reverse)' : ''}</dd></>) : null}
              {gp.kind === 'intergenic' && (typeof gp.upstream === 'number' || typeof gp.downstream === 'number') ? (
                <><dt className="text-[var(--text-soft)]">Flanking distance</dt><dd className="font-mono text-[var(--text)] sm:text-right">{gp.upstream} / {gp.downstream} bp</dd></>
              ) : null}
              {d.genes_inactivated ? (<><dt className="text-[var(--text-soft)]">Genes inactivated</dt><dd className="font-mono text-[var(--text)] sm:text-right break-all">{d.genes_inactivated}</dd></>) : null}
              {d.genes_overlapping ? (<><dt className="text-[var(--text-soft)]">Genes overlapping</dt><dd className="font-mono text-[var(--text)] sm:text-right break-all">{d.genes_overlapping}</dd></>) : null}
              {d.genes_promoter ? (<><dt className="text-[var(--text-soft)]">Promoter genes</dt><dd className="font-mono text-[var(--text)] sm:text-right break-all">{d.genes_promoter}</dd></>) : null}
            </dl>
            {!d.locus_tag && !d.gene_position && !d.gene_strand && !d.genes_inactivated && !d.genes_overlapping && !d.genes_promoter && (
              <div className="text-[12px] text-[var(--text-faint)]">No additional gene context recorded.</div>
            )}
          </ModalSection>

          {/* Per-sample frequency */}
          <ModalSection
            title={mutation.metric === 'copy_number' ? 'Per-sample copy number' : 'Per-sample frequency'}
            hint={`${samples.length} sample${samples.length === 1 ? '' : 's'} in view`}
          >
            <div className="text-[11px] text-[var(--text-faint)] mb-2 flex items-center gap-1.5">
              <Info className="w-3 h-3 shrink-0" />
              <span>
                Different sample groups may be called against different reference genomes; this mutation&apos;s coordinate
                {d.seq_id ? <> sits on <span className="font-mono">{d.seq_id}</span></> : ' has no recorded reference'}.
                A dash means no call in that sample (absent), distinct from a 0% value.
              </span>
            </div>
            <div className="space-y-3">
              {grouped.map(g => (
                <div key={g.label}>
                  {grouped.length > 1 && (
                    <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-soft)] mb-1">{g.label}</div>
                  )}
                  <div className="space-y-1">
                    {g.samples.map(s => {
                      const v = mutation.values[s.id];
                      const has = typeof v === 'number' && !Number.isNaN(v);
                      const pct = has ? (mutation.metric === 'frequency' ? Math.max(0, Math.min(1, v)) : (maxFreq > 0 ? v / maxFreq : 0)) : 0;
                      // PROVIDED in donor DNA for this sample (Henry).
                      const provided = !!mutation.providedIn && mutation.providedIn.includes(s.id);
                      const providedUnobserved = provided && (!has || v === 0);
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className="w-40 shrink-0 truncate font-mono text-[11px] text-[var(--text)] flex items-center gap-1" title={provided ? `${s.name}\nProvided as donor DNA (${s.donor_dna || 'donor'})` : s.name}>
                            {provided && <span className="shrink-0 px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[8.5px] font-bold uppercase ring-1 ring-amber-400/60" title="provided as donor DNA in this sample">prov</span>}
                            <span className="truncate">{s.name}</span>
                          </div>
                          <div className={cn('flex-1 h-4 rounded bg-[var(--surface-3)] overflow-hidden relative', provided && 'ring-2 ring-amber-500/70 ring-inset')}>
                            {has && v > 0 && (
                              <div
                                className={cn('h-full rounded', mutation.metric === 'copy_number' ? 'bg-emerald-500' : 'bg-blue-500')}
                                style={{ width: `${Math.round(pct * 100)}%` }}
                              />
                            )}
                          </div>
                          <div className="w-20 shrink-0 text-right tabular-nums text-[11px] text-[var(--text)]">
                            {has ? formatMetric(v, mutation.metric) : (providedUnobserved ? <span className="text-amber-600 dark:text-amber-400" title="provided but not observed">0% prov.</span> : <span className="text-[var(--text-faint)]">- absent</span>)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ModalSection>

          {/* All fields (collapsible) */}
          <ModalSection title="All fields">
            <button
              onClick={() => setShowAllFields(v => !v)}
              className="flex items-center gap-1 text-[12px] text-[var(--text-soft)] hover:text-[var(--text)]"
            >
              {showAllFields ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {showAllFields ? 'Hide raw fields' : `Show all ${rawFields.length} raw fields`}
            </button>
            {showAllFields && (
              <table className="mt-2 w-full text-[11.5px] border-collapse">
                <tbody>
                  {rawFields.map(([k, v]) => (
                    <tr key={k} className="border-b border-[var(--border)]">
                      <td className="py-1 pr-3 align-top text-[var(--text-soft)] font-mono whitespace-nowrap">{k}</td>
                      <td className="py-1 align-top font-mono text-[var(--text)] break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ModalSection>
        </div>
      </div>
    </div>
  );
}

function SortChip({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors',
        active
          ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
          : 'border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300'
      )}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

/* ---------------- Dataset summary pill ---------------- */

function StatPill({ label, value, accent }: { label: string; value: number; accent?: 'mut' | 'grow' | 'cn' }) {
  const tone =
    accent === 'cn' ? 'lims-pill-cn'
      : accent === 'grow' ? 'lims-pill-grow'
        : accent === 'mut' ? 'lims-pill-mut'
          : 'bg-[var(--surface-3)] text-[var(--text-soft)]';
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10.5px] font-semibold tabular-nums', tone)}>
        {value.toLocaleString()}
      </span>
      <span className="text-[var(--text-soft)]">{label}</span>
    </span>
  );
}

/* ---------------- Copy Number panel ----------------
   Dedicated view for copy-number data (the dgoA amplification story Natasha asked
   for). Copy-number MutationRows from the API carry metric === 'copy_number' and a
   values map keyed by seq-sample id. We pivot those into per-lineage trends across
   transfers so the amplification timecourse is visible at a glance. */

// Strip the trailing ".T<n>.<selection>" so replicate timepoints collapse to one lineage.
function lineageOf(name: string): string {
  return name.replace(/\.T-?\d+(\.[A-Za-z0-9]+)?$/i, '').replace(/\.contam$/i, '') || name;
}

const CN_LINE_COLORS = [
  '#059669', '#2563eb', '#d97706', '#7c3aed', '#dc2626',
  '#0891b2', '#db2777', '#65a30d', '#475569', '#c026d3',
];

function CopyNumberPanel({
  samples, mutations, loading, cnRegionCount, onCompareCN, onPickSamples,
  currentExperiment, availableExperiments, onLoadExperiment,
}: {
  samples: MutationSample[];
  mutations: MutationRow[];
  loading: boolean;
  cnRegionCount: number;
  onCompareCN: () => void;
  onPickSamples: () => void;
  currentExperiment: string;
  availableExperiments: string[];
  onLoadExperiment: (next: string) => void;
}) {
  const cnRows = useMemo(() => mutations.filter(m => m.metric === 'copy_number'), [mutations]);
  const [region, setRegion] = useState<string>('');
  const [logScale, setLogScale] = useState(false);
  const [showPoints, setShowPoints] = useState(true);

  // Default the region selector to the first CN row once data arrives.
  useEffect(() => {
    if (cnRows.length > 0 && !cnRows.some(r => r.id === region)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Selects a valid region after external data changes.
      setRegion(cnRows[0].id);
    }
  }, [cnRows, region]);

  const sampleById = useMemo(() => new Map(samples.map(s => [s.id, s])), [samples]);
  const activeRow = useMemo(() => cnRows.find(r => r.id === region) ?? cnRows[0], [cnRows, region]);

  // Build per-lineage series: [{ lineage, points: [{transfer, value, name}], color }]
  const series = useMemo(() => {
    if (!activeRow) return [];
    const byLineage = new Map<string, { transfer: number; value: number; name: string }[]>();
    for (const [sid, value] of Object.entries(activeRow.values)) {
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      const s = sampleById.get(sid);
      const lineage = lineageOf(s?.name ?? sid);
      const transfer = typeof s?.transfer === 'number' ? s.transfer : NaN;
      if (!byLineage.has(lineage)) byLineage.set(lineage, []);
      byLineage.get(lineage)!.push({ transfer, value, name: s?.name ?? sid });
    }
    const out = [...byLineage.entries()]
      .map(([lineage, pts]) => ({
        lineage,
        points: pts.sort((a, b) => {
          if (Number.isNaN(a.transfer) && Number.isNaN(b.transfer)) return a.name.localeCompare(b.name);
          if (Number.isNaN(a.transfer)) return 1;
          if (Number.isNaN(b.transfer)) return -1;
          return a.transfer - b.transfer;
        }),
      }))
      .sort((a, b) => a.lineage.localeCompare(b.lineage));
    return out.map((s, i) => ({ ...s, color: CN_LINE_COLORS[i % CN_LINE_COLORS.length] }));
  }, [activeRow, sampleById]);

  const allValues = useMemo(() => series.flatMap(s => s.points.map(p => p.value)), [series]);
  const hasTransfers = useMemo(() => series.some(s => s.points.some(p => !Number.isNaN(p.transfer))), [series]);

  const summary = useMemo(() => {
    if (allValues.length === 0) return null;
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    return { min, max, mean, n: allValues.length, lineages: series.length };
  }, [allValues, series.length]);

  const exportCsv = () => {
    if (!activeRow) return;
    const rows: string[][] = [['region', 'lineage', 'sample', 'transfer', 'copy_number']];
    for (const s of series) {
      for (const p of s.points) {
        rows.push([activeRow.gene, s.lineage, p.name, Number.isNaN(p.transfer) ? '' : String(p.transfer), p.value.toFixed(3)]);
      }
    }
    const csv = rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `copy-number-${activeRow.gene}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading && cnRows.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-gray-500 text-sm">Loading copy-number data…</div>;
  }

  if (cnRegionCount === 0 || cnRows.length === 0) {
    // Copy numbers only exist for certain experiments (the dgoA* amplification
    // series lives in TFMN1 / TFMN4). The default "all experiments" view resolves
    // to a breseq registry whose sample set excludes them, so offer a one-click
    // jump to an experiment that actually carries copy-number data.
    const CN_EXPERIMENTS = ['TFMN1', 'TFMN4'];
    const loadable = CN_EXPERIMENTS.filter(e => availableExperiments.includes(e));
    const target = loadable[0] ?? 'TFMN1';
    const onCnExperiment = CN_EXPERIMENTS.includes(currentExperiment);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-[var(--text-soft)] text-sm">
        <Dna className="w-10 h-10 text-[var(--data-cn)]" />
        <p className="max-w-md">
          {onCnExperiment
            ? <>No copy-number rows came back for <span className="lims-id">{currentExperiment}</span> in the current registry. The <span className="lims-id">Copy_numbers</span> table may not cover the selected samples.</>
            : <>No copy-number data in the current view. Copy numbers (the <span className="lims-id">dgoA*</span> amplification series) are recorded per sequenced sample in the <span className="lims-id">Copy_numbers</span> table and only exist in the <span className="font-semibold text-[var(--text)]">TFMN1</span> and <span className="font-semibold text-[var(--text)]">TFMN4</span> experiments.</>}
        </p>
        <div className="flex items-center gap-2">
          {!onCnExperiment && (
            <button onClick={() => onLoadExperiment(target)} className="lims-btn lims-btn-primary">
              Load {target} copy numbers
            </button>
          )}
          <button onClick={onPickSamples} className="lims-btn lims-btn-ghost">
            Go to Sample Selection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2"><ViewInfo title="Copy Number" description="Trace per-lineage copy-number measurements across transfers for a selected genomic region." detail="Only snapshot-present regions and measurements appear." /></div>
      {/* Controls */}
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2 flex-wrap">
        <label className="text-[11.5px] text-[var(--text-soft)] flex items-center gap-1.5">
          Region
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="lims-select"
          >
            {cnRows.map(r => (
              <option key={r.id} value={r.id}>{r.gene}{r.gene_product ? `: ${r.gene_product}` : ''}</option>
            ))}
          </select>
        </label>
        <div className="text-[11px] text-[var(--text-faint)] tabular-nums">
          {series.length} lineage{series.length === 1 ? '' : 's'} · {allValues.length} measurements
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLogScale(v => !v)}
            data-on={logScale}
            className="lims-toolbtn"
            title="Toggle logarithmic copy-number axis (useful when amplification spans an order of magnitude)"
          >
            log Y
          </button>
          <button
            type="button"
            onClick={() => setShowPoints(v => !v)}
            data-on={showPoints}
            className="lims-toolbtn"
            title="Show / hide individual measurement points"
          >
            points
          </button>
          <button
            onClick={onCompareCN}
            className="lims-toolbtn"
            title="Open the Comparative table filtered to copy-number rows"
          >
            <GitCompare className="w-3 h-3" /> Compare
          </button>
          <button
            onClick={exportCsv}
            className="lims-toolbtn"
            title="Export this region's copy numbers as CSV"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-2 flex-wrap text-[11px]">
          <SummaryCard label="region" value={activeRow?.gene ?? ''} mono />
          <SummaryCard label="min CN" value={summary.min.toFixed(2)} />
          <SummaryCard label="mean CN" value={summary.mean.toFixed(2)} />
          <SummaryCard label="max CN" value={summary.max.toFixed(2)} accent />
          <SummaryCard label="lineages" value={String(summary.lineages)} />
          <SummaryCard label="measurements" value={String(summary.n)} />
        </div>
      )}

      {/* Trend chart */}
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        {series.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-faint)] text-sm">No measurements for this region.</div>
        ) : (
          <CopyNumberChart
            series={series}
            hasTransfers={hasTransfers}
            regionLabel={activeRow?.gene ?? ''}
            logScale={logScale}
            showPoints={showPoints}
          />
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div
      className="flex flex-col px-2.5 py-1 rounded border"
      style={accent
        ? { borderColor: 'var(--data-cn)', background: 'var(--data-cn-bg)' }
        : { borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      <span
        className={cn('text-[13px] font-semibold tabular-nums', mono && 'font-mono')}
        style={{ color: accent ? 'var(--data-cn)' : 'var(--text)' }}
      >{value}</span>
    </div>
  );
}

// Responsive-ish SVG line chart: copy number (y) vs transfer (x). When transfers
// aren't available we fall back to ordinal index so the series still renders.
function CopyNumberChart({
  series, hasTransfers, regionLabel, logScale = false, showPoints = true,
}: {
  series: { lineage: string; color: string; points: { transfer: number; value: number; name: string }[] }[];
  hasTransfers: boolean;
  regionLabel: string;
  logScale?: boolean;
  showPoints?: boolean;
}) {
  const W = 760, H = 380, padL = 52, padR = 18, padT = 16, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Click a legend entry to ISOLATE it (show only that lineage); click again to
  // clear. Hover dims the others so a single trajectory pops out of the bundle.
  const [isolated, setIsolated] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Legend search: with many lineages the legend is long, so let the user filter
  // it to find a trajectory fast instead of scrolling a wall of chips.
  const [legendQuery, setLegendQuery] = useState('');
  // Crosshair tooltip: nearest data point under the cursor.
  const [cursor, setCursor] = useState<{ px: number; py: number; lineage: string; name: string; x: number; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const xVals: number[] = [];
  const yVals: number[] = [];
  for (const s of series) {
    s.points.forEach((p, i) => {
      xVals.push(hasTransfers && !Number.isNaN(p.transfer) ? p.transfer : i);
      yVals.push(p.value);
    });
  }
  const xMin = xVals.length ? Math.min(...xVals) : 0;
  const xMax = xVals.length ? Math.max(...xVals) : 1;
  const dataYMax = yVals.length ? Math.max(...yVals) : 1;
  const dataYMin = yVals.length ? Math.min(...yVals) : 0;

  // Linear: 0 -> 1.1*max. Log: clamp floor to the smaller of 0.5 or the data min
  // so sub-single-copy values still render; ceil to next power-ish above max.
  const yMaxLin = Math.max(1, dataYMax) * 1.1;
  const logFloor = Math.max(0.1, Math.min(0.5, dataYMin > 0 ? dataYMin * 0.8 : 0.5));
  const logTop = Math.max(2, dataYMax * 1.15);

  const sx = (x: number) => padL + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * plotW;
  const sy = (y: number) => {
    if (logScale) {
      const lo = Math.log10(logFloor), hi = Math.log10(logTop);
      const v = Math.log10(Math.max(logFloor, y));
      return padT + plotH - ((v - lo) / Math.max(1e-6, hi - lo)) * plotH;
    }
    return padT + plotH - ((y - 0) / Math.max(1e-6, yMaxLin - 0)) * plotH;
  };

  // Y ticks. Log: 0.5,1,2,5,10,... within range. Linear: integer steps.
  const yTicks: number[] = [];
  if (logScale) {
    for (const v of [0.25, 0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 50]) {
      if (v >= logFloor && v <= logTop) yTicks.push(v);
    }
  } else {
    const stepY = yMaxLin > 12 ? 2 : 1;
    for (let v = 0; v <= yMaxLin; v += stepY) yTicks.push(v);
  }

  const xTicks: number[] = [];
  const span = xMax - xMin;
  const step = span <= 12 ? 1 : Math.ceil(span / 12);
  for (let v = Math.ceil(xMin); v <= xMax; v += step) xTicks.push(v);

  // Reference copy-number lines (single + double copy) for quick orientation.
  const refLines = [1, 2].filter(v => (logScale ? v >= logFloor && v <= logTop : v <= yMaxLin));

  // Precompute screen-space points per lineage once.
  const drawn = series.map(s => ({
    ...s,
    pts: s.points.map((p, i) => ({
      sxv: sx(hasTransfers && !Number.isNaN(p.transfer) ? p.transfer : i),
      syv: sy(p.value),
      xv: hasTransfers && !Number.isNaN(p.transfer) ? p.transfer : i,
      raw: p,
    })),
  }));

  const isDim = (lineage: string) => {
    if (isolated) return lineage !== isolated;
    if (hovered) return lineage !== hovered;
    return false;
  };
  const anyFocus = !!isolated || !!hovered;

  // Filtered + sorted legend entries. Sort by latest copy-number value descending
  // so the most-amplified lineages (usually what you're hunting for) sit at the
  // top of the list; apply the search filter on top of that.
  const legendEntries = series
    .map(s => ({ s, last: s.points[s.points.length - 1] }))
    .filter(({ s }) => !legendQuery || s.lineage.toLowerCase().includes(legendQuery.toLowerCase()))
    .sort((a, b) => (b.last?.value ?? 0) - (a.last?.value ?? 0));

  // Nearest-point lookup for the crosshair tooltip.
  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    let best: typeof cursor = null;
    let bestD = Infinity;
    for (const s of drawn) {
      if (isolated && s.lineage !== isolated) continue;
      for (const p of s.pts) {
        const d = (p.sxv - mx) ** 2 + (p.syv - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { px: p.sxv, py: p.syv, lineage: s.lineage, name: p.raw.name, x: p.xv, value: p.raw.value };
        }
      }
    }
    // Only snap within a reasonable radius.
    setCursor(bestD <= 26 * 26 ? best : null);
  }

  return (
    // Two-column layout: the chart stays put on the left and the (often long)
    // lineage legend scrolls independently on the right. This is the fix for the
    // "I hover a legend item far down the list but the graph has scrolled out of
    // view" problem: the graph is ALWAYS visible while you scroll/hover the list.
    <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">
      {/* Chart column */}
      <div className="relative flex-1 min-w-0 min-h-0 flex items-center justify-center">
        <div className="absolute top-2 right-2 z-10">
          <ExportFigureMenu
            getTarget={() => svgRef.current}
            title={`Copy number trend for ${regionLabel}`}
            filenameBase={`copy-number-${regionLabel}`}
            buildSpec={() => ({
              kind: 'lineChart',
              title: `Copy number trend for ${regionLabel}`,
              subtitle: `${series.length} lineage${series.length === 1 ? '' : 's'}${logScale ? '; log-scaled y axis' : ''}.`,
              xTitle: hasTransfers ? 'Transfer' : 'Sample (ordinal)',
              yTitle: `Copy number${logScale ? ' (log)' : ''}`,
              legendTitle: 'Lineages',
              caption: 'AI-ALE LIMS viewer copy-number export from the selected region. Each line is one lineage across available transfers.',
              logY: logScale,
              showPoints,
              series: series.map(s => ({
                id: s.lineage,
                label: s.lineage,
                color: s.color,
                points: s.points.map((p, i) => ({ x: hasTransfers && !Number.isNaN(p.transfer) ? p.transfer : i, y: p.value, label: p.name })),
                emphasis: isolated === s.lineage || hovered === s.lineage,
              })),
              referenceLines: [1, 2].map(v => ({ y: v, label: `${v}x`, color: '#059669', dash: true })),
            })}
            compact
          />
        </div>
        <div className="relative w-full h-full flex items-center justify-center">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="max-w-full max-h-full w-auto h-auto select-none"
            role="img"
            aria-label={`Copy number trend for ${regionLabel}`}
            onMouseMove={handleMove}
            onMouseLeave={() => setCursor(null)}
          >
            {/* gridlines + y labels */}
            {yTicks.map(v => (
              <g key={`y${v}`}>
                <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth="1" opacity="0.5" />
                <text x={padL - 7} y={sy(v) + 3} textAnchor="end" className="text-[10px]" fill="var(--text-faint)">{v}</text>
              </g>
            ))}
            {/* reference copy-number lines */}
            {refLines.map(v => (
              <g key={`ref${v}`}>
                <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="var(--data-cn)" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
                <text x={W - padR} y={sy(v) - 3} textAnchor="end" className="text-[9px]" fill="var(--data-cn)" opacity="0.85">{v}×</text>
              </g>
            ))}
            {/* x axis labels */}
            {xTicks.map(v => (
              <text key={`x${v}`} x={sx(v)} y={H - padB + 16} textAnchor="middle" className="text-[10px]" fill="var(--text-faint)">
                {hasTransfers ? `T${v}` : v}
              </text>
            ))}
            <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" className="text-[11px]" fill="var(--text-soft)">
              {hasTransfers ? 'Transfer' : 'Sample (ordinal)'}
            </text>
            <text x={14} y={padT + plotH / 2} textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`} className="text-[11px]" fill="var(--text-soft)">
              Copy number{logScale ? ' (log)' : ''}
            </text>
            {/* series. When something is focused, draw dimmed lines first and the
                focused line LAST so it paints on top of the bundle. When a
                lineage is ISOLATED (clicked), we render ONLY that line, not 90+
                ghosts at low opacity, because many faint lines still stack into a
                visible haze. Hover keeps the others (dimmed) for context. */}
            {[...drawn]
              .filter(s => !isolated || s.lineage === isolated)
              .sort((a, b) => {
                const af = (isolated === a.lineage || hovered === a.lineage) ? 1 : 0;
                const bf = (isolated === b.lineage || hovered === b.lineage) ? 1 : 0;
                return af - bf;
              })
              .map(s => {
                const dim = isDim(s.lineage);
                const focus = (isolated === s.lineage) || (hovered === s.lineage);
                // Hover dims the rest; isolation removes them entirely (above).
                const dimOpacity = 0.12;
                const path = s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.sxv.toFixed(1)} ${p.syv.toFixed(1)}`).join(' ');
                return (
                  <g key={s.lineage} opacity={dim ? dimOpacity : 1} style={{ transition: 'opacity .12s' }}>
                    <path d={path} fill="none" stroke={s.color} strokeWidth={focus ? 2.8 : 1.6} strokeLinejoin="round" strokeLinecap="round" />
                    {(showPoints || focus) && s.pts.map((p, i) => (
                      <circle key={i} cx={p.sxv} cy={p.syv} r={focus ? 3.2 : 2.2} fill={s.color} stroke="var(--surface)" strokeWidth="0.6" />
                    ))}
                    {/* endpoint value label when isolated/hovered */}
                    {focus && s.pts.length > 0 && (
                      <text
                        x={s.pts[s.pts.length - 1].sxv + 5}
                        y={s.pts[s.pts.length - 1].syv + 3}
                        className="text-[9.5px] font-mono"
                        fill={s.color}
                      >{s.pts[s.pts.length - 1].raw.value.toFixed(2)}×</text>
                    )}
                  </g>
                );
              })}
            {/* crosshair + active point */}
            {cursor && (
              <g pointerEvents="none">
                <line x1={cursor.px} x2={cursor.px} y1={padT} y2={padT + plotH} stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                <circle cx={cursor.px} cy={cursor.py} r="4.5" fill="none" stroke="var(--data-cn)" strokeWidth="1.6" />
              </g>
            )}
          </svg>
          {/* floating tooltip */}
          {cursor && (
            <div
              className="lims-popover absolute pointer-events-none px-2 py-1.5 text-[11px] z-10"
              style={{
                left: `${(cursor.px / W) * 100}%`,
                top: `${(cursor.py / H) * 100}%`,
                transform: 'translate(10px, -50%)',
              }}
            >
              <div className="font-mono font-semibold text-[var(--text)]">{cursor.lineage}</div>
              <div className="text-[var(--text-soft)]">{cursor.name}</div>
              <div className="tabular-nums">
                <span className="text-[var(--text-faint)]">{hasTransfers ? 'T' : '#'}{Number.isFinite(cursor.x) ? cursor.x : '?'}</span>
                <span className="mx-1 text-[var(--text-faint)]">·</span>
                <span className="font-semibold" style={{ color: 'var(--data-cn)' }}>CN {cursor.value.toFixed(2)}×</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legend column: fixed-width on desktop, its OWN scroll area, with a search
          box pinned at top. Hovering any row highlights its line on the chart,
          which never scrolls out of view because it lives in the other column. */}
      <div className="lg:w-60 shrink-0 flex flex-col min-h-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] lg:pl-3 pt-3 lg:pt-0">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={legendQuery}
            onChange={e => setLegendQuery(e.target.value)}
            placeholder={`Filter ${series.length} lineages…`}
            className="lims-input text-[11px] py-1 flex-1 min-w-0"
          />
          {isolated && (
            <button
              type="button"
              onClick={() => setIsolated(null)}
              className="lims-chip lims-chip-accent shrink-0"
              title="Clear isolation, show all lineages"
            >clear ×</button>
          )}
        </div>
        <div className="text-[10px] text-[var(--text-faint)] mb-1 tabular-nums">
          {legendEntries.length} of {series.length} · sorted by latest CN
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-0.5">
          {legendEntries.map(({ s, last }) => {
            const active = isolated === s.lineage;
            const isHover = hovered === s.lineage;
            return (
              <button
                key={s.lineage}
                type="button"
                onClick={() => setIsolated(active ? null : s.lineage)}
                onMouseEnter={() => setHovered(s.lineage)}
                onMouseLeave={() => setHovered(null)}
                className="flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded transition-colors text-left w-full"
                style={{
                  background: active || isHover ? 'var(--data-cn-bg)' : 'transparent',
                  color: 'var(--text-soft)',
                  opacity: anyFocus && !active && !isHover ? 0.45 : 1,
                }}
                title={active ? 'Click to clear' : 'Click to isolate this lineage'}
              >
                <span className="inline-block w-3 h-0.5 rounded shrink-0" style={{ backgroundColor: s.color }} />
                <span className="font-mono truncate flex-1">{s.lineage}</span>
                {last && <span className="text-[var(--text-faint)] tabular-nums shrink-0">{last.value.toFixed(2)}×</span>}
              </button>
            );
          })}
          {legendEntries.length === 0 && (
            <div className="text-[11px] text-[var(--text-faint)] px-1.5 py-2">No lineage matches “{legendQuery}”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
