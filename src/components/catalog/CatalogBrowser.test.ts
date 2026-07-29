import { describe, expect, it } from "vitest";
import { filterLabel, noValue, rowsQuery, schemaDescription } from "./catalog-state";

describe("catalog browser query controls", () => {
  it("creates a bounded rows query with the active catalog state", () => {
    expect(rowsQuery("samples", "snapshot-1", { search: "abc", includeDeleted: true, sort: [{ column: "id", direction: "desc" }] })).toMatchObject({ table: "samples", snapshotId: "snapshot-1", limit: 50, search: "abc", includeDeleted: true });
  });
  it("recognizes filters without values and preserves readable chips", () => {
    expect(noValue("isNull")).toBe(true);
    expect(noValue("contains")).toBe(false);
    expect(filterLabel({ column: "deleted", operator: "isNull" })).toBe("deleted isNull");
  });
  it("formats schema metadata from the rows result contract", () => {
    expect(schemaDescription({ key: "sample_id", label: "Sample ID", type: "string", nullable: false })).toBe("sample_id · string · required");
  });
});
