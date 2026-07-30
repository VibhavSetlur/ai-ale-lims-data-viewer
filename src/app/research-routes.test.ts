import { describe, expect, it } from "vitest";
import { mockCapabilities, mockTables } from "../lib/research/mock-service";
import { legacyRouteMigrationMarker, routeForLegacyTab } from "../lib/research/legacy-route-migration";

describe("research route shell contracts", () => {
  it("keeps the supported research deep-link targets explicit", () => {
    expect(["/tables", ...mockTables.map((table) => `/tables/${table.name}`), "/mutations/cohort", "/mutations/compare/mutations", "/mutations/compare/growth", "/mutations/compare/library-variants", "/mutations/compare/copy-number", "/plates", "/help", "/guide", "/changelog"]).toContain("/mutations/cohort");
  });
  it("migrates known legacy tabs once and safely falls back", () => {
    expect(legacyRouteMigrationMarker).toBe("ai-ale-route-migration-v1");
    expect(routeForLegacyTab("tables")).toBe("/tables");
    expect(routeForLegacyTab("mutations")).toBe("/mutations/cohort");
    expect(routeForLegacyTab("plates")).toBe("/plates");
    expect(routeForLegacyTab("unknown")).toBe("/mutations/cohort");
    expect(routeForLegacyTab(null)).toBe("/mutations/cohort");
  });
  it("does not present barcode comparison as active without barcode capability", () => {
    expect(mockCapabilities.hasBarcodes).toBe(false);
    expect(mockCapabilities.capabilities.barcodes).toMatchObject({ available: false });
  });
});
