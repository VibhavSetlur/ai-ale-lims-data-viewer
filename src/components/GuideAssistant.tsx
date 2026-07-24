'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Search, Compass, ArrowRight, Copy, Check, Download, ExternalLink,
  MousePointerClick, Layers, TrendingUp, BarChart3, FlaskConical, Download as DownloadIcon,
} from 'lucide-react';

/* ---------------------------------------------------------------------------
   GuideAssistant: a context-aware, rule-based in-app helper.

   This is NOT an AI chatbot (the static deployment has no backend / LLM). It is
   a practical "how do I..." guide that actually DOES things: each answer can
   navigate the user to the right view. Think of it as a smart table of contents
   that drives the app for you.

   A secondary tab builds a copy-paste prompt for the user's OWN institution
   approved assistant (clearly labelled as an external tool, not "the app's AI").
--------------------------------------------------------------------------- */

export type GuideAction = { kind: 'navigate'; view?: 'mutations' | 'tables'; tab?: 'samples' | 'compare' | 'copynumber'; tour?: string };

export type GuideContext = {
  view: string;
  experiment?: string;
  selectedSampleCount?: number;
  sampleNames?: string[];
  barcodeColorMode?: string;
  hasBarcodes?: boolean;
  notes?: string[];
};

type Answer = {
  id: string;
  q: string;            // the "how do I" question
  icon: React.ReactNode;
  steps: string[];
  takeMeThere?: { label: string; action: GuideAction };
  keywords?: string;
};

const ANSWERS: Answer[] = [
  {
    id: 'find-dgoa',
    q: 'How do I see the dgoA* copy-number amplification (the main finding)?',
    icon: <TrendingUp className="w-4 h-4" />,
    steps: [
      'Open the Copy Number tab.',
      'Each line is one lineage; copy number is on the Y axis, transfer on the X axis.',
      'Look for lines climbing above the CN = 1x baseline toward 2-3x (and higher in outlier lineages).',
      'Click a legend entry to isolate one lineage and read its trajectory cleanly.',
      'Use the legend search to jump to a specific lineage or background.',
    ],
    takeMeThere: { label: 'Open Copy Number', action: { kind: 'navigate', view: 'mutations', tab: 'copynumber', tour: 'tab-copynumber' } },
    keywords: 'dgoa amplification copy number gene dosage convergent',
  },
  {
    id: 'pick-samples',
    q: 'How do I choose which samples / lineages to look at?',
    icon: <MousePointerClick className="w-4 h-4" />,
    steps: [
      'Open Sample Selection.',
      'Filter by experiment (e.g. a genotype background like fba or tpiA+pgi), strain, condition, donor DNA, replicate, or transfer.',
      'Tick the samples you want; the filters cross-narrow so impossible combinations are hidden.',
      'Then open Comparative View or Copy Number to analyze just those samples.',
    ],
    takeMeThere: { label: 'Open Sample Selection', action: { kind: 'navigate', view: 'mutations', tab: 'samples', tour: 'tab-samples' } },
    keywords: 'select filter lineage replicate background condition experiment',
  },
  {
    id: 'mutation-heatmap',
    q: 'How do I compare mutation frequencies across samples?',
    icon: <Layers className="w-4 h-4" />,
    steps: [
      'Select samples, then open Comparative View.',
      'Rows are mutations and copy-number regions; columns are your samples; color is the value.',
      'Frequency colors use a FIXED 0% to 100% scale; copy-number rows use a row-local min/max scale.',
      'Click a mutation name for genome context; click the mutation-class pills to focus on missense, nonsense, indel, or deletion.',
    ],
    takeMeThere: { label: 'Open Comparative View', action: { kind: 'navigate', view: 'mutations', tab: 'compare', tour: 'tab-compare' } },
    keywords: 'heatmap frequency mutation comparative grid color scale',
  },
  {
    id: 'provided',
    q: 'How do I tell provided (donor DNA) mutations from spontaneous ones?',
    icon: <Layers className="w-4 h-4" />,
    steps: [
      'In Comparative View, a mutation supplied as donor DNA has an amber outline over its frequency color.',
      'An amber outline with no fill and a 0% marker = provided in donor DNA but never observed (e.g. pgi/sohB that did not integrate).',
      'A mutation that arose during evolution (no outline) is spontaneous (e.g. secondary fba alleles, or fba arising in a tpiA background).',
      'Open a mutation detail popup to see exactly which samples provided it.',
    ],
    takeMeThere: { label: 'Open Comparative View', action: { kind: 'navigate', view: 'mutations', tab: 'compare', tour: 'tab-compare' } },
    keywords: 'provided spontaneous donor dna integration secondary fba outline amber',
  },
  {
    id: 'growth',
    q: 'How do I read a growth curve and where do the numbers come from?',
    icon: <FlaskConical className="w-4 h-4" />,
    steps: [
      'Click any OD600 sparkline (in Sample Selection or Comparative View) to open the full growth-curve popup.',
      'Toggle Log (ln OD) so exponential phase reads as a straight line.',
      'Metrics (max OD/K, mu, doubling, lag, AUC) are DESCRIPTIVE point-to-point estimates from the observed OD600 points, not model fits.',
      'If a sample has no numeric series, the popup says so; it never invents a curve.',
    ],
    takeMeThere: { label: 'Open Sample Selection', action: { kind: 'navigate', view: 'mutations', tab: 'samples', tour: 'tab-samples' } },
    keywords: 'growth curve od600 rate doubling mu lag auc robotic_od computed',
  },

  {
    id: 'export',
    q: 'How do I export a figure for a slide or manuscript?',
    icon: <DownloadIcon className="w-4 h-4" />,
    steps: [
      'Every visualization has an Export figure button (top right of the chart toolbar).',
      'Use the preview/editor modal to adjust labels, size, colors, and caption, then download PNG.',
      'Use the separate CSV button whenever you will make a quantitative claim.',
      'Record the snapshot date and your filters in the figure caption.',
    ],
    keywords: 'export figure png svg pdf print csv manuscript slide download',
  },
  {
    id: 'tables',
    q: 'How do I look at the raw database tables?',
    icon: <Search className="w-4 h-4" />,
    steps: [
      'Switch to Database Tables in the sidebar (available in the interactive/server build).',
      'Pick a table, then search, sort, filter, and paginate; soft-deleted rows are hidden by default.',
      'Export the filtered table as CSV to audit provenance.',
    ],
    takeMeThere: { label: 'Open Database Tables', action: { kind: 'navigate', view: 'tables' } },
    keywords: 'raw tables database browse sql audit provenance csv',
  },
];

