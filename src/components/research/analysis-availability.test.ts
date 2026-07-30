import { describe, expect, it } from "vitest";
import { analysisUnavailableReason } from "./analysis-availability";

describe("analysis availability", () => {
  it("never offers library variants when experiment scope cannot be proven", () => {
    expect(analysisUnavailableReason("library-variants", true)).toBe(
      "Library variants is unavailable because this snapshot cannot prove the required experiment scope.",
    );
    expect(analysisUnavailableReason("library-variants", false)).toBe(
      "Library variants is unavailable because this snapshot cannot prove the required experiment scope and has no barcode records.",
    );
  });

  it("leaves supported analyses available", () => {
    expect(analysisUnavailableReason("compare", true)).toBeUndefined();
    expect(analysisUnavailableReason("growth", true)).toBeUndefined();
  });
});
