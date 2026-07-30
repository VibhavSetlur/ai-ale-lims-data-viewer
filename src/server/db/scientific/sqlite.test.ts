import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SNAPSHOT_ID } from "../../../modules/snapshots/catalog/repository";
import { SqliteScientificRepository } from "./sqlite";

let directory: string | undefined;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

function fixture(): SqliteScientificRepository {
  directory = mkdtempSync(join(tmpdir(), "scientific-catalog-"));
  const path = join(directory, "fixture.db");
  const db = new Database(path);
  db.exec("CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT, deleted INTEGER); INSERT INTO samples VALUES (1, 'alpha', 0), (2, '=formula', 0), (3, 'removed', 1); CREATE TABLE Mutations (Seq_sample TEXT, Experiment TEXT, Breseq_registry_ID TEXT, gene_name TEXT, position INTEGER, frequency REAL, type TEXT); INSERT INTO Mutations VALUES ('s1', 'e1', 'r1', 'gyrA', 42, 0.4, 'SNP'), ('s2', 'e1', 'r1', 'gyrA', 42, 0.7, 'SNP'); CREATE TABLE Robotic_OD (sample_name TEXT, transfer INTEGER, od REAL, timepoint INTEGER); INSERT INTO Robotic_OD VALUES ('s1', 1, 0.2, 1), ('s1', 1, 0.5, 2); CREATE TABLE Copy_numbers (Seqsample TEXT, Region_name TEXT, Region_CN REAL); INSERT INTO Copy_numbers VALUES ('s1', 'region-1', 1.5); CREATE TABLE verAB_barcodes (Seqsample TEXT, Candidate TEXT, Count INTEGER); INSERT INTO verAB_barcodes VALUES ('s1', 'A1-B1', 10)");
  db.close();
  return new SqliteScientificRepository(path);
}

describe("SQLite scientific repository", () => {
  it("uses allowlisted identifiers, hides soft-deleted rows, and exports safe deterministic CSV", () => {
    const repository = fixture();
    expect(repository.getRows({ snapshotId: CURRENT_SNAPSHOT_ID, table: "samples", limit: 10, sort: [{ column: "id", direction: "asc" }] })).toMatchObject({ totalCount: 2, rows: [{ id: 1 }, { id: 2 }] });
    expect(() => repository.getRows({ snapshotId: CURRENT_SNAPSHOT_ID, table: "samples; DROP TABLE samples", limit: 1 })).toThrow("Table not found");
    expect(repository.exportRows({ snapshotId: CURRENT_SNAPSHOT_ID, table: "samples", limit: 10, columns: ["id", "name"] }).csv).toContain("'=formula");
  });

  it("paginates and exports the complete filtered result within the explicit limit", () => {
    const repository = fixture();
    const first = repository.getRows({ snapshotId: CURRENT_SNAPSHOT_ID, table: "samples", limit: 1, sort: [{ column: "id", direction: "asc" }] });
    expect(first.rows).toEqual([{ id: 1, name: "alpha", deleted: 0 }]);
    expect(first.nextCursor).toBeTruthy();
    expect(repository.getRows({ snapshotId: CURRENT_SNAPSHOT_ID, table: "samples", limit: 1, sort: [{ column: "id", direction: "asc" }], cursor: first.nextCursor! }).rows).toEqual([{ id: 2, name: "=formula", deleted: 0 }]);
    expect(repository.exportRows({ snapshotId: CURRENT_SNAPSHOT_ID, table: "samples", limit: 1, columns: ["id", "name"] }).csv).toBe("id,name\r\n1,alpha\r\n2,'=formula");
  });

  it("derives normalized mutation analyses and treats populated barcodes as a capability", () => {
    const repository = fixture(); const request = { snapshotId: CURRENT_SNAPSHOT_ID, experimentKey: "e1", registryKey: "r1", sampleKeys: ["s1", "s2"] };
    expect(repository.capabilities().hasBarcodes).toBe(true);
    expect(repository.cohort({ snapshotId: CURRENT_SNAPSHOT_ID, experimentKey: "e1" }).samples).toEqual([{ key: "s1" }, { key: "s2" }]);
    expect(repository.compareMutations(request).rows).toMatchObject([{ gene: "gyrA", values: { s1: 0.4, s2: 0.7 } }]);
    expect(repository.compareGrowth(request).rows).toEqual([{ sampleKey: "s1", transfer: 1, endpointOd: 0.5, maxOd: 0.5 }]);
    expect(repository.compareCopyNumber(request).rows).toEqual([{ sampleKey: "s1", region: "region-1", value: 1.5 }]);
    expect(repository.compareLibraryVariants(request).rows).toMatchObject([{ sampleKey: "s1", variant: "A1-B1", abundance: 1 }]);
    expect(() => repository.compareGrowth({ ...request, registryKey: "other" })).toThrow("outside the requested experiment or registry");
  });

  it("opens a query-only handle", () => {
    const repository = fixture() as unknown as { db: Database.Database };
    expect(() => repository.db.exec("DELETE FROM samples")).toThrow();
  });
});
