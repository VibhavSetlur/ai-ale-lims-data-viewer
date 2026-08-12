'use client';

// Shared client identity probe for the ops (MySQL-backed) auth surface.
//
// A single module-level cached promise performs the /api/ops/status +
// /api/auth/me probe once per page load; every component that calls
// useOpsIdentity() subscribes to the same result via useSyncExternalStore,
// so there is only ever one network round trip no matter how many header
// controls render. refresh()/signOut() drop the cached promise and start a
// fresh probe, which fans the new snapshot out to every mounted subscriber.
import { useCallback, useSyncExternalStore } from 'react';
import { fetchData, IS_STATIC } from '../dataSource';

export type OpsIdentityState = 'loading' | 'unavailable' | 'signedOut' | 'signedIn';

type Snapshot = {
  state: OpsIdentityState;
  orcid?: string | null;
  email?: string | null;
  displayName?: string | null;
};

type StatusBody = { data?: { authConfigured?: boolean; localAuthConfigured?: boolean } };
type MeBody = {
  data?: {
    authenticated?: boolean;
    user?: { orcid?: string | null; email?: string | null; displayName?: string | null };
  };
};

const LOADING_SNAPSHOT: Snapshot = { state: 'loading' };
const UNAVAILABLE_SNAPSHOT: Snapshot = { state: 'unavailable' };

let snapshot: Snapshot = LOADING_SNAPSHOT;
let cachedProbe: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setSnapshot(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function probe(): Promise<void> {
  if (IS_STATIC) {
    setSnapshot(UNAVAILABLE_SNAPSHOT);
    return;
  }
  try {
    const statusRes = await fetchData('/api/ops/status');
    if (!statusRes.ok) {
      setSnapshot(UNAVAILABLE_SNAPSHOT);
      return;
    }
    const statusBody: StatusBody | null = await statusRes.json().catch(() => null);
    if (statusBody?.data?.authConfigured !== true && statusBody?.data?.localAuthConfigured !== true) {
      setSnapshot(UNAVAILABLE_SNAPSHOT);
      return;
    }

    const meRes = await fetchData('/api/auth/me');
    if (!meRes.ok) {
      setSnapshot(UNAVAILABLE_SNAPSHOT);
      return;
    }
    const meBody: MeBody | null = await meRes.json().catch(() => null);
    const data = meBody?.data;
    if (!data || data.authenticated !== true) {
      setSnapshot({ state: 'signedOut' });
      return;
    }
    setSnapshot({
      state: 'signedIn',
      orcid: data.user?.orcid ?? null,
      email: data.user?.email ?? null,
      displayName: data.user?.displayName ?? null,
    });
  } catch {
    setSnapshot(UNAVAILABLE_SNAPSHOT);
  }
}

function getProbe(): Promise<void> {
  if (!cachedProbe) {
    cachedProbe = probe();
  }
  return cachedProbe;
}

function invalidate(): void {
  cachedProbe = null;
  void getProbe();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void getProbe();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return LOADING_SNAPSHOT;
}

export function useOpsIdentity(): {
  state: OpsIdentityState;
  orcid?: string | null;
  email?: string | null;
  displayName?: string | null;
  refresh: () => void;
  signOut: () => Promise<void>;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const refresh = useCallback(() => {
    invalidate();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetchData('/api/auth/logout', { method: 'POST' });
    } catch {
      // Network errors during logout should not block the local refresh below.
    }
    invalidate();
  }, []);

  return {
    state: current.state,
    orcid: current.orcid,
    email: current.email,
    displayName: current.displayName,
    refresh,
    signOut,
  };
}
