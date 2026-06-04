'use client';

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, ChevronLeft, ChevronRight,
  Download, Filter, Info, LayoutGrid, List, Loader2, Maximize2, Minimize2,
  Pin, PinOff, RefreshCw, Rows3, Search, Sparkles, Target, X,
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

type ViewMode = 'grid' | 'list' | 'focus';
type ColorMode = 'candidate' | 'partner-a' | 'partner-b';
type Normalize = 'count' | 'fraction';
type SortKey = 'natural' | 'totalReads' | 'transfers' | 'candidates' | 'flipped';

// Deterministic, color-blind-aware palette (golden-angle hue rotation).
const GOLDEN = 137.508;
function colorFor(idx: number, total: number): string {
  void total;
  const hue = (idx * GOLDEN) % 360;
  return `hsl(${hue} 65% 50%)`;
}

function parseCandidate(label: string): { a: string; b: string } | null {
  const m = label.match(/^(A\d+)-(B\d+)$/);
  return m ? { a: m[1], b: m[2] } : null;
}

function chartKey(c: BarcodeChart): string {
  return `${c.experiment}/${c.library}/${c.well}/r${c.replicate}`;
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
        if (!counts[i]) return;
        lines.push([
          c.experiment, c.well, c.strain, c.library, String(c.replicate), String(t),
          cand, partner?.a ?? '', partner?.b ?? '', String(counts[i]),
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      });
    }
  }
  return lines.join('\n');
}

interface ChartStats {
  totalReads: number;
  dominantAtFirst: string | null;
  dominantAtLast: string | null;
  flipped: boolean;
  uniqueCandidates: number;
  candidateTotals: { cand: string; total: number }[];
}
function statsFor(c: BarcodeChart): ChartStats {
  let total = 0;
  const totals = new Map<string, number>();
  for (const [cand, counts] of Object.entries(c.candidates)) {
    let sum = 0;
    for (const v of counts) sum += v || 0;
    totals.set(cand, sum);
    total += sum;
  }
  const dominantAt = (idx: number): string | null => {
    let best: string | null = null;
    let bestV = -1;
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const v = counts[idx] || 0;
      if (v > bestV) { bestV = v; best = cand; }
    }
    return bestV > 0 ? best : null;
  };
  const first = dominantAt(0);
  const last = dominantAt(c.transfers.length - 1);
  const candidateTotals = [...totals.entries()]
    .map(([cand, total]) => ({ cand, total }))
    .sort((a, b) => b.total - a.total);
  return {
    totalReads: total,
    dominantAtFirst: first,
    dominantAtLast: last,
    flipped: !!(first && last && first !== last),
    uniqueCandidates: Object.keys(c.candidates).length,
    candidateTotals,
  };
}

interface ChartProps {
  chart: BarcodeChart;
  stats: ChartStats;
  colorMode: ColorMode;
  normalize: Normalize;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  candidateFilter: Set<string>;
  topN: number;            // 0 = no rollup, else collapse the rest into "other"
  pinnedCand: string | null;
  height: number;          // SVG inner height target
  onPickCandidate?: (cand: string) => void;
}

