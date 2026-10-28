'use client';
import { useEffect, useMemo, useState } from 'react';
import { fetchData } from '@/lib/dataSource';
import { groupDgoA, type DgoAMeasurement, type DgoAVariant, type DgoAGroupMode } from '@/lib/dgoaAlleles';

type Dataset={variants:DgoAVariant[];measurements:DgoAMeasurement[];warnings?:string[];error?:string};
export default function DgoAAlleleComparison({ selected }: { selected: Set<string> }) {
 const [data,setData]=useState<Dataset>(); const [mode,setMode]=useState<DgoAGroupMode>('aa'); const [top,setTop]=useState(50); const [metric,setMetric]=useState<'count'|'relative'>('relative'); const [isolated,setIsolated]=useState<Set<string>>(new Set()); const [frame,setFrame]=useState(0);
 useEffect(()=>{fetchData('/api/dgoa-alleles').then(r=>r.json()).then(setData).catch(e=>setData({variants:[],measurements:[],error:String(e)}));},[]);
 const groups=useMemo(()=>groupDgoA(data?.variants??[], (data?.measurements??[]).filter(m=>!selected.size||selected.has(m.sampleId)),mode),[data,mode,selected]);
 const shown=groups.filter(g=>!isolated.size||isolated.has(g.id)).slice(0,top||undefined); const max=Math.max(...shown.map(g=>metric==='count'?g.count:g.relative),1); const seq=shown.find(g=>g.sequence)?.sequence ?? ''; const width=mode==='aa'?40:60; const view=seq.slice(frame,frame+width);
 if (!data) return <div className="p-4 text-sm text-[var(--text-soft)]">Loading dgoA allele measurements…</div>;
 if (data.error) return <div role="alert" className="m-3 p-3 text-sm text-red-700 bg-red-50 rounded">Could not load dgoA alleles: {data.error}</div>;
 if (!data.measurements.length) return <div className="p-4 text-sm text-[var(--text-soft)]">No dgoA allele measurements are available for this snapshot. {data.warnings?.join(' ')}</div>;
 return <section className="p-3 overflow-auto" aria-label="dgoA allele comparison"><div className="flex flex-wrap gap-3 items-end mb-3 text-sm">
  <label>Grouping <select aria-label="dgoA grouping" value={mode} onChange={e=>setMode(e.target.value as DgoAGroupMode)} className="lims-input"><option value="aa">amino acid</option><option value="dna">DNA</option></select></label>
  <label>Show <select aria-label="number of alleles" value={top} onChange={e=>setTop(Number(e.target.value))} className="lims-input"><option value="0">All</option><option value="50">Top 50</option><option value="20">Top 20</option><option value="10">Top 10</option></select></label>
  <label>Metric <select aria-label="dgoA metric" value={metric} onChange={e=>setMetric(e.target.value as 'count'|'relative')} className="lims-input"><option value="relative">relative</option><option value="count">total count</option></select></label>
 </div><p className="text-xs text-[var(--text-soft)] mb-2">Groups are summed before Top-N ranking. Relative abundance uses all grouped variants, including hidden variants.</p>
 <div className="space-y-1 min-w-[520px]">{shown.map(g=>{const value=metric==='count'?g.count:g.relative; return <button key={g.id} onClick={()=>setIsolated(p=>{const n=new Set(p);n.has(g.id)?n.delete(g.id):n.add(g.id);return n;})} className="w-full flex gap-2 items-center text-left text-xs" title="Click to isolate or restore this allele"><span className="w-48 truncate">{g.label}</span><span className="h-5 bg-violet-500 rounded" style={{width:`${Math.max(2,100*value/max)}%`}}/><span>{metric==='count'?g.count.toLocaleString():`${(g.relative*100).toFixed(2)}%`}</span></button>})}</div>
 {isolated.size>0&&<button className="lims-btn lims-btn-ghost mt-2" onClick={()=>setIsolated(new Set())}>Show all groups</button>}
 <div className="mt-5 border-t pt-3"><h3 className="font-medium text-sm">Equal-length {mode==='aa'?'amino-acid':'DNA'} position viewer</h3><p className="text-xs text-[var(--text-soft)]">Deterministic sequence window only, not a biological multiple sequence alignment.</p><label className="text-xs">Position <input aria-label="sequence frame position" type="range" min="0" max={Math.max(0,seq.length-width)} value={frame} onChange={e=>setFrame(Number(e.target.value))}/>{frame+1}–{Math.min(seq.length,frame+width)}</label><pre className="mt-1 overflow-auto text-xs">{view || 'No sequence is available for the displayed group.'}</pre></div>
 </section>;
}
