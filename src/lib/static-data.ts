export const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

type StaticManifest = { artifacts: Record<string, { file: string; sha256: string }> };
type StaticEnvelope<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

function artifactKey(path: string, init?: RequestInit) {
  return `${init?.method ?? "GET"} ${new URL(path, "http://static.local").pathname}`;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function staticArtifactApi<T>(path: string, init: RequestInit | undefined, fetcher: typeof fetch): Promise<T> {
  const manifestResponse = await fetcher("/static-data/manifest.json");
  if (!manifestResponse.ok) throw new Error("Static data manifest is unavailable.");
  const manifest = await manifestResponse.json() as StaticManifest;
  const artifact = manifest.artifacts[artifactKey(path, init)];
  if (!artifact) throw new Error("This operation is unavailable in the static viewer.");
  const response = await fetcher(`/static-data/${artifact.file}`);
  if (!response.ok) throw new Error("Static data artifact is unavailable.");
  const text = await response.text();
  if (await sha256(text) !== artifact.sha256) throw new Error("Static data artifact checksum does not match its manifest.");
  const body = JSON.parse(text) as StaticEnvelope<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}

export async function staticApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (isStaticExport) return staticArtifactApi<T>(path, init, fetch);
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json() as StaticEnvelope<T>;
  if (!response.ok || !body.ok) throw new Error(body.ok ? "Request failed." : body.error.message);
  return body.data;
}
