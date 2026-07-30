import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { staticArtifactApi, staticManifest } from "./static-data";

const provenance = { snapshotId: "fixture-full-v1", label: "Fixture", sourceSystem: "fixture", sourceRevision: null, sourceSha256: "0".repeat(64), sourceUpdatedAt: null, receivedAt: "2026-07-29T00:00:00.000Z", materializedAt: null, schemaVersion: "v1", schemaFingerprint: "fixture", manifestDigest: null };
const capabilities = (hasBarcodes: boolean) => ({ snapshotId: provenance.snapshotId, hasBarcodes, capabilities: { catalog: { available: true }, barcodes: { available: hasBarcodes } } });
const full = { ok: true, data: { capabilities: { hasBarcodes: true } } };
const none = { ok: true, data: { capabilities: { hasBarcodes: false } } };
function response(value: unknown) { return new Response(JSON.stringify(value)); }
function fetcherFor(body: unknown, hasBarcodes = true) {
  const text = JSON.stringify(body);
  const sha256 = createHash("sha256").update(text).digest("hex");
  return async (input: string | URL | Request) => String(input).endsWith("manifest.json")
    ? response({ provenance, capabilities: capabilities(hasBarcodes), artifacts: { "GET /api/v1/mutations/cohort": { file: "cohort.json", sha256 } } })
    : response(body);
}

describe("static artifacts", () => {
  it("round-trips a full fixture through the adapter", async () => {
    await expect(staticArtifactApi<typeof full.data>("/api/v1/mutations/cohort?snapshotId=fixture", undefined, fetcherFor(full) as typeof fetch)).resolves.toEqual(full.data);
  });
  it("derives static metadata and barcode availability from the manifest", async () => {
    const manifest = await staticManifest(fetcherFor(none, false) as typeof fetch);
    expect(manifest.provenance.snapshotId).toBe("fixture-full-v1");
    expect(manifest.capabilities.hasBarcodes).toBe(false);
  });
  it("rejects missing or inconsistent manifest metadata", async () => {
    const malformed = async () => response({ artifacts: {} });
    await expect(staticManifest(malformed as typeof fetch)).rejects.toThrow("metadata");
  });
  it("rejects an artifact whose checksum differs from its manifest", async () => {
    const fetcher = async (input: string | URL | Request) => String(input).endsWith("manifest.json")
      ? response({ provenance, capabilities: capabilities(true), artifacts: { "GET /api/v1/mutations/cohort": { file: "cohort.json", sha256: "0".repeat(64) } } })
      : response(full);
    await expect(staticArtifactApi("/api/v1/mutations/cohort", undefined, fetcher as typeof fetch)).rejects.toThrow("checksum");
  });
});
