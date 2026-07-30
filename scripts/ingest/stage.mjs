#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { APPROVED_SOURCE_SHA256, inspectSqlite } from "../../src/modules/ingestion/manifest.mjs";
import { candidateDatabase, chunkHash, connect, createIndexSql, createMetadata, createTableSql, manifestDigest, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";
const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sqlite = option("--sqlite"), manifestPath = option("--manifest"), database = option("--database");
if (!sqlite || !manifestPath || !database) throw new Error("Usage: ingest:stage --sqlite FILE --manifest MANIFEST --database DATABASE --mysql-secrets-file FILE|--mysql-secrets-stdin");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.sourceSha256 !== APPROVED_SOURCE_SHA256 || !Array.isArray(manifest.legacyInventory) || !manifest.inventorySha256) throw new Error("Staging requires an inspection manifest for the approved source with its frozen legacy inventory.");
const actual = inspectSqlite(sqlite, APPROVED_SOURCE_SHA256);
if (JSON.stringify(manifest) !== JSON.stringify(actual)) throw new Error("Source SQLite or frozen legacy inventory changed after inspection; staging refused.");
const candidate = candidateDatabase(database, manifest); const url = mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "ingestUrl" });
const admin = await connect(url, database); const source = new Database(sqlite, { readonly: true, fileMustExist: true }); const runId = randomUUID(), digest = manifestDigest(manifest); const chunkSize = 500;
try {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(candidate)}`); await admin.query(`CREATE DATABASE ${quoteIdentifier(candidate)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs`);
  const target = await connect(url, candidate);
  try {
    await createMetadata(target); await target.query("INSERT INTO ingest_run (run_id, source_sha256, manifest_digest, started_at, status) VALUES (?, ?, ?, UTC_TIMESTAMP(6), 'running')", [runId, manifest.sourceSha256, digest]);
    for (const table of manifest.tables) {
      await target.query(createTableSql(table)); for (const index of table.indexes) { const sql = createIndexSql(table, index); if (sql) await target.query(sql); }
      const orderedColumns = table.columns.some((column) => Number(column.pk) > 0) ? table.columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)) : [{ name: "rowid" }];
      const orderBy = orderedColumns.map((column) => column.name === "rowid" ? "rowid" : `"${column.name.replaceAll('"', '""')}"`).join(", "); const rows = source.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY ${orderBy}`).all(); const names = table.columns.map((column) => column.name); const insert = `INSERT INTO ${quoteIdentifier(table.name)} (${names.map(quoteIdentifier).join(",")}) VALUES (${names.map(() => "?").join(",")})`;
      let rejected = 0;
      for (let start = 0; start < rows.length; start += chunkSize) { const chunk = rows.slice(start, start + chunkSize); const hash = chunkHash(chunk); let rejectedRow; await target.beginTransaction(); try { for (let offset = 0; offset < chunk.length; offset += 1) { const row = chunk[offset]; try { await target.query(insert, names.map((name) => row[name])); } catch (error) { rejectedRow = { offset, row, error }; throw error; } } await target.query("INSERT INTO ingest_chunk_result (run_id, table_name, chunk_index, first_row, row_count, chunk_sha256) VALUES (?, ?, ?, ?, ?, ?)", [runId, table.name, start / chunkSize, start, chunk.length, hash]); await target.commit(); } catch (error) { await target.rollback(); if (rejectedRow) { rejected += 1; await target.query("INSERT INTO ingest_rejection (run_id, table_name, chunk_index, row_index, row_sha256, reason, rejected_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))", [runId, table.name, start / chunkSize, start + rejectedRow.offset, sha256(JSON.stringify(rejectedRow.row)), String(rejectedRow.error).slice(0, 1024)]); throw new Error(`Row rejected while staging ${table.name} chunk ${start / chunkSize}.`); } throw error; } }
      await target.query("INSERT INTO ingest_table_result (run_id, table_name, row_count, table_sha256, chunk_count, rejection_count) VALUES (?, ?, ?, ?, ?, ?)", [runId, table.name, rows.length, sha256(JSON.stringify(rows)), Math.ceil(rows.length / chunkSize), rejected]);
      await target.query("INSERT INTO scientific_table_allowlist (table_name, manifest_digest, column_fingerprint) VALUES (?, ?, ?)", [table.name, digest, sha256(JSON.stringify(table.columns.map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }))))]);
    }
    const snapshotId = `sqlite-${manifest.sourceSha256.slice(0, 16)}`; await target.query("INSERT INTO scientific_snapshot_catalog (snapshot_id,label,source_system,source_revision,source_sha256,received_at,materialized_at,schema_version,schema_fingerprint,manifest_digest) VALUES (?, ?, 'sqlite', NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), '1', ?, ?)", [snapshotId, snapshotId, manifest.sourceSha256, sha256(JSON.stringify(manifest.tables.map(({ name, columns, indexes }) => ({ name, columns, indexes })))), digest]); await target.query("UPDATE ingest_run SET status = 'materialized', completed_at = UTC_TIMESTAMP(6) WHERE run_id = ?", [runId]);
  } finally { await target.end(); }
  console.log(JSON.stringify({ database, candidate, sourceSha256: manifest.sourceSha256, manifestDigest: digest, status: "materialized" }));
} catch (error) { throw error; } finally { source.close(); await admin.end(); }
