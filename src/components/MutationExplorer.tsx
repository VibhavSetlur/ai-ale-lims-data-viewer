'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckSquare, Square, Search, X, AlertCircle, FlaskConical, GitCompare, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, Filter, Download, Info,
  ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, FoldVertical, UnfoldVertical,
  BarChart3, TrendingUp, Dna, ExternalLink, Layers,
} from 'lucide-react';
import BarcodeCharts from './BarcodeCharts';
import LibraryVariantExplorer from './LibraryVariantExplorer';
import { fetchData, IS_STATIC } from '../lib/dataSource';
import ExportFigureMenu from './ExportFigureMenu';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
  growth_curve_source?: {
    table: 'Robotic_OD';
    sample_name: string;
    transfer: number;
    points: number;
  };
  od_sources?: { type: string; source: string }[];
}

interface MutationDetail {
  seq_id?: string;
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
  stats?: { sampleCount: number; mutationRowCount: number; frequencyRowCount: number; cnRegionCount: number; cnSampleCount: number; curveCount: number; hasBarcodes?: boolean };
}

type Tab = 'samples' | 'compare' | 'library-variants' | 'copynumber' | 'barcodes';

const SELECTED_KEY = 'lims:mutation:selected';
const TAB_KEY = 'lims:mutation:tab';
const EXPERIMENT_KEY = 'lims:mutation:experiment';
const REGISTRY_KEY = 'lims:mutation:registry';
const COMPARE_FILTERS_KEY = 'lims:mutation:compareFilters';
const SAMPLE_FILTERS_KEY = 'lims:mutation:sampleFilters';
const COLLAPSED_GROUPS_KEY = 'lims:mutation:collapsedGroups';

const DEFAULT_SNP_TYPES = ['nonsynonymous', 'nonsense', 'small_indel', 'large_deletion'];

type CompareFilters = { mutFilter: string; metricFilter: 'all' | 'frequency' | 'copy_number'; snpTypes: string[]; minFreq: number; minPresence: number; hideEmpty: boolean; hideEmptySamples: boolean; sortKey: 'gene' | 'variant' | 'type' | 'position' | 'maxFreq' | 'spread' | 'presence' | null; sortDir: 'asc' | 'desc'; groupOrder: string[]; selectedMutations: string[]; compareMutationsOnly: boolean; };

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
const DEFAULT_GROUP_ORDER: GroupLevelKey[] = ['experiment', 'condition', 'strain', 'dna', 'replicate'];

function groupValue(s: MutationSample, key: GroupLevelKey): string {
  if (key === 'transfer') return typeof s.transfer === 'number' ? String(s.transfer) : '';
  const level = GROUP_LEVEL_BY_KEY.get(key);
  if (!level) return '';
  const v = (s as unknown as Record<string, unknown>)[level.field];
  return typeof v === 'string' ? v : (v == null ? '' : String(v));
}

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
    const at = typeof a.transfer === 'number' ? a.transfer : Infinity;
    const bt = typeof b.transfer === 'number' ? b.transfer : Infinity;
    if (at !== bt) return at - bt;
    return a.name.localeCompare(b.name);
  };
}

const SNP_TYPE_OPTIONS = ['nonsynonymous', 'nonsense', 'small_indel', 'large_deletion', 'synonymous', 'intergenic', 'pseudogene', 'noncoding'] as const;

