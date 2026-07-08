#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3457';
const OUT = path.resolve(process.cwd(), 'public', 'data');
const EXPERIMENTS = ['TFMN1', 'TFMN2', 'TFMN3', 'TFMN4', 'strain_stocks'];

const curatedTargets = [
  { key: 'mutations__all', url: '/api/mutations' },
  ...EXPERIMENTS.map(e => ({ key: `mutations__experiment_${e}`, url: `/api/mutations?experiment=${encodeURIComponent(e)}` })),
  { key: 'mutations-stats', url: '/api/mutations-stats' },
  { key: 'barcode-counts', url: '/api/barcode-counts' },
  { key: 'library-variants__all', url: '/api/library-variants' },
  ...EXPERIMENTS.map(e => ({ key: `library-variants__experiment_${e}`, url: `/api/library-variants?experiment=${encodeURIComponent(e)}` })),
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
  for (const t of curatedTargets) {
    process.stdout.write(`baking ${t.key} ... `);
    let data;
    try { data = await fetchJson(t.url); }
    catch (err) { console.log(`SKIP (${err.message})`); continue; }
    const json = JSON.stringify(data);
    const gz = gzipSync(Buffer.from(json), { level: 9 });
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 10);
    await writeFile(path.join(OUT, `${t.key}.json`), json);
    await writeFile(path.join(OUT, `${t.key}.json.gz`), gz);
    manifest.files[t.key] = { file: `${t.key}.json`, gz: `${t.key}.json.gz`, bytes: json.length, gzBytes: gz.length, hash };
    console.log(`${(json.length / 1024).toFixed(0)} KB raw / ${(gz.length / 1024).toFixed(0)} KB gz`);
  }
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
