import { describe, expect, it } from "vitest";
import { GET as current } from "./current/route";
import { GET as snapshots } from "./snapshots/route";
import { GET as snapshot } from "./snapshots/[snapshotId]/route";

const headers = { "x-request-id": "req-catalog", "x-correlation-id": "cor-catalog" };

describe("catalog routes", () => {
  it("returns the current snapshot in a success envelope with request IDs", async () => {
    const response = current(new Request("http://localhost/api/v1/catalog/current", { headers }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { snapshotId: "dev-full-20260726-a86df340" },
      request: { requestId: "req-catalog", correlationId: "cor-catalog" },
    });
  });

  it("lists catalog snapshots without leaking the source path", async () => {
    const response = snapshots(new Request("http://localhost/api/v1/catalog/snapshots", { headers }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.defaultSnapshotId).toBe("dev-full-20260726-a86df340");
    expect(JSON.stringify(body)).not.toContain("sourcePath");
    expect(JSON.stringify(body)).not.toContain("lims_indexed.db");
  });

  it("returns a redacted 404 envelope for an unknown snapshot", async () => {
    const response = await snapshot(new Request("http://localhost/api/v1/catalog/snapshots/unknown", { headers }), { params: Promise.resolve({ snapshotId: "unknown" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "SNAPSHOT_NOT_FOUND", message: "Snapshot not found." },
      request: { requestId: "req-catalog", correlationId: "cor-catalog" },
    });
  });
});
