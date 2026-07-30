import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as live } from "./live/route";
import { GET as ready } from "./ready/route";
import { GET as compatibility } from "../../health/route";
import { resetScientificRepositoryForTests } from "../../../../server/db/scientific";

const directories: string[] = [];

afterEach(() => {
  delete process.env.LEGACY_SQLITE_PATH;
  resetScientificRepositoryForTests();
  vi.restoreAllMocks();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function legacySnapshot(): string {
  const directory = mkdtempSync(join(tmpdir(), "viewer2-health-"));
  directories.push(directory);
  const path = join(directory, "snapshot.sqlite");
  const database = new Database(path);
  database.exec("CREATE TABLE Mutations (Seq_sample TEXT, Experiment TEXT)");
  database.close();
  return path;
}

describe("health routes", () => {
  it("reports liveness without a scientific database", async () => {
    const response = live(new Request("http://localhost/api/v1/health/live", { headers: { "x-request-id": "live-1" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { status: "live" }, request: { requestId: "live-1", correlationId: "live-1" } });
  });

  it("fails readiness when the scientific SQLite snapshot is unavailable", async () => {
    const response = await ready(new Request("http://localhost/api/v1/health/ready", { headers: { "x-request-id": "ready-1" } }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Scientific catalog is unavailable.", retryable: true }, request: { requestId: "ready-1", correlationId: "ready-1" } });
  });

  it("does not require an operational database for legacy SQLite readiness", async () => {
    process.env.LEGACY_SQLITE_PATH = legacySnapshot();
    const response = await ready(new Request("http://localhost/api/v1/health/ready"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { status: "ready", profile: "legacy" } });
  });

  it("adapts readiness to a safe legacy health payload", async () => {
    process.env.LEGACY_SQLITE_PATH = legacySnapshot();
    const response = await compatibility();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", db: { driver: "sqlite", ok: true } });
  });

  it("returns a safe service-unavailable payload when the SQLite snapshot is missing", async () => {
    const response = await compatibility();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable", db: { ok: false } });
  });
});
