'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, AlertTriangle, CheckCircle2, ServerCrash } from 'lucide-react';
import { fetchData, IS_STATIC } from '../../lib/dataSource';
import { WORKSPACES_PATH } from '../../lib/routes';
import { useOpsIdentity } from '../../lib/ops/useOpsIdentity';
import type { OpsStatus } from '../../lib/ops/config';

type OpsUser = { orcid: string | null; email: string | null; displayName: string | null };
type MeResponse = { authenticated: boolean; user?: OpsUser };

type LoadState =
  | { phase: 'loading' }
  | { phase: 'not_configured'; status: OpsStatus }
  | { phase: 'authenticated'; user: OpsUser }
  | { phase: 'unauthenticated'; authConfigured: boolean }
  | { phase: 'error'; message: string };

// Only accept a redirect that is a same-site absolute path. Anything else
// (protocol-relative "//host", backslash tricks "/\host", or a full URL)
// falls back to "/" so a crafted redirect param cannot send a signed-in
// user off-site.
function sanitizeRedirect(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export default function LoginScreen() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [mode, setMode] = useState<'signin' | 'signup'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'signup'
      ? 'signup'
      : 'signin'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const identity = useOpsIdentity();
  const router = useRouter();

  useEffect(() => {
    if (IS_STATIC) return;
    let cancelled = false;
    (async () => {
      try {
        const statusRes = await fetchData('/api/ops/status');
        if (!statusRes.ok) throw new Error(`status -> HTTP ${statusRes.status}`);
        const statusBody = await statusRes.json();
        const status: OpsStatus = statusBody.data;
        if (cancelled) return;
        if (!status.dbConfigured) {
          setState({ phase: 'not_configured', status });
          return;
        }
        const meRes = await fetchData('/api/auth/me');
        const meBody: { data?: MeResponse } = await meRes.json().catch(() => ({}));
        if (cancelled) return;
        if (meBody.data?.authenticated) {
          setState({ phase: 'authenticated', user: meBody.data.user! });
        } else {
          setState({ phase: 'unauthenticated', authConfigured: status.authConfigured });
        }
      } catch (err) {
        if (!cancelled) setState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    const path = mode === 'signup' ? '/api/auth/local/register' : '/api/auth/local/login';
    const payload: { email: string; password: string; displayName?: string } = { email, password };
    if (mode === 'signup' && displayName.trim()) payload.displayName = displayName.trim();
    try {
      const res = await fetchData(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(body.error?.message || `Request failed (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      setPassword('');
      identity.refresh();
      const redirectTo = sanitizeRedirect(new URLSearchParams(window.location.search).get('redirect'));
      router.push(redirectTo);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  if (IS_STATIC) {
    return (
      <Shell icon={ServerCrash} title="Sign-in is not available here">
        <p>This is a static build of the viewer with no server. Sign-in and workspaces only work when the viewer is running in server mode.</p>
      </Shell>
    );
  }

  if (state.phase === 'loading') {
    return (
      <Shell icon={LogIn} title="Sign in">
        <p className="text-[var(--text-soft)]">Checking sign-in status&hellip;</p>
      </Shell>
    );
  }

  if (state.phase === 'error') {
    return (
      <Shell icon={AlertTriangle} title="Could not check sign-in status">
        <p>{state.message}</p>
      </Shell>
    );
  }

  if (state.phase === 'not_configured') {
    return (
      <Shell icon={AlertTriangle} title="Sign-in is not set up yet">
        <p className="mb-3">
          Sign-in and workspaces require operator configuration that has not been completed on this instance:
        </p>
        <ul className="list-disc pl-5 mb-3 space-y-1 text-[var(--text-soft)]">
          {state.status.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p className="text-[var(--text-soft)]">
          See <code className="lims-chip">docs/OPS_LIVE_RUNBOOK.md</code> for the exact setup steps.
        </p>
      </Shell>
    );
  }

  if (state.phase === 'authenticated') {
    return (
      <Shell icon={CheckCircle2} title="You are signed in">
        <p className="mb-3">Signed in as {state.user.displayName || state.user.email || state.user.orcid}.</p>
        <Link href={WORKSPACES_PATH} className="lims-btn lims-btn-primary">Go to your workspace</Link>
      </Shell>
    );
  }

  return (
    <Shell icon={LogIn} title={mode === 'signup' ? 'Create account' : 'Sign in'}>
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => { setMode('signin'); setFormError(null); }}
          className={`lims-btn ${mode === 'signin' ? 'lims-btn-primary' : 'lims-btn-ghost'}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => { setMode('signup'); setFormError(null); }}
          className={`lims-btn ${mode === 'signup' ? 'lims-btn-primary' : 'lims-btn-ghost'}`}
        >
          Create account
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="block text-xs text-[var(--text-soft)] mb-1">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="lims-input w-full"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-[var(--text-soft)] mb-1">Password</span>
          <input
            type="password"
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="lims-input w-full"
          />
        </label>
        {mode === 'signup' && (
          <label className="block">
            <span className="block text-xs text-[var(--text-soft)] mb-1">Display name (optional)</span>
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="lims-input w-full"
            />
          </label>
        )}
        {formError && (
          <p className="text-sm text-red-600" role="alert">{formError}</p>
        )}
        <button type="submit" disabled={submitting} className="lims-btn lims-btn-primary w-full">
          {submitting ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {state.authConfigured && (
        <div className="mt-5 pt-4 border-t border-[var(--border)]">
          <p className="mb-2 text-xs text-[var(--text-soft)]">ORCID sign-in is optional.</p>
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/auth/orcid/start?redirect=${encodeURIComponent(WORKSPACES_PATH)}`}
            className="lims-btn lims-btn-primary inline-flex items-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Sign in with ORCID
          </a>
        </div>
      )}
    </Shell>
  );
}

function Shell({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="lims-surface rounded-xl p-6 max-w-md w-full shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-5 h-5 text-[var(--text-soft)]" />
          <h1 className="text-lg font-semibold text-[var(--text)]">{title}</h1>
        </div>
        <div className="text-sm text-[var(--text)]">{children}</div>
      </div>
    </div>
  );
}
