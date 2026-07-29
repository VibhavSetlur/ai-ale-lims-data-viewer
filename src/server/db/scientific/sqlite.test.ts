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
  db.exec("CREATE TABLE samples (id INTEGER PRIMARY KEY, name TEXT, deleted INTEGER); INSERT INTO samples VALUES (1, 'alpha', 0), (2, '=formula', 0), (3, 'removed', 1)");
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

  it("opens a query-only handle", () => {
    const repository = fixture() as unknown as { db: Database.Database };
    expect(() => repository.db.exec("DELETE FROM samples")).toThrow();
  });
});
