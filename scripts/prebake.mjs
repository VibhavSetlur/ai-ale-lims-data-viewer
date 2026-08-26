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
 *   1. Have the server running (ops/serve.sh) reading the DB you want to bake.
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
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3457';
const OUT = path.resolve(process.cwd(), 'public', 'data');

const FLOOR_EXPERIMENTS = ['TFMN1', 'TFMN2', 'TFMN3', 'TFMN4', 'strain_stocks'];

async function fetchJson(url) {
  const res = await fetch(BASE + url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function getCuratedTargets() {
  const mutations = await fetchJson('/api/mutations');
  const derivedExperiments = Array.isArray(mutations.experiments) && mutations.experiments.length
    ? mutations.experiments
    : FLOOR_EXPERIMENTS;
  const experiments = [...new Set([...FLOOR_EXPERIMENTS, ...derivedExperiments])].sort();
  console.log(`experiments: ${experiments.join(', ')}`);
  return [
    { key: 'mutations__all', url: '/api/mutations' },
    ...experiments.map(e => ({
      key: `mutations__experiment_${e}`,
      url: `/api/mutations?experiment=${encodeURIComponent(e)}`,
    })),
    { key: 'growth-series__all', url: '/api/growth-series' },
    ...experiments.map(e => ({
      key: `growth-series__experiment_${e}`,
      url: `/api/growth-series?experiment=${encodeURIComponent(e)}`,
    })),
    { key: 'mutations-stats', url: '/api/mutations-stats' },
    { key: 'barcode-counts', url: '/api/barcode-counts' },
    { key: 'library-variants', url: '/api/library-variants' },
    { key: 'plate-design-factors', url: '/api/plate-design/factors' },
    { key: 'tables', url: '/api/tables?withCounts=1' },
    { key: 'mirror-info', url: '/api/mirror-info' },
    { key: 'config', url: '/api/config' },
  ];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const curatedTargets = await getCuratedTargets();
  const manifest = { generatedAt: new Date().toISOString(), source: BASE, files: {} };
  let totalRaw = 0, totalGz = 0;

  for (const t of curatedTargets) {
    process.stdout.write(`baking ${t.key} ... `);
    let data;
    try { data = await fetchJson(t.url); }
    catch (err) { throw new Error(`Could not bake ${t.key}: ${err instanceof Error ? err.message : String(err)}`); }
    const json = JSON.stringify(data);
    const gz = gzipSync(Buffer.from(json), { level: 9 });
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 10);
    await writeFile(path.join(OUT, `${t.key}.json`), json);
    await writeFile(path.join(OUT, `${t.key}.json.gz`), gz);
    manifest.files[t.key] = { file: `${t.key}.json`, gz: `${t.key}.json.gz`, bytes: json.length, gzBytes: gz.length, hash };
    totalRaw += json.length; totalGz += gz.length;
    console.log(`${(json.length / 1024).toFixed(0)} KB raw / ${(gz.length / 1024).toFixed(0)} KB gz`);
  }

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest: ${Object.keys(manifest.files).length} artifacts`);
  console.log(`total: ${(totalRaw / 1024 / 1024).toFixed(1)} MB raw / ${(totalGz / 1024 / 1024).toFixed(2)} MB gz`);
  console.log(`written to ${OUT}`);
  console.log(`\nNOTE: the raw Database Tables browser is served by sql.js-httpvfs from`);
  console.log(`public/db/lims.db (run scripts/prepare-httpvfs-db.sh), not baked here.`);
}

main().catch(e => { console.error(e); process.exit(1); });
