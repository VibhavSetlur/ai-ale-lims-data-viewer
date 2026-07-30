#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { candidateDatabase, connect, createMetadata, manifestDigest, mysqlUrlFromSecret, quoteIdentifier, sha256 } from "../../src/modules/ingestion/mysql.mjs";
const args = process.argv.slice(2); const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const manifestPath = option("--manifest"), reportPath = option("--report"), database = option("--database"), testFixture = args.includes("--test-fixture");
if (!manifestPath || !reportPath || !database) throw new Error("Usage: ingest:publish --manifest MANIFEST --report REPORT --database DATABASE --mysql-secrets-file FILE|--mysql-secrets-stdin");
if (testFixture && process.env.NODE_ENV !== "test") throw new Error("--test-fixture is available only when NODE_ENV=test.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")); const report = JSON.parse(readFileSync(reportPath, "utf8")); const digest = manifestDigest(manifest); const candidate = candidateDatabase(database, manifest);
if (manifest.testFixture === true && !testFixture) throw new Error("Test fixture manifests require --test-fixture.");
if (manifest.testFixture !== true && testFixture) throw new Error("--test-fixture requires a test fixture manifest.");
if (report.database !== candidate || report.sourceSha256 !== manifest.sourceSha256 || report.manifestDigest !== digest || !Array.isArray(report.blockingDifferences) || report.blockingDifferences.length) throw new Error("Publication requires a clean reconciliation report for this exact candidate and manifest.");
const url = mysqlUrlFromSecret({ file: option("--mysql-secrets-file"), stdin: args.includes("--mysql-secrets-stdin"), purpose: "ingestUrl" }); const connection = await connect(url, database);
try {
  await createMetadata(connection); const [runs] = await connection.query(`SELECT status FROM ${quoteIdentifier(candidate)}.ingest_run WHERE manifest_digest = ?`, [digest]); if (runs[0]?.status !== "materialized") throw new Error("Candidate is not materialized.");
  const reconciliationDigest = sha256(JSON.stringify(report)); await connection.query("INSERT INTO scientific_publication_event (candidate_database, source_sha256, manifest_digest, reconciliation_digest, published_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))", [candidate, manifest.sourceSha256, digest, reconciliationDigest]);
  console.log(JSON.stringify({ candidate, manifestDigest: digest, reconciliationDigest, status: "published" }));
} finally { await connection.end(); }
