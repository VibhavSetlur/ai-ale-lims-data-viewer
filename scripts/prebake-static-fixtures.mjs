import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

const output = new URL("../public/static-data/", import.meta.url);
const provenance = { snapshotId: "fixture-full-v1", label: "Sanitized static fixture", sourceSystem: "generated-fixture", sourceRevision: null, sourceSha256: "0".repeat(64), sourceUpdatedAt: null, receivedAt: "2026-07-29T00:00:00.000Z", materializedAt: "2026-07-29T00:00:00.000Z", schemaVersion: "v1", schemaFingerprint: "generated-fixture", manifestDigest: null };
const capabilities = (hasBarcodes) => ({ snapshotId: provenance.snapshotId, hasBarcodes, capabilities: { mutations: { available: true }, libraryVariants: hasBarcodes ? { available: true } : { available: false, reason: "No barcode records are present." } } });
const cohort = (hasBarcodes) => ({ experiments: [{ key: "fixture-experiment" }], registries: [{ key: "fixture-registry" }], samples: [{ key: "fixture-sample-a" }, { key: "fixture-sample-b" }], facets: {}, selectedKeyValidity: {}, warnings: [], capabilities: capabilities(hasBarcodes), provenance });
const result = (hasBarcodes) => ({ rows: [{ sampleKey: "fixture-sample-a", value: 1 }], summary: { resultCount: 1, sampleCount: 1 }, warnings: [], derivationVersion: "v1", capabilities: capabilities(hasBarcodes), provenance });
const envelope = (data) => ({ ok: true, data, request: { requestId: "static-fixture", correlationId: "static-fixture" } });
const artifacts = {
  "GET /api/v1/mutations/cohort": envelope(cohort(true)),
  "POST /api/v1/mutations/compare": envelope(result(true)),
  "POST /api/v1/mutations/growth": envelope(result(true)),
  "POST /api/v1/mutations/library-variants": envelope(result(true)),
  "POST /api/v1/mutations/copy-number": envelope(result(true)),
};
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const manifest = { formatVersion: 1, generatedFrom: "sanitized-fixtures-only", provenance, capabilities: capabilities(true), artifacts: {} };
for (const [key, body] of Object.entries(artifacts)) {
  const file = `${createHash("sha256").update(key).digest("hex")}.json`;
  const text = `${JSON.stringify(body)}\n`;
  manifest.artifacts[key] = { file, sha256: createHash("sha256").update(text).digest("hex") };
  await writeFile(new URL(file, output), text);
}
await writeFile(new URL("manifest.json", output), `${JSON.stringify(manifest, null, 2)}\n`);
