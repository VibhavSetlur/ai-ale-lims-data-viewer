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
import type { FigureSpec } from '../lib/figureSpec';
import ExportFigureMenu from './ExportFigureMenu';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

/**
 * InfoPopover: a small always-visible (i) button that opens a short, plain
 * explanation. Used to make the VerA/VerB / split semantics self-documenting so
 * a non-expert never has to guess what a control or number means -- and so that
 * any DERIVED quantity (e.g. the three-way split) is explained on the spot.
 */
function InfoPopover({ title, children, align = 'left' }: { title: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative inline-flex" ref={ref} data-figure-omit>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn('inline-flex items-center justify-center w-4 h-4 rounded-full border text-[10px]',
          open ? 'bg-blue-600 text-white border-blue-600' : 'text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 hover:bg-blue-100')}
        title={title}
        aria-label={title}
      >
        <Info className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className={cn('absolute top-full mt-1 z-50 w-72 rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 text-[11px] leading-relaxed text-slate-600 dark:text-gray-300 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
          <div className="font-semibold text-slate-800 dark:text-gray-100 mb-1">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

interface BarcodeChart {
  well: string;
  sampleName?: string;
  sampleNameSource?: 'Seq_samples.Sample_Name' | 'verAB_barcodes.Seqsample' | 'mock';
  seqsamples?: string[];
  transformationLibrary?: string;
  barcodeSourceTable?: 'verAB_barcodes' | 'mock';
  strain: string;
  library: string;
  replicate: number;
  experiment: string;
  transfers: number[];
  candidates: Record<string, number[]>;
}

type OtherRollupRequest = {
  chart: BarcodeChart;
  transfer: number;
  transferIndex: number;
  otherCands: string[];
};

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

type ViewMode = 'grid' | 'focus' | 'compare' | 'perspectives';
type ColorMode = 'candidate' | 'partner-a' | 'partner-b';
type Normalize = 'count' | 'fraction';
type SortKey = 'natural' | 'totalReads' | 'transfers' | 'candidates' | 'flipped';
type CandSortKey = 'reads' | 'charts' | 'final' | 'dominance' | 'name' | 'varA' | 'varB';
type CandidateMetric = {
  charts: number;
  total: number;
  finalPresentCharts: number;
  finalReads: number;
  finalFraction: number;
  dominantCharts: number;
};
type CandGroupKey = 'none' | 'varA' | 'varB';
type BarcodePerspective = 'final' | 'presence' | 'richness' | 'depth' | 'vera' | 'verb' | 'veraLast';
// Transient subunit highlight: hovering a VerA or VerB group header lights up
// EVERY candidate that shares that subunit across the visible charts, without
// committing a selection. kind 'A' = a VerA subunit id (e.g. A81); kind 'B' = a
// VerB subunit id (e.g. B151). null = nothing hovered.
type SubunitRef = { kind: 'A' | 'B'; id: string };
// Test whether a candidate label belongs to a hovered subunit. O(1) per call.
function candMatchesSubunit(cand: string, sub: SubunitRef | null): boolean {
  if (!sub) return false;
  const p = parseCandidate(cand);
  if (!p) return false;
  return sub.kind === 'A' ? p.a === sub.id : p.b === sub.id;
}

// Deterministic, color-blind-aware palette (golden-angle hue rotation).
// Saturation/lightness are kept MODERATE (not neon) so fills are easy on the eyes
// and text stays legible: 48% saturation + 58% lightness reads as a calm, distinct
// tone rather than a vivid block. Pair with textColorFor() for readable labels.
const GOLDEN = 137.508;
const FILL_SAT = 45;
const FILL_LIGHT = 52;
function colorFor(idx: number, total: number): string {
  void total;
  const hue = (idx * GOLDEN) % 360;
  return `hsl(${hue} ${FILL_SAT}% ${FILL_LIGHT}%)`;
}

// Pick black or white text for a given hsl() fill so labels are always readable
// (no more white-on-yellow). Uses perceived lightness from the HSL L channel plus
// a hue-aware nudge (yellows/greens read lighter than blues at the same L).
function textColorFor(hslColor: string): string {
  const m = hslColor.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) return '#ffffff';
  const hue = parseFloat(m[1]);
  const light = parseFloat(m[3]);
  // yellow-green band (45-200) appears brighter, so flip to dark text sooner.
  const brightBand = hue >= 45 && hue <= 200;
  const threshold = brightBand ? 52 : 62;
  return light >= threshold ? '#0f172a' : '#ffffff';
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
    return `hsl(${Math.abs(h) % 360} ${FILL_SAT}% ${FILL_LIGHT}%)`;
  }
  const a = parseInt(p.a.slice(1), 10) || 0;
  const b = parseInt(p.b.slice(1), 10) || 0;
  const ordinal = a * 97 + b; // 97 = large prime so A-rows do not collide in hue
  const hue = (ordinal * GOLDEN) % 360;
  return `hsl(${hue} ${FILL_SAT}% ${FILL_LIGHT}%)`;
}

function chartKey(c: BarcodeChart): string {
  return `${c.experiment}/${c.library}/${c.sampleName || c.strain}/${c.well || 'no-well'}/r${c.replicate}`;
}

function chartIdentityLabel(c: BarcodeChart): string {
  return c.sampleName || c.well || `${c.strain} r${c.replicate}`;
}

function chartIdentitySubtitle(c: BarcodeChart): string {
  return [c.experiment, c.library, c.well ? `well ${c.well}` : null, `rep ${c.replicate}`].filter(Boolean).join(' · ');
}