/* --------------------------------------------------- external prompt tab --- */

const TASKS: { id: string; label: string; instruction: string }[] = [
  { id: 'interpret', label: 'Interpret an export', instruction: 'Help me interpret the attached AI-ALE LIMS viewer export. List only what is directly observable, then separately list hypotheses that would require experimental validation.' },
  { id: 'caption', label: 'Draft a figure caption', instruction: 'Draft a manuscript-quality figure caption for the attached export. State the filters/selection, the color-scale rules, and data provenance. Keep it factual.' },
  { id: 'methods', label: 'Methods paragraph', instruction: 'Write a short methods paragraph describing how these figures were produced with the read-only AI-ALE LIMS viewer over a LIMS mirror snapshot.' },
  { id: 'plan', label: 'Plan a follow-up', instruction: 'Suggest a rigorous follow-up analysis or experiment based on what the attached export shows, distinguishing what the data already supports from what it cannot.' },
];

function buildPrompt(ctx: GuideContext, instruction: string, extra: string): string {
  const L: string[] = [];
  L.push('You are helping a microbiology researcher analyze exports from the read-only AI-ALE LIMS viewer (adaptive laboratory evolution of Acinetobacter baylyi ADP1 on pyruvate).');
  L.push('');
  L.push('GROUND RULES (do not violate):');
  L.push('- dgoA* copy-number amplification is a convergent, genotype-independent adaptive signal that correlates with improved prototrophic growth; treat it as a key readout.');
  L.push('- A "provided" mutation was supplied as donor DNA; a 0% provided mutation was in the donor DNA but never observed. Other mutations are spontaneous (e.g. secondary fba alleles).');
  L.push('- NG means a lineage did not grow; NS means a timepoint was not sequenced. These are not zeros.');
  L.push('- Mutation-frequency heatmap colors use a FIXED 0% to 100% scale; copy-number rows use a row-local min/max scale.');
  L.push('- Growth metrics (max OD/K, mu, doubling, lag, AUC) are DESCRIPTIVE point-to-point estimates from observed OD600 readings, NOT fitted kinetic models.');
  L.push('- Barcode labels A#-B# are VerA/VerB combinations (write VerA/VerB, never VarA/VarB). VerB modulates VerA and the pairing governs substrate specificity; composition suggests but does not prove mechanism.');
  L.push('- Every value is stored in the database or transparently computed from it. Never invent values; if something is reported not found, say not found.');
  L.push('- Separate direct observations from hypotheses that require experimental validation.');
  L.push('');
  L.push('CURRENT CONTEXT:');
  L.push(`- Active view: ${ctx.view}`);
  if (ctx.experiment) L.push(`- Experiment filter: ${ctx.experiment}`);
  if (typeof ctx.selectedSampleCount === 'number') L.push(`- Selected samples: ${ctx.selectedSampleCount}`);
  if (ctx.sampleNames?.length) {
    const shown = ctx.sampleNames.slice(0, 25);
    L.push(`- Sample names${ctx.sampleNames.length > shown.length ? ` (first ${shown.length} of ${ctx.sampleNames.length})` : ''}: ${shown.join(', ')}`);
  }
  if (ctx.barcodeColorMode) L.push(`- Barcode color mode: ${ctx.barcodeColorMode}`);
  (ctx.notes || []).forEach(n => L.push(`- ${n}`));
  L.push('');
  L.push('TASK:');
  L.push(instruction);
  if (extra.trim()) { L.push(''); L.push('ADDITIONAL REQUEST FROM ME:'); L.push(extra.trim()); }
  L.push('');
  L.push('I will paste or attach the exported CSV/figure separately. Ask for it if missing before drawing conclusions.');
  return L.join('\n');
}