function formatMetric(value: number | undefined, metric: string): string { if (value === undefined || value === null || Number.isNaN(value)) return ''; if (metric === 'frequency') return `${Math.round(value * 100)}%`; if (metric === 'copy_number') return value.toFixed(1); return String(value); }
function snpTypeBadgeClass(snpType?: string): string { const t = (snpType ?? '').toLowerCase(); if (t === 'nonsynonymous') return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'; if (t === 'synonymous') return 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'; if (t === 'nonsense' || t === 'small_indel' || t === 'large_deletion' || t.includes('indel') || t.includes('deletion')) return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'; if (t === 'intergenic') return 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700'; return 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'; }
function rampStyle(value: number, min: number, max: number, metric: string): React.CSSProperties { if (!Number.isFinite(value)) return {}; const span = max - min; const t = span > 1e-9 ? Math.max(0, Math.min(1, (value - min) / span)) : (value > 0 ? 1 : 0); const hue = metric === 'copy_number' ? 160 : metric === 'frequency' ? 214 : 215; const sat = metric === 'other' ? 8 : 70; const light = 96 - t * 58; const bg = `hsl(${hue} ${sat}% ${light}%)`; const text = light < 62 ? '#ffffff' : metric === 'copy_number' ? '#064e3b' : '#1e3a5f'; return { backgroundColor: bg, color: text }; }

type GrowthMetrics = { maxOD: number | null; muMax: number | null; doublingTimeH: number | null; lagTimeH: number | null; aucod: number | null; nPoints: number; tSpan: number | null; expIdx: number | null; minOD: number | null; tMin: number | null; tMax: number | null };
function computeGrowthMetrics(data?: { t: number; od: number }[]): GrowthMetrics { const empty: GrowthMetrics = { maxOD: null, muMax: null, doublingTimeH: null, lagTimeH: null, aucod: null, nPoints: data?.length ?? 0, tSpan: null, expIdx: null, minOD: null, tMin: null, tMax: null }; if (!data || data.length < 2) return empty; const pts = [...data].filter(d => Number.isFinite(d.t) && Number.isFinite(d.od)).sort((a, b) => a.t - b.t); if (pts.length < 2) return { ...empty, nPoints: pts.length }; const ods = pts.map(p => p.od); const ts = pts.map(p => p.t); const maxOD = Math.max(...ods); const minOD = Math.min(...ods); const tMin = ts[0]; const tMax = ts[ts.length - 1]; const tSpan = tMax - tMin; let muMax: number | null = null; let expIdx: number | null = null; for (let i = 0; i < pts.length - 1; i++) { const dt = ts[i + 1] - ts[i]; if (dt <= 0 || ods[i] <= 0 || ods[i + 1] <= 0) continue; const slope = (Math.log(ods[i + 1]) - Math.log(ods[i])) / dt; if (muMax === null || slope > muMax) { muMax = slope; expIdx = i; } } const doublingTimeH = muMax !== null && muMax > 0 ? Math.LN2 / muMax : null; const baseline = Math.min(...ods.slice(0, Math.min(3, ods.length))); let lagTimeH: number | null = null; if (baseline > 0) { const thresh = baseline * 2; for (let i = 0; i < pts.length; i++) { if (ods[i] >= thresh) { lagTimeH = ts[i]; break; } } } let aucod = 0; for (let i = 0; i < pts.length - 1; i++) aucod += ((ods[i] + ods[i + 1]) / 2) * (ts[i + 1] - ts[i]); return { maxOD, muMax, doublingTimeH, lagTimeH, aucod, nPoints: pts.length, tSpan, expIdx, minOD, tMin, tMax }; }
function fmtMetric(v: number | null, digits = 2, suffix = ''): string { if (v === null || !Number.isFinite(v)) return 'n/a'; return `${v.toFixed(digits)}${suffix}`; }

function GrowthCurveSparkline({ data, odSources, width = 88, height = 38, yMaxOverride, xMinOverride, xMaxOverride, sample, onExpand, }: { data?: { t: number; od: number }[]; odSources?: { type: string; source: string }[]; width?: number; height?: number; yMaxOverride?: number; xMinOverride?: number; xMaxOverride?: number; sample?: MutationSample; onExpand?: (s: MutationSample) => void; }) { const clickable = !!(onExpand && sample); if (!data || data.length < 2) { if (odSources && odSources.length > 0) { const tooltip = odSources.map(s => `${s.type.replace('OD_series_', '')}: ${s.source}`).join('\n') + '\n(numeric series not in DB mirror)'; const badge = (<div className={cn('flex items-center justify-center text-[9px] font-semibold rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800', clickable && 'cursor-pointer hover:ring-1 hover:ring-amber-400')} title={tooltip} onClick={clickable ? () => onExpand!(sample!) : undefined}>OD</div>); return badge; } return <div className="text-[9px] text-[var(--text-soft)]">no OD</div>; } const pts = [...data].sort((a, b) => a.t - b.t); const xs = pts.map(p => p.t); const ys = pts.map(p => p.od); const xMin = xMinOverride ?? Math.min(...xs); const xMax = xMaxOverride ?? Math.max(...xs); const yMin = 0; const yMax = yMaxOverride ?? Math.max(...ys); const sx = (x: number) => ((x - xMin) / Math.max(1e-9, xMax - xMin)) * width; const sy = (y: number) => height - ((y - yMin) / Math.max(1e-9, yMax - yMin)) * height; const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t)},${sy(p.od)}`).join(' '); return <svg width={width} height={height}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>; }

export default function MutationExplorer() {
  const [dataset, setDataset] = useState<MutationDataset | null>(null);
  const [selectedSamples, setSelectedSamples] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('samples');
  const [selectedExperiment, setSelectedExperiment] = useState('all');
  const [hasBarcodes, setHasBarcodes] = useState(false);

  useEffect(() => { fetchData('/api/mutations-stats').then(r => r.json()).then(j => setHasBarcodes(Boolean(j?.stats?.hasBarcodes))).catch(() => setHasBarcodes(false)); }, []);
  useEffect(() => { fetchData(`/api/mutations${selectedExperiment !== 'all' ? `?experiment=${encodeURIComponent(selectedExperiment)}` : ''}`).then(r => r.json()).then(setDataset); }, [selectedExperiment]);

  const selectedSampleObjects = useMemo(() => (dataset?.samples ?? []).filter(s => selectedSamples.includes(s.id)), [dataset, selectedSamples]);
  const tabs: { key: Tab; label: string; visible?: boolean }[] = [
    { key: 'samples', label: 'Sample Selection' },
    { key: 'compare', label: 'Compare Mutations' },
    { key: 'library-variants', label: 'Compare Library Variants', visible: hasBarcodes },
    { key: 'copynumber', label: 'Copy Number' },
    { key: 'barcodes', label: 'Barcode Charts', visible: hasBarcodes },
  ];

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2" data-tour="tab-samples">
      {tabs.filter(t => t.visible !== false).map(t => <button key={t.key} onClick={() => setActiveTab(t.key)} className={cn('px-3 py-1.5 rounded border text-sm', activeTab === t.key && 'bg-slate-100')}>{t.label}</button>)}
    </div>
    {activeTab === 'library-variants' ? <LibraryVariantExplorer selectedSamples={selectedSampleObjects} experiment={selectedExperiment === 'all' ? undefined : selectedExperiment} /> : null}
    {activeTab === 'barcodes' ? <BarcodeCharts /> : null}
    {activeTab === 'compare' ? <div>Compare Mutations</div> : null}
  </div>;
}
