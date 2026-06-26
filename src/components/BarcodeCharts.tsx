'use client';

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, ChevronLeft, ChevronRight,
  Columns3, Download, Filter, Info, LayoutGrid, List, Loader2, Maximize2,
  Minimize2, Pin, Plus, RefreshCw, Rows3, Search, Sparkles, Target, X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { fetchData } from '../lib/dataSource';

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

type ViewMode = 'grid' | 'focus' | 'compare';
type ColorMode = 'candidate' | 'partner-a' | 'partner-b';
type Normalize = 'count' | 'fraction';
type SortKey = 'natural' | 'totalReads' | 'transfers' | 'candidates' | 'flipped';
type CandSortKey = 'reads' | 'charts' | 'name' | 'varA' | 'varB';
type CandGroupKey = 'none' | 'varA' | 'varB';

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

// Stable per-CANDIDATE color: the color of a subunit combination (e.g. A1-B1) is
// derived from the A and B numbers themselves, NOT from the candidate's rank in
// whatever set happens to be loaded. This guarantees A1-B1 is the SAME color in
// every chart, every sample, every experiment, so a reviewer can track one
// combination by color across the whole dataset (requested by Nidhi 2026-06).
// We fold (a,b) into a single ordinal with a large odd multiplier on the A index
// so the golden-angle rotation spreads neighbouring combinations far apart in hue.
function colorForCandidate(label: string): string {
  const p = parseCandidate(label);
  if (!p) {
    // Fallback for non A#-B# labels (e.g. "__OTHER__"): stable hash of the string.
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360} 65% 50%)`;
  }
  const a = parseInt(p.a.slice(1), 10) || 0;
  const b = parseInt(p.b.slice(1), 10) || 0;
  const ordinal = a * 97 + b; // 97 = large prime so A-rows do not collide in hue
  const hue = (ordinal * GOLDEN) % 360;
  return `hsl(${hue} 65% 50%)`;
}

function chartKey(c: BarcodeChart): string {
  return `${c.experiment}/${c.library}/${c.well}/r${c.replicate}`;
}

// Per-candidate cross-chart detail popup. Shows how ONE A-B subunit combination
// behaves across EVERY chart/sample: a combined fraction-over-transfers line chart
// (one faint line per chart the candidate appears in), plus total reads, the number
// of charts it appears in, and its peak fraction and where that peak occurred. This
// is the "track A1-B1 across all conditions and transfers at once" view Nidhi wanted.
function CandidateDetailModal({
  cand, charts, candColors, candidateIndex, isSelected, onToggleSelect, onClose,
}: {
  cand: string;
  charts: BarcodeChart[];
  candColors: Record<string, string>;
  candidateIndex: Map<string, { charts: number; total: number }>;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const color = candColors[cand] || '#2563eb';
  const idx = candidateIndex.get(cand) ?? { charts: 0, total: 0 };

  // Build one fraction-over-transfers series per chart that contains this candidate.
  // Fraction = candidate reads / total reads at that transfer, so charts with very
  // different depths are comparable. Track the global peak fraction and where.
  const { series, xMax, peak } = useMemo(() => {
    const out: { key: string; label: string; pts: { x: number; y: number }[] }[] = [];
    let xMaxLocal = 1;
    let peakLocal = { frac: 0, transfer: 0, label: '' };
    for (const c of charts) {
      const counts = c.candidates[cand];
      if (!counts) continue;
      const pts: { x: number; y: number }[] = [];
      c.transfers.forEach((t, i) => {
        const tot = Object.values(c.candidates).reduce((a, arr) => a + (arr[i] || 0), 0);
        const frac = tot > 0 ? (counts[i] || 0) / tot : 0;
        pts.push({ x: t, y: frac });
        if (t > xMaxLocal) xMaxLocal = t;
        if (frac > peakLocal.frac) {
          peakLocal = { frac, transfer: t, label: `${c.well || c.strain || c.library} r${c.replicate}` };
        }
      });
      if (pts.some(p => p.y > 0)) {
        out.push({ key: chartKey(c), label: `${c.well || c.strain} r${c.replicate} (${c.library})`, pts });
      }
    }
    return { series: out, xMax: xMaxLocal, peak: peakLocal };
  }, [cand, charts]);

  // Chart geometry (fraction 0..1 on Y, transfer on X).
  const W = 720, H = 320, padL = 44, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const sx = (x: number) => padL + (xMax > 0 ? (x / xMax) * plotW : 0);
  const sy = (y: number) => padT + plotH - y * plotH; // y is a fraction 0..1
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xStep = xMax <= 12 ? 1 : Math.ceil(xMax / 12);
  const xTicks: number[] = [];
  for (let v = 0; v <= xMax; v += xStep) xTicks.push(v);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <span className="inline-block w-4 h-4 rounded-sm shrink-0" style={{ background: color }} />
          <span className="font-mono font-semibold text-[15px] text-slate-800 dark:text-gray-100">{cand}</span>
          <span className="text-[11.5px] text-slate-500 dark:text-gray-400">barcode combination across all charts</span>
          <button
            onClick={onToggleSelect}
            className={cn('ml-auto text-[11.5px] px-2 py-1 rounded border font-medium',
              isSelected
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700')}
          >
            {isSelected ? 'Selected' : 'Select'}
          </button>
          <button onClick={onClose} title="Close (Esc)"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stat cards */}
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11.5px]">
          <Stat label="appears in" value={`${idx.charts} chart${idx.charts === 1 ? '' : 's'}`} />
          <Stat label="total reads" value={idx.total.toLocaleString()} />
          <Stat label="peak fraction" value={`${(peak.frac * 100).toFixed(1)}%`} accent />
          <Stat label="peak at" value={peak.frac > 0 ? `T${peak.transfer} · ${peak.label}` : 'n/a'} />
        </div>

        {/* Cross-chart fraction-over-transfers chart */}
        <div className="px-4 pb-4">
          <div className="text-[11px] text-slate-500 dark:text-gray-400 mb-1">
            Fraction of reads over transfers, one line per chart this combination appears in
            ({series.length} chart{series.length === 1 ? '' : 's'}).
          </div>
          {series.length === 0 ? (
            <div className="text-[12px] text-slate-400 dark:text-gray-500 py-8 text-center">
              No nonzero measurements for this combination.
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img"
              aria-label={`Fraction over transfers for ${cand}`}>
              {/* y gridlines + labels */}
              {yTicks.map(v => (
                <g key={`y${v}`}>
                  <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="currentColor" className="text-slate-200 dark:text-gray-700" strokeWidth="1" />
                  <text x={padL - 6} y={sy(v) + 3} textAnchor="end" className="text-[9px] fill-slate-400 dark:fill-gray-500">{Math.round(v * 100)}%</text>
                </g>
              ))}
              {/* x ticks */}
              {xTicks.map(v => (
                <text key={`x${v}`} x={sx(v)} y={H - padB + 14} textAnchor="middle" className="text-[9px] fill-slate-400 dark:fill-gray-500">T{v}</text>
              ))}
              <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="text-[10px] fill-slate-500 dark:fill-gray-400">Transfer</text>
              {/* one faint line per chart, in the candidate's color */}
              {series.map(s => {
                const d = s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
                return (
                  <g key={s.key}>
                    <path d={d} fill="none" stroke={color} strokeWidth="1.6" opacity={0.55} strokeLinejoin="round" strokeLinecap="round" />
                    {s.pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="1.8" fill={color} opacity={0.7} />)}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('flex flex-col px-2.5 py-1.5 rounded border',
      accent ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
             : 'border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800')}>
      <span className="text-[9.5px] uppercase tracking-wider text-slate-500 dark:text-gray-400">{label}</span>
      <span className={cn('text-[13px] font-semibold tabular-nums', accent ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-gray-100')}>{value}</span>
    </div>
  );
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
  // ONE coherent selection concept shared by every view. When non-empty, the
  // selected candidates are emphasized (solid) and the rest are dimmed for
  // context. With isolateSelected on, the rest are hidden entirely.
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;            // 0 = no rollup, else collapse the rest into "other"
  hoverCand?: string | null;  // transient highlight (e.g. sidebar row hover); no persistent stroke
  height: number;          // SVG inner height target
  onPickCandidate?: (cand: string) => void;
}

function ChartCard({
  chart, stats, colorMode, normalize, aColors, bColors, candColors,
  selectedCands, isolateSelected, topN, hoverCand, height, onPickCandidate,
}: ChartProps) {
  // Hover tooltip state — managed in React so we get instant feedback
  // and rich content (multi-line, color swatch). SVG <title> stays as a
  // fallback for accessibility / native tools.
  const [hover, setHover] = useState<{ x: number; y: number; text: string; flipX?: boolean; flipY?: boolean } | null>(null);
  // Rendered candidate set is derived in ONE predictable order so the three
  // views never disagree:
  //   1. start from every candidate in this chart
  //   2. if "Isolate selected" is on AND there is a selection, keep only the
  //      selected candidates (hard filter)
  //   3. apply the Top-N rollup (collapse the long tail into "Other")
  // When a selection exists but isolate is OFF, ALL candidates stay drawn and
  // the unselected ones are simply dimmed (handled later via isDimmed), so the
  // user is never confused by silently-dropped bars.
  const { visibleCands, otherCands } = useMemo(() => {
    let all = Object.keys(chart.candidates);
    if (isolateSelected && selectedCands.size > 0) all = all.filter(c => selectedCands.has(c));
    if (topN <= 0 || all.length <= topN) return { visibleCands: all, otherCands: [] as string[] };
    const ordered = stats.candidateTotals.map(t => t.cand).filter(c => all.includes(c));
    return { visibleCands: ordered.slice(0, topN), otherCands: ordered.slice(topN) };
  }, [chart.candidates, isolateSelected, selectedCands, topN, stats.candidateTotals]);

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
  // Emphasis rules (consistent across grid / focus / compare):
  //   - hoveredCand wins instantly: it is the only solid bar while a hover is active.
  //   - otherwise, if a selection exists, selected candidates are solid and the
  //     rest are dimmed for context.
  //   - with no hover and no selection, everything is solid.
  const hasSelection = selectedCands.size > 0;
  const isSelected = (cand: string) => selectedCands.has(cand);
  const isEmphasized = (cand: string) => {
    if (hoverCand) return cand === hoverCand;
    if (hasSelection) return isSelected(cand);
    return true;
  };
  const isDimmed = (cand: string) => cand !== '__OTHER__' && !isEmphasized(cand) && (hoverCand != null || hasSelection);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-2 text-[12px] shrink-0">
        {chart.well && (
          <>
            <span className="font-mono font-semibold text-slate-800 dark:text-gray-100">{chart.well}</span>
            <span className="text-slate-400">|</span>
          </>
        )}
        <span className="font-mono text-slate-700 dark:text-gray-200">{chart.strain}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-700 dark:text-gray-200 truncate" title={chart.library}>{chart.library}</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-600 dark:text-gray-300">Rep {chart.replicate}</span>
        <div className="ml-auto flex items-center gap-2 text-[10.5px] tabular-nums text-slate-500 dark:text-gray-400">
          {stats.flipped && (
            <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold uppercase tracking-wider" title={`Flip: dominant A-B candidate changed between the first and last transfer (${stats.dominantAtFirst} to ${stats.dominantAtLast})`}>
              flip
            </span>
          )}
          {/* Make degenerate charts read as intentional, not broken/placeholder. */}
          {chart.transfers.length === 1 && (
            <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-600" title="This well has a single sequenced transfer, so the chart shows one bar.">
              1 transfer
            </span>
          )}
          {stats.uniqueCandidates === 1 && (
            <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-600" title="Only one candidate is present, so the bar is a single solid block by design.">
              single candidate
            </span>
          )}
          <span title="Distinct A-B candidates in this chart">{stats.uniqueCandidates} cands</span>
          <span title="Total reads across all transfers">· {stats.totalReads.toLocaleString()} reads</span>
        </div>
      </div>

      <div className="p-2 relative flex-1 min-h-0 flex" onMouseLeave={() => setHover(null)}>
        {hover && (
          <div
            className="absolute z-30 pointer-events-none px-2 py-1 rounded bg-slate-900/95 dark:bg-gray-950/95 text-white text-[11px] font-mono shadow-lg ring-1 ring-black/20"
            style={{
              // Sit the tooltip well clear of the cursor: offset down-right far
              // enough that the pointer arrow never overlaps the text. Flip to the
              // left near the right edge, and below the cursor near the top edge.
              left: hover.x,
              top: hover.y,
              transform: `translate(${hover.flipX ? 'calc(-100% - 18px)' : '18px'}, ${hover.flipY ? '20px' : 'calc(-100% - 14px)'})`,
              whiteSpace: 'pre',
            }}
          >
            {hover.text}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet"
          onMouseMove={(e) => {
            // keep tooltip glued to cursor while inside the svg
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            setHover(h => h ? { ...h, x: px, y: py, flipX: px > rect.width - 200, flipY: py < 56 } : h);
          }}>
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
                  const selected = cand !== '__OTHER__' && hasSelection && isSelected(cand);
                  const dim = isDimmed(cand);
                  const pctNum = total ? (100 * v / total) : 0;
                  const pctStr = total ? `${pctNum.toFixed(0)}%` : '';
                  const pctStrFine = total ? `${pctNum.toFixed(1)}%` : '';
                  const showName = h >= LABEL_NAME_MIN_H && barW >= 38;
                  const showWide = showName && barW >= 60; // room for name + count + %
                  const showCount = h >= LABEL_MIN_H;
                  const midY = y + h / 2;
                  const inlineLabel = cand === '__OTHER__'
                    ? `Other · ${v}${pctStr ? ` · ${pctStr}` : ''}`
                    : showWide
                      ? `${cand}  ${v} · ${pctStr}`
                      : showName
                        ? `${cand} · ${pctStr || v}`
                        : `${v}${pctStr ? ` · ${pctStr}` : ''}`;
                  const tipText = cand === '__OTHER__'
                    ? `Other (${otherCands.length} candidates)\nT${t}: ${v}${total ? `\n${pctStrFine} of bar total` : ''}\nbar total: ${total}`
                    : `${cand}\nT${t}: ${v}${total ? `\n${pctStrFine} of bar total` : ''}\nbar total: ${total}`;
                  return (
                    <g key={cand}>
                      <rect
                        x={x} y={y} width={barW} height={Math.max(0.5, h)}
                        fill={color}
                        stroke={selected ? '#0f172a' : 'rgba(255,255,255,0.4)'}
                        strokeWidth={selected ? 1.5 : 0.4}
                        opacity={dim ? 0.16 : 1}
                        style={{ cursor: cand !== '__OTHER__' && onPickCandidate ? 'pointer' : 'default' }}
                        onClick={() => cand !== '__OTHER__' && onPickCandidate?.(cand)}
                        onMouseEnter={(e) => {
                          const svg = (e.currentTarget as SVGRectElement).ownerSVGElement;
                          const rect = svg?.getBoundingClientRect();
                          const px = rect ? e.clientX - rect.left : 0;
                          const py = rect ? e.clientY - rect.top : 0;
                          setHover({ x: px, y: py, text: tipText, flipX: rect ? px > rect.width - 200 : false, flipY: py < 56 });
                        }}
                        onMouseLeave={() => setHover(null)}
                      >
                        <title>{tipText.replace(/\n/g, ' · ')}</title>
                      </rect>
                      {showCount && !dim && (
                        <text
                          x={cx} y={midY + 3.5} textAnchor="middle"
                          fontSize={showWide ? 11.5 : showName ? 11 : 10.5}
                          className="pointer-events-none"
                          style={{ fill: 'white', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 2.6, strokeLinejoin: 'round', fontWeight: 700 }}
                        >
                          {inlineLabel}
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

// Tiny sparkline thumbnail used in the wall view. Honors the same selection
// semantics as the big charts: when a selection exists, selected candidates are
// solid and the rest are dimmed; a hover overrides as the single solid bar.
function ThumbChart({ chart, stats, candColors, selectedCands, isolateSelected, hoverCand }: { chart: BarcodeChart; stats: ChartStats; candColors: Record<string, string>; selectedCands: Set<string>; isolateSelected: boolean; hoverCand?: string | null }) {
  const hasSelection = selectedCands.size > 0;
  const isEmphasized = (cand: string) => {
    if (hoverCand) return cand === hoverCand;
    if (hasSelection) return selectedCands.has(cand);
    return true;
  };
  const dimActive = hoverCand != null || hasSelection;
  const W = 130, H = 60;
  const PAD_L = 10, PAD_R = 4, PAD_T = 4, PAD_B = 12;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const totals = chart.transfers.map((_, ti) =>
    Object.values(chart.candidates).reduce((acc, arr) => acc + (arr[ti] || 0), 0)
  );
  const maxY = Math.max(1, ...totals);
  const barW = Math.max(2, innerW / Math.max(1, chart.transfers.length) - 1);
  const xStep = innerW / Math.max(1, chart.transfers.length);
  // Show the top-6 by reads, but always include any selected candidates that
  // live in this chart so the user can see them even when they sit in the tail.
  // With isolate on, show only the selected candidates that are present here.
  const top6 = stats.candidateTotals.slice(0, 6).map(t => t.cand);
  let topCands: string[];
  if (isolateSelected && hasSelection) {
    topCands = stats.candidateTotals.map(t => t.cand).filter(c => selectedCands.has(c));
  } else if (hasSelection) {
    const set = new Set(top6);
    for (const t of stats.candidateTotals) if (selectedCands.has(t.cand)) set.add(t.cand);
    topCands = stats.candidateTotals.map(t => t.cand).filter(c => set.has(c));
  } else {
    topCands = top6;
  }
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
              const dim = dimActive && !isEmphasized(cand);
              return <rect key={cand} x={x} y={y} width={barW} height={Math.max(0.5, h)} fill={candColors[cand] || '#888'} opacity={dim ? 0.18 : 1} />;
            })}
            {/* "other" rollup as grey */}
            {(() => {
              const totalShown = topCands.reduce((acc, c) => acc + (chart.candidates[c]?.[ti] || 0), 0);
              const other = total - totalShown;
              if (other <= 0) return null;
              const h = (other / maxY) * innerH;
              const y = baseY - acc - h;
              return <rect x={x} y={y} width={barW} height={Math.max(0.5, h)} fill="#94a3b8" opacity={dimActive ? 0.18 : 0.7} />;
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
  // ONE coherent selection concept (replaces the old pinnedCand single + the
  // candidateFilter set). selectedCands drives BOTH chart filtering and the
  // within-chart emphasis everywhere. isolateSelected toggles dim-for-context
  // (off) vs hard-hide-the-rest (on).
  const [selectedCands, setSelectedCands] = useState<Set<string>>(new Set());
  const [isolateSelected, setIsolateSelected] = useState(false);
  // Candidate whose cross-chart detail popup is open (null = closed).
  const [detailCand, setDetailCand] = useState<string | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [onlyFlipped, setOnlyFlipped] = useState(false);

  // Rendering controls
  const [view, setView] = useState<ViewMode>('grid');
  const [comparing, setComparing] = useState<string[]>([]); // up to 4 chart keys
  const COMPARE_MAX = 4;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersBtnRef = useRef<HTMLButtonElement | null>(null);
  const filtersPopRef = useRef<HTMLDivElement | null>(null);
  const [candSort, setCandSort] = useState<CandSortKey>('reads');
  const [candGroup, setCandGroup] = useState<CandGroupKey>('none');
  const [colorMode, setColorMode] = useState<ColorMode>('candidate');
  const [normalize, setNormalize] = useState<Normalize>('count');
  const [topN, setTopN] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>('natural');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Transient hover highlight: hovering a candidate row in the sidebar lights up
  // that candidate's segments across every visible chart (without committing a pin).
  const [hoveredCand, setHoveredCand] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  // Compare view defaults to no sidebar — the chart area needs the room.
  useEffect(() => { setShowSidebar(view !== 'compare'); }, [view]);
  // Close filter popover on outside click.
  useEffect(() => {
    if (!filtersOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filtersPopRef.current?.contains(t)) return;
      if (filtersBtnRef.current?.contains(t)) return;
      setFiltersOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filtersOpen]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchData('/api/barcode-counts');
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
    // Colors are derived from the subunit identity (the A number, the B number, or
    // the A-B combination) rather than from list position, so the same subunit or
    // combination keeps ONE color across every chart/sample/experiment. This lets a
    // reviewer track e.g. A1-B1 by its color anywhere (Nidhi 2026-06).
    aArr.forEach(k => { aMap[k] = colorFor((parseInt(k.slice(1), 10) || 0) * 13, 0); });
    bArr.forEach(k => { bMap[k] = colorFor((parseInt(k.slice(1), 10) || 0) * 13, 0); });
    cArr.forEach(k => { cMap[k] = colorForCandidate(k); });
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
    // If the dataset carries no wells (e.g. amplicon barcodes upstream
    // haven't been linked to plate positions), the wells filter is a no-op
    // — same for libraries.
    const hasWells = data.wells.length > 0;
    const hasLibs = data.libraries.length > 0;
    const filtered = data.charts
      .filter(c => !hasLibs || selectedLibs.has(c.library))
      .filter(c => !hasWells || !c.well || selectedWells.has(c.well))
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
        // CHART FILTERING: when a selection exists, only show charts that contain
        // at least one selected candidate with nonzero reads. This is the fix for
        // the bug where the left-sidebar selection did nothing to the chart set.
        if (selectedCands.size === 0) return true;
        return Object.entries(c.candidates).some(([cand, counts]) =>
          selectedCands.has(cand) && counts.some(v => v > 0));
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
  }, [data, selectedLibs, selectedWells, transferRange, minTotal, selectedCands, onlyFlipped, search, statsByKey, sortKey, sortDir]);

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

  // Set of every candidate that appears (with nonzero reads) in the currently
  // visible charts. Drives "select all visible" and lets the sidebar mark which
  // rows are actually on screen. O(visibleCharts * candidates), memoized.
  const visibleCandSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of visibleCharts) {
      for (const [cand, counts] of Object.entries(c.candidates)) {
        if (counts.some(v => v > 0)) s.add(cand);
      }
    }
    return s;
  }, [visibleCharts]);

  // Toggle one candidate in/out of the selection (used by sidebar + focus legend).
  const toggleCand = useCallback((cand: string) => {
    setSelectedCands(prev => {
      const next = new Set(prev);
      if (next.has(cand)) next.delete(cand); else next.add(cand);
      return next;
    });
  }, []);

  const resetFilters = () => {
    setSelectedLibs(new Set(data?.libraries ?? []));
    setSelectedWells(new Set(data?.wells ?? []));
    setSelectedCands(new Set());
    setIsolateSelected(false);
    setMinTotal(0);
    setOnlyFlipped(false);
    setSearch('');
  };

  // For grid mode: simple windowing — render at most N at once, paginate by scroll.
  const [gridLimit, setGridLimit] = useState(60);
  useEffect(() => { setGridLimit(60); }, [visibleCharts.length]);

  // Active-filter count for the toolbar Filters button badge.
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (data) {
      if (data.libraries.length > 0 && selectedLibs.size > 0 && selectedLibs.size < data.libraries.length) n++;
      if (data.wells.length > 0 && selectedWells.size > 0 && selectedWells.size < data.wells.length) n++;
    }
    if (transferRange && allTransferValues.length > 1) {
      const lo0 = allTransferValues[0], hi0 = allTransferValues[allTransferValues.length - 1];
      if (transferRange[0] > lo0 || transferRange[1] < hi0) n++;
    }
    if (minTotal > 0) n++;
    if (onlyFlipped) n++;
    if (search.trim()) n++;
    return n;
  }, [data, selectedLibs, selectedWells, transferRange, allTransferValues, minTotal, onlyFlipped, search]);

  // Sorted + (optionally) grouped candidate list for the sidebar browser.
  const candidateRows = useMemo(() => {
    if (!data) return [] as { cand: string; charts: number; total: number }[];
    const q = candidateQuery.trim().toLowerCase();
    const base = allCandidates
      .filter(c => !q || c.toLowerCase().includes(q))
      .map(c => {
        const idx = candidateIndex.get(c);
        return { cand: c, charts: idx?.charts ?? 0, total: idx?.total ?? 0 };
      });
    const numFromA = (c: string) => { const m = c.match(/^A(\d+)/); return m ? parseInt(m[1]) : 0; };
    const numFromB = (c: string) => { const m = c.match(/-B(\d+)/); return m ? parseInt(m[1]) : 0; };
    if (candSort === 'reads') base.sort((a, b) => b.total - a.total || a.cand.localeCompare(b.cand));
    else if (candSort === 'charts') base.sort((a, b) => b.charts - a.charts || b.total - a.total);
    else if (candSort === 'name') base.sort((a, b) => a.cand.localeCompare(b.cand));
    else if (candSort === 'varA') base.sort((a, b) => numFromA(a.cand) - numFromA(b.cand) || a.cand.localeCompare(b.cand));
    else if (candSort === 'varB') base.sort((a, b) => numFromB(a.cand) - numFromB(b.cand) || a.cand.localeCompare(b.cand));
    return base;
  }, [data, allCandidates, candidateIndex, candidateQuery, candSort]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Compact, single-row toolbar. Heavy filters live behind the Filters
          popover so the candidate sidebar isn't squeezed. */}
      <div className="px-2 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setShowSidebar(s => !s)}
          className="p-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700"
          title={showSidebar ? 'Hide candidates sidebar' : 'Show candidates sidebar'}
        >
          {showSidebar ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        {/* Source badge. Mock stays loud (amber warning) because it means the
            view is NOT showing real LIMS data. The normal 'lims' source is
            rendered small and quiet so it stops competing for attention. */}
        {data && (data.source === 'mock' ? (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60"
            title="Showing MOCK data, not live LIMS data"
          >
            <AlertTriangle className="w-3 h-3" />
            Mock
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-gray-500"
            title="Live data from LIMS"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            LIMS
          </span>
        ))}
        {/* Labeled shown/total counter. When a filter trims the set, it turns
            blue/accent and reads "N of TOTAL" so it's obvious charts are hidden. */}
        {(() => {
          const total = data?.charts.length ?? 0;
          const shown = visibleCharts.length;
          const isFiltered = shown < total;
          return (
            <span
              className={cn(
                'text-[11px] tabular-nums px-1.5 py-0.5 rounded',
                isFiltered
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 font-semibold border border-blue-200 dark:border-blue-800'
                  : 'text-slate-500 dark:text-gray-400'
              )}
              title={isFiltered
                ? `${shown} of ${total} charts shown (filters are hiding ${total - shown})`
                : `All ${total} charts shown`}
            >
              {shown} of {total} charts{isFiltered ? ' shown' : ''}
            </span>
          );
        })()}

        {/* View mode */}
        <div className="flex items-center border border-slate-200 dark:border-gray-600 rounded overflow-hidden ml-1">
          <button onClick={() => setView('grid')} className={cn('flex items-center gap-1 px-2 py-1 text-[11px]', view === 'grid' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')} title="Grid: all charts as thumbnails">
            <LayoutGrid className="w-3.5 h-3.5" /> Grid
          </button>
          <button onClick={() => setView('focus')} className={cn('flex items-center gap-1 px-2 py-1 text-[11px] border-l border-slate-200 dark:border-gray-600', view === 'focus' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')} title="Focus: one chart, full-detail">
            <Target className="w-3.5 h-3.5" /> Focus
          </button>
          <button
            onClick={() => setView('compare')}
            disabled={comparing.length === 0}
            className={cn('flex items-center gap-1 px-2 py-1 text-[11px] border-l border-slate-200 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed',
              view === 'compare' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')}
            title={comparing.length === 0 ? "Pick charts in Grid first (click the +)" : `Compare ${comparing.length} chart${comparing.length === 1 ? '' : 's'} side-by-side`}>
            <Columns3 className="w-3.5 h-3.5" /> Compare
            {comparing.length > 0 && <span className="ml-0.5 px-1 rounded bg-emerald-700/30 tabular-nums">{comparing.length}</span>}
          </button>
        </div>

        {/* Color */}
        <div className="flex items-center border border-slate-200 dark:border-gray-600 rounded overflow-hidden">
          {(['candidate','partner-a','partner-b'] as ColorMode[]).map((m, i) => (
            <button key={m} onClick={() => setColorMode(m)}
              className={cn('px-1.5 py-1 text-[10.5px] font-medium', i > 0 && 'border-l border-slate-200 dark:border-gray-600',
                colorMode === m ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')}
              title={m === 'partner-a' ? "Color by VarA partner" : m === 'partner-b' ? 'Color by VarB partner' : 'Color by full A-B candidate'}>
              {m === 'candidate' ? 'A-B' : m === 'partner-a' ? 'VarA' : 'VarB'}
            </button>
          ))}
        </div>

        {/* Y axis */}
        <div className="flex items-center border border-slate-200 dark:border-gray-600 rounded overflow-hidden">
          {(['count','fraction'] as Normalize[]).map((n, i) => (
            <button key={n} onClick={() => setNormalize(n)}
              className={cn('px-1.5 py-1 text-[10.5px] font-medium', i > 0 && 'border-l border-slate-200 dark:border-gray-600',
                normalize === n ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')}>
              {n === 'count' ? 'Count' : 'Fraction'}
            </button>
          ))}
        </div>

        {/* Filters popover trigger */}
        <div className="relative">
          <button
            ref={filtersBtnRef}
            onClick={() => setFiltersOpen(o => !o)}
            className={cn('flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border',
              activeFilterCount > 0
                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200'
                : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-600')}
            title="Open filters (transfers, libraries, wells, …)"
          >
            <Filter className="w-3.5 h-3.5" /> Filters
            {activeFilterCount > 0 && <span className="ml-0.5 px-1 rounded-full bg-blue-600 text-white text-[10px] tabular-nums font-bold">{activeFilterCount}</span>}
          </button>
          {filtersOpen && data && (
            <div ref={filtersPopRef} className="absolute left-0 top-full mt-1 w-80 z-30 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-slate-200 dark:border-gray-700 p-2.5 text-[11.5px] text-slate-700 dark:text-gray-200 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-800 dark:text-gray-100">Filters</span>
                <button onClick={resetFilters}
                  className="text-[11px] text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 underline">
                  Reset all
                </button>
              </div>

              {/* search */}
              <div className="mb-2">
                <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Search</label>
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="well / library / strain"
                    className="w-full pl-7 pr-2 py-1 text-[11.5px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                </div>
              </div>

              {/* sort */}
              <div className="mb-2">
                <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Sort charts</label>
                <select value={`${sortKey}:${sortDir}`} onChange={e => { const [k, d] = e.target.value.split(':'); setSortKey(k as SortKey); setSortDir(d as 'asc' | 'desc'); }}
                  className="w-full text-[11.5px] border border-slate-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none">
                  <option value="natural:asc">default (experiment · library · well)</option>
                  <option value="totalReads:desc">total reads ↓</option>
                  <option value="totalReads:asc">total reads ↑</option>
                  <option value="candidates:desc"># candidates ↓</option>
                  <option value="candidates:asc"># candidates ↑</option>
                  <option value="transfers:desc"># transfers ↓</option>
                  <option value="flipped:desc">flipped first</option>
                </select>
              </div>

              {/* Top-N + flipped */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <label className="flex items-center gap-1.5 text-[11.5px]" title="Roll up everything past the top-N candidates into a single grey 'Other' segment.">
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400">Top-N</span>
                  <input type="number" min={0} max={50} value={topN} onChange={e => setTopN(parseInt(e.target.value || '0'))}
                    className="w-14 px-1 py-0.5 text-[11.5px] border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none tabular-nums" />
                </label>
                <label className="flex items-center gap-1.5 text-[11.5px]" title="Show only charts where the dominant A-B candidate at the first transfer differs from the one at the last transfer (a 'flip').">
                  <input type="checkbox" checked={onlyFlipped} onChange={e => setOnlyFlipped(e.target.checked)} />
                  <span>only flipped</span>
                  <Info className="w-3 h-3 text-slate-400" />
                </label>
              </div>
              {/* One-line definition so the amber "flip" badge on charts is never a mystery. */}
              <p className="-mt-1 mb-2 text-[10.5px] leading-snug text-slate-500 dark:text-gray-400">
                A chart is &quot;flipped&quot; when its dominant A-B candidate changes between the first and last transfer.
              </p>

              {/* Transfers */}
              {transferRange && allTransferValues.length > 1 && (
                <div className="mb-2 border-t border-slate-100 dark:border-gray-700 pt-2">
                  <label className="block text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                    Transfers <span className="font-normal normal-case text-slate-400">T{transferRange[0]}–T{transferRange[1]}</span>
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

              {/* Min total */}
              <div className="mb-2 border-t border-slate-100 dark:border-gray-700 pt-2">
                <label className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                  <span>Min total / transfer</span>
                  <span className="font-normal normal-case tabular-nums text-slate-400">{minTotal}</span>
                </label>
                <input type="range" min={0} max={100} step={1} value={minTotal}
                  onChange={e => setMinTotal(parseInt(e.target.value))} className="w-full" />
              </div>

              {/* Libraries */}
              <div className="mb-2 border-t border-slate-100 dark:border-gray-700 pt-2">
                <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                  <span>Libraries <span className="font-normal normal-case text-slate-400">({selectedLibs.size}/{data.libraries.length})</span></span>
                  <button onClick={() => setSelectedLibs(prev => prev.size === data.libraries.length ? new Set() : new Set(data.libraries))}
                    className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline">
                    {selectedLibs.size === data.libraries.length ? 'Clear' : 'All'}
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto -mr-1 pr-1">
                  {data.libraries.map(lib => (
                    <label key={lib} className="flex items-center gap-2 text-[11.5px] px-1 py-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer">
                      <input type="checkbox" checked={selectedLibs.has(lib)} onChange={() => setSelectedLibs(prev => toggle(prev, lib))} />
                      <span className="font-mono truncate" title={lib}>{lib}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Wells — only shown when the dataset carries plate positions */}
              {data.wells.length > 0 && (
                <div className="mb-1 border-t border-slate-100 dark:border-gray-700 pt-2">
                  <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">
                    <span>Wells <span className="font-normal normal-case text-slate-400">({selectedWells.size}/{data.wells.length})</span></span>
                    <button onClick={() => setSelectedWells(prev => prev.size === data.wells.length ? new Set() : new Set(data.wells))}
                      className="text-emerald-600 dark:text-emerald-400 normal-case font-medium hover:underline">
                      {selectedWells.size === data.wells.length ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                    {data.wells.map(w => (
                      <button key={w} onClick={() => setSelectedWells(prev => toggle(prev, w))}
                        className={cn('px-2 py-0.5 text-[11px] font-mono rounded border', selectedWells.has(w)
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300')}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Unified selection chip. Visible in every view (even when the sidebar is
              hidden) so a selection is never silently active. Shows the count, an
              "Isolate" toggle (dim-for-context vs hard-hide-others) and a clear button. */}
          {selectedCands.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
              title={`${selectedCands.size} candidate${selectedCands.size === 1 ? '' : 's'} selected. Charts are filtered to those containing a selected candidate, and selected candidates are emphasized inside every chart.`}>
              <Target className="w-3 h-3" />
              {selectedCands.size} selected
              <button
                onClick={() => setIsolateSelected(v => !v)}
                className={cn('ml-0.5 px-1 py-0.5 rounded text-[10px] font-semibold border',
                  isolateSelected
                    ? 'bg-blue-600 text-white border-blue-700'
                    : 'bg-white/70 dark:bg-gray-800/60 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-200')}
                title={isolateSelected
                  ? 'Isolate ON: unselected candidates are hidden. Click to dim them for context instead.'
                  : 'Isolate OFF: unselected candidates are dimmed for context. Click to hide them entirely.'}>
                Isolate
              </button>
              <button onClick={() => setSelectedCands(new Set())} className="ml-0.5 hover:text-blue-900 dark:hover:text-white" title="Clear selection">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button onClick={() => data && downloadBlob('barcode-counts.csv', toCsv(visibleCharts))}
            disabled={!data || visibleCharts.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50"
            title="Download visible charts as CSV">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={load} className="p-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700" title="Reload">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Mock-data banner */}
      {data?.reason && (
        <div className="mx-2 mt-2 px-2.5 py-1.5 rounded border border-amber-300/60 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-[11.5px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5 leading-snug">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{data.reason}</span>
        </div>
      )}

      {/* Main split: candidates rail + chart area */}
      <div className="flex flex-1 min-h-0">
        {showSidebar && data && (
          <CandidatesSidebar
            rows={candidateRows}
            allCount={allCandidates.length}
            candColors={candColors}
            selectedCands={selectedCands}
            setSelectedCands={setSelectedCands}
            isolateSelected={isolateSelected}
            setIsolateSelected={setIsolateSelected}
            setHoveredCand={setHoveredCand}
            onOpenDetail={setDetailCand}
            visibleCandSet={visibleCandSet}
            candidateIndex={candidateIndex}
            candidateQuery={candidateQuery}
            setCandidateQuery={setCandidateQuery}
            candSort={candSort}
            setCandSort={setCandSort}
            candGroup={candGroup}
            setCandGroup={setCandGroup}
          />
        )}

        {/* Chart area — internal scroll behavior depends on the view mode:
            grid scrolls vertically (thumbnails); focus & compare fill the
            viewport and only the candidate legend scrolls inside its column. */}
        <div className="flex-1 min-w-0 flex flex-col bg-slate-100/30 dark:bg-gray-900/30 overflow-hidden">
          {loading && <div className="flex-1 overflow-auto"><Centered><Loader2 className="w-4 h-4 animate-spin" /> Loading…</Centered></div>}
          {error && <div className="flex-1 overflow-auto"><Centered><AlertTriangle className="w-4 h-4 text-red-500" /> {error}</Centered></div>}
          {!loading && !error && data && visibleCharts.length === 0 && (
            <div className="flex-1 overflow-auto"><Centered>
              <span>No charts match the current filters.</span>
              <button onClick={resetFilters} className="text-xs text-emerald-600 dark:text-emerald-400 underline">Reset filters</button>
            </Centered></div>
          )}

          {!loading && !error && view === 'grid' && visibleCharts.length > 0 && (
            <div className="flex-1 min-h-0 overflow-auto p-2"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60 && gridLimit < visibleCharts.length) {
                  setGridLimit(g => Math.min(g + 60, visibleCharts.length));
                }
              }}>
              {comparing.length > 0 && (
                <div className="mb-2 px-2 py-1.5 rounded border border-emerald-300/60 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-900/20 text-[11.5px] flex items-center gap-2 sticky top-0 z-10 backdrop-blur">
                  <Columns3 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  <span className="font-semibold text-emerald-800 dark:text-emerald-200">{comparing.length}</span>
                  <span className="text-emerald-700 dark:text-emerald-300">queued for compare</span>
                  <button onClick={() => setView('compare')} className="ml-auto px-2 py-0.5 text-[11px] font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700">
                    Compare →
                  </button>
                  <button onClick={() => setComparing([])} className="px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded">Clear</button>
                </div>
              )}
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {visibleCharts.slice(0, gridLimit).map(c => {
                  const stats = statsByKey.get(chartKey(c))!;
                  const k = chartKey(c);
                  const inCompare = comparing.includes(k);
                  return (
                    <div
                      key={k}
                      className={cn(
                        'group relative text-left rounded border bg-white dark:bg-gray-800 hover:shadow-md transition-all overflow-hidden cursor-pointer',
                        inCompare ? 'border-emerald-500 ring-1 ring-emerald-400' : 'border-slate-200 dark:border-gray-700 hover:border-emerald-400'
                      )}
                      onClick={() => { setFocusKey(k); setView('focus'); }}
                      title="Click to open in Focus"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setComparing(prev => {
                            if (prev.includes(k)) return prev.filter(x => x !== k);
                            if (prev.length >= COMPARE_MAX) return [...prev.slice(1), k];
                            return [...prev, k];
                          });
                        }}
                        className={cn(
                          'absolute top-1 right-1 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold transition-all shadow-sm',
                          inCompare
                            ? 'bg-emerald-600 text-white border border-emerald-700'
                            // Always visible (subtle) so the affordance is discoverable; pops on hover.
                            : 'bg-white dark:bg-gray-900/80 text-slate-500 dark:text-gray-300 border border-slate-300 dark:border-gray-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-400 dark:hover:bg-emerald-900/30'
                        )}
                        title={inCompare ? 'Remove from compare' : `Add to compare (max ${COMPARE_MAX} side-by-side)`}
                      >
                        {inCompare ? '✓' : '+'}
                      </button>
                      <div className="px-1.5 py-1 border-b border-slate-200/50 dark:border-gray-700/50 flex items-center gap-1 text-[10px] pr-7">
                        {c.well
                          ? <span className="font-mono font-bold text-slate-700 dark:text-gray-200">{c.well}</span>
                          : <span className="font-mono font-bold text-slate-700 dark:text-gray-200">r{c.replicate}</span>}
                        <span className="font-mono text-slate-500 dark:text-gray-400 truncate" title={c.library}>{c.library}</span>
                        {stats.flipped && <span className="ml-auto text-[8.5px] font-bold uppercase text-amber-600" title="Flip: dominant candidate changed from first to last transfer">flip</span>}
                      </div>
                      <ThumbChart chart={c} stats={stats} candColors={candColors} selectedCands={selectedCands} isolateSelected={isolateSelected} hoverCand={hoveredCand} />
                      <div className="px-1.5 py-0.5 text-[9.5px] text-slate-500 dark:text-gray-400 tabular-nums flex justify-between border-t border-slate-200/50 dark:border-gray-700/50">
                        <span title={`Replicate ${c.replicate} · ${c.transfers.length} transfer${c.transfers.length === 1 ? '' : 's'}`}>rep {c.replicate} · {c.transfers.length}T</span>
                        <span title={`${stats.totalReads.toLocaleString()} total reads`}>{stats.totalReads.toLocaleString()} reads</span>
                      </div>
                    </div>
                  );
                })}
                {gridLimit < visibleCharts.length && (
                  <div className="col-span-full text-center text-[11px] text-slate-400 py-3">
                    Showing {gridLimit}/{visibleCharts.length}. Scroll for more…
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && !error && view === 'focus' && focusedChart && (
            <FocusView
              charts={visibleCharts}
              focusKey={chartKey(focusedChart)}
              setFocusKey={k => setFocusKey(k)}
              chart={focusedChart}
              stats={statsByKey.get(chartKey(focusedChart))!}
              colorMode={colorMode} normalize={normalize}
              aColors={aColors} bColors={bColors} candColors={candColors}
              selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
              onToggleCand={toggleCand} onOpenDetail={setDetailCand}
              onBack={() => setView('grid')}
              hoveredCand={hoveredCand}
              onHoverCandidate={setHoveredCand}
              onAddToCompare={(k) => setComparing(prev => prev.includes(k) ? prev : prev.length >= COMPARE_MAX ? [...prev.slice(1), k] : [...prev, k])}
              isInCompare={comparing.includes(chartKey(focusedChart))}
            />
          )}

          {!loading && !error && view === 'compare' && (
            <CompareView
              keys={comparing}
              charts={data?.charts ?? []}
              statsByKey={statsByKey}
              colorMode={colorMode} normalize={normalize}
              aColors={aColors} bColors={bColors} candColors={candColors}
              selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
              onToggleCand={toggleCand}
              onBack={() => setView('grid')}
              hoveredCand={hoveredCand}
              onRemove={(k) => setComparing(prev => prev.filter(x => x !== k))}
            />
          )}
        </div>
      </div>

      {/* Per-candidate cross-chart detail popup. */}
      {detailCand && data && (
        <CandidateDetailModal
          cand={detailCand}
          charts={data.charts}
          candColors={candColors}
          candidateIndex={candidateIndex}
          isSelected={selectedCands.has(detailCand)}
          onToggleSelect={() => toggleCand(detailCand)}
          onClose={() => setDetailCand(null)}
        />
      )}
    </div>
  );
}

// Dedicated Candidates browser sidebar. Replaces the old multi-section
// sidebar; everything other than candidate manipulation now lives in the
// Filters popover, so this panel gets the full vertical space for its
// scrollable list and its rows are tall enough to click comfortably.
interface CandidatesSidebarProps {
  rows: { cand: string; charts: number; total: number }[];
  allCount: number;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  setSelectedCands: React.Dispatch<React.SetStateAction<Set<string>>>;
  isolateSelected: boolean;
  setIsolateSelected: React.Dispatch<React.SetStateAction<boolean>>;
  setHoveredCand: React.Dispatch<React.SetStateAction<string | null>>;
  onOpenDetail: (cand: string) => void;
  visibleCandSet: Set<string>;
  candidateIndex: Map<string, { charts: number; total: number }>;
  candidateQuery: string;
  setCandidateQuery: (s: string) => void;
  candSort: CandSortKey;
  setCandSort: (s: CandSortKey) => void;
  candGroup: CandGroupKey;
  setCandGroup: (g: CandGroupKey) => void;
}
function CandidatesSidebar(p: CandidatesSidebarProps) {
  const grouped = useMemo(() => {
    if (p.candGroup === 'none') return [{ label: null as string | null, rows: p.rows }];
    const buckets = new Map<string, typeof p.rows>();
    for (const r of p.rows) {
      const m = r.cand.match(/^(A\d+)-(B\d+)$/);
      const key = p.candGroup === 'varA' ? (m?.[1] ?? '—') : (m?.[2] ?? '—');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    const ord = [...buckets.keys()].sort((a, b) => {
      const na = parseInt(a.slice(1)) || 0, nb = parseInt(b.slice(1)) || 0;
      return na - nb;
    });
    return ord.map(k => ({ label: k, rows: buckets.get(k)! }));
  }, [p.rows, p.candGroup]);

  const RENDER_CAP = 800;
  let rendered = 0;

  return (
    <div className="w-72 shrink-0 border-r border-slate-200 dark:border-gray-700 flex flex-col overflow-hidden bg-white dark:bg-gray-800">
      {/* Header — title + search */}
      <div className="px-2.5 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800 dark:text-gray-100">
            <Pin className="w-3.5 h-3.5 text-blue-500" /> Candidates
            <span className="text-[10.5px] text-slate-500 dark:text-gray-400 font-normal tabular-nums">
              {p.candidateQuery ? `${p.rows.length}/${p.allCount}` : p.allCount.toLocaleString()}
            </span>
          </div>
          {p.selectedCands.size > 0 && (
            <button
              onClick={() => p.setSelectedCands(new Set())}
              className="text-[10.5px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
              title="Clear the candidate selection"
            >
              Clear ({p.selectedCands.size})
            </button>
          )}
        </div>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={p.candidateQuery}
            onChange={e => p.setCandidateQuery(e.target.value)}
            placeholder="A153, B151, A153-B30…"
            className="w-full pl-7 pr-2 py-1.5 text-[12px] border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none"
          />
        </div>
      </div>

      {/* Sort + group controls */}
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-gray-700 flex items-center gap-2 text-[10.5px] text-slate-600 dark:text-gray-300">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Sort</span>
        <select value={p.candSort} onChange={e => p.setCandSort(e.target.value as CandSortKey)}
          className="text-[11px] border border-slate-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none">
          <option value="reads">reads ↓</option>
          <option value="charts">in N charts ↓</option>
          <option value="name">name A→Z</option>
          <option value="varA">VarA #</option>
          <option value="varB">VarB #</option>
        </select>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Group</span>
        <select value={p.candGroup} onChange={e => p.setCandGroup(e.target.value as CandGroupKey)}
          className="text-[11px] border border-slate-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none">
          <option value="none">none</option>
          <option value="varA">by VarA</option>
          <option value="varB">by VarB</option>
        </select>
      </div>

      {/* Selection controls: bulk select/clear + the Isolate toggle. */}
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-gray-700 flex items-center gap-1.5 text-[10.5px]">
        <button
          onClick={() => p.setSelectedCands(prev => {
            const next = new Set(prev);
            // Add every candidate that is currently on screen (in a visible chart).
            for (const c of p.visibleCandSet) next.add(c);
            return next;
          })}
          disabled={p.visibleCandSet.size === 0}
          className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-40"
          title="Select every candidate that appears in the currently visible charts"
        >
          Select visible
        </button>
        <button
          onClick={() => p.setSelectedCands(new Set())}
          disabled={p.selectedCands.size === 0}
          className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-40"
          title="Clear the candidate selection"
        >
          Clear
        </button>
        <label className="ml-auto flex items-center gap-1 cursor-pointer select-none"
          title="Isolate ON hides unselected candidates inside every chart. Isolate OFF dims them for context.">
          <input type="checkbox" checked={p.isolateSelected}
            onChange={e => p.setIsolateSelected(e.target.checked)}
            disabled={p.selectedCands.size === 0}
            className="w-3.5 h-3.5 cursor-pointer disabled:opacity-40" />
          <span className={cn(p.selectedCands.size === 0 && 'opacity-40')}>Isolate selected</span>
        </label>
      </div>

      {/* Selection status row */}
      {p.selectedCands.size > 0 && (
        <div className="px-2.5 py-1.5 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-[11px] flex items-center gap-1.5">
          <Target className="w-3 h-3 text-blue-600 dark:text-blue-300 shrink-0" />
          <span className="text-blue-700 dark:text-blue-200">
            {p.selectedCands.size} selected · charts filtered + emphasized
          </span>
          <button onClick={() => p.setSelectedCands(new Set())}
            className="ml-auto p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-200"
            title="Clear selection">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Body — scrolling list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {grouped.map((grp, gi) => (
          <div key={grp.label ?? `g-${gi}`}>
            {grp.label !== null && (
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-600 dark:text-gray-300 bg-slate-100/80 dark:bg-gray-800/80 sticky top-0 z-10 border-y border-slate-200 dark:border-gray-700">
                {grp.label} <span className="text-slate-400 font-normal normal-case">({grp.rows.length})</span>
              </div>
            )}
            {grp.rows.map(({ cand, charts, total }) => {
              if (rendered >= RENDER_CAP) return null;
              rendered++;
              const isSel = p.selectedCands.has(cand);
              const onScreen = p.visibleCandSet.has(cand);
              return (
                <div
                  key={cand}
                  className={cn(
                    'group flex items-center gap-2 px-2.5 py-1.5 text-[12px] border-b border-slate-100/70 dark:border-gray-700/40 transition-colors',
                    isSel ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-slate-100 dark:hover:bg-gray-700/60'
                  )}
                  onMouseEnter={() => p.setHoveredCand(cand)}
                  onMouseLeave={() => p.setHoveredCand(null)}
                  title={`${cand}: appears in ${charts} chart${charts === 1 ? '' : 's'}, ${total.toLocaleString()} total reads. Hover highlights it across all charts; tick or click the name to select it (filters charts + emphasizes); click the info icon for a cross-chart detail view.`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => p.setSelectedCands(prev => {
                      const next = new Set(prev);
                      if (next.has(cand)) next.delete(cand); else next.add(cand);
                      return next;
                    })}
                    className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                    title="Select this candidate (filters charts to those containing it + emphasizes it)"
                    onClick={e => e.stopPropagation()}
                  />
                  <button
                    onClick={() => p.setSelectedCands(prev => {
                      const next = new Set(prev);
                      if (next.has(cand)) next.delete(cand); else next.add(cand);
                      return next;
                    })}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <span className="inline-block w-3 h-3 rounded shrink-0" style={{ background: p.candColors[cand], outline: onScreen ? undefined : '1px dashed rgba(148,163,184,0.7)', outlineOffset: '1px' }} />
                    <span className={cn('flex-1 truncate font-mono', isSel ? 'text-blue-800 dark:text-blue-100 font-semibold' : 'text-slate-700 dark:text-gray-200')}>
                      {cand}
                    </span>
                    <span className="text-[10.5px] tabular-nums text-slate-400 dark:text-gray-500 shrink-0">
                      {charts}× · {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); p.onOpenDetail(cand); }}
                    className="shrink-0 p-0.5 rounded text-slate-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-slate-200/60 dark:hover:bg-gray-700"
                    title={`Open ${cand} detail: how this A-B combination behaves across all charts and transfers`}
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {p.rows.length > RENDER_CAP && (
          <p className="text-[10.5px] text-slate-400 px-2.5 py-2">
            Showing first {RENDER_CAP} of {p.rows.length}. Narrow the search to see more.
          </p>
        )}
        {p.rows.length === 0 && (
          <p className="text-[11px] text-slate-400 px-2.5 py-4 text-center">
            No candidates match the search.
          </p>
        )}
      </div>

      {/* Footer legend */}
      <div className="px-2.5 py-1.5 border-t border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 text-[10.5px] text-slate-500 dark:text-gray-400 leading-snug">
        <div className="flex items-center gap-1.5"><input type="checkbox" disabled checked readOnly className="w-3 h-3" /> select (filters charts + emphasizes)</div>
        <div className="flex items-center gap-1.5 mt-0.5"><Info className="w-3 h-3" /> open cross-chart detail · hover a row to highlight</div>
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

// Side-panel candidate legend used in Focus view — always-visible column
// (the column itself scrolls if it overflows; the chart never does). Honors the
// same selection semantics as the sidebar: clicking a row toggles selection,
// hovering highlights, and the info icon opens the cross-chart detail popup.
function CandidateLegendPanel({ chart, stats, candColors, selectedCands, onToggle, onHover, onOpenDetail, topN }: {
  chart: BarcodeChart; stats: ChartStats; candColors: Record<string, string>; selectedCands: Set<string>; onToggle: (c: string) => void; onHover?: (c: string | null) => void; onOpenDetail?: (c: string) => void; topN: number;
}) {
  void chart;
  const sorted = stats.candidateTotals;
  const rolled = topN > 0 && sorted.length > topN;
  const hasSelection = selectedCands.size > 0;
  const maxPct = sorted[0]?.total && stats.totalReads ? (100 * sorted[0].total / stats.totalReads) : 100;
  return (
    <div className="flex flex-col h-full">
      <div className="px-2.5 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-gray-200 mb-0.5">
          <span>Candidates in this chart</span>
          <span className="text-slate-500 dark:text-gray-400 tabular-nums font-normal">{sorted.length}</span>
        </div>
        <div className="text-[10px] text-slate-500 dark:text-gray-400">
          % of {stats.totalReads.toLocaleString()} reads · click to select · info for detail
          {rolled && <> · top {topN} bold</>}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.map(({ cand, total }, i) => {
          const sel = selectedCands.has(cand);
          // With a selection active, unselected rows are dimmed for context.
          const dim = hasSelection && !sel;
          const isTop = topN > 0 && i < topN;
          const pctNum = stats.totalReads ? (100 * total / stats.totalReads) : 0;
          const pctStr = pctNum >= 10 ? pctNum.toFixed(0) : pctNum.toFixed(1);
          // Relative bar width — scaled so the dominant candidate fills the
          // gauge. Gives a visual sense of distribution at a glance.
          const barPct = maxPct ? Math.min(100, (pctNum / maxPct) * 100) : 0;
          return (
            <div key={cand}
              onMouseEnter={() => onHover?.(cand)}
              onMouseLeave={() => onHover?.(null)}
              className={cn(
                'group w-full flex items-center gap-2 px-2.5 py-1.5 border-b border-slate-100 dark:border-gray-700/40 transition-colors',
                sel ? 'bg-blue-50 dark:bg-blue-900/30' :
                dim ? 'opacity-40 hover:opacity-100' : 'hover:bg-slate-50 dark:hover:bg-gray-700/60'
              )}
              title={`${cand}: ${total.toLocaleString()} reads - ${pctNum.toFixed(2)}% of bar total. Click to select, hover to highlight, info for cross-chart detail.`}
            >
              <input type="checkbox" checked={sel} onChange={() => onToggle(cand)}
                className="w-3.5 h-3.5 shrink-0 cursor-pointer" onClick={e => e.stopPropagation()}
                title="Select this candidate" />
              <button onClick={() => onToggle(cand)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                {/* color swatch */}
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: candColors[cand] }} />
                {/* name + relative-pct bar */}
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-1.5">
                    <span className={cn('truncate font-mono text-[12px]',
                      sel ? 'text-blue-800 dark:text-blue-100 font-bold' :
                      isTop ? 'text-slate-800 dark:text-gray-100 font-semibold' : 'text-slate-600 dark:text-gray-300')}>
                      {cand}
                    </span>
                    <span className="text-[10px] tabular-nums text-slate-400 dark:text-gray-500 shrink-0">
                      {total >= 1000 ? `${(total/1000).toFixed(1)}k` : total}
                    </span>
                  </span>
                  <span className="block mt-0.5 h-1 rounded-full bg-slate-100 dark:bg-gray-700 overflow-hidden">
                    <span className="block h-full" style={{ width: `${barPct}%`, background: candColors[cand] }} />
                  </span>
                </span>
                {/* big percentage, the metric that matters */}
                <span className={cn(
                  'shrink-0 tabular-nums font-bold text-right',
                  'text-[14px] leading-tight',
                  sel ? 'text-blue-700 dark:text-blue-200' :
                  pctNum >= 10 ? 'text-slate-800 dark:text-gray-100' : 'text-slate-500 dark:text-gray-400',
                )} style={{ width: 46 }}>
                  {pctStr}<span className="text-[9.5px] font-normal text-slate-500 dark:text-gray-400">%</span>
                </span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onOpenDetail?.(cand); }}
                className="shrink-0 p-0.5 rounded text-slate-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-slate-200/60 dark:hover:bg-gray-700"
                title={`Open ${cand} detail across all charts and transfers`}>
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface FocusViewProps {
  charts: BarcodeChart[];
  focusKey: string;
  setFocusKey: (k: string) => void;
  chart: BarcodeChart;
  stats: ChartStats;
  colorMode: ColorMode;
  normalize: Normalize;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;
  onToggleCand: (c: string) => void;
  onOpenDetail: (c: string) => void;
  onBack: () => void;
  hoveredCand?: string | null;
  onHoverCandidate?: (c: string | null) => void;
  onAddToCompare: (k: string) => void;
  isInCompare: boolean;
}
function FocusView(props: FocusViewProps) {
  const { charts, focusKey, setFocusKey, chart, stats, colorMode, normalize,
    aColors, bColors, candColors, selectedCands, isolateSelected, topN, onToggleCand, onOpenDetail,
    onBack, hoveredCand, onHoverCandidate, onAddToCompare, isInCompare } = props;
  const idx = charts.findIndex(c => chartKey(c) === focusKey);
  const prev = idx > 0 ? charts[idx - 1] : null;
  const next = idx >= 0 && idx < charts.length - 1 ? charts[idx + 1] : null;

  // Keyboard nav: ←/→ ↑/↓ for prev/next, Esc to go back to grid.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'SELECT' || t?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') { onBack(); return; }
      const i = charts.findIndex(c => chartKey(c) === focusKey);
      if (i === -1) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && i < charts.length - 1) {
        e.preventDefault(); setFocusKey(chartKey(charts[i + 1]));
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && i > 0) {
        e.preventDefault(); setFocusKey(chartKey(charts[i - 1]));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [charts, focusKey, setFocusKey, onBack]);

  // Height of the inner chart sized to fill the available container.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartHeight, setChartHeight] = useState(320);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight - 56; // leave room for the card title bar + padding
      setChartHeight(Math.max(220, Math.min(640, h)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [focusKey]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* In-view nav bar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[11.5px] shrink-0">
        <button onClick={onBack} title="Back to Grid (Esc)"
          className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-200 font-medium">
          <ChevronLeft className="w-3.5 h-3.5" /> Grid
        </button>
        <div className="flex items-center gap-0.5">
          <button onClick={() => prev && setFocusKey(chartKey(prev))} disabled={!prev}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-30" title="Previous (←)">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-slate-500 dark:text-gray-400 tabular-nums px-1">{idx + 1}/{charts.length}</span>
          <button onClick={() => next && setFocusKey(chartKey(next))} disabled={!next}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-30" title="Next (→)">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <select value={focusKey} onChange={e => setFocusKey(e.target.value)}
          className="text-[11.5px] border border-slate-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none font-mono min-w-[260px] max-w-[560px]">
          {charts.map(c => (
            <option key={chartKey(c)} value={chartKey(c)}>
              {c.well ? `${c.well} · ` : ''}{c.library} · rep {c.replicate}
            </option>
          ))}
        </select>
        <button onClick={() => onAddToCompare(chartKey(chart))}
          className={cn('flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium',
            isInCompare ? 'bg-emerald-600 text-white border-emerald-700' : 'border-slate-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700')}
          title="Queue this chart for the Compare view">
          <Plus className="w-3.5 h-3.5" /> {isInCompare ? 'Queued' : 'Compare'}
        </button>
        <span className="ml-auto text-[10.5px] text-slate-400 dark:text-gray-500 hidden md:inline">← / → navigate · Esc back to grid</span>
      </div>

      {/* Full, untruncated identity for the focused chart (the dropdown above can
          clip long library names; this line always shows them in full). */}
      <div className="px-3 py-1 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 text-[11.5px] flex flex-wrap items-center gap-x-2 gap-y-0.5 shrink-0">
        {chart.well && <span className="font-mono font-semibold text-slate-800 dark:text-gray-100">{chart.well}</span>}
        <span className="font-mono text-slate-700 dark:text-gray-200">{chart.strain}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-700 dark:text-gray-200">{chart.library}</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-600 dark:text-gray-300">Rep {chart.replicate}</span>
        <span className="text-slate-400">|</span>
        <span className="font-mono text-slate-500 dark:text-gray-400">{chart.experiment}</span>
        <span className="ml-auto tabular-nums text-slate-500 dark:text-gray-400">
          {stats.uniqueCandidates} candidate{stats.uniqueCandidates === 1 ? '' : 's'} · {stats.totalReads.toLocaleString()} reads · {chart.transfers.length} transfer{chart.transfers.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Body: chart fills left, legend column on right (legend scrolls, chart doesn't) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div ref={containerRef} className="flex-1 min-w-0 min-h-0 p-2 flex">
          <div className="flex-1 min-w-0 min-h-0">
            <ChartCard
              chart={chart} stats={stats}
              colorMode={colorMode} normalize={normalize}
              aColors={aColors} bColors={bColors} candColors={candColors}
              selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
              height={chartHeight}
              hoverCand={hoveredCand}
              onPickCandidate={onToggleCand}
            />
          </div>
        </div>
        <div className="w-80 shrink-0 border-l border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden">
          <CandidateLegendPanel
            chart={chart} stats={stats} candColors={candColors}
            selectedCands={selectedCands} onToggle={onToggleCand} onHover={onHoverCandidate} onOpenDetail={onOpenDetail} topN={topN}
          />
        </div>
      </div>
    </div>
  );
}

interface CompareViewProps {
  keys: string[];
  charts: BarcodeChart[];
  statsByKey: Map<string, ChartStats>;
  colorMode: ColorMode;
  normalize: Normalize;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;
  onToggleCand: (c: string) => void;
  onBack: () => void;
  hoveredCand?: string | null;
  onRemove: (k: string) => void;
}
function CompareView(props: CompareViewProps) {
  const { keys, charts, statsByKey, colorMode, normalize, aColors, bColors,
    candColors, selectedCands, isolateSelected, topN, onToggleCand, onBack, hoveredCand, onRemove } = props;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack]);

  const resolved = keys
    .map(k => charts.find(c => chartKey(c) === k))
    .filter((c): c is BarcodeChart => !!c);
  // Pick a grid layout that fits the count nicely (1, 2-col, 2x2, 3x2).
  const cols = resolved.length <= 1 ? 1 : resolved.length === 2 ? 2 : 2;
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[11.5px] shrink-0">
        <button onClick={onBack} title="Back to Grid (Esc)"
          className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-200 font-medium">
          <ChevronLeft className="w-3.5 h-3.5" /> Grid
        </button>
        <span className="font-semibold text-slate-700 dark:text-gray-200">Compare</span>
        <span className="text-slate-500 dark:text-gray-400">{resolved.length} chart{resolved.length === 1 ? '' : 's'} side-by-side</span>
        <span className="ml-auto text-[10.5px] text-slate-400 dark:text-gray-500 hidden md:inline">All charts share the same color / Y-axis / pin · click ✕ to drop</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2">
        {resolved.length === 0 ? (
          <Centered>
            <span>No charts queued for comparison.</span>
            <button onClick={onBack} className="text-xs text-emerald-600 dark:text-emerald-400 underline">Back to Grid to pick some</button>
          </Centered>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {resolved.map(c => {
              const stats = statsByKey.get(chartKey(c))!;
              return (
                <div key={chartKey(c)} className="relative">
                  <button onClick={() => onRemove(chartKey(c))} title="Remove from compare"
                    className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-white/90 dark:bg-gray-900/80 border border-slate-300 dark:border-gray-600 flex items-center justify-center text-slate-500 hover:text-red-500 hover:border-red-400">
                    <X className="w-3 h-3" />
                  </button>
                  <ChartCard
                    chart={c} stats={stats}
                    colorMode={colorMode} normalize={normalize}
                    aColors={aColors} bColors={bColors} candColors={candColors}
                    selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
                    height={resolved.length <= 2 ? 320 : 240}
                    hoverCand={hoveredCand}
                    onPickCandidate={onToggleCand}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// keep imports referenced even if not used in some builds
void Maximize2; void Minimize2; void ArrowDown; void ArrowUp; void List; void Rows3; void Target; void Sparkles;