export default function GuideAssistant({
  ctx, onClose, onAction,
}: {
  ctx: GuideContext;
  onClose: () => void;
  onAction: (a: GuideAction) => void;
}) {
  const [mode, setMode] = useState<'guide' | 'prompt'>('guide');
  const [query, setQuery] = useState('');
  const [taskId, setTaskId] = useState(TASKS[0].id);
  const [extra, setExtra] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const answers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = ANSWERS;
    if (!ctx.hasBarcodes) list = list.filter(a => a.id !== 'barcodes');
    if (!q) return list;
    return list.filter(a => (a.q + ' ' + a.steps.join(' ') + ' ' + (a.keywords || '')).toLowerCase().includes(q));
  }, [query, ctx.hasBarcodes]);

  const task = TASKS.find(t => t.id === taskId) || TASKS[0];
  const prompt = useMemo(() => buildPrompt(ctx, task.instruction, extra), [ctx, task, extra]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { (document.getElementById('guide-prompt') as HTMLTextAreaElement | null)?.select(); }
  };
  const download = () => {
    const blob = new Blob([prompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'aiale-ai-prompt.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-start gap-3">
          <Compass className="w-5 h-5 text-[var(--accent-600)] mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-none">Guide</h2>
            <p className="text-[11.5px] text-[var(--text-soft)] mt-1.5 leading-relaxed">Ask &ldquo;how do I...&rdquo; and the guide walks you to the right view and shows where to click. It can also prepare a prompt for your own approved assistant.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-3)]" title="Close (Esc)"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 pt-3 flex gap-1 border-b border-[var(--border)]">
          <button onClick={() => setMode('guide')} data-active={mode === 'guide'} className="px-3 py-1.5 text-[12px] font-medium rounded-t-md border-b-2 border-transparent data-[active=true]:border-[var(--accent-600)] data-[active=true]:text-[var(--accent-700)] text-[var(--text-soft)]">How do I...</button>
          <button onClick={() => setMode('prompt')} data-active={mode === 'prompt'} className="px-3 py-1.5 text-[12px] font-medium rounded-t-md border-b-2 border-transparent data-[active=true]:border-[var(--accent-600)] data-[active=true]:text-[var(--accent-700)] text-[var(--text-soft)]">Prompt for your assistant</button>
        </div>

        {mode === 'guide' ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks, e.g. copy number, export, growth..." className="w-full pl-8 pr-2 py-2 text-[12px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] focus:outline-none focus:border-[var(--accent-400)]" />
            </div>
            {answers.map(a => (
              <div key={a.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-2 font-medium text-[13px] text-[var(--text)]">
                  <span className="text-[var(--accent-600)]">{a.icon}</span>{a.q}
                </div>
                <ol className="mt-2 space-y-1">
                  {a.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[12px] text-[var(--text-soft)]">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--accent-50)] text-[var(--accent-700)] text-[10px] font-semibold flex items-center justify-center tabular-nums">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {a.takeMeThere && (
                    <button
                      onClick={() => { onAction(a.takeMeThere!.action); onClose(); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-[var(--accent-600)] text-white hover:opacity-90"
                    >
                      {a.takeMeThere.label} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {answers.length === 0 && <div className="text-[12px] text-[var(--text-soft)] px-1 py-4">No task matches &ldquo;{query}&rdquo;. Try a different word, or open the full Help guide.</div>}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <p className="text-[12px] text-[var(--text-soft)] leading-relaxed">This deployment has no built-in chatbot. This builds a guarded prompt (your current context plus the viewer&apos;s interpretation rules) to paste into your university or Argonne approved assistant alongside an exported CSV or figure.</p>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1.5">What do you want help with?</div>
              <div className="flex flex-wrap gap-1.5">
                {TASKS.map(t => (
                  <button key={t.id} onClick={() => setTaskId(t.id)} data-active={taskId === t.id} className="px-2.5 py-1 rounded-full text-[11.5px] border border-[var(--border)] hover:bg-[var(--surface-3)] data-[active=true]:bg-[var(--accent-600)] data-[active=true]:text-white data-[active=true]:border-[var(--accent-600)]">{t.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1.5 block">Anything specific to add? (optional)</label>
              <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2} placeholder="e.g. focus on transfers 1 to 10; compare fba vs tpiA backgrounds" className="w-full px-3 py-2 text-[12px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] focus:outline-none focus:border-[var(--accent-400)] resize-none" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Generated prompt</div>
                <div className="flex gap-1.5">
                  <button onClick={copy} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-[var(--accent-600)] text-white hover:opacity-90">{copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}</button>
                  <button onClick={download} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-[var(--border)] hover:bg-[var(--surface-3)]"><Download className="w-3 h-3" /> .txt</button>
                </div>
              </div>
              <textarea id="guide-prompt" readOnly value={prompt} rows={13} className="w-full px-3 py-2 text-[11.5px] font-mono leading-relaxed rounded-md border border-[var(--border)] bg-[var(--surface-2)] focus:outline-none" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => window.open('https://chat.openai.com/', '_blank', 'noopener')} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] border border-[var(--border)] hover:bg-[var(--surface-3)]"><ExternalLink className="w-3 h-3" /> ChatGPT</button>
              <button onClick={() => window.open('https://claude.ai/', '_blank', 'noopener')} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] border border-[var(--border)] hover:bg-[var(--surface-3)]"><ExternalLink className="w-3 h-3" /> Claude</button>
              <button onClick={() => window.open('https://gemini.google.com/', '_blank', 'noopener')} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] border border-[var(--border)] hover:bg-[var(--surface-3)]"><ExternalLink className="w-3 h-3" /> Gemini</button>
            </div>
            <p className="text-[10.5px] text-[var(--text-faint)] leading-snug">Use only an institution-approved assistant. Do not paste credentials, private database paths, or unpublished data into a public tool.</p>
          </div>
        )}
      </div>
    </div>
  );
}
