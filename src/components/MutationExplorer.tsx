'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckSquare, Square, Search, X, AlertCircle, FlaskConical, GitCompare, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, Download, Info,
  ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, FoldVertical, UnfoldVertical,
  BarChart3, TrendingUp, Dna,
} from 'lucide-react';
import BarcodeCharts from './BarcodeCharts';
import { fetchData, IS_STATIC } from '../lib/dataSource';
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
  od_sources?: { type: string; source: string }[];
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
}

interface RegistrySummary {
  id: string;
  count: number;
  polymorphism_frequency_cutoff: number | null;
  limit_fold_coverage: number | null;
  reference: string | null;
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
  };
}

type Tab = 'samples' | 'compare' | 'copynumber' | 'barcodes';

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
};

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

function metricColor(value: number, metric: string): string {
  if (metric === 'frequency') {
    if (value >= 0.9) return 'bg-blue-600 text-white';
    if (value >= 0.7) return 'bg-blue-500 text-white';
    if (value >= 0.5) return 'bg-blue-400 text-white';
    if (value >= 0.3) return 'bg-blue-300 text-blue-900';
    if (value >= 0.1) return 'bg-blue-200 text-blue-900';
    if (value > 0)    return 'bg-blue-100 text-blue-900';
    return 'bg-slate-50 text-slate-500 dark:bg-gray-800 dark:text-gray-500';
  }
  if (metric === 'copy_number') {
    if (value >= 2.0) return 'bg-emerald-500 text-white';
    if (value >= 1.5) return 'bg-emerald-400 text-white';
    if (value >= 1.2) return 'bg-emerald-300 text-emerald-900';
    if (value >= 0.9) return 'bg-emerald-100 text-emerald-900';
    return 'bg-slate-50 text-slate-500 dark:bg-gray-800 dark:text-gray-500';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-gray-800 dark:text-gray-300';
}

function GrowthCurveSparkline({
  data, odSources, width = 88, height = 38, yMaxOverride, xMinOverride, xMaxOverride,
}: {
  data?: { t: number; od: number }[];
  odSources?: { type: string; source: string }[];
  width?: number; height?: number;
  yMaxOverride?: number; xMinOverride?: number; xMaxOverride?: number;
}) {
  if (!data || data.length < 2) {
    // No numeric series in the DB. If the LIMS tracked an OD measurement
    // upstream, show a small "OD" badge with the source filename in the
    // tooltip — researchers can then track down the actual file.
    if (odSources && odSources.length > 0) {
      const tooltip = odSources
        .map(s => `${s.type.replace('OD_series_', '')}: ${s.source}`)
        .join('\n') + '\n(numeric series not in DB mirror)';
      return (
        <div
          className="flex items-center justify-center text-[9px] font-semibold rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
          style={{ width, height }}
          title={tooltip}
          aria-label={tooltip}
        >
          OD ref
        </div>
      );
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
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${sx(d.t).toFixed(1)} ${sy(d.od).toFixed(1)}`).join(' ');
  const tooltip = `${data.length} points · OD ${Math.min(...ys).toFixed(2)}→${Math.max(...ys).toFixed(2)} over t=${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}h`;
  return (
    <svg width={width} height={height} className="block" aria-label={tooltip}>
      <title>{tooltip}</title>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--border)" strokeWidth="0.5" />
      <path d={path} fill="none" stroke="var(--data-grow)" strokeWidth="1.4" />
      {data.map((d, i) => (
        <circle key={i} cx={sx(d.t)} cy={sy(d.od)} r="1.2" fill="var(--data-grow)" />
      ))}
    </svg>
  );
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
    // Sort by transfer NUMBER whenever both samples have one (not just ALE) —
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

export default function MutationExplorer() {
  const [tab, setTab] = useState<Tab>('samples');
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

  useEffect(() => {
    try {
      const s = localStorage.getItem(SELECTED_KEY);
      if (s) setSelected(new Set(JSON.parse(s)));
      const t = localStorage.getItem(TAB_KEY);
      if (t === 'compare' || t === 'samples' || t === 'barcodes' || t === 'copynumber') setTab(t);
      const e = localStorage.getItem(EXPERIMENT_KEY);
      if (e !== null) setExperiment(e);
      const r = localStorage.getItem(REGISTRY_KEY);
      if (r !== null) setRegistry(r);
    } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected])); } catch {} }, [selected]);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch {} }, [tab]);
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
  useEffect(() => { load(experiment, registry); }, [experiment, registry]);

  // Changing the experiment also resets the registry — the set of available
  // registries differs by experiment, so a stale pin would silently fall back
  // to the modal-registry warning every time.
  const onExperimentChange = (next: string) => { setRegistry(''); setExperiment(next); };

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
    if (changed) setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2">
        <div className="flex items-stretch">
          <TabButton active={tab === 'samples'} onClick={() => setTab('samples')} icon={<FlaskConical className="w-3.5 h-3.5" />}>
            Sample Selection
            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface-3)] text-[var(--text-soft)] tabular-nums">{data?.samples.length ?? 0}</span>
          </TabButton>
          <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={<GitCompare className="w-3.5 h-3.5" />}>
            Comparative View
            <span className={cn(
              "ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums",
              selected.size > 0 ? "bg-[var(--accent-600)] text-white" : "bg-[var(--surface-3)] text-[var(--text-soft)]"
            )}>{selected.size}</span>
          </TabButton>
          <TabButton active={tab === 'copynumber'} onClick={() => setTab('copynumber')} icon={<Dna className="w-3.5 h-3.5" />}>
            Copy Number
            {(data?.stats?.cnRegionCount ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums lims-pill-cn">{data!.stats!.cnRegionCount}</span>
            )}
          </TabButton>
          <TabButton active={tab === 'barcodes'} onClick={() => setTab('barcodes')} icon={<BarChart3 className="w-3.5 h-3.5" />}>
            Barcode Charts
          </TabButton>
        </div>
        <div className="flex items-center gap-1.5 pr-1">
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
                return (
                  <option key={r.id} value={r.id}>
                    {shortId}{cutoff} · {r.count.toLocaleString()} calls
                  </option>
                );
              })}
            </select>
          </label>
          {tab === 'samples' && selected.size > 0 && (
            <button onClick={() => setTab('compare')} className="lims-btn lims-btn-primary" title="Compare the selected samples">
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
        </div>
      </div>

      {/* Compact context strip: stats + dataset-notes toggle in ONE thin row */}
      {!error && data?.stats && (
        <div className="flex items-center gap-4 flex-wrap px-3 h-8 border-b border-[var(--border)] bg-[var(--surface-2)] text-[11px]">
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
              onClick={() => { setTab('copynumber'); }}
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

      {/* Dataset notes only render when toggled — they never steal table space. */}
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
        {/* Keep all four tabs mounted so their state (filters, scroll, selection)
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
          />
        </div>
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'compare' ? '' : 'hidden')}>
          <ComparativePanel
            samples={data?.samples ?? []}
            mutations={data?.mutations ?? []}
            selected={selected}
            setSelected={setSelected}
            onJumpToSelection={() => setTab('samples')}
            loading={loading}
            forceMetric={forceMetric}
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
              setTab('compare');
            }}
            onPickSamples={() => setTab('samples')}
          />
        </div>
        <div className={cn('flex-1 min-h-0 flex flex-col', tab === 'barcodes' ? '' : 'hidden')}>
          <BarcodeCharts />
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} data-active={active} className="lims-tab">
      {icon}
      {children}
    </button>
  );
}

/* ---------------- Sample Selection panel ---------------- */

type ChipKey = 'experiment' | 'replicate' | 'donor_dna' | 'strain' | 'condition';

type SampleFilters = {
  chips: Record<ChipKey, string[]>;
  selectedOnly: boolean;
  transferMin: number | null;
  transferMax: number | null;
};

const EMPTY_SAMPLE_FILTERS: SampleFilters = {
  chips: { experiment: [], replicate: [], donor_dna: [], strain: [], condition: [] },
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
  samples, mutations, selected, setSelected, search, setSearch, loading,
}: {
  samples: MutationSample[]; mutations: MutationRow[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  search: string; setSearch: (s: string) => void; loading: boolean;
}) {
  const [filters, setFilters] = useState<SampleFilters>(EMPTY_SAMPLE_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate filter + collapse state from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAMPLE_FILTERS_KEY);
      if (raw) {
        const f = JSON.parse(raw) as Partial<SampleFilters>;
        setFilters({
          chips: {
            experiment: f.chips?.experiment ?? [],
            replicate: f.chips?.replicate ?? [],
            donor_dna: f.chips?.donor_dna ?? [],
            strain: f.chips?.strain ?? [],
            condition: f.chips?.condition ?? [],
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

  // Chip options come from the full sample set (not the filtered set) so the
  // option list doesn't disappear after a user picks one.
  const chipOptions = useMemo(() => {
    const counts: Record<ChipKey, Map<string, number>> = {
      experiment: new Map(), replicate: new Map(), donor_dna: new Map(),
      strain: new Map(), condition: new Map(),
    };
    for (const s of samples) {
      const bump = (k: ChipKey, v: string | undefined | null) => {
        if (!v) return;
        counts[k].set(v, (counts[k].get(v) ?? 0) + 1);
      };
      bump('experiment', s.experiment);
      bump('replicate', s.replicate);
      bump('donor_dna', s.donor_dna);
      bump('strain', s.strain);
      bump('condition', s.condition);
    }
    const toList = (k: ChipKey) =>
      [...counts[k].entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return {
      experiment: toList('experiment'),
      replicate: toList('replicate'),
      donor_dna: toList('donor_dna'),
      strain: toList('strain'),
      condition: toList('condition'),
    };
  }, [samples]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = sortSamples(samples);
    const chipSet = {
      experiment: new Set(filters.chips.experiment),
      replicate: new Set(filters.chips.replicate),
      donor_dna: new Set(filters.chips.donor_dna),
      strain: new Set(filters.chips.strain),
      condition: new Set(filters.chips.condition),
    };
    return sorted.filter(s => {
      if (filters.selectedOnly && !selected.has(s.id)) return false;
      if (chipSet.experiment.size > 0 && !chipSet.experiment.has(s.experiment)) return false;
      if (chipSet.replicate.size > 0 && !chipSet.replicate.has(s.replicate ?? '')) return false;
      if (chipSet.donor_dna.size > 0 && !chipSet.donor_dna.has(s.donor_dna ?? '')) return false;
      if (chipSet.strain.size > 0 && !chipSet.strain.has(s.strain ?? '')) return false;
      if (chipSet.condition.size > 0 && !chipSet.condition.has(s.condition ?? '')) return false;
      if (filters.transferMin !== null && (s.transfer ?? -Infinity) < filters.transferMin) return false;
      if (filters.transferMax !== null && (s.transfer ?? Infinity) > filters.transferMax) return false;
      if (q) {
        const hay = `${s.name} ${s.experiment} ${s.strain ?? ''} ${s.donor_dna ?? ''} ${s.condition ?? ''} ${s.replicate ?? ''}`.toLowerCase();
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

  // Select first + last transfer per group — useful for time-course experiments
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

  return (
    <div className="flex flex-col h-full min-h-0">
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
              <th className="px-2 py-1.5 font-semibold text-right">Mutations</th>
              <th className="px-2 py-1.5 font-semibold text-right">Growth curve</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">
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
                    <td colSpan={9} className="px-1 py-1">
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
                        <td className="px-2 py-1 lims-id text-[var(--text)]">{s.name}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.experiment}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.replicate ?? ''}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.donor_dna ?? ''}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.strain ?? ''}</td>
                        <td className="px-2 py-1 text-[var(--text-soft)]">{s.condition ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[var(--text)]">{s.transfer ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {muts > 0 ? (
                            <span className="inline-block px-1.5 py-0.5 rounded lims-pill-mut text-[10.5px] font-semibold">{muts}</span>
                          ) : <span className="text-[var(--text-faint)]">—</span>}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex justify-end">
                            <GrowthCurveSparkline data={s.growth_curve} odSources={s.od_sources} width={70} height={26} />
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
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  // Rehydrate filters from localStorage on first mount. Once the user has
  // touched the filters their persisted state takes precedence over defaults.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPARE_FILTERS_KEY);
      if (raw) {
        const f = JSON.parse(raw) as Partial<CompareFilters>;
        if (typeof f.mutFilter === 'string') setMutFilter(f.mutFilter);
        if (f.metricFilter === 'all' || f.metricFilter === 'frequency' || f.metricFilter === 'copy_number') setMetricFilter(f.metricFilter);
        if (Array.isArray(f.snpTypes)) setSnpTypes(new Set(f.snpTypes));
        if (typeof f.minFreq === 'number') setMinFreq(f.minFreq);
        if (typeof f.minPresence === 'number') setMinPresence(f.minPresence);
        if (typeof f.hideEmpty === 'boolean') setHideEmpty(f.hideEmpty);
        if (typeof f.hideEmptySamples === 'boolean') setHideEmptySamples(f.hideEmptySamples);
        if (f.sortKey === null || ['gene','variant','type','position','maxFreq','spread','presence'].includes(f.sortKey as string)) setSortKey(f.sortKey as SortKey);
        if (f.sortDir === 'asc' || f.sortDir === 'desc') setSortDir(f.sortDir);
      }
    } catch {}
    setFiltersHydrated(true);
  }, []);

  // Persist filters back to localStorage on every change (after hydration).
  useEffect(() => {
    if (!filtersHydrated) return;
    try {
      const payload: CompareFilters = {
        mutFilter, metricFilter, snpTypes: [...snpTypes], minFreq, minPresence, hideEmpty, hideEmptySamples, sortKey, sortDir,
      };
      localStorage.setItem(COMPARE_FILTERS_KEY, JSON.stringify(payload));
    } catch {}
  }, [filtersHydrated, mutFilter, metricFilter, snpTypes, minFreq, minPresence, hideEmpty, hideEmptySamples, sortKey, sortDir]);

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

  const selectedSamples = useMemo(() => {
    const map = new Map(samples.map(s => [s.id, s]));
    return sortSamples([...selected].map(id => map.get(id)).filter(Boolean) as MutationSample[]);
  }, [samples, selected]);

  // shared y-max and x-extent so growth curves are visually comparable across columns.
  // Uses visibleSamples (declared below) — JS hoisting handles the cycle since
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
    if (!sortKey) return filteredMutations;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredMutations].sort((a, b) => {
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
  }, [filteredMutations, sortKey, sortDir, selectedSamples]);

  // Hide empty columns: samples whose every visible mutation cell has no value.
  // The "visible" set of mutations is sortedMutations (post-filter, post-sort).
  // We only consult m.values, not styling — null cells are the ones to hide.
  const visibleSamples = useMemo(() => {
    if (!hideEmptySamples) return selectedSamples;
    if (sortedMutations.length === 0) return selectedSamples;
    return selectedSamples.filter(s =>
      sortedMutations.some(m => typeof m.values[s.id] === 'number')
    );
  }, [selectedSamples, sortedMutations, hideEmptySamples]);

  const hiddenSampleCount = selectedSamples.length - visibleSamples.length;

  // Column grouping for sticky header: (experiment + replicate) > donor_dna.
  // Built from visibleSamples so hidden columns drop out cleanly, including
  // collapsing their parent group bands when every member is hidden.
  const columnGroups = useMemo(() => {
    interface SubGroup { key: string; label: string; cols: MutationSample[] }
    interface TopGroup { key: string; experiment: string; replicate: string; subs: SubGroup[]; colCount: number }
    const top: TopGroup[] = [];
    for (const s of visibleSamples) {
      const tKey = `${s.experiment}||${s.replicate ?? ''}`;
      let group = top[top.length - 1];
      if (!group || group.key !== tKey) {
        group = { key: tKey, experiment: s.experiment, replicate: s.replicate ?? '', subs: [], colCount: 0 };
        top.push(group);
      }
      const sKey = s.donor_dna ?? '';
      let sub = group.subs[group.subs.length - 1];
      if (!sub || sub.key !== sKey) {
        sub = { key: sKey, label: sKey, cols: [] };
        group.subs.push(sub);
      }
      sub.cols.push(s);
      group.colCount++;
    }
    return top;
  }, [visibleSamples]);

  const toggleSort = (key: NonNullable<SortKey>) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      // Ascending feels natural for labels / coordinates; descending for value-based keys.
      const asc = key === 'gene' || key === 'variant' || key === 'type' || key === 'position';
      setSortDir(asc ? 'asc' : 'desc');
    }
  };

  const exportCsv = () => {
    // Export the columns the user is actually looking at — if they hid empties,
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
    for (const m of sortedMutations) {
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
      {/* Controls */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center gap-2 flex-wrap">
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
            ? <>{visibleSamples.length}/{selectedSamples.length} samples · {sortedMutations.length}/{mutations.length} mutations</>
            : <>{selectedSamples.length} samples · {sortedMutations.length}/{mutations.length} mutations</>
          }
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 dark:text-gray-300 border border-slate-300 dark:border-gray-600 rounded hover:bg-slate-50 dark:hover:bg-gray-700"
          title="Export the current comparison as CSV"
          disabled={sortedMutations.length === 0}
        >
          <Download className="w-3 h-3" />
          CSV
        </button>
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
      </div>

      {/* Comparison table */}
      <div className="flex-1 min-h-0 overflow-auto relative">
        <table className="text-[12px] border-collapse">
          {/* Sticky top: column groups + sample info rows + growth curves */}
          <thead className="sticky top-0 z-30 bg-white dark:bg-gray-800">
            {/* Experiment / Replicate band */}
            <tr>
              <th className="sticky left-0 z-40 bg-slate-100 dark:bg-gray-800 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400 min-w-[200px]">
                Experiment / Replicate
              </th>
              {columnGroups.map(g => (
                <th
                  key={g.key}
                  colSpan={g.colCount}
                  className="border-b border-l border-slate-200 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-gray-200 whitespace-nowrap text-center"
                >
                  {g.experiment}{g.replicate ? ` · Rep ${g.replicate}` : ''}
                </th>
              ))}
            </tr>
            {/* Donor DNA band */}
            <tr>
              <th className="sticky left-0 z-40 bg-slate-50 dark:bg-gray-800/70 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                Donor DNA
              </th>
              {columnGroups.flatMap(g =>
                g.subs.map(sub => (
                  <th
                    key={g.key + '|' + sub.key}
                    colSpan={sub.cols.length}
                    className="border-b border-l border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/70 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-gray-300 whitespace-nowrap text-center"
                  >
                    {sub.label || '—'}
                  </th>
                ))
              )}
            </tr>
            {/* Sample name + transfer */}
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                Sample
              </th>
              {visibleSamples.map(s => (
                <th key={s.id} className="border-b border-l border-slate-200 dark:border-gray-700 px-1.5 py-1 whitespace-nowrap min-w-[88px] bg-white dark:bg-gray-800">
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[11px] font-mono text-slate-800 dark:text-gray-100 leading-tight">{s.name}</div>
                    <button
                      onClick={() => { const next = new Set(selected); next.delete(s.id); setSelected(next); }}
                      className="text-slate-300 dark:text-gray-600 hover:text-red-500"
                      title="Remove from comparison"
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
            {/* Condition */}
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
            {/* Growth curve sparklines */}
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b-2 border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400"
                  title="OD growth curves are scaled to a shared y-axis so they're directly comparable across columns.">
                OD growth
                <span className="ml-1 text-slate-300 dark:text-gray-600 font-normal normal-case">(max {curveScale.yMax.toFixed(2)})</span>
              </th>
              {visibleSamples.map(s => (
                <th key={s.id} className="border-b-2 border-l border-slate-200 dark:border-gray-700 px-1 py-1 bg-white dark:bg-gray-800">
                  <div className="flex justify-center">
                    <GrowthCurveSparkline
                      data={s.growth_curve}
                      odSources={s.od_sources}
                      width={84}
                      height={36}
                      yMaxOverride={curveScale.yMax}
                      xMinOverride={curveScale.xMin}
                      xMaxOverride={curveScale.xMax}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Scrollable mutation rows */}
          <tbody>
            {sortedMutations.length === 0 && (
              <tr><td colSpan={visibleSamples.length + 1} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">
                {mutations.length === 0
                  ? 'No mutations in the dataset.'
                  : 'No mutations match the current filters.'}
              </td></tr>
            )}
            {sortedMutations.map(m => (
              <tr key={m.id} className="border-b border-slate-100 dark:border-gray-700/60 hover:bg-slate-50/60 dark:hover:bg-gray-700/30">
                <th
                  className="sticky left-0 z-10 bg-white dark:bg-gray-800 border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left whitespace-nowrap min-w-[200px] max-w-[280px]"
                  title={[
                    `${m.gene} ${m.variant}`,
                    m.gene_product ? `Product: ${m.gene_product}` : null,
                    m.position ? `Position: ${m.position}` : null,
                    m.snp_type ? `Class: ${m.snp_type}` : null,
                    m.base_type ? `Breseq type: ${m.base_type}` : null,
                  ].filter(Boolean).join('\n')}
                >
                  <div className="leading-tight">
                    <div className="text-[12px] font-medium text-slate-800 dark:text-gray-100 truncate">{m.gene} <span className="font-normal text-slate-500 dark:text-gray-400">/ {m.variant}</span></div>
                    <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate">
                      {m.type} · {m.metric}
                      {m.gene_product ? <span className="ml-1 italic text-slate-500 dark:text-gray-400">— {m.gene_product}</span> : null}
                    </div>
                  </div>
                </th>
                {visibleSamples.map(s => {
                  const v = m.values[s.id];
                  const hasVal = typeof v === 'number' && !Number.isNaN(v);
                  return (
                    <td
                      key={s.id}
                      className={cn(
                        'border-l border-slate-100 dark:border-gray-700/60 px-1.5 py-1 text-center tabular-nums text-[11.5px]',
                        hasVal ? metricColor(v, m.metric) : 'text-slate-300 dark:text-gray-600'
                      )}
                      title={hasVal ? `${m.gene} ${m.variant} in ${s.name}: ${formatMetric(v, m.metric)}${m.metric === 'frequency' ? ` (raw ${v.toFixed(3)})` : ''}` : `${m.gene} ${m.variant} in ${s.name}: no data`}
                    >
                      {hasVal ? formatMetric(v, m.metric) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
              <option key={r.id} value={r.id}>{r.gene}{r.gene_product ? ` — ${r.gene_product}` : ''}</option>
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
        <div className="relative w-full">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full select-none"
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
