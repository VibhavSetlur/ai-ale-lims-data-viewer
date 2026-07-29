#!/usr/bin/env node
/** Candidate-only scientific import planner. It never opens a MySQL connection. */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  if (Buffer.isBuffer(item)) return { encoding: 'base64', value: item.toString('base64') };
  return item;
}, 2) + '\n';
const q = identifier => `\`${String(identifier).replaceAll('`', '``')}\``;
const sqliteQ = identifier => `"${String(identifier).replaceAll('"', '""')}"`;
const required = (args, name) => { const value = args[name]; if (!value || typeof value !== 'string') throw new Error(`--${name} is required.`); return value; };
const candidateId = args => { const value = required(args, 'candidate'); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('--candidate must be a safe identifier.'); return value; };

export function parseArgs(argv) {
  const [group, command, ...rest] = argv;
  if (group !== 'ingest' || !command) throw new Error('Usage: viewer2 ingest <inspect|stage|reconcile|materialize|publish> ...');
  const args = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]; const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`Expected a value for ${key ?? 'option'}.`);
    args[key.slice(2)] = value;
  }
  return { command, args };
}

function assertTestMysql(urlValue) {
  const url = new URL(required({ 'mysql-url': urlValue }, 'mysql-url'));
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  const database = url.pathname.slice(1);
  if (url.protocol !== 'mysql:' || !local || !/^viewer2_test_[A-Za-z0-9_]+$/.test(database) || url.searchParams.get('test_only') !== '1') {
    throw new Error('--mysql-url must be an explicit local disposable URL: mysql://...@127.0.0.1/viewer2_test_<name>?test_only=1.');
  }
  return url.toString();
}
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function writeJson(path, value) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, stable(value), 'utf8'); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite numeric value'); return value; }
  if (Buffer.isBuffer(value)) return { encoding: 'base64', value: value.toString('base64') };
  throw new Error(`unsupported SQLite value type ${typeof value}`);
}
function tableRows(db, table, columns) { return db.prepare(`SELECT * FROM ${sqliteQ(table)} ORDER BY rowid`).all().map(row => Object.fromEntries(columns.map(column => [column.name, canonical(row[column.name])]))); }
function capabilities(tables) {
  const barcode = tables.find(table => table.name === 'verAB_barcodes');
  return { hasBarcodes: Boolean(barcode && barcode.count > 0), tables: tables.map(table => table.name).sort() };
}
export async function inspect(sqlitePath, outputPath) {
  const sourceChecksum = sha256(await readFile(sqlitePath));
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name, sql }) => {
      const columns = db.prepare(`PRAGMA table_info(${sqliteQ(name)})`).all().map(column => ({ name: column.name, type: column.type, notNull: Boolean(column.notnull), defaultValue: column.dflt_value, primaryKeyPosition: column.pk }));
      const count = db.prepare(`SELECT COUNT(*) AS count FROM ${sqliteQ(name)}`).get().count;
      const nullCounts = Object.fromEntries(columns.map(column => [column.name, db.prepare(`SELECT COUNT(*) AS count FROM ${sqliteQ(name)} WHERE ${sqliteQ(column.name)} IS NULL`).get().count]));
      const indexes = db.prepare(`PRAGMA index_list(${sqliteQ(name)})`).all().map(index => ({ name: index.name, unique: Boolean(index.unique), origin: index.origin, columns: db.prepare(`PRAGMA index_info(${sqliteQ(index.name)})`).all().map(column => column.name) }));
      const lower = columns.map(column => column.name.toLowerCase());
      const softDeleteColumn = columns.find(column => column.name.toLowerCase() === 'deleted')?.name ?? null;
      const freshnessColumn = columns.find(column => ['last_synced', 'updated_at', 'created_at'].includes(column.name.toLowerCase()))?.name ?? null;
      const deletedCount = softDeleteColumn ? db.prepare(`SELECT COUNT(*) AS count FROM ${sqliteQ(name)} WHERE ${sqliteQ(softDeleteColumn)} IS NOT NULL AND ${sqliteQ(softDeleteColumn)} != 0`).get().count : 0;
      const freshness = freshnessColumn ? db.prepare(`SELECT MIN(${sqliteQ(freshnessColumn)}) AS min, MAX(${sqliteQ(freshnessColumn)}) AS max FROM ${sqliteQ(name)}`).get() : null;
      return { name, createSql: sql, columns, indexes, count, nullCounts, primaryKey: columns.filter(column => column.primaryKeyPosition).map(column => column.name), softDeleteColumn, deletedCount, freshnessColumn, freshness, representativeRows: db.prepare(`SELECT * FROM ${sqliteQ(name)} ORDER BY rowid LIMIT 3`).all().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonical(value)]))) };
    });
    const manifest = { version: 1, kind: 'viewer2-scientific-inspection', sourceChecksum, tables, capabilities: capabilities(tables) };
    manifest.manifestDigest = sha256(stable(manifest));
    await writeJson(outputPath, manifest);
    return manifest;
  } finally { db.close(); }
}
function mysqlType(sqliteType) {
  const type = String(sqliteType || '').toUpperCase();
  if (/INT/.test(type)) return 'BIGINT'; if (/CHAR|CLOB|TEXT/.test(type)) return 'LONGTEXT'; if (/BLOB/.test(type)) return 'LONGBLOB'; if (/REAL|FLOA|DOUB/.test(type)) return 'DOUBLE'; if (/NUM|DEC/.test(type)) return 'DECIMAL(65,30)'; if (/DATE|TIME/.test(type)) return 'DATETIME(6)'; return 'LONGTEXT';
}
export function compatibilityDdl(manifest) {
  return manifest.tables.map(table => `-- SQLite source table: ${table.name}\nCREATE TABLE ${q(table.name)} (\n${table.columns.map(column => `  ${q(column.name)} ${mysqlType(column.type)}${column.notNull ? ' NOT NULL' : ' NULL'}`).join(',\n')}\n) ENGINE=InnoDB;`).join('\n\n') + '\n';
}
export async function stage({ manifestPath, sqlitePath, output, candidate, mysqlUrl }) {
  assertTestMysql(mysqlUrl); const manifest = await json(manifestPath); const currentChecksum = sha256(await readFile(sqlitePath));
  if (manifest.sourceChecksum !== currentChecksum) throw new Error('SQLite checksum differs from manifest; inspect again before staging.');
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const chunks = []; const rejections = [];
  try { for (const table of manifest.tables) {
    const rows = [];
    for (const raw of db.prepare(`SELECT * FROM ${sqliteQ(table.name)} ORDER BY rowid`).iterate()) try { rows.push(Object.fromEntries(table.columns.map(column => [column.name, canonical(raw[column.name])]))); } catch (error) { rejections.push({ table: table.name, rowHash: sha256(Object.entries(raw).map(([key, value]) => [key, String(value)])), reason: error.message }); }
    const rowHashes = rows.map(row => sha256(stable(row))); for (let offset = 0; offset < rowHashes.length; offset += 1000) chunks.push({ table: table.name, offset, rowCount: Math.min(1000, rowHashes.length - offset), hash: sha256(rowHashes.slice(offset, offset + 1000).join('\n')) });
  }} finally { db.close(); }
  await mkdir(output, { recursive: true });
  const provenance = { version: 1, kind: 'viewer2-scientific-candidate', candidate, sourceChecksum: manifest.sourceChecksum, manifestDigest: manifest.manifestDigest, stagedAt: new Date(0).toISOString(), mysqlTarget: 'explicit-local-test-only', ddlDigest: sha256(compatibilityDdl(manifest)), chunkDigest: sha256(stable(chunks)), rejectionCount: rejections.length };
  provenance.provenanceDigest = sha256(stable(provenance));
  await Promise.all([writeFile(resolve(output, 'compatibility.sql'), compatibilityDdl(manifest)), writeJson(resolve(output, 'provenance.json'), provenance), writeJson(resolve(output, 'chunks.json'), chunks), writeJson(resolve(output, 'rejections.json'), rejections)]);
  return provenance;
}
export async function reconcile({ candidate, sqlitePath, stagePath, reportPath, mysqlUrl }) {
  assertTestMysql(mysqlUrl); const provenance = await json(resolve(stagePath, 'provenance.json')); if (provenance.candidate !== candidate) throw new Error('Candidate does not match staged provenance.');
  const actual = sha256(await readFile(sqlitePath)); const differences = actual === provenance.sourceChecksum ? [] : [{ class: 'blocking', area: 'sourceChecksum', expected: provenance.sourceChecksum, actual }];
  const report = { version: 1, kind: 'viewer2-scientific-reconciliation', candidate, provenanceDigest: provenance.provenanceDigest, sourceChecksum: actual, differences, blockingCount: differences.filter(item => item.class === 'blocking').length };
  report.reportDigest = sha256(stable(report)); await writeJson(reportPath, report); return report;
}
export async function materialize({ candidate, stagePath, reportPath, output, mysqlUrl }) {
  assertTestMysql(mysqlUrl); const provenance = await json(resolve(stagePath, 'provenance.json')); const report = await json(reportPath); if (provenance.candidate !== candidate || report.candidate !== candidate) throw new Error('Candidate provenance and report must match.'); if (report.blockingCount !== 0) throw new Error('Cannot materialize a candidate with blocking differences.');
  const plan = { version: 1, kind: 'viewer2-scientific-materialization-plan', candidate, sourceChecksum: provenance.sourceChecksum, reportDigest: report.reportDigest, ddlDigest: provenance.ddlDigest };
  plan.planDigest = sha256(stable(plan));
  try { const existing = await json(output); if (existing.sourceChecksum === plan.sourceChecksum) return { ...existing, noOp: true }; } catch { /* explicit output may not exist */ }
  await writeJson(output, plan); return plan;
}
export async function publish({ candidate, audience, confirm, reportPath, pointerPath, mysqlUrl }) {
  assertTestMysql(mysqlUrl); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(audience)) throw new Error('--audience must be a safe identifier.');
  const report = await json(reportPath); if (report.candidate !== candidate || report.blockingCount !== 0) throw new Error('Publish requires a matching zero-blocking report.'); if (confirm !== report.reportDigest) throw new Error('--confirm must exactly equal the reconciliation report digest.');
  const pointer = { version: 1, kind: 'viewer2-scientific-audience-pointer', audience, candidate, reportDigest: report.reportDigest, publicationEvent: sha256(`${audience}:${candidate}:${report.reportDigest}`) };
  await mkdir(dirname(resolve(pointerPath)), { recursive: true }); const temporary = `${pointerPath}.tmp-${process.pid}`; await writeFile(temporary, stable(pointer)); await rename(temporary, pointerPath); return pointer;
}
async function main() {
  const { command, args } = parseArgs(process.argv.slice(2)); let result;
  if (command === 'inspect') result = await inspect(required(args, 'sqlite'), required(args, 'output'));
  else if (command === 'stage') result = await stage({ manifestPath: required(args, 'manifest'), sqlitePath: required(args, 'sqlite'), output: required(args, 'output'), candidate: candidateId(args), mysqlUrl: required(args, 'mysql-url') });
  else if (command === 'reconcile') result = await reconcile({ candidate: candidateId(args), sqlitePath: required(args, 'sqlite'), stagePath: required(args, 'stage'), reportPath: required(args, 'report'), mysqlUrl: required(args, 'mysql-url') });
  else if (command === 'materialize') result = await materialize({ candidate: candidateId(args), stagePath: required(args, 'stage'), reportPath: required(args, 'report'), output: required(args, 'output'), mysqlUrl: required(args, 'mysql-url') });
  else if (command === 'publish') result = await publish({ candidate: candidateId(args), audience: required(args, 'audience'), confirm: required(args, 'confirm'), reportPath: required(args, 'report'), pointerPath: required(args, 'pointer'), mysqlUrl: required(args, 'mysql-url') });
  else throw new Error(`Unknown ingest command: ${command}`);
  process.stdout.write(stable(result));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main().catch(error => { process.stderr.write(`viewer2 ingest: ${error.message}\n`); process.exitCode = 1; });
