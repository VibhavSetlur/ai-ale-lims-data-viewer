/**
 * dataSource.ts — single point that decides where the viewer's data comes from.
 *
 * SERVER mode (default, NEXT_PUBLIC_STATIC !== '1'): pass through to the live
 *   /api/* routes exactly as before. Full feature set (raw table browser, export).
 *
 * STATIC mode (NEXT_PUBLIC_STATIC === '1', the modelseed.org/annotation build):
 *   there is no Node server, so /api/* does not exist. We instead serve the
 *   pre-baked artifacts under <basePath>/data/ that `scripts/prebake.mjs` wrote.
 *   We map the known curated-view API URLs to baked file keys and fetch those.
 *   Endpoints that need live SQL (raw data browser, distinct, export) are not
 *   available in static mode; callers gate on `IS_STATIC` before using them.
 *
 * RAM: static mode loads ONE artifact at a time (the active experiment), so the
 * browser never holds more than a single experiment's decoded JSON.
 */
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === '1';

// Prefix every asset/data URL with the deploy base path so the same build works
// under modelseed.org/annotation/projects/aiale/ (set at build time).
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

const DATA_DIR = `${BASE_PATH}/data`;

type ManifestEntry = { file: string; gz: string; bytes: number; gzBytes: number; hash: string };
type Manifest = { generatedAt: string; source: string; files: Record<string, ManifestEntry> };

let manifestPromise: Promise<Manifest> | null = null;
function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${DATA_DIR}/manifest.json`).then(r => {
      if (!r.ok) throw new Error(`manifest.json -> HTTP ${r.status}`);
      return r.json();
    });
  }
  return manifestPromise;
}

// Map a live API URL (the strings the components already use) to a baked key.
// Returns null when the URL has no static equivalent (server-only endpoint).
function apiUrlToKey(apiUrl: string): string | null {
  // strip a leading basePath if present, then a leading slash
  let u = apiUrl;
  if (BASE_PATH && u.startsWith(BASE_PATH)) u = u.slice(BASE_PATH.length);
  if (!u.startsWith('/api/')) return null;

  const [pathPart, query = ''] = u.replace(/^\/api\//, '').split('?');
  const params = new URLSearchParams(query);

  if (pathPart === 'mutations') {
    const exp = params.get('experiment');
    // Custom registry queries can't be pre-baked (would need every combo); static
    // mode uses the auto-registry default, which is the correct per-experiment run.
    return exp ? `mutations__experiment_${exp}` : 'mutations__all';
  }
  if (pathPart === 'mutations-stats') return 'mutations-stats';
  if (pathPart === 'barcode-counts') return 'barcode-counts';
  if (pathPart === 'library-variants') return 'library-variants';
  if (pathPart === 'tables') return 'tables';
  if (pathPart === 'mirror-info') return 'mirror-info';
  if (pathPart === 'config') return 'config';
  // data/[table], distinct/[table], export/[table], health -> server only
  return null;
}

/**
 * Drop-in replacement for `fetch('/api/...')` used by the curated views.
 * In server mode it is a plain fetch. In static mode it resolves the baked file.
 */
export async function fetchData(apiUrl: string, init?: RequestInit): Promise<Response> {
  if (!IS_STATIC) {
    return fetch(BASE_PATH ? `${BASE_PATH}${apiUrl}` : apiUrl, init);
  }
  const key = apiUrlToKey(apiUrl);
  if (!key) {
    // Server-only endpoint requested in static mode. Return an empty-ish 200 so
    // callers degrade gracefully rather than throwing.
    return new Response(JSON.stringify({ error: 'unavailable in static build', static: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  const manifest = await loadManifest();
  const entry = manifest.files[key];
  if (!entry) {
    return new Response(JSON.stringify({ error: `no baked artifact for ${key}` }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  // Prefer plain .json (universally served). The .gz exists for hosts that map
  // Content-Encoding; we fetch the plain file to avoid double-decompression bugs.
  return fetch(`${DATA_DIR}/${entry.file}`);
}
