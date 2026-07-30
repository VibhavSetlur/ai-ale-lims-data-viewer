#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
import { connect, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";
const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sqlite = option("--sqlite"), database = option("--database"), out = option("--out");
if (!sqlite || !database || !out) throw new Error("Usage: ingest:reconcile --sqlite FILE --database DATABASE --out REPORT --mysql-secrets-file FILE|--mysql-secrets-stdin");
const source = inspectSqlite(sqlite); const connection = await connect(mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "readUrl" }), database);
const differences = [];
let sqliteDb;
try {
  sqliteDb = new Database(sqlite, { readonly: true, fileMustExist: true });
  for (const table of source.tables) {
    const ordered = table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    const orderBy = (ordered.length ? ordered : table.columns).map((column) => `\"${column.name.replaceAll('\"', '\"\"')}\"`).join(", ");
    const sourceRows = sqliteDb.prepare(`SELECT * FROM \"${table.name.replaceAll('\"', '\"\"')}\" ORDER BY ${orderBy}`).all();
    const [hashRows] = await connection.query("SELECT result.table_sha256 FROM ingest_table_result result JOIN ingest_run run ON run.run_id = result.run_id WHERE result.table_name = ? AND run.source_sha256 = ? AND run.status = 'completed' ORDER BY run.completed_at DESC LIMIT 1", [table.name, source.sourceSha256]);
    if (!hashRows.length || hashRows[0].table_sha256 !== sha256(JSON.stringify(sourceRows))) differences.push(`${table.name}: content checksum differs`);
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`);
    if (Number(rows[0]?.count) !== table.rowCount) differences.push(`${table.name}: row count differs`);
    for (const column of table.columns) { const [nulls] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(column.name)} IS NULL`); if (Number(nulls[0]?.count) !== table.nullCounts[column.name]) differences.push(`${table.name}.${column.name}: null count differs`); }
  }
  const [catalog] = await connection.query("SELECT source_sha256, schema_fingerprint FROM scientific_snapshot_catalog ORDER BY materialized_at DESC LIMIT 1");
  if (!catalog.length) differences.push("missing immutable scientific snapshot catalog");
  else { if (catalog[0].source_sha256 !== source.sourceSha256) differences.push("source checksum differs"); const fingerprint = sha256(JSON.stringify(source.tables.map(({ name, columns }) => ({ name, columns })))); if (catalog[0].schema_fingerprint !== fingerprint) differences.push("schema fingerprint differs"); }
  const report = { database, sourceSha256: source.sourceSha256, tableCount: source.tableCount, capabilities: source.capabilities, blockingDifferences: differences }; writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.exitCode = differences.length ? 1 : 0;
} finally { if (typeof sqliteDb !== "undefined") sqliteDb.close(); await connection.end(); }
