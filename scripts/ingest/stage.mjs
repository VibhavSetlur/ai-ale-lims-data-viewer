#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
import { connect, createMetadata, createTableSql, manifestDigest, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";

const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sqlite = option("--sqlite"), manifestPath = option("--manifest"), database = option("--database");
if (!sqlite || !manifestPath || !database) throw new Error("Usage: ingest:stage --sqlite FILE --manifest MANIFEST --database DATABASE --mysql-secrets-file FILE|--mysql-secrets-stdin");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const actual = inspectSqlite(sqlite, manifest.sourceSha256);
if (JSON.stringify(manifest) !== JSON.stringify(actual)) throw new Error("Source SQLite changed after inspection; staging refused.");
const connection = await connect(mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "ingestUrl" }), database);
const source = new Database(sqlite, { readonly: true, fileMustExist: true });
const runId = randomUUID(), digest = manifestDigest(manifest), createdTables = [];
try {
  await connection.beginTransaction(); await createMetadata(connection);
  const [previous] = await connection.query("SELECT snapshot_id FROM scientific_snapshot_catalog WHERE source_sha256 = ?", [manifest.sourceSha256]);
  if (previous.length) throw new Error("This immutable source snapshot is already staged.");
  await connection.query("INSERT INTO ingest_run (run_id, source_sha256, manifest_digest, started_at, status) VALUES (?, ?, ?, UTC_TIMESTAMP(6), 'running')", [runId, manifest.sourceSha256, digest]);
  for (const table of manifest.tables) {
    const [exists] = await connection.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table.name]);
    if (exists.length) throw new Error(`Destination table already exists: ${table.name}`);
    await connection.query(createTableSql(table)); createdTables.push(table.name);
    // Ordering all declared columns also supports SQLite WITHOUT ROWID tables.
    const orderedColumns = table.columns.some((column) => Number(column.pk) > 0) ? table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)) : table.columns;
    const ordered = orderedColumns.map((column) => `\"${column.name.replaceAll('\"', '\"\"')}\"`).join(", ");
    const rows = source.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY ${ordered}`).all();
    const names = table.columns.map((column) => column.name), placeholders = names.map(() => "?").join(",");
    const insert = `INSERT INTO ${quoteIdentifier(table.name)} (${names.map(quoteIdentifier).join(",")}) VALUES (${placeholders})`;
    const hash = sha256(JSON.stringify(rows));
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      for (const row of chunk) await connection.query(insert, names.map((name) => row[name]));
    }
    await connection.query("INSERT INTO ingest_table_result (run_id, table_name, row_count, table_sha256, chunk_count) VALUES (?, ?, ?, ?, ?)", [runId, table.name, rows.length, hash, Math.ceil(rows.length / 500)]);
  }
  const snapshotId = `sqlite-${manifest.sourceSha256.slice(0, 16)}`;
  await connection.query("INSERT INTO scientific_snapshot_catalog (snapshot_id,label,source_system,source_revision,source_sha256,received_at,materialized_at,schema_version,schema_fingerprint,manifest_digest) VALUES (?, ?, 'sqlite', NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), '1', ?, ?)", [snapshotId, snapshotId, manifest.sourceSha256, sha256(JSON.stringify(manifest.tables.map(({ name, columns }) => ({ name, columns })))), digest]);
  await connection.query("UPDATE ingest_run SET status = 'completed', completed_at = UTC_TIMESTAMP(6) WHERE run_id = ?", [runId]); await connection.commit();
  console.log(JSON.stringify({ database, snapshotId, sourceSha256: manifest.sourceSha256 }));
} catch (error) { await connection.rollback(); for (const table of createdTables.reverse()) await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`); await connection.query("DELETE FROM ingest_table_result WHERE run_id = ?", [runId]).catch(() => {}); await connection.query("DELETE FROM ingest_run WHERE run_id = ?", [runId]).catch(() => {}); throw error; } finally { source.close(); await connection.end(); }
