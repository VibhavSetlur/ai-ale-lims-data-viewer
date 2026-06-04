'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Download, Filter, Info, Layers,
  Loader2, RefreshCw, Search, Sparkles, X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface BarcodeChart {
  well: string;
  strain: string;
  library: string;
  replicate: number;
  experiment: string;
  transfers: number[];
  candidates: Record<string, number[]>;
}

interface BarcodeDataset {
  source: 'mock' | 'lims';
  reason?: string;
  charts: BarcodeChart[];
  libraries: string[];
  wells: string[];
  experiments: string[];
  uniqueA: string[];
  uniqueB: string[];
  warnings: string[];
}

type ColorMode = 'candidate' | 'partner-a' | 'partner-b';
type Normalize = 'count' | 'fraction';

// Deterministic, color-blind-friendly palette generator.
function colorFor(key: string, idx: number, total: number): string {
  // Distinct, evenly-spaced hues. Skip very low saturation to stay legible.
  const hue = Math.round((idx * 360) / Math.max(1, total));
  const sat = 65;
  const light = 50;
  void key;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function parseCandidate(label: string): { a: string; b: string } | null {
  const m = label.match(/^(A\d+)-(B\d+)$/);
  return m ? { a: m[1], b: m[2] } : null;
}

function downloadBlob(name: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(charts: BarcodeChart[]): string {
  const header = ['experiment','well','strain','library','replicate','transfer','candidate','varA','varB','count'];
  const lines = [header.join(',')];
  for (const c of charts) {
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const partner = parseCandidate(cand);
      c.transfers.forEach((t, i) => {
        if (counts[i] === 0) return;
        lines.push([
          c.experiment, c.well, c.strain, c.library, String(c.replicate), String(t),
          cand, partner?.a ?? '', partner?.b ?? '', String(counts[i]),
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      });
    }
  }
  return lines.join('\n');
}

interface ChartCardProps {
  chart: BarcodeChart;
  colorMode: ColorMode;
  normalize: Normalize;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  candidateFilter: Set<string>;
}

function ChartCard({ chart, colorMode, normalize, aColors, bColors, candColors, candidateFilter }: ChartCardProps) {
  const W = 560, H = 280;
  const PAD_L = 44, PAD_R = 24, PAD_T = 24, PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Filter candidates per chart based on user selection (empty filter = all).
  const visibleCands = useMemo(() => {
    const all = Object.keys(chart.candidates);
    if (candidateFilter.size === 0) return all;
    return all.filter(c => candidateFilter.has(c));
  }, [chart.candidates, candidateFilter]);

  const totals = useMemo(() => chart.transfers.map((_, ti) =>
    visibleCands.reduce((acc, c) => acc + (chart.candidates[c][ti] || 0), 0)
  ), [chart, visibleCands]);

  const maxRaw = Math.max(1, ...totals);
  const maxY = normalize === 'fraction' ? 1 : maxRaw;
  const barW = Math.max(20, Math.min(80, innerW / Math.max(1, chart.transfers.length) - 12));
  const xStep = innerW / Math.max(1, chart.transfers.length);

  const getColor = (cand: string): string => {
    if (colorMode === 'partner-a') {
      const p = parseCandidate(cand); return p ? aColors[p.a] : '#888';
    }
    if (colorMode === 'partner-b') {
      const p = parseCandidate(cand); return p ? bColors[p.b] : '#888';
    }
    return candColors[cand] || '#888';
  };

  // Hover tooltip state
  const [hover, setHover] = useState<{ x: number; y: number; html: string } | null>(null);

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxY * i) / yTicks);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-2 text-[12px]">
        <span className="font-mono font-semibold text-slate-800 dark:text-gray-100">{chart.well}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-700 dark:text-gray-200">{chart.strain}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-700 dark:text-gray-200 truncate">{chart.library}</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-600 dark:text-gray-300">Replicate {chart.replicate}</span>
        <span className="ml-auto text-[10.5px] text-slate-400 dark:text-gray-500 tabular-nums">
          {visibleCands.length} candidate{visibleCands.length === 1 ? '' : 's'} · {chart.transfers.length} transfer{chart.transfers.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="p-2 relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* y grid + ticks */}
          {tickValues.map((v, i) => {
            const y = PAD_T + innerH - (v / maxY) * innerH;
            return (
              <g key={i}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" className="text-slate-200 dark:text-gray-700" strokeWidth={0.5} />
                <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={10} className="fill-slate-500 dark:fill-gray-400 tabular-nums">
                  {normalize === 'fraction' ? `${Math.round(v * 100)}%` : Math.round(v)}
                </text>
              </g>
            );
          })}

          {/* axes */}
          <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + innerH} y2={PAD_T + innerH} stroke="currentColor" className="text-slate-400 dark:text-gray-500" strokeWidth={1} />
          <text x={PAD_L - 30} y={PAD_T + innerH / 2} textAnchor="middle" fontSize={11} transform={`rotate(-90 ${PAD_L - 30} ${PAD_T + innerH / 2})`} className="fill-slate-600 dark:fill-gray-300">
            {normalize === 'fraction' ? 'Fraction' : 'Count'}
          </text>
          <text x={PAD_L + innerW / 2} y={H - 4} textAnchor="middle" fontSize={11} className="fill-slate-600 dark:fill-gray-300">Transfer</text>

          {/* bars */}
          {chart.transfers.map((t, ti) => {
            const total = totals[ti];
            const cx = PAD_L + xStep * ti + xStep / 2;
            const x = cx - barW / 2;
            let acc = 0;
            const baseY = PAD_T + innerH;
            return (
              <g key={ti}>
                <text x={cx} y={H - PAD_B + 16} textAnchor="middle" fontSize={11} className="fill-slate-600 dark:fill-gray-300 tabular-nums">{t}</text>
                {visibleCands.map(cand => {
                  const v = chart.candidates[cand]?.[ti] || 0;
                  if (v === 0) return null;
                  const norm = normalize === 'fraction' ? (total ? v / total : 0) : v;
                  const h = (norm / maxY) * innerH;
                  const y = baseY - acc - h;
                  acc += h;
                  const color = getColor(cand);
                  const partner = parseCandidate(cand);
                  return (
                    <rect
                      key={cand}
                      x={x} y={y} width={barW} height={Math.max(0.5, h)}
                      fill={color}
                      onMouseEnter={(e) => {
                        const target = e.currentTarget as SVGRectElement;
                        const rect = target.ownerSVGElement!.getBoundingClientRect();
                        const ptX = e.clientX - rect.left;
                        const ptY = e.clientY - rect.top;
                        setHover({
                          x: ptX, y: ptY,
                          html: `${cand}${partner ? ` (A=${partner.a}, B=${partner.b})` : ''}\nT${t}: ${v}${total ? ` (${(100 * v / total).toFixed(1)}%)` : ''}`,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>{cand} · T{t}: {v}{total ? ` (${(100 * v / total).toFixed(1)}%)` : ''}</title>
                    </rect>
                  );
                })}
                <text x={cx} y={baseY - acc - 4} textAnchor="middle" fontSize={9} className="fill-slate-500 dark:fill-gray-400 tabular-nums">
                  {total > 0 ? (normalize === 'fraction' ? '100%' : total) : ''}
                </text>
              </g>
            );
          })}
        </svg>
        {hover && (
          <div
            className="absolute pointer-events-none px-2 py-1 rounded bg-slate-900/90 text-white text-[10.5px] whitespace-pre font-mono shadow-md"
            style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, transform: 'translate(8px, -110%)' }}
          >
            {hover.html}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BarcodeCharts() {
  const [data, setData] = useState<BarcodeDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchLib, setSearchLib] = useState('');
  const [selectedLibs, setSelectedLibs] = useState<Set<string>>(new Set());
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set());
  const [transferRange, setTransferRange] = useState<[number, number] | null>(null);
  const [minTotal, setMinTotal] = useState(0);
  const [candidateFilter, setCandidateFilter] = useState<Set<string>>(new Set());
  const [candidateQuery, setCandidateQuery] = useState('');
  const [colorMode, setColorMode] = useState<ColorMode>('candidate');
  const [normalize, setNormalize] = useState<Normalize>('count');
  const [hideEmpty, setHideEmpty] = useState(true);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/barcode-counts');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: BarcodeDataset = await r.json();
      setData(j);
      // Default selections: include everything until the user narrows.
      setSelectedLibs(new Set(j.libraries));
      setSelectedWells(new Set(j.wells));
      const allTransfers = new Set<number>();
      j.charts.forEach(c => c.transfers.forEach(t => allTransfers.add(t)));
      const sorted = [...allTransfers].sort((a, b) => a - b);
      if (sorted.length > 0) setTransferRange([sorted[0], sorted[sorted.length - 1]]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Build stable color maps for each color mode using all charts in the dataset.
  const { aColors, bColors, candColors, allCandidates } = useMemo(() => {
    const aSet = new Set<string>(), bSet = new Set<string>(), candSet = new Set<string>();
    data?.charts.forEach(c => Object.keys(c.candidates).forEach(cand => {
      candSet.add(cand);
      const p = parseCandidate(cand);
      if (p) { aSet.add(p.a); bSet.add(p.b); }
    }));
    const aArr = [...aSet].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
    const bArr = [...bSet].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
    const cArr = [...candSet].sort();
    const aMap: Record<string, string> = {};
    const bMap: Record<string, string> = {};
    const cMap: Record<string, string> = {};
    aArr.forEach((k, i) => { aMap[k] = colorFor(k, i, aArr.length); });
    bArr.forEach((k, i) => { bMap[k] = colorFor(k, i, bArr.length); });
    cArr.forEach((k, i) => { cMap[k] = colorFor(k, i, cArr.length); });
    return { aColors: aMap, bColors: bMap, candColors: cMap, allCandidates: cArr };
  }, [data]);

  const allTransferValues = useMemo(() => {
    const s = new Set<number>();
    data?.charts.forEach(c => c.transfers.forEach(t => s.add(t)));
    return [...s].sort((a, b) => a - b);
  }, [data]);

  // Filtered chart list driven by every active control.
  const visibleCharts = useMemo<BarcodeChart[]>(() => {
    if (!data) return [];
    return data.charts
      .filter(c => selectedLibs.has(c.library))
      .filter(c => selectedWells.has(c.well))
      .map(c => {
        if (!transferRange) return c;
        const [lo, hi] = transferRange;
        const keepIdx: number[] = [];
        c.transfers.forEach((t, i) => { if (t >= lo && t <= hi) keepIdx.push(i); });
        if (keepIdx.length === c.transfers.length) return c;
        const newTransfers = keepIdx.map(i => c.transfers[i]);
        const newCands: Record<string, number[]> = {};
        for (const [cand, counts] of Object.entries(c.candidates)) {
          newCands[cand] = keepIdx.map(i => counts[i]);
        }
        return { ...c, transfers: newTransfers, candidates: newCands };
      })
      .filter(c => {
        if (!hideEmpty) return true;
        const totals = c.transfers.map((_, ti) =>
          Object.values(c.candidates).reduce((acc, arr) => acc + (arr[ti] || 0), 0)
        );
        return totals.some(t => t > minTotal);
      });
  }, [data, selectedLibs, selectedWells, transferRange, minTotal, hideEmpty]);

  const filteredLibs = useMemo(() =>
    data ? data.libraries.filter(l => l.toLowerCase().includes(searchLib.toLowerCase())) : []
  , [data, searchLib]);

  const filteredCandidates = useMemo(() => {
    const q = candidateQuery.toLowerCase().trim();
    if (!q) return allCandidates;
    return allCandidates.filter(c => c.toLowerCase().includes(q));
  }, [allCandidates, candidateQuery]);

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/80 flex items-center gap-2 shrink-0">
        <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-semibold text-slate-800 dark:text-gray-100">Barcode Charts</span>
        {data && (
          <span className={cn(
            'ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
            data.source === 'mock'
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60'
              : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/60'
          )}>
            <Sparkles className="w-3 h-3" />
            {data.source === 'mock' ? 'Mock data' : 'LIMS data'}
          </span>
        )}
        <span className="text-[11px] text-slate-500 dark:text-gray-400 ml-2">
          {visibleCharts.length}/{data?.charts.length ?? 0} charts
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => data && downloadBlob('barcode-counts.csv', toCsv(visibleCharts))}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50"
            disabled={!data || visibleCharts.length === 0}
            title="Download visible charts as CSV"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
          <button
            onClick={load}
            className="p-1.5 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700"
            title="Reload"
          >
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
      {data?.warnings.map((w, i) => (
        <div key={i} className="mx-3 mt-1.5 px-2.5 py-1.5 rounded border border-red-300/60 dark:border-red-700/60 bg-red-50 dark:bg-red-900/20 text-[11.5px] text-red-800 dark:text-red-200 flex items-start gap-1.5 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{w}</span>
        </div>
      ))}

      <div className="flex flex-1 min-h-0">
        {/* left filter rail */}
        <div className="w-72 shrink-0 border-r border-slate-200 dark:border-gray-700 flex flex-col overflow-hidden bg-slate-50/40 dark:bg-gray-800/40">
          <div className="p-2 border-b border-slate-200 dark:border-gray-700">
            <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Color by</label>
            <div className="grid grid-cols-3 gap-1">
              {(['candidate','partner-a','partner-b'] as ColorMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setColorMode(m)}
                  className={cn(
                    'px-1.5 py-1 text-[10.5px] font-medium rounded border transition-colors',
                    colorMode === m
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-600'
                  )}
                  title={m === 'partner-a' ? "Color by VarA partner (Nidhi's request)" : m === 'partner-b' ? 'Color by VarB partner' : 'Color by full A-B candidate'}
                >
                  {m === 'candidate' ? 'A-B' : m === 'partner-a' ? 'VarA' : 'VarB'}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2 border-b border-slate-200 dark:border-gray-700">
            <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Y axis</label>
            <div className="grid grid-cols-2 gap-1">
              {(['count','fraction'] as Normalize[]).map(n => (
                <button
                  key={n}
                  onClick={() => setNormalize(n)}
                  className={cn(
                    'px-1.5 py-1 text-[10.5px] font-medium rounded border transition-colors',
                    normalize === n
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-600'
                  )}
                >
                  {n === 'count' ? 'Raw count' : 'Fraction'}
                </button>
              ))}
            </div>
          </div>

          {transferRange && allTransferValues.length > 1 && (
            <div className="p-2 border-b border-slate-200 dark:border-gray-700">
              <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                Transfers <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">T{transferRange[0]}–T{transferRange[1]}</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={allTransferValues[0]} max={allTransferValues[allTransferValues.length - 1]}
                  value={transferRange[0]}
                  onChange={e => setTransferRange([Math.min(parseInt(e.target.value), transferRange[1]), transferRange[1]])}
                  className="flex-1"
                />
                <input
                  type="range"
                  min={allTransferValues[0]} max={allTransferValues[allTransferValues.length - 1]}
                  value={transferRange[1]}
                  onChange={e => setTransferRange([transferRange[0], Math.max(parseInt(e.target.value), transferRange[0])])}
                  className="flex-1"
                />
              </div>
            </div>
          )}

          <div className="p-2 border-b border-slate-200 dark:border-gray-700">
            <label className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
              <span>Min total / transfer</span>
              <span className="text-slate-400 dark:text-gray-500 font-normal normal-case tabular-nums">{minTotal}</span>
            </label>
            <input
              type="range" min={0} max={50} step={1}
              value={minTotal}
              onChange={e => setMinTotal(parseInt(e.target.value))}
              className="w-full"
            />
            <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-gray-300">
              <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} />
              Hide charts where no transfer exceeds threshold
            </label>
          </div>

          {data && (
            <>
              <div className="p-2 border-b border-slate-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                  <span>Libraries</span>
                  <button
                    onClick={() => setSelectedLibs(prev => prev.size === data.libraries.length ? new Set() : new Set(data.libraries))}
                    className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline"
                  >
                    {selectedLibs.size === data.libraries.length ? 'Clear' : 'All'}
                  </button>
                </div>
                <div className="relative mb-1">
                  <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchLib} onChange={e => setSearchLib(e.target.value)}
                    placeholder="Filter libraries…"
                    className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto -mr-1 pr-1">
                  {filteredLibs.map(lib => (
                    <label key={lib} className="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox" checked={selectedLibs.has(lib)}
                        onChange={() => setSelectedLibs(prev => toggle(prev, lib))}
                      />
                      <span className="font-mono truncate text-slate-700 dark:text-gray-200">{lib}</span>
                    </label>
                  ))}
                  {filteredLibs.length === 0 && <p className="text-[11px] text-slate-400 px-1 py-1">No libraries match</p>}
                </div>
              </div>

              <div className="p-2 border-b border-slate-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                  <span>Wells</span>
                  <button
                    onClick={() => setSelectedWells(prev => prev.size === data.wells.length ? new Set() : new Set(data.wells))}
                    className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline"
                  >
                    {selectedWells.size === data.wells.length ? 'Clear' : 'All'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                  {data.wells.map(w => (
                    <button
                      key={w}
                      onClick={() => setSelectedWells(prev => toggle(prev, w))}
                      className={cn(
                        'px-1.5 py-0.5 text-[10.5px] font-mono rounded border',
                        selectedWells.has(w)
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300'
                      )}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-2 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                  <span>Candidate filter <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">({candidateFilter.size}/{allCandidates.length})</span></span>
                  {candidateFilter.size > 0 && (
                    <button onClick={() => setCandidateFilter(new Set())} className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline">
                      Clear
                    </button>
                  )}
                </div>
                <div className="relative mb-1">
                  <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={candidateQuery} onChange={e => setCandidateQuery(e.target.value)}
                    placeholder="e.g. A153 or B151…"
                    className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none"
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1">
                  {filteredCandidates.slice(0, 400).map(c => (
                    <label key={c} className="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox" checked={candidateFilter.has(c)}
                        onChange={() => setCandidateFilter(prev => toggle(prev, c))}
                      />
                      <span className="font-mono text-slate-700 dark:text-gray-200">{c}</span>
                    </label>
                  ))}
                  {filteredCandidates.length > 400 && (
                    <p className="text-[10.5px] text-slate-400 px-1 py-1">+ {filteredCandidates.length - 400} more — narrow the search</p>
                  )}
                </div>
                <p className="mt-1 text-[10.5px] text-slate-500 dark:text-gray-400 leading-snug">
                  Empty filter = show all. Picking any candidate restricts every chart to that subset (the visualization stays comparable across charts).
                </p>
              </div>
            </>
          )}
        </div>

        {/* charts grid */}
        <div className="flex-1 min-w-0 overflow-auto p-3 bg-slate-100/30 dark:bg-gray-900/30">
          {loading && (
            <div className="flex items-center justify-center h-full text-slate-500 dark:text-gray-400 gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading barcode charts…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red-600 dark:text-red-400 gap-2 text-sm">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          {!loading && !error && visibleCharts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-gray-400 gap-2 text-sm">
              <Layers className="w-6 h-6 text-slate-300 dark:text-gray-600" />
              No charts match the current filters.
              <button onClick={() => { setSelectedLibs(new Set(data?.libraries ?? [])); setSelectedWells(new Set(data?.wells ?? [])); setCandidateFilter(new Set()); setMinTotal(0); }}
                className="text-xs text-emerald-600 dark:text-emerald-400 underline">
                Reset filters
              </button>
            </div>
          )}
          {!loading && visibleCharts.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {visibleCharts.map(c => (
                <ChartCard
                  key={`${c.experiment}/${c.well}/${c.library}/${c.replicate}`}
                  chart={c}
                  colorMode={colorMode}
                  normalize={normalize}
                  aColors={aColors}
                  bColors={bColors}
                  candColors={candColors}
                  candidateFilter={candidateFilter}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
