#!/usr/bin/env node
/** Verify that the static bundle and HTTPVFS database share one source snapshot. */
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const BASE = process.env.BASE;
const SOURCE_DB = path.resolve(ROOT, process.env.SRC || 'data/lims_indexed.db');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const DB_DIR = path.join(ROOT, 'public', 'db');
const DASHBOARD_SOURCE = path.join(ROOT, 'src', 'components', 'Dashboard.tsx');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function fetchJson(endpoint) {
  const response = await fetch(`${BASE}${endpoint}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${endpoint} -> HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const dashboard = await readFile(DASHBOARD_SOURCE, 'utf8');
  if (!dashboard.includes("const PlateDesignWorkspace = dynamic(() => import('./PlateDesignWorkspace')")) throw new Error('static Plate Design workspace import is missing');
  if ((dashboard.match(/setActiveView\('plateDesign'\)/g) ?? []).length < 2) throw new Error('static Plate Design navigation controls are missing');
  if (dashboard.includes('AI-ALE Assistant') || dashboard.includes('User Workspace')) throw new Error('static AI sidebar chat or User Workspace UI is present');
  console.log('verified static UI: Plate Design is available; AI-ALE Assistant and User Workspace are absent');

  if (!BASE) throw new Error('BASE is required, for example BASE=http://localhost:3457 node scripts/verify-static-parity.mjs');

  const [source, manifest, config] = await Promise.all([
    readFile(SOURCE_DB),
    json(path.join(DATA_DIR, 'manifest.json')),
    json(path.join(DB_DIR, 'config.json')),
  ]);
  const sourceHash = sha256(source);
  const sourceStats = await stat(SOURCE_DB);
  if (manifest.snapshot?.sha256 !== sourceHash) throw new Error(`manifest source hash ${manifest.snapshot?.sha256 ?? 'missing'} does not match ${SOURCE_DB}`);
  if (manifest.snapshot?.bytes !== sourceStats.size) throw new Error(`manifest source size ${manifest.snapshot?.bytes ?? 'missing'} does not match ${SOURCE_DB}`);
  if (!manifest.snapshot?.at || !manifest.snapshot?.tableCounts) throw new Error('manifest snapshot timestamp or table counts are missing');
  if (config.sourceSha256 !== sourceHash) throw new Error(`HTTPVFS source hash ${config.sourceSha256 ?? 'missing'} does not match ${SOURCE_DB}`);
  if (!config.url?.includes(sourceHash)) throw new Error(`HTTPVFS URL is not keyed to source hash ${sourceHash}`);
  await access(path.join(DB_DIR, 'lims.db'));
  if ((await realpath(path.join(DB_DIR, 'lims.db'))) !== (await realpath(path.join(DB_DIR, config.url)))) {
    throw new Error('public/db/lims.db does not reference the configured HTTPVFS database');
  }

  const endpointForKey = (key) => {
    if (key === 'mutations__all') return '/api/mutations';
    if (key === 'growth-series__all') return '/api/growth-series';
    if (key === 'mutations-stats') return '/api/mutations-stats';
    if (key === 'barcode-counts') return '/api/barcode-counts';
    if (key === 'library-variants') return '/api/library-variants';
    if (key === 'dgoa-alleles') return '/api/dgoa-alleles';
    if (key === 'plate-design-factors') return '/api/plate-design/factors';
    if (key === 'tables') return '/api/tables?withCounts=1';
    if (key === 'mirror-info') return '/api/mirror-info';
    if (key === 'config') return '/api/config';
    const mutation = key.match(/^mutations__experiment_(.+)$/);
    if (mutation) return `/api/mutations?experiment=${encodeURIComponent(decodeURIComponent(mutation[1]))}`;
    const growth = key.match(/^growth-series__experiment_(.+)$/);
    if (growth) return `/api/growth-series?experiment=${encodeURIComponent(decodeURIComponent(growth[1]))}`;
    return null;
  };
  const checks = Object.keys(manifest.files ?? {}).map(key => [key, endpointForKey(key)]).filter(([, endpoint]) => endpoint);
  if (checks.length === 0) throw new Error('manifest has no endpoint-backed artifacts');
  for (const [key, endpoint] of checks) {
    const [baked, live] = await Promise.all([json(path.join(DATA_DIR, `${key}.json`)), fetchJson(endpoint)]);
    if (canonicalJson(baked) !== canonicalJson(live)) throw new Error(`${key} differs from live ${endpoint}`);
    if (key === 'mirror-info') {
      if (manifest.snapshot.at !== live.snapshot_at) throw new Error('manifest snapshot timestamp differs from live mirror-info');
      if (canonicalJson(manifest.snapshot.tableCounts) !== canonicalJson(live.table_counts)) throw new Error('manifest table counts differ from live mirror-info');
    }
    const entry = manifest.files?.[key];
    if (!entry || entry.hash !== createHash('sha1').update(JSON.stringify(baked)).digest('hex').slice(0, 10)) {
      throw new Error(`manifest hash for ${key} is missing or inconsistent`);
    }
    console.log(`verified ${key}: baked artifact matches ${endpoint}`);
  }
  console.log(`verified shared snapshot: ${sourceHash}`);
}

main().catch(error => { console.error(`static parity failed: ${error.message}`); process.exit(1); });
