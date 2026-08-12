'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { BASE_PATH } from '../../lib/dataSource';
import { useOpsIdentity } from '../../lib/ops/useOpsIdentity';
import { LOGIN_PATH } from '../../lib/routes';

// Global header identity control. Renders nothing when the ops (MySQL-backed)
// auth surface is not configured on this instance, so it never appears on a
// static build or a server instance without either local email/password
// auth or ORCID configured.
export default function AuthControl() {
  const { state, orcid, email, displayName, signOut } = useOpsIdentity();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  if (state === 'unavailable') return null;

  if (state === 'loading') {
    return (
      <>
        <div className="h-5 w-px bg-[var(--border)] mx-0.5" />
        <div className="w-24 h-7 rounded-md bg-[var(--border)] animate-pulse" />
      </>
    );
  }

  if (state === 'signedOut') {
    const redirect = encodeURIComponent(pathname || '/');
    return (
      <>
        <div className="h-5 w-px bg-[var(--border)] mx-0.5" />
        <a
          href={`${BASE_PATH}${LOGIN_PATH}?redirect=${redirect}`}
          className="lims-btn lims-btn-ghost"
        >
          <LogIn className="w-3.5 h-3.5" />
          Sign in
        </a>
        <a
          href={`${BASE_PATH}${LOGIN_PATH}?mode=signup&redirect=${redirect}`}
          className="lims-btn lims-btn-ghost"
        >
          Sign up
        </a>
      </>
    );
  }

  const label = displayName || email || orcid || '';
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <div className="h-5 w-px bg-[var(--border)] mx-0.5" />
      <div className="flex items-center gap-1">
        <span
          className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-soft)] max-w-[9rem] truncate"
          title={label || undefined}
        >
          <UserRound className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="lims-btn lims-btn-ghost p-1.5"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}
