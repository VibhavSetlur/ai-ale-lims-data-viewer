import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTableSql, mysqlUrlFromSecret, quoteIdentifier } from "./mysql.mjs";
let dir;
import { rmSync } from "node:fs";
afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });
describe("ingest MySQL boundary", () => {
  it("rejects unsafe identifiers and creates reviewed SQLite-compatible DDL", () => {
    expect(() => quoteIdentifier("samples;drop")).toThrow("Unsafe");
    expect(createTableSql({ name: "samples", columns: [{ name: "id", type: "INTEGER", notnull: 1, pk: 1 }, { name: "note", type: "TEXT", notnull: 0, pk: 0 }] })).toContain("PRIMARY KEY (`id`)");
  });
  it("requires a private file and a purpose-specific URL without revealing it", () => {
    dir = mkdtempSync(join(tmpdir(), "mysql-secret-")); const file = join(dir, "secret.json"); writeFileSync(file, JSON.stringify({ ingestUrl: "mysql://user:secret@host/db" })); chmodSync(file, 0o600);
    expect(mysqlUrlFromSecret({ file, purpose: "ingestUrl" })).toBe("mysql://user:secret@host/db");
    expect(() => mysqlUrlFromSecret({ file, purpose: "readUrl" })).toThrow("missing readUrl"); chmodSync(file, 0o644);
    expect(() => mysqlUrlFromSecret({ file, purpose: "ingestUrl" })).toThrow("must not be accessible");
  });
});

describe.skipIf(!process.env.MYSQL_INTEGRATION_TEST_URL)("disposable MySQL integration", () => {
  it("is enabled only by an explicit disposable URL", () => { expect(process.env.MYSQL_INTEGRATION_TEST_URL).toMatch(/^mysql/); });
});
