/**
 * api-client.ts -- typed client for AI-ALE viewer API
 *
 * Wraps staticApi from static-data.ts.
 * Never throws to callers; returns ApiResult<T> for all methods.
 * Works identically in server mode (live fetch) and static export mode.
 */

import type { ResponseMeta } from "@/shared/contracts/envelope";
import type { SnapshotProvenance } from "@/shared/contracts/provenance";
import type { CapabilityManifest } from "@/shared/contracts/capability";
import { staticApi } from "@/lib/static-data";

// ---- Result type ----

export type ApiError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryable: boolean;
};

export type ApiResult<T> =
  | { ok: true; data: T; meta?: ResponseMeta }
  | { ok: false; error: ApiError };

// ---- Domain types ----

export interface StatusProfile {
  mode: string;
  channel?: string;
  branch?: string;
  commit?: string;
  version?: string;
}

export interface StatusScientific {
  reachable: boolean;
  latencyMs?: number;
}

export interface StatusData {
  profile: StatusProfile;
  scientific: StatusScientific;
  provenance: SnapshotProvenance;
  capabilities: CapabilityManifest;
}

export interface Session {
  status: "anonymous" | "authenticated";
  identity?: { displayName: string; orcid?: string };
  authentication?: string;
}

export interface MeData {
  session: Session;
  capabilities: { fakeSignInAvailable: boolean };
}

export interface CurrentCatalog {
  snapshotId: string;
}

export interface SnapshotSummary {
  snapshotId: string;
  label: string;
}

// ---- Internal wrapper ----

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const data = await staticApi<T>(path, init);
    return { ok: true, data };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    // Detect if the error came from a failed operation in static mode
    const isStatic =
      typeof message === "string" &&
      message.includes("unavailable in the static viewer");
    return {
      ok: false,
      error: {
        code: isStatic ? "STATIC_UNAVAILABLE" : "CLIENT_ERROR",
        message,
        retryable: !isStatic,
      },
    };
  }
}

// ---- API client ----

export const apiClient = {
  /** GET /api/v1/status */
  status(): Promise<ApiResult<StatusData>> {
    return call<StatusData>("/api/v1/status");
  },

  /** GET /api/v1/capabilities (current snapshot) */
  capabilities(snapshotId?: string): Promise<ApiResult<CapabilityManifest>> {
    const path = snapshotId
      ? `/api/v1/capabilities?snapshotId=${encodeURIComponent(snapshotId)}`
      : "/api/v1/capabilities";
    return call<CapabilityManifest>(path);
  },

  /** GET /api/v1/me */
  me(): Promise<ApiResult<MeData>> {
    return call<MeData>("/api/v1/me");
  },

  /** POST /api/v1/auth/fake-login */
  fakeLogin(body: {
    orcid: string;
    displayName: string;
  }): Promise<ApiResult<{ session: Session }>> {
    return call<{ session: Session }>("/api/v1/auth/fake-login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /api/v1/auth/logout */
  logout(): Promise<ApiResult<Record<string, never>>> {
    return call<Record<string, never>>("/api/v1/auth/logout", {
      method: "POST",
    });
  },

  /** GET /api/v1/catalog/tables */
  tables(snapshotId?: string): Promise<ApiResult<unknown>> {
    const path = snapshotId
      ? `/api/v1/catalog/tables?snapshotId=${encodeURIComponent(snapshotId)}`
      : "/api/v1/catalog/tables";
    return call<unknown>(path);
  },

  /** GET /api/v1/catalog/current */
  current(): Promise<ApiResult<CurrentCatalog>> {
    return call<CurrentCatalog>("/api/v1/catalog/current");
  },

  /** GET /api/v1/catalog/rows */
  rows(query: Record<string, string>): Promise<ApiResult<unknown>> {
    const qs = new URLSearchParams(query).toString();
    return call<unknown>(`/api/v1/catalog/rows?${qs}`);
  },

  /** GET /api/v1/catalog/facets */
  facets(query: Record<string, string>): Promise<ApiResult<unknown>> {
    const qs = new URLSearchParams(query).toString();
    return call<unknown>(`/api/v1/catalog/facets?${qs}`);
  },

  /** GET /api/v1/catalog/export */
  export(query: Record<string, string>): Promise<ApiResult<unknown>> {
    const qs = new URLSearchParams(query).toString();
    return call<unknown>(`/api/v1/catalog/export?${qs}`);
  },

  /** GET /api/v1/catalog/snapshots */
  snapshots(): Promise<ApiResult<SnapshotSummary[]>> {
    return call<SnapshotSummary[]>("/api/v1/catalog/snapshots");
  },

  /** GET /api/v1/catalog/snapshots/:id */
  snapshot(id: string): Promise<ApiResult<unknown>> {
    return call<unknown>(
      `/api/v1/catalog/snapshots/${encodeURIComponent(id)}`,
    );
  },

  /** POST /api/v1/mutations/cohort */
  cohort(query: Record<string, string>): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/mutations/cohort", {
      method: "POST",
      body: JSON.stringify(query),
    });
  },

  /** POST /api/v1/mutations/compare */
  compareMutations(query: Record<string, string>): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/mutations/compare", {
      method: "POST",
      body: JSON.stringify(query),
    });
  },

  /** GET /api/v1/mutations/growth */
  growth(query: Record<string, string>): Promise<ApiResult<unknown>> {
    const qs = new URLSearchParams(query).toString();
    return call<unknown>(`/api/v1/mutations/growth?${qs}`);
  },

  /** GET /api/v1/mutations/library-variants */
  libraryVariants(query: Record<string, string>): Promise<ApiResult<unknown>> {
    const qs = new URLSearchParams(query).toString();
    return call<unknown>(`/api/v1/mutations/library-variants?${qs}`);
  },

  /** GET /api/v1/mutations/copy-number */
  copyNumber(query: Record<string, string>): Promise<ApiResult<unknown>> {
    const qs = new URLSearchParams(query).toString();
    return call<unknown>(`/api/v1/mutations/copy-number?${qs}`);
  },

  /** GET /api/v1/plates/factors */
  plateFactors(id: string): Promise<ApiResult<unknown>> {
    return call<unknown>(
      `/api/v1/plates/factors?id=${encodeURIComponent(id)}`,
    );
  },
} as const;
