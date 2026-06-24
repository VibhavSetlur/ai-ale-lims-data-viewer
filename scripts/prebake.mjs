#!/usr/bin/env node
/**
 * prebake.mjs — generate the STATIC data bundle for the AI-ALE viewer.
 *
 * Strategy: the running SERVER mode already produces exactly the JSON the client
 * consumes. So we snapshot the API responses to files instead of re-implementing
 * the (large, request-coupled) query logic. This guarantees the static build and
 * the server build are byte-identical for the curated views.
 *
 * Usage:
 *   1. Have the server running (ops/serve.sh) reading the DB you want to bake.
 *   2. node scripts/prebake.mjs            # defaults to http://localhost:3457
 *      BASE=http://localhost:3457 node scripts/prebake.mjs
 *
 * Output: public/data/<key>.json  (+ .json.gz)  and public/data/manifest.json
 * The client (static mode) reads public/data/manifest.json then the per-key file.
 *
 * RAM note: we bake ONE artifact per experiment + the default "all" view, so the
 * browser loads only the active experiment at a time. We never ship the 240MB DB.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3457';
const OUT = path.resolve(process.cwd(), 'public', 'data');

// The exact endpoint set the curated views fetch. Each entry: a stable KEY the
// client maps to, and the live API path to snapshot. Experiments are baked
// individually so static mode can lazy-load one at a time (low RAM).
const EXPERIMENTS = ['TFMN1', 'TFMN2', 'TFMN3', 'TFMN4', 'strain_stocks'];
const targets = [
  { key: 'mutations__all', url: '/api/mutations' },
  ...EXPERIMENTS.map(e => ({
    key: `mutations__experiment_${e}`,
    url: `/api/mutations?experiment=${encodeURIComponent(e)}`,
  })),
  { key: 'barcode-counts', url: '/api/barcode-counts' },
  { key: 'tables', url: '/api/tables?withCounts=1' },
  { key: 'mirror-info', url: '/api/mirror-info' },
  { key: 'config', url: '/api/config' },
];

async function fetchJson(url) {
  const res = await fetch(BASE + url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), source: BASE, files: {} };
  let totalRaw = 0, totalGz = 0;

  for (const t of targets) {
    process.stdout.write(`baking ${t.key} ... `);
    let data;
    try {
      data = await fetchJson(t.url);
    } catch (err) {
      console.log(`SKIP (${err.message})`);
      continue;
    }
    const json = JSON.stringify(data);
    const gz = gzipSync(Buffer.from(json), { level: 9 });
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 10);
    await writeFile(path.join(OUT, `${t.key}.json`), json);
    await writeFile(path.join(OUT, `${t.key}.json.gz`), gz);
    manifest.files[t.key] = {
      file: `${t.key}.json`,
      gz: `${t.key}.json.gz`,
      bytes: json.length,
      gzBytes: gz.length,
      hash,
    };
    totalRaw += json.length; totalGz += gz.length;
    console.log(`${(json.length / 1024).toFixed(0)} KB raw / ${(gz.length / 1024).toFixed(0)} KB gz`);
  }

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest: ${Object.keys(manifest.files).length} artifacts`);
  console.log(`total: ${(totalRaw / 1024 / 1024).toFixed(1)} MB raw / ${(totalGz / 1024 / 1024).toFixed(2)} MB gz`);
  console.log(`written to ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
