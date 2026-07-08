'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Download, Grid2x2, Search, TrendingUp } from 'lucide-react';
import { fetchData } from '../lib/dataSource';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

type GroupLevelKey = 'experiment' | 'condition' | 'strain' | 'dna' | 'replicate' | 'transfer';

interface LibraryVariantInfo {
  library: string | null;
  featureType: string | null;
  featureNumber: string | null;
  featureAlias: string | null;
  featureName: string | null;
  barcode: string | null;
  sequence: string | null;
  aiGenerated: boolean;
}

interface LibraryVariantSampleRow {
  sampleId: string;
  seqsample: string;
  seqorder: string | null;
  experiment?: string | null;
  condition?: string | null;
  strain?: string | null;
  donor_dna?: string | null;
  replicate?: string | null;
  transfer?: number | null;
  displaySampleName?: string | null;
  library: string | null;
  candidate: string;
  verA: string | null;
  verB: string | null;
  count: number;
  totalCountForSample: number;
  frequency: number;
  verAInfo: LibraryVariantInfo;
  verBInfo: LibraryVariantInfo;
}

interface LibraryVariantDataset {
  rows: LibraryVariantSampleRow[];
  samples: string[];
  variants: string[];
  hasLibraryVariants: boolean;
  warning?: string;
}

interface SelectedSample {
  id: string;
  name: string;
  experiment?: string;
  condition?: string;
  strain?: string;
  donor_dna?: string;
  replicate?: string;
  transfer?: number;
}

const GROUP_ORDER: GroupLevelKey[] = ['experiment', 'condition', 'strain', 'dna', 'replicate', 'transfer'];

function groupValue(row: LibraryVariantSampleRow, key: GroupLevelKey): string {
  if (key === 'transfer') return typeof row.transfer === 'number' ? String(row.transfer) : '';
  if (key === 'dna') return row.donor_dna ?? '';
  return String((row as unknown as Record<string, unknown>)[key] ?? '');
}

function comparator(a: LibraryVariantSampleRow, b: LibraryVariantSampleRow): number {
  for (const key of GROUP_ORDER) {
    if (key === 'transfer') {
      const at = typeof a.transfer === 'number' ? a.transfer : Infinity;
      const bt = typeof b.transfer === 'number' ? b.transfer : Infinity;
      if (at !== bt) return at - bt;
      continue;
    }
    const av = groupValue(a, key);
    const bv = groupValue(b, key);
    if (av !== bv) return av.localeCompare(bv);
  }
  return (a.displaySampleName ?? a.sampleId).localeCompare(b.displaySampleName ?? b.sampleId);
}

function metricLabel(row: LibraryVariantSampleRow, metric: 'count' | 'frequency') {
  return metric === 'count' ? String(row.count) : `${(row.frequency * 100).toFixed(1)}%`;
}

