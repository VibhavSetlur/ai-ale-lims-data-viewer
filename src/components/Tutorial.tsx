'use client';

import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, PlayCircle, CheckCircle2, MousePointerClick, Hand, Eye } from 'lucide-react';

/* ---------------------------------------------------------------------------
   Tutorial: a deep, genuinely interactive click-through tour.

   Each step spotlights a live DOM element by a data-tour attribute. Unlike a
   passive overlay, the spotlight is a real hole punched through the dim layer
   with FOUR rectangles (top/bottom/left/right of the target), so the highlighted
   element stays fully clickable -- the user can actually try the control, type in
   the box, open the menu, etc., and then press Next.

   Step content is structured (what it is / what to look for / try this) so a
   newcomer who has never seen the app understands not just where to click but
   what they are looking at and why it matters. Exit is always one click away.

   If a step's target is missing (e.g. a tab not yet rendered), the card falls
   back to screen-center and still explains the step, so the tour never dead-ends.
--------------------------------------------------------------------------- */

export type TourStep = {
  target?: string;            // data-tour value to spotlight (omit = centered card)
  title: string;
  body: string;               // the main explanation
  look?: string;              // "what to look for" — what's visible / what it means
  tryIt?: string;             // "try this" — an action the user can perform now (target stays clickable)
  before?: () => void;        // side-effect to run before the step renders (navigate/setup)
};

type Rect = { top: number; left: number; width: number; height: number };

