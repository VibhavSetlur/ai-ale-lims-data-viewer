import { capabilityManifestSchema, type CapabilityManifest } from "../shared/contracts/capability";
import { snapshotProvenanceSchema, type SnapshotProvenance } from "../shared/contracts/provenance";

export const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

type StaticManifest = {
  provenance: SnapshotProvenance;
  capabilities: CapabilityManifest;
  artifacts: Record<string, { file: string; sha256: string }>;
};
type PublicError = { code: string; message: string; fieldErrors?: Record<string, string[]>; retryable?: boolean };
type StaticEnvelope<T> = { ok: true; data: T; meta?: unknown } | { ok: false; error: PublicError };

/**
 * Typed transport error that preserves the API error code, HTTP status,
 * field-level validation errors, and retryable flag so callers can route
 * every state (400/404/413/422/503, static-unavailable) truthfully instead
 * of collapsing every failure to a single generic client error.
 */
export class StaticApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly retryable: boolean;
  constructor(error: PublicError, status?: number) {
    super(error.message);
    this.name = "StaticApiError";
    this.code = error.code;
    this.status = status;
    this.fieldErrors = error.fieldErrors;
    this.retryable = error.retryable ?? false;
  }
}

export interface StaticApiResult<T> {
  data: T;
  meta?: unknown;
}

function artifactKey(path: string, init?: RequestInit) {
  return `${init?.method ?? "GET"} ${new URL(path, "http://static.local").pathname}`;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

let manifestPromise: Promise<StaticManifest> | undefined;
export async function staticManifest(fetcher: typeof fetch = fetch): Promise<StaticManifest> {
  const load = async () => {
    const response = await fetcher("/static-data/manifest.json");
    if (!response.ok) throw new Error("Static data manifest is unavailable.");
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || !("artifacts" in value)) throw new Error("Static data manifest is invalid.");
    const { artifacts, provenance, capabilities } = value as Record<string, unknown>;
    const parsedProvenance = snapshotProvenanceSchema.safeParse(provenance);
    const parsedCapabilities = capabilityManifestSchema.safeParse(capabilities);
    if (!parsedProvenance.success || !parsedCapabilities.success || parsedProvenance.data.snapshotId !== parsedCapabilities.data.snapshotId || !artifacts || typeof artifacts !== "object") throw new Error("Static data manifest metadata is invalid.");
    return { provenance: parsedProvenance.data, capabilities: parsedCapabilities.data, artifacts: artifacts as StaticManifest["artifacts"] };
  };
  if (fetcher !== fetch) return load();
  if (!manifestPromise) manifestPromise = load();
  return manifestPromise;
}

export async function staticArtifactApi<T>(path: string, init: RequestInit | undefined, fetcher: typeof fetch): Promise<T> {
  const manifest = await staticManifest(fetcher);
  const artifact = manifest.artifacts[artifactKey(path, init)];
  if (!artifact) throw new StaticApiError({ code: "STATIC_UNAVAILABLE", message: "This operation is unavailable in the static viewer.", retryable: false });
  const response = await fetcher(`/static-data/${artifact.file}`);
  if (!response.ok) throw new StaticApiError({ code: "STATIC_UNAVAILABLE", message: "Static data artifact is unavailable.", retryable: false });
  const text = await response.text();
  if (await sha256(text) !== artifact.sha256) throw new StaticApiError({ code: "STATIC_CHECKSUM_MISMATCH", message: "Static data artifact checksum does not match its manifest.", retryable: false });
  const body = JSON.parse(text) as StaticEnvelope<T>;
  if (!body.ok) throw new StaticApiError(body.error);
  return body.data;
}

/**
 * Transport with full envelope. Returns data plus meta (nextCursor, warnings).
 * Throws StaticApiError carrying the typed error code/status/fieldErrors so
 * callers can distinguish 400/404/413/422/503 and static-unavailable states.
 */
export async function staticApiEnvelope<T>(path: string, init?: RequestInit): Promise<StaticApiResult<T>> {
  if (isStaticExport) {
    if (artifactKey(path, init) === "GET /api/v1/catalog/current") return { data: { snapshotId: (await staticManifest()).provenance.snapshotId } as T };
    return { data: await staticArtifactApi<T>(path, init, fetch) };
  }
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  let body: StaticEnvelope<T>;
  try {
    body = await response.json() as StaticEnvelope<T>;
  } catch {
    throw new StaticApiError({ code: "TRANSPORT_ERROR", message: "The server returned an unreadable response.", retryable: true }, response.status);
  }
  if (!response.ok || !body.ok) {
    const error = body.ok
      ? { code: "TRANSPORT_ERROR", message: "Request failed.", retryable: true }
      : body.error;
    throw new StaticApiError(error, response.status);
  }
  return { data: body.data, meta: body.meta };
}

export async function staticApi<T>(path: string, init?: RequestInit): Promise<T> {
  return (await staticApiEnvelope<T>(path, init)).data;
}
