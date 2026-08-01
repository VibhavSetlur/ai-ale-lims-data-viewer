'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Search, BookOpen, Compass, ChevronRight,
  MousePointerClick, Layers, TrendingUp, BarChart3, Download,
  Info, FlaskConical, FileText, ShieldCheck,
} from 'lucide-react';

/* ---------------------------------------------------------------------------
   HelpCenter: a deep, practical, searchable in-app documentation panel.

   This is the "help button" deliverable. It is written for biologists (not
   engineers) and intentionally explicit so the same text can be pasted into an
   institutional AI assistant. Every section is plain prose + concrete steps;
   the search box filters sections live so it reads like a small semantic index
   over the docs. A cross-link opens the Guide and Ask-your-AI prompt builder.
--------------------------------------------------------------------------- */

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'rule'; title: string; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'code'; text: string };

type Section = {
  id: string;
  title: string;
  icon: React.ReactNode;
  summary: string;
  blocks: Block[];
};

const SECTIONS: Section[] = [
  {
    id: 'overview',
    title: 'What this viewer is',
    icon: <BookOpen className="w-4 h-4" />,
    summary: 'A read-only window onto a LIMS mirror snapshot: mutations, copy number, growth, and VerA/VerB barcode composition.',
    blocks: [
      { kind: 'p', text: 'The AI-ALE LIMS viewer is a read-only interface over a snapshot of the lab LIMS database. It does not change any data. Everything you see is either a value stored in the database or a number computed transparently from stored values (and the help text tells you which).' },
      { kind: 'p', text: 'There are three peer workspaces, switched from the left sidebar:' },
      { kind: 'bullets', items: [
        'Database Tables: the raw LIMS tables with search, sort, filters, pagination, and CSV export. Use this to audit source rows or trace where a number came from. (Hidden on the public static deployment.)',
        'Mutation Explorer: the curated scientific views built on those tables: Sample Selection, Comparative View (heatmap), Copy Number, and Barcode Charts.',
        'Plate Design: a browser-local, read-only planning workspace for 1 to 24 fixed 96-well layouts. It offers snapshot suggestions, JSON and pipeline CSV hand-off, but never writes to LIMS. Export JSON regularly because browser storage can be cleared.',
      ] },
      { kind: 'note', text: 'The Dev and Public deployments are built from different database snapshots, so they can show different tabs. If Barcode Charts is missing, that snapshot has no non-empty verAB_barcodes table.' },
    ],
  },
  {
    id: 'sample-selection',
    title: 'Sample Selection',
    icon: <MousePointerClick className="w-4 h-4" />,
    summary: 'Filter by experiment, strain, condition, donor DNA, replicate, transfer; pick the exact samples to compare.',
    blocks: [
      { kind: 'p', text: 'Sample Selection is where you choose which samples flow into every other view. The metadata chips cross-filter: picking one factor narrows the options shown for the others, so you cannot build an impossible combination.' },
      { kind: 'steps', items: [
        'Open Mutation Explorer from the left sidebar.',
        'Use the Experiment / Strain / Condition / Donor DNA / Replicate / Transfer filters to narrow the sample table.',
        'Tick the checkboxes for the samples you want, or use the header checkbox to select all visible.',
        'Each row shows a small OD600 growth sparkline — click it to open the full growth-curve popup.',
        'Switch to Comparative View, Copy Number, or Barcode Charts; they all act on your selection.',
      ] },
      { kind: 'note', text: 'Counts are labeled (for example "12 of 246 samples"). A bare number is never shown without saying what it counts.' },
    ],
  },
  {
    id: 'comparative',
    title: 'Comparative View (mutation + copy-number heatmap)',
    icon: <Layers className="w-4 h-4" />,
    summary: 'A heatmap grid of mutation frequency and copy-number rows across the samples you selected.',
    blocks: [
      { kind: 'p', text: 'Comparative View places mutations and copy-number regions as rows and your selected samples as columns. Cell color encodes the value. This is the figure most people put in a paper.' },
      { kind: 'rule', title: 'Color rule (read this once)', text: 'Frequency rows use a FIXED 0% to 100% color scale, so the same percentage is always the same color across every row and sample. Copy-number rows use a row-local scale: the minimum and maximum copy number visible for that region across your samples. The per-row min/max only applies to copy-number rows, never to frequency.' },
      { kind: 'steps', items: [
        'Click a mutation name to open a genome-context popup (position, gene, neighbours).',
        'Use the metric filter to show all metrics, frequency only, or copy number only.',
        'Use the mutation-class pills to focus on nonsynonymous, nonsense, indel, or deletion calls.',
        'Reorder the column Group levels to match your experimental design.',
        'Click a sample column header name to open its sample detail popup, which chains to the growth curve.',
        'Export the heatmap through the PNG preview/editor modal; export CSV for the underlying values.',
      ] },
      { kind: 'rule', title: 'Provided vs spontaneous mutations', text: 'A mutation supplied as donor DNA (named in the growth condition) is drawn with an amber outline over its frequency color. An amber outline with NO fill and a 0% marker means the mutation was provided in donor DNA but never observed in that sample. Spontaneous mutations have no outline.' },
    ],
  },
  {
    id: 'copy-number',
    title: 'Copy Number tab',
    icon: <TrendingUp className="w-4 h-4" />,
    summary: 'Per-lineage copy-number trajectories over transfers, with isolate, log/linear, and reference lines.',
    blocks: [
      { kind: 'p', text: 'The Copy Number tab plots copy number versus transfer as one line per lineage. With many lineages the chart can look like spaghetti, so it is built to be tamed.' },
      { kind: 'steps', items: [
        'Hover the chart for a crosshair and a tooltip that snaps to the nearest data point.',
        'Use the legend on the right (it scrolls independently so the chart never leaves view); filter it with the search box.',
        'Click a legend entry to ISOLATE that lineage — the other lines are removed so you see one clean trajectory.',
        'Toggle Log/Linear Y; copy number spans a wide range so log is often clearer.',
        'CN = 1x and CN = 2x dashed reference lines mark single and double copy.',
      ] },
    ],
  },
  {
    id: 'barcodes',
    title: 'Barcode Charts (VerA / VerB composition)',
    icon: <BarChart3 className="w-4 h-4" />,
    summary: 'Track A#-B# VerA/VerB candidate composition across transfers; split, isolate, compare, and follow subunits.',
    blocks: [
      { kind: 'p', text: 'Barcode Charts show how the population is composed of VerA/VerB barcode combinations across transfers. A label like A12-B30 means VerA subunit 12 paired with VerB subunit 30. The same combination always gets the same color so you can track it by eye across every chart, sample, and experiment.' },
      { kind: 'rule', title: 'The three levels of composition', text: 'A-B candidate = one specific VerA+VerB pair. VerA group = every A#-* sharing one VerA subunit. VerB group = every *-B# sharing one VerB subunit. Group the Candidates sidebar by VerA or VerB, then click a group header to act on the whole subunit at once.' },
      { kind: 'steps', items: [
        'Filter charts by library, well, transfer range, minimum reads, or search text.',
        'Choose color mode: A-B (per full candidate), VerA (per VerA subunit), or VerB (per VerB subunit).',
        'Toggle Split A/B to show three aligned views per transfer: full A-B, VerA-aggregated, and VerB-aggregated.',
        'In the Candidates sidebar: hover a row to highlight it everywhere; click to SELECT (charts filter to those containing it and emphasize it); use Isolate selected to hide the rest entirely.',
        'Click a candidate or subunit info pill for a cross-chart detail popup (where it dominates, rising or falling, peak share).',
        'In Focus, switch chart type: Rows (most readable labels), Bars, Lines (trajectory over time), or Heatmap (many candidates at once).',
        'Add charts to Compare; the shared legend and common Y-axis make conditions truly comparable.',
      ] },
      { kind: 'rule', title: 'Why VerA and VerB together matter (biology)', text: 'VerB is required for the activity of VerA: the combination affects the substrate. The substrate binds VerA, and VerB modulates VerA, so the VerA/VerB pairing governs substrate specificity. Tracking which A#-B# combinations rise or fall across transfers is how you follow shifts in substrate specificity over evolution. The viewer shows composition and trajectories; it does not by itself prove mechanism unless your experimental design supports the claim.' },
    ],
  },
  {
    id: 'compare',
    title: 'Comparing charts side by side',
    icon: <Layers className="w-4 h-4" />,
    summary: 'Add charts to Compare for honest small-multiples: shared Y-axis, shared legend, panel sort, per-panel outcome, synced selection.',
    blocks: [
      { kind: 'p', text: 'A comparison is only honest if the axes are shared, and only useful if selection and hover sync across panels. Compare is built for reading many conditions at once.' },
      { kind: 'bullets', items: [
        'Common Y-axis: in Reads mode every compared chart uses one read-count scale, so equal bar heights mean equal reads. A badge shows the locked maximum.',
        'Reads vs Fraction: switch all panels to composition (0 to 100%) to compare proportions instead of absolute depth, without leaving Compare.',
        'Panel sort: order the panels As added, by Name, by Dominant combination (groups panels with the same winner), by Final richness, or by Total reads, so the layout reads like a result.',
        'Per-panel outcome: each panel shows a Final line with the dominant A-B combination at the last transfer, its percentage, and how many combinations remain present.',
        'Shared candidate/subunit legend: clicking a candidate (or, in VerA/VerB color mode, a subunit) toggles it in every chart at once; hovering highlights it across all charts. Sort the legend by reads or by divergence (how differently a candidate ends up across the panels).',
        'Column-count control (Auto/1/2/3/4) and Clear all keep the layout under your control.',
        'Selection in the left sidebar and selection in the shared legend are the same selection, so they never disagree.',
      ] },
    ],
  },
  {
    id: 'growth',
    title: 'Growth curves (and how metrics are computed)',
    icon: <FlaskConical className="w-4 h-4" />,
    summary: 'OD600 vs time from Robotic_OD; descriptive point-to-point metrics, never invented or model-fitted.',
    blocks: [
      { kind: 'p', text: 'Growth curves are numeric OD600 time series rebuilt from the LIMS Robotic_OD table, matched to a sample by ALE lineage and transfer. If a numeric series is not present for a sample, the popup says so plainly and only shows an OD file reference when one exists. The viewer never fabricates a curve or a growth rate.' },
      { kind: 'rule', title: 'How each metric is calculated', text: 'These are descriptive statistics of the observed points, NOT Gompertz/logistic/Richards model fits.' },
      { kind: 'bullets', items: [
        'Max OD600 (K): the maximum observed OD600 (not a fitted asymptote).',
        'Max growth rate mu: the steepest slope of ln(OD) between two consecutive measured points: max over i of (ln(OD[i+1]) - ln(OD[i])) / (t[i+1] - t[i]).',
        'Doubling time: ln(2) / mu, evaluated at that maximum growth rate.',
        'Lag time: the first time OD reaches at least 2x the baseline (the minimum of the first few points). A coarse heuristic, not a tangent-intercept lag.',
        'AUC: trapezoid-rule area under the OD-vs-time curve (OD*hours).',
      ] },
      { kind: 'steps', items: [
        'Click any OD600 sparkline to open the growth-curve popup.',
        'Use Linear for raw OD shape and Log (ln OD) so exponential phase reads as a straight line.',
        'Hover the curve to read exact time and OD600 values; the steepest interval that produced mu is highlighted.',
        'Use the right-hand peer sidebar to overlay samples from the same group, scrolling without losing the chart.',
      ] },
      { kind: 'note', text: 'If the popup reports the numeric OD600 series was not found in this snapshot, do not infer a growth rate from any other table. Report it as not found.' },
    ],
  },
  {
    id: 'export',
    title: 'Exporting figures and data',
    icon: <Download className="w-4 h-4" />,
    summary: 'Every visualization exports through a PNG preview/editor modal; CSV remains separate for quantitative values.',
    blocks: [
      { kind: 'p', text: 'Each visualization has an Export figure button that opens a PNG preview/editor modal. Adjust the title, subtitle, axis titles, legend title, size, colors, and caption before downloading. Major charts render from data-backed figure specs rather than screen captures, so labels and colors are publication ready in static and server modes. Use CSV (separate button) whenever you will make a quantitative claim.' },
      { kind: 'bullets', items: [
        'PNG: a high-resolution bitmap for slides, manuscripts, email, and quick sharing.',
        'Data-rendered specs: mutation heatmaps, growth curves, copy-number trajectories, VerA / VerB pairing, barcode stacked bars, barcode heatmaps, and growth comparison panels are rebuilt from the active data state for export.',
        'Fallback exports: views that have not been migrated yet still use the same PNG modal with the current DOM exporter.',
      ] },
      { kind: 'note', text: 'Set filters, isolate a lineage, or pick Reads vs Fraction first, then export. Data-rendered exports summarize the active chart state, selected samples, selected candidates, and transfer filters.' },
      { kind: 'rule', title: 'Caption template', text: 'AI-ALE LIMS viewer visualization exported from the read-only LIMS mirror snapshot. Samples were filtered by [experiment/condition/strain/donor DNA/replicate]. Barcode labels are A#-B# VerA/VerB combinations. Frequency heatmap colors use a fixed 0% to 100% scale; copy-number rows use a row-local min/max scale. Growth metrics, when shown, are descriptive estimates from observed OD600 points and are not fitted kinetic-model parameters.' },
    ],
  },
  {
    id: 'derived',
    title: 'Derived vs raw: what is real',
    icon: <ShieldCheck className="w-4 h-4" />,
    summary: 'Every number is either stored in the DB or computed transparently. Nothing is invented.',
    blocks: [
      { kind: 'p', text: 'Wherever a value is computed rather than stored, the viewer marks it with an info (i) button that explains the derivation. The guiding rule: show only what is in the database or what is computed openly from database values.' },
      { kind: 'bullets', items: [
        'Raw (stored): mutation frequency, copy number, OD600 readings, barcode read counts, sample metadata.',
        'Derived (computed, labeled): growth metrics (mu, doubling, lag, AUC, K), heatmap color scaling, VerA/VerB aggregations, candidate fractions, common Y-axis maxima.',
        'Never invented: if a numeric series, registry, or value is absent, the viewer says it is absent rather than guessing.',
      ] },
      { kind: 'note', text: 'A PDF screenshot of a growth-curve report is NOT a data source. Recreate the curve from the database-backed growth popup instead, and cite the snapshot.' },
    ],
  },
  {
    id: 'manuscript',
    title: 'Writing this into a manuscript',
    icon: <FileText className="w-4 h-4" />,
    summary: 'Ready-to-adapt methods, results, and figure-legend language plus a pre-share checklist.',
    blocks: [
      { kind: 'rule', title: 'Methods paragraph', text: 'A read-only AI-ALE LIMS viewer was used to inspect mutation calls, copy-number estimates, OD600 growth curves, and VerA/VerB barcode-composition trajectories from a LIMS mirror snapshot. Exported figures preserve the active filters and chart state. Growth-curve summaries are descriptive point-to-point estimates from observed OD600 readings, not fitted growth-model parameters.' },
      { kind: 'rule', title: 'Results paragraph (VerA/VerB)', text: 'VerA/VerB barcode composition was examined by tracking A#-B# candidate combinations across transfers and by aggregating reads by VerA or VerB subunit. Side-by-side views used a shared read-count axis; fraction mode used a common 0% to 100% axis. Candidate selection and subunit grouping followed individual combinations and all combinations sharing a subunit across samples.' },
      { kind: 'rule', title: 'Figure legend', text: 'Barcode-composition view showing VerA/VerB candidate trajectories. Each A#-B# label denotes one VerA and one VerB subunit. Split views summarize the same reads as full A-B combinations, VerA-grouped totals, and VerB-grouped totals. Colors are stable per candidate or subunit.' },
      { kind: 'p', text: 'Before sharing a figure, confirm: the snapshot date is recorded; the filters and selected samples are recorded; the frequency vs copy-number color rules are stated; VerA/VerB is spelled exactly; growth metrics are described as descriptive estimates; any missing series is reported as not found; and quantitative claims ship with the CSV.' },
    ],
  },
  {
    id: 'glossary',
    title: 'Glossary',
    icon: <BookOpen className="w-4 h-4" />,
    summary: 'Plain definitions of the terms and abbreviations used throughout the viewer.',
    blocks: [
      { kind: 'bullets', items: [
        'ALE — adaptive laboratory evolution: serially passaging a population under selection so beneficial mutations accumulate.',
        'Transfer — one serial-passage cycle. The X axis of the copy-number and barcode charts.',
        'dgoA* — the engineered aldolase locus whose copy-number amplification is the central adaptive signal in this study.',
        'Copy number (CN) — gene dosage, estimated as mean read depth over a region divided by mean whole-genome depth. CN = 1 is the baseline; CN = 2-3 is amplification.',
        'Frequency — the fraction of the population carrying a mutation (0 to 1, shown as 0% to 100%).',
        'Provided mutation — a mutation supplied as donor DNA in the growth condition (outlined amber). Spontaneous — a mutation that arose during evolution (no outline).',
        'NG — no growth: a replicate that did not establish growth. NS — not sequenced: a timepoint with no sequencing. Neither is a zero.',
        'VerA / VerB — the two barcode subunits; an A#-B# label is one VerA paired with one VerB. VerB modulates VerA, and the pairing governs substrate specificity.',
        'breseq registry — one breseq variant-calling run; the same dataset can hold calls from multiple runs against different references.',
      ] },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Tips and shortcuts',
    icon: <MousePointerClick className="w-4 h-4" />,
    summary: 'Small things that make the viewer faster to use.',
    blocks: [
      { kind: 'bullets', items: [
        'Press Esc to close any popup or modal.',
        'In the Copy Number and Barcode legends, use the search box to jump to a lineage or candidate instead of scrolling.',
        'Click a legend entry to isolate it; click again to release.',
        'Collapse the left sidebar (chevron at the top) to give charts more width; the Help, Guide, and Changelog buttons stay reachable as icons.',
        'Every chart toolbar has an Export figure PNG preview button and, where applicable, a separate CSV button.',
      ] },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: <ShieldCheck className="w-4 h-4" />,
    summary: 'What to check when something looks off.',
    blocks: [
      { kind: 'bullets', items: [
        'A view is empty: make sure you selected samples in Sample Selection first; the other tabs act on your selection.',
        'The Barcode tab is missing: this snapshot has no barcode data (e.g. the public TFMN1 publication snapshot). That is expected, not a bug.',
        'A growth popup says "not found": there is no numeric OD600 series for that sample/transfer in this snapshot. Do not infer a rate from elsewhere.',
        'A heatmap cell is blank: the timepoint may be NS (not sequenced) or the value genuinely absent. Treat it as unknown, not zero.',
        'Colors look different between a legend swatch and a bar: only when you change color mode mid-comparison; the legend and bars both follow the active mode and will agree.',
        'An export looks low-resolution: open Export figure, increase the preview width or height, then download the PNG again.',
      ] },
      { kind: 'note', text: 'If a value looks scientifically wrong (not just a display quirk), check the raw row in Database Tables, or flag it: the viewer reports the database faithfully, so a wrong number usually means an upstream data issue.' },
    ],
  },
];

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[var(--accent-100)] text-[var(--text)] rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function BlockView({ block, q }: { block: Block; q: string }) {
  switch (block.kind) {
    case 'p':
      return <p className="text-[var(--text-soft)]">{highlight(block.text, q)}</p>;
    case 'steps':
      return (
        <ol className="space-y-1.5">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[var(--accent-50)] text-[var(--accent-700)] text-[11px] font-semibold flex items-center justify-center tabular-nums">{i + 1}</span>
              <span className="text-[var(--text-soft)]">{highlight(it, q)}</span>
            </li>
          ))}
        </ol>
      );
    case 'bullets':
      return (
        <ul className="list-disc pl-5 space-y-1 text-[var(--text-soft)]">
          {block.items.map((it, i) => <li key={i}>{highlight(it, q)}</li>)}
        </ul>
      );
    case 'rule':
      return (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--text)] mb-1"><Info className="w-3.5 h-3.5 text-[var(--accent-600)]" />{highlight(block.title, q)}</div>
          <div className="text-[var(--text-soft)]">{highlight(block.text, q)}</div>
        </div>
      );
    case 'note':
      return <div className="rounded-md border-l-2 border-[var(--accent-400)] bg-[var(--accent-50)] px-3 py-2 text-[var(--text-soft)]">{highlight(block.text, q)}</div>;
    case 'code':
      return <pre className="font-mono text-[11.5px] bg-[var(--surface-2)] border border-[var(--border)] rounded p-3 text-[var(--text-soft)] whitespace-pre-wrap">{block.text}</pre>;
  }
}