function getRect(selector: string): Rect | null {
  const el = document.querySelector(`[data-tour="${selector}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function Tutorial({
  steps, onClose, title = 'Guided tour',
}: {
  steps: TourStep[];
  onClose: () => void;
  title?: string;
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [minimized, setMinimized] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[Math.max(0, Math.min(i, steps.length - 1))];
  const isLast = i >= steps.length - 1;

  const measure = useCallback(() => {
    if (!step?.target) { setRect(null); return; }
    let tries = 0;
    const tick = () => {
      const r = getRect(step.target!);
      if (r) { setRect(r); return; }
      if (tries++ < 10) requestAnimationFrame(tick);
      else setRect(null);
    };
    tick();
  }, [step]);

  // Run the step's setup, then scroll the target into view and measure.
  useLayoutEffect(() => {
    step?.before?.();
    const el = step?.target ? document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null : null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(measure, 160);
    return () => clearTimeout(t);
  }, [i, step, measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI(s => Math.min(s + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setI(s => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const iv = setInterval(measure, 600); // keep the hole aligned as the page settles
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearInterval(iv);
    };
  }, [measure, onClose, steps.length]);

  const pad = 6;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Card placement: beside the spotlight, flipped to stay on screen. When the
  // card would overlap the hole we keep it on the side with the most room.
  const cardW = 360;
  let cardStyle: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (rect && !minimized) {
    const spaceBelow = vh - (rect.top + rect.height);
    const spaceRight = vw - (rect.left + rect.width);
    if (spaceRight > cardW + 24) {
      cardStyle = { top: clamp(rect.top, 8, vh - 320), left: rect.left + rect.width + pad + 12 };
    } else if (rect.left > cardW + 24) {
      cardStyle = { top: clamp(rect.top, 8, vh - 320), left: rect.left - cardW - pad - 12 };
    } else if (spaceBelow > 300) {
      cardStyle = { top: rect.top + rect.height + pad + 10, left: clamp(rect.left, 8, vw - cardW - 8) };
    } else {
      cardStyle = { top: clamp(rect.top - 320, 8, vh - 320), left: clamp(rect.left, 8, vw - cardW - 8) };
    }
  } else if (minimized) {
    cardStyle = { bottom: 16, right: 16, top: 'auto', left: 'auto' };
  }

  const hole = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;

  return (
    // Wrapper does NOT capture pointer events, so the spotlight hole is genuinely
    // click-through to the live page. Only the dim panels and the card opt back in.
    <div className="fixed inset-0 z-[60] pointer-events-none" role="dialog" aria-modal="false" aria-label={title}>
      {/* Dim layer = FOUR panels around the target. They DO capture clicks (so a
          stray click on the dimmed area does not leak to the page), but the gap
          between them is a real hole the user can click straight through. */}
      {hole ? (
        <>
          <div className="absolute bg-black/55 transition-all duration-150 pointer-events-auto" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className="absolute bg-black/55 transition-all duration-150 pointer-events-auto" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className="absolute bg-black/55 transition-all duration-150 pointer-events-auto" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="absolute bg-black/55 transition-all duration-150 pointer-events-auto" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {/* Ring around the live, clickable target (never blocks clicks) */}
          <div
            className="absolute rounded-lg pointer-events-none transition-all duration-150 animate-pulse"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, outline: '2.5px solid var(--accent-400)', outlineOffset: 0, boxShadow: '0 0 0 2px rgba(255,255,255,0.4), 0 0 24px 5px rgba(56,189,172,0.4)' }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/55 pointer-events-auto" />
      )}

      {/* Step card / explore pill */}
      {minimized ? (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-[var(--surface)] border border-[var(--accent-300)] shadow-2xl text-[12px]">
            <Hand className="w-4 h-4 text-[var(--accent-600)]" />
            <span className="text-[var(--text-soft)]">Exploring step {i + 1}. Click around the highlighted area.</span>
            <button onClick={() => setMinimized(false)} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--accent-600)] text-white font-medium hover:opacity-90">
              <PlayCircle className="w-3.5 h-3.5" /> Resume tutorial
            </button>
            <button onClick={onClose} className="p-0.5 rounded hover:bg-[var(--surface-3)] text-[var(--text-faint)]" title="Exit tutorial"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ) : (
        <div
          ref={cardRef}
          className="absolute rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl p-4 pointer-events-auto"
          style={{ width: cardW, maxWidth: '94vw', ...cardStyle }}
        >
          <div className="flex items-start gap-2.5">
            <span className="shrink-0 w-7 h-7 rounded-full bg-[var(--accent-600)] text-white flex items-center justify-center text-[12px] font-semibold tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{title}</div>
              <h3 className="text-[14.5px] font-semibold leading-snug mt-0.5">{step.title}</h3>
            </div>
            <button onClick={() => setMinimized(true)} className="p-0.5 rounded hover:bg-[var(--surface-3)] text-[var(--text-faint)]" title="Explore freely (hide this card)"><Eye className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-0.5 rounded hover:bg-[var(--surface-3)]" title="Exit tour (Esc)"><X className="w-4 h-4" /></button>
          </div>

          <p className="text-[12.5px] text-[var(--text-soft)] mt-2 leading-relaxed">{step.body}</p>

          {step.look && (
            <div className="mt-2.5 flex gap-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)] px-2.5 py-1.5">
              <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--accent-600)]" />
              <p className="text-[11.5px] text-[var(--text-soft)] leading-snug"><span className="font-semibold text-[var(--text)]">What to look for: </span>{step.look}</p>
            </div>
          )}
          {step.tryIt && (
            <div className="mt-2 rounded-md bg-[var(--accent-50)] border border-[var(--accent-200)] px-2.5 py-2">
              <div className="flex gap-2">
                <Hand className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--accent-700)]" />
                <p className="text-[11.5px] text-[var(--accent-800)] leading-snug"><span className="font-semibold">Try it: </span>{step.tryIt}</p>
              </div>
              <button
                onClick={() => setMinimized(true)}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-600)] text-white hover:opacity-90"
              >
                <MousePointerClick className="w-3.5 h-3.5" /> Try it now (explore)
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center gap-1">
            {steps.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                title={`Step ${idx + 1}`}
                className={idx === i ? 'h-1.5 w-5 rounded-full bg-[var(--accent-600)]' : 'h-1.5 w-1.5 rounded-full bg-[var(--border-strong)] hover:bg-[var(--accent-400)]'}
              />
            ))}
            <span className="ml-auto text-[11px] text-[var(--text-faint)] tabular-nums">{i + 1} / {steps.length}</span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setI(s => Math.max(s - 1, 0))}
              disabled={i === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] border border-[var(--border)] hover:bg-[var(--surface-3)] disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            {isLast ? (
              <button onClick={onClose} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--accent-600)] text-white hover:opacity-90">
                <CheckCircle2 className="w-4 h-4" /> Finish
              </button>
            ) : (
              <button onClick={() => setI(s => Math.min(s + 1, steps.length - 1))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--accent-600)] text-white hover:opacity-90">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="ml-auto flex items-center gap-1 text-[11.5px] text-[var(--text-soft)] hover:text-[var(--text)]" title="Exit the tutorial">
              <X className="w-3.5 h-3.5" /> Exit tutorial
            </button>
          </div>

          <p className="mt-2 text-[10.5px] text-[var(--text-faint)] flex items-center gap-1">
            <MousePointerClick className="w-3 h-3" /> The highlighted area is live, so click it any time. &quot;Try it now&quot; hides this card to explore, then Resume brings you right back here.
          </p>
        </div>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
