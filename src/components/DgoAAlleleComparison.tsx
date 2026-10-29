'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { fetchData } from '@/lib/dataSource';
import {
  OTHER_GROUP_ID,
  dgoaAlignment,
  dgoaComposition,
  type DgoAAlignmentView,
  type DgoAGroupMode,
  type DgoAMeasurement,
  type DgoAVariant,
} from '@/lib/dgoaAlleles';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DgoADataset {
  variants?: DgoAVariant[];
  measurements?: DgoAMeasurement[];
  warnings?: string[];
  source?: { available?: boolean; identity?: string };
  error?: string;
}

type Metric = 'relative' | 'total';

interface DgoAAlleleComparisonProps {
  selected: Set<string>;
}

const COL_W = 42;
const BAR_W = 26;
const PAD_L = 54;
const PAD_R = 18;
const PAD_T = 14;
const PAD_B = 96;
const PLOT_H = 258;
const OTHER_COLOR = '#94a3b8';

const countFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function colorForLabel(label: string): string {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 46% 52%)`;
}

function groupColor(id: string): string {
  return id === OTHER_GROUP_ID ? OTHER_COLOR : colorForLabel(id);
}

function percent(relative: number): string {
  return `${(relative * 100).toFixed(1)}%`;
}

function clipLabel(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max - 1)}\u2026` : label;
}

