'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Grid3X3, Info, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { fetchData } from '../lib/dataSource';

interface MutationSample {
  id: string;
  name: string;
  experiment: string;
  replicate?: string;
  transfer?: number;
  donor_dna?: string;
  condition?: string;
  strain?: string;
}

interface LibraryVariant {
  variantId: string;
  gene?: string;
  library?: string;
  position?: string | number;
  label: string;
  aiGenerated: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

interface LibraryVariantMeasurement {
  sampleId: string;
  seqsample: string;
  variantId: string;
  abundance: number;
  count?: number;
  transfer?: number;
}

interface LibraryVariantDataset {
  variants: LibraryVariant[];
  measurements: LibraryVariantMeasurement[];
  warnings?: string[];
  error?: string;
}

type ChartMode = 'bars' | 'heatmap' | 'lines';
type SortKey = 'experiment' | 'dna' | 'replicate' | 'transfer';

const SORT_LEVELS: { key: SortKey; label: string }[] = [
  { key: 'experiment', label: 'Experiment' },
  { key: 'dna', label: 'DNA' },
  { key: 'replicate', label: 'Replicate' },
  { key: 'transfer', label: 'Transfer' },
];
const DEFAULT_SORT: SortKey[] = ['experiment', 'dna', 'replicate', 'transfer'];
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#4f46e5', '#65a30d'];

function sampleValue(sample: MutationSample, key: SortKey): string | number {
  if (key === 'experiment') return sample.experiment || '';
  if (key === 'dna') return sample.donor_dna || '';
  if (key === 'replicate') return sample.replicate || '';
  return typeof sample.transfer === 'number' ? sample.transfer : Number.POSITIVE_INFINITY;
}

function compareSamples(order: SortKey[]) {
  return (a: MutationSample, b: MutationSample): number => {
    for (const key of order) {
      const av = sampleValue(a, key);
      const bv = sampleValue(b, key);
      if (typeof av === 'number' && typeof bv === 'number') {
        if (av !== bv) return av - bv;
      } else if (String(av) !== String(bv)) {
        return String(av).localeCompare(String(bv), undefined, { numeric: true });
      }
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  };
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 0.001) return '<0.1%';
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function colorFor(index: number): string {
  return COLORS[index % COLORS.length];
}

function heatStyle(value: number): React.CSSProperties {
  const t = Math.max(0, Math.min(1, value));
  const light = 97 - t * 55;
  const text = light < 62 ? '#fff' : '#1e3a5f';
  return { backgroundColor: `hsl(214 72% ${light}%)`, color: text };
}

function shortSample(sample: MutationSample): string {
  return sample.name || sample.id;
}

function metadataEntries(variant: LibraryVariant): [string, string][] {
  const priority = ['Library', 'verA', 'verB', 'verA_name', 'verB_name', 'verA_type', 'verB_type', 'AI-generated'];
  return priority
    .map(key => [key, variant.metadata[key]] as const)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key.replaceAll('_', ' '), typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)]);
}

function ModeButton({ active, onClick, children, icon }: { active: boolean; onClick: () => void; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className="lims-toggle data-[active=true]:bg-[var(--accent-600)] data-[active=true]:text-white data-[active=true]:border-[var(--accent-600)]"
    >
      {icon}
      {children}
    </button>
  );
}