export default function LibraryVariantExplorer({ selectedSamples, experiment }: { selectedSamples: SelectedSample[]; experiment?: string; }) {
  const [data, setData] = useState<LibraryVariantDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'heatmap' | 'bars' | 'lines'>('heatmap');
  const [metric, setMetric] = useState<'count' | 'frequency'>('frequency');
  const [search, setSearch] = useState('');
  const [selectedVariants, setSelectedVariants] = useState<string[]>([]);

  const sampleIds = useMemo(() => selectedSamples.map(s => s.id).filter(Boolean), [selectedSamples]);
  const selectedSampleMap = useMemo(() => new Map(selectedSamples.map(s => [s.id, s])), [selectedSamples]);

  useEffect(() => {
    if (sampleIds.length === 0) {
      setData(null);
      return;
    }
    const params = new URLSearchParams();
    if (experiment) params.set('experiment', experiment);
    params.set('samples', sampleIds.join(','));
    setLoading(true);
    setError(null);
    fetchData(`/api/library-variants?${params.toString()}`)
      .then(r => r.json())
      .then((j: LibraryVariantDataset) => {
        setData(j);
        setSelectedVariants(prev => prev.length ? prev.filter(v => j.variants.includes(v)) : j.variants.slice(0, 12));
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [experiment, sampleIds.join(',')]);

  const filteredRows = useMemo(() => {
    if (!data) return [] as LibraryVariantSampleRow[];
    const q = search.trim().toLowerCase();
    return data.rows.filter(row => {
      if (selectedVariants.length > 0 && !selectedVariants.includes(row.candidate) && !selectedVariants.includes(row.verA ?? '') && !selectedVariants.includes(row.verB ?? '')) return false;
      if (!q) return true;
      return [row.candidate, row.verA, row.verB, row.library, row.displaySampleName, row.seqsample, row.verAInfo.featureName, row.verBInfo.featureName, row.verAInfo.barcode, row.verBInfo.barcode].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [data, search, selectedVariants]);

  const rowsBySample = useMemo(() => {
    const map = new Map<string, LibraryVariantSampleRow[]>();
    for (const row of filteredRows) {
      const list = map.get(row.sampleId) ?? [];
      list.push(row);
      map.set(row.sampleId, list);
    }
    for (const list of map.values()) list.sort(comparator);
    return map;
  }, [filteredRows]);

  const uniqueCandidates = useMemo(() => [...new Set(filteredRows.map(r => r.candidate))].sort(), [filteredRows]);

  const csv = useMemo(() => {
    const header = ['sampleId', 'seqsample', 'seqorder', 'experiment', 'condition', 'strain', 'donor_dna', 'replicate', 'transfer', 'library', 'candidate', 'verA', 'verB', 'count', 'frequency', 'totalCountForSample'];
    const lines = filteredRows.map(r => [r.sampleId, r.seqsample, r.seqorder ?? '', r.experiment ?? '', r.condition ?? '', r.strain ?? '', r.donor_dna ?? '', r.replicate ?? '', r.transfer ?? '', r.library ?? '', r.candidate, r.verA ?? '', r.verB ?? '', r.count, r.frequency, r.totalCountForSample].map(v => JSON.stringify(v)).join(','));
    return [header.join(','), ...lines].join('\n');
  }, [filteredRows]);

  if (sampleIds.length === 0) return <div className="p-6 text-sm text-[var(--text-soft)]">Select one or more samples in Sample Selection first. Compare Library Variants only compares the currently selected samples.</div>;
  if (loading && !data) return <div className="p-6 text-sm text-[var(--text-soft)]">Loading library variants…</div>;
  if (error) return <div className="p-6 text-sm text-red-600 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5" />{error}</div>;
  if (!data) return <div className="p-6 text-sm text-[var(--text-soft)]">No library-variant data loaded yet.</div>;
  if (!data.hasLibraryVariants || data.rows.length === 0) return <div className="p-6 text-sm text-[var(--text-soft)]">No verAB / Library_candidates rows were found for the selected samples in this snapshot.</div>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button className={cn('px-3 py-1.5 rounded border', viewMode === 'heatmap' && 'bg-slate-100')} onClick={() => setViewMode('heatmap')}><Grid2x2 className="inline w-4 h-4 mr-1" />Heatmap</button>
      <button className={cn('px-3 py-1.5 rounded border', viewMode === 'bars' && 'bg-slate-100')} onClick={() => setViewMode('bars')}><BarChart3 className="inline w-4 h-4 mr-1" />Bars</button>
      <button className={cn('px-3 py-1.5 rounded border', viewMode === 'lines' && 'bg-slate-100')} onClick={() => setViewMode('lines')}><TrendingUp className="inline w-4 h-4 mr-1" />Lines</button>
      <button className={cn('px-3 py-1.5 rounded border', metric === 'frequency' && 'bg-slate-100')} onClick={() => setMetric('frequency')}>Frequency</button>
      <button className={cn('px-3 py-1.5 rounded border', metric === 'count' && 'bg-slate-100')} onClick={() => setMetric('count')}>Count</button>
      <a className="px-3 py-1.5 rounded border inline-flex items-center gap-1" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="library-variants.csv"><Download className="w-4 h-4" />CSV</a>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <Search className="w-4 h-4 absolute left-2 top-2.5 text-[var(--text-soft)]" />
        <input className="pl-8 pr-3 py-2 border rounded text-sm" placeholder="Search candidate, verA, verB, feature, barcode" value={search} onChange={e => setSearch(e.target.value)} />
      </label>
      <div className="text-xs text-[var(--text-soft)]">{selectedSamples.length} selected samples</div>
      {data.warning ? <div className="text-xs text-amber-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{data.warning}</div> : null}
    </div>
    <div className="flex flex-wrap gap-2 text-xs">
      {data.variants.slice(0, 24).map(v => <button key={v} className={cn('px-2 py-1 rounded border', selectedVariants.includes(v) && 'bg-slate-200')} onClick={() => setSelectedVariants(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}>{v}</button>)}
    </div>
    <div className="border rounded overflow-auto max-h-[70vh]" id="library-variants-figure">
      {viewMode !== 'bars' && viewMode !== 'lines' ? (
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-white z-10">
            <tr>
              <th className="text-left p-2">Variant</th>
              {selectedSamples.map(s => <th key={s.id} className="text-left p-2">{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {uniqueCandidates.map(candidate => <tr key={candidate}>
              <td className="p-2 align-top font-medium">{candidate}</td>
              {selectedSamples.map(sample => {
                const row = filteredRows.find(r => r.candidate === candidate && r.sampleId === sample.id);
                const value = row ? (metric === 'count' ? row.count : row.frequency) : 0;
                const alpha = metric === 'count' ? Math.min(0.85, value / Math.max(1, row?.totalCountForSample ?? 1)) : Math.max(0.08, value);
                return <td key={sample.id} className="p-2" style={{ backgroundColor: `rgba(59,130,246,${alpha})` }}>
                  {row ? <div className="space-y-0.5"><div>{metricLabel(row, metric)}</div>{row.verAInfo.aiGenerated || row.verBInfo.aiGenerated ? <div className="text-[10px] uppercase text-amber-700">AI generated</div> : null}</div> : '—'}
                </td>;
              })}
            </tr>)}
          </tbody>
        </table>
      ) : null}
      {viewMode === 'bars' ? <div className="p-3 space-y-3">{selectedSamples.map(sample => {
        const rows = rowsBySample.get(sample.id) ?? [];
        const total = rows.reduce((sum, row) => sum + (metric === 'count' ? row.count : row.frequency), 0) || 1;
        return <div key={sample.id}>
          <div className="flex justify-between text-xs mb-1"><span>{sample.name}</span><span>{rows.length} rows</span></div>
          <div className="h-4 bg-slate-100 rounded overflow-hidden flex">
            {rows.map(row => <div key={`${sample.id}-${row.candidate}`} title={`${row.candidate}: ${metricLabel(row, metric)}`} style={{ width: `${Math.max(2, ((metric === 'count' ? row.count : row.frequency) / total) * 100)}%`, background: '#3b82f6' }} />)}
          </div>
        </div>;
      })}</div> : null}
      {viewMode === 'lines' ? <div className="p-3 space-y-2">{uniqueCandidates.map(candidate => <div key={candidate} className="text-xs flex items-center gap-2"><span className="inline-block w-40 truncate">{candidate}</span><svg width="280" height="24" viewBox="0 0 280 24" className="inline-block align-middle">{selectedSamples.map((sample, idx) => {
        const row = filteredRows.find(r => r.candidate === candidate && r.sampleId === sample.id);
        const x = selectedSamples.length <= 1 ? 12 : (idx / (selectedSamples.length - 1)) * 260 + 10;
        const y = 20 - ((metric === 'count' ? (row?.count ?? 0) : (row?.frequency ?? 0)) * 18);
        return <circle key={sample.id} cx={x} cy={y} r="2.5" fill="#3b82f6" />;
      })}</svg></div>)}</div> : null}
    </div>
  </div>;
}
