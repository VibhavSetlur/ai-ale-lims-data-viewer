#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
import { candidateDatabase, connect, manifestDigest, mysqlType, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";
const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sqlite = option("--sqlite"), manifestPath = option("--manifest"), database = option("--database"), out = option("--out"), fixturesPath = option("--api-fixtures") ?? new URL("../../src/shared/test/api-contract-fixtures.json", import.meta.url);
if (!sqlite || !database || !out) throw new Error("Usage: ingest:reconcile --sqlite FILE [--manifest MANIFEST] --database DATABASE --out REPORT --mysql-secrets-file FILE|--mysql-secrets-stdin [--api-fixtures FILE]");
const source = manifestPath ? JSON.parse(readFileSync(manifestPath, "utf8")) : inspectSqlite(sqlite); const digest = manifestDigest(source); const targetDatabase = candidateDatabase(database, source); const connection = await connect(mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "readUrl" }), targetDatabase); const differences = [];
const sqliteQuote = (value) => `"${value.replaceAll('"', '""')}"`; const canonical = (value) => JSON.stringify(normalize(value)); const normalize = (value) => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "request").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : typeof value === "bigint" ? value.toString() : Buffer.isBuffer(value) ? value.toString("base64") : value; const desiredType = (type) => mysqlType(type).replace(/\(.+\)/, "").toLowerCase();
async function apiContracts() {
  const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")); const input = JSON.stringify({ sqlite, mysqlUrl: mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "readUrl" }), database: targetDatabase, fixtures });
  const result = await import("node:child_process").then(({ spawnSync }) => spawnSync(process.execPath, ["--import", "tsx", new URL("./reconcile-api-contracts.ts", import.meta.url).pathname], { input, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
  if (result.error) throw result.error; if (result.status !== 0) throw new Error(`API contract comparison failed: ${result.stderr || result.stdout}`);
  const comparison = JSON.parse(result.stdout);
  for (const difference of comparison.differences) differences.push(difference);
  return { fixtureCount: fixtures.length, compared: true };
}
try {
  const sqliteDb = new Database(sqlite, { readonly: true, fileMustExist: true });
  try {
    for (const table of source.tables) {
      const keyColumns = table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)); const orderColumns = keyColumns.length ? keyColumns : table.columns;
      const order = orderColumns.map((column) => sqliteQuote(column.name)).join(", "); const sourceRows = sqliteDb.prepare(`SELECT * FROM ${sqliteQuote(table.name)} ORDER BY ${order}`).all(); const [targetRows] = await connection.query(`SELECT * FROM ${quoteIdentifier(table.name)} ORDER BY ${orderColumns.map((column) => quoteIdentifier(column.name)).join(", ")}`);
      if (sha256(canonical(targetRows)) !== sha256(canonical(sourceRows))) differences.push(`${table.name}: read-back values/checksum differ`);
      const [counts] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`); if (Number(counts[0]?.count) !== table.rowCount) differences.push(`${table.name}: row count differs`);
      const [columns] = await connection.query("SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [table.name]);
      if (columns.length !== table.columns.length || columns.some((column, index) => column.name !== table.columns[index].name || String(column.type).toLowerCase() !== desiredType(table.columns[index].type) || (column.nullable === "NO") !== Boolean(table.columns[index].notnull) || (table.columns[index].dflt_value == null ? column.defaultValue != null : String(column.defaultValue) !== String(table.columns[index].dflt_value)) || (Number(table.columns[index].pk) > 0) !== (column.columnKey === "PRI"))) differences.push(`${table.name}: schema type/nullability/key differs`);
      const [indexes] = await connection.query("SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence, COLLATION AS collation FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX", [table.name]); const expectedIndexes = table.indexes.filter((index) => index.origin !== "pk"); const actual = new Map(); for (const index of indexes) { const entry = actual.get(index.name) ?? { unique: !Number(index.nonUnique), columns: [] }; entry.columns.push({ name: index.columnName, desc: index.collation === "D" }); actual.set(index.name, entry); } if (expectedIndexes.length !== actual.size || expectedIndexes.some((index) => canonical({ unique: index.unique, columns: index.columns }) !== canonical(actual.get(index.name)))) differences.push(`${table.name}: indexes differ`);
      for (const column of table.columns) { const [nulls] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(column.name)} IS NULL`); if (Number(nulls[0]?.count) !== table.nullCounts[column.name]) differences.push(`${table.name}.${column.name}: null count differs`); }
    }
  } finally { sqliteDb.close(); }
  const [catalog] = await connection.query("SELECT source_sha256, schema_fingerprint, manifest_digest FROM scientific_snapshot_catalog ORDER BY materialized_at DESC LIMIT 1"); if (!catalog.length || catalog[0].source_sha256 !== source.sourceSha256 || catalog[0].manifest_digest !== digest) differences.push("snapshot catalog differs");
  const [allowed] = await connection.query("SELECT table_name FROM scientific_table_allowlist ORDER BY table_name"); if (canonical(allowed.map((row) => row.table_name)) !== canonical(source.tables.map((table) => table.name).sort())) differences.push("frozen catalog allowlist differs");
  const capabilities = { hasBarcodes: source.tables.find((table) => table.name === "verAB_barcodes")?.rowCount > 0 }; if (canonical(capabilities) !== canonical(source.capabilities)) differences.push("capabilities differ");
  const api = await apiContracts(); const report = { database: targetDatabase, sourceSha256: source.sourceSha256, manifestDigest: digest, tableCount: source.tableCount, capabilities, apiContracts: api, blockingDifferences: differences }; writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.exitCode = differences.length ? 1 : 0;
} finally { await connection.end(); }
