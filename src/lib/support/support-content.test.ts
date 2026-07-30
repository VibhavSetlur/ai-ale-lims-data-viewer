import { describe, expect, it } from "vitest";
import { externalAiPrompt, helpArticles, issueReportUrl, searchHelpArticles } from "./support-content";
import { mockProvenance } from "../research/mock-service";

describe("support content", () => {
  it("covers the support-parity topics and filters searchable content", () => {
    expect(helpArticles.map((article) => article.id)).toEqual(expect.arrayContaining(["tables", "mutation", "growth", "library", "copy-number", "barcodes", "plates", "provenance"]));
    expect(searchHelpArticles("filtered csv").map((article) => article.id)).toContain("tables");
    expect(searchHelpArticles("browser local").map((article) => article.id)).toContain("plates");
  });
  it("builds an external-AI prompt with only safe metadata", () => {
    const prompt = externalAiPrompt();
    expect(prompt).toContain(mockProvenance.snapshotId);
    expect(prompt).toContain("Do not include credentials");
    expect(prompt).not.toContain(mockProvenance.sourceSha256);
  });
  it("builds an issue URL with friendly safe context", () => {
    const url = new URL(issueReportUrl());
    const body = url.searchParams.get("body") ?? "";
    expect(url.pathname).toBe("/VibhavSetlur/ai-ale-lims-data-viewer/issues/new");
    expect(body).toContain(mockProvenance.snapshotId);
    expect(body).toContain("raw scientific records");
    expect(body).not.toContain(mockProvenance.sourceSha256);
  });
});
