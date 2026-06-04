'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Download, Grid3X3, Info, Loader2, RefreshCw, Sparkles,
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

// Color ramp: white → green for copy counts. Not-sequenced (null) gets a
// hatched grey; un-integrated (false) gets a desaturated red dot overlay.
function cellColor(value: number | null, max: number): string {
  if (value === null) return 'transparent';
  if (value === 0) return 'hsl(0 0% 96%)';
  const t = Math.min(1, value / Math.max(1, max));
  // 0 → pale yellow, 1 → deep green
  const hue = 80;
  const sat = 60 + Math.round(t * 20);
  const light = 92 - Math.round(t * 50);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function toCsv(d: CopyNumberDataset): string {
  const header = ['experiment','strain','replicate','transfer','condition','integrated', ...d.alleles];
  const lines = [header.join(',')];
  for (const s of d.samples) {
    const cells = [
      s.experiment, s.strain, String(s.replicate), String(s.transfer), s.condition,
      s.integrated === null ? '' : s.integrated ? 'true' : 'false',
      ...d.alleles.map(a => s.copies[a] === null || s.copies[a] === undefined ? '' : String(s.copies[a])),
    ];
    lines.push(cells.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

function downloadBlob(name: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CopyNumberHeatmap() {
  const [data, setData] = useState<CopyNumberDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExp, setSelectedExp] = useState<Set<string>>(new Set());
  const [groupByCondition, setGroupByCondition] = useState(false);

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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.samples
      .filter(s => selectedExp.has(s.experiment))
      .sort((a, b) =>
        a.experiment.localeCompare(b.experiment) ||
        a.strain.localeCompare(b.strain) ||
        a.replicate - b.replicate ||
        a.transfer - b.transfer);
  }, [data, selectedExp]);

  const maxCopy = useMemo(() => {
    let m = 1;
    filtered.forEach(s => Object.values(s.copies).forEach(v => { if (v !== null && v > m) m = v; }));
    return m;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/80 flex items-center gap-2 shrink-0">
        <Grid3X3 className="w-4 h-4 text-fuchsia-600 dark:text-fuchsia-400" />
        <span className="text-sm font-semibold text-slate-800 dark:text-gray-100">Copy-Number Heat Map</span>
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
        <span className="text-[11px] text-slate-500 dark:text-gray-400 ml-2">{filtered.length}/{data?.samples.length ?? 0} samples</span>
        <div className="ml-auto flex items-center gap-1.5">
          <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-gray-300">
            <input type="checkbox" checked={groupByCondition} onChange={e => setGroupByCondition(e.target.checked)} />
            Group by condition
          </label>
          <button
            onClick={() => data && downloadBlob('copy-number.csv', toCsv({ ...data, samples: filtered }))}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 disabled:opacity-50"
            disabled={!data || filtered.length === 0}
            title="Download visible matrix as CSV"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={load} className="p-1.5 rounded text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700">
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
        <div className="w-56 shrink-0 border-r border-slate-200 dark:border-gray-700 p-2 bg-slate-50/40 dark:bg-gray-800/40 overflow-y-auto">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Experiments</div>
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

          <div className="mt-4 text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-gray-400 mb-1">Legend</div>
          <div className="space-y-1 text-[11px] text-slate-600 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ background: cellColor(0, maxCopy) }} /> 0 copies
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ background: cellColor(Math.max(1, Math.round(maxCopy / 2)), maxCopy) }} /> mid
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ background: cellColor(maxCopy, maxCopy) }} /> {maxCopy} copies (max)
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-slate-300 bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_2px,transparent_2px,transparent_5px)]" /> not sequenced
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-3 rounded border border-red-300 bg-red-50" /> construct not integrated
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-auto p-3 bg-slate-100/30 dark:bg-gray-900/30">
          {loading && (
            <div className="flex items-center justify-center h-full text-slate-500 dark:text-gray-400 gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red-600 dark:text-red-400 gap-2 text-sm">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          {!loading && !error && data && filtered.length > 0 && (
            <table className="border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-2 py-1 text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700">Sample</th>
                  <th className="px-2 py-1 text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700">T</th>
                  <th className="px-2 py-1 text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700">Rep</th>
                  {groupByCondition && (
                    <th className="px-2 py-1 text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700">Condition</th>
                  )}
                  <th className="px-2 py-1 text-left text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700">Int</th>
                  {data.alleles.map(a => (
                    <th key={a} className="px-2 py-1 text-center text-slate-600 dark:text-gray-300 border-b border-slate-200 dark:border-gray-700 font-mono whitespace-nowrap">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-gray-800/60">
                    <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-2 py-1 font-mono text-slate-700 dark:text-gray-200 border-b border-slate-100 dark:border-gray-700/50 whitespace-nowrap">
                      {s.experiment}/{s.strain}
                    </td>
                    <td className="px-2 py-1 text-slate-600 dark:text-gray-400 tabular-nums border-b border-slate-100 dark:border-gray-700/50">{s.transfer}</td>
                    <td className="px-2 py-1 text-slate-600 dark:text-gray-400 tabular-nums border-b border-slate-100 dark:border-gray-700/50">{s.replicate}</td>
                    {groupByCondition && (
                      <td className="px-2 py-1 text-slate-600 dark:text-gray-400 border-b border-slate-100 dark:border-gray-700/50">{s.condition}</td>
                    )}
                    <td className="px-2 py-1 border-b border-slate-100 dark:border-gray-700/50">
                      {s.integrated === false
                        ? <span title="Construct did not integrate" className="text-red-600 dark:text-red-400 font-mono">no</span>
                        : s.integrated === true
                          ? <span className="text-emerald-600 dark:text-emerald-400 font-mono">yes</span>
                          : <span className="text-slate-400">—</span>}
                    </td>
                    {data.alleles.map(a => {
                      const v = s.copies[a];
                      const isNS = v === null || v === undefined;
                      const isNotIntegrated = s.integrated === false;
                      const bg = isNS
                        ? undefined
                        : cellColor(v ?? 0, maxCopy);
                      return (
                        <td
                          key={a}
                          className={cn(
                            'px-2 py-1 text-center tabular-nums border-b border-slate-100 dark:border-gray-700/50',
                            isNS && 'bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_2px,transparent_2px,transparent_5px)]',
                            isNotIntegrated && !isNS && 'opacity-40',
                          )}
                          style={!isNS ? { background: bg } : undefined}
                          title={isNS ? 'not sequenced' : `${a}: ${v} copies`}
                        >
                          {isNS ? <span className="text-slate-400">n.s.</span> : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