export default function LibraryVariantComparison({
  samples,
  selected,
  loading: samplesLoading,
}: {
  samples: MutationSample[];
  selected: Set<string>;
  loading?: boolean;
}) {
  const [dataset, setDataset] = useState<LibraryVariantDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChartMode>('bars');
  const [sortOrder, setSortOrder] = useState<SortKey[]>(DEFAULT_SORT);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchData('/api/library-variants')
      .then(async res => {
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
        if (alive) setDataset(json as LibraryVariantDataset);
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load library variant data');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selectedSamples = useMemo(
    () => samples.filter(sample => selected.has(sample.id)).sort(compareSamples(sortOrder)),
    [samples, selected, sortOrder],
  );
  const selectedSampleIds = useMemo(() => new Set(selectedSamples.map(sample => sample.id)), [selectedSamples]);

  const measurements = useMemo(
    () => (dataset?.measurements ?? []).filter(m => selectedSampleIds.has(m.sampleId)),
    [dataset?.measurements, selectedSampleIds],
  );

  const topVariants = useMemo(() => {
    if (!dataset) return [] as (LibraryVariant & { total: number; max: number; present: number })[];
    const stats = new Map<string, { total: number; max: number; present: Set<string> }>();
    for (const m of measurements) {
      const s = stats.get(m.variantId) ?? { total: 0, max: 0, present: new Set<string>() };
      s.total += m.abundance;
      s.max = Math.max(s.max, m.abundance);
      if (m.abundance > 0) s.present.add(m.sampleId);
      stats.set(m.variantId, s);
    }
    return dataset.variants
      .map(v => {
        const s = stats.get(v.variantId) ?? { total: 0, max: 0, present: new Set<string>() };
        return { ...v, total: s.total, max: s.max, present: s.present.size };
      })
      .filter(v => v.total > 0)
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, undefined, { numeric: true }))
      .slice(0, 10);
  }, [dataset, measurements]);

  const valueBySampleVariant = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of measurements) map.set(`${m.sampleId}|${m.variantId}`, m.abundance);
    return map;
  }, [measurements]);

  const chartHeight = Math.max(220, topVariants.length * 30 + 50);

  if (samplesLoading || loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-[13px] text-[var(--text-soft)]">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading library variants...
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-[12px] flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div><div className="font-semibold">Could not load library variants.</div><div>{error}</div></div>
      </div>
    );
  }

  if (selectedSamples.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <div className="max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-sm">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-[var(--accent-600)]" />
          <h3 className="text-[15px] font-semibold text-[var(--text)]">Select samples to compare library variants</h3>
          <p className="mt-2 text-[12px] text-[var(--text-soft)] leading-relaxed">
            This view uses the same selected samples as Compare Mutations and plots verAB candidate abundance only for those samples. Pick samples in Sample Selection, then return here.
          </p>
        </div>
      </div>
    );
  }

  if (!dataset || dataset.variants.length === 0 || measurements.length === 0 || topVariants.length === 0) {
    return (
      <div className="m-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[12px] text-[var(--text-soft)]">
        No verAB library variant measurements match the currently selected samples.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-3 py-2 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="text-[13px] font-semibold text-[var(--text)] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--accent-600)]" /> Compare Library Variants
          </div>
          <div className="text-[11px] text-[var(--text-soft)]">
            {selectedSamples.length} selected sample{selectedSamples.length === 1 ? '' : 's'} · top {topVariants.length} variants by selected-sample abundance
          </div>
        </div>
        <div className="flex items-center gap-1" data-figure-omit>
          <ModeButton active={mode === 'bars'} onClick={() => setMode('bars')} icon={<BarChart3 className="w-3.5 h-3.5" />}>Bars</ModeButton>
          <ModeButton active={mode === 'heatmap'} onClick={() => setMode('heatmap')} icon={<Grid3X3 className="w-3.5 h-3.5" />}>Heatmap</ModeButton>
          <ModeButton active={mode === 'lines'} onClick={() => setMode('lines')} icon={<TrendingUp className="w-3.5 h-3.5" />}>Lines</ModeButton>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" data-figure-omit>
          <span className="lims-label">Sort samples</span>
          {SORT_LEVELS.map(level => (
            <button
              key={level.key}
              type="button"
              onClick={() => setSortOrder(prev => prev.includes(level.key) ? prev.filter(k => k !== level.key) : [...prev, level.key])}
              data-active={sortOrder.includes(level.key)}
              className="lims-toggle !py-1 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700 data-[active=true]:border-blue-300 dark:data-[active=true]:bg-blue-900/30 dark:data-[active=true]:text-blue-200"
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      {dataset.warnings && dataset.warnings.length > 0 && (
        <div className="mx-3 mt-2 p-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 text-[11px] text-amber-800 dark:text-amber-200 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>{dataset.warnings.join(' ')}</div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 overflow-auto">
            {mode === 'bars' && (
              <div className="space-y-3 min-w-[760px]">
                {topVariants.map((variant, vi) => {
                  const max = Math.max(variant.max, 0.001);
                  return (
                    <div key={variant.variantId} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 items-center">
                      <VariantLabel variant={variant} rank={vi + 1} />
                      <div className="space-y-1">
                        {selectedSamples.map(sample => {
                          const value = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`) ?? 0;
                          return (
                            <div key={sample.id} className="grid grid-cols-[150px_minmax(0,1fr)_52px] gap-2 items-center text-[11px]">
                              <div className="truncate text-[var(--text-soft)]" title={shortSample(sample)}>{shortSample(sample)}</div>
                              <div className="h-4 rounded bg-[var(--surface-3)] overflow-hidden">
                                <div className="h-full rounded" style={{ width: `${Math.max(2, (value / max) * 100)}%`, backgroundColor: colorFor(vi) }} />
                              </div>
                              <div className="text-right tabular-nums text-[var(--text)]">{fmtPct(value)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {mode === 'heatmap' && (
              <table className="text-[11px] border-separate" style={{ borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 bg-[var(--surface)] text-left p-1.5 min-w-[140px] border-b border-[var(--border)]">Variant</th>
                    {selectedSamples.map(sample => (
                      <th key={sample.id} className="sticky top-0 z-10 bg-[var(--surface)] p-1.5 border-b border-[var(--border)] min-w-[78px] max-w-[78px] align-bottom">
                        <div className="-rotate-45 origin-bottom-left translate-x-6 h-20 w-20 text-left truncate" title={shortSample(sample)}>{shortSample(sample)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topVariants.map((variant, vi) => (
                    <tr key={variant.variantId}>
                      <td className="sticky left-0 z-10 bg-[var(--surface)] p-1.5 border-b border-[var(--border)]"><VariantLabel variant={variant} rank={vi + 1} /></td>
                      {selectedSamples.map(sample => {
                        const value = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`) ?? 0;
                        return <td key={sample.id} className="p-1.5 text-center tabular-nums border-b border-l border-[var(--border)]" style={heatStyle(value)} title={`${variant.label} in ${shortSample(sample)}: ${fmtPct(value)}`}>{fmtPct(value)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {mode === 'lines' && (
              <div className="min-w-[760px]">
                <svg width="100%" height={chartHeight} viewBox={`0 0 900 ${chartHeight}`} role="img" aria-label="Library variant abundance lines">
                  <line x1="90" y1={chartHeight - 34} x2="870" y2={chartHeight - 34} stroke="var(--border)" />
                  <line x1="90" y1="20" x2="90" y2={chartHeight - 34} stroke="var(--border)" />
                  {topVariants.map((variant, vi) => {
                    const maxY = Math.max(...topVariants.map(v => v.max), 0.001);
                    const points = selectedSamples.map((sample, si) => {
                      const x = selectedSamples.length === 1 ? 480 : 90 + (si / (selectedSamples.length - 1)) * 780;
                      const value = valueBySampleVariant.get(`${sample.id}|${variant.variantId}`) ?? 0;
                      const y = 20 + (1 - value / maxY) * (chartHeight - 54);
                      return { x, y, value };
                    });
                    return (
                      <g key={variant.variantId}>
                        <polyline fill="none" stroke={colorFor(vi)} strokeWidth={variant.aiGenerated ? 3 : 2} strokeDasharray={variant.aiGenerated ? '6 3' : undefined} points={points.map(p => `${p.x},${p.y}`).join(' ')} opacity="0.9" />
                        {points.map((p, pi) => <circle key={pi} cx={p.x} cy={p.y} r={variant.aiGenerated ? 4 : 3} fill={colorFor(vi)}><title>{`${variant.label} · ${shortSample(selectedSamples[pi])}: ${fmtPct(p.value)}`}</title></circle>)}
                      </g>
                    );
                  })}
                  {selectedSamples.map((sample, si) => {
                    const x = selectedSamples.length === 1 ? 480 : 90 + (si / (selectedSamples.length - 1)) * 780;
                    return <text key={sample.id} x={x} y={chartHeight - 12} textAnchor="end" transform={`rotate(-35 ${x} ${chartHeight - 12})`} fontSize="10" fill="currentColor">{shortSample(sample).slice(0, 22)}</text>;
                  })}
                </svg>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {topVariants.map((variant, vi) => <LegendItem key={variant.variantId} variant={variant} color={colorFor(vi)} />)}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 overflow-auto max-h-[640px]">
            <div className="text-[12px] font-semibold text-[var(--text)] mb-2">Variant metadata</div>
            <div className="space-y-2">
              {topVariants.slice(0, 8).map((variant, vi) => (
                <div key={variant.variantId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                  <VariantLabel variant={variant} rank={vi + 1} />
                  <div className="mt-1 grid grid-cols-[95px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10.5px]">
                    {metadataEntries(variant).slice(0, 8).map(([key, value]) => (
                      <React.Fragment key={key}>
                        <div className="text-[var(--text-faint)]">{key}</div>
                        <div className="text-[var(--text-soft)] truncate" title={value}>{value}</div>
                      </React.Fragment>
                    ))}
                    <div className="text-[var(--text-faint)]">present</div>
                    <div className="text-[var(--text-soft)] tabular-nums">{variant.present}/{selectedSamples.length} samples · max {fmtPct(variant.max)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VariantLabel({ variant, rank }: { variant: LibraryVariant; rank: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] text-[var(--text-faint)] tabular-nums">{rank}.</span>
        <span className="font-mono text-[12px] font-semibold text-[var(--text)] truncate" title={variant.label}>{variant.label}</span>
        {variant.aiGenerated && <span className="shrink-0 px-1.5 py-0.5 rounded-full border border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200 text-[9.5px] font-semibold">AI-generated</span>}
      </div>
      {variant.gene && <div className="text-[10px] text-[var(--text-faint)] truncate" title={variant.gene}>{variant.gene}</div>}
    </div>
  );
}

function LegendItem({ variant, color }: { variant: LibraryVariant; color: string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="w-3 h-0.5 rounded" style={{ backgroundColor: color, borderTop: variant.aiGenerated ? '2px dashed currentColor' : undefined }} />
      <span className="font-mono">{variant.label}</span>
      {variant.aiGenerated && <span className="text-violet-600 dark:text-violet-300">AI</span>}
    </div>
  );
}
