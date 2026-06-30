'use client';

import React, { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, PlayCircle, CheckCircle2 } from 'lucide-react';

/* ---------------------------------------------------------------------------
   Tutorial: a real, click-through guided tour.

   Each step targets a live DOM element by a data-tour attribute. The tour dims
   the page, cuts a spotlight hole around the target, and floats a tooltip next
   to it pointing at exactly what to click. Steps can run a small action (switch
   tab, open a panel) before showing, so the walkthrough mirrors how a person
   actually navigates the app: open Mutation Explorer, look at Sample Selection,
   open Comparative View, read the color rule, open Barcode Charts, etc.

   If a step's target is not on screen (e.g. a tab that has not been opened),
   the tooltip falls back to screen-center and still explains the step, so the
   tour never dead-ends.
--------------------------------------------------------------------------- */

export type TourStep = {
  target?: string;            // data-tour value to spotlight (omit = centered card)
  title: string;
  body: string;
  // Optional side-effect to run before the step renders (navigate/setup).
  before?: () => void;
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
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
  steps, onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[Math.max(0, Math.min(i, steps.length - 1))];

  const measure = useCallback(() => {
    if (!step?.target) { setRect(null); return; }
    // Retry a couple of times: the element may appear after a before() effect.
    let tries = 0;
    const tick = () => {
      const r = getRect(step.target!);
      if (r) { setRect(r); return; }
      if (tries++ < 8) requestAnimationFrame(tick);
      else setRect(null);
    };
    tick();
  }, [step]);

  // Run the step's setup, then scroll the target into view and measure.
  useLayoutEffect(() => {
    step?.before?.();
    const el = step?.target ? document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null : null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(measure, 120);
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
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, onClose, steps.length]);

  const isLast = i >= steps.length - 1;
  const pad = 6;

  // Tooltip position: beside the spotlight, flipped to stay on screen.
  let tipStyle: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    const spaceRight = window.innerWidth - (rect.left + rect.width);
    const tipW = 340;
    if (spaceBelow > 220) {
      tipStyle = { top: rect.top + rect.height + pad + 8, left: Math.min(Math.max(8, rect.left), window.innerWidth - tipW - 8) };
    } else if (rect.top > 240) {
      tipStyle = { top: Math.max(8, rect.top - 8), left: Math.min(Math.max(8, rect.left), window.innerWidth - tipW - 8), transform: 'translateY(-100%)' };
    } else if (spaceRight > tipW + 16) {
      tipStyle = { top: Math.max(8, rect.top), left: rect.left + rect.width + pad + 8 };
    } else {
      tipStyle = { top: Math.max(8, rect.top), left: Math.max(8, rect.left - tipW - pad - 8) };
    }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      {/* Dimmed backdrop with a spotlight cutout (via a big box-shadow ring). */}
      {rect ? (
        <div
          className="absolute rounded-lg pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - pad, left: rect.left - pad,
            width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(15,23,42,0.62)',
            outline: '2px solid var(--accent-400)',
            outlineOffset: '2px',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      {/* Tooltip card */}
      <div
        className="absolute w-[340px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl p-4"
        style={tipStyle}
      >
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 w-7 h-7 rounded-full bg-[var(--accent-600)] text-white flex items-center justify-center text-[12px] font-semibold tabular-nums">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold leading-snug">{step.title}</h3>
            <p className="text-[12px] text-[var(--text-soft)] mt-1 leading-relaxed">{step.body}</p>
          </div>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-[var(--surface-3)]" title="Exit tour (Esc)"><X className="w-4 h-4" /></button>
        </div>

        <div className="mt-3 flex items-center gap-1">
          {steps.map((_, idx) => (
            <span key={idx} className={idx === i ? 'h-1.5 w-4 rounded-full bg-[var(--accent-600)]' : 'h-1.5 w-1.5 rounded-full bg-[var(--border-strong)]'} />
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
          <button onClick={onClose} className="ml-auto text-[11.5px] text-[var(--text-soft)] hover:text-[var(--text)]">Exit tour</button>
        </div>
        <p className="mt-2 text-[10.5px] text-[var(--text-faint)] flex items-center gap-1">
          <PlayCircle className="w-3 h-3" /> Use the arrow keys to move. The highlight points at exactly what to click.
        </p>
      </div>
    </div>
  );
}