function ChartCard({
  chart, stats, colorMode, normalize, aColors, bColors, candColors,
  candidateFilter, topN, pinnedCand, height, onPickCandidate,
}: ChartProps) {
  // Visible candidates after filter + Top-N rollup.
  const { visibleCands, otherCands } = useMemo(() => {
    let all = Object.keys(chart.candidates);
    if (candidateFilter.size > 0) all = all.filter(c => candidateFilter.has(c));
    if (topN <= 0 || all.length <= topN) return { visibleCands: all, otherCands: [] as string[] };
    const ordered = stats.candidateTotals.map(t => t.cand).filter(c => all.includes(c));
    return { visibleCands: ordered.slice(0, topN), otherCands: ordered.slice(topN) };
  }, [chart.candidates, candidateFilter, topN, stats.candidateTotals]);

  // Build aggregated "Other" counts per transfer if rolling up.
  const otherCounts = useMemo(() => {
    if (otherCands.length === 0) return null;
    const arr = Array(chart.transfers.length).fill(0);
    for (const c of otherCands) {
      const counts = chart.candidates[c];
      counts.forEach((v, i) => { arr[i] += v || 0; });
    }
    return arr;
  }, [otherCands, chart.candidates, chart.transfers.length]);

  const totals = useMemo(() => chart.transfers.map((_, ti) =>
    visibleCands.reduce((acc, c) => acc + (chart.candidates[c][ti] || 0), 0) + (otherCounts?.[ti] || 0)
  ), [chart, visibleCands, otherCounts]);

  // Bars shouldn't ever balloon into giant colored slabs. Cap the bar width
  // in SVG units (the SVG is rendered with width: 100% so the bar stays a
  // sensible fraction of the screen regardless of how few transfers exist).
  // For 1 transfer: bar ~6% of inner width. For many transfers: bar fills
  // most of its slot up to the cap.
  const W = 600;
  const PAD_L = 48, PAD_R = 28, PAD_T = 22, PAD_B = 32;
  const innerH = height;
  const H = innerH + PAD_T + PAD_B;
  const innerW = W - PAD_L - PAD_R;

  const maxRaw = Math.max(1, ...totals);
  const maxY = normalize === 'fraction' ? 1 : maxRaw;
  const slotW = innerW / Math.max(1, chart.transfers.length);
  const BAR_CAP = 56;          // hard ceiling so 2-transfer charts don't bloat
  const BAR_FILL = 0.62;       // bar uses 62% of its slot otherwise
  const barW = Math.max(18, Math.min(BAR_CAP, slotW * BAR_FILL));
  const xStep = slotW;
  const LABEL_MIN_H = 14;      // only label segments tall enough to read
  const LABEL_NAME_MIN_H = 22; // only show candidate name when even taller

  const getColor = (cand: string): string => {
    if (cand === '__OTHER__') return '#94a3b8'; // slate-400 for rollup
    if (colorMode === 'partner-a') {
      const p = parseCandidate(cand); return p ? aColors[p.a] : '#888';
    }
    if (colorMode === 'partner-b') {
      const p = parseCandidate(cand); return p ? bColors[p.b] : '#888';
    }
    return candColors[cand] || '#888';
  };

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxY * i) / yTicks);
  const isPinned = (cand: string) => pinnedCand !== null && pinnedCand === cand;
  const isDimmed = (cand: string) => pinnedCand !== null && pinnedCand !== cand;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-2 text-[12px]">
        <span className="font-mono font-semibold text-slate-800 dark:text-gray-100">{chart.well}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-700 dark:text-gray-200">{chart.strain}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-700 dark:text-gray-200 truncate" title={chart.library}>{chart.library}</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-600 dark:text-gray-300">Rep {chart.replicate}</span>
        <div className="ml-auto flex items-center gap-2 text-[10.5px] tabular-nums text-slate-500 dark:text-gray-400">
          {stats.flipped && (
            <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold uppercase tracking-wider" title={`Dominant flipped: ${stats.dominantAtFirst} → ${stats.dominantAtLast}`}>
              flip
            </span>
          )}
          <span>{stats.uniqueCandidates} cands</span>
          <span>· {stats.totalReads.toLocaleString()} reads</span>
        </div>
      </div>

      <div className="p-2 relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
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
          <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + innerH} y2={PAD_T + innerH} stroke="currentColor" className="text-slate-400 dark:text-gray-500" strokeWidth={1} />
          <text x={14} y={PAD_T + innerH / 2} textAnchor="middle" fontSize={10} transform={`rotate(-90 14 ${PAD_T + innerH / 2})`} className="fill-slate-600 dark:fill-gray-300">
            {normalize === 'fraction' ? 'Fraction' : 'Count'}
          </text>
          <text x={PAD_L + innerW / 2} y={H - 6} textAnchor="middle" fontSize={10} className="fill-slate-600 dark:fill-gray-300">Transfer</text>

          {chart.transfers.map((t, ti) => {
            const total = totals[ti];
            const cx = PAD_L + xStep * ti + xStep / 2;
            const x = cx - barW / 2;
            let acc = 0;
            const baseY = PAD_T + innerH;
            const stack: { cand: string; v: number }[] = visibleCands.map(c => ({ cand: c, v: chart.candidates[c]?.[ti] || 0 }));
            if (otherCounts && otherCounts[ti] > 0) stack.push({ cand: '__OTHER__', v: otherCounts[ti] });
            return (
              <g key={ti}>
                <text x={cx} y={H - PAD_B + 14} textAnchor="middle" fontSize={11} className="fill-slate-600 dark:fill-gray-300 tabular-nums">T{t}</text>
                {stack.map(({ cand, v }) => {
                  if (!v) return null;
                  const norm = normalize === 'fraction' ? (total ? v / total : 0) : v;
                  const h = (norm / maxY) * innerH;
                  const y = baseY - acc - h;
                  acc += h;
                  const color = getColor(cand);
                  const pinned = isPinned(cand);
                  const dim = isDimmed(cand);
                  const pctStr = total ? `${(100 * v / total).toFixed(0)}%` : '';
                  const showName = h >= LABEL_NAME_MIN_H && barW >= 38;
                  const showCount = h >= LABEL_MIN_H;
                  const midY = y + h / 2;
                  const labelText = cand === '__OTHER__'
                    ? `Other · ${v}`
                    : (showName ? `${cand} · ${v}` : String(v));
                  return (
                    <g key={cand}>
                      <rect
                        x={x} y={y} width={barW} height={Math.max(0.5, h)}
                        fill={color}
                        stroke={pinned ? '#0f172a' : 'rgba(255,255,255,0.4)'}
                        strokeWidth={pinned ? 1.5 : 0.4}
                        opacity={dim ? 0.18 : 1}
                        style={{ cursor: cand !== '__OTHER__' && onPickCandidate ? 'pointer' : 'default' }}
                        onClick={() => cand !== '__OTHER__' && onPickCandidate?.(cand)}
                      >
                        <title>
                          {cand === '__OTHER__'
                            ? `Other (${otherCands.length} candidates) · T${t}: ${v}${total ? ` (${(100 * v / total).toFixed(1)}%)` : ''}`
                            : `${cand} · T${t}: ${v}${total ? ` (${(100 * v / total).toFixed(1)}%)` : ''}`}
                        </title>
                      </rect>
                      {showCount && !dim && (
                        <text
                          x={cx} y={midY + 3.5} textAnchor="middle"
                          fontSize={showName ? 11 : 10.5}
                          className="pointer-events-none"
                          style={{ fill: 'white', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 2.5, strokeLinejoin: 'round', fontWeight: 600 }}
                        >
                          {showName ? labelText : `${v}${pctStr ? ` · ${pctStr}` : ''}`}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* total label sits above the bar */}
                {total > 0 && (
                  <text x={cx} y={baseY - acc - 5} textAnchor="middle" fontSize={11} className="fill-slate-700 dark:fill-gray-200 tabular-nums" fontWeight={600}>
                    {normalize === 'fraction' ? '100%' : total.toLocaleString()}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// Tiny sparkline thumbnail used in the wall view.
function ThumbChart({ chart, stats, candColors, pinnedCand }: { chart: BarcodeChart; stats: ChartStats; candColors: Record<string, string>; pinnedCand: string | null }) {
  const W = 130, H = 60;
  const PAD_L = 10, PAD_R = 4, PAD_T = 4, PAD_B = 12;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const totals = chart.transfers.map((_, ti) =>
    Object.values(chart.candidates).reduce((acc, arr) => acc + (arr[ti] || 0), 0)
  );
  const maxY = Math.max(1, ...totals);
  const barW = Math.max(2, innerW / Math.max(1, chart.transfers.length) - 1);
  const xStep = innerW / Math.max(1, chart.transfers.length);
  const topCands = stats.candidateTotals.slice(0, 6).map(t => t.cand);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
      {chart.transfers.map((_, ti) => {
        const baseY = PAD_T + innerH;
        let acc = 0;
        const total = totals[ti];
        const x = PAD_L + xStep * ti + (xStep - barW) / 2;
        return (
          <g key={ti}>
            {topCands.map(cand => {
              const v = chart.candidates[cand]?.[ti] || 0;
              if (!v) return null;
              const h = (v / maxY) * innerH;
              const y = baseY - acc - h;
              acc += h;
              const dim = pinnedCand !== null && pinnedCand !== cand;
              return <rect key={cand} x={x} y={y} width={barW} height={Math.max(0.5, h)} fill={candColors[cand] || '#888'} opacity={dim ? 0.2 : 1} />;
            })}
            {/* "other" rollup as grey */}
            {(() => {
              const totalShown = topCands.reduce((acc, c) => acc + (chart.candidates[c]?.[ti] || 0), 0);
              const other = total - totalShown;
              if (other <= 0) return null;
              const h = (other / maxY) * innerH;
              const y = baseY - acc - h;
              return <rect x={x} y={y} width={barW} height={Math.max(0.5, h)} fill="#94a3b8" opacity={pinnedCand ? 0.2 : 0.7} />;
            })()}
          </g>
        );
      })}
    </svg>
  );
}

interface BarcodeChartsProps {
  source?: 'mock' | 'lims';
}

export default function BarcodeCharts(_props: BarcodeChartsProps) {
  void _props;
  const [data, setData] = useState<BarcodeDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedLibs, setSelectedLibs] = useState<Set<string>>(new Set());
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set());
  const [transferRange, setTransferRange] = useState<[number, number] | null>(null);
  const [minTotal, setMinTotal] = useState(0);
  const [candidateFilter, setCandidateFilter] = useState<Set<string>>(new Set());
  const [candidateQuery, setCandidateQuery] = useState('');
  const [onlyFlipped, setOnlyFlipped] = useState(false);

  // Rendering controls
  const [view, setView] = useState<ViewMode>('grid');
  const [colorMode, setColorMode] = useState<ColorMode>('candidate');
  const [normalize, setNormalize] = useState<Normalize>('count');
  const [topN, setTopN] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>('natural');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pinnedCand, setPinnedCand] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/barcode-counts');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: BarcodeDataset = await r.json();
      setData(j);
      setSelectedLibs(new Set(j.libraries));
      setSelectedWells(new Set(j.wells));
      const all = new Set<number>();
      j.charts.forEach(c => c.transfers.forEach(t => all.add(t)));
      const sorted = [...all].sort((a, b) => a - b);
      if (sorted.length) setTransferRange([sorted[0], sorted[sorted.length - 1]]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pre-compute stats per chart once per dataset load.
  const statsByKey = useMemo(() => {
    const m = new Map<string, ChartStats>();
    data?.charts.forEach(c => m.set(chartKey(c), statsFor(c)));
    return m;
  }, [data]);

  // Color maps shared across all charts (consistent A and B colors).
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
    aArr.forEach((k, i) => { aMap[k] = colorFor(i, aArr.length); });
    bArr.forEach((k, i) => { bMap[k] = colorFor(i, bArr.length); });
    cArr.forEach((k, i) => { cMap[k] = colorFor(i, cArr.length); });
    return { aColors: aMap, bColors: bMap, candColors: cMap, allCandidates: cArr };
  }, [data]);

  const allTransferValues = useMemo(() => {
    const s = new Set<number>();
    data?.charts.forEach(c => c.transfers.forEach(t => s.add(t)));
    return [...s].sort((a, b) => a - b);
  }, [data]);

  // Cross-chart candidate index: for each candidate, count how many charts it
  // appears in (with nonzero counts), and total reads across them.
  const candidateIndex = useMemo(() => {
    const idx = new Map<string, { charts: number; total: number }>();
    data?.charts.forEach(c => {
      for (const [cand, counts] of Object.entries(c.candidates)) {
        const sum = counts.reduce((a, v) => a + (v || 0), 0);
        if (sum <= 0) return;
        const cur = idx.get(cand) ?? { charts: 0, total: 0 };
        cur.charts += 1; cur.total += sum;
        idx.set(cand, cur);
      }
    });
    return idx;
  }, [data]);

  // Filtered + sorted chart list.
  const visibleCharts = useMemo<BarcodeChart[]>(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const filtered = data.charts
      .filter(c => selectedLibs.has(c.library))
      .filter(c => selectedWells.has(c.well))
      .filter(c => !q || `${c.well} ${c.strain} ${c.library} ${c.experiment} rep${c.replicate}`.toLowerCase().includes(q))
      .map(c => {
        if (!transferRange) return c;
        const [lo, hi] = transferRange;
        const keepIdx: number[] = [];
        c.transfers.forEach((t, i) => { if (t >= lo && t <= hi) keepIdx.push(i); });
        if (keepIdx.length === c.transfers.length) return c;
        const newCands: Record<string, number[]> = {};
        for (const [cand, counts] of Object.entries(c.candidates)) {
          newCands[cand] = keepIdx.map(i => counts[i]);
        }
        return { ...c, transfers: keepIdx.map(i => c.transfers[i]), candidates: newCands };
      })
      .filter(c => {
        const totals = c.transfers.map((_, ti) =>
          Object.values(c.candidates).reduce((acc, arr) => acc + (arr[ti] || 0), 0)
        );
        return totals.some(t => t > minTotal);
      })
      .filter(c => {
        if (pinnedCand === null) return true;
        // If a candidate is pinned, only show charts where it appears.
        return Object.entries(c.candidates).some(([cand, counts]) =>
          cand === pinnedCand && counts.some(v => v > 0));
      })
      .filter(c => {
        if (!onlyFlipped) return true;
        const s = statsByKey.get(chartKey(c));
        return !!s?.flipped;
      });

    const dir = sortDir === 'asc' ? 1 : -1;
    const cmpStat = (a: BarcodeChart, b: BarcodeChart, fn: (s: ChartStats) => number) => {
      const sa = statsByKey.get(chartKey(a))!;
      const sb = statsByKey.get(chartKey(b))!;
      return (fn(sa) - fn(sb)) * dir;
    };
    if (sortKey === 'totalReads') filtered.sort((a, b) => cmpStat(a, b, s => s.totalReads));
    else if (sortKey === 'transfers') filtered.sort((a, b) => (a.transfers.length - b.transfers.length) * dir);
    else if (sortKey === 'candidates') filtered.sort((a, b) => cmpStat(a, b, s => s.uniqueCandidates));
    else if (sortKey === 'flipped') filtered.sort((a, b) => cmpStat(a, b, s => s.flipped ? 1 : 0));

    return filtered;
  }, [data, selectedLibs, selectedWells, transferRange, minTotal, pinnedCand, onlyFlipped, search, statsByKey, sortKey, sortDir]);

  // Candidate filter list, filtered by sub-search.
  const filteredCandidates = useMemo(() => {
    const q = candidateQuery.toLowerCase().trim();
    return q ? allCandidates.filter(c => c.toLowerCase().includes(q)) : allCandidates;
  }, [allCandidates, candidateQuery]);

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const focusedChart = useMemo(() =>
    visibleCharts.find(c => chartKey(c) === focusKey) ?? visibleCharts[0] ?? null
  , [visibleCharts, focusKey]);

  const resetFilters = () => {
    setSelectedLibs(new Set(data?.libraries ?? []));
    setSelectedWells(new Set(data?.wells ?? []));
    setCandidateFilter(new Set());
    setMinTotal(0);
    setOnlyFlipped(false);
    setSearch('');
    setPinnedCand(null);
  };

  // For grid mode: simple windowing — render at most N at once, paginate by scroll.
  const [gridLimit, setGridLimit] = useState(60);
  useEffect(() => { setGridLimit(60); }, [visibleCharts.length]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 flex flex-wrap items-center gap-2 shrink-0">
        <button
          onClick={() => setShowSidebar(s => !s)}
          className="p-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700"
          title={showSidebar ? 'Hide filters' : 'Show filters'}
        >
          {showSidebar ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
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
        <span className="text-[11px] text-slate-500 dark:text-gray-400 tabular-nums">
          {visibleCharts.length}/{data?.charts.length ?? 0} charts
        </span>

        <div className="flex items-center border border-slate-200 dark:border-gray-600 rounded overflow-hidden ml-2">
          <button onClick={() => setView('grid')} className={cn('px-1.5 py-1 text-[11px]', view === 'grid' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')} title="Wall view: small thumbnails">
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setView('list')} className={cn('px-1.5 py-1 text-[11px] border-l border-slate-200 dark:border-gray-600', view === 'list' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')} title="List view: full-size charts">
            <Rows3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setView('focus')} className={cn('px-1.5 py-1 text-[11px] border-l border-slate-200 dark:border-gray-600', view === 'focus' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')} title="Focus view: one chart at a time">
            <Target className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Color</span>
          {(['candidate','partner-a','partner-b'] as ColorMode[]).map(m => (
            <button key={m} onClick={() => setColorMode(m)}
              className={cn('px-1.5 py-0.5 text-[10.5px] font-medium rounded border', colorMode === m ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300')}
              title={m === 'partner-a' ? "Color by VarA partner" : m === 'partner-b' ? 'Color by VarB partner' : 'Color by full A-B candidate'}>
              {m === 'candidate' ? 'A-B' : m === 'partner-a' ? 'VarA' : 'VarB'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Y</span>
          {(['count','fraction'] as Normalize[]).map(n => (
            <button key={n} onClick={() => setNormalize(n)}
              className={cn('px-1.5 py-0.5 text-[10.5px] font-medium rounded border', normalize === n ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300')}>
              {n === 'count' ? 'Count' : 'Fraction'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-gray-300 ml-1" title="Roll up everything past the top-N candidates into a single grey 'Other' segment, so the chart legend stays readable when libraries are large.">
          Top-N
          <input type="number" min={0} max={50} value={topN} onChange={e => setTopN(parseInt(e.target.value || '0'))}
            className="w-12 px-1 py-0.5 text-[11px] border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums" />
        </label>

        <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-gray-300">
          <input type="checkbox" checked={onlyFlipped} onChange={e => setOnlyFlipped(e.target.checked)} />
          only flipped
        </label>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="search charts (well / library / strain)"
              className="pl-7 pr-2 py-1 text-[11px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none w-56"
            />
          </div>
          <select value={`${sortKey}:${sortDir}`} onChange={e => { const [k, d] = e.target.value.split(':'); setSortKey(k as SortKey); setSortDir(d as 'asc' | 'desc'); }}
            className="text-[11px] border border-slate-300 dark:border-gray-600 rounded px-1 py-1 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none">
            <option value="natural:asc">sort: default</option>
            <option value="totalReads:desc">total reads ↓</option>
            <option value="totalReads:asc">total reads ↑</option>
            <option value="candidates:desc"># candidates ↓</option>
            <option value="candidates:asc"># candidates ↑</option>
            <option value="transfers:desc"># transfers ↓</option>
            <option value="flipped:desc">flipped first</option>
          </select>
          <button onClick={() => data && downloadBlob('barcode-counts.csv', toCsv(visibleCharts))}
            disabled={!data || visibleCharts.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={load} className="p-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Mock-data banner */}
      {data?.reason && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded border border-amber-300/60 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-[11.5px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5 leading-snug">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{data.reason}</span>
        </div>
      )}

      {/* Pinned candidate bar */}
      {pinnedCand && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded border border-blue-300/60 dark:border-blue-700/60 bg-blue-50 dark:bg-blue-900/20 text-[12px] text-blue-800 dark:text-blue-200 flex items-center gap-2">
          <Pin className="w-3.5 h-3.5" />
          <span>Pinned candidate: <span className="font-mono font-semibold">{pinnedCand}</span></span>
          <span className="text-blue-700 dark:text-blue-300/80 text-[11px]">
            ({candidateIndex.get(pinnedCand)?.charts ?? 0} charts · {candidateIndex.get(pinnedCand)?.total.toLocaleString() ?? 0} reads)
          </span>
          <button onClick={() => setPinnedCand(null)} className="ml-auto p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50">
            <PinOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main split: filter rail + chart area */}
      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <div className="w-72 shrink-0 border-r border-slate-200 dark:border-gray-700 flex flex-col overflow-hidden bg-slate-50/40 dark:bg-gray-800/40">
            {/* Transfer range */}
            {transferRange && allTransferValues.length > 1 && (
              <div className="p-2 border-b border-slate-200 dark:border-gray-700">
                <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                  Transfers <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">T{transferRange[0]}–T{transferRange[1]}</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="range" min={allTransferValues[0]} max={allTransferValues[allTransferValues.length - 1]}
                    value={transferRange[0]}
                    onChange={e => setTransferRange([Math.min(parseInt(e.target.value), transferRange[1]), transferRange[1]])}
                    className="flex-1" />
                  <input type="range" min={allTransferValues[0]} max={allTransferValues[allTransferValues.length - 1]}
                    value={transferRange[1]}
                    onChange={e => setTransferRange([transferRange[0], Math.max(parseInt(e.target.value), transferRange[0])])}
                    className="flex-1" />
                </div>
              </div>
            )}

            <div className="p-2 border-b border-slate-200 dark:border-gray-700">
              <label className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                <span>Min total / transfer</span>
                <span className="text-slate-400 dark:text-gray-500 font-normal normal-case tabular-nums">{minTotal}</span>
              </label>
              <input type="range" min={0} max={100} step={1} value={minTotal}
                onChange={e => setMinTotal(parseInt(e.target.value))} className="w-full" />
            </div>

            {data && (
              <>
                {/* Libraries */}
                <div className="p-2 border-b border-slate-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                    <span>Libraries <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">({selectedLibs.size}/{data.libraries.length})</span></span>
                    <button onClick={() => setSelectedLibs(prev => prev.size === data.libraries.length ? new Set() : new Set(data.libraries))}
                      className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline">
                      {selectedLibs.size === data.libraries.length ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto -mr-1 pr-1">
                    {data.libraries.map(lib => (
                      <label key={lib} className="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer">
                        <input type="checkbox" checked={selectedLibs.has(lib)} onChange={() => setSelectedLibs(prev => toggle(prev, lib))} />
                        <span className="font-mono truncate text-slate-700 dark:text-gray-200" title={lib}>{lib}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Wells */}
                <div className="p-2 border-b border-slate-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                    <span>Wells <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">({selectedWells.size}/{data.wells.length})</span></span>
                    <button onClick={() => setSelectedWells(prev => prev.size === data.wells.length ? new Set() : new Set(data.wells))}
                      className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline">
                      {selectedWells.size === data.wells.length ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                    {data.wells.map(w => (
                      <button key={w} onClick={() => setSelectedWells(prev => toggle(prev, w))}
                        className={cn('px-1.5 py-0.5 text-[10.5px] font-mono rounded border', selectedWells.has(w)
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300')}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Candidate index — clickable */}
                <div className="p-2 flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                    <span>Candidates <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">({candidateFilter.size > 0 ? `${candidateFilter.size} kept` : `${allCandidates.length} total`})</span></span>
                    {candidateFilter.size > 0 && (
                      <button onClick={() => setCandidateFilter(new Set())}
                        className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline">Clear</button>
                    )}
                  </div>
                  <div className="relative mb-1">
                    <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={candidateQuery} onChange={e => setCandidateQuery(e.target.value)}
                      placeholder="e.g. A153 or B151"
                      className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1">
                    {filteredCandidates.slice(0, 500).map(c => {
                      const idx = candidateIndex.get(c);
                      const isFilter = candidateFilter.has(c);
                      const isPinned = pinnedCand === c;
                      return (
                        <div key={c} className={cn(
                          'flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded',
                          isPinned ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-slate-100 dark:hover:bg-gray-700'
                        )}>
                          <input type="checkbox" checked={isFilter} onChange={() => setCandidateFilter(prev => toggle(prev, c))} title="Restrict charts to this candidate set" />
                          <button
                            onClick={() => setPinnedCand(p => p === c ? null : c)}
                            className={cn('flex-1 text-left flex items-center justify-between gap-1 truncate', isPinned ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-slate-700 dark:text-gray-200')}
                            title="Pin this candidate — dims all others across every chart and filters charts to those containing it"
                          >
                            <span className="font-mono inline-flex items-center gap-1">
                              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: candColors[c] }} />
                              {c}
                            </span>
                            <span className="text-[10px] tabular-nums text-slate-400 dark:text-gray-500">{idx ? `${idx.charts}× · ${idx.total}` : ''}</span>
                          </button>
                        </div>
                      );
                    })}
                    {filteredCandidates.length > 500 && (
                      <p className="text-[10.5px] text-slate-400 px-1 py-1">+ {filteredCandidates.length - 500} more — narrow the search</p>
                    )}
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-500 dark:text-gray-400 leading-snug">
                    Checkbox = restrict the chart to a subset. Click the name = pin (dim everything else, focus charts containing it).
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Chart area */}
        <div className="flex-1 min-w-0 overflow-auto p-2 bg-slate-100/30 dark:bg-gray-900/30"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (view === 'grid' && el.scrollTop + el.clientHeight >= el.scrollHeight - 60 && gridLimit < visibleCharts.length) {
              setGridLimit(g => Math.min(g + 60, visibleCharts.length));
            }
          }}>
          {loading && <Centered><Loader2 className="w-4 h-4 animate-spin" /> Loading…</Centered>}
          {error && <Centered><AlertTriangle className="w-4 h-4 text-red-500" /> {error}</Centered>}
          {!loading && !error && data && visibleCharts.length === 0 && (
            <Centered>
              <span>No charts match the current filters.</span>
              <button onClick={resetFilters} className="text-xs text-emerald-600 dark:text-emerald-400 underline">Reset filters</button>
            </Centered>
          )}

          {view === 'grid' && visibleCharts.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
              {visibleCharts.slice(0, gridLimit).map(c => {
                const stats = statsByKey.get(chartKey(c))!;
                return (
                  <button
                    key={chartKey(c)}
                    onClick={() => { setFocusKey(chartKey(c)); setView('focus'); }}
                    className="text-left rounded border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-emerald-400 hover:shadow-md transition-shadow overflow-hidden"
                    title="Open in focus view"
                  >
                    <div className="px-1.5 py-1 border-b border-slate-200/50 dark:border-gray-700/50 flex items-center gap-1 text-[10px]">
                      <span className="font-mono font-bold text-slate-700 dark:text-gray-200">{c.well}</span>
                      <span className="font-mono text-slate-500 dark:text-gray-400 truncate" title={c.library}>{c.library}</span>
                      {stats.flipped && <span className="ml-auto text-[8.5px] font-bold uppercase text-amber-600">flip</span>}
                    </div>
                    <ThumbChart chart={c} stats={stats} candColors={candColors} pinnedCand={pinnedCand} />
                    <div className="px-1.5 py-0.5 text-[9.5px] text-slate-500 dark:text-gray-400 tabular-nums flex justify-between border-t border-slate-200/50 dark:border-gray-700/50">
                      <span>rep {c.replicate} · {c.transfers.length}T</span>
                      <span>{stats.totalReads.toLocaleString()}</span>
                    </div>
                  </button>
                );
              })}
              {gridLimit < visibleCharts.length && (
                <div className="col-span-full text-center text-[11px] text-slate-400 py-3">
                  Showing {gridLimit}/{visibleCharts.length}. Scroll to load more…
                </div>
              )}
            </div>
          )}

          {view === 'list' && visibleCharts.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              {visibleCharts.slice(0, gridLimit).map(c => (
                <ChartCard
                  key={chartKey(c)} chart={c} stats={statsByKey.get(chartKey(c))!}
                  colorMode={colorMode} normalize={normalize}
                  aColors={aColors} bColors={bColors} candColors={candColors}
                  candidateFilter={candidateFilter} topN={topN}
                  pinnedCand={pinnedCand} height={240}
                  onPickCandidate={(c) => setPinnedCand(p => p === c ? null : c)}
                />
              ))}
              {gridLimit < visibleCharts.length && (
                <div className="col-span-full text-center text-[11px] text-slate-400 py-3">
                  Showing {gridLimit}/{visibleCharts.length}. Scroll to load more…
                </div>
              )}
            </div>
          )}

          {view === 'focus' && focusedChart && (
            <div className="flex flex-col gap-2">
              <FocusNav charts={visibleCharts} focusKey={chartKey(focusedChart)} onPick={k => setFocusKey(k)} statsByKey={statsByKey} />
              <div className="max-w-[1100px]">
                <ChartCard
                  chart={focusedChart} stats={statsByKey.get(chartKey(focusedChart))!}
                  colorMode={colorMode} normalize={normalize}
                  aColors={aColors} bColors={bColors} candColors={candColors}
                  candidateFilter={candidateFilter} topN={topN}
                  pinnedCand={pinnedCand} height={340}
                  onPickCandidate={(c) => setPinnedCand(p => p === c ? null : c)}
                />
              </div>
              <FocusLegend chart={focusedChart} stats={statsByKey.get(chartKey(focusedChart))!} candColors={candColors} pinnedCand={pinnedCand} onPick={c => setPinnedCand(p => p === c ? null : c)} topN={topN} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-gray-400 gap-2 text-sm">
      {children}
    </div>
  );
}

function FocusNav({ charts, focusKey, onPick, statsByKey }: {
  charts: BarcodeChart[]; focusKey: string; onPick: (k: string) => void; statsByKey: Map<string, ChartStats>;
}) {
  const idx = charts.findIndex(c => chartKey(c) === focusKey);
  const prev = idx > 0 ? charts[idx - 1] : null;
  const next = idx >= 0 && idx < charts.length - 1 ? charts[idx + 1] : null;
  return (
    <div className="flex items-center gap-2 text-[11.5px] bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 px-2 py-1.5">
      <button onClick={() => prev && onPick(chartKey(prev))} disabled={!prev}
        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-30">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-slate-500 dark:text-gray-400 tabular-nums">{idx + 1}/{charts.length}</span>
      <select value={focusKey} onChange={e => onPick(e.target.value)}
        className="text-[11.5px] border border-slate-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none font-mono max-w-[480px]">
        {charts.map(c => {
          const s = statsByKey.get(chartKey(c));
          return (
            <option key={chartKey(c)} value={chartKey(c)}>
              {c.well} · {c.library} · rep {c.replicate} {s?.flipped ? '· FLIP' : ''} · {s?.totalReads ?? 0} reads
            </option>
          );
        })}
      </select>
      <button onClick={() => next && onPick(chartKey(next))} disabled={!next}
        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-30">
        <ChevronRight className="w-4 h-4" />
      </button>
      <span className="ml-auto text-[10.5px] text-slate-500 dark:text-gray-400">← / → and ↑ / ↓ work too</span>
      <KeyboardNav charts={charts} focusKey={focusKey} onPick={onPick} />
    </div>
  );
}

function KeyboardNav({ charts, focusKey, onPick }: { charts: BarcodeChart[]; focusKey: string; onPick: (k: string) => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || (e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      const idx = charts.findIndex(c => chartKey(c) === focusKey);
      if (idx === -1) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && idx < charts.length - 1) onPick(chartKey(charts[idx + 1]));
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && idx > 0) onPick(chartKey(charts[idx - 1]));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [charts, focusKey, onPick]);
  return null;
}

function FocusLegend({ chart, stats, candColors, pinnedCand, onPick, topN }: {
  chart: BarcodeChart; stats: ChartStats; candColors: Record<string, string>; pinnedCand: string | null; onPick: (c: string) => void; topN: number;
}) {
  const sorted = stats.candidateTotals;
  const rolled = topN > 0 && sorted.length > topN;
  const head = rolled ? sorted.slice(0, topN) : sorted;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-1">
        Candidates (click to pin) {rolled && <span className="normal-case font-normal text-slate-400">— top {topN} of {sorted.length}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {head.map(({ cand, total }) => {
          const dim = pinnedCand !== null && pinnedCand !== cand;
          const pin = pinnedCand === cand;
          const pct = stats.totalReads ? (100 * total / stats.totalReads).toFixed(1) : '0.0';
          return (
            <button key={cand} onClick={() => onPick(cand)}
              className={cn(
                'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[11px] font-mono transition-opacity',
                pin ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200' :
                dim ? 'border-slate-200 dark:border-gray-700 opacity-40' :
                'border-slate-200 dark:border-gray-700 hover:border-emerald-400'
              )}
              title={`${cand}: ${total} reads (${pct}%)`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: candColors[cand] }} />
              {cand}
              <span className="text-[10px] text-slate-500 dark:text-gray-400 tabular-nums">{pct}%</span>
            </button>
          );
        })}
        {rolled && (
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-700 text-[11px] text-slate-500 dark:text-gray-400">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-400" />
            Other ({sorted.length - topN})
          </span>
        )}
      </div>
    </div>
  );
}

// keep imports referenced even if not used in some builds
void Maximize2; void Minimize2; void ArrowDown; void ArrowUp; void X; void List;