function sectionMatches(s: Section, q: string): boolean {
  if (!q) return true;
  const hay = (s.title + ' ' + s.summary + ' ' + s.blocks.map(b => {
    if (b.kind === 'p' || b.kind === 'note' || b.kind === 'code') return b.text;
    if (b.kind === 'rule') return b.title + ' ' + b.text;
    return b.items.join(' ');
  }).join(' ')).toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function HelpCenter({
  onClose, onGuide, guideUrl, embedded = false,
}: {
  onClose?: () => void;
  onGuide: () => void;
  guideUrl: string;
  embedded?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(() => SECTIONS.filter(s => sectionMatches(s, query)), [query]);

  const jump = (id: string) => {
    setActive(id);
    const el = sectionRefs.current[id];
    if (el && bodyRef.current) {
      bodyRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    }
  };

  const panel = (
    <div className={embedded
      ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-xl h-full flex flex-col overflow-hidden"
      : "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden"}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-3 shrink-0">
          <BookOpen className="w-5 h-5 text-[var(--accent-600)]" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold leading-none">Help & Researcher Guide</h2>
            <p className="text-[11.5px] text-[var(--text-soft)] mt-1">Practical, biologist-friendly documentation for every view, with color rules, data provenance, export, and manuscript wording.</p>
          </div>
          <button onClick={onGuide} className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium border border-[var(--border)] hover:bg-[var(--surface-3)]">
            <Compass className="w-4 h-4 text-[var(--accent-600)]" /> Open Guide
          </button>
          {!embedded && onClose && (
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-3)]" title="Close (Esc)"><X className="w-5 h-5" /></button>
          )}
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* TOC + search */}
          <aside className="w-64 shrink-0 border-r border-[var(--border)] flex flex-col min-h-0 bg-[var(--surface-2)]">
            <div className="p-3 border-b border-[var(--border)]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search the guide..."
                  className="w-full pl-8 pr-2 py-1.5 text-[12px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent-400)]"
                />
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {visible.map(s => (
                <button
                  key={s.id}
                  onClick={() => jump(s.id)}
                  data-active={active === s.id}
                  className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left text-[12px] hover:bg-[var(--surface-3)] data-[active=true]:bg-[var(--accent-50)] data-[active=true]:text-[var(--accent-700)]"
                >
                  <span className="mt-0.5 text-[var(--accent-600)]">{s.icon}</span>
                  <span className="min-w-0 flex-1 font-medium">{s.title}</span>
                  <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-[var(--text-faint)]" />
                </button>
              ))}
              {visible.length === 0 && (
                <div className="px-2 py-4 text-[12px] text-[var(--text-soft)]">No section matches “{query}”.</div>
              )}
            </nav>
            {guideUrl && (
              <a href={guideUrl} target="_blank" rel="noreferrer" className="m-2 text-center text-[11px] px-2 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface-3)] text-[var(--text-soft)]">
                Open full markdown guide
              </a>
            )}
          </aside>

          {/* Content */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-8 text-[12.5px] leading-relaxed scroll-smooth">
            {visible.map(s => (
              <section
                key={s.id}
                id={s.id}
                ref={(el) => { sectionRefs.current[s.id] = el; }}
                className="scroll-mt-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[var(--accent-600)]">{s.icon}</span>
                  <h3 className="text-[15px] font-semibold text-[var(--text)]">{highlight(s.title, query)}</h3>
                </div>
                <p className="text-[12px] text-[var(--text-faint)] mb-3">{highlight(s.summary, query)}</p>
                <div className="space-y-3">
                  {s.blocks.map((b, i) => <BlockView key={i} block={b} q={query} />)}
                </div>
              </section>
            ))}
            {visible.length === 0 && (
              <div className="text-[var(--text-soft)]">Nothing matches your search. Clear it to see the full guide.</div>
            )}
            <div className="pt-4 border-t border-[var(--border)] flex flex-wrap gap-2">
              <button onClick={onGuide} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--border)] hover:bg-[var(--surface-3)]">
                <Compass className="w-4 h-4 text-[var(--accent-600)]" /> Open the Guide (how-do-I + prompt builder)
              </button>
            </div>
          </div>
        </div>
      </div>
  );

  if (embedded) return panel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
      {panel}
    </div>
  );
}
