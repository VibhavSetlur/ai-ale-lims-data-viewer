'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckSquare, Square, Search, X, AlertCircle, FlaskConical, GitCompare, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, Download, Info,
  ChevronDown, ChevronRight, Eye, EyeOff, FoldVertical, UnfoldVertical,
} from 'lucide-react';
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
}

type Tab = 'samples' | 'compare';

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
    return <div className="text-[9px] text-slate-300 dark:text-gray-600 italic flex items-center justify-center" style={{ width, height }}>no curve</div>;
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
  const tooltip = `${data.length} points · OD ${Math.min(...ys).toFixed(2)}→${Math.max(...ys).toFixed(2)} over t=${Math.min(...xs)}–${Math.max(...xs)}`;
  return (
    <svg width={width} height={height} className="block" aria-label={tooltip}>
      <title>{tooltip}</title>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="stroke-slate-200 dark:stroke-gray-700" strokeWidth="0.5" />
      <path d={path} fill="none" stroke="currentColor" className="text-blue-600 dark:text-blue-400" strokeWidth="1.4" />
      {data.map((d, i) => (
        <circle key={i} cx={sx(d.t)} cy={sy(d.od)} r="1.2" className="fill-blue-600 dark:fill-blue-400" />
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

  useEffect(() => {
    try {
      const s = localStorage.getItem(SELECTED_KEY);
      if (s) setSelected(new Set(JSON.parse(s)));
      const t = localStorage.getItem(TAB_KEY);
      if (t === 'compare' || t === 'samples') setTab(t);
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
      const res = await fetch(url);
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
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 px-2">
        <div className="flex">
          <TabButton active={tab === 'samples'} onClick={() => setTab('samples')} icon={<FlaskConical className="w-3.5 h-3.5" />}>
            Sample Selection
            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300 tabular-nums">{data?.samples.length ?? 0}</span>
          </TabButton>
          <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={<GitCompare className="w-3.5 h-3.5" />}>
            Comparative View
            <span className={cn(
              "ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums",
              selected.size > 0 ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300"
            )}>{selected.size}</span>
          </TabButton>
        </div>
        <div className="flex items-center gap-1.5 pr-1">
          <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-gray-400">
            Experiment
            <select
              value={experiment}
              onChange={e => onExperimentChange(e.target.value)}
              className="text-[11.5px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none"
              title="Scope the loaded dataset to one experiment for faster queries"
            >
              <option value="">all ({data?.experiments?.length ?? '?'})</option>
              {(data?.experiments ?? []).map(e => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-gray-400" title="Breseq parameter set. Each registry is one breseq run; the dataset can contain calls from multiple runs. Pick one to view at a time.">
            Registry
            <select
              value={registry}
              onChange={e => setRegistry(e.target.value)}
              disabled={!data?.registries || data.registries.length <= 1}
              className="text-[11.5px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none disabled:opacity-60 disabled:cursor-not-allowed font-mono"
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
            <button
              onClick={() => setTab('compare')}
              className="text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1 rounded"
              title="Compare the selected samples"
            >
              Compare {selected.size} →
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-[11px] text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-100 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700"
              title="Clear selection"
            >
              clear
            </button>
          )}
          <button
            onClick={() => load(experiment, registry)}
            className="p-1.5 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700"
            title="Reload mutation dataset"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

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

      {!error && data?.warnings && data.warnings.length > 0 && (
        <div className="flex items-start gap-2 mx-3 mt-3 p-2 bg-amber-50/70 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-[11px] rounded border border-amber-200 dark:border-amber-800">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Dataset notes ({data.warnings.length}):</span>
            <ul className="list-disc list-inside opacity-90 mt-0.5 space-y-0.5">
              {data.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
              {data.warnings.length > 5 && <li>… and {data.warnings.length - 5} more.</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'samples' ? (
          <SampleSelectionPanel
            samples={data?.samples ?? []}
            mutations={data?.mutations ?? []}
            selected={selected}
            setSelected={setSelected}
            search={search}
            setSearch={setSearch}
            loading={loading}
          />
        ) : (
          <ComparativePanel
            samples={data?.samples ?? []}
            mutations={data?.mutations ?? []}
            selected={selected}
            setSelected={setSelected}
            onJumpToSelection={() => setTab('samples')}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 -mb-px transition-colors',
        active
          ? 'border-blue-600 text-blue-700 dark:text-blue-300'
          : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-100'
      )}
    >
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
  const [showFilters, setShowFilters] = useState(true);
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
          selectedOnly: !!f.selectedOnly,
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
            className="w-full pl-8 pr-7 py-1.5 text-[12px] border border-slate-300 dark:border-gray-600 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none placeholder:text-slate-400 dark:placeholder:text-gray-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300" title="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(v => !v)}
          className={cn(
            "flex items-center gap-1 text-[11px] px-2 py-1 rounded border",
            showFilters
              ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700'
          )}
          title="Show or hide chip filters"
        >
          <Filter className="w-3 h-3" /> Filters
        </button>
        <button
          onClick={() => setFilters(prev => ({ ...prev, selectedOnly: !prev.selectedOnly }))}
          className={cn(
            "flex items-center gap-1 text-[11px] px-2 py-1 rounded border",
            filters.selectedOnly
              ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700'
          )}
          title="Show only samples you've selected"
        >
          {filters.selectedOnly ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          Selected only
        </button>
        <button
          onClick={expandAll}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700"
          title="Expand every group"
        >
          <UnfoldVertical className="w-3 h-3" /> Expand
        </button>
        <button
          onClick={collapseAll}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700"
          title="Collapse every group"
        >
          <FoldVertical className="w-3 h-3" /> Collapse
        </button>
        <button
          onClick={selectEndpoints}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700"
          title="Select the first and last transfer per group (useful for time-course endpoints)"
          disabled={grouped.length === 0}
        >
          Select endpoints
        </button>
        {anyFilterActive && (
          <button
            onClick={() => { clearAllFilters(); setSearch(''); }}
            className="text-[11px] px-2 py-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700"
            title="Clear search + all chip filters"
          >
            reset all filters
          </button>
        )}
        <div className="text-[11px] text-slate-500 dark:text-gray-400 ml-auto tabular-nums whitespace-nowrap">
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
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-gray-800/95 backdrop-blur border-b border-slate-200 dark:border-gray-700">
            <tr className="text-left text-slate-600 dark:text-gray-300">
              <th className="px-2 py-1.5 w-8">
                <button onClick={toggleAll} className="flex items-center justify-center w-6 h-6 hover:bg-slate-200 dark:hover:bg-gray-700 rounded" title={allOnPageSelected ? 'Deselect all (filtered)' : 'Select all (filtered)'}>
                  {allOnPageSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-400 dark:text-gray-500" />}
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
                  <tr className="bg-slate-100/70 dark:bg-gray-800/40 text-[11px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                    <td className="px-2 py-1">
                      <button
                        onClick={() => toggleGroup(group.rows)}
                        className="flex items-center justify-center w-6 h-6 hover:bg-slate-200 dark:hover:bg-gray-700 rounded"
                        title={allSel ? 'Deselect this group' : 'Select this group'}
                      >
                        {allSel
                          ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                          : someSel
                            ? <CheckSquare className="w-3.5 h-3.5 text-blue-400 opacity-60" />
                            : <Square className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />}
                      </button>
                    </td>
                    <td colSpan={9} className="px-1 py-1">
                      <button
                        onClick={() => toggleCollapse(group.key)}
                        className="flex items-center gap-1 font-semibold hover:text-slate-700 dark:hover:text-gray-200"
                        title={isCollapsed ? 'Expand group' : 'Collapse group'}
                      >
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {group.label}
                        <span className="ml-1 normal-case text-slate-400 dark:text-gray-500 font-normal tabular-nums">
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
                          'cursor-pointer border-b border-slate-100 dark:border-gray-700/60',
                          isSel ? 'bg-blue-50/70 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-gray-700/40'
                        )}
                      >
                        <td className="px-2 py-1 align-middle">
                          {isSel ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-300 dark:text-gray-600" />}
                        </td>
                        <td className="px-2 py-1 font-mono text-[11.5px] text-slate-800 dark:text-gray-100">{s.name}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-gray-300">{s.experiment}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-gray-300">{s.replicate ?? ''}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-gray-300">{s.donor_dna ?? ''}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-gray-300">{s.strain ?? ''}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-gray-300">{s.condition ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-700 dark:text-gray-200">{s.transfer ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {muts > 0 ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10.5px] font-semibold">{muts}</span>
                          ) : <span className="text-slate-300 dark:text-gray-600">—</span>}
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
  samples, mutations, selected, setSelected, onJumpToSelection, loading,
}: {
  samples: MutationSample[]; mutations: MutationRow[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  onJumpToSelection: () => void; loading: boolean;
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
        <p>No samples selected yet.</p>
        <button onClick={onJumpToSelection} className="px-3 py-1.5 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700">
          Pick samples on the Sample Selection tab
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
