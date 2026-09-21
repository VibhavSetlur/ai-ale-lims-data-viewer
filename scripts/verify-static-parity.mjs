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
  if (config.sourceSha256 !== sourceHash) throw new Error(`HTTPVFS source hash ${config.sourceSha256 ?? 'missing'} does not match ${SOURCE_DB}`);
  if (!config.url?.includes(sourceHash)) throw new Error(`HTTPVFS URL is not keyed to source hash ${sourceHash}`);
  await access(path.join(DB_DIR, 'lims.db'));
  if ((await realpath(path.join(DB_DIR, 'lims.db'))) !== (await realpath(path.join(DB_DIR, config.url)))) {
    throw new Error('public/db/lims.db does not reference the configured HTTPVFS database');
  }

  const checks = [
    ['mutations__all', '/api/mutations'],
    ['tables', '/api/tables?withCounts=1'],
    ['mirror-info', '/api/mirror-info'],
  ];
  for (const [key, endpoint] of checks) {
    const [baked, live] = await Promise.all([json(path.join(DATA_DIR, `${key}.json`)), fetchJson(endpoint)]);
    if (canonicalJson(baked) !== canonicalJson(live)) throw new Error(`${key} differs from live ${endpoint}`);
    const entry = manifest.files?.[key];
    if (!entry || entry.hash !== createHash('sha1').update(JSON.stringify(baked)).digest('hex').slice(0, 10)) {
      throw new Error(`manifest hash for ${key} is missing or inconsistent`);
    }
    console.log(`verified ${key}: baked artifact matches ${endpoint}`);
  }
  console.log(`verified shared snapshot: ${sourceHash}`);
}

main().catch(error => { console.error(`static parity failed: ${error.message}`); process.exit(1); });
