import { describe, expect, it } from "vitest";
import { success } from "./envelope";
import { AppError } from "../errors/AppError";
import { scientificReference } from "../validation";

describe("shared contracts", () => {
  it("retains request and correlation IDs in a success envelope", () => {
    expect(success({ value: 1 }, { requestId: "req-1", correlationId: "cor-1" })).toEqual({ ok: true, data: { value: 1 }, request: { requestId: "req-1", correlationId: "cor-1" } });
  });
  it("requires every scientific reference field", () => {
    expect(() => scientificReference({ snapshotId: "s", entityType: "sample", sourceKey: "" })).toThrow(AppError);
  });
  it("redacts errors to stable public fields", () => {
    expect(new AppError("NOT_FOUND", "Missing", { secret: "hidden" }).toPublic()).toEqual({ code: "NOT_FOUND", message: "Missing" });
  });
});