export default function DgoAAlleleComparison({ selected }: DgoAAlleleComparisonProps) {
  const [data, setData] = useState<DgoADataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DgoAGroupMode>('aa');
  const [topN, setTopN] = useState(50);
  const [metric, setMetric] = useState<Metric>('relative');
  const [isolated, setIsolated] = useState<Set<string>>(new Set());
  const [view, setView] = useState<DgoAAlignmentView>('aa');
  const [frame, setFrame] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const figureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetchData('/api/dgoa-alleles')
      .then(async response => {
        const json = (await response.json()) as DgoADataset;
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`);
        if (alive) setData(json);
      })
      .catch(cause => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setView(mode);
  }, [mode]);

  useEffect(() => {
    setFrame(0);
  }, [view, isolated]);

  const variants = data?.variants ?? [];
  const measurements = data?.measurements ?? [];
  const coverageWarning = data?.source?.available === false;
  const warnings = data?.warnings ?? [];

  const filtered = useMemo(
    () => measurements.filter(measurement => selected.has(measurement.sampleId)),
    [measurements, selected],
  );

  const measuredSampleIds = useMemo(
    () => new Set(measurements.map(measurement => measurement.sampleId)),
    [measurements],
  );

  const missingSamples = useMemo(() => {
    let count = 0;
    for (const sampleId of selected) if (!measuredSampleIds.has(sampleId)) count += 1;
    return count;
  }, [selected, measuredSampleIds]);

  const composition = useMemo(
    () => dgoaComposition(variants, filtered, mode, topN),
    [variants, filtered, mode, topN],
  );

  const selectedAlignmentSamples = useMemo(
    () => new Set(filtered.map(measurement => measurement.sampleId)),
    [filtered],
  );

  const alignment = useMemo(
    () => dgoaAlignment(variants, measurements, mode, isolated, selectedAlignmentSamples, view),
    [variants, measurements, mode, isolated, selectedAlignmentSamples, view],
  );

  const toggleIsolated = (id: string) => {
    setIsolated(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSegmentEnter = (event: React.MouseEvent<SVGRectElement>, text: string) => {
    const box = figureRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, text });
  };

  const windowWidth = view === 'aa' ? 20 : 60;
  const visibleWindow = Math.min(windowWidth, alignment.length);
  const maxFrame = Math.max(0, alignment.length - visibleWindow);
  const safeFrame = Math.min(frame, maxFrame);
  const visibleRows = alignment.rows.map(row => ({
    ...row,
    visible: row.sequence.slice(safeFrame, safeFrame + visibleWindow),
  }));
  const mismatched = new Set<number>();
  for (let offset = 0; offset < visibleWindow; offset += 1) {
    const column = safeFrame + offset;
    const first = visibleRows[0]?.sequence[column];
    if (visibleRows.some(row => row.sequence[column] !== first)) mismatched.add(column);
  }
  const rulerMarks: number[] = [];
  for (let column = safeFrame; column < safeFrame + visibleWindow; column += 1) {
    if ((column + 1) % 10 === 0 || column === safeFrame) rulerMarks.push(column);
  }

  const yMax = Math.max(1, ...composition.samples.map(sample => sample.total));
  const plotTop = PAD_T;
  const baseY = plotTop + PLOT_H;
  const chartWidth = Math.max(520, PAD_L + composition.samples.length * COL_W + PAD_R);
  const chartHeight = PAD_T + PLOT_H + PAD_B;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  function renderBody() {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-sm text-[var(--text-soft)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading dgoA allele composition
        </div>
      );
    }
    if (error) {
      return (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>I could not load the dgoA allele composition: {error}</span>
        </div>
      );
    }
    if (coverageWarning) {
      return (
        <div role="alert" className="rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-900">
          This snapshot does not include the dgoA allele measurement tables, so I have nothing to chart.
        </div>
      );
    }
    if (measurements.length === 0) {
      return <p className="text-sm text-[var(--text-soft)]">No dgoA allele measurements are available for this snapshot.</p>;
    }
    if (selected.size === 0) {
      return (
        <p className="text-sm text-[var(--text-soft)]">
          Select samples in the Sample Selection panel to compare dgoA composition.
        </p>
      );
    }
    if (composition.samples.length === 0) {
      return (
        <p className="text-sm text-[var(--text-soft)]">
          I found no dgoA allele measurements for the selected samples.
        </p>
      );
    }

    return (
      <>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-soft)]">
          <span>{composition.samples.length} sample columns</span>
          <span aria-hidden="true">|</span>
          <span>{composition.groups.filter(group => !group.isOther).length} named variants</span>
          <span aria-hidden="true">|</span>
          <span>relative abundance is computed per sample</span>
          {missingSamples > 0 && <span className="text-amber-700">{missingSamples} selected sample(s) have no dgoA measurements</span>}
        </div>

        <div ref={figureRef} className="relative overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
          <svg role="img" aria-label={`dgoA allele composition stacked bars for ${composition.samples.length} samples`} width={chartWidth} height={chartHeight} className="block">
            {ticks.map(tick => {
              const y = baseY - tick * PLOT_H;
              return (
                <g key={tick}>
                  <line x1={PAD_L - 6} x2={chartWidth - PAD_R} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} strokeDasharray={tick === 0 ? undefined : '3 4'} />
                  <text x={PAD_L - 10} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-soft)">
                    {metric === 'relative' ? `${Math.round(tick * 100)}%` : countFormat.format(tick * yMax)}
                  </text>
                </g>
              );
            })}
            {composition.samples.map((sample, sampleIndex) => {
              const x = PAD_L + sampleIndex * COL_W + (COL_W - BAR_W) / 2;
              let cursor = baseY;
              return (
                <g key={sample.id}>
                  <title>{`${sample.sampleId} / seqorder ${sample.seqorder} / ${countFormat.format(sample.total)} reads`}</title>
                  {sample.segments.map(segment => {
                    const group = composition.groups.find(candidate => candidate.id === segment.groupId);
                    const fraction = metric === 'relative' ? segment.relative : segment.count / yMax;
                    const height = Math.max(0.6, fraction * PLOT_H);
                    const y = cursor - height;
                    cursor = y;
                    const id = segment.groupId;
                    const dim = isolated.size > 0 ? !isolated.has(id) : hovered !== null && hovered !== id;
                    const label = group?.label ?? id;
                    const description = `${label}: ${countFormat.format(segment.count)} reads, ${percent(segment.relative)} of ${sample.sampleId} / seqorder ${sample.seqorder}`;
                    return (
                      <rect
                        key={id}
                        x={x}
                        y={y}
                        width={BAR_W}
                        height={height}
                        fill={groupColor(id)}
                        opacity={dim ? 0.16 : 1}
                        stroke="var(--surface)"
                        strokeWidth={0.6}
                        role="button"
                        tabIndex={0}
                        aria-label={description}
                        aria-pressed={isolated.has(id)}
                        style={{ cursor: 'pointer' }}
                        onClick={() => { if (id !== OTHER_GROUP_ID) toggleIsolated(id); }}
                        onKeyDown={event => {
                          if (id === OTHER_GROUP_ID) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleIsolated(id);
                          }
                        }}
                        onMouseEnter={event => { setHovered(id); handleSegmentEnter(event, `${label}\n${countFormat.format(segment.count)} reads, ${percent(segment.relative)}`); }}
                        onMouseLeave={() => { setHovered(null); setTip(null); }}
                      />
                    );
                  })}
                  <text
                    x={x + BAR_W / 2}
                    y={baseY + 14}
                    transform={`rotate(-42 ${x + BAR_W / 2} ${baseY + 14})`}
                    textAnchor="end"
                    fontSize={10}
                    fill="var(--text-soft)"
                  >
                    {clipLabel(sample.sampleId, 20)}
                  </text>
                  <text
                    x={x + BAR_W / 2}
                    y={baseY + 30}
                    transform={`rotate(-42 ${x + BAR_W / 2} ${baseY + 30})`}
                    textAnchor="end"
                    fontSize={9}
                    fill="var(--text-soft)"
                    opacity={0.75}
                  >
                    {sample.seqorder ? `seq ${sample.seqorder}` : ''}
                  </text>
                </g>
              );
            })}
          </svg>
          {tip && (
            <div
              className="pointer-events-none absolute z-20 max-w-[240px] whitespace-pre-line rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] shadow-md"
              style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -110%)' }}
              role="status"
            >
              {tip.text}
            </div>
          )}
        </div>

        <div className="max-h-36 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            {composition.groups.map(group => {
              const pressed = isolated.has(group.id);
              const body = (
                <>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: groupColor(group.id) }} aria-hidden="true" />
                  <span className="max-w-[220px] truncate" title={group.label}>{group.label}</span>
                  <span className="font-mono text-[10px] opacity-70">{countFormat.format(group.total)}</span>
                </>
              );
              if (group.isOther) {
                return (
                  <span key={group.id} className="lims-chip inline-flex items-center gap-1.5 opacity-80" title="Counts folded beyond the per-sample Top-N selection">
                    {body}
                  </span>
                );
              }
              return (
                <button
                  key={group.id}
                  type="button"
                  className={cn('lims-toggle inline-flex items-center gap-1.5', pressed && 'ring-1 ring-[var(--accent-500)]', isolated.size > 0 && !pressed && 'opacity-45')}
                  data-on={pressed}
                  aria-pressed={pressed}
                  aria-label={`${pressed ? 'Stop isolating' : 'Isolate'} ${group.label}`}
                  onClick={() => toggleIsolated(group.id)}
                >
                  {body}
                </button>
              );
            })}
            {isolated.size > 0 && (
              <button type="button" className="lims-btn lims-btn-ghost text-[11px]" onClick={() => setIsolated(new Set())}>
                Show all
              </button>
            )}
          </div>
        </div>

        {isolated.size > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                  Selected alleles ({alignment.rows.length})
                </h3>
                <span className="text-[11px] text-[var(--text-soft)]">equal-length, no MSA performed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)]">
                  {(['dna', 'aa'] as DgoAAlignmentView[]).map(candidate => (
                    <button
                      key={candidate}
                      type="button"
                      className={cn('lims-toggle px-2 py-1 text-[11px]', view === candidate && 'ring-1 ring-inset ring-[var(--accent-500)]')}
                      data-on={view === candidate}
                      aria-pressed={view === candidate}
                      aria-label={`${candidate === 'dna' ? 'DNA' : 'AA'} alignment view`}
                      onClick={() => setView(candidate)}
                    >
                      {candidate === 'dna' ? 'DNA' : 'AA'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="lims-btn lims-btn-ghost inline-flex items-center gap-1 text-[11px]"
                  aria-expanded={panelOpen}
                  onClick={() => setPanelOpen(open => !open)}
                >
                  {panelOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                  {panelOpen ? 'Collapse alignment' : 'Expand alignment'}
                </button>
              </div>
            </div>

            {alignment.substituted && (
              <p className="mb-2 text-[11px] text-[var(--text-soft)]">
                These alleles were grouped by {mode === 'aa' ? 'amino acid change' : 'DNA sequence'}, so the {view === 'aa' ? 'AA' : 'DNA'} sequence shown is the most abundant {view === 'aa' ? 'amino acid' : 'DNA'} member of each group.
              </p>
            )}
            {alignment.warnings.map(warning => (
              <p key={warning} className="mb-1 flex items-start gap-1.5 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {warning}
              </p>
            ))}

            {panelOpen && alignment.rows.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-max font-mono text-[12px] leading-5">
                    <div className="relative h-4 text-[10px] text-[var(--text-soft)]">
                      {rulerMarks.map(column => (
                        <span key={column} className="absolute top-0" style={{ left: `${column - safeFrame}ch` }}>
                          {column + 1}
                        </span>
                      ))}
                    </div>
                    {visibleRows.map(row => (
                      <div key={row.id} className="flex items-start gap-2">
                        <span className="w-40 shrink-0 truncate font-sans text-[11px] leading-5 text-[var(--text-soft)]" title={row.label}>{row.label}</span>
                        <span className="whitespace-pre" aria-label={`${row.label} sequence`}>
                          {[...row.visible].map((character, index) => {
                            const column = safeFrame + index;
                            return (
                              <span
                                key={column}
                                className={mismatched.has(column) ? 'rounded-sm bg-amber-300/70 text-slate-950' : undefined}
                              >
                                {character}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="lims-btn lims-btn-ghost inline-flex items-center gap-0.5"
                    aria-label="Previous alignment window"
                    disabled={safeFrame <= 0}
                    onClick={() => setFrame(Math.max(0, safeFrame - 10))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Prev
                  </button>
                  <input
                    type="range"
                    aria-label="Alignment position"
                    min={0}
                    max={maxFrame}
                    value={safeFrame}
                    onChange={event => setFrame(Number(event.target.value))}
                    className="h-1 w-56 accent-[var(--accent-500)]"
                  />
                  <button
                    type="button"
                    className="lims-btn lims-btn-ghost inline-flex items-center gap-0.5"
                    aria-label="Next alignment window"
                    disabled={safeFrame >= maxFrame}
                    onClick={() => setFrame(Math.min(maxFrame, safeFrame + 10))}
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <span className="font-mono">
                    {alignment.length === 0 ? '0 of 0' : `${safeFrame + 1}-${Math.min(alignment.length, safeFrame + visibleWindow)} of ${alignment.length} ${view === 'aa' ? 'aa' : 'nt'}`}
                  </span>
                  <span className="text-[var(--text-soft)]">window {visibleWindow} positions</span>
                </div>
              </>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)] p-3">
      <section className="lims-surface flex min-h-full flex-col gap-3 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">dgoA Allele Comparison</h2>
            <p className="text-[11px] text-[var(--text-soft)]">
              Allele composition per (Seqsample, Seqorder), stacked like the verAB library view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-figure-omit>
            <span className="lims-label">Group by</span>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)]" role="group" aria-label="dgoA grouping">
              {(['aa', 'dna'] as DgoAGroupMode[]).map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  className={cn('lims-toggle px-2.5 py-1 text-xs', mode === candidate && 'ring-1 ring-inset ring-[var(--accent-500)]')}
                  data-on={mode === candidate}
                  aria-pressed={mode === candidate}
                  aria-label={`Group by ${candidate === 'aa' ? 'AA sequence' : 'DNA sequence'}`}
                  onClick={() => setMode(candidate)}
                >
                  {candidate === 'aa' ? 'AA sequence' : 'DNA sequence'}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5">
              <span className="lims-label">Variants per sample</span>
              <select
                className="lims-select text-xs"
                aria-label="Variants per sample"
                value={topN}
                onChange={event => setTopN(Number(event.target.value))}
              >
                <option value={0}>All</option>
                <option value={50}>Top50</option>
                <option value={20}>Top20</option>
                <option value={10}>Top10</option>
              </select>
            </label>

            <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)]" role="group" aria-label="dgoA abundance metric">
              {(['relative', 'total'] as Metric[]).map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  className={cn('lims-toggle px-2.5 py-1 text-xs', metric === candidate && 'ring-1 ring-inset ring-[var(--accent-500)]')}
                  data-on={metric === candidate}
                  aria-pressed={metric === candidate}
                  onClick={() => setMetric(candidate)}
                >
                  {candidate === 'relative' ? 'Relative' : 'Total count'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {warnings.map(warning => (
          <div key={warning} role="alert" className="rounded-lg border border-amber-300/60 bg-amber-50/70 p-2 text-[11px] text-amber-900">
            {warning}
          </div>
        ))}

        {renderBody()}
      </section>
    </div>
  );
}
