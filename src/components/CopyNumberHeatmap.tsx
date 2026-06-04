'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Download, Grid3X3, Info,
  Loader2, RefreshCw, Search, Sparkles, Layers,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface CopyNumberSample {
  id: string;
  experiment: string;
  strain: string;
  condition: string;
  replicate: number;
  transfer: number;
  copies: Record<string, number | null>;
  integrated: boolean | null;
}

interface CopyNumberDataset {
  source: 'mock' | 'lims';
  reason?: string;
  alleles: string[];
  samples: CopyNumberSample[];
  experiments: string[];
  warnings: string[];
}

type GroupBy = 'none' | 'experiment' | 'strain' | 'condition' | 'replicate';
type SortKey = 'natural' | 'maxCopy' | 'gain' | 'allele';
type Density = 'compact' | 'spacious';

function cellColor(value: number | null, max: number): string | undefined {
  if (value === null) return undefined;
  if (value === 0) return 'hsl(0 0% 96%)';
  const t = Math.min(1, value / Math.max(1, max));
  const hue = 80;
  const sat = 60 + Math.round(t * 25);
  const light = 92 - Math.round(t * 55);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function toCsv(d: CopyNumberDataset, samples: CopyNumberSample[]): string {
  const header = ['experiment','strain','replicate','transfer','condition','integrated', ...d.alleles];
  const lines = [header.join(',')];
  for (const s of samples) {
    const cells = [
      s.experiment, s.strain, String(s.replicate), String(s.transfer), s.condition,
      s.integrated === null ? '' : s.integrated ? 'true' : 'false',
      ...d.alleles.map(a => s.copies[a] === null || s.copies[a] === undefined ? '' : String(s.copies[a])),
    ];
    lines.push(cells.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

function downloadBlob(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface SparklineProps {
  trajectories: { transfer: number; v: number }[][];
  max: number;
  width: number;
  height: number;
  colors: string[];
}
function MultiSparkline({ trajectories, max, width, height, colors }: SparklineProps) {
  if (trajectories.length === 0) return null;
  const allT = new Set<number>();
  trajectories.forEach(t => t.forEach(p => allT.add(p.transfer)));
  const ts = [...allT].sort((a, b) => a - b);
  if (ts.length === 0) return null;
  const xOf = (t: number) => (ts.indexOf(t) / Math.max(1, ts.length - 1)) * width;
  const yOf = (v: number) => height - (v / Math.max(1, max)) * height;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {trajectories.map((points, ci) => {
        if (points.length === 0) return null;
        const sorted = [...points].sort((a, b) => a.transfer - b.transfer);
        const d = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.transfer)} ${yOf(p.v)}`).join(' ');
        return (
          <g key={ci}>
            <path d={d} stroke={colors[ci % colors.length]} strokeWidth={1.2} fill="none" />
            {sorted.map((p, i) => <circle key={i} cx={xOf(p.transfer)} cy={yOf(p.v)} r={1.3} fill={colors[ci % colors.length]} />)}
          </g>
        );
      })}
    </svg>
  );
}

export default function CopyNumberHeatmap() {
  const [data, setData] = useState<CopyNumberDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExp, setSelectedExp] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>('experiment');
  const [sortKey, setSortKey] = useState<SortKey>('natural');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [alleleSort, setAlleleSort] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>('compact');
  const [search, setSearch] = useState('');
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [showSparklines, setShowSparklines] = useState(true);
  const [hideUnintegrated, setHideUnintegrated] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/copy-number');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: CopyNumberDataset = await r.json();
      setData(j);
      setSelectedExp(new Set(j.experiments));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let rows = data.samples
      .filter(s => selectedExp.has(s.experiment))
      .filter(s => !hideUnintegrated || s.integrated !== false)
      .filter(s => !q || `${s.experiment} ${s.strain} ${s.condition} rep${s.replicate} T${s.transfer}`.toLowerCase().includes(q));

    const dir = sortDir === 'asc' ? 1 : -1;
    const maxCopy = (s: CopyNumberSample) => Math.max(0, ...Object.values(s.copies).map(v => v ?? -Infinity));
    const gain = (s: CopyNumberSample) => {
      // Approximate "gain" as max - min(nonzero), useful for surfacing expansions.
      const nums = Object.values(s.copies).filter((v): v is number => v !== null);
      if (nums.length === 0) return 0;
      return Math.max(...nums) - Math.min(...nums);
    };
    if (sortKey === 'maxCopy') rows = [...rows].sort((a, b) => (maxCopy(a) - maxCopy(b)) * dir);
    else if (sortKey === 'gain') rows = [...rows].sort((a, b) => (gain(a) - gain(b)) * dir);
    else if (sortKey === 'allele' && alleleSort) rows = [...rows].sort((a, b) => {
      const av = a.copies[alleleSort] ?? -Infinity;
      const bv = b.copies[alleleSort] ?? -Infinity;
      return (Number(av) - Number(bv)) * dir;
    });
    else rows = [...rows].sort((a, b) =>
      a.experiment.localeCompare(b.experiment) ||
      a.strain.localeCompare(b.strain) ||
      a.replicate - b.replicate ||
      a.transfer - b.transfer);

    return rows;
  }, [data, selectedExp, search, sortKey, sortDir, alleleSort, hideUnintegrated]);

  const maxCopyAll = useMemo(() => {
    let m = 1;
    filtered.forEach(s => Object.values(s.copies).forEach(v => { if (v !== null && v > m) m = v; }));
    return m;
  }, [filtered]);

  // Build trajectory map: (experiment, strain, replicate) -> per-allele time series
  // so sparklines work even when rows are flat per (sample, transfer).
  const trajectoriesByRow = useMemo(() => {
    const groups = new Map<string, CopyNumberSample[]>();
    for (const s of filtered) {
      const k = `${s.experiment}|${s.strain}|${s.replicate}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }
    const out = new Map<string, { transfer: number; v: number }[][]>();
    const alleles = data?.alleles ?? [];
    for (const [k, samples] of groups) {
      const perAllele: { transfer: number; v: number }[][] = alleles.map(a =>
        samples
          .map(s => ({ transfer: s.transfer, v: s.copies[a] }))
          .filter((p): p is { transfer: number; v: number } => p.v !== null && p.v !== undefined)
      );
      out.set(k, perAllele);
    }
    return out;
  }, [filtered, data]);

  // Group rows for visual segmentation
  const groupedRows = useMemo(() => {
    if (groupBy === 'none') return [{ label: null as string | null, rows: filtered }];
    const groups = new Map<string, CopyNumberSample[]>();
    for (const s of filtered) {
      const key = groupBy === 'experiment' ? s.experiment
        : groupBy === 'strain' ? s.strain
        : groupBy === 'condition' ? (s.condition || '—')
        : `rep ${s.replicate}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return [...groups.entries()].map(([label, rows]) => ({ label, rows }));
  }, [filtered, groupBy]);

  const cellPad = density === 'compact' ? 'px-1.5 py-0.5' : 'px-2.5 py-1';
  const textSize = density === 'compact' ? 'text-[11px]' : 'text-[12px]';

  const setSort = (key: SortKey, allele: string | null = null) => {
    if (key === sortKey && (key !== 'allele' || alleleSort === allele)) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key); setAlleleSort(allele); setSortDir('desc');
    }
  };

  const colors = useMemo(() => {
    const list = data?.alleles ?? [];
    return list.map((_, i) => `hsl(${(i * 137.508) % 360} 60% 45%)`);
  }, [data]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 flex flex-wrap items-center gap-2 shrink-0">
        <Grid3X3 className="w-4 h-4 text-fuchsia-600 dark:text-fuchsia-400" />
        {data && (
          <span className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
            data.source === 'mock'
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60'
              : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/60'
          )}>
            <Sparkles className="w-3 h-3" />
            {data.source === 'mock' ? 'Mock' : 'LIMS'}
          </span>
        )}
        <span className="text-[11px] text-slate-500 dark:text-gray-400 tabular-nums">{filtered.length}/{data?.samples.length ?? 0} samples</span>

        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Group</span>
          {(['none','experiment','strain','condition','replicate'] as GroupBy[]).map(g => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={cn('px-1.5 py-0.5 text-[10.5px] font-medium rounded border', groupBy === g
                ? 'bg-fuchsia-600 text-white border-fuchsia-700'
                : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300')}>
              {g}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Density</span>
          {(['compact','spacious'] as Density[]).map(d => (
            <button key={d} onClick={() => setDensity(d)}
              className={cn('px-1.5 py-0.5 text-[10.5px] font-medium rounded border', density === d
                ? 'bg-fuchsia-600 text-white border-fuchsia-700'
                : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300')}>
              {d}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-gray-300">
          <input type="checkbox" checked={showSparklines} onChange={e => setShowSparklines(e.target.checked)} />
          sparklines
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-gray-300">
          <input type="checkbox" checked={hideUnintegrated} onChange={e => setHideUnintegrated(e.target.checked)} />
          hide un-integrated
        </label>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="search samples"
              className="pl-7 pr-2 py-1 text-[11px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none w-48" />
          </div>
          <button onClick={() => data && downloadBlob('copy-number.csv', toCsv(data, filtered))}
            disabled={!data || filtered.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={load} className="p-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {data?.reason && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded border border-amber-300/60 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-[11.5px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5 leading-snug">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{data.reason}</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Experiment filter rail */}
        <div className="w-48 shrink-0 border-r border-slate-200 dark:border-gray-700 p-2 bg-slate-50/40 dark:bg-gray-800/40 overflow-y-auto">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1 flex items-center justify-between">
            <span>Experiments</span>
            {data && (
              <button onClick={() => setSelectedExp(prev => prev.size === data.experiments.length ? new Set() : new Set(data.experiments))}
                className="normal-case text-fuchsia-600 dark:text-fuchsia-400 font-medium hover:underline">
                {selectedExp.size === data.experiments.length ? 'Clear' : 'All'}
              </button>
            )}
          </div>
          {data?.experiments.map(e => (
            <label key={e} className="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer">
              <input type="checkbox" checked={selectedExp.has(e)} onChange={() => {
                setSelectedExp(prev => {
                  const next = new Set(prev);
                  if (next.has(e)) next.delete(e); else next.add(e);
                  return next;
                });
              }} />
              <span className="font-mono">{e}</span>
            </label>
          ))}

          <div className="mt-4 text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Sort rows</div>
          <div className="space-y-0.5">
            {([
              ['natural','default','— group → strain → rep → T'],
              ['maxCopy','max copy','rows with highest copy number first'],
              ['gain','copy gain','rows with biggest min→max swing first'],
            ] as [SortKey,string,string][]).map(([k, label, hint]) => (
              <button key={k} onClick={() => setSort(k)} title={hint}
                className={cn('w-full text-left px-1.5 py-0.5 rounded text-[11px] flex items-center gap-1',
                  sortKey === k ? 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-800 dark:text-fuchsia-200' : 'hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300')}>
                {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                {label}
              </button>
            ))}
            <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1 leading-snug">Click an allele column header to sort by that allele.</p>
          </div>

          <div className="mt-4 text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Legend</div>
          <div className="space-y-1 text-[11px] text-slate-600 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ background: cellColor(0, maxCopyAll) }} /> 0 copies
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ background: cellColor(Math.max(1, Math.round(maxCopyAll / 2)), maxCopyAll) }} /> mid
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ background: cellColor(maxCopyAll, maxCopyAll) }} /> {maxCopyAll}× (max)
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300 bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_2px,transparent_2px,transparent_5px)]" /> not sequenced
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-red-300 bg-red-50 opacity-50" /> not integrated
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-auto p-3 bg-slate-100/30 dark:bg-gray-900/30">
          {loading && <div className="flex items-center justify-center h-full text-slate-500 dark:text-gray-400 gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {error && <div className="flex items-center justify-center h-full text-red-600 dark:text-red-400 gap-2 text-sm"><AlertTriangle className="w-4 h-4" /> {error}</div>}
          {!loading && !error && data && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-gray-400 gap-2 text-sm">
              <Layers className="w-6 h-6 text-slate-300 dark:text-gray-600" />
              No samples match the current filters.
            </div>
          )}
          {!loading && !error && data && filtered.length > 0 && (
            <table className={cn('border-collapse', textSize)}>
              <thead className="sticky top-0 z-20 bg-white dark:bg-gray-800 shadow-sm">
                <tr>
                  <th className={cn('sticky left-0 z-30 bg-white dark:bg-gray-800 text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700', cellPad)}>Sample</th>
                  <th className={cn('text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700', cellPad)}>T</th>
                  <th className={cn('text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700', cellPad)}>Rep</th>
                  {groupBy !== 'condition' && (
                    <th className={cn('text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700', cellPad)}>Condition</th>
                  )}
                  <th className={cn('text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700', cellPad)}>Int</th>
                  {showSparklines && (
                    <th className={cn('text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700', cellPad)}>Trend</th>
                  )}
                  {data.alleles.map(a => {
                    const active = sortKey === 'allele' && alleleSort === a;
                    return (
                      <th key={a}
                        onMouseEnter={() => setHoverCol(a)}
                        onMouseLeave={() => setHoverCol(c => c === a ? null : c)}
                        onClick={() => setSort('allele', a)}
                        className={cn('text-center text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700 font-mono whitespace-nowrap cursor-pointer select-none',
                          cellPad,
                          hoverCol === a && 'bg-fuchsia-50 dark:bg-fuchsia-900/20',
                          active && 'text-fuchsia-700 dark:text-fuchsia-300 font-bold')}>
                        <span className="inline-flex items-center gap-1">
                          {a}
                          {active ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((grp, gi) => (
                  <React.Fragment key={grp.label ?? `grp-${gi}`}>
                    {grp.label !== null && (
                      <tr>
                        <td colSpan={5 + (showSparklines ? 1 : 0) + data.alleles.length}
                          className="sticky left-0 z-10 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-600 dark:text-gray-300 bg-slate-100 dark:bg-gray-800/80 border-y border-slate-200 dark:border-gray-700">
                          {groupBy} — {grp.label} <span className="text-slate-400 font-normal normal-case">({grp.rows.length} sample{grp.rows.length === 1 ? '' : 's'})</span>
                        </td>
                      </tr>
                    )}
                    {grp.rows.map(s => {
                      const trajKey = `${s.experiment}|${s.strain}|${s.replicate}`;
                      const trajs = trajectoriesByRow.get(trajKey) ?? [];
                      const showOnce = grp.rows.findIndex(x => `${x.experiment}|${x.strain}|${x.replicate}` === trajKey) === grp.rows.indexOf(s);
                      const isHover = hoverRow === s.id;
                      return (
                        <tr key={s.id}
                          onMouseEnter={() => setHoverRow(s.id)}
                          onMouseLeave={() => setHoverRow(h => h === s.id ? null : h)}
                          className={cn('hover:bg-slate-50/60 dark:hover:bg-gray-800/60', isHover && 'bg-fuchsia-50/40 dark:bg-fuchsia-900/10')}>
                          <td className={cn('sticky left-0 z-10 bg-white dark:bg-gray-800 font-mono text-slate-700 dark:text-gray-200 border-b border-slate-100 dark:border-gray-700/50 whitespace-nowrap', cellPad)} title={`${s.experiment} · ${s.strain} · rep ${s.replicate} · T${s.transfer} · ${s.condition || ''}`}>
                            {s.experiment}/{s.strain}
                          </td>
                          <td className={cn('text-slate-600 dark:text-gray-400 tabular-nums border-b border-slate-100 dark:border-gray-700/50', cellPad)}>{s.transfer}</td>
                          <td className={cn('text-slate-600 dark:text-gray-400 tabular-nums border-b border-slate-100 dark:border-gray-700/50', cellPad)}>{s.replicate}</td>
                          {groupBy !== 'condition' && (
                            <td className={cn('text-slate-600 dark:text-gray-400 border-b border-slate-100 dark:border-gray-700/50', cellPad)}>{s.condition}</td>
                          )}
                          <td className={cn('border-b border-slate-100 dark:border-gray-700/50', cellPad)}>
                            {s.integrated === false
                              ? <span title="Construct did not integrate" className="text-red-600 dark:text-red-400 font-mono">no</span>
                              : s.integrated === true
                                ? <span className="text-emerald-600 dark:text-emerald-400 font-mono">yes</span>
                                : <span className="text-slate-400">—</span>}
                          </td>
                          {showSparklines && (
                            <td className={cn('border-b border-slate-100 dark:border-gray-700/50', cellPad)}>
                              {showOnce
                                ? <MultiSparkline trajectories={trajs} max={maxCopyAll} width={70} height={20} colors={colors} />
                                : <span className="text-slate-300 dark:text-gray-600">↕</span>}
                            </td>
                          )}
                          {data.alleles.map(a => {
                            const v = s.copies[a];
                            const isNS = v === null || v === undefined;
                            const isNotIntegrated = s.integrated === false;
                            const bg = isNS ? undefined : cellColor(v ?? 0, maxCopyAll);
                            const colHover = hoverCol === a;
                            return (
                              <td key={a}
                                onMouseEnter={() => setHoverCol(a)}
                                onMouseLeave={() => setHoverCol(c => c === a ? null : c)}
                                className={cn('text-center tabular-nums border-b border-slate-100 dark:border-gray-700/50 transition-colors', cellPad,
                                  isNS && 'bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_2px,transparent_2px,transparent_5px)]',
                                  isNotIntegrated && !isNS && 'opacity-40',
                                  colHover && !isNS && 'ring-2 ring-inset ring-fuchsia-300 dark:ring-fuchsia-700',
                                )}
                                style={!isNS ? { background: bg } : undefined}
                                title={isNS ? `${a}: not sequenced` : `${s.experiment}/${s.strain} rep ${s.replicate} T${s.transfer}\n${a}: ${v} copies`}>
                                {isNS ? <span className="text-slate-400">n.s.</span> : v}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
