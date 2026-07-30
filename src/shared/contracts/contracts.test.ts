import { describe, expect, it } from "vitest";
import { success } from "./envelope";
import { AppError } from "../errors/AppError";
import { scientificReference } from "../validation";
import { filterSchema, rowsQuerySchema } from "./catalog";
import { mutationReadRequestSchema } from "./mutations";
import { capabilityManifestSchema } from "./capability";
import { snapshotProvenanceSchema } from "./provenance";

describe("shared contracts", () => {
  it("retains request and correlation IDs in a success envelope", () => {
    expect(success({ value: 1 }, { requestId: "req-1", correlationId: "cor-1" })).toEqual({ ok: true, data: { value: 1 }, request: { requestId: "req-1", correlationId: "cor-1" } });
  });
  it("requires every scientific reference field", () => {
    expect(() => scientificReference({ snapshotId: "s", entityType: "sample", sourceKey: "" })).toThrow(AppError);
  });
  it("redacts errors to stable public fields", () => {
    expect(new AppError("NOT_FOUND", "Missing", { secret: "hidden" }).toPublic()).toEqual({ code: "NOT_FOUND", message: "Missing", retryable: false });
  });
  it("validates bounded catalog filters and pagination", () => {
    expect(rowsQuerySchema.parse({ snapshotId: "snapshot-1", table: "samples", where: { combinator: "and", filters: [{ column: "deleted", operator: "eq", value: false }] }, limit: 100 })).toMatchObject({ limit: 100 });
    expect(() => filterSchema.parse({ column: "deleted", operator: "isNull", value: false })).toThrow();
    expect(() => rowsQuerySchema.parse({ snapshotId: "snapshot-1", table: "samples", limit: 1001 })).toThrow();
  });
  it("requires stable mutation selection keys", () => {
    expect(mutationReadRequestSchema.parse({ snapshotId: "snapshot-1", experimentKey: "exp-1", sampleKeys: ["sample-1"] })).toMatchObject({ experimentKey: "exp-1" });
    expect(() => mutationReadRequestSchema.parse({ snapshotId: "snapshot-1", experimentKey: "exp-1", sampleKeys: [] })).toThrow();
  });
  it("retains optional shared response metadata", () => {
    expect(success({ value: 1 }, { requestId: "req-1", correlationId: "cor-1" }, { snapshotId: "snapshot-1", nextCursor: "cursor-2" })).toMatchObject({ meta: { snapshotId: "snapshot-1", nextCursor: "cursor-2" } });
  });
  it("validates shared capability and public provenance metadata", () => {
    expect(capabilityManifestSchema.parse({ snapshotId: "snapshot-1", hasBarcodes: true, capabilities: { barcodes: { available: true } } })).toMatchObject({ hasBarcodes: true });
    expect(snapshotProvenanceSchema.parse({ snapshotId: "snapshot-1", label: "snapshot", sourceSystem: "NSpAHR", sourceRevision: null, sourceSha256: "a".repeat(64), sourceUpdatedAt: null, receivedAt: "2026-07-29T00:00:00.000Z", materializedAt: null, schemaVersion: "1", schemaFingerprint: "schema-1", manifestDigest: null })).toMatchObject({ sourceSystem: "NSpAHR" });
  });
});
