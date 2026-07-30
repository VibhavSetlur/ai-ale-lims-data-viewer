#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
import { candidateDatabase, connect, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";
const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sqlite = option("--sqlite"), database = option("--database"), out = option("--out");
if (!sqlite || !database || !out) throw new Error("Usage: ingest:reconcile --sqlite FILE --database DATABASE --out REPORT --mysql-secrets-file FILE|--mysql-secrets-stdin");
const source = inspectSqlite(sqlite); const targetDatabase = candidateDatabase(database, source); const connection = await connect(mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "readUrl" }), targetDatabase); const differences = [];
const sqliteQuote = (value) => `"${value.replaceAll('"', '""')}"`;
try {
  const sqliteDb = new Database(sqlite, { readonly: true, fileMustExist: true });
  try {
    for (const table of source.tables) {
      const order = (table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).length ? table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)) : table.columns).map((column) => sqliteQuote(column.name)).join(", ");
      const sourceRows = sqliteDb.prepare(`SELECT * FROM ${sqliteQuote(table.name)} ORDER BY ${order}`).all(); const [targetRows] = await connection.query(`SELECT * FROM ${quoteIdentifier(table.name)} ORDER BY ${table.columns.map((column) => quoteIdentifier(column.name)).join(", ")}`);
      if (sha256(JSON.stringify(targetRows)) !== sha256(JSON.stringify(sourceRows))) differences.push(`${table.name}: read-back values differ`);
      const [counts] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`); if (Number(counts[0]?.count) !== table.rowCount) differences.push(`${table.name}: row count differs`);
      const [columns] = await connection.query("SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [table.name]);
      if (columns.length !== table.columns.length || columns.some((column, index) => column.name !== table.columns[index].name || (column.nullable === "NO") !== Boolean(table.columns[index].notnull))) differences.push(`${table.name}: schema differs`);
      const [indexes] = await connection.query("SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence, COLLATION AS collation FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX", [table.name]);
      const expectedIndexes = table.indexes.filter((index) => index.origin !== "pk"); const actual = new Map(); for (const index of indexes) { const entry = actual.get(index.name) ?? { unique: !Number(index.nonUnique), columns: [] }; entry.columns.push({ name: index.columnName, desc: index.collation === "D" }); actual.set(index.name, entry); }
      if (expectedIndexes.length !== actual.size || expectedIndexes.some((index) => JSON.stringify({ unique: index.unique, columns: index.columns }) !== JSON.stringify(actual.get(index.name)))) differences.push(`${table.name}: indexes differ`);
      for (const column of table.columns) { const [nulls] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(column.name)} IS NULL`); if (Number(nulls[0]?.count) !== table.nullCounts[column.name]) differences.push(`${table.name}.${column.name}: null count differs`); }
    }
  } finally { sqliteDb.close(); }
  const [catalog] = await connection.query("SELECT source_sha256, schema_fingerprint FROM scientific_snapshot_catalog ORDER BY materialized_at DESC LIMIT 1"); if (!catalog.length || catalog[0].source_sha256 !== source.sourceSha256) differences.push("snapshot catalog differs");
  const report = { database: targetDatabase, sourceSha256: source.sourceSha256, tableCount: source.tableCount, capabilities: source.capabilities, blockingDifferences: differences }; writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.exitCode = differences.length ? 1 : 0;
} finally { await connection.end(); }
