import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteScientificRepository } from "../../server/db/scientific/sqlite";
import { runApiContractFixtures, type ApiContractFixture } from "./api-contract-fixtures";

let directory: string | undefined;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

function fixture() {
  directory = mkdtempSync(join(tmpdir(), "api-contract-fixtures-"));
  const path = join(directory, "fixture.db"); const db = new Database(path);
  db.exec("CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT, deleted INTEGER); INSERT INTO samples VALUES (1, 'alpha', 0), (2, '=formula', 0); CREATE TABLE Mutations (Seq_sample TEXT, Experiment TEXT, Breseq_registry_ID TEXT, gene_name TEXT, position INTEGER, frequency REAL, type TEXT); INSERT INTO Mutations VALUES ('s1', 'e1', 'r1', 'gyrA', 42, 0.4, 'SNP'), ('s2', 'e1', 'r1', 'gyrA', 42, 0.7, 'SNP'); CREATE TABLE Robotic_OD (sample_name TEXT, transfer INTEGER, od REAL, timepoint INTEGER); INSERT INTO Robotic_OD VALUES ('s1', 1, 0.5, 2); CREATE TABLE Copy_numbers (Seqsample TEXT, Region_name TEXT, Region_CN REAL); INSERT INTO Copy_numbers VALUES ('s1', 'region-1', 1.5); CREATE TABLE verAB_barcodes (Seqsample TEXT, Candidate TEXT, Count INTEGER); INSERT INTO verAB_barcodes VALUES ('s1', 'A1-B1', 10)"); db.close(); return new SqliteScientificRepository(path);
}

const contracts: ApiContractFixture[] = [
  { name: "capabilities", method: "GET", path: "/api/v1/capabilities?snapshotId=sqlite-placeholder" },
  { name: "rows", method: "POST", path: "/api/v1/catalog/rows", body: { snapshotId: "sqlite-placeholder", table: "samples", limit: 10 } },
  { name: "export", method: "POST", path: "/api/v1/catalog/export", body: { snapshotId: "sqlite-placeholder", table: "samples", limit: 10, columns: ["id", "name"] } },
  { name: "cohort", method: "GET", path: "/api/v1/mutations/cohort?snapshotId=sqlite-placeholder&experimentKey=e1&registryKey=r1" },
  { name: "mutation", method: "POST", path: "/api/v1/mutations/compare", body: { snapshotId: "sqlite-placeholder", experimentKey: "e1", registryKey: "r1", sampleKeys: ["s1", "s2"] } },
  { name: "growth", method: "POST", path: "/api/v1/mutations/growth", body: { snapshotId: "sqlite-placeholder", experimentKey: "e1", registryKey: "r1", sampleKeys: ["s1", "s2"] } },
  { name: "library", method: "POST", path: "/api/v1/mutations/library-variants", body: { snapshotId: "sqlite-placeholder", experimentKey: "e1", registryKey: "r1", sampleKeys: ["s1", "s2"] } },
  { name: "copy", method: "POST", path: "/api/v1/mutations/copy-number", body: { snapshotId: "sqlite-placeholder", experimentKey: "e1", registryKey: "r1", sampleKeys: ["s1", "s2"] } },
];

describe("API contract fixtures", () => {
  it("executes handlers with an injected repository and preserves export bytes", async () => {
    const results = await runApiContractFixtures(fixture(), contracts);
    expect(Object.values(results).every((result) => result.status === 200)).toBe(true);
    expect(results.export.csv).toBe("id,name\r\n1,alpha\r\n2,'=formula");
    expect(results.mutation.payload).toMatchObject({ ok: true, data: { warnings: [] } });
    expect(results.capabilities.payload).toMatchObject({ ok: true, data: { hasBarcodes: true } });
  });
});
