import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { staticArtifactApi } from "./static-data";

const full = { ok: true, data: { capabilities: { hasBarcodes: true } } };
const none = { ok: true, data: { capabilities: { hasBarcodes: false } } };
function response(value: unknown) { return new Response(JSON.stringify(value)); }
function fetcherFor(body: unknown) {
  const text = JSON.stringify(body);
  const sha256 = createHash("sha256").update(text).digest("hex");
  return async (input: string | URL | Request) => String(input).endsWith("manifest.json")
    ? response({ artifacts: { "GET /api/v1/mutations/cohort": { file: "cohort.json", sha256 } } })
    : response(body);
}

describe("static artifacts", () => {
  it("round-trips a full fixture through the adapter", async () => {
    await expect(staticArtifactApi<typeof full.data>("/api/v1/mutations/cohort?snapshotId=fixture", undefined, fetcherFor(full) as typeof fetch)).resolves.toEqual(full.data);
  });

  it("preserves no-barcode capability gating", async () => {
    const data = await staticArtifactApi<typeof none.data>("/api/v1/mutations/cohort", undefined, fetcherFor(none) as typeof fetch);
    expect(data.capabilities.hasBarcodes).toBe(false);
  });

  it("rejects an artifact whose checksum differs from its manifest", async () => {
    const fetcher = async (input: string | URL | Request) => String(input).endsWith("manifest.json")
      ? response({ artifacts: { "GET /api/v1/mutations/cohort": { file: "cohort.json", sha256: "0".repeat(64) } } })
      : response(full);
    await expect(staticArtifactApi("/api/v1/mutations/cohort", undefined, fetcher as typeof fetch)).rejects.toThrow("checksum");
  });
});
