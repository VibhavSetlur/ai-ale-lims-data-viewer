#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
import { candidateDatabase, connect, createIndexSql, createMetadata, createTableSql, manifestDigest, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";
const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sqlite = option("--sqlite"), manifestPath = option("--manifest"), database = option("--database");
if (!sqlite || !manifestPath || !database) throw new Error("Usage: ingest:stage --sqlite FILE --manifest MANIFEST --database DATABASE --mysql-secrets-file FILE|--mysql-secrets-stdin");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")); const actual = inspectSqlite(sqlite, manifest.sourceSha256);
if (JSON.stringify(manifest) !== JSON.stringify(actual)) throw new Error("Source SQLite changed after inspection; staging refused.");
const candidate = candidateDatabase(database, manifest); const url = mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "ingestUrl" });
const admin = await connect(url, database); const source = new Database(sqlite, { readonly: true, fileMustExist: true }); const runId = randomUUID(), digest = manifestDigest(manifest);
try {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(candidate)}`); await admin.query(`CREATE DATABASE ${quoteIdentifier(candidate)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs`);
  const target = await connect(url, candidate);
  try {
    await createMetadata(target); await target.query("INSERT INTO ingest_run (run_id, source_sha256, manifest_digest, started_at, status) VALUES (?, ?, ?, UTC_TIMESTAMP(6), 'running')", [runId, manifest.sourceSha256, digest]);
    for (const table of manifest.tables) {
      await target.query(createTableSql(table)); for (const index of table.indexes) { const sql = createIndexSql(table, index); if (sql) await target.query(sql); }
      const orderedColumns = table.columns.some((column) => Number(column.pk) > 0) ? table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)) : table.columns;
      const orderBy = orderedColumns.map((column) => `"${column.name.replaceAll('"', '""')}"`).join(", "); const rows = source.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY ${orderBy}`).all(); const names = table.columns.map((column) => column.name); const insert = `INSERT INTO ${quoteIdentifier(table.name)} (${names.map(quoteIdentifier).join(",")}) VALUES (${names.map(() => "?").join(",")})`;
      for (let start = 0; start < rows.length; start += 500) { await target.beginTransaction(); try { for (const row of rows.slice(start, start + 500)) await target.query(insert, names.map((name) => row[name])); await target.commit(); } catch (error) { await target.rollback(); throw error; } }
      await target.query("INSERT INTO ingest_table_result (run_id, table_name, row_count, table_sha256, chunk_count) VALUES (?, ?, ?, ?, ?)", [runId, table.name, rows.length, sha256(JSON.stringify(rows)), Math.ceil(rows.length / 500)]);
    }
    const snapshotId = `sqlite-${manifest.sourceSha256.slice(0, 16)}`; await target.query("INSERT INTO scientific_snapshot_catalog (snapshot_id,label,source_system,source_revision,source_sha256,received_at,materialized_at,schema_version,schema_fingerprint,manifest_digest) VALUES (?, ?, 'sqlite', NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), '1', ?, ?)", [snapshotId, snapshotId, manifest.sourceSha256, sha256(JSON.stringify(manifest.tables.map(({ name, columns, indexes }) => ({ name, columns, indexes })))), digest]); await target.query("UPDATE ingest_run SET status = 'completed', completed_at = UTC_TIMESTAMP(6) WHERE run_id = ?", [runId]);
  } finally { await target.end(); }
  // The serving database is never modified. Publication is a single atomic pointer update in its control schema.
  await createMetadata(admin); await admin.query("INSERT INTO scientific_publication (id, active_database, source_sha256, published_at) VALUES (1, ?, ?, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE active_database = VALUES(active_database), source_sha256 = VALUES(source_sha256), published_at = VALUES(published_at)", [candidate, manifest.sourceSha256]);
  console.log(JSON.stringify({ database, candidate, sourceSha256: manifest.sourceSha256 }));
} catch (error) { await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(candidate)}`).catch(() => {}); throw error; } finally { source.close(); await admin.end(); }
