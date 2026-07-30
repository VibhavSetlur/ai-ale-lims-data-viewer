import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { candidateDatabase, createIndexSql, createTableSql, mysqlUrlFromSecret, quoteIdentifier } from "./mysql.mjs";
let dir;
import { rmSync } from "node:fs";
afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });
describe("ingest MySQL boundary", () => {
  it("rejects unsafe identifiers and creates primary key DDL", () => { expect(() => quoteIdentifier("samples;drop")).toThrow("Unsafe"); expect(createTableSql({ name: "samples", columns: [{ name: "id", type: "INTEGER", notnull: 1, pk: 1 }] })).toContain("PRIMARY KEY (`id`)"); });
  it("preserves reviewed index order and fails closed for unsupported affinities", () => { expect(createIndexSql({ name: "samples" }, { name: "sample_note", unique: false, origin: "c", columns: [{ name: "note", desc: true }] })).toContain("`note` DESC"); expect(() => createTableSql({ name: "samples", columns: [{ name: "value", type: "JSON", notnull: 0, pk: 0 }] })).toThrow("Unsupported"); });
  it("uses a deterministic candidate name instead of the serving database", () => { expect(candidateDatabase("scientific", { sourceSha256: "a".repeat(64) })).toBe("scientific__candidate_aaaaaaaaaaaaaaaa"); });
  it("requires a private file and a purpose-specific URL without revealing it", () => { dir = mkdtempSync(join(tmpdir(), "mysql-secret-")); const file = join(dir, "secret.json"); writeFileSync(file, JSON.stringify({ ingestUrl: "mysql://user:secret@host/db" })); chmodSync(file, 0o600); expect(mysqlUrlFromSecret({ file, purpose: "ingestUrl" })).toBe("mysql://user:secret@host/db"); expect(() => mysqlUrlFromSecret({ file, purpose: "readUrl" })).toThrow("missing readUrl"); chmodSync(file, 0o644); expect(() => mysqlUrlFromSecret({ file, purpose: "ingestUrl" })).toThrow("must not be accessible"); });
});

describe.skipIf(!process.env.MYSQL_INTEGRATION_TEST_URL)("disposable MySQL integration", () => {
  it("creates and destroys an explicitly named disposable schema", async () => {
    const mysql = (await import("mysql2/promise")).default; const url = process.env.MYSQL_INTEGRATION_TEST_URL; if (!url?.startsWith("mysql:")) throw new Error("MYSQL_INTEGRATION_TEST_URL must be a MySQL URL."); const name = `aiale_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; const connection = await mysql.createConnection(url);
    try { await connection.query(`CREATE DATABASE ${quoteIdentifier(name)}`); await connection.query(`CREATE TABLE ${quoteIdentifier(name)}.items (id INT PRIMARY KEY, value VARCHAR(20))`); await connection.query(`INSERT INTO ${quoteIdentifier(name)}.items VALUES (1, 'ok')`); const [rows] = await connection.query(`SELECT value FROM ${quoteIdentifier(name)}.items`); expect(rows[0].value).toBe("ok"); } finally { await connection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`); await connection.end(); }
  });
});
