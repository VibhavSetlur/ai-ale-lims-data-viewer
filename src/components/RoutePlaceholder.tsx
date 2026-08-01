'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ExternalLink } from 'lucide-react';

interface RoutePlaceholderProps {
  icon: LucideIcon;
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
  externalHref?: string;
  externalLabel?: string;
}

// Shared "not available yet" shell for dynamic routes that name a requested ID
// but have no backing server record (workspaces, issues). Never fetches or
// fabricates data for the ID; only echoes it back as text.
export default function RoutePlaceholder({
  icon: Icon,
  title,
  message,
  backHref,
  backLabel,
  externalHref,
  externalLabel,
}: RoutePlaceholderProps) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full bg-[var(--surface)] rounded-lg border border-[var(--border)] text-[var(--text-soft)] text-sm gap-2 p-6 text-center"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <Icon className="w-10 h-10 text-[var(--ink-300)]" />
      <h1 className="text-lg font-semibold text-[var(--text)]">{title}</h1>
      <p className="max-w-md">{message}</p>
      <div className="flex items-center gap-3 mt-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {backLabel}
        </Link>
        {externalHref && externalLabel && (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            {externalLabel}
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
