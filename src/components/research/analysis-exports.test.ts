import { describe, expect, it } from "vitest";
import { activeResultCsv, analysisFigureSvg, downloadHref } from "./analysis-exports";

describe("analysis exports", () => {
  it("keeps all active result columns and CSV-escapes values", () => expect(activeResultCsv([{ sample: "A", value: "x,y" }, { sample: "B", extra: 3 }])).toBe('sample,value,extra\r\n"A","x,y",""\r\n"B","",3'));
  it("creates a labeled summary SVG without scientific claims beyond supplied totals", () => { const svg = analysisFigureSvg("Growth <summary>", { resultCount: 2, sampleCount: 1 }); expect(svg).toContain("Growth &lt;summary&gt;"); expect(svg).toContain("Results: 2"); expect(svg).toContain("Selected samples: 1"); });
  it("encodes downloadable content", () => expect(downloadHref("text/plain", "a b")).toBe("data:text/plain;charset=utf-8,a%20b"));
});
