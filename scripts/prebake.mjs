#!/usr/bin/env node
/**
 * prebake.mjs — generate the STATIC data bundle for the AI-ALE viewer.
 *
 * Strategy: the running SERVER mode already produces exactly the JSON the client
 * consumes. So we snapshot the API responses to files instead of re-implementing
 * the (large, request-coupled) query logic. Static build == server build for the
 * curated views, and the raw table browser.
 *
 * Usage:
 *   1. Have a server running against the DB you want to bake.
 *   2. node scripts/prebake.mjs            # defaults to http://localhost:3457
 *      BASE=http://localhost:3457 node scripts/prebake.mjs
 *
 * Output under public/data/:
 *   - <key>.json (+.gz) for the curated views (mutations, barcode-counts, ...)
 *   - tables/<name>/meta.json + chunk_<N>.json for the raw Database Tables browser
 *   - manifest.json (curated artifacts) + tables-manifest.json (table chunking)
 *
 * RAM note: curated views load one experiment at a time; the table browser loads
 * one CHUNK at a time (CHUNK_ROWS rows), so even the 223k-row Mutations table is
 * browsed without ever holding the whole thing. We never ship the 240MB DB.
 */
import { lstat, mkdir, readFile, readlink, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3457';
const OUT = path.resolve(process.cwd(), process.env.OUT || 'public/data');
const DBDIR = path.resolve(process.cwd(), process.env.DBDIR || 'public/db');
const SOURCE_DB = path.resolve(process.cwd(), process.env.SRC || 'data/lims_indexed.db');
const PROFILE = process.env.PROFILE || 'unspecified';
const TARGET = process.env.TARGET || 'unspecified';
const ROOT_PATH = process.env.ROOT_PATH || '';
const UPSTREAM_SOURCE = process.env.UPSTREAM_SOURCE || SOURCE_DB;
const UPSTREAM_SHA256 = process.env.UPSTREAM_SHA256 || '';

// Experiment-specific artifacts are discovered from the selected snapshot at bake time.
// Optional bounded verification mode: comma-separated artifact keys. The default
// remains the complete release bake so normal snapshots never silently omit data.
const requestedTargets = (process.env.PREBAKE_TARGETS || '')
  .split(',').map(key => key.trim()).filter(Boolean);

const curatedTargets = [
  { key: 'mutations__all', url: '/api/mutations' },
  { key: 'growth-series__all', url: '/api/growth-series' },
  { key: 'mutations-stats', url: '/api/mutations-stats' },
  { key: 'barcode-counts', url: '/api/barcode-counts' },
  { key: 'library-variants', url: '/api/library-variants' },
  { key: 'dgoa-alleles', url: '/api/dgoa-alleles' },
  { key: 'plate-design-factors', url: '/api/plate-design/factors' },
  { key: 'tables', url: '/api/tables?withCounts=1' },
  { key: 'mirror-info', url: '/api/mirror-info' },
  { key: 'config', url: '/api/config' },
];

const targetByKey = new Map(curatedTargets.map(target => [target.key, target]));
if (requestedTargets.length > 0) {
  const unknown = requestedTargets.filter(key => !targetByKey.has(key));
  if (unknown.length > 0) throw new Error(`Unknown PREBAKE_TARGETS key(s): ${unknown.join(', ')}. Valid keys: ${curatedTargets.map(target => target.key).join(', ')}`);
}
const selectedTargets = requestedTargets.length > 0
  ? requestedTargets.map(key => targetByKey.get(key))
  : curatedTargets;

async function fetchJson(url) {
  const res = await fetch(BASE + url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const [source, sourceStats] = await Promise.all([readFile(SOURCE_DB), stat(SOURCE_DB)]);
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const dbConfigPath = path.join(DBDIR, 'config.json');
  let dbConfig;
  try { dbConfig = JSON.parse(await readFile(dbConfigPath, 'utf8')); }
  catch (error) { throw new Error(`Could not read HTTPVFS config: ${error instanceof Error ? error.message : String(error)}`); }
  if (dbConfig.sourceSha256 !== sourceSha256) {
    throw new Error(`HTTPVFS source hash ${dbConfig.sourceSha256 ?? 'missing'} does not match ${SOURCE_DB}`);
  }
  const dbLink = path.join(DBDIR, 'lims.db');
  if (!(await lstat(dbLink)).isSymbolicLink() || await readlink(dbLink) !== dbConfig.url) {
    throw new Error(`${DBDIR}/lims.db must be a symlink to the configured HTTPVFS database`);
  }

  await mkdir(OUT, { recursive: true });
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: BASE,
    profile: PROFILE,
    target: TARGET,
    basePath: ROOT_PATH,
    snapshot: {
      path: path.relative(process.cwd(), SOURCE_DB), sha256: sourceSha256, bytes: sourceStats.size, mtime: sourceStats.mtime.toISOString(),
      upstream: { path: UPSTREAM_SOURCE, sha256: UPSTREAM_SHA256 || null },
    },
    files: {},
  };
  let totalRaw = 0, totalGz = 0;
  // Provenance is mandatory even for a bounded verification bake, but it need not
  // be emitted as an artifact unless it is explicitly selected.
  let mirrorInfo;
  const mirrorTarget = targetByKey.get('mirror-info');
  if (!mirrorTarget) throw new Error('mirror-info target is required for static provenance');
  if (!selectedTargets.some(target => target.key === 'mirror-info')) mirrorInfo = await fetchJson(mirrorTarget.url);

  // Discover experiment artifacts from the selected snapshot's assay-bearing
  // catalog. The all-mutations response is authoritative for Seq_samples plus
  // positive assay sources, and avoids stale hard-coded experiment names.
  let allowedExperiments = new Set();
  const allTarget = selectedTargets.find(target => target.key === 'mutations__all');
  if (allTarget) {
    const allMutations = await fetchJson(allTarget.url);
    allowedExperiments = new Set(Array.isArray(allMutations?.experiments) ? allMutations.experiments.filter(Boolean) : []);
    for (const experiment of [...allowedExperiments].sort()) {
      const key = `mutations__experiment_${encodeURIComponent(experiment)}`;
      selectedTargets.push({ key, url: `/api/mutations?experiment=${encodeURIComponent(experiment)}` });
      selectedTargets.push({ key: `growth-series__experiment_${encodeURIComponent(experiment)}`, url: `/api/growth-series?experiment=${encodeURIComponent(experiment)}` });
    }
  }
  const seenKeys = new Set();
  for (const t of selectedTargets) {
    if (seenKeys.has(t.key)) continue;
    seenKeys.add(t.key);
    const experimentMatch = t.key.match(/^(?:mutations|growth-series)__experiment_(.+)$/);
    if (experimentMatch && allowedExperiments && !allowedExperiments.has(experimentMatch[1])) {
      console.log(`skipping ${t.key}: experiment absent from selected snapshot`);
      continue;
    }
    process.stdout.write(`baking ${t.key} ... `);
    let data;
    try { data = await fetchJson(t.url); }
    catch (err) { throw new Error(`Could not bake ${t.key}: ${err instanceof Error ? err.message : String(err)}`); }
    if (t.key === 'mirror-info') mirrorInfo = data;
    const json = JSON.stringify(data);
    const gz = gzipSync(Buffer.from(json), { level: 9 });
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 10);
    await writeFile(path.join(OUT, `${t.key}.json`), json);
    await writeFile(path.join(OUT, `${t.key}.json.gz`), gz);
    manifest.files[t.key] = { file: `${t.key}.json`, gz: `${t.key}.json.gz`, bytes: json.length, gzBytes: gz.length, hash };
    totalRaw += json.length; totalGz += gz.length;
    console.log(`${(json.length / 1024).toFixed(0)} KB raw / ${(gz.length / 1024).toFixed(0)} KB gz`);
  }

  if (!mirrorInfo || typeof mirrorInfo !== 'object' || !mirrorInfo.snapshot_at || !mirrorInfo.table_counts || typeof mirrorInfo.table_counts !== 'object') {
    throw new Error('mirror-info must provide snapshot_at and table_counts for static provenance');
  }
  manifest.snapshot.at = mirrorInfo.snapshot_at;
  manifest.snapshot.tableCounts = mirrorInfo.table_counts;
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest: ${Object.keys(manifest.files).length} artifacts${requestedTargets.length > 0 ? ' (bounded PREBAKE_TARGETS verification bake)' : ''}`);
  console.log(`total: ${(totalRaw / 1024 / 1024).toFixed(1)} MB raw / ${(totalGz / 1024 / 1024).toFixed(2)} MB gz`);
  console.log(`written to ${OUT}`);
  console.log(`\nNOTE: the raw Database Tables browser is served by sql.js-httpvfs from`);
  console.log(`public/db/lims.db (run scripts/prepare-httpvfs-db.sh), not baked here.`);
}

main().catch(e => { console.error(e); process.exit(1); });
