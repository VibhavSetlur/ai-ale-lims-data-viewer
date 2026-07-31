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
import type { MutationDataset } from "@/shared/contracts/mutation-dataset";
import type { GrowthSeriesDataset } from "@/shared/contracts/growth-series";
import type { LibraryVariantDataset } from "@/shared/contracts/library-variants-dataset";
import { staticApiEnvelope, StaticApiError } from "@/lib/static-data";
import type { ResponseMeta as EnvelopeMeta } from "@/shared/contracts/envelope";

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

export interface CohortQuery {
  snapshotId: string;
  experimentKey?: string;
  registryKey?: string;
}

export interface AnalysisRequest {
  snapshotId: string;
  experimentKey: string;
  sampleKeys: string[];
  registryKey?: string;
}

// ---- Internal wrapper ----

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const result = await staticApiEnvelope<T>(path, init);
    return { ok: true, data: result.data, meta: result.meta as EnvelopeMeta | undefined };
  } catch (err) {
    if (err instanceof StaticApiError) {
      return {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          fieldErrors: err.fieldErrors,
          retryable: err.retryable,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "CLIENT_ERROR",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
        retryable: true,
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

  /** POST /api/v1/catalog/rows */
  rows(query: unknown): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/catalog/rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
  },

  /** POST /api/v1/catalog/facets */
  facets(query: unknown): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/catalog/facets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
  },

  /** POST /api/v1/catalog/export */
  export(query: unknown): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/catalog/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
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

  /** GET /api/v1/mutations/cohort */
  cohort(query: CohortQuery): Promise<ApiResult<unknown>> {
    const params = new URLSearchParams({ snapshotId: query.snapshotId });
    if (query.experimentKey) params.set("experimentKey", query.experimentKey);
    if (query.registryKey) params.set("registryKey", query.registryKey);
    return call<unknown>(`/api/v1/mutations/cohort?${params.toString()}`);
  },

  /** POST /api/v1/mutations/compare */
  compareMutations(body: AnalysisRequest): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/mutations/compare", { method: "POST", body: JSON.stringify(body) });
  },

  /** POST /api/v1/mutations/growth */
  growth(body: AnalysisRequest): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/mutations/growth", { method: "POST", body: JSON.stringify(body) });
  },

  /** POST /api/v1/mutations/library-variants */
  libraryVariants(body: AnalysisRequest): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/mutations/library-variants", { method: "POST", body: JSON.stringify(body) });
  },

  /** POST /api/v1/mutations/copy-number */
  copyNumber(body: AnalysisRequest): Promise<ApiResult<unknown>> {
    return call<unknown>("/api/v1/mutations/copy-number", { method: "POST", body: JSON.stringify(body) });
  },

  /** GET /api/v1/mutations/dataset (ported flagship MutationExplorer feed) */
  mutationDataset(query?: {
    snapshotId?: string;
    experimentKey?: string;
    registryKey?: string;
  }): Promise<ApiResult<MutationDataset>> {
    const params = new URLSearchParams();
    if (query?.snapshotId) params.set("snapshotId", query.snapshotId);
    if (query?.experimentKey) params.set("experimentKey", query.experimentKey);
    if (query?.registryKey) params.set("registryKey", query.registryKey);
    const qs = params.toString();
    return call<MutationDataset>(
      qs ? `/api/v1/mutations/dataset?${qs}` : "/api/v1/mutations/dataset",
    );
  },

  /** GET /api/v1/mutations/growth-series */
  growthSeries(query?: {
    snapshotId?: string;
    experimentKey?: string;
  }): Promise<ApiResult<GrowthSeriesDataset>> {
    const params = new URLSearchParams();
    if (query?.snapshotId) params.set("snapshotId", query.snapshotId);
    if (query?.experimentKey) params.set("experimentKey", query.experimentKey);
    const qs = params.toString();
    return call<GrowthSeriesDataset>(
      qs
        ? `/api/v1/mutations/growth-series?${qs}`
        : "/api/v1/mutations/growth-series",
    );
  },

  /** GET /api/v1/mutations/library-variants-dataset */
  libraryVariantsDataset(query?: {
    snapshotId?: string;
  }): Promise<ApiResult<LibraryVariantDataset>> {
    const params = new URLSearchParams();
    if (query?.snapshotId) params.set("snapshotId", query.snapshotId);
    const qs = params.toString();
    return call<LibraryVariantDataset>(
      qs
        ? `/api/v1/mutations/library-variants-dataset?${qs}`
        : "/api/v1/mutations/library-variants-dataset",
    );
  },

  /** GET /api/v1/plates/factors */
  plateFactors(id: string): Promise<ApiResult<unknown>> {
    return call<unknown>(
      `/api/v1/plates/factors?id=${encodeURIComponent(id)}`,
    );
  },
} as const;
