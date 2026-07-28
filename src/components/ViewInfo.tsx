'use client';

import { useState } from 'react';

export default function ViewInfo({ title, description, detail }: { title: string; description: string; detail?: string }) {
  const [open, setOpen] = useState(false);
  return <div className="min-w-0"><h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2><p className="mt-1 text-[12px] leading-relaxed text-[var(--text-soft)]">{description}{detail && <button type="button" aria-expanded={open} className="ml-1 underline" onClick={() => setOpen(v => !v)}>{open ? 'Less' : 'More'}</button>}</p>{open && detail && <p className="mt-1 text-[11px] text-[var(--text-faint)]">{detail}</p>}</div>;
}
