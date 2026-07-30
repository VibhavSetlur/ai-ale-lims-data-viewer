import { describe, expect, it } from "vitest";
import { filterLabel, noValue, rowsQuery, schemaDescription } from "./catalog-state";

// Axe accessibility assertions for the catalog browser are in tests/e2e/catalog.spec.ts
// using @axe-core/playwright (requires a real browser context).

describe("catalog browser query controls", () => {
  it("creates a bounded rows query with the active catalog state", () => {
    expect(rowsQuery("samples", "snapshot-1", { search: "abc", includeDeleted: true, sort: [{ column: "id", direction: "desc" }] })).toMatchObject({ table: "samples", snapshotId: "snapshot-1", limit: 100, search: "abc", includeDeleted: true });
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

describe("export column cap", () => {
  it("MAX_EXPORT_COLUMNS is 100", async () => {
    const { MAX_EXPORT_COLUMNS } = await import("./ExportDialog");
    expect(MAX_EXPORT_COLUMNS).toBe(100);
  });

  it("noValue from CatalogFilters matches catalog-state noValue", async () => {
    const { noValue: noValueFilters } = await import("./CatalogFilters");
    expect(noValueFilters("isNull")).toBe(true);
    expect(noValueFilters("isNotNull")).toBe(true);
    expect(noValueFilters("eq")).toBe(false);
  });
});
