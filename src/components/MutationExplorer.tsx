'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CheckSquare, Square, Search, X, AlertCircle, FlaskConical, GitCompare, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
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
}

interface MutationRow {
  id: string;
  gene: string;
  variant: string;
  type: string;
  metric: string;
  values: Record<string, number>;
}

interface MutationDataset {
  samples: MutationSample[];
  mutations: MutationRow[];
}

type Tab = 'samples' | 'compare';

const SELECTED_KEY = 'lims:mutation:selected';
const TAB_KEY = 'lims:mutation:tab';

function formatMetric(value: number | undefined, metric: string): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  if (metric === 'frequency') return `${Math.round(value * 100)}%`;
  if (metric === 'copy_number') return value.toFixed(1);
  return String(value);
}

function metricColor(value: number, metric: string): string {
  // returns a tailwind background class. frequency = blue scale; copy_number = green scale
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

function GrowthCurveSparkline({ data, width = 88, height = 38 }: { data?: { t: number; od: number }[]; width?: number; height?: number }) {
  if (!data || data.length < 2) {
    return <div className="text-[9px] text-slate-300 dark:text-gray-600 italic">no curve</div>;
  }
  const xs = data.map(d => d.t);
  const ys = data.map(d => d.od);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = Math.max(0.05, Math.max(...ys));
  const pad = 3;
  const sx = (x: number) => pad + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * (height - pad * 2);
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${sx(d.t).toFixed(1)} ${sy(d.od).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className="block">
      <path d={path} fill="none" stroke="currentColor" className="text-blue-600 dark:text-blue-400" strokeWidth="1.4" />
      {data.map((d, i) => (
        <circle key={i} cx={sx(d.t)} cy={sy(d.od)} r="1.2" className="fill-blue-600 dark:fill-blue-400" />
      ))}
    </svg>
  );
}

function sortSamples(samples: MutationSample[]): MutationSample[] {
  // Group by experiment > replicate; ALE experiments sort by transfer ascending.
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
    if (a.experiment_type === 'robotic ALE' && b.experiment_type === 'robotic ALE') {
      const at = a.transfer ?? -1, bt = b.transfer ?? -1;
      if (at !== bt) return at - bt;
    }
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

  // restore
  useEffect(() => {
    try {
      const s = localStorage.getItem(SELECTED_KEY);
      if (s) setSelected(new Set(JSON.parse(s)));
      const t = localStorage.getItem(TAB_KEY);
      if (t === 'compare' || t === 'samples') setTab(t);
    } catch {}
  }, []);

  // persist
  useEffect(() => { try { localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected])); } catch {} }, [selected]);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch {} }, [tab]);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/mutations');
      const json = await res.json();
      if (json.error) { setError(json.error); setData({ samples: [], mutations: [] }); }
      else setData(json as MutationDataset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mutation dataset');
      setData({ samples: [], mutations: [] });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* tab bar */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 px-2">
        <div className="flex">
          <TabButton active={tab === 'samples'} onClick={() => setTab('samples')} icon={<FlaskConical className="w-3.5 h-3.5" />}>
            Sample Selection
            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300 tabular-nums">{data?.samples.length ?? 0}</span>
          </TabButton>
          <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={<GitCompare className="w-3.5 h-3.5" />}>
            Comparative View
            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-600 text-white tabular-nums">{selected.size}</span>
          </TabButton>
        </div>
        <div className="flex items-center gap-1.5 pr-1">
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
            onClick={load}
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
            <div className="text-[11px] mt-1 opacity-80">Expected at <span className="font-mono">data/mutations.json</span>. Once Natascha&apos;s spreadsheets are imported into that file (or its location is set via <span className="font-mono">MUTATIONS_PATH</span>), this view will populate automatically.</div>
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

function SampleSelectionPanel({
  samples, mutations, selected, setSelected, search, setSearch, loading,
}: {
  samples: MutationSample[]; mutations: MutationRow[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  search: string; setSearch: (s: string) => void; loading: boolean;
}) {
  const mutationCountBySample = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of mutations) {
      for (const sampleId of Object.keys(row.values)) {
        m.set(sampleId, (m.get(sampleId) ?? 0) + 1);
      }
    }
    return m;
  }, [mutations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = sortSamples(samples);
    if (!q) return sorted;
    return sorted.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.experiment ?? '').toLowerCase().includes(q) ||
      (s.strain ?? '').toLowerCase().includes(q) ||
      (s.donor_dna ?? '').toLowerCase().includes(q) ||
      (s.condition ?? '').toLowerCase().includes(q)
    );
  }, [samples, search]);

  const allOnPageSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allOnPageSelected) {
      filtered.forEach(s => next.delete(s.id));
    } else {
      filtered.forEach(s => next.add(s.id));
    }
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  // group rows visually
  const grouped: { key: string; label: string; rows: MutationSample[] }[] = useMemo(() => {
    const out: { key: string; label: string; rows: MutationSample[] }[] = [];
    let curKey = '';
    for (const s of filtered) {
      const key = `${s.experiment}${s.replicate ?? ''}${s.donor_dna ?? ''}`;
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 flex items-center gap-2 bg-white dark:bg-gray-800">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter samples by name, strain, experiment…"
            className="w-full pl-8 pr-7 py-1.5 text-[12px] border border-slate-300 dark:border-gray-600 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none placeholder:text-slate-400 dark:placeholder:text-gray-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-gray-400 ml-auto tabular-nums">
          {selected.size} selected · {filtered.length}/{samples.length} shown
        </div>
      </div>

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
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">No samples match.</td></tr>
            )}
            {!loading && grouped.map(group => (
              <React.Fragment key={group.key}>
                <tr className="bg-slate-100/70 dark:bg-gray-800/40 text-[11px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                  <td colSpan={10} className="px-3 py-1 font-semibold">{group.label}</td>
                </tr>
                {group.rows.map(s => {
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
                          <GrowthCurveSparkline data={s.growth_curve} width={70} height={26} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Comparative Panel ---------------- */

type SortKey = 'gene' | 'variant' | 'type' | 'maxFreq' | 'spread' | null;
type SortDir = 'asc' | 'desc';

function ComparativePanel({
  samples, mutations, selected, setSelected, onJumpToSelection,
}: {
  samples: MutationSample[]; mutations: MutationRow[];
  selected: Set<string>; setSelected: (s: Set<string>) => void;
  onJumpToSelection: () => void;
}) {
  const [mutFilter, setMutFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState<'all' | 'frequency' | 'copy_number'>('all');
  const [minPresence, setMinPresence] = useState(0);   // hide mutations that appear in 0 selected samples below this threshold
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const selectedSamples = useMemo(() => {
    const map = new Map(samples.map(s => [s.id, s]));
    return sortSamples([...selected].map(id => map.get(id)).filter(Boolean) as MutationSample[]);
  }, [samples, selected]);

  const filteredMutations = useMemo(() => {
    const q = mutFilter.trim().toLowerCase();
    return mutations
      .filter(m => metricFilter === 'all' || m.metric === metricFilter)
      .filter(m => {
        if (!q) return true;
        return `${m.gene} ${m.variant} ${m.type} ${m.id}`.toLowerCase().includes(q);
      })
      .filter(m => {
        if (selectedSamples.length === 0) return true;
        const present = selectedSamples.reduce((acc, s) => acc + (typeof m.values[s.id] === 'number' && m.values[s.id] > 0 ? 1 : 0), 0);
        return present >= minPresence;
      });
  }, [mutations, mutFilter, metricFilter, minPresence, selectedSamples]);

  const sortedMutations = useMemo(() => {
    if (!sortKey) return filteredMutations;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredMutations].sort((a, b) => {
      if (sortKey === 'gene') return dir * a.gene.localeCompare(b.gene);
      if (sortKey === 'variant') return dir * a.variant.localeCompare(b.variant);
      if (sortKey === 'type') return dir * a.type.localeCompare(b.type);
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
      return 0;
    });
  }, [filteredMutations, sortKey, sortDir, selectedSamples]);

  // Column grouping for sticky header: experiment > replicate > donor_dna
  const columnGroups = useMemo(() => {
    interface SubGroup { key: string; label: string; cols: MutationSample[] }
    interface TopGroup { key: string; experiment: string; replicate: string; subs: SubGroup[]; colCount: number }
    const top = new Map<string, TopGroup>();
    for (const s of selectedSamples) {
      const tKey = `${s.experiment}${s.replicate ?? ''}`;
      let group = top.get(tKey);
      if (!group) {
        group = { key: tKey, experiment: s.experiment, replicate: s.replicate ?? '', subs: [], colCount: 0 };
        top.set(tKey, group);
      }
      const sKey = s.donor_dna ?? '';
      let sub = group.subs.find(x => x.key === sKey);
      if (!sub) {
        sub = { key: sKey, label: sKey, cols: [] };
        group.subs.push(sub);
      }
      sub.cols.push(s);
      group.colCount++;
    }
    return [...top.values()];
  }, [selectedSamples]);

  const toggleSort = (key: NonNullable<SortKey>) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

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
            placeholder="Filter mutations (gene, variant…)"
            className="pl-8 pr-2 py-1 text-[12px] border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none w-56"
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
            onChange={e => setMinPresence(Math.max(0, parseInt(e.target.value || '0', 10)))}
            className="w-12 text-[12px] border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums"
          />
        </label>
        <div className="text-[11px] text-slate-500 dark:text-gray-400 ml-auto tabular-nums">
          {selectedSamples.length} samples · {sortedMutations.length}/{mutations.length} mutations
        </div>
      </div>

      {/* The comparison table */}
      <div className="flex-1 min-h-0 overflow-auto relative">
        <table className="text-[12px] border-collapse">
          {/* Sticky top: column groups + sample info rows + growth curves */}
          <thead className="sticky top-0 z-30 bg-white dark:bg-gray-800">
            {/* Experiment / Replicate band */}
            <tr>
              <th className="sticky left-0 z-40 bg-slate-100 dark:bg-gray-800 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400" rowSpan={1}>
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
            {/* Sample name + condition + transfer */}
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                Sample
              </th>
              {selectedSamples.map(s => (
                <th key={s.id} className="border-b border-l border-slate-200 dark:border-gray-700 px-1.5 py-1 whitespace-nowrap min-w-[88px]">
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
              {selectedSamples.map(s => (
                <th key={s.id} className="border-b border-l border-slate-200 dark:border-gray-700 px-1.5 py-1 text-[10.5px] font-normal text-slate-500 dark:text-gray-400 text-center">
                  {s.condition ?? ''}
                </th>
              ))}
            </tr>
            {/* Growth curve sparklines */}
            <tr>
              <th className="sticky left-0 z-40 bg-white dark:bg-gray-800 border-b-2 border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">
                OD growth
              </th>
              {selectedSamples.map(s => (
                <th key={s.id} className="border-b-2 border-l border-slate-200 dark:border-gray-700 px-1 py-1">
                  <div className="flex justify-center">
                    <GrowthCurveSparkline data={s.growth_curve} width={84} height={36} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Scrollable mutation rows */}
          <tbody>
            {sortedMutations.length === 0 && (
              <tr><td colSpan={selectedSamples.length + 1} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">No mutations match the current filters.</td></tr>
            )}
            {sortedMutations.map(m => (
              <tr key={m.id} className="border-b border-slate-100 dark:border-gray-700/60 hover:bg-slate-50/60 dark:hover:bg-gray-700/30">
                <th className="sticky left-0 z-10 bg-white dark:bg-gray-800 border-r border-slate-200 dark:border-gray-700 px-2 py-1 text-left whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="leading-tight">
                      <div className="text-[12px] font-medium text-slate-800 dark:text-gray-100">{m.gene} <span className="font-normal text-slate-500 dark:text-gray-400">/ {m.variant}</span></div>
                      <div className="text-[10px] text-slate-400 dark:text-gray-500">{m.type} · {m.metric}</div>
                    </div>
                  </div>
                </th>
                {selectedSamples.map(s => {
                  const v = m.values[s.id];
                  const hasVal = typeof v === 'number' && !Number.isNaN(v);
                  return (
                    <td
                      key={s.id}
                      className={cn(
                        'border-l border-slate-100 dark:border-gray-700/60 px-1.5 py-1 text-center tabular-nums text-[11.5px]',
                        hasVal ? metricColor(v, m.metric) : 'text-slate-300 dark:text-gray-600'
                      )}
                      title={hasVal ? `${m.gene} ${m.variant}: ${formatMetric(v, m.metric)}${m.metric === 'frequency' ? ` (raw ${v.toFixed(3)})` : ''}` : 'no data'}
                    >
                      {hasVal ? formatMetric(v, m.metric) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          {/* Sort header (rendered as tfoot then visually anchored at top via the controls is messy; */}
          {/* keep sort controls inline as little buttons under the controls bar) */}
        </table>
      </div>

      {/* Sort controls */}
      <div className="px-3 py-1.5 border-t border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400">
        <span className="mr-1">Sort mutations:</span>
        <SortChip label="gene" active={sortKey === 'gene'} dir={sortDir} onClick={() => toggleSort('gene')} />
        <SortChip label="variant" active={sortKey === 'variant'} dir={sortDir} onClick={() => toggleSort('variant')} />
        <SortChip label="type" active={sortKey === 'type'} dir={sortDir} onClick={() => toggleSort('type')} />
        <SortChip label="max value" active={sortKey === 'maxFreq'} dir={sortDir} onClick={() => toggleSort('maxFreq')} />
        <SortChip label="spread" active={sortKey === 'spread'} dir={sortDir} onClick={() => toggleSort('spread')} />
        {sortKey && (
          <button onClick={() => setSortKey(null)} className="ml-1 text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200">clear</button>
        )}
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