function chartIdentityTitle(c: BarcodeChart): string {
  const lines = [
    c.sampleName ? `Sample_Name: ${c.sampleName}` : null,
    c.seqsamples?.length ? `Seqsample${c.seqsamples.length === 1 ? '' : 's'}: ${c.seqsamples.join(', ')}` : null,
    c.barcodeSourceTable ? `Counts: ${c.barcodeSourceTable}` : null,
    c.transformationLibrary ? `Transformation library: ${c.transformationLibrary}` : null,
    c.sampleNameSource ? `Parsed label source: ${c.sampleNameSource}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

// Per-candidate cross-chart detail popup. Shows how ONE A-B subunit combination
// behaves across EVERY chart/sample: a combined fraction-over-transfers line chart
// (one faint line per chart the candidate appears in), plus total reads, the number
// of charts it appears in, and its peak fraction and where that peak occurred. This
// is the "track A1-B1 across all conditions and transfers at once" view Nidhi wanted.
// Trajectory classification for ONE chart's per-transfer fractions. We compare the
// first, peak and last fractions: a candidate that rose then collapsed is 'transient'
// (bloomed then washed out); one that ends meaningfully above where it started is
// 'rising'; below is 'falling'; otherwise 'stable'. Thresholds are in fraction units.
type TrendKind = 'rising' | 'falling' | 'stable' | 'transient';
function classifyTrend(first: number, peak: number, last: number): TrendKind {
  const RISE = 0.04; // 4 percentage points counts as a real move
  const delta = last - first;
  // Bloomed then washed out: peaked clearly above both ends, ended near/below start.
  if (peak - first > RISE * 2 && peak - last > RISE * 2 && last <= first + RISE) return 'transient';
  if (delta > RISE) return 'rising';
  if (delta < -RISE) return 'falling';
  return 'stable';
}
// Stable Tailwind chip styles + readable label per trend kind.
const TREND_META: Record<TrendKind, { label: string; chip: string }> = {
  rising:    { label: 'rising',    chip: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' },
  falling:   { label: 'falling',   chip: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700' },
  stable:    { label: 'stable',    chip: 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border-slate-300 dark:border-gray-600' },
  transient: { label: 'transient', chip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700' },
};

function OtherRollupModal({
  request, candColors, onTrackCandidate, onClose,
}: {
  request: OtherRollupRequest;
  candColors: Record<string, string>;
  onTrackCandidate: (cand: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const rows = useMemo(() => {
    const total = Object.values(request.chart.candidates).reduce((acc, counts) => acc + (counts[request.transferIndex] || 0), 0);
    return request.otherCands
      .map(cand => {
        const reads = request.chart.candidates[cand]?.[request.transferIndex] || 0;
        const p = parseCandidate(cand);
        return { cand, reads, pct: total ? reads / total : 0, a: p?.a ?? '', b: p?.b ?? '' };
      })
      .filter(r => r.reads > 0)
      .sort((a, b) => b.reads - a.reads || a.cand.localeCompare(b.cand));
  }, [request.chart, request.transferIndex, request.otherCands]);
  const otherReads = rows.reduce((a, r) => a + r.reads, 0);
  const barTotal = Object.values(request.chart.candidates).reduce((acc, counts) => acc + (counts[request.transferIndex] || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 border border-slate-200 dark:border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[86vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="other-rollup-title">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block w-3 h-3 rounded-sm bg-slate-400" />
              <span id="other-rollup-title" className="font-semibold">Other rollup</span>
              <span className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700">T{request.transfer}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400 truncate" title={chartIdentityTitle(request.chart)}>
              {request.chart.sampleName || request.chart.well || request.chart.strain} · {request.chart.library} · rep {request.chart.replicate}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400" title="Close (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <Stat label="rolled candidates" value={String(request.otherCands.length)} />
            <Stat label="Other reads" value={otherReads.toLocaleString()} accent />
            <Stat label="of transfer" value={barTotal ? `${(100 * otherReads / barTotal).toFixed(1)}%` : '0%'} />
          </div>
          <div className="text-[11.5px] text-slate-600 dark:text-gray-300 leading-relaxed">
            These candidates were not shown individually because Top-N rollup is active. Counts are raw reads from this chart and transfer; percentages are relative to the full transfer total. Use Track to add a candidate to the shared selection so it is emphasized across views.
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 dark:bg-gray-800 text-slate-500 dark:text-gray-400">
                <tr>
                  <th className="px-2 py-1.5 text-left">Candidate</th>
                  <th className="px-2 py-1.5 text-left">VerA</th>
                  <th className="px-2 py-1.5 text-left">VerB</th>
                  <th className="px-2 py-1.5 text-right">Reads</th>
                  <th className="px-2 py-1.5 text-right" title="Percent of the full transfer bar, not percent within Other">% of bar</th>
                  <th className="px-2 py-1.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.cand} className="border-t border-slate-100 dark:border-gray-700/70">
                    <td className="px-2 py-1.5 font-mono text-slate-800 dark:text-gray-100">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ background: candColors[r.cand] || '#94a3b8' }} />
                      {r.cand}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-500 dark:text-gray-400">{r.a || 'n/a'}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500 dark:text-gray-400">{r.b || 'n/a'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.reads.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{(r.pct * 100).toFixed(r.pct >= 0.1 ? 1 : 2)}%</td>
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => onTrackCandidate(r.cand)} title={`Track ${r.cand} across charts`} className="px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-[10.5px] font-medium">
                        Track
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400 dark:text-gray-500">No nonzero rolled-up candidates at this transfer.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateDetailModal({
  cand, charts, candColors, aColors, bColors, candidateIndex, isSelected, onToggleSelect, onClose,
}: {
  cand: string;
  charts: BarcodeChart[];
  candColors: Record<string, string>;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candidateIndex: Map<string, CandidateMetric>;
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
  const parts = parseCandidate(cand);

  // Y-axis metric for the in-modal line chart: fraction (0..100%) or absolute reads.
  const [metric, setMetric] = useState<'fraction' | 'count'>('fraction');
  // Sortable per-chart breakdown table state.
  const [sortKey, setSortKey] = useState<'peak' | 'delta' | 'reads'>('peak');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Which chart line is highlighted (set by hovering/clicking a table row). Full
  // opacity + thick stroke for the match, dim for the rest.
  const [hoveredChartKey, setHoveredChartKey] = useState<string | null>(null);
  // Hover crosshair: index into the dense transfer axis the mouse is nearest to.
  const [hoverTransfer, setHoverTransfer] = useState<number | null>(null);

  // Build one fraction-over-transfers series per chart that contains this candidate.
  // Fraction = candidate reads / total reads at that transfer, so charts with very
  // different depths are comparable. Track the global peak fraction and where.
  // Each series also carries absolute reads per transfer so the metric toggle can
  // re-scale without recomputing, and the union of transfers powers the crosshair.
  const { series, xMax, yMaxCount, peak, perChart, dominantCount, meanLast, trendCounts, allTransfers } = useMemo(() => {
    const out: { key: string; label: string; pts: { x: number; y: number; reads: number }[] }[] = [];
    const rows: { key: string; label: string; peak: number; first: number; last: number; reads: number; dominant: boolean; trend: TrendKind }[] = [];
    let xMaxLocal = 1;
    let yMaxCountLocal = 1;
    let peakLocal = { frac: 0, transfer: 0, label: '' };
    let domCount = 0;
    let lastSum = 0, lastN = 0;
    const tc: Record<TrendKind, number> = { rising: 0, falling: 0, stable: 0, transient: 0 };
    const transferSet = new Set<number>();
    for (const c of charts) {
      const counts = c.candidates[cand];
      if (!counts) continue;
      const pts: { x: number; y: number; reads: number }[] = [];
      let firstFrac = 0, lastFrac = 0, peakFrac = 0, reads = 0, dominantHere = false;
      c.transfers.forEach((t, i) => {
        const tot = Object.values(c.candidates).reduce((a, arr) => a + (arr[i] || 0), 0);
        const cnt = counts[i] || 0;
        const frac = tot > 0 ? cnt / tot : 0;
        pts.push({ x: t, y: frac, reads: cnt });
        reads += cnt;
        if (cnt > yMaxCountLocal) yMaxCountLocal = cnt;
        if (i === 0) firstFrac = frac;
        if (i === c.transfers.length - 1) lastFrac = frac;
        if (frac > peakFrac) peakFrac = frac;
        // dominant in this chart at this transfer?
        let bestOther = 0;
        for (const arr of Object.values(c.candidates)) { const v = arr[i] || 0; if (v > bestOther) bestOther = v; }
        if (cnt > 0 && cnt === bestOther) dominantHere = true;
        if (t > xMaxLocal) xMaxLocal = t;
        transferSet.add(t);
        if (frac > peakLocal.frac) {
          peakLocal = { frac, transfer: t, label: `${c.sampleName || c.well || c.strain || c.library} r${c.replicate}` };
        }
      });
      if (pts.some(p => p.y > 0)) {
        const label = `${c.sampleName || c.well || c.strain} r${c.replicate} (${c.library})`;
        const trend = classifyTrend(firstFrac, peakFrac, lastFrac);
        out.push({ key: chartKey(c), label, pts });
        rows.push({ key: chartKey(c), label, peak: peakFrac, first: firstFrac, last: lastFrac, reads, dominant: dominantHere, trend });
        tc[trend] += 1;
        if (dominantHere) domCount += 1;
        lastSum += lastFrac; lastN += 1;
      }
    }
    rows.sort((a, b) => b.peak - a.peak);
    const transfers = [...transferSet].sort((a, b) => a - b);
    return {
      series: out, xMax: xMaxLocal, yMaxCount: yMaxCountLocal, peak: peakLocal,
      perChart: rows, dominantCount: domCount, meanLast: lastN ? lastSum / lastN : 0,
      trendCounts: tc, allTransfers: transfers,
    };
  }, [cand, charts]);

  // Apply the sortable-table state to a copy of the per-chart rows.
  const sortedRows = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const keyed = perChart.map(r => ({ ...r, delta: r.last - r.first }));
    keyed.sort((a, b) => {
      const va = sortKey === 'peak' ? a.peak : sortKey === 'reads' ? a.reads : a.delta;
      const vb = sortKey === 'peak' ? b.peak : sortKey === 'reads' ? b.reads : b.delta;
      return (va - vb) * dirMul;
    });
    return keyed;
  }, [perChart, sortKey, sortDir]);

  const setSort = useCallback((k: 'peak' | 'delta' | 'reads') => {
    setSortKey(prev => { if (prev === k) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; } setSortDir('desc'); return k; });
  }, []);

  // CSV export: this candidate's per-chart per-transfer fraction AND reads. One row
  // per (chart, transfer). Lets a reviewer pull the exact numbers into a spreadsheet.
  const exportCsv = useCallback(() => {
    const header = ['candidate', 'varA', 'varB', 'chart', 'transfer', 'fraction', 'reads'];
    const lines = [header.join(',')];
    for (const s of series) {
      for (const p of s.pts) {
        lines.push([
          cand, parts?.a ?? '', parts?.b ?? '',
          `"${s.label.replace(/"/g, '""')}"`,
          String(p.x), (p.y).toFixed(6), String(p.reads),
        ].join(','));
      }
    }
    downloadBlob(`${cand}_fractions.csv`, lines.join('\n'));
  }, [series, cand, parts]);

  // Chart geometry. Y is either fraction 0..1 or absolute reads 0..yMaxCount.
  const W = 720, H = 320, padL = 52, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const yMax = metric === 'fraction' ? 1 : yMaxCount;
  const sx = (x: number) => padL + (xMax > 0 ? (x / xMax) * plotW : 0);
  const sy = (y: number) => padT + plotH - (yMax > 0 ? (y / yMax) * plotH : 0);
  const valOf = (p: { y: number; reads: number }) => metric === 'fraction' ? p.y : p.reads;
  const yTicks = metric === 'fraction'
    ? [0, 0.25, 0.5, 0.75, 1]
    : [0, 0.25, 0.5, 0.75, 1].map(f => f * yMaxCount);
  const fmtY = (v: number) => metric === 'fraction' ? `${Math.round(v * 100)}%` : (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
  const xStep = xMax <= 12 ? 1 : Math.ceil(xMax / 12);
  const xTicks: number[] = [];
  for (let v = 0; v <= xMax; v += xStep) xTicks.push(v);

  // Crosshair: map a mouse x in SVG user space to the nearest transfer in allTransfers.
  const onPlotMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const ux = ((e.clientX - rect.left) / rect.width) * W;
    if (ux < padL - 4 || ux > W - padR + 4 || allTransfers.length === 0) { setHoverTransfer(null); return; }
    let best = allTransfers[0], bestD = Infinity;
    for (const t of allTransfers) { const d = Math.abs(sx(t) - ux); if (d < bestD) { bestD = d; best = t; } }
    setHoverTransfer(best);
  };
  // Per-chart value at the hovered transfer (top few, by value), for the tooltip.
  const hoverRows = useMemo(() => {
    if (hoverTransfer == null) return [];
    const rows: { key: string; label: string; val: number; reads: number; frac: number }[] = [];
    for (const s of series) {
      const p = s.pts.find(pt => pt.x === hoverTransfer);
      if (!p || (p.reads === 0)) continue;
      rows.push({ key: s.key, label: s.label, val: metric === 'fraction' ? p.y : p.reads, reads: p.reads, frac: p.y });
    }
    rows.sort((a, b) => b.val - a.val);
    return rows;
  }, [hoverTransfer, series, metric]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <span className="inline-block w-4 h-4 rounded-sm shrink-0" style={{ background: color }} />
          <span className="font-mono font-semibold text-[15px] text-slate-800 dark:text-gray-100">{cand}</span>
          {/* Composition diagram: which VerA + VerB subunits compose this combination,
              each shown as its own stable swatch with a contrast-checked label. */}
          {parts && (
            <span className="flex items-center gap-1" title={`Composed of VerA ${parts.a} and VerB ${parts.b}`}>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border border-black/10 dark:border-white/10"
                style={{ background: aColors[parts.a] || '#888', color: textColorFor(aColors[parts.a] || 'hsl(0 0% 40%)') }}>
                {parts.a}
              </span>
              <Plus className="w-3 h-3 text-slate-400 dark:text-gray-500" />
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border border-black/10 dark:border-white/10"
                style={{ background: bColors[parts.b] || '#888', color: textColorFor(bColors[parts.b] || 'hsl(0 0% 40%)') }}>
                {parts.b}
              </span>
            </span>
          )}
          <span className="text-[11.5px] text-slate-500 dark:text-gray-400 hidden sm:inline">barcode combination across all charts</span>
          <button
            onClick={exportCsv}
            title="Download this combination's per-chart per-transfer fractions and reads as CSV"
            className="ml-auto text-[11.5px] px-2 py-1 rounded border font-medium flex items-center gap-1 border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={onToggleSelect}
            className={cn('text-[11.5px] px-2 py-1 rounded border font-medium',
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
          <Stat label="dominant in" value={`${dominantCount} chart${dominantCount === 1 ? '' : 's'}`} />
          <Stat label="total reads" value={idx.total.toLocaleString()} />
          <Stat label="peak fraction" value={`${(peak.frac * 100).toFixed(1)}%`} accent />
          <Stat label="peak at" value={peak.frac > 0 ? `T${peak.transfer} · ${peak.label}` : 'n/a'} />
          <Stat label="mean final share" value={`${(meanLast * 100).toFixed(1)}%`} />
        </div>

        {/* Trend summary chips: how this combination trends across the charts it
            appears in. Rises in N, falls in M, stable in K, transient in J. */}
        {perChart.length > 0 && (
          <div className="px-4 pb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-500 dark:text-gray-400">across {perChart.length} chart{perChart.length === 1 ? '' : 's'}:</span>
            <span className={cn('px-1.5 py-0.5 rounded border font-medium', TREND_META.rising.chip)}>rises in {trendCounts.rising}</span>
            <span className={cn('px-1.5 py-0.5 rounded border font-medium', TREND_META.falling.chip)}>falls in {trendCounts.falling}</span>
            <span className={cn('px-1.5 py-0.5 rounded border font-medium', TREND_META.stable.chip)}>stable in {trendCounts.stable}</span>
            {trendCounts.transient > 0 && (
              <span className={cn('px-1.5 py-0.5 rounded border font-medium', TREND_META.transient.chip)}>transient in {trendCounts.transient}</span>
            )}
          </div>
        )}

        {/* Cross-chart fraction-over-transfers chart */}
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-[11px] text-slate-500 dark:text-gray-400">
              {metric === 'fraction' ? 'Fraction' : 'Read count'} over transfers, one line per chart this combination appears in
              ({series.length} chart{series.length === 1 ? '' : 's'}).
            </div>
            {/* Metric toggle: fraction (0-100%) vs absolute reads on the Y axis. */}
            <div className="flex shrink-0 rounded border border-slate-300 dark:border-gray-600 overflow-hidden text-[10.5px] font-medium">
              {(['fraction', 'count'] as const).map(m => (
                <button key={m} onClick={() => setMetric(m)}
                  className={cn('px-2 py-0.5',
                    metric === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700')}>
                  {m === 'fraction' ? 'Fraction' : 'Read count'}
                </button>
              ))}
            </div>
          </div>
          {series.length === 0 ? (
            <div className="text-[12px] text-slate-400 dark:text-gray-500 py-8 text-center">
              No nonzero measurements for this combination.
            </div>
          ) : (
            <div className="relative">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img"
                onMouseMove={onPlotMove} onMouseLeave={() => setHoverTransfer(null)}
                aria-label={`${metric === 'fraction' ? 'Fraction' : 'Read count'} over transfers for ${cand}`}>
                {/* y gridlines + labels */}
                {yTicks.map(v => (
                  <g key={`y${v}`}>
                    <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="currentColor" className="text-slate-200 dark:text-gray-700" strokeWidth="1" />
                    <text x={padL - 6} y={sy(v) + 3} textAnchor="end" className="text-[9px] fill-slate-400 dark:fill-gray-500">{fmtY(v)}</text>
                  </g>
                ))}
                {/* x ticks */}
                {xTicks.map(v => (
                  <text key={`x${v}`} x={sx(v)} y={H - padB + 14} textAnchor="middle" className="text-[9px] fill-slate-400 dark:fill-gray-500">T{v}</text>
                ))}
                <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="text-[10px] fill-slate-500 dark:fill-gray-400">Transfer</text>
                {/* vertical guide line at the hovered transfer */}
                {hoverTransfer != null && (
                  <line x1={sx(hoverTransfer)} x2={sx(hoverTransfer)} y1={padT} y2={padT + plotH}
                    stroke="currentColor" className="text-blue-400 dark:text-blue-500" strokeWidth="1" strokeDasharray="3 3" />
                )}
                {/* one line per chart, in the candidate's color. When a chart line is
                    highlighted (table row hover/click) it goes full opacity + thick,
                    the rest dim back so the selected trajectory stands out. */}
                {series.map(s => {
                  const d = s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(valOf(p)).toFixed(1)}`).join(' ');
                  const hl = hoveredChartKey === s.key;
                  const dimOthers = hoveredChartKey != null && !hl;
                  return (
                    <g key={s.key}>
                      <path d={d} fill="none" stroke={color}
                        strokeWidth={hl ? 3 : 1.6}
                        opacity={dimOthers ? 0.12 : hl ? 1 : 0.55}
                        strokeLinejoin="round" strokeLinecap="round" />
                      {s.pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(valOf(p))} r={hl ? 2.6 : 1.8} fill={color} opacity={dimOthers ? 0.12 : hl ? 1 : 0.7} />)}
                    </g>
                  );
                })}
                {/* dots at the hovered transfer (on top) */}
                {hoverTransfer != null && series.map(s => {
                  const p = s.pts.find(pt => pt.x === hoverTransfer);
                  if (!p || p.reads === 0) return null;
                  return <circle key={`h${s.key}`} cx={sx(p.x)} cy={sy(valOf(p))} r="3" fill={color} stroke="#fff" strokeWidth="1" />;
                })}
              </svg>
              {/* Floating tooltip at the hovered transfer (top few chart values). */}
              {hoverTransfer != null && hoverRows.length > 0 && (
                <div className="absolute top-1 right-1 max-w-[55%] rounded border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 shadow-lg px-2 py-1.5 text-[10.5px] pointer-events-none">
                  <div className="font-semibold text-slate-700 dark:text-gray-200 mb-0.5">T{hoverTransfer}</div>
                  {hoverRows.slice(0, 6).map(r => (
                    <div key={r.key} className="flex items-center gap-1.5 tabular-nums">
                      <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                      <span className="truncate max-w-[150px] text-slate-600 dark:text-gray-300 font-mono">{r.label}</span>
                      <span className="ml-auto font-semibold text-slate-800 dark:text-gray-100">
                        {metric === 'fraction' ? `${(r.frac * 100).toFixed(1)}%` : r.reads.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {hoverRows.length > 6 && (
                    <div className="text-slate-400 dark:text-gray-500 mt-0.5">+{hoverRows.length - 6} more</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Per-chart breakdown table: where this combination appears, its peak, its
            first to last fraction (the trajectory), reads, and whether it dominated. */}
        {perChart.length > 0 && (
          <div className="px-4 pb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-1">
              Per-chart breakdown
              <span className="ml-1 normal-case font-normal text-slate-400 dark:text-gray-500">(click a header to sort, hover a row to highlight its line)</span>
            </div>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-gray-700">
              <table className="w-full text-[11.5px]">
                <thead className="bg-slate-50 dark:bg-gray-800 text-slate-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left px-2 py-1 font-semibold">Chart</th>
                    <th className="text-center px-2 py-1 font-semibold" title="Trajectory classification across transfers">Trend</th>
                    <SortHeader label="Peak" active={sortKey === 'peak'} dir={sortDir} onClick={() => setSort('peak')} title="Highest fraction this combination reached in this chart" />
                    <SortHeader label="First to last" active={sortKey === 'delta'} dir={sortDir} onClick={() => setSort('delta')} title="Change in fraction from the first transfer to the last transfer (its trajectory). Sorts by the delta." />
                    <SortHeader label="Reads" active={sortKey === 'reads'} dir={sortDir} onClick={() => setSort('reads')} title="Total reads of this combination in this chart" />
                    <th className="text-center px-2 py-1 font-semibold" title="Was this the most abundant combination at any transfer in this chart?">Dominant</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(rrow => {
                    const trend = rrow.last - rrow.first;
                    const arrow = Math.abs(trend) < 0.02 ? '→' : trend > 0 ? '▲' : '▼';
                    const trendColor = Math.abs(trend) < 0.02 ? 'text-slate-400' : trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
                    const meta = TREND_META[rrow.trend];
                    const hl = hoveredChartKey === rrow.key;
                    return (
                      <tr key={rrow.key}
                        onMouseEnter={() => setHoveredChartKey(rrow.key)}
                        onMouseLeave={() => setHoveredChartKey(null)}
                        onClick={() => setHoveredChartKey(prev => prev === rrow.key ? null : rrow.key)}
                        className={cn('border-t border-slate-100 dark:border-gray-700/60 cursor-pointer',
                          hl ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-gray-800/60')}>
                        <td className="px-2 py-1 font-mono text-slate-700 dark:text-gray-200 truncate max-w-[220px]" title={rrow.label}>{rrow.label}</td>
                        <td className="px-2 py-1 text-center">
                          <span className={cn('inline-block px-1.5 py-0.5 rounded border text-[9.5px] font-semibold', meta.chip)}>{meta.label}</span>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">{(rrow.peak * 100).toFixed(0)}%</td>
                        <td className={cn('px-2 py-1 text-right tabular-nums', trendColor)}>
                          {(rrow.first * 100).toFixed(0)}% {arrow} {(rrow.last * 100).toFixed(0)}%
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-500 dark:text-gray-400">{rrow.reads.toLocaleString()}</td>
                        <td className="px-2 py-1 text-center">{rrow.dominant ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span> : <span className="text-slate-300 dark:text-gray-600">·</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Per-SUBUNIT cross-chart detail popup. Mirrors CandidateDetailModal but aggregates
// EVERY A-B partner that shares one VerA subunit (e.g. all A81-*) or one VerB subunit
// (e.g. all *-B151). Shows total reads, in how many charts the subunit appears, its
// peak aggregated fraction and where, the list of partner combinations, and one
// faint fraction-over-transfers line per chart (aggregating all partners). This is
// the "track a single subunit, not just one combination, across all conditions" view.
function SubunitDetailModal({
  sub, charts, aColors, bColors, onClose,
}: {
  sub: SubunitRef;
  charts: BarcodeChart[];
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const color = (sub.kind === 'A' ? aColors[sub.id] : bColors[sub.id]) || '#2563eb';
  const kindLabel = sub.kind === 'A' ? 'VerA subunit' : 'VerB subunit';

  // Aggregate this subunit across every chart. For each chart, sum the reads of all
  // candidates that share this subunit at each transfer, then express as a fraction of
  // the chart total at that transfer. Track totals, chart count, partner set and peak.
  const { series, xMax, peak, totalReads, chartCount, partners } = useMemo(() => {
    const out: { key: string; label: string; pts: { x: number; y: number }[] }[] = [];
    let xMaxLocal = 1;
    let peakLocal = { frac: 0, transfer: 0, label: '' };
    let total = 0;
    let nCharts = 0;
    const partnerSet = new Set<string>();
    for (const c of charts) {
      // Reads of all candidates sharing this subunit, per transfer index.
      const sub3 = Array(c.transfers.length).fill(0);
      let chartSubTotal = 0;
      for (const [cand, counts] of Object.entries(c.candidates)) {
        if (!candMatchesSubunit(cand, sub)) continue;
        let cs = 0;
        counts.forEach((v, i) => { sub3[i] += v || 0; cs += v || 0; });
        if (cs > 0) partnerSet.add(cand);
      }
      chartSubTotal = sub3.reduce((a, v) => a + v, 0);
      if (chartSubTotal <= 0) continue;
      nCharts += 1;
      total += chartSubTotal;
      const pts: { x: number; y: number }[] = [];
      c.transfers.forEach((t, i) => {
        const tot = Object.values(c.candidates).reduce((a, arr) => a + (arr[i] || 0), 0);
        const frac = tot > 0 ? sub3[i] / tot : 0;
        pts.push({ x: t, y: frac });
        if (t > xMaxLocal) xMaxLocal = t;
        if (frac > peakLocal.frac) {
          peakLocal = { frac, transfer: t, label: `${c.sampleName || c.well || c.strain || c.library} r${c.replicate}` };
        }
      });
      if (pts.some(p => p.y > 0)) {
        out.push({ key: chartKey(c), label: `${c.sampleName || c.well || c.strain} r${c.replicate} (${c.library})`, pts });
      }
    }
    // Partner list: just the candidate ids that share this subunit (sorted).
    const partnerArr = [...partnerSet].sort();
    return { series: out, xMax: xMaxLocal, peak: peakLocal, totalReads: total, chartCount: nCharts, partners: partnerArr };
  }, [sub, charts]);

  const W = 720, H = 320, padL = 44, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const sx = (x: number) => padL + (xMax > 0 ? (x / xMax) * plotW : 0);
  const sy = (y: number) => padT + plotH - y * plotH;
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
          <span className="font-mono font-semibold text-[15px] text-slate-800 dark:text-gray-100">{sub.id}</span>
          <span className="text-[11.5px] text-slate-500 dark:text-gray-400">{kindLabel} aggregated across all A-B partners and charts</span>
          <button onClick={onClose} title="Close (Esc)"
            className="ml-auto p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stat cards */}
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11.5px]">
          <Stat label="appears in" value={`${chartCount} chart${chartCount === 1 ? '' : 's'}`} />
          <Stat label="total reads" value={totalReads.toLocaleString()} />
          <Stat label="peak fraction" value={`${(peak.frac * 100).toFixed(1)}%`} accent />
          <Stat label="peak at" value={peak.frac > 0 ? `T${peak.transfer} - ${peak.label}` : 'n/a'} />
        </div>

        {/* Partner combinations sharing this subunit */}
        <div className="px-4 pb-1">
          <div className="text-[11px] text-slate-500 dark:text-gray-400 mb-1">
            {partners.length} A-B partner combination{partners.length === 1 ? '' : 's'} share this subunit:
          </div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {partners.map(c => (
              <span key={c} className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700">
                {c}
              </span>
            ))}
            {partners.length === 0 && <span className="text-[11px] text-slate-400">none</span>}
          </div>
        </div>

        {/* Cross-chart aggregated fraction-over-transfers chart */}
        <div className="px-4 pb-4 pt-2">
          <div className="text-[11px] text-slate-500 dark:text-gray-400 mb-1">
            Aggregated fraction of reads over transfers (all {sub.id} partners summed), one line per chart
            ({series.length} chart{series.length === 1 ? '' : 's'}).
          </div>
          {series.length === 0 ? (
            <div className="text-[12px] text-slate-400 dark:text-gray-500 py-8 text-center">
              No nonzero measurements for this subunit.
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img"
              aria-label={`Aggregated fraction over transfers for ${sub.id}`}>
              {yTicks.map(v => (
                <g key={`y${v}`}>
                  <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="currentColor" className="text-slate-200 dark:text-gray-700" strokeWidth="1" />
                  <text x={padL - 6} y={sy(v) + 3} textAnchor="end" className="text-[9px] fill-slate-400 dark:fill-gray-500">{Math.round(v * 100)}%</text>
                </g>
              ))}
              {xTicks.map(v => (
                <text key={`x${v}`} x={sx(v)} y={H - padB + 14} textAnchor="middle" className="text-[9px] fill-slate-400 dark:fill-gray-500">T{v}</text>
              ))}
              <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="text-[10px] fill-slate-500 dark:fill-gray-400">Transfer</text>
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

// Right-aligned, clickable sort-header cell for the per-chart breakdown table.
// Shows an up/down caret when its column is the active sort key.
function SortHeader({ label, active, dir, onClick, title }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; title?: string;
}) {
  return (
    <th className="text-right px-2 py-1 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-gray-200" onClick={onClick} title={title}>
      <span className="inline-flex items-center gap-0.5 justify-end">
        {label}
        <span className={cn('text-[9px]', active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-gray-600')}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '▾'}
        </span>
      </span>
    </th>
  );
}

// Tiny inline fraction-over-transfers sparkline for ONE candidate in ONE chart.
// Restores the at-a-glance trend reading of vertical bars without leaving the bar
// view. 40x12 viewBox, drawn in the candidate's stable color. The points come from
// a memoized per-chart fraction map (see CandidateLegendPanel) so this stays cheap.
function CandidateSparkline({ pts, color }: { pts: number[]; color: string }) {
  const w = 40, h = 12, pad = 1;
  if (pts.length < 2) return <span className="inline-block" style={{ width: w, height: h }} />;
  const max = Math.max(...pts, 0.0001);
  const sx = (i: number) => pad + (pts.length > 1 ? (i / (pts.length - 1)) * (w - 2 * pad) : 0);
  const sy = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0 overflow-visible" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(pts.length - 1)} cy={sy(pts[pts.length - 1])} r="1.3" fill={color} />
    </svg>
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
  const header = ['experiment','well','sample_name','seqsamples','barcode_source_table','strain','library','transformation_library','replicate','transfer','candidate','varA','varB','count'];
  const lines = [header.join(',')];
  for (const c of charts) {
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const partner = parseCandidate(cand);
      c.transfers.forEach((t, i) => {
        if (!counts[i]) return;
        lines.push([
          c.experiment, c.well, c.sampleName ?? '', (c.seqsamples ?? []).join(';'), c.barcodeSourceTable ?? '',
          c.strain, c.library, c.transformationLibrary ?? '', String(c.replicate), String(t),
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

function csvEscape(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function groupCounts(charts: BarcodeChart[], get: (c: BarcodeChart) => string | undefined): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of charts) {
    const v = get(c) || '(none)';
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function finalOutcomeRows(charts: BarcodeChart[], statsByKey: Map<string, ChartStats>) {
  return charts.map(c => {
    const lastIdx = c.transfers.length - 1;
    let total = 0, best = 0, dominant = '';
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const v = counts[lastIdx] || 0;
      total += v;
      if (v > best) { best = v; dominant = cand; }
    }
    const s = statsByKey.get(chartKey(c));
    return { chart: c, dominant: dominant || 'n/a', finalReads: best, finalTotal: total, finalFraction: total ? best / total : 0, richness: Object.values(c.candidates).filter(counts => (counts[lastIdx] || 0) > 0).length, flipped: !!s?.flipped };
  });
}

function presenceRows(charts: BarcodeChart[]) {
  const m = new Map<string, { cand: string; charts: number; total: number; finalCharts: number }>();
  for (const c of charts) {
    const lastIdx = c.transfers.length - 1;
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const total = counts.reduce((a, v) => a + (v || 0), 0);
      if (total <= 0) continue;
      const row = m.get(cand) ?? { cand, charts: 0, total: 0, finalCharts: 0 };
      row.charts += 1;
      row.total += total;
      if ((counts[lastIdx] || 0) > 0) row.finalCharts += 1;
      m.set(cand, row);
    }
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.charts - a.charts || a.cand.localeCompare(b.cand));
}

function subunitRows(charts: BarcodeChart[], kind: 'A' | 'B') {
  const m = new Map<string, { id: string; total: number; charts: Set<string>; cands: Set<string>; finalReads: number }>();
  for (const c of charts) {
    const ck = chartKey(c);
    const lastIdx = c.transfers.length - 1;
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const p = parseCandidate(cand);
      if (!p) continue;
      const id = kind === 'A' ? p.a : p.b;
      const total = counts.reduce((a, v) => a + (v || 0), 0);
      if (total <= 0) continue;
      const row = m.get(id) ?? { id, total: 0, charts: new Set<string>(), cands: new Set<string>(), finalReads: 0 };
      row.total += total;
      row.finalReads += counts[lastIdx] || 0;
      row.charts.add(ck);
      row.cands.add(cand);
      m.set(id, row);
    }
  }
  return [...m.values()].map(r => ({ id: r.id, total: r.total, charts: r.charts.size, candidates: r.cands.size, finalReads: r.finalReads })).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

function normalizeVerAId(value: string): string | null {
  const match = value.trim().toUpperCase().match(/^(?:VERA)?A?(\d+)$/);
  return match ? `A${match[1]}` : null;
}

function parseAiVerAList(value: string): Set<string> {
  const ids = new Set<string>();
  for (const token of value.split(/[\s,;]+/)) {
    const id = normalizeVerAId(token);
    if (id) ids.add(id);
  }
  return ids;
}

function veraLastRows(charts: BarcodeChart[], aiVerAs: Set<string>) {
  const rows = new Map<string, { id: string; dominantCharts: number; conditions: Set<string>; finalReads: number; partners: Map<string, number>; aiGenerated: boolean }>();
  for (const c of charts) {
    const lastIdx = c.transfers.length - 1;
    if (lastIdx < 0) continue;
    let bestReads = 0;
    let bestCand = '';
    for (const [cand, counts] of Object.entries(c.candidates)) {
      const reads = counts[lastIdx] || 0;
      if (reads > bestReads) {
        bestReads = reads;
        bestCand = cand;
      }
    }
    if (!bestCand || bestReads <= 0) continue;
    const parsed = parseCandidate(bestCand);
    if (!parsed) continue;
    const conditionKey = [c.experiment, c.strain, c.library].filter(Boolean).join(' / ') || chartKey(c);
    const row = rows.get(parsed.a) ?? { id: parsed.a, dominantCharts: 0, conditions: new Set<string>(), finalReads: 0, partners: new Map<string, number>(), aiGenerated: aiVerAs.has(parsed.a) };
    row.dominantCharts += 1;
    row.conditions.add(conditionKey);
    row.finalReads += bestReads;
    row.partners.set(parsed.b, (row.partners.get(parsed.b) ?? 0) + bestReads);
    rows.set(parsed.a, row);
  }
  return [...rows.values()].map(r => ({
    id: r.id,
    dominantCharts: r.dominantCharts,
    conditions: r.conditions.size,
    finalReads: r.finalReads,
    aiGenerated: r.aiGenerated,
    partners: [...r.partners.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  })).sort((a, b) => b.dominantCharts - a.dominantCharts || b.finalReads - a.finalReads || a.id.localeCompare(b.id));
}

function perspectiveCsv(mode: BarcodePerspective, charts: BarcodeChart[], statsByKey: Map<string, ChartStats>, aiVerAs: Set<string> = new Set()): string {
  if (mode === 'final') {
    const rows = finalOutcomeRows(charts, statsByKey);
    return [['chart','sample_name','library','replicate','final_transfer','dominant_candidate','dominant_reads','final_total','final_fraction','final_richness','flipped'].join(','), ...rows.map(r => [chartKey(r.chart), r.chart.sampleName ?? '', r.chart.library, r.chart.replicate, r.chart.transfers[r.chart.transfers.length - 1] ?? '', r.dominant, r.finalReads, r.finalTotal, r.finalFraction, r.richness, r.flipped].map(csvEscape).join(','))].join('\n');
  }
  if (mode === 'presence') {
    return [['candidate','charts_present','final_charts','total_reads'].join(','), ...presenceRows(charts).map(r => [r.cand, r.charts, r.finalCharts, r.total].map(csvEscape).join(','))].join('\n');
  }
  if (mode === 'richness' || mode === 'depth') {
    return [['chart','sample_name','library','replicate','transfer','richness','read_depth'].join(','), ...charts.flatMap(c => c.transfers.map((t, ti) => {
      let richness = 0, depth = 0;
      for (const counts of Object.values(c.candidates)) { const v = counts[ti] || 0; if (v > 0) richness++; depth += v; }
      return [chartKey(c), c.sampleName ?? '', c.library, c.replicate, t, richness, depth].map(csvEscape).join(',');
    }))].join('\n');
  }
  if (mode === 'veraLast') {
    const rows = veraLastRows(charts, aiVerAs);
    return [['vera','ai_generated','dominant_charts','conditions','final_reads','verb_partner_distribution'].join(','), ...rows.map(r => [r.id, r.aiGenerated ? 'yes' : '', r.dominantCharts, r.conditions, r.finalReads, r.partners.map(([b, reads]) => `${b}:${reads}`).join('; ')].map(csvEscape).join(','))].join('\n');
  }
  const rows = subunitRows(charts, mode === 'vera' ? 'A' : 'B');
  return [[mode === 'vera' ? 'vera' : 'verb','charts_present','candidate_count','total_reads','aggregate_final_reads'].join(','), ...rows.map(r => [r.id, r.charts, r.candidates, r.total, r.finalReads].map(csvEscape).join(','))].join('\n');
}

// ---------------------------------------------------------------------------
// HorizontalBarChart: an HTML (not SVG) horizontal stacked-bar chart for FOCUS
// mode. Each transfer is a full-width row; candidate reads stack left-to-right.
// Because it is plain HTML/flex, the text NEVER scales down to fit (the root
// cause of the unreadable SVG vertical bars). Rows have a generous fixed height
// so labels, counts and percentages are always legible. Supports the same
// selection / hover / split-A|B / count-vs-fraction semantics as ChartCard.
// ---------------------------------------------------------------------------
interface HBarProps {
  chart: BarcodeChart;
  stats: ChartStats;
  colorMode: ColorMode;
  splitAB: boolean;
  normalize: Normalize;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;
  hoverCand?: string | null;
  hoverSubunit?: SubunitRef | null;
  onPickCandidate?: (cand: string) => void;
  onHoverCandidate?: (cand: string | null) => void;
  onOpenOther?: (request: OtherRollupRequest) => void;
}
function HorizontalBarChart({
  chart, stats, colorMode, splitAB, normalize, aColors, bColors, candColors,
  selectedCands, isolateSelected, topN, hoverCand, hoverSubunit, onPickCandidate, onHoverCandidate, onOpenOther,
}: HBarProps) {
  // Rich floating hover card state (replaces the native title= tooltips on
  // segments). We track the candidate / subunit, its reads, % of the bar and the
  // transfer, plus a pixel position RELATIVE to the scroll container so the card
  // never escapes the chart. flipX/flipY render the card on the other side near
  // edges so it is never clipped.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [card, setCard] = useState<null | {
    label: string; kind?: 'A' | 'B'; cand: string; reads: number; pct: number;
    transfer: number; color: string; x: number; y: number; flipX: boolean; flipY: boolean;
  }>(null);
  const showCard = (e: React.MouseEvent, seg: { cand: string; label: string; v: number; color: string; kind?: 'A' | 'B' }, total: number, transfer: number) => {
    const box = scrollRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left + (scrollRef.current?.scrollLeft || 0);
    const y = e.clientY - box.top + (scrollRef.current?.scrollTop || 0);
    setCard({
      label: seg.label, kind: seg.kind, cand: seg.cand, reads: seg.v,
      pct: total ? (100 * seg.v / total) : 0, transfer, color: seg.color,
      x, y, flipX: (e.clientX - box.left) > box.width * 0.62, flipY: (e.clientY - box.top) > box.height * 0.7,
    });
  };

  const { visibleCands, otherCands } = useMemo(() => {
    let all = Object.keys(chart.candidates);
    if (isolateSelected && selectedCands.size > 0) all = all.filter(c => selectedCands.has(c));
    if (topN <= 0 || all.length <= topN) return { visibleCands: all, otherCands: [] as string[] };
    const ordered = stats.candidateTotals.map(t => t.cand).filter(c => all.includes(c));
    return { visibleCands: ordered.slice(0, topN), otherCands: ordered.slice(topN) };
  }, [chart.candidates, isolateSelected, selectedCands, topN, stats.candidateTotals]);

  const otherByTransfer = useMemo(() => {
    if (!otherCands.length) return null;
    const arr = Array(chart.transfers.length).fill(0);
    for (const c of otherCands) chart.candidates[c]?.forEach((v, i) => { arr[i] += v || 0; });
    return arr;
  }, [otherCands, chart.candidates, chart.transfers.length]);

  const totals = useMemo(() => chart.transfers.map((_, ti) =>
    visibleCands.reduce((acc, c) => acc + (chart.candidates[c][ti] || 0), 0) + (otherByTransfer?.[ti] || 0)
  ), [chart, visibleCands, otherByTransfer]);

  const hasSel = selectedCands.size > 0;
  const subHover = hoverSubunit;
  const emphasized = (cand: string) => {
    if (subHover) return candMatchesSubunit(cand, subHover);
    if (hoverCand) return cand === hoverCand;
    if (hasSel) return selectedCands.has(cand);
    return true;
  };
  const dimmed = (cand: string) => cand !== '__OTHER__' && !emphasized(cand) && (!!hoverCand || hasSel || !!subHover);

  const colorOf = (cand: string): string => {
    if (cand === '__OTHER__') return '#94a3b8';
    if (colorMode === 'partner-a') { const p = parseCandidate(cand); return p ? aColors[p.a] : '#888'; }
    if (colorMode === 'partner-b') { const p = parseCandidate(cand); return p ? bColors[p.b] : '#888'; }
    return candColors[cand] || '#888';
  };

  // Build the ordered segment list for one transfer (a single stacking).
  const buildSegs = (ti: number): { cand: string; label: string; v: number; color: string; selectable: boolean }[] => {
    const segs = visibleCands
      .map(c => ({ cand: c, label: c, v: chart.candidates[c]?.[ti] || 0, color: colorOf(c), selectable: true }))
      .filter(s => s.v > 0)
      .sort((a, b) => b.v - a.v);
    if (otherByTransfer && otherByTransfer[ti] > 0) segs.push({ cand: '__OTHER__', label: `Other (${otherCands.length})`, v: otherByTransfer[ti], color: '#94a3b8', selectable: false });
    return segs;
  };
  // Aggregate by subunit for the split sub-rows.
  const buildSubunitSegs = (ti: number, kind: 'A' | 'B') => {
    const agg = new Map<string, number>();
    for (const [cand, counts] of Object.entries(chart.candidates)) {
      const v = counts[ti] || 0; if (!v) continue;
      const p = parseCandidate(cand); if (!p) continue;
      const key = kind === 'A' ? p.a : p.b;
      agg.set(key, (agg.get(key) || 0) + v);
    }
    return [...agg.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => ({
      cand: id, label: id, v, color: kind === 'A' ? (aColors[id] || '#888') : (bColors[id] || '#888'), selectable: false, kind,
    }));
  };

  // One stacked horizontal bar (a flex row of segments). Fixed height -> crisp text.
  const renderBar = (segs: { cand: string; label: string; v: number; color: string; selectable: boolean; kind?: 'A' | 'B' }[], total: number, barH: number, transfer: number, transferIndex: number, rowLabel?: string) => (
    <div className="flex items-stretch w-full" style={{ height: barH }}>
      {rowLabel != null && (
        <span className="shrink-0 w-12 pr-1 flex items-center justify-end text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{rowLabel}</span>
      )}
      <div className="relative flex-1 flex items-stretch rounded overflow-hidden bg-slate-50 dark:bg-gray-900/40 ring-1 ring-slate-200/70 dark:ring-gray-700/50">
        {total === 0 ? (
          <span className="flex items-center pl-2 text-[11px] text-slate-300 dark:text-gray-600">no reads</span>
        ) : segs.map(seg => {
          const pct = total ? (100 * seg.v / total) : 0;
          // Width is fraction of THIS bar (so each row reads as 0-100% composition);
          // the read-count scale is conveyed by the count chip at the row end.
          const wPct = total ? (seg.v / total) * 100 : 0;
          const isDim = !!seg.selectable && dimmed(seg.cand);
          const isSel = seg.selectable && hasSel && selectedCands.has(seg.cand);
          const showLabel = wPct >= 14;          // room for "A12-B3 62%"
          const showPctOnly = !showLabel && wPct >= 6;
          const txt = textColorFor(seg.color);
          const txtShadow = txt === '#ffffff' ? '0 1px 2px rgba(0,0,0,0.55)' : '0 1px 1px rgba(255,255,255,0.4)';
          return (
            <div
              key={seg.cand}
              className={cn('group/seg relative flex items-center justify-center overflow-hidden transition-opacity', (seg.selectable && onPickCandidate) || (seg.cand === '__OTHER__' && onOpenOther) ? 'cursor-pointer' : 'cursor-default')}
              style={{
                width: `${wPct}%`, background: seg.color,
                // Dimmed segments stay at 0.25 (not 0.16) so they remain visible.
                opacity: isDim ? 0.25 : 1,
                // Selected segments get a clear dark outline; everything else a
                // thin contrasting separator so adjacent segments stay distinct.
                boxShadow: isSel
                  ? 'inset 0 0 0 2.5px #0f172a, inset 0 0 0 4px rgba(255,255,255,0.85)'
                  : 'inset 0 0 0 0.75px rgba(255,255,255,0.45)',
              }}
              onClick={() => {
                if (seg.selectable) onPickCandidate?.(seg.cand);
                else if (seg.cand === '__OTHER__') onOpenOther?.({ chart, transfer, transferIndex, otherCands });
              }}
              onMouseEnter={(e) => { showCard(e, seg, total, transfer); if (seg.selectable) onHoverCandidate?.(seg.cand); }}
              onMouseMove={(e) => showCard(e, seg, total, transfer)}
              onMouseLeave={() => { setCard(null); if (seg.selectable) onHoverCandidate?.(null); }}
            >
              {showLabel && !isDim && (
                <span className="px-1 font-mono font-semibold truncate" style={{ fontSize: 11, color: txt, textShadow: txtShadow }}>
                  {seg.label} <span className="tabular-nums opacity-90">{pct.toFixed(0)}%</span>
                </span>
              )}
              {showPctOnly && !isDim && (
                <span className="font-semibold tabular-nums" style={{ fontSize: 10, color: txt, textShadow: txtShadow }}>{pct.toFixed(0)}%</span>
              )}
            </div>
          );
        })}
      </div>
      {/* read-count chip + a proportional total-width cue */}
      <span className="shrink-0 w-20 pl-2 flex items-center text-[11px] font-semibold tabular-nums text-slate-600 dark:text-gray-300" title="Total reads at this transfer">
        {normalize === 'fraction' ? '100%' : total.toLocaleString()}
      </span>
    </div>
  );

  return (
    <div ref={scrollRef} className="relative h-full w-full overflow-y-auto px-2 py-2">
      {/* column hint */}
      <div className="flex items-center w-full text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1 pl-12 pr-20">
        <span className="flex-1">Composition of reads (each row is one transfer, segments sized by share of that transfer)</span>
        <span className="shrink-0 w-20 pl-2">Total reads</span>
      </div>
      <div className="flex flex-col gap-4">
        {chart.transfers.map((t, ti) => {
          const total = totals[ti];
          return (
            <div key={ti} className={cn('flex items-stretch gap-2', splitAB && 'rounded-lg bg-slate-50/60 dark:bg-gray-800/40 ring-1 ring-slate-200/60 dark:ring-gray-700/40 p-1.5')}>
              {/* transfer label */}
              <span className="shrink-0 w-10 flex items-center justify-center rounded bg-slate-100 dark:bg-gray-700 text-[13px] font-bold tabular-nums text-slate-700 dark:text-gray-200" title={`Transfer ${t}`}>T{t}</span>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                {splitAB ? (
                  <>
                    {renderBar(buildSegs(ti), total, 30, t, ti, 'A-B')}
                    {renderBar(buildSubunitSegs(ti, 'A'), total, 26, t, ti, 'VerA')}
                    {renderBar(buildSubunitSegs(ti, 'B'), total, 26, t, ti, 'VerB')}
                  </>
                ) : (
                  renderBar(buildSegs(ti), total, 32, t, ti)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rich floating hover card (replaces native title tooltips). Positioned
          inside the scroll container so it is never clipped; flips near edges. */}
      {card && (
        <div
          className="pointer-events-none absolute z-30 rounded-lg bg-slate-900/95 dark:bg-black/90 text-white shadow-xl ring-1 ring-white/10 px-3 py-2 text-[11.5px] leading-snug"
          style={{
            left: card.x, top: card.y,
            transform: `translate(${card.flipX ? 'calc(-100% - 14px)' : '14px'}, ${card.flipY ? 'calc(-100% - 12px)' : '12px'})`,
            minWidth: 180, maxWidth: 260,
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="inline-block w-3 h-3 rounded-sm ring-1 ring-white/40 shrink-0" style={{ background: card.color }} />
            <span className="font-mono font-bold text-[12.5px]">{card.kind === 'A' ? `VerA ${card.label}` : card.kind === 'B' ? `VerB ${card.label}` : card.label}</span>
          </div>
          {/* For a full A-B candidate, break out its VerA and VerB subunits. */}
          {!card.kind && (() => {
            const p = parseCandidate(card.cand);
            if (!p) return null;
            return (
              <div className="flex items-center gap-2 mb-1 text-[10.5px] text-slate-300">
                <span className="font-mono">VerA {p.a}</span>
                <span className="text-slate-500">+</span>
                <span className="font-mono">VerB {p.b}</span>
              </div>
            );
          })()}
          <div className="tabular-nums">
            <span className="font-semibold">{card.reads.toLocaleString()}</span> reads
            <span className="text-slate-400"> · </span>
            <span className="font-semibold">{card.pct.toFixed(1)}%</span> of bar
          </div>
          {card.kind && (
            <div className="text-[10px] text-slate-400 mt-0.5">sum of all {card.kind === 'A' ? `${card.label}-*` : `*-${card.label}`} combinations</div>
          )}
          <div className="text-[10px] text-slate-400 mt-0.5">Transfer T{card.transfer}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrajectoryChart: an SVG line chart that tracks how each candidate's share (or
// read count) rises and falls across the transfer time course. This is the
// timeline-tracking feature requested by Nidhi: one line per candidate, X =
// transfer, Y = fraction of reads (default) or read count. Big readable axes,
// light gridlines, a hover crosshair that snaps to the nearest transfer and
// lists that transfer's candidates with reads + %, click-to-select, hover
// highlight, and selection / subunit emphasis. topN collapses the long tail
// into a single faint grey "other" line (summed).
// ---------------------------------------------------------------------------
interface TrajectoryProps {
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
  hoverCand?: string | null;
  hoverSubunit?: SubunitRef | null;
  onPickCandidate?: (cand: string) => void;
  onHoverCandidate?: (cand: string | null) => void;
}
function TrajectoryChart({
  chart, stats, colorMode, normalize, aColors, bColors, candColors,
  selectedCands, isolateSelected, topN, hoverCand, hoverSubunit, onPickCandidate, onHoverCandidate,
}: TrajectoryProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Snapped transfer index under the cursor (for the crosshair + tooltip).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  const { visibleCands, otherCands } = useMemo(() => {
    let all = Object.keys(chart.candidates);
    if (isolateSelected && selectedCands.size > 0) all = all.filter(c => selectedCands.has(c));
    if (topN <= 0 || all.length <= topN) return { visibleCands: all, otherCands: [] as string[] };
    const ordered = stats.candidateTotals.map(t => t.cand).filter(c => all.includes(c));
    return { visibleCands: ordered.slice(0, topN), otherCands: ordered.slice(topN) };
  }, [chart.candidates, isolateSelected, selectedCands, topN, stats.candidateTotals]);

  // Per-transfer column total (across ALL candidates) so fractions are honest.
  const colTotals = useMemo(() => chart.transfers.map((_, ti) => {
    let s = 0;
    for (const counts of Object.values(chart.candidates)) s += counts[ti] || 0;
    return s;
  }), [chart.candidates, chart.transfers]);

  // "Other" line = summed reads of the collapsed tail per transfer.
  const otherSeries = useMemo(() => {
    if (!otherCands.length) return null;
    return chart.transfers.map((_, ti) => otherCands.reduce((a, c) => a + (chart.candidates[c]?.[ti] || 0), 0));
  }, [otherCands, chart.candidates, chart.transfers]);

  // Y axis maximum. Fraction -> 1 (shown as 0..100%). Count -> max read count
  // seen in any single candidate line (so the tallest line uses the full height).
  const yMax = useMemo(() => {
    if (normalize === 'fraction') return 1;
    let m = 1;
    for (const c of visibleCands) for (const v of chart.candidates[c] || []) if (v > m) m = v;
    if (otherSeries) for (const v of otherSeries) if (v > m) m = v;
    return m;
  }, [normalize, visibleCands, chart.candidates, otherSeries]);

  const colorOf = (cand: string): string => {
    if (cand === '__OTHER__') return '#94a3b8';
    if (colorMode === 'partner-a') { const p = parseCandidate(cand); return p ? aColors[p.a] : '#888'; }
    if (colorMode === 'partner-b') { const p = parseCandidate(cand); return p ? bColors[p.b] : '#888'; }
    return candColors[cand] || '#888';
  };

  const hasSel = selectedCands.size > 0;
  const subHover = hoverSubunit;
  const emphasized = (cand: string) => {
    if (subHover) return candMatchesSubunit(cand, subHover);
    if (hoverCand) return cand === hoverCand;
    if (hasSel) return selectedCands.has(cand);
    return true;
  };
  const anyFocus = !!hoverCand || hasSel || !!subHover;

  // Value of a candidate at a transfer in current Y units (fraction or count).
  const valAt = (cand: string, ti: number): number => {
    const raw = chart.candidates[cand]?.[ti] || 0;
    if (normalize === 'fraction') return colTotals[ti] ? raw / colTotals[ti] : 0;
    return raw;
  };

  // Layout. Generous margins so the big axis labels and titles have room.
  const W = 880, H = 460;
  const m = { top: 24, right: 24, bottom: 56, left: 78 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const n = chart.transfers.length;
  const xOf = (ti: number) => m.left + (n <= 1 ? iw / 2 : (ti / (n - 1)) * iw);
  const yOf = (v: number) => m.top + ih - (yMax ? (v / yMax) * ih : 0);

  // Gridline ticks. 5 horizontal bands.
  const yTicks = useMemo(() => {
    const out: { v: number; label: string }[] = [];
    for (let i = 0; i <= 5; i++) {
      const v = (yMax * i) / 5;
      out.push({ v, label: normalize === 'fraction' ? `${Math.round(v * 100)}%` : (v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`) });
    }
    return out;
  }, [yMax, normalize]);

  // Map a pixel x to the nearest transfer index for the crosshair.
  const handleMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;       // svg user units
    const py = ((e.clientY - r.top) / r.height) * H;
    if (n <= 1) { setHoverIdx(0); setMouse({ x: px, y: py }); return; }
    const frac = (px - m.left) / iw;
    let idx = Math.round(frac * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHoverIdx(idx);
    setMouse({ x: px, y: py });
  };

  // The candidates listed in the crosshair tooltip for the snapped transfer.
  const tipRows = useMemo(() => {
    if (hoverIdx == null) return [] as { cand: string; reads: number; pct: number; color: string }[];
    const ti = hoverIdx;
    const rows = visibleCands.map(c => {
      const reads = chart.candidates[c]?.[ti] || 0;
      return { cand: c, reads, pct: colTotals[ti] ? (100 * reads / colTotals[ti]) : 0, color: colorOf(c) };
    }).filter(r => r.reads > 0).sort((a, b) => b.reads - a.reads).slice(0, 8);
    return rows;
    // colorOf is stable-enough for memo deps via colorMode/colors.
  }, [hoverIdx, visibleCands, chart.candidates, colTotals, colorMode, aColors, bColors, candColors]);

  // Build a polyline points string for one candidate.
  const pointsFor = (cand: string): string => chart.transfers.map((_, ti) => `${xOf(ti)},${yOf(valAt(cand, ti))}`).join(' ');
  const otherPoints = useMemo(() => {
    if (!otherSeries) return null;
    return chart.transfers.map((_, ti) => {
      const v = normalize === 'fraction' ? (colTotals[ti] ? otherSeries[ti] / colTotals[ti] : 0) : otherSeries[ti];
      return `${xOf(ti)},${yOf(v)}`;
    }).join(' ');
  }, [otherSeries, normalize, colTotals, yMax, n]);

  // Draw order: dimmed first, emphasized last (so highlighted lines sit on top).
  const drawOrder = useMemo(() => {
    const em: string[] = [], dim: string[] = [];
    for (const c of visibleCands) (emphasized(c) ? em : dim).push(c);
    return [...dim, ...em];
  }, [visibleCands, hoverCand, hoverSubunit, selectedCands]);

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col">
      <div className="px-2 pt-1 pb-0.5 text-[11px] text-slate-500 dark:text-gray-400">
        Trajectory: each line is one candidate over the transfer time course. Hover for the per-transfer breakdown; click a line to select it.
        {otherCands.length > 0 && <span className="ml-1">Top {visibleCands.length} shown; the remaining {otherCands.length} are summed as a grey Other line.</span>}
      </div>
      <div className="flex-1 min-h-0 w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
          onMouseMove={handleMove}
          onMouseLeave={() => { setHoverIdx(null); setMouse(null); onHoverCandidate?.(null); }}
        >
          {/* horizontal gridlines + y tick labels */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={m.left} x2={W - m.right} y1={yOf(t.v)} y2={yOf(t.v)} stroke="currentColor" className="text-slate-200 dark:text-gray-700" strokeWidth={1} />
              <text x={m.left - 10} y={yOf(t.v) + 4} textAnchor="end" className="fill-slate-700 dark:fill-gray-200" style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</text>
            </g>
          ))}
          {/* x axis ticks + labels */}
          {chart.transfers.map((t, ti) => (
            <g key={ti}>
              <line x1={xOf(ti)} x2={xOf(ti)} y1={m.top} y2={m.top + ih} stroke="currentColor" className="text-slate-100 dark:text-gray-800" strokeWidth={1} />
              <text x={xOf(ti)} y={m.top + ih + 22} textAnchor="middle" className="fill-slate-700 dark:fill-gray-200" style={{ fontSize: 13, fontWeight: 700 }}>T{t}</text>
            </g>
          ))}
          {/* axis titles */}
          <text x={m.left + iw / 2} y={H - 8} textAnchor="middle" className="fill-slate-800 dark:fill-gray-100" style={{ fontSize: 14, fontWeight: 700 }}>Transfer</text>
          <text x={16} y={m.top + ih / 2} textAnchor="middle" transform={`rotate(-90 16 ${m.top + ih / 2})`} className="fill-slate-800 dark:fill-gray-100" style={{ fontSize: 14, fontWeight: 700 }}>
            {normalize === 'fraction' ? 'Fraction of reads' : 'Read count'}
          </text>

          {/* the faint grey Other line (drawn under everything) */}
          {otherPoints && (
            <polyline points={otherPoints} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />
          )}

          {/* candidate lines */}
          {drawOrder.map(cand => {
            const em = emphasized(cand);
            const dim = !em && anyFocus;
            const col = colorOf(cand);
            const isSel = hasSel && selectedCands.has(cand);
            return (
              <g key={cand} style={{ cursor: onPickCandidate ? 'pointer' : 'default' }}
                onClick={() => onPickCandidate?.(cand)}
                onMouseEnter={() => onHoverCandidate?.(cand)}
              >
                {/* fat invisible hit line for easy hovering/clicking */}
                <polyline points={pointsFor(cand)} fill="none" stroke="transparent" strokeWidth={12} />
                <polyline
                  points={pointsFor(cand)} fill="none" stroke={col}
                  strokeWidth={em ? 3.5 : 1.6}
                  opacity={dim ? 0.22 : 1}
                  strokeLinejoin="round" strokeLinecap="round"
                />
                {/* dots only when emphasized or selected, to keep it clean */}
                {(em || isSel) && chart.transfers.map((_, ti) => (
                  <circle key={ti} cx={xOf(ti)} cy={yOf(valAt(cand, ti))} r={isSel ? 4 : 3} fill={col} stroke="#fff" strokeWidth={isSel ? 1.5 : 1} opacity={dim ? 0.22 : 1} />
                ))}
              </g>
            );
          })}

          {/* crosshair at the snapped transfer */}
          {hoverIdx != null && (
            <line x1={xOf(hoverIdx)} x2={xOf(hoverIdx)} y1={m.top} y2={m.top + ih} stroke="#0f172a" className="dark:stroke-white" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
          )}
        </svg>
      </div>

      {/* crosshair tooltip: lists candidates at the snapped transfer */}
      {hoverIdx != null && mouse && tipRows.length > 0 && (() => {
        const svg = svgRef.current;
        const r = svg?.getBoundingClientRect();
        // Convert svg user-units back to displayed pixels for placement.
        const left = r ? (mouse.x / W) * r.width : 0;
        const top = r ? (mouse.y / H) * r.height : 0;
        const flipX = left > (r ? r.width * 0.6 : 9999);
        return (
          <div
            className="pointer-events-none absolute z-30 rounded-lg bg-slate-900/95 dark:bg-black/90 text-white shadow-xl ring-1 ring-white/10 px-3 py-2 text-[11.5px] leading-snug"
            style={{ left, top, transform: `translate(${flipX ? 'calc(-100% - 16px)' : '16px'}, -50%)`, minWidth: 200, maxWidth: 280 }}
          >
            <div className="font-bold mb-1 tabular-nums">Transfer T{chart.transfers[hoverIdx]}</div>
            {tipRows.map(row => (
              <div key={row.cand} className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm ring-1 ring-white/40 shrink-0" style={{ background: row.color }} />
                <span className="font-mono">{row.cand}</span>
                <span className="ml-auto tabular-nums text-slate-300">{row.reads.toLocaleString()} ({row.pct.toFixed(1)}%)</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeatmapChart: a candidate (rows) x transfer (columns) grid for FOCUS mode. Each
// cell's colour is the candidate's own stable colour (candColors), with opacity =
// that candidate's FRACTION of reads at that transfer. A single-hue intensity
// ramp PER ROW is clearer than a shared blue ramp here because it keeps each
// candidate's identity colour (so a reviewer can still recognise A1-B1 by its
// hue) while the intensity conveys magnitude. Readable mono labels in a left
// gutter, transfer labels across the top, per-cell hover tooltip, row click to
// select, row hover highlight, selection emphasis, capped at ~30 rows.
// ---------------------------------------------------------------------------
interface HeatmapProps {
  chart: BarcodeChart;
  stats: ChartStats;
  colorMode: ColorMode;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;
  hoverCand?: string | null;
  hoverSubunit?: SubunitRef | null;
  onPickCandidate?: (cand: string) => void;
  onHoverCandidate?: (cand: string | null) => void;
}
const HEATMAP_MAX_ROWS = 30;
function HeatmapChart({
  chart, stats, colorMode, aColors, bColors, candColors,
  selectedCands, isolateSelected, topN, hoverCand, hoverSubunit, onPickCandidate, onHoverCandidate,
}: HeatmapProps) {
  const [cell, setCell] = useState<null | { cand: string; ti: number; reads: number; pct: number; color: string; x: number; y: number; flipX: boolean }>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Per-transfer totals for honest fractions.
  const colTotals = useMemo(() => chart.transfers.map((_, ti) => {
    let s = 0;
    for (const counts of Object.values(chart.candidates)) s += counts[ti] || 0;
    return s;
  }), [chart.candidates, chart.transfers]);

  // Rows = top candidates by total reads, but ALWAYS include selected ones.
  const rows = useMemo(() => {
    let all = Object.keys(chart.candidates);
    if (isolateSelected && selectedCands.size > 0) all = all.filter(c => selectedCands.has(c));
    const ordered = stats.candidateTotals.map(t => t.cand).filter(c => all.includes(c));
    const cap = HEATMAP_MAX_ROWS;
    const head = ordered.slice(0, cap);
    // Make sure every selected candidate is visible even if outside the cap.
    for (const c of selectedCands) if (all.includes(c) && !head.includes(c)) head.push(c);
    return head;
  }, [chart.candidates, isolateSelected, selectedCands, stats.candidateTotals]);
  const hiddenCount = Math.max(0, Object.keys(chart.candidates).length - rows.length);

  const colorOf = (cand: string): string => {
    if (colorMode === 'partner-a') { const p = parseCandidate(cand); return p ? aColors[p.a] : '#888'; }
    if (colorMode === 'partner-b') { const p = parseCandidate(cand); return p ? bColors[p.b] : '#888'; }
    return candColors[cand] || '#888';
  };

  const hasSel = selectedCands.size > 0;
  const subHover = hoverSubunit;
  const emphasized = (cand: string) => {
    if (subHover) return candMatchesSubunit(cand, subHover);
    if (hoverCand) return cand === hoverCand;
    if (hasSel) return selectedCands.has(cand);
    return true;
  };
  const anyFocus = !!hoverCand || hasSel || !!subHover;

  const showCell = (e: React.MouseEvent, cand: string, ti: number, reads: number, pct: number, color: string) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left + (wrapRef.current?.scrollLeft || 0);
    const y = e.clientY - box.top + (wrapRef.current?.scrollTop || 0);
    setCell({ cand, ti, reads, pct, color, x, y, flipX: (e.clientX - box.left) > box.width * 0.6 });
  };

  const n = chart.transfers.length;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-auto px-2 py-2">
      <div className="text-[11px] text-slate-500 dark:text-gray-400 mb-1">
        Heatmap: rows are candidates (top {rows.length} by reads), columns are transfers. Cell intensity = that candidate&apos;s fraction of reads at that transfer.
        {hiddenCount > 0 && <span className="ml-1">{hiddenCount} lower candidate{hiddenCount === 1 ? '' : 's'} not shown (cap {HEATMAP_MAX_ROWS} rows).</span>}
      </div>
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white dark:bg-gray-800 text-left text-[10px] uppercase tracking-wide text-slate-400 dark:text-gray-500 pr-2 align-bottom" style={{ minWidth: 110 }}>Candidate</th>
            {chart.transfers.map((t, ti) => (
              <th key={ti} className="text-[12px] font-bold tabular-nums text-slate-700 dark:text-gray-200 text-center align-bottom px-0.5" style={{ minWidth: 34 }}>T{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(cand => {
            const em = emphasized(cand);
            const dim = !em && anyFocus;
            const isSel = hasSel && selectedCands.has(cand);
            const baseColor = colorOf(cand);
            return (
              <tr key={cand}
                className={cn(onPickCandidate ? 'cursor-pointer' : '', 'group/row')}
                style={{ opacity: dim ? 0.35 : 1 }}
                onClick={() => onPickCandidate?.(cand)}
                onMouseEnter={() => onHoverCandidate?.(cand)}
                onMouseLeave={() => onHoverCandidate?.(null)}
              >
                <th className={cn('sticky left-0 z-10 text-left pr-2 font-normal', 'bg-white dark:bg-gray-800')} style={{ minWidth: 110 }}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm ring-1 ring-black/10 shrink-0" style={{ background: baseColor }} />
                    <span className={cn('font-mono', isSel ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-gray-200')} style={{ fontSize: 11.5 }}>{cand}</span>
                  </span>
                </th>
                {chart.transfers.map((t, ti) => {
                  const reads = chart.candidates[cand]?.[ti] || 0;
                  const frac = colTotals[ti] ? reads / colTotals[ti] : 0;
                  const pct = frac * 100;
                  // Opacity ramp: faint floor so non-zero low cells stay visible.
                  const op = reads > 0 ? Math.max(0.12, Math.min(1, frac)) : 0;
                  return (
                    <td key={ti} className="p-0">
                      <div
                        className={cn('h-7 rounded-sm flex items-center justify-center transition-transform', isSel && 'ring-2 ring-slate-900 dark:ring-white')}
                        style={{ width: 34, background: reads > 0 ? baseColor : 'transparent', opacity: reads > 0 ? op : 1, boxShadow: reads > 0 ? 'none' : 'inset 0 0 0 1px rgba(148,163,184,0.2)' }}
                        onMouseEnter={(e) => showCell(e, cand, ti, reads, pct, baseColor)}
                        onMouseMove={(e) => showCell(e, cand, ti, reads, pct, baseColor)}
                        onMouseLeave={() => setCell(null)}
                        title=""
                      >
                        {frac >= 0.5 && <span className="text-[9px] font-bold tabular-nums text-white" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.6)' }}>{Math.round(pct)}</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {n === 0 && <div className="text-[12px] text-slate-400 mt-2">No transfers.</div>}

      {/* cell hover tooltip */}
      {cell && (
        <div
          className="pointer-events-none absolute z-30 rounded-lg bg-slate-900/95 dark:bg-black/90 text-white shadow-xl ring-1 ring-white/10 px-3 py-2 text-[11.5px] leading-snug"
          style={{ left: cell.x, top: cell.y, transform: `translate(${cell.flipX ? 'calc(-100% - 14px)' : '14px'}, 14px)`, minWidth: 170 }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="inline-block w-3 h-3 rounded-sm ring-1 ring-white/40 shrink-0" style={{ background: cell.color }} />
            <span className="font-mono font-bold">{cell.cand}</span>
          </div>
          <div className="tabular-nums">
            <span className="font-semibold">{cell.reads.toLocaleString()}</span> reads
            <span className="text-slate-400"> · </span>
            <span className="font-semibold">{cell.pct.toFixed(1)}%</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Transfer T{chart.transfers[cell.ti]}</div>
        </div>
      )}
    </div>
  );
}

interface ChartProps {
  chart: BarcodeChart;
  stats: ChartStats;
  colorMode: ColorMode;
  splitAB: boolean;
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
  hoverSubunit?: SubunitRef | null; // transient subunit highlight (sidebar group-header hover)
  height: number;          // SVG inner height target
  onPickCandidate?: (cand: string) => void;
  // Compare-only: force a COMMON y-axis maximum (read count) across several
  // charts so bars are visually comparable. Ignored when normalize === 'fraction'
  // (fraction always tops out at 1). Default undefined keeps per-chart auto-scale.
  yMaxOverride?: number;
  // Compare-only: cross-chart hover. When the user hovers a bar segment we can
  // push that candidate up to the parent so every compared chart lights it up.
  onHoverCandidate?: (cand: string | null) => void;
  onOpenOther?: (request: OtherRollupRequest) => void;
  // Compare-only: the compare tile renders its own clean header (with a clear
  // remove button), so we suppress ChartCard's built-in header to avoid a
  // duplicate. Default keeps the header for grid / focus.
  hideHeader?: boolean;
}

function ChartCard({
  chart, stats, colorMode, splitAB, normalize, aColors, bColors, candColors,
  selectedCands, isolateSelected, topN, hoverCand, hoverSubunit, height, onPickCandidate,
  yMaxOverride, onHoverCandidate, onOpenOther, hideHeader,
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
  const PAD_L = 56, PAD_R = 28, PAD_T = 24, PAD_B = 46;
  const innerH = height;
  const H = innerH + PAD_T + PAD_B;
  const innerW = W - PAD_L - PAD_R;

  const maxRaw = Math.max(1, ...totals);
  // In compare, a common y-max is passed so every chart shares one scale and
  // bars are truly comparable. We still never go below this chart's own data
  // (Math.max) so a tall bar is never clipped if the override is somehow stale.
  const maxCount = yMaxOverride != null ? Math.max(maxRaw, yMaxOverride) : maxRaw;
  const maxY = normalize === 'fraction' ? 1 : maxCount;
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
  //   - a hovered subunit wins instantly: every candidate sharing that VerA/VerB
  //     subunit is solid while the hover is active (lets a reviewer light up all
  //     A81-* or all *-B151 at once by hovering a group header).
  //   - else hoveredCand wins: it is the only solid bar while a hover is active.
  //   - otherwise, if a selection exists, selected candidates are solid and the
  //     rest are dimmed for context.
  //   - with no hover and no selection, everything is solid.
  const hasSelection = selectedCands.size > 0;
  const hasSubHover = !!hoverSubunit;
  const isSelected = (cand: string) => selectedCands.has(cand);
  const isEmphasized = (cand: string) => {
    if (hasSubHover) return candMatchesSubunit(cand, hoverSubunit!);
    if (hoverCand) return cand === hoverCand;
    if (hasSelection) return isSelected(cand);
    return true;
  };
  const isDimmed = (cand: string) => cand !== '__OTHER__' && !isEmphasized(cand) && (hasSubHover || hoverCand != null || hasSelection);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden h-full flex flex-col">
      {!hideHeader && (
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 flex items-center gap-2 text-[12px] shrink-0">
        {chart.well && (
          <>
            <span className="font-mono font-semibold text-slate-800 dark:text-gray-100" title={chartIdentityTitle(chart)}>{chart.well}</span>
            <span className="text-slate-400">|</span>
          </>
        )}
        {chart.sampleName && (
          <>
            <span className="font-mono text-slate-600 dark:text-gray-300 truncate max-w-[220px]" title={chartIdentityTitle(chart)}>{chart.sampleName}</span>
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
      )}

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
                <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={13} className="fill-slate-600 dark:fill-gray-300 tabular-nums">
                  {normalize === 'fraction' ? `${Math.round(v * 100)}%` : Math.round(v)}
                </text>
              </g>
            );
          })}
          <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + innerH} y2={PAD_T + innerH} stroke="currentColor" className="text-slate-400 dark:text-gray-500" strokeWidth={1} />
          <text x={16} y={PAD_T + innerH / 2} textAnchor="middle" fontSize={14} fontWeight={600} transform={`rotate(-90 16 ${PAD_T + innerH / 2})`} className="fill-slate-700 dark:fill-gray-200">
            {normalize === 'fraction' ? 'Fraction of reads' : 'Read count'}
          </text>
          <text x={PAD_L + innerW / 2} y={H - 8} textAnchor="middle" fontSize={14} fontWeight={600} className="fill-slate-700 dark:fill-gray-200">Transfer (passage)</text>

          {chart.transfers.map((t, ti) => {
            const total = totals[ti];
            const cx = PAD_L + xStep * ti + xStep / 2;
            const baseY = PAD_T + innerH;

            // Build the three stackings for this transfer:
            //  - AB:   full A-B candidates (candColors)
            //  - A:    reads aggregated by VerA subunit (aColors)
            //  - B:    reads aggregated by VerB subunit (bColors)
            // VerA/VerB are the SAME total reads, just grouped differently, so all
            // three sub-bars are the same height and directly comparable.
            const abStack: { key: string; label: string; v: number; color: string; cand?: string }[] =
              visibleCands.map(c => ({ key: c, label: c, v: chart.candidates[c]?.[ti] || 0, color: candColors[c] || '#888', cand: c }));
            if (otherCounts && otherCounts[ti] > 0) abStack.push({ key: '__OTHER__', label: 'Other', v: otherCounts[ti], color: '#94a3b8' });

            // Aggregate by subunit across ALL candidates in the chart (not just the
            // visible top-N) so the A and B breakdowns are complete and honest.
            const aAgg = new Map<string, number>();
            const bAgg = new Map<string, number>();
            for (const [cand, counts] of Object.entries(chart.candidates)) {
              const val = counts[ti] || 0;
              if (!val) continue;
              const p = parseCandidate(cand);
              if (!p) continue;
              aAgg.set(p.a, (aAgg.get(p.a) || 0) + val);
              bAgg.set(p.b, (bAgg.get(p.b) || 0) + val);
            }
            const aStack = [...aAgg.entries()].sort((x, y) => y[1] - x[1])
              .map(([a, v]) => ({ key: `A:${a}`, label: a, v, color: aColors[a] || '#888' }));
            const bStack = [...bAgg.entries()].sort((x, y) => y[1] - x[1])
              .map(([b, v]) => ({ key: `B:${b}`, label: b, v, color: bColors[b] || '#888' }));

            // Renders one stacked sub-bar. subX/subW position it within the slot.
            const renderSubBar = (
              segs: { key: string; label: string; v: number; color: string; cand?: string }[],
              subX: number, subW: number, groupLabel: string,
            ) => {
              let acc = 0;
              return segs.map(seg => {
                if (!seg.v) return null;
                const norm = normalize === 'fraction' ? (total ? seg.v / total : 0) : seg.v;
                const h = (norm / maxY) * innerH;
                const y = baseY - acc - h;
                acc += h;
                const isCandSeg = !!seg.cand && seg.cand !== '__OTHER__';
                const selected = isCandSeg && hasSelection && isSelected(seg.cand!);
                // In split mode, emphasis only applies to the A-B sub-bar (the only
                // one whose segments map 1:1 to selectable candidates).
                const dim = isCandSeg && isDimmed(seg.cand!);
                const pctNum = total ? (100 * seg.v / total) : 0;
                const pctStrFine = total ? `${pctNum.toFixed(1)}%` : '';
                const showCount = h >= LABEL_MIN_H && subW >= 22;
                const showName = h >= LABEL_NAME_MIN_H && subW >= 30;
                const midY = y + h / 2;
                const subCx = subX + subW / 2;
                const inlineLabel = showName ? `${seg.label} · ${total ? `${pctNum.toFixed(0)}%` : seg.v}` : `${total ? `${pctNum.toFixed(0)}%` : seg.v}`;
                // Richer tooltip. For the A-B sub-bar, break out the VerA and VerB
                // subunits. For the VerA / VerB sub-bars, note that the segment is the
                // sum of every combination sharing that subunit.
                let tipText: string;
                if (groupLabel === 'A-B') {
                  const pp = isCandSeg ? parseCandidate(seg.cand!) : null;
                  const breakout = pp ? `\nVerA ${pp.a}  ·  VerB ${pp.b}` : '';
                  tipText = `A-B: ${seg.label}${breakout}\nreads: ${seg.v}${total ? `   (${pctStrFine} of bar)` : ''}\nT${t} · bar total ${total}`;
                } else {
                  const kindWord = groupLabel === 'VerA' ? 'VerA' : 'VerB';
                  const combos = groupLabel === 'VerA' ? `${seg.label}-*` : `*-${seg.label}`;
                  tipText = `${kindWord} ${seg.label}: ${seg.v} reads${total ? `, ${pctStrFine} of bar` : ''}\n(sum of all ${combos} combinations)\nT${t} · bar total ${total}`;
                }
                return (
                  <g key={seg.key}>
                    <rect
                      x={subX} y={y} width={subW} height={Math.max(0.5, h)}
                      fill={seg.color}
                      stroke={selected ? '#0f172a' : 'rgba(255,255,255,0.4)'}
                      strokeWidth={selected ? 1.5 : 0.4}
                      opacity={dim ? 0.16 : 1}
                       style={{ cursor: (isCandSeg && onPickCandidate) || (seg.key === '__OTHER__' && onOpenOther) ? 'pointer' : 'default' }}
                       onClick={() => {
                         if (isCandSeg) onPickCandidate?.(seg.cand!);
                         else if (seg.key === '__OTHER__') onOpenOther?.({ chart, transfer: t, transferIndex: ti, otherCands });
                       }}

                      onMouseEnter={(e) => {
                        const svg = (e.currentTarget as SVGRectElement).ownerSVGElement;
                        const rect = svg?.getBoundingClientRect();
                        const px = rect ? e.clientX - rect.left : 0;
                        const py = rect ? e.clientY - rect.top : 0;
                        setHover({ x: px, y: py, text: tipText, flipX: rect ? px > rect.width - 200 : false, flipY: py < 56 });
                        // Cross-chart sync: only the A-B sub-bar maps 1:1 to a candidate.
                        if (isCandSeg) onHoverCandidate?.(seg.cand!);
                      }}
                      onMouseLeave={() => { setHover(null); if (isCandSeg) onHoverCandidate?.(null); }}
                    >
                      <title>{tipText.replace(/\n/g, ' · ')}</title>
                    </rect>
                    {showCount && !dim && (
                      <text x={subCx} y={midY + 3.5} textAnchor="middle"
                        fontSize={showName ? 10.5 : 9.5} className="pointer-events-none"
                        style={{ fill: 'white', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 2.4, strokeLinejoin: 'round', fontWeight: 700 }}>
                        {inlineLabel}
                      </text>
                    )}
                  </g>
                );
              });
            };

            if (splitAB) {
              // Three side-by-side sub-bars within the slot: A-B | VerA | VerB.
              // The 3-bar group takes ~68% of the slot so there is a CLEAR gap
              // between consecutive transfers (Nidhi: hard to tell transfers apart
              // when the groups nearly touch). A faint divider reinforces the break.
              const gap = Math.max(6, slotW * 0.04);
              const groupW = Math.min(BAR_CAP * 1.7, slotW * 0.68);
              const subW = Math.max(7, (groupW - gap * 2) / 3);
              const gx = cx - groupW / 2;
              const showDivider = ti < chart.transfers.length - 1;
              return (
                <g key={ti}>
                  {/* faint divider in the gap after this transfer group */}
                  {showDivider && (
                    <line
                      x1={PAD_L + xStep * (ti + 1)} x2={PAD_L + xStep * (ti + 1)}
                      y1={PAD_T} y2={baseY}
                      stroke="currentColor" strokeWidth={1} strokeDasharray="3 3"
                      className="text-slate-200 dark:text-gray-700"
                    />
                  )}
                  <text x={cx} y={H - PAD_B + 16} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-slate-700 dark:fill-gray-200 tabular-nums">T{t}</text>
                  {renderSubBar(abStack, gx, subW, 'A-B')}
                  {renderSubBar(aStack, gx + subW + gap, subW, 'VerA')}
                  {renderSubBar(bStack, gx + (subW + gap) * 2, subW, 'VerB')}
                  {/* sub-bar group labels under each */}
                  {[['A-B', gx], ['VerA', gx + subW + gap], ['VerB', gx + (subW + gap) * 2]].map(([lab, sx]) => (
                    <text key={lab as string} x={(sx as number) + subW / 2} y={H - PAD_B + 30} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-slate-500 dark:fill-gray-400">{lab}</text>
                  ))}
                  {total > 0 && (() => {
                    // All three sub-bars are the same total height; label sits just above.
                    const barH = ((normalize === 'fraction' ? 1 : total) / maxY) * innerH;
                    return (
                      <text x={cx} y={baseY - barH - 5} textAnchor="middle" fontSize={11} className="fill-slate-700 dark:fill-gray-200 tabular-nums" fontWeight={600}>
                        {normalize === 'fraction' ? '100%' : total.toLocaleString()}
                      </text>
                    );
                  })()}
                </g>
              );
            }

            // Single combined bar (default).
            const x = cx - barW / 2;
            let acc = 0;
            const stack: { cand: string; v: number }[] = visibleCands.map(c => ({ cand: c, v: chart.candidates[c]?.[ti] || 0 }));
            if (otherCounts && otherCounts[ti] > 0) stack.push({ cand: '__OTHER__', v: otherCounts[ti] });
            return (
              <g key={ti}>
                <text x={cx} y={H - PAD_B + 16} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-slate-700 dark:fill-gray-200 tabular-nums">T{t}</text>
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
                  // Richer tooltip: candidate, VerA / VerB broken out, reads, % of
                  // bar, the transfer, and the bar total. Built per-segment (cheap).
                  const pp = cand !== '__OTHER__' ? parseCandidate(cand) : null;
                  const tipText = cand === '__OTHER__'
                    ? `Other (${otherCands.length} candidates)\nreads: ${v}${total ? `   (${pctStrFine} of bar)` : ''}\nT${t} · bar total ${total}\nclick to inspect rolled-up candidates`
                    : `A-B: ${cand}${pp ? `\nVerA ${pp.a}  ·  VerB ${pp.b}` : ''}\nreads: ${v}${total ? `   (${pctStrFine} of bar)` : ''}\nT${t} · bar total ${total}`;
                  return (
                    <g key={cand}>
                      <rect
                        x={x} y={y} width={barW} height={Math.max(0.5, h)}
                        fill={color}
                        stroke={selected ? '#0f172a' : 'rgba(255,255,255,0.4)'}
                        strokeWidth={selected ? 1.5 : 0.4}
                        opacity={dim ? 0.16 : 1}
                        style={{ cursor: (cand !== '__OTHER__' && onPickCandidate) || (cand === '__OTHER__' && onOpenOther) ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (cand !== '__OTHER__') onPickCandidate?.(cand);
                          else onOpenOther?.({ chart, transfer: t, transferIndex: ti, otherCands });
                        }}
                        onMouseEnter={(e) => {
                          const svg = (e.currentTarget as SVGRectElement).ownerSVGElement;
                          const rect = svg?.getBoundingClientRect();
                          const px = rect ? e.clientX - rect.left : 0;
                          const py = rect ? e.clientY - rect.top : 0;
                          setHover({ x: px, y: py, text: tipText, flipX: rect ? px > rect.width - 200 : false, flipY: py < 56 });
                          if (cand !== '__OTHER__') onHoverCandidate?.(cand);
                        }}
                        onMouseLeave={() => { setHover(null); if (cand !== '__OTHER__') onHoverCandidate?.(null); }}
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
  const [otherRollup, setOtherRollup] = useState<OtherRollupRequest | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Subunit whose cross-chart detail popup is open (null = closed). Mirrors detailCand
  // but for a whole VerA or VerB subunit aggregated across its A-B partners.
  const [detailSubunit, setDetailSubunit] = useState<SubunitRef | null>(null);
  const figureRef = useRef<HTMLDivElement | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateMinReads, setCandidateMinReads] = useState(0);
  const [candidateMinCharts, setCandidateMinCharts] = useState(0);
  const [candidateFinalOnly, setCandidateFinalOnly] = useState(false);
  const [candidateDominantOnly, setCandidateDominantOnly] = useState(false);
  const [selectionFiltersCharts, setSelectionFiltersCharts] = useState(true);
  const [onlyFlipped, setOnlyFlipped] = useState(false);

  // Rendering controls
  const [view, setView] = useState<ViewMode>('grid');
  const [comparing, setComparing] = useState<string[]>([]); // up to 4 chart keys
  const COMPARE_MAX = 24;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersBtnRef = useRef<HTMLButtonElement | null>(null);
  const filtersPopRef = useRef<HTMLDivElement | null>(null);
  const [candSort, setCandSort] = useState<CandSortKey>('reads');
  const [candGroup, setCandGroup] = useState<CandGroupKey>('none');
  const [colorMode, setColorMode] = useState<ColorMode>('candidate');
  // Split-bar view: when on, each transfer bar is subdivided into three side-by-side
  // sub-bars (A-B combined, VerA-only breakdown, VerB-only breakdown) so the user can
  // see how the individual VerA and VerB subunits behave alongside the combination,
  // all in stable per-identity colors (Nidhi 2026-06).
  const [splitAB, setSplitAB] = useState(false);
  // Focus-mode orientation. 'horizontal' renders each transfer as a full-width HTML
  // row of stacked segments with crisp, non-scaling labels (far more readable than
  // the SVG vertical bars, which shrink their text to fit width). Default 'rows'
  // in focus because that is what humans can actually read (Nidhi 2026-06).
  // 'rows' = HorizontalBarChart, 'bars' = ChartCard (vertical SVG),
  // 'lines' = TrajectoryChart (time-course tracker), 'heatmap' = HeatmapChart.
  const [focusChart, setFocusChart] = useState<'rows' | 'bars' | 'lines' | 'heatmap'>('rows');
  const [normalize, setNormalize] = useState<Normalize>('count');
  const [perspective, setPerspective] = useState<BarcodePerspective>('final');
  const [topN, setTopN] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>('natural');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Transient hover highlight: hovering a candidate row in the sidebar lights up
  // that candidate's segments across every visible chart (without committing a pin).
  const [hoveredCand, setHoveredCand] = useState<string | null>(null);
  // Transient subunit hover: hovering a VerA/VerB group header in the sidebar lights
  // up EVERY candidate sharing that subunit across all visible charts (no commit).
  const [hoveredSubunit, setHoveredSubunit] = useState<SubunitRef | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  // Compare view needs the room; leaving compare should preserve the user's own sidebar choice.
  useEffect(() => { if (view === 'compare') setShowSidebar(false); }, [view]);
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

  const loadBarcodeData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetchData('/api/barcode-counts', { signal });
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
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    const controller = new AbortController();
    void loadBarcodeData(controller.signal);
    return () => controller.abort();
  }, [loadBarcodeData]);

  useEffect(() => {
    const controller = new AbortController();
    void loadBarcodeData(controller.signal);
    return () => {
      controller.abort();
      setData(null);
    };
  }, [loadBarcodeData]);

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
    const idx = new Map<string, CandidateMetric>();
    for (const c of data?.charts ?? []) {
      const lastIdx = c.transfers.length - 1;
      let finalTotal = 0;
      let dominant: string | null = null;
      let dominantReads = -1;
      for (const [cand, counts] of Object.entries(c.candidates)) {
        const lastReads = counts[lastIdx] || 0;
        finalTotal += lastReads;
        if (lastReads > dominantReads) { dominantReads = lastReads; dominant = cand; }
      }
      for (const [cand, counts] of Object.entries(c.candidates)) {
        const sum = counts.reduce((a, v) => a + (v || 0), 0);
        if (sum <= 0) continue;
        const lastReads = counts[lastIdx] || 0;
        const cur = idx.get(cand) ?? { charts: 0, total: 0, finalPresentCharts: 0, finalReads: 0, finalFraction: 0, dominantCharts: 0 };
        cur.charts += 1;
        cur.total += sum;
        if (lastReads > 0) {
          cur.finalPresentCharts += 1;
          cur.finalFraction += finalTotal ? lastReads / finalTotal : 0;
        }
        cur.finalReads += lastReads;
        if (cand === dominant && lastReads > 0) cur.dominantCharts += 1;
        idx.set(cand, cur);
      }
    }
    for (const metric of idx.values()) metric.finalFraction = metric.finalPresentCharts ? metric.finalFraction / metric.finalPresentCharts : 0;
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
      .filter(c => !q || `${c.well} ${c.sampleName ?? ''} ${(c.seqsamples ?? []).join(' ')} ${c.strain} ${c.library} ${c.transformationLibrary ?? ''} ${c.experiment} rep${c.replicate}`.toLowerCase().includes(q))
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
        if (!selectionFiltersCharts || selectedCands.size === 0) return true;
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
  }, [data, selectedLibs, selectedWells, transferRange, minTotal, selectedCands, selectionFiltersCharts, onlyFlipped, search, statsByKey, sortKey, sortDir]);

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

  // Select/deselect an ENTIRE subunit at once. Given the candidate ids that share a
  // VerA or VerB subunit, if all are currently selected we remove them (toggle off);
  // otherwise we add the missing ones (toggle on). Used by the sidebar group headers.
  const toggleSubunitCands = useCallback((cands: string[]) => {
    setSelectedCands(prev => {
      const next = new Set(prev);
      const allSelected = cands.length > 0 && cands.every(c => next.has(c));
      if (allSelected) for (const c of cands) next.delete(c);
      else for (const c of cands) next.add(c);
      return next;
    });
  }, []);
  const clearCandidateSelection = useCallback(() => {
    setSelectedCands(new Set());
    setIsolateSelected(false);
    setSelectionFiltersCharts(true);
  }, []);

  const buildBarcodeFigureSpec = (): FigureSpec | null => {
    if (!data || visibleCharts.length === 0) return null;
    const chartsForExport = view === 'focus'
      ? (focusedChart ? [focusedChart] : [])
      : view === 'compare'
        ? comparing.map(key => visibleCharts.find(c => chartKey(c) === key) ?? data.charts.find(c => chartKey(c) === key)).filter((c): c is BarcodeChart => !!c).slice(0, 6)
        : visibleCharts.slice(0, 12);
    if (chartsForExport.length === 0) return null;
    const colorOf = (cand: string): string => {
      if (colorMode === 'partner-a') { const p = parseCandidate(cand); return p ? aColors[p.a] : '#888888'; }
      if (colorMode === 'partner-b') { const p = parseCandidate(cand); return p ? bColors[p.b] : '#888888'; }
      return candColors[cand] || '#888888';
    };
    const panelSpecs = chartsForExport.map(chart => {
      const stats = statsByKey.get(chartKey(chart)) ?? statsFor(chart);
      let candidates = stats.candidateTotals.map(row => row.cand);
      if (isolateSelected && selectedCands.size > 0) candidates = candidates.filter(cand => selectedCands.has(cand));
      const capped = topN > 0 ? candidates.slice(0, topN) : candidates;
      const values = capped.flatMap(candidate => {
        const counts = chart.candidates[candidate] ?? [];
        return chart.transfers.map((transfer, idx) => {
          const value = counts[idx] || 0;
          const total = Object.values(chart.candidates).reduce((sum, arr) => sum + (arr[idx] || 0), 0);
          const fraction = total > 0 ? value / total : 0;
          return { candidateId: candidate, transfer, value, fraction, valueLabel: normalize === 'fraction' ? `${Math.round(fraction * 100)}%` : value.toLocaleString() };
        });
      });
      return {
        id: chartKey(chart),
        label: chartIdentityLabel(chart),
        subtitle: chartIdentitySubtitle(chart),
        transfers: chart.transfers,
        candidates: capped.map(candidate => ({ id: candidate, label: candidate, color: colorOf(candidate) })),
        values,
      };
    }).filter(panel => panel.candidates.length > 0 && panel.transfers.length > 0);
    if (panelSpecs.length === 0) return null;
    const exportKind = view === 'focus' && focusChart === 'heatmap' ? 'barcodeHeatmap' : 'barcodeBars';
    const subtitleParts = [
      view === 'focus' ? `Focus view, ${focusChart}` : view === 'compare' ? `${panelSpecs.length} compared charts` : `${panelSpecs.length} visible charts`,
      normalize === 'fraction' ? 'fraction of reads' : 'read count',
      colorMode === 'partner-a' ? 'VerA colors' : colorMode === 'partner-b' ? 'VerB colors' : 'A-B candidate colors',
      topN > 0 ? `top ${topN}` : 'all candidates',
    ];
    return {
      kind: exportKind,
      title: view === 'focus' ? 'Barcode composition for focused sample' : view === 'compare' ? 'Barcode composition comparison' : 'Barcode composition overview',
      subtitle: subtitleParts.join(', '),
      xTitle: 'Transfer',
      yTitle: normalize === 'fraction' ? 'Fraction of reads' : 'Read count',
      legendTitle: colorMode === 'partner-a' ? 'VerA subunits' : colorMode === 'partner-b' ? 'VerB subunits' : 'A-B candidates',
      width: Math.max(1100, Math.min(2200, 300 + Math.min(2, panelSpecs.length) * 440)),
      height: Math.max(820, Math.min(2600, 250 + Math.ceil(panelSpecs.length / Math.min(2, Math.max(1, panelSpecs.length))) * 310)),
      normalize,
      colorMode,
      panels: panelSpecs,
      caption: 'Barcode panels are rendered from verAB_barcodes counts after the active filters, transfer range, candidate selection, color mode, normalization, and top-N rollup settings. Fractions use per-transfer total reads.',
    };
  };

  const resetFilters = () => {
    setSelectedLibs(new Set(data?.libraries ?? []));
    setSelectedWells(new Set(data?.wells ?? []));
    setSelectedCands(new Set());
    setIsolateSelected(false);
    setMinTotal(0);
    setCandidateMinReads(0);
    setCandidateMinCharts(0);
    setCandidateFinalOnly(false);
    setCandidateDominantOnly(false);
    setSelectionFiltersCharts(true);
    setOnlyFlipped(false);
    setSearch('');
    setCandidateQuery('');
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
    if (candidateMinReads > 0) n++;
    if (candidateMinCharts > 0) n++;
    if (candidateFinalOnly) n++;
    if (candidateDominantOnly) n++;
    if (!selectionFiltersCharts) n++;
    if (onlyFlipped) n++;
    if (search.trim()) n++;
    if (candidateQuery.trim()) n++;
    return n;
  }, [data, selectedLibs, selectedWells, transferRange, allTransferValues, minTotal, candidateMinReads, candidateMinCharts, candidateFinalOnly, candidateDominantOnly, selectionFiltersCharts, onlyFlipped, search, candidateQuery]);

  // Sorted + (optionally) grouped candidate list for the sidebar browser.
  const candidateRows = useMemo(() => {
    if (!data) return [] as (CandidateMetric & { cand: string })[];
    const q = candidateQuery.trim().toLowerCase();
    const base = allCandidates
      .filter(c => !q || c.toLowerCase().includes(q))
      .map(c => ({ cand: c, ...(candidateIndex.get(c) ?? { charts: 0, total: 0, finalPresentCharts: 0, finalReads: 0, finalFraction: 0, dominantCharts: 0 }) }))
      .filter(r => r.total >= candidateMinReads)
      .filter(r => candidateMinCharts <= 0 || r.charts >= candidateMinCharts)
      .filter(r => !candidateFinalOnly || r.finalPresentCharts > 0)
      .filter(r => !candidateDominantOnly || r.dominantCharts > 0);
    const numFromA = (c: string) => { const m = c.match(/^A(\d+)/); return m ? parseInt(m[1]) : 0; };
    const numFromB = (c: string) => { const m = c.match(/-B(\d+)/); return m ? parseInt(m[1]) : 0; };
    if (candSort === 'reads') base.sort((a, b) => b.total - a.total || a.cand.localeCompare(b.cand));
    else if (candSort === 'charts') base.sort((a, b) => b.charts - a.charts || b.total - a.total);
    else if (candSort === 'final') base.sort((a, b) => b.finalFraction - a.finalFraction || b.finalReads - a.finalReads || b.total - a.total);
    else if (candSort === 'dominance') base.sort((a, b) => b.dominantCharts - a.dominantCharts || b.finalFraction - a.finalFraction || b.total - a.total);
    else if (candSort === 'name') base.sort((a, b) => a.cand.localeCompare(b.cand));
    else if (candSort === 'varA') base.sort((a, b) => numFromA(a.cand) - numFromA(b.cand) || a.cand.localeCompare(b.cand));
    else if (candSort === 'varB') base.sort((a, b) => numFromB(a.cand) - numFromB(b.cand) || a.cand.localeCompare(b.cand));
    return base;
  }, [data, allCandidates, candidateIndex, candidateQuery, candidateMinReads, candidateMinCharts, candidateFinalOnly, candidateDominantOnly, candSort]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Compact, single-row toolbar. Heavy filters live behind the Filters
          popover so the candidate sidebar isn't squeezed. */}
      <div className="px-2 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 flex items-center gap-2 shrink-0" data-tour="barcode-toolbar">
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
            title="Counts from LIMS verAB_barcodes; biological labels use Seq_samples.Sample_Name when available"
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
          <button onClick={() => setView('perspectives')} disabled={visibleCharts.length === 0} className={cn('flex items-center gap-1 px-2 py-1 text-[11px] border-l border-slate-200 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed', view === 'perspectives' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')} title={visibleCharts.length === 0 ? 'No visible barcode charts for perspectives' : 'Researcher tables: final outcomes, presence, richness, depth, VerA, and VerB'}>
            <Rows3 className="w-3.5 h-3.5" /> Perspectives
          </button>
        </div>

        {/* Color */}
        <div className="flex items-center border border-slate-200 dark:border-gray-600 rounded overflow-hidden">
          {(['candidate','partner-a','partner-b'] as ColorMode[]).map((m, i) => (
            <button key={m} onClick={() => setColorMode(m)}
              className={cn('px-1.5 py-1 text-[10.5px] font-medium', i > 0 && 'border-l border-slate-200 dark:border-gray-600',
                colorMode === m ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')}
              title={m === 'partner-a' ? "Color by VerA partner" : m === 'partner-b' ? 'Color by VerB partner' : 'Color by full A-B candidate'}>
              {m === 'candidate' ? 'A-B' : m === 'partner-a' ? 'VerA' : 'VerB'}
            </button>
          ))}
        </div>

        {/* Split each bar into A-B / VerA / VerB sub-bars */}
        <button
          onClick={() => setSplitAB(v => !v)}
          className={cn('px-2 py-1 text-[10.5px] font-medium rounded border',
            splitAB
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-600')}
          title="Split each transfer bar into three sub-bars: the A-B combination, the VerA subunit breakdown, and the VerB subunit breakdown (same stable colors)."
        >
          Split A|B
        </button>

        <InfoPopover title="VerA / VerB and the A|B split" align="left">
          <p className="mb-1.5">A barcode label <span className="font-mono">A#-B#</span> is one <b>VerA</b> subunit paired with one <b>VerB</b> subunit. VerB is required for VerA activity and the pairing affects the substrate, so the VerA/VerB mix is what governs substrate specificity as the population evolves.</p>
          <p className="mb-1.5"><b>Color by</b> A-B, VerA, or VerB to ask different questions: track one exact combination, or all combinations sharing a VerA (or VerB) subunit.</p>
          <p><b>Split A|B</b> shows three sub-bars per transfer: the full A-B combinations, the same reads grouped by VerA, and grouped by VerB. They are the <i>same reads</i> shown three ways (a derived breakdown, not three different measurements), so all three sub-bars have the same total height per transfer.</p>
        </InfoPopover>

        {/* Focus chart-type selector: Rows (readable HTML stacks) / Bars (vertical
            SVG) / Lines (time-course trajectory tracker) / Heatmap (candidate x
            transfer grid). Replaces the old Rows/Bars orientation toggle. */}
        {view === 'focus' && (
          <div className="flex items-center border border-slate-200 dark:border-gray-600 rounded overflow-hidden" title="Focus chart type. Rows and Bars show one transfer at a time; Lines tracks each candidate over the time course; Heatmap scans many candidates x transfers at once.">
            {([
              { id: 'rows', label: 'Rows', title: 'Horizontal stacked rows: readable labels and percentages at any width' },
              { id: 'bars', label: 'Bars', title: 'Vertical SVG bars: compact stacked composition per transfer' },
              { id: 'lines', label: 'Lines', title: 'Trajectory lines: track how each candidate rises and falls over transfers' },
              { id: 'heatmap', label: 'Heatmap', title: 'Heatmap grid: candidate rows x transfer columns, colour = fraction of reads' },
            ] as const).map((o, i) => (
              <button key={o.id} onClick={() => setFocusChart(o.id)} title={o.title}
                className={cn('px-2 py-1 text-[10.5px] font-medium', i > 0 && 'border-l border-slate-200 dark:border-gray-600',
                  focusChart === o.id ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300')}>
                {o.label}
              </button>
            ))}
          </div>
        )}
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
                    placeholder="well / sample / Seqsample / library / strain"
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
              title={`${selectedCands.size} candidate${selectedCands.size === 1 ? '' : 's'} selected. ${selectionFiltersCharts ? 'Charts are filtered to those containing a selected candidate.' : 'Charts are not filtered; selected candidates are emphasized in-place.'}`}>
              <Target className="w-3 h-3" />
              {selectedCands.size} selected
              <button
                onClick={() => setSelectionFiltersCharts(v => !v)}
                className={cn('ml-0.5 px-1 py-0.5 rounded text-[10px] font-semibold border',
                  selectionFiltersCharts
                    ? 'bg-blue-600 text-white border-blue-700'
                    : 'bg-white/70 dark:bg-gray-800/60 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-200')}
                title={selectionFiltersCharts ? 'Filter charts ON: click to keep all currently visible charts and only emphasize selected candidates.' : 'Filter charts OFF: click to show only charts containing selected candidates.'}>
                Filter charts
              </button>
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
              <button onClick={clearCandidateSelection} className="ml-0.5 hover:text-blue-900 dark:hover:text-white" title="Clear selection">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button onClick={() => setSummaryOpen(true)} disabled={!data || visibleCharts.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50"
            title="Open a summary popup for the currently visible barcode charts">
            <Info className="w-3 h-3" /> Summary
          </button>
          <button onClick={() => data && downloadBlob('barcode-counts.csv', toCsv(visibleCharts))}
            disabled={!data || visibleCharts.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50"
            title="Download visible charts as CSV">
            <Download className="w-3 h-3" /> CSV
          </button>
          <ExportFigureMenu
            getTarget={() => figureRef.current}
            title={`AI-ALE barcode chart (${view} view)`}
            filenameBase={`barcode-${view}-${focusKey || comparing.length || visibleCharts.length}`}
            disabled={!data || visibleCharts.length === 0}
            buildSpec={buildBarcodeFigureSpec}
          />
          <button onClick={reload} className="p-1 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700" title="Reload">
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
            clearCandidateSelection={clearCandidateSelection}
            isolateSelected={isolateSelected}
            setIsolateSelected={setIsolateSelected}
            setHoveredCand={setHoveredCand}
            setHoveredSubunit={setHoveredSubunit}
            toggleSubunitCands={toggleSubunitCands}
            onOpenDetail={setDetailCand}
            onOpenSubunitDetail={setDetailSubunit}
            visibleCandSet={visibleCandSet}
            candidateIndex={candidateIndex}
            candidateQuery={candidateQuery}
            setCandidateQuery={setCandidateQuery}
            candSort={candSort}
            setCandSort={setCandSort}
            candGroup={candGroup}
            setCandGroup={setCandGroup}
            candidateMinReads={candidateMinReads}
            setCandidateMinReads={setCandidateMinReads}
            candidateMinCharts={candidateMinCharts}
            setCandidateMinCharts={setCandidateMinCharts}
            candidateFinalOnly={candidateFinalOnly}
            setCandidateFinalOnly={setCandidateFinalOnly}
            candidateDominantOnly={candidateDominantOnly}
            setCandidateDominantOnly={setCandidateDominantOnly}
            selectionFiltersCharts={selectionFiltersCharts}
            setSelectionFiltersCharts={setSelectionFiltersCharts}
          />
        )}

        {/* Chart area — internal scroll behavior depends on the view mode:
            grid scrolls vertically (thumbnails); focus & compare fill the
            viewport and only the candidate legend scrolls inside its column. */}
        <div ref={figureRef} className="flex-1 min-w-0 flex flex-col bg-slate-100/30 dark:bg-gray-900/30 overflow-hidden">
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
                        title={inCompare ? 'Remove from compare' : 'Add to compare'}
                      >
                        {inCompare ? '✓' : '+'}
                      </button>
                      <div className="px-1.5 py-1 border-b border-slate-200/50 dark:border-gray-700/50 pr-7">
                        <div className="flex items-center gap-1 text-[10px]">
                          {c.well
                            ? <span className="font-mono font-bold text-slate-700 dark:text-gray-200" title={chartIdentityTitle(c)}>{c.well}</span>
                            : <span className="font-mono font-bold text-slate-700 dark:text-gray-200">r{c.replicate}</span>}
                          <span className="font-mono text-slate-500 dark:text-gray-400 truncate" title={c.library}>{c.library}</span>
                          {stats.flipped && <span className="ml-auto text-[8.5px] font-bold uppercase text-amber-600" title="Flip: dominant candidate changed from first to last transfer">flip</span>}
                        </div>
                        {c.sampleName && <div className="mt-0.5 font-mono text-[8.5px] text-slate-400 dark:text-gray-500 truncate" title={chartIdentityTitle(c)}>{c.sampleName}</div>}
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
              colorMode={colorMode} splitAB={splitAB} normalize={normalize}
              orientation={focusChart}
              aColors={aColors} bColors={bColors} candColors={candColors}
              selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
              onToggleCand={toggleCand}
              onOpenDetail={setDetailCand}
              onOpenOther={setOtherRollup}
              onBack={() => setView('grid')}
              hoveredCand={hoveredCand}
              hoveredSubunit={hoveredSubunit}
              onHoverCandidate={setHoveredCand}
              onHoverSubunit={setHoveredSubunit}
              onToggleSubunitCands={toggleSubunitCands}
              onOpenSubunitDetail={setDetailSubunit}
              onAddToCompare={(k) => setComparing(prev => prev.includes(k) ? prev : prev.length >= COMPARE_MAX ? [...prev.slice(1), k] : [...prev, k])}
              isInCompare={comparing.includes(chartKey(focusedChart))}
            />
          )}

          {!loading && !error && view === 'perspectives' && data && visibleCharts.length > 0 && (
            <BarcodePerspectivesPanel
              charts={visibleCharts}
              statsByKey={statsByKey}
              mode={perspective}
              setMode={setPerspective}
              onExport={(aiVerAs) => downloadBlob(`barcode-perspective-${perspective}.csv`, perspectiveCsv(perspective, visibleCharts, statsByKey, aiVerAs))}
            />
          )}

          {!loading && !error && view === 'compare' && (
            <CompareView
              keys={comparing}
              charts={data?.charts ?? []}
              statsByKey={statsByKey}
              colorMode={colorMode} splitAB={splitAB} normalize={normalize} onNormalize={setNormalize}
              aColors={aColors} bColors={bColors} candColors={candColors}
              selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
              onToggleCand={toggleCand}
              onClearCandidates={clearCandidateSelection}
              onOpenOther={setOtherRollup}
              onBack={() => setView('grid')}
              hoveredCand={hoveredCand}
              hoveredSubunit={hoveredSubunit}
              onRemove={(k) => setComparing(prev => prev.filter(x => x !== k))}
              onHoverCandidate={setHoveredCand}
              onHoverSubunit={setHoveredSubunit}
              onToggleSubunitCands={toggleSubunitCands}
            />
          )}
        </div>
      </div>

      {summaryOpen && data && (
        <BarcodeSummaryModal
          data={data}
          visibleCharts={visibleCharts}
          statsByKey={statsByKey}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* Inspect candidates rolled into a grey Other segment. */}
      {otherRollup && (
        <OtherRollupModal
          request={otherRollup}
          candColors={candColors}
          onTrackCandidate={(cand) => {
            setSelectedCands(prev => new Set(prev).add(cand));
            setOtherRollup(null);
            setDetailCand(cand);
          }}
          onClose={() => setOtherRollup(null)}
        />
      )}

      {/* Per-candidate cross-chart detail popup. */}
      {detailCand && data && (
        <CandidateDetailModal
          cand={detailCand}
          charts={visibleCharts}
          candColors={candColors}
          aColors={aColors}
          bColors={bColors}
          candidateIndex={candidateIndex}
          isSelected={selectedCands.has(detailCand)}
          onToggleSelect={() => toggleCand(detailCand)}
          onClose={() => setDetailCand(null)}
        />
      )}

      {/* Per-subunit cross-chart detail popup (aggregates all A-B partners of a
          VerA or VerB subunit). */}
      {detailSubunit && data && (
        <SubunitDetailModal
          sub={detailSubunit}
          charts={visibleCharts}
          aColors={aColors}
          bColors={bColors}
          onClose={() => setDetailSubunit(null)}
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
  rows: (CandidateMetric & { cand: string })[];
  allCount: number;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  setSelectedCands: React.Dispatch<React.SetStateAction<Set<string>>>;
  clearCandidateSelection: () => void;
  isolateSelected: boolean;
  setIsolateSelected: React.Dispatch<React.SetStateAction<boolean>>;
  setHoveredCand: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredSubunit: React.Dispatch<React.SetStateAction<SubunitRef | null>>;
  toggleSubunitCands: (cands: string[]) => void;
  onOpenDetail: (cand: string) => void;
  onOpenSubunitDetail: (sub: SubunitRef) => void;
  visibleCandSet: Set<string>;
  candidateIndex: Map<string, CandidateMetric>;
  candidateQuery: string;
  setCandidateQuery: (s: string) => void;
  candSort: CandSortKey;
  setCandSort: (s: CandSortKey) => void;
  candGroup: CandGroupKey;
  setCandGroup: (g: CandGroupKey) => void;
  candidateMinReads: number;
  setCandidateMinReads: (n: number) => void;
  candidateMinCharts: number;
  setCandidateMinCharts: (n: number) => void;
  candidateFinalOnly: boolean;
  setCandidateFinalOnly: (v: boolean) => void;
  candidateDominantOnly: boolean;
  setCandidateDominantOnly: (v: boolean) => void;
  selectionFiltersCharts: boolean;
  setSelectionFiltersCharts: (v: boolean) => void;
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
    <div className="w-72 shrink-0 border-r border-slate-200 dark:border-gray-700 flex flex-col overflow-hidden bg-white dark:bg-gray-800" data-tour="barcode-sidebar">
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
              onClick={p.clearCandidateSelection}
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
          <option value="final">final fraction ↓</option>
          <option value="dominance">dominant charts ↓</option>
          <option value="name">name A→Z</option>
          <option value="varA">VerA #</option>
          <option value="varB">VerB #</option>
        </select>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Group</span>
        <select value={p.candGroup} onChange={e => p.setCandGroup(e.target.value as CandGroupKey)}
          className="text-[11px] border border-slate-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none">
          <option value="none">none</option>
          <option value="varA">by VerA</option>
          <option value="varB">by VerB</option>
        </select>
      </div>

      {/* Candidate scope filters. These filter the candidate browser, not the raw reads. */}
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-gray-700 space-y-1.5 text-[10.5px] text-slate-600 dark:text-gray-300">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex items-center gap-1" title="Only show candidates with at least this many total reads across all charts.">
            <span className="text-[9.5px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Reads</span>
            <input type="number" min={0} value={p.candidateMinReads}
              onChange={e => p.setCandidateMinReads(Math.max(0, parseInt(e.target.value || '0', 10)))}
              className="w-full px-1 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 tabular-nums" />
          </label>
          <label className="flex items-center gap-1" title="Only show candidates present in at least this many charts.">
            <span className="text-[9.5px] uppercase tracking-wider text-slate-500 dark:text-gray-400">Charts</span>
            <input type="number" min={0} value={p.candidateMinCharts}
              onChange={e => p.setCandidateMinCharts(Math.max(0, parseInt(e.target.value || '0', 10)))}
              className="w-full px-1 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 tabular-nums" />
          </label>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <label className="inline-flex items-center gap-1 cursor-pointer" title="Only show candidates still present at the final sampled transfer in at least one chart.">
            <input type="checkbox" checked={p.candidateFinalOnly} onChange={e => p.setCandidateFinalOnly(e.target.checked)} /> final-present
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer" title="Only show candidates that are final dominant in at least one chart.">
            <input type="checkbox" checked={p.candidateDominantOnly} onChange={e => p.setCandidateDominantOnly(e.target.checked)} /> dominant
          </label>
        </div>
      </div>

      {/* Selection controls: bulk select/clear + selection mode + the Isolate toggle. */}
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-gray-700 flex items-center gap-1.5 text-[10.5px] flex-wrap">
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
          onClick={p.clearCandidateSelection}
          disabled={p.selectedCands.size === 0}
          className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-40"
          title="Clear the candidate selection"
        >
          Clear
        </button>
        <label className="flex items-center gap-1 cursor-pointer select-none" title="When on, selected candidates filter the chart set to charts containing them. When off, selected candidates only emphasize/dim within the currently visible charts.">
          <input type="checkbox" checked={p.selectionFiltersCharts}
            onChange={e => p.setSelectionFiltersCharts(e.target.checked)}
            disabled={p.selectedCands.size === 0}
            className="w-3.5 h-3.5 cursor-pointer disabled:opacity-40" />
          <span className={cn(p.selectedCands.size === 0 && 'opacity-40')}>Filter charts</span>
        </label>
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
            {p.selectedCands.size} selected · {p.selectionFiltersCharts ? 'charts filtered' : 'emphasize only'} · {p.isolateSelected ? 'isolated' : 'dim context'}
          </span>
          <button onClick={p.clearCandidateSelection}
            className="ml-auto p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-200"
            title="Clear selection">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Body — scrolling list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {grouped.map((grp, gi) => {
          // When grouped by a subunit, the group header acts on the whole subunit:
          // click selects/deselects all its candidates, hover highlights them across
          // charts, and the info icon opens the cross-chart subunit detail.
          const subKind: 'A' | 'B' | null = p.candGroup === 'varA' ? 'A' : p.candGroup === 'varB' ? 'B' : null;
          const grpCands = grp.rows.map(r => r.cand);
          const grpReads = grp.rows.reduce((a, r) => a + r.total, 0);
          const selInGrp = grpCands.filter(c => p.selectedCands.has(c)).length;
          const allSel = selInGrp > 0 && selInGrp === grpCands.length;
          const someSel = selInGrp > 0 && !allSel;
          return (
          <div key={grp.label ?? `g-${gi}`}>
            {grp.label !== null && subKind && (
              <div
                className="group/hdr flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-600 dark:text-gray-300 bg-slate-100/80 dark:bg-gray-800/80 sticky top-0 z-10 border-y border-slate-200 dark:border-gray-700 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30"
                onMouseEnter={() => p.setHoveredSubunit({ kind: subKind, id: grp.label! })}
                onMouseLeave={() => p.setHoveredSubunit(null)}
                onClick={() => p.toggleSubunitCands(grpCands)}
                title={`${subKind === 'A' ? 'VerA' : 'VerB'} ${grp.label}: ${grpCands.length} combination${grpCands.length === 1 ? '' : 's'}, ${grpReads.toLocaleString()} reads. Click to ${allSel ? 'deselect' : 'select'} all; hover highlights across charts; info opens the subunit detail.`}
              >
                <span className={cn('inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border shrink-0',
                  allSel ? 'bg-blue-600 border-blue-600 text-white' : someSel ? 'bg-blue-300 border-blue-400 dark:bg-blue-700' : 'border-slate-400 dark:border-gray-500')}>
                  {allSel ? '✓' : someSel ? '–' : ''}
                </span>
                <span className="truncate">{grp.label}</span>
                <span className="text-slate-400 font-normal normal-case tabular-nums">({grp.rows.length} · {grpReads >= 1000 ? `${(grpReads / 1000).toFixed(1)}k` : grpReads})</span>
                <button
                  onClick={(e) => { e.stopPropagation(); p.onOpenSubunitDetail({ kind: subKind, id: grp.label! }); }}
                  className="ml-auto shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                  title={`Open ${subKind === 'A' ? 'VerA' : 'VerB'} ${grp.label} detail: behavior aggregated across all its partner combinations and charts`}
                >
                  <Info className="w-3 h-3" /> info
                </button>
              </div>
            )}
            {grp.label !== null && !subKind && (
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-600 dark:text-gray-300 bg-slate-100/80 dark:bg-gray-800/80 sticky top-0 z-10 border-y border-slate-200 dark:border-gray-700">
                {grp.label} <span className="text-slate-400 font-normal normal-case">({grp.rows.length})</span>
              </div>
            )}
            {grp.rows.map(({ cand, charts, total, finalPresentCharts, finalFraction, dominantCharts }) => {
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
                  title={`${cand}: appears in ${charts} chart${charts === 1 ? '' : 's'}, ${total.toLocaleString()} total reads. Final-present in ${finalPresentCharts}; dominant in ${dominantCharts}; average final fraction ${(finalFraction * 100).toFixed(1)}%. Hover highlights it across all charts; tick or click the name to select it; click the info icon for detail.`}
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
                      {charts}x · {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}
                    </span>
                    <span className="text-[9.5px] tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0" title="Average final-transfer fraction across charts containing this candidate">
                      F{(finalFraction * 100).toFixed(finalFraction >= 0.1 ? 0 : 1)}%
                    </span>
                    {dominantCharts > 0 && <span className="text-[9.5px] tabular-nums text-amber-600 dark:text-amber-400 shrink-0" title="Charts where this candidate is final dominant">D{dominantCharts}</span>}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); p.onOpenDetail(cand); }}
                    className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                    title={`Open ${cand} detail: how this A-B combination behaves across all charts and transfers`}
                  >
                    <Info className="w-3 h-3" /> info
                  </button>
                </div>
              );
            })}
          </div>
          );
        })}
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

function BarcodeSummaryModal({ data, visibleCharts, statsByKey, onClose }: { data: BarcodeDataset; visibleCharts: BarcodeChart[]; statsByKey: Map<string, ChartStats>; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const summary = useMemo(() => {
    const totalReads = visibleCharts.reduce((a, c) => a + (statsByKey.get(chartKey(c))?.totalReads ?? 0), 0);
    const candidates = new Set<string>();
    const transfers = new Set<number>();
    for (const c of visibleCharts) {
      c.transfers.forEach(t => transfers.add(t));
      for (const [cand, counts] of Object.entries(c.candidates)) if (counts.some(v => v > 0)) candidates.add(cand);
    }
    const final = finalOutcomeRows(visibleCharts, statsByKey);
    return { totalReads, candidates: candidates.size, transfers: transfers.size, final, flipped: final.filter(r => r.flipped).length };
  }, [visibleCharts, statsByKey]);
  const libraries = groupCounts(visibleCharts, c => c.library).slice(0, 10);
  const strains = groupCounts(visibleCharts, c => c.strain).slice(0, 10);
  const experiments = groupCounts(visibleCharts, c => c.experiment).slice(0, 10);
  const topFinal = [...summary.final].sort((a, b) => b.finalFraction - a.finalFraction || b.finalReads - a.finalReads).slice(0, 12);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 border border-slate-200 dark:border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="barcode-summary-title">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 flex items-center gap-2">
          <Info className="w-4 h-4 text-emerald-600" />
          <h3 id="barcode-summary-title" className="font-semibold">Barcode data summary</h3>
          <span className="text-[11px] text-slate-500 dark:text-gray-400">counts source: {data.source === 'lims' ? 'verAB_barcodes' : 'mock data'}; totals and tables are derived from loaded per-transfer reads</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400" title="Close (Esc)"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[12px]">
            <Stat label="visible charts" value={`${visibleCharts.length}/${data.charts.length}`} accent />
            <Stat label="total reads" value={summary.totalReads.toLocaleString()} />
            <Stat label="candidates" value={String(summary.candidates)} />
            <Stat label="VerA subunits" value={String(data.uniqueA.length)} />
            <Stat label="VerB subunits" value={String(data.uniqueB.length)} />
            <Stat label="flipped" value={String(summary.flipped)} />
          </div>
          <div className="grid md:grid-cols-3 gap-3 text-[12px]">
            {[['Experiments', experiments], ['Libraries', libraries], ['Strains', strains]].map(([label, rows]) => (
              <div key={label as string} className="rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-2">{label as string}</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(rows as { value: string; count: number }[]).map(r => <div key={r.value} className="flex justify-between gap-2"><span className="font-mono truncate">{r.value}</span><span className="tabular-nums text-slate-500">{r.count}</span></div>)}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-gray-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 dark:bg-gray-800 border-b border-slate-200 dark:border-gray-700 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">Top final outcomes</div>
            <table className="w-full text-[12px]">
              <thead className="text-slate-500 dark:text-gray-400"><tr><th className="px-2 py-1.5 text-left">Chart</th><th className="px-2 py-1.5 text-left">Final dominant</th><th className="px-2 py-1.5 text-right">Fraction</th><th className="px-2 py-1.5 text-right">Richness</th></tr></thead>
              <tbody>{topFinal.map(r => <tr key={chartKey(r.chart)} className="border-t border-slate-100 dark:border-gray-700"><td className="px-2 py-1.5 font-mono truncate max-w-[280px]" title={chartIdentityTitle(r.chart)}>{r.chart.sampleName || chartKey(r.chart)}</td><td className="px-2 py-1.5 font-mono">{r.dominant}</td><td className="px-2 py-1.5 text-right tabular-nums">{(r.finalFraction * 100).toFixed(1)}%</td><td className="px-2 py-1.5 text-right tabular-nums">{r.richness}</td></tr>)}</tbody>
            </table>
          </div>
          {data.warnings.length > 0 && <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-[12px] text-amber-800 dark:text-amber-200">{data.warnings.join(' ')}</div>}
        </div>
      </div>
    </div>
  );
}

function BarcodePerspectivesPanel({ charts, statsByKey, mode, setMode, onExport }: { charts: BarcodeChart[]; statsByKey: Map<string, ChartStats>; mode: BarcodePerspective; setMode: (m: BarcodePerspective) => void; onExport: (aiVerAs?: Set<string>) => void }) {
  const [aiVerAInput, setAiVerAInput] = useState('');
  const aiVerAs = useMemo(() => parseAiVerAList(aiVerAInput), [aiVerAInput]);
  const finalRows = useMemo(() => finalOutcomeRows(charts, statsByKey).sort((a, b) => b.finalFraction - a.finalFraction || b.finalReads - a.finalReads), [charts, statsByKey]);
  const presRows = useMemo(() => presenceRows(charts), [charts]);
  const aRows = useMemo(() => subunitRows(charts, 'A'), [charts]);
  const bRows = useMemo(() => subunitRows(charts, 'B'), [charts]);
  const veraLast = useMemo(() => veraLastRows(charts, aiVerAs), [charts, aiVerAs]);
  const aiVerAMatches = useMemo(() => veraLast.filter(r => r.aiGenerated).length, [veraLast]);
  const richnessRows = useMemo(() => charts.flatMap(c => c.transfers.map((t, ti) => {
    let richness = 0, depth = 0;
    for (const counts of Object.values(c.candidates)) { const v = counts[ti] || 0; if (v > 0) richness++; depth += v; }
    return { chart: c, transfer: t, richness, depth };
  })).sort((a, b) => chartKey(a.chart).localeCompare(chartKey(b.chart)) || a.transfer - b.transfer), [charts]);
  const modeButton = (id: BarcodePerspective, label: string) => (
    <button onClick={() => setMode(id)} className={cn('px-2 py-1 rounded border text-[11px] font-medium', mode === id ? 'bg-emerald-600 text-white border-emerald-700' : 'border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-600')}>{label}</button>
  );
  const rows = mode === 'final' ? finalRows : mode === 'presence' ? presRows : mode === 'veraLast' ? veraLast : mode === 'vera' ? aRows : mode === 'verb' ? bRows : richnessRows;
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold text-slate-700 dark:text-gray-200">Perspectives</span>
        {modeButton('final', 'Final outcomes')}
        {modeButton('presence', 'Presence')}
        {modeButton('richness', 'Richness')}
        {modeButton('depth', 'Read depth')}
        {modeButton('vera', 'VerA')}
        {modeButton('verb', 'VerB')}
        {modeButton('veraLast', 'VerA last transfer')}
        <button onClick={() => onExport(mode === 'veraLast' ? aiVerAs : undefined)} className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-gray-600 text-[11px] text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700"><Download className="w-3 h-3" /> CSV</button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {mode === 'veraLast' && <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/20 p-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-200 mb-1">AI-generated VerA list</label>
          <textarea value={aiVerAInput} onChange={e => setAiVerAInput(e.target.value)} placeholder="Paste A81, VerA82, or 83 separated by commas, spaces, or new lines" className="w-full min-h-[56px] rounded border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 px-2 py-1.5 text-[12px] text-slate-700 dark:text-gray-200 placeholder:text-slate-400 dark:placeholder:text-gray-500" />
          <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">Matching winner VerA rows are highlighted. {aiVerAs.size > 0 ? `${aiVerAs.size} VerA IDs loaded, ${aiVerAMatches} matched in dominant results.` : 'No AI list loaded.'}</div>
        </div>}
        <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <table className="w-full text-[12px]">
            {mode === 'veraLast' && <><thead className="bg-slate-50 dark:bg-gray-800 text-slate-500"><tr><th className="px-2 py-1.5 text-left">VerA winner</th><th className="px-2 py-1.5 text-left">AI</th><th className="px-2 py-1.5 text-right">Dominant charts</th><th className="px-2 py-1.5 text-right">Conditions</th><th className="px-2 py-1.5 text-right">Final reads</th><th className="px-2 py-1.5 text-left">VerB partners</th></tr></thead><tbody>{veraLast.map(r => <tr key={r.id} className={cn('border-t border-slate-100 dark:border-gray-700', r.aiGenerated && 'bg-amber-50 dark:bg-amber-900/20')}><td className="px-2 py-1.5 font-mono font-semibold">{r.id}</td><td className="px-2 py-1.5">{r.aiGenerated ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200"><Sparkles className="w-3 h-3" /> AI-generated</span> : ''}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.dominantCharts}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.conditions}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.finalReads.toLocaleString()}</td><td className="px-2 py-1.5 font-mono text-[11px]">{r.partners.map(([b, reads]) => `${b} ${reads.toLocaleString()}`).join(' · ')}</td></tr>)}</tbody></>}
            {mode === 'final' && <><thead className="bg-slate-50 dark:bg-gray-800 text-slate-500"><tr><th className="px-2 py-1.5 text-left">Chart</th><th className="px-2 py-1.5 text-left">Dominant final</th><th className="px-2 py-1.5 text-right">Reads</th><th className="px-2 py-1.5 text-right">%</th><th className="px-2 py-1.5 text-right">Richness</th><th className="px-2 py-1.5 text-right">Flip</th></tr></thead><tbody>{finalRows.map(r => <tr key={chartKey(r.chart)} className="border-t border-slate-100 dark:border-gray-700"><td className="px-2 py-1.5 font-mono truncate max-w-[360px]" title={chartIdentityTitle(r.chart)}>{r.chart.sampleName || chartKey(r.chart)}</td><td className="px-2 py-1.5 font-mono">{r.dominant}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.finalReads.toLocaleString()}</td><td className="px-2 py-1.5 text-right tabular-nums">{(r.finalFraction * 100).toFixed(1)}%</td><td className="px-2 py-1.5 text-right tabular-nums">{r.richness}</td><td className="px-2 py-1.5 text-right">{r.flipped ? 'yes' : ''}</td></tr>)}</tbody></>}
            {mode === 'presence' && <><thead className="bg-slate-50 dark:bg-gray-800 text-slate-500"><tr><th className="px-2 py-1.5 text-left">Candidate</th><th className="px-2 py-1.5 text-right">Charts</th><th className="px-2 py-1.5 text-right">Final charts</th><th className="px-2 py-1.5 text-right">Reads</th></tr></thead><tbody>{presRows.map(r => <tr key={r.cand} className="border-t border-slate-100 dark:border-gray-700"><td className="px-2 py-1.5 font-mono">{r.cand}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.charts}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.finalCharts}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.total.toLocaleString()}</td></tr>)}</tbody></>}
            {(mode === 'richness' || mode === 'depth') && <><thead className="bg-slate-50 dark:bg-gray-800 text-slate-500"><tr><th className="px-2 py-1.5 text-left">Chart</th><th className="px-2 py-1.5 text-right">Transfer</th><th className="px-2 py-1.5 text-right">Richness</th><th className="px-2 py-1.5 text-right">Read depth</th></tr></thead><tbody>{[...richnessRows].sort((a, b) => mode === 'depth' ? b.depth - a.depth : b.richness - a.richness).map(r => <tr key={`${chartKey(r.chart)}-${r.transfer}`} className="border-t border-slate-100 dark:border-gray-700"><td className="px-2 py-1.5 font-mono truncate max-w-[360px]" title={chartIdentityTitle(r.chart)}>{r.chart.sampleName || chartKey(r.chart)}</td><td className="px-2 py-1.5 text-right tabular-nums">T{r.transfer}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.richness}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.depth.toLocaleString()}</td></tr>)}</tbody></>}
            {(mode === 'vera' || mode === 'verb') && <><thead className="bg-slate-50 dark:bg-gray-800 text-slate-500"><tr><th className="px-2 py-1.5 text-left">{mode === 'vera' ? 'VerA' : 'VerB'}</th><th className="px-2 py-1.5 text-right">Charts</th><th className="px-2 py-1.5 text-right">Candidates</th><th className="px-2 py-1.5 text-right">Reads</th><th className="px-2 py-1.5 text-right">Final reads</th></tr></thead><tbody>{(mode === 'vera' ? aRows : bRows).map(r => <tr key={r.id} className="border-t border-slate-100 dark:border-gray-700"><td className="px-2 py-1.5 font-mono">{r.id}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.charts}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.candidates}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.total.toLocaleString()}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.finalReads.toLocaleString()}</td></tr>)}</tbody></>}
          </table>
          {rows.length === 0 && <div className="p-8 text-center text-slate-400 dark:text-gray-500 text-sm">No rows for this perspective.</div>}
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

// Side-panel candidate legend used in Focus view — always-visible column
// (the column itself scrolls if it overflows; the chart never does). Honors the
// same selection semantics as the sidebar: clicking a row toggles selection,
// hovering highlights, and the info icon opens the cross-chart detail popup.
function CandidateLegendPanel({ chart, stats, candColors, selectedCands, onToggle, onHover, onOpenDetail, topN }: {
  chart: BarcodeChart; stats: ChartStats; candColors: Record<string, string>; selectedCands: Set<string>; onToggle: (c: string) => void; onHover?: (c: string | null) => void; onOpenDetail?: (c: string) => void; topN: number;
}) {
  const sorted = stats.candidateTotals;
  const rolled = topN > 0 && sorted.length > topN;
  const hasSelection = selectedCands.size > 0;
  const maxPct = sorted[0]?.total && stats.totalReads ? (100 * sorted[0].total / stats.totalReads) : 100;
  // Per-candidate fraction-over-transfers arrays for the FOCUSED chart, computed
  // once per chart. Fraction = candidate reads / column total at each transfer, so
  // the inline sparkline shows the same trend the bars do. Memoized so re-renders
  // from hover/select do not recompute it.
  const sparkByCand = useMemo(() => {
    const colTotals = chart.transfers.map((_, i) =>
      Object.values(chart.candidates).reduce((a, arr) => a + (arr[i] || 0), 0));
    const m: Record<string, number[]> = {};
    for (const [cand, counts] of Object.entries(chart.candidates)) {
      m[cand] = chart.transfers.map((_, i) => {
        const tot = colTotals[i];
        return tot > 0 ? (counts[i] || 0) / tot : 0;
      });
    }
    return m;
  }, [chart]);
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
                {/* inline trend sparkline: this candidate's fraction over transfers
                    in the focused chart, so trends read at a glance from the bar view. */}
                <CandidateSparkline pts={sparkByCand[cand] || []} color={candColors[cand]} />
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
                className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                title={`Open ${cand} detail across all charts and transfers`}>
                <Info className="w-3 h-3" /> info
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
  splitAB: boolean;
  normalize: Normalize;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;
  onToggleCand: (c: string) => void;
  onOpenDetail: (c: string) => void;
  onOpenOther: (request: OtherRollupRequest) => void;
  onBack: () => void;
  orientation: 'rows' | 'bars' | 'lines' | 'heatmap';
  hoveredCand?: string | null;
  onHoverCandidate?: (c: string | null) => void;
  hoveredSubunit?: SubunitRef | null;
  onHoverSubunit?: (s: SubunitRef | null) => void;
  onToggleSubunitCands?: (cands: string[]) => void;
  onOpenSubunitDetail?: (s: SubunitRef) => void;
  onAddToCompare: (k: string) => void;
  isInCompare: boolean;
}
function FocusView(props: FocusViewProps) {
  const { charts, focusKey, setFocusKey, chart, stats, colorMode, splitAB, normalize, orientation,
    aColors, bColors, candColors, selectedCands, isolateSelected, topN, onToggleCand, onOpenDetail, onOpenOther,
    onBack, hoveredCand, onHoverCandidate, hoveredSubunit, onAddToCompare, isInCompare } = props;
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
              {c.well ? `${c.well} · ` : ''}{c.sampleName ? `${c.sampleName} · ` : ''}{c.library} · rep {c.replicate}
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
        {chart.well && <span className="font-mono font-semibold text-slate-800 dark:text-gray-100" title={chartIdentityTitle(chart)}>{chart.well}</span>}
        {chart.sampleName && <span className="font-mono text-slate-600 dark:text-gray-300" title={chartIdentityTitle(chart)}>{chart.sampleName}</span>}
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
            {orientation === 'rows' ? (
              <HorizontalBarChart
                chart={chart} stats={stats}
                colorMode={colorMode} splitAB={splitAB} normalize={normalize}
                aColors={aColors} bColors={bColors} candColors={candColors}
                selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
                hoverCand={hoveredCand} hoverSubunit={hoveredSubunit}
                onPickCandidate={onToggleCand} onHoverCandidate={onHoverCandidate} onOpenOther={onOpenOther}
              />
            ) : orientation === 'lines' ? (
              <TrajectoryChart
                chart={chart} stats={stats}
                colorMode={colorMode} normalize={normalize}
                aColors={aColors} bColors={bColors} candColors={candColors}
                selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
                hoverCand={hoveredCand} hoverSubunit={hoveredSubunit}
                onPickCandidate={onToggleCand} onHoverCandidate={onHoverCandidate}
              />
            ) : orientation === 'heatmap' ? (
              <HeatmapChart
                chart={chart} stats={stats}
                colorMode={colorMode}
                aColors={aColors} bColors={bColors} candColors={candColors}
                selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
                hoverCand={hoveredCand} hoverSubunit={hoveredSubunit}
                onPickCandidate={onToggleCand} onHoverCandidate={onHoverCandidate}
              />
            ) : (
              <ChartCard
                chart={chart} stats={stats}
                colorMode={colorMode} splitAB={splitAB} normalize={normalize}
                aColors={aColors} bColors={bColors} candColors={candColors}
                selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
                height={chartHeight}
                hoverCand={hoveredCand}
                hoverSubunit={hoveredSubunit}
                onPickCandidate={onToggleCand} onHoverCandidate={onHoverCandidate} onOpenOther={onOpenOther}
              />

            )}
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
  splitAB: boolean;
  normalize: Normalize;
  onNormalize?: (n: Normalize) => void;
  aColors: Record<string, string>;
  bColors: Record<string, string>;
  candColors: Record<string, string>;
  selectedCands: Set<string>;
  isolateSelected: boolean;
  topN: number;
  onToggleCand: (c: string) => void;
  onClearCandidates: () => void;
  onOpenOther: (request: OtherRollupRequest) => void;
  onBack: () => void;
  hoveredCand?: string | null;
  hoveredSubunit?: SubunitRef | null;
  onRemove: (k: string) => void;
  // Cross-chart hover sync. Threaded from the parent's setHoveredCand so the
  // shared legend (and bar hovers) light up the same candidate in every chart.
  onHoverCandidate?: (c: string | null) => void;
  // Subunit-level sync so the shared legend can group by VerA/VerB (consistent
  // with the sidebar group headers) when the color mode is partner-a/partner-b.
  onHoverSubunit?: (s: SubunitRef | null) => void;
  onToggleSubunitCands?: (cands: string[]) => void;
}
function CompareView(props: CompareViewProps) {
  const { keys, charts, statsByKey, colorMode, splitAB, normalize, onNormalize, aColors, bColors,
    candColors, selectedCands, isolateSelected, topN, onToggleCand, onClearCandidates, onOpenOther, onBack, hoveredCand, hoveredSubunit, onRemove, onHoverCandidate, onHoverSubunit, onToggleSubunitCands } = props;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack]);

  // Column-count control. 'auto' picks a sensible layout from the count; the
  // explicit 1 / 2 / 3 options let a reviewer force a wide single column (great
  // for reading tall stacks) or pack more charts in.
  const [colChoice, setColChoice] = useState<'auto' | 1 | 2 | 3 | 4>('auto');
  // Cap the union legend; the rest are summarised as "N more".
  const LEGEND_CAP = 15;

  const resolved = useMemo(() => keys
    .map(k => charts.find(c => chartKey(c) === k))
    .filter((c): c is BarcodeChart => !!c), [keys, charts]);

  // How to ORDER the compared panels. Researchers rarely want insertion order:
  // sorting by final-transfer richness, total reads, or dominant outcome makes a
  // multi-panel comparison scan like a result. 'name' keeps a stable A->Z order.
  const [chartSort, setChartSort] = useState<'added' | 'name' | 'reads' | 'richness' | 'dominant'>('added');

  // Per-panel outcome at the LAST sampled transfer: the dominant A-B combination,
  // its fraction, and how many distinct combinations remain (richness). This is
  // the one-line "what happened" summary shown under each panel and used for sort.
  const outcomeByKey = useMemo(() => {
    const m = new Map<string, { dominant: string; fraction: number; richness: number; totalReads: number }>();
    for (const c of resolved) {
      const lastIdx = c.transfers.length - 1;
      let total = 0, allReads = 0, dominant = '', best = -1, richness = 0;
      for (const [cand, counts] of Object.entries(c.candidates)) {
        const last = counts[lastIdx] || 0;
        total += last;
        allReads += counts.reduce((s, v) => s + (v || 0), 0);
        if (last > 0) richness++;
        if (last > best) { best = last; dominant = cand; }
      }
      m.set(chartKey(c), { dominant: dominant || '—', fraction: total ? best / total : 0, richness, totalReads: allReads });
    }
    return m;
  }, [resolved]);

  const sortedResolved = useMemo(() => {
    const arr = [...resolved];
    if (chartSort === 'added') return arr;
    arr.sort((a, b) => {
      const ka = chartKey(a), kb = chartKey(b);
      if (chartSort === 'name') return ka.localeCompare(kb);
      const oa = outcomeByKey.get(ka), ob = outcomeByKey.get(kb);
      if (chartSort === 'reads') return (ob?.totalReads || 0) - (oa?.totalReads || 0);
      if (chartSort === 'richness') return (ob?.richness || 0) - (oa?.richness || 0);
      // 'dominant': group by which combination won, then by its strength
      const da = oa?.dominant || '', db = ob?.dominant || '';
      return da.localeCompare(db) || (ob?.fraction || 0) - (oa?.fraction || 0);
    });
    return arr;
  }, [resolved, chartSort, outcomeByKey]);

  // COMMON Y-MAX across the compared charts so bars are truly comparable. We take
  // the per-chart maximum bar total (sum of candidate reads at the tallest
  // transfer) and keep the largest across the set. Memoized: O(charts x transfers).
  // In fraction mode the axis is always 0..1 so the override is irrelevant there.
  const commonMaxY = useMemo(() => {
    let m = 1;
    for (const c of resolved) {
      const n = c.transfers.length;
      for (let ti = 0; ti < n; ti++) {
        let tot = 0;
        for (const counts of Object.values(c.candidates)) tot += counts[ti] || 0;
        if (tot > m) m = tot;
      }
    }
    return m;
  }, [resolved]);

  // SHARED CANDIDATE LEGEND: union of the top candidates across every compared
  // chart. For each candidate we track total reads across the compared set, in
  // how many of the compared charts it appears, and the variance of its
  // final-transfer fraction across charts (so the most DIVERGENT candidates can
  // surface first). All computed in one pass; memoized.
  const legend = useMemo(() => {
    type Agg = { cand: string; total: number; charts: number; lastFractions: number[] };
    const map = new Map<string, Agg>();
    for (const c of resolved) {
      const stats = statsByKey.get(chartKey(c));
      if (!stats) continue;
      // Per-chart final-transfer total for fraction math.
      const lastIdx = c.transfers.length - 1;
      let lastBarTotal = 0;
      for (const counts of Object.values(c.candidates)) lastBarTotal += counts[lastIdx] || 0;
      // Consider this chart's own top candidates (by total reads) so the union
      // stays focused on what actually matters, not the long tail.
      const top = stats.candidateTotals.slice(0, Math.max(LEGEND_CAP, topN || 0) + 5);
      for (const { cand, total } of top) {
        let a = map.get(cand);
        if (!a) { a = { cand, total: 0, charts: 0, lastFractions: [] }; map.set(cand, a); }
        a.total += total;
        a.charts += 1;
        const lastReads = c.candidates[cand]?.[lastIdx] || 0;
        a.lastFractions.push(lastBarTotal ? lastReads / lastBarTotal : 0);
      }
    }
    const rows = [...map.values()].map(a => {
      const n = a.lastFractions.length;
      const mean = n ? a.lastFractions.reduce((s, v) => s + v, 0) / n : 0;
      const variance = n ? a.lastFractions.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n : 0;
      const p = parseCandidate(a.cand);
      return { cand: a.cand, total: a.total, charts: a.charts, variance, a: p?.a ?? '', b: p?.b ?? '' };
    });
    return rows;
  }, [resolved, statsByKey, topN]);

  // Two sort modes for the shared legend: by total reads (default) or by
  // divergence (variance of final-transfer fraction across charts) so the
  // candidates whose fate differs most between samples bubble up first.
  const [legendSort, setLegendSort] = useState<'reads' | 'divergence'>('reads');
  const [legendQuery, setLegendQuery] = useState('');
  const legendSorted = useMemo(() => {
    const rows = [...legend];
    if (legendSort === 'divergence') rows.sort((x, y) => y.variance - x.variance || y.total - x.total);
    else rows.sort((x, y) => y.total - x.total);
    return rows;
  }, [legend, legendSort]);
  const legendFiltered = useMemo(() => {
    const q = legendQuery.trim().toLowerCase();
    return q ? legendSorted.filter(r => r.cand.toLowerCase().includes(q) || r.a.toLowerCase().includes(q) || r.b.toLowerCase().includes(q)) : legendSorted;
  }, [legendSorted, legendQuery]);
  const legendShown = legendFiltered.slice(0, LEGEND_CAP);
  const legendMore = legendFiltered.length - legendShown.length;

  // Swatch color MUST match what the bars actually draw: the chart segments respect
  // colorMode (A-B uses candColors, VerA uses aColors, VerB uses bColors), so the
  // shared-candidate legend has to use the same mapping or the swatch and the bar
  // for the same candidate disagree (reported by Nidhi). Mirror ChartCard.getColor.
  const legendSwatchColor = (cand: string): string => {
    if (colorMode === 'partner-a') { const p = parseCandidate(cand); return (p && aColors[p.a]) || '#888'; }
    if (colorMode === 'partner-b') { const p = parseCandidate(cand); return (p && bColors[p.b]) || '#888'; }
    return candColors[cand] || '#888';
  };

  // SUBUNIT-GROUPED legend. In VerA / VerB color mode, listing every A-B combo is
  // inconsistent with the sidebar (which lets you act on a whole subunit) and the
  // swatches collapse to one color per subunit anyway -- so selecting one combo
  // while the bars are colored by subunit felt broken (Nidhi's "inconsistency
  // with VerA/VerB highlighting and candidate selecting in compare"). When the
  // color mode is by subunit we therefore group the shared legend by subunit:
  // one row per VerA (or VerB), clicking selects ALL its A-B partners, hovering
  // highlights the whole subunit across every chart. This makes the compare
  // legend behave exactly like the sidebar group headers.
  const subunitMode: 'A' | 'B' | null = colorMode === 'partner-a' ? 'A' : colorMode === 'partner-b' ? 'B' : null;
  const subunitLegend = useMemo(() => {
    if (!subunitMode) return [];
    type Agg = { id: string; total: number; charts: Set<string>; cands: Set<string>; lastFractions: number[] };
    const map = new Map<string, Agg>();
    for (const c of resolved) {
      const ck = chartKey(c);
      const lastIdx = c.transfers.length - 1;
      let lastBarTotal = 0;
      for (const counts of Object.values(c.candidates)) lastBarTotal += counts[lastIdx] || 0;
      const perSubLast = new Map<string, number>();
      for (const [cand, counts] of Object.entries(c.candidates)) {
        const p = parseCandidate(cand);
        if (!p) continue;
        const id = subunitMode === 'A' ? p.a : p.b;
        let a = map.get(id);
        if (!a) { a = { id, total: 0, charts: new Set(), cands: new Set(), lastFractions: [] }; map.set(id, a); }
        const tot = counts.reduce((s, v) => s + (v || 0), 0);
        a.total += tot;
        a.cands.add(cand);
        if (tot > 0) a.charts.add(ck);
        perSubLast.set(id, (perSubLast.get(id) || 0) + (counts[lastIdx] || 0));
      }
      for (const [id, lastReads] of perSubLast) {
        map.get(id)!.lastFractions.push(lastBarTotal ? lastReads / lastBarTotal : 0);
      }
    }
    const q = legendQuery.trim().toLowerCase();
    const rows = [...map.values()]
      .filter(a => !q || a.id.toLowerCase().includes(q) || [...a.cands].some(c => c.toLowerCase().includes(q)))
      .map(a => {
        const n = a.lastFractions.length;
        const mean = n ? a.lastFractions.reduce((s, v) => s + v, 0) / n : 0;
        const variance = n ? a.lastFractions.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n : 0;
        return { id: a.id, total: a.total, charts: a.charts.size, cands: [...a.cands], variance };
      });
    if (legendSort === 'divergence') rows.sort((x, y) => y.variance - x.variance || y.total - x.total);
    else rows.sort((x, y) => y.total - x.total);
    return rows.slice(0, LEGEND_CAP);
  }, [subunitMode, resolved, legendSort, legendQuery]);

  const subunitColor = (id: string): string => (subunitMode === 'A' ? aColors[id] : bColors[id]) || '#888';
  const subunitSelState = (cands: string[]): 'all' | 'some' | 'none' => {
    let sel = 0;
    for (const c of cands) if (selectedCands.has(c)) sel++;
    return sel === 0 ? 'none' : sel === cands.length ? 'all' : 'some';
  };

  const cols = colChoice === 'auto'
    ? (resolved.length <= 1 ? 1 : resolved.length === 2 ? 2 : resolved.length <= 6 ? 3 : 4)
    : colChoice;
  // Tile height scales with how many columns we show: fewer columns => taller
  // charts. Keeps tall stacks readable when packing 3-up.
  const tileHeight = cols <= 1 ? 360 : cols === 2 ? 300 : 240;
  const useCommonY = normalize !== 'fraction';

  const colBtnCls = (active: boolean) => cn(
    'px-1.5 py-0.5 rounded text-[11px] font-medium border',
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : 'border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700',
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* STICKY SHARED COMPARE TOOLBAR */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[11.5px] shrink-0">
        <button onClick={onBack} title="Back to Grid (Esc)"
          className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-200 font-medium">
          <ChevronLeft className="w-3.5 h-3.5" /> Grid
        </button>
        <span className="font-semibold text-slate-700 dark:text-gray-200">Compare</span>
        <span className="text-slate-500 dark:text-gray-400 tabular-nums">{resolved.length} chart{resolved.length === 1 ? '' : 's'}</span>

        {/* Column-count control */}
        <div className="flex items-center gap-1">
          <Columns3 className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-500 dark:text-gray-400">Cols</span>
          <div className="flex items-center gap-1">
            <button className={colBtnCls(colChoice === 'auto')} onClick={() => setColChoice('auto')} title="Auto layout">Auto</button>
            <button className={colBtnCls(colChoice === 1)} onClick={() => setColChoice(1)} title="One column (tall)">1</button>
            <button className={colBtnCls(colChoice === 2)} onClick={() => setColChoice(2)} title="Two columns">2</button>
            <button className={colBtnCls(colChoice === 3)} onClick={() => setColChoice(3)} title="Three columns">3</button>
            <button className={colBtnCls(colChoice === 4)} onClick={() => setColChoice(4)} title="Four columns (many charts)">4</button>
          </div>
        </div>

        {/* Common-Y indicator so the reviewer trusts the bars are comparable */}
        <span
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10.5px] font-medium',
            useCommonY
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              : 'bg-slate-50 dark:bg-gray-700/40 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-gray-600',
          )}
          title={useCommonY
            ? `Every chart is locked to a common Y maximum (${commonMaxY.toLocaleString()} reads) so bar heights are directly comparable.`
            : 'Fraction mode: all charts already share a 0 to 100% axis.'}
        >
          <BarChart3 className="w-3 h-3" />
          {useCommonY ? `Y locked to ${commonMaxY.toLocaleString()}` : 'Y = 0 to 100%'}
        </span>

        {/* Reads vs Fraction: composition (fraction) is what most cross-condition
            comparisons want; reads keeps absolute depth. Toggling here avoids
            leaving Compare to change it on the main toolbar. */}
        {onNormalize && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-gray-400">Y</span>
            <button className={colBtnCls(normalize === 'count')} onClick={() => onNormalize('count')} title="Absolute read counts (depth)">Reads</button>
            <button className={colBtnCls(normalize === 'fraction')} onClick={() => onNormalize('fraction')} title="Composition: each bar normalized to 0-100% so you compare proportions, not depth">Fraction</button>
          </div>
        )}

        {/* Order the panels so a multi-chart comparison reads like a result. */}
        <div className="flex items-center gap-1">
          <span className="text-slate-500 dark:text-gray-400">Sort</span>
          <select
            value={chartSort}
            onChange={e => setChartSort(e.target.value as typeof chartSort)}
            className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-slate-700 dark:text-gray-200 text-[10.5px]"
            title="Order the compared panels"
          >
            <option value="added">As added</option>
            <option value="name">Name (A-Z)</option>
            <option value="dominant">Dominant combination</option>
            <option value="richness">Final richness</option>
            <option value="reads">Total reads</option>
          </select>
        </div>

        <span className="text-slate-500 dark:text-gray-400 tabular-nums">
          {selectedCands.size} candidate{selectedCands.size === 1 ? '' : 's'} selected
        </span>

        <button onClick={() => { for (const c of resolved) onRemove(chartKey(c)); }}
          disabled={resolved.length === 0}
          title="Remove every chart from compare"
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-300 disabled:opacity-40 disabled:cursor-not-allowed">
          <X className="w-3.5 h-3.5" /> Clear all
        </button>
      </div>

      {/* SHARED CANDIDATE / SUBUNIT LEGEND / TRACKER */}
      {resolved.length > 0 && ((subunitMode ? subunitLegend.length : legendShown.length) > 0 || legendQuery.trim()) && (
        <div className="shrink-0 border-b border-slate-200 dark:border-gray-700 bg-slate-50/70 dark:bg-gray-800/50 px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">
              {subunitMode ? `Shared Ver${subunitMode} subunits` : 'Shared candidates'}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-gray-500">
              {subunitMode ? `click a Ver${subunitMode} to track all its combinations in every chart · hover to highlight` : 'click to track in every chart · hover to highlight'}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={legendQuery}
                  onChange={e => setLegendQuery(e.target.value)}
                  placeholder="candidate / subunit"
                  className="w-36 pl-6 pr-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[10.5px] text-slate-700 dark:text-gray-100 outline-none"
                />
              </div>
              <span className="text-[10px] text-slate-400 dark:text-gray-500">Sort</span>
              <button className={colBtnCls(legendSort === 'reads')} onClick={() => setLegendSort('reads')} title="Sort by total reads across compared charts">Reads</button>
              <button className={colBtnCls(legendSort === 'divergence')} onClick={() => setLegendSort('divergence')} title="Sort by how differently this ends up across the compared charts (variance of final-transfer fraction)">Divergent</button>
              <button
                className={colBtnCls(false)}
                onClick={() => {
                  const cands = subunitMode ? subunitLegend.flatMap(r => r.cands) : legendShown.map(r => r.cand);
                  props.onToggleSubunitCands?.(cands);
                }}
                disabled={(subunitMode ? subunitLegend.length : legendShown.length) === 0}
                title="Select or deselect every candidate currently shown in this shared legend"
              >Shown</button>
              <button className={colBtnCls(props.selectedCands.size > 0)} onClick={onClearCandidates} disabled={props.selectedCands.size === 0} title="Clear all selected candidates">Clear</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {subunitMode ? (
              subunitLegend.length === 0 ? (
                <span className="text-[10.5px] text-slate-400 dark:text-gray-500 px-2 py-1">No shared subunits match “{legendQuery}”.</span>
              ) : subunitLegend.map(row => {
                const sel = subunitSelState(row.cands);
                const label = `Ver${subunitMode}${row.id}`;
                return (
                  <button
                    key={row.id}
                    onClick={() => onToggleSubunitCands?.(row.cands)}
                    onMouseEnter={() => onHoverSubunit?.({ kind: subunitMode, id: row.id })}
                    onMouseLeave={() => onHoverSubunit?.(null)}
                    title={`${label} — ${row.cands.length} A-B combination${row.cands.length === 1 ? '' : 's'}\n${row.total.toLocaleString()} reads across ${row.charts}/${resolved.length} compared charts\nclick to ${sel === 'all' ? 'deselect' : 'select'} all its combinations`}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] tabular-nums transition-colors',
                      sel !== 'none'
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-200'
                        : 'bg-white/70 dark:bg-gray-800/60 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:border-slate-300 dark:hover:border-gray-500',
                    )}
                  >
                    <span className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-black/10" style={{ background: subunitColor(row.id) }} />
                    <span className="font-mono font-medium">{label}</span>
                    <span className="text-[9.5px] text-slate-400 dark:text-gray-500" title={`${row.cands.length} A-B combinations sharing this Ver${subunitMode}`}>×{row.cands.length}</span>
                    <span className="text-slate-400 dark:text-gray-500">{row.total.toLocaleString()}</span>
                    {sel === 'some' && <span className="text-[9px] text-blue-500" title="Some of this subunit's combinations are selected">partial</span>}
                    {legendSort === 'divergence' && (
                      <span className="text-[9.5px] text-amber-600 dark:text-amber-400" title="Spread of final-transfer fraction across the compared charts (higher = more divergent)">σ²{(row.variance * 100).toFixed(1)}</span>
                    )}
                  </button>
                );
              })
            ) : (
              <>
                {legendShown.map(row => {
                  const isSel = selectedCands.has(row.cand);
                  const isHov = hoveredCand === row.cand;
                  return (
                    <button
                      key={row.cand}
                      onClick={() => onToggleCand(row.cand)}
                      onMouseEnter={() => onHoverCandidate?.(row.cand)}
                      onMouseLeave={() => onHoverCandidate?.(null)}
                      title={`${row.cand}  (VerA ${row.a} · VerB ${row.b})\n${row.total.toLocaleString()} reads across ${row.charts}/${resolved.length} compared charts\nclick to ${isSel ? 'deselect' : 'select'} in all charts`}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] tabular-nums transition-colors',
                        isSel
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-200'
                          : isHov
                            ? 'bg-white dark:bg-gray-700 border-slate-300 dark:border-gray-500 text-slate-700 dark:text-gray-200'
                            : 'bg-white/70 dark:bg-gray-800/60 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:border-slate-300 dark:hover:border-gray-500',
                      )}
                    >
                      <span className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-black/10" style={{ background: legendSwatchColor(row.cand) }} />
                      <span className="font-mono font-medium">{row.cand}</span>
                      <span className="text-slate-400 dark:text-gray-500">{row.total.toLocaleString()}</span>
                      <span className="text-[9.5px] text-slate-400 dark:text-gray-500" title={`Appears in ${row.charts} of ${resolved.length} compared charts`}>{row.charts}/{resolved.length}</span>
                      {legendSort === 'divergence' && (
                        <span className="text-[9.5px] text-amber-600 dark:text-amber-400" title="Spread of final-transfer fraction across the compared charts (higher = more divergent fate)">
                          σ²{(row.variance * 100).toFixed(1)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {legendShown.length === 0 && (
                  <span className="text-[10.5px] text-slate-400 dark:text-gray-500 px-2 py-1">No shared candidates match “{legendQuery}”.</span>
                )}
                {legendMore > 0 && (
                  <span className="flex items-center px-2 py-1 text-[10.5px] text-slate-400 dark:text-gray-500">+{legendMore} more</span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* CHART GRID */}
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {resolved.length === 0 ? (
          <Centered>
            <span>No charts queued for comparison.</span>
            <button onClick={onBack} className="text-xs text-emerald-600 dark:text-emerald-400 underline">Back to Grid to pick some</button>
          </Centered>
        ) : (
          <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {sortedResolved.map(c => {
              const stats = statsByKey.get(chartKey(c))!;
              const outcome = outcomeByKey.get(chartKey(c));
              return (
                <div key={chartKey(c)} className="relative flex flex-col rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden group">
                  {/* PER-CHART HEADER: identity, totals, flip badge, remove */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 text-[11.5px] shrink-0">
                    {c.well && (
                      <>
                        <span className="font-mono font-semibold text-slate-800 dark:text-gray-100" title={chartIdentityTitle(c)}>{c.well}</span>
                        <span className="text-slate-400">|</span>
                      </>
                    )}
                    {c.sampleName && (
                      <>
                        <span className="font-mono text-slate-600 dark:text-gray-300 truncate" title={chartIdentityTitle(c)}>{c.sampleName}</span>
                        <span className="text-slate-400">|</span>
                      </>
                    )}
                    <span className="font-mono text-slate-700 dark:text-gray-200">{c.strain}</span>
                    <span className="text-slate-400">|</span>
                    <span className="font-mono text-slate-700 dark:text-gray-200 truncate" title={c.library}>{c.library}</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600 dark:text-gray-300 whitespace-nowrap">Rep {c.replicate}</span>
                    {stats.flipped && (
                      <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold uppercase tracking-wider text-[10px]"
                        title={`Flip: dominant A-B candidate changed between the first and last transfer (${stats.dominantAtFirst} to ${stats.dominantAtLast})`}>
                        flip
                      </span>
                    )}
                    <button onClick={() => onRemove(chartKey(c))} title="Remove from compare"
                      className="ml-auto w-5 h-5 rounded border border-slate-200 dark:border-gray-600 flex items-center justify-center text-slate-400 hover:text-red-500 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {/* sub-line: totals + unique candidates */}
                  <div className="px-3 py-0.5 border-b border-slate-100 dark:border-gray-700/60 text-[10.5px] tabular-nums text-slate-500 dark:text-gray-400 flex items-center gap-2 shrink-0">
                    <span title="Total reads across all transfers">{stats.totalReads.toLocaleString()} reads</span>
                    <span className="text-slate-300 dark:text-gray-600">·</span>
                    <span title="Distinct A-B candidates in this chart">{stats.uniqueCandidates} candidate{stats.uniqueCandidates === 1 ? '' : 's'}</span>
                    <span className="text-slate-300 dark:text-gray-600">·</span>
                    <span title="Number of sequenced transfers">{c.transfers.length} transfer{c.transfers.length === 1 ? '' : 's'}</span>
                  </div>
                  {/* OUTCOME: the dominant A-B combination at the final transfer and
                      its share, so a reviewer can read each panel's result at a glance. */}
                  {outcome && outcome.dominant !== '—' && (
                    <div className="px-3 py-1 border-b border-slate-100 dark:border-gray-700/60 text-[10.5px] flex items-center gap-1.5 shrink-0 bg-emerald-50/40 dark:bg-emerald-900/10">
                      <span className="text-slate-500 dark:text-gray-400">Final:</span>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: candColors[outcome.dominant] || '#888' }} />
                      <span className="font-mono font-semibold text-slate-800 dark:text-gray-100">{outcome.dominant}</span>
                      <span className="tabular-nums text-emerald-700 dark:text-emerald-300 font-semibold">{(outcome.fraction * 100).toFixed(0)}%</span>
                      <span className="text-slate-400 dark:text-gray-500 tabular-nums" title="Distinct A-B combinations still present at the final transfer">· {outcome.richness} present</span>
                    </div>
                  )}
                  {/* CHART: pass the COMMON y-max so bars are comparable */}
                  <div className="flex-1 min-h-0" style={{ minHeight: tileHeight }}>
                    <ChartCard
                      chart={c} stats={stats}
                      colorMode={colorMode} splitAB={splitAB} normalize={normalize}
                      aColors={aColors} bColors={bColors} candColors={candColors}
                      selectedCands={selectedCands} isolateSelected={isolateSelected} topN={topN}
                      height={tileHeight}
                      hoverCand={hoveredCand}
                      hoverSubunit={hoveredSubunit}
                      onPickCandidate={onToggleCand}
                      onHoverCandidate={onHoverCandidate}
                      onOpenOther={onOpenOther}
                      yMaxOverride={useCommonY ? commonMaxY : undefined}
                    />
                  </div>
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
