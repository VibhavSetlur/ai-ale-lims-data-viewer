import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";
import { afterEach, describe, expect, it } from "vitest";
import { APPROVED_SOURCE_SHA256, inspectSqlite } from "./manifest.mjs";
const { legacyInventory: APPROVED_LEGACY_INVENTORY, inventorySha256: APPROVED_LEGACY_INVENTORY_SHA256 } = JSON.parse(readFileSync(new URL("./approvedInventory.json", import.meta.url), "utf8"));
import { candidateDatabase, chunkHash, createIndexSql, createTableSql, mysqlUrlFromSecret, quoteIdentifier } from "./mysql.mjs";
let dir;
afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });
describe("ingest MySQL boundary", () => {
  it("rejects unsafe identifiers and creates primary key DDL", () => { expect(() => quoteIdentifier("samples;drop")).toThrow("Unsafe"); expect(createTableSql({ name: "samples", columns: [{ name: "id", type: "INTEGER", notnull: 1, pk: 1 }] })).toContain("PRIMARY KEY (`id`)"); });
  it("preserves reviewed index order and fails closed for unsupported affinities", () => { expect(createIndexSql({ name: "samples" }, { name: "sample_note", unique: false, origin: "c", columns: [{ name: "note", desc: true }] })).toContain("`note` DESC"); expect(() => createTableSql({ name: "samples", columns: [{ name: "value", type: "JSON", notnull: 0, pk: 0 }] })).toThrow("Unsupported"); });
  it("uses a deterministic candidate name instead of the serving database", () => { expect(candidateDatabase("scientific", { sourceSha256: "a".repeat(64) })).toBe("scientific__candidate_aaaaaaaaaaaaaaaa"); });
  it("requires a private file and a purpose-specific URL without revealing it", () => { dir = mkdtempSync(join(tmpdir(), "mysql-secret-")); const file = join(dir, "secret.json"); writeFileSync(file, JSON.stringify({ ingestUrl: "mysql://user:secret@host/db" })); chmodSync(file, 0o600); expect(mysqlUrlFromSecret({ file, purpose: "ingestUrl" })).toBe("mysql://user:secret@host/db"); expect(() => mysqlUrlFromSecret({ file, purpose: "readUrl" })).toThrow("missing readUrl"); chmodSync(file, 0o644); expect(() => mysqlUrlFromSecret({ file, purpose: "ingestUrl" })).toThrow("must not be accessible"); });
  it("pins inspection to the approved source before opening SQLite and hashes chunks deterministically", () => { dir = mkdtempSync(join(tmpdir(), "sqlite-source-")); const sqlite = join(dir, "source.db"); const db = new Database(sqlite); db.exec("CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT)"); db.close(); expect(() => inspectSqlite(sqlite)).toThrow("required source checksum"); expect(() => inspectSqlite(sqlite, "b".repeat(64))).toThrow("approved source checksum"); expect(chunkHash([{ id: 1 }, { id: 2 }])).toBe(chunkHash([{ id: 1 }, { id: 2 }])); expect(APPROVED_SOURCE_SHA256).toHaveLength(64); });
  it("keeps a checksum-verified application-owned scientific inventory", () => { expect(APPROVED_LEGACY_INVENTORY).toHaveLength(27); expect(APPROVED_LEGACY_INVENTORY_SHA256).toMatch(/^[a-f0-9]{64}$/); expect(APPROVED_LEGACY_INVENTORY.find((table) => table.name === "Mutations")?.columns.some((column) => column.name === "Seq_sample")).toBe(true); });
});

describe.skipIf(!process.env.MYSQL_INTEGRATION_TEST_URL)("disposable MySQL importer lifecycle", () => {
  it("materializes, reconciles, publishes append-only, and retries an interrupted candidate", async () => {
    const url = process.env.MYSQL_INTEGRATION_TEST_URL; if (!url?.startsWith("mysql:")) throw new Error("MYSQL_INTEGRATION_TEST_URL must be a MySQL URL.");
    dir = mkdtempSync(join(tmpdir(), "aiale-mysql-integration-")); const sqlite = join(dir, "source.db"), manifest = join(dir, "manifest.json"), report = join(dir, "report.json"), secrets = join(dir, "secrets.json"), fixture = join(dir, "fixture.json"); const database = `aiale_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const source = new Database(sqlite); source.exec("CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT, deleted INTEGER DEFAULT 0); INSERT INTO samples VALUES (1, 'alpha', 0), (2, '=formula', 0)"); source.close(); const sourceSha256 = (await import("node:crypto")).createHash("sha256").update(readFileSync(sqlite)).digest("hex"); writeFileSync(fixture, JSON.stringify({ sourceSha256, legacyInventory: [{ name: "samples", columns: [{ name: "id", type: "INTEGER", notnull: 0, pk: 1 }, { name: "name", type: "TEXT", notnull: 0, pk: 0 }, { name: "deleted", type: "INTEGER", notnull: 0, pk: 0 }] }] })); writeFileSync(secrets, JSON.stringify({ ingestUrl: url, readUrl: url })); chmodSync(secrets, 0o600);
    const root = await mysql.createConnection(url);
    try {
      await root.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
      const run = (script, extra = []) => execFileSync(process.execPath, [resolve(process.cwd(), "scripts/ingest", script), ...extra, "--mysql-secrets-file", secrets], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
       run("inspect.mjs", ["--sqlite", sqlite, "--out", manifest, "--test-fixture", fixture]); run("stage.mjs", ["--sqlite", sqlite, "--manifest", manifest, "--database", database, "--test-fixture", fixture]);
             run("reconcile.mjs", ["--sqlite", sqlite, "--manifest", manifest, "--database", database, "--out", report, "--test-fixture", fixture]); run("publish.mjs", ["--manifest", manifest, "--report", report, "--database", database, "--test-fixture"]); run("publish.mjs", ["--manifest", manifest, "--report", report, "--database", database, "--test-fixture"]);
      const candidate = candidateDatabase(database, JSON.parse((await import("node:fs")).readFileSync(manifest, "utf8"))); const [events] = await root.query(`SELECT event_id FROM ${quoteIdentifier(database)}.scientific_publication_event`); expect(events).toHaveLength(2); const [rows] = await root.query(`SELECT name FROM ${quoteIdentifier(candidate)}.samples ORDER BY id`); expect(rows.map((row) => row.name)).toEqual(["alpha", "=formula"]);
       await root.query(`DROP DATABASE ${quoteIdentifier(candidate)}`); expect(() => run("stage.mjs", ["--sqlite", sqlite, "--manifest", manifest, "--database", database, "--test-fixture", fixture])).not.toThrow();
    } finally { await root.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`); await root.end(); }
  });
});
