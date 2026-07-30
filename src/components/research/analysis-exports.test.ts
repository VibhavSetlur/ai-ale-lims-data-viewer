import { describe, expect, it } from "vitest";
import { activeResultCsv, analysisFigureSvg, buildAnalysisFigure, downloadHref } from "./analysis-exports";

describe("analysis exports", () => {
  it("keeps all active result columns and CSV-escapes values", () => expect(activeResultCsv([{ sample: "A", value: "x,y" }, { sample: "B", extra: 3 }])).toBe('sample,value,extra\r\n"A","x,y",""\r\n"B","",3'));
  it("builds the displayed and downloaded domain figure from the same canonical model", () => {
    const examples = [
      ["compare", [{ gene: "gyrA", position: 42, values: { s1: 1, s2: 2 } }], "Mutation loci by the number of selected samples containing each locus.", "gyrA:42: 2"],
      ["growth", [{ sampleKey: "s1", endpointOd: 0.5 }], "Growth endpoint optical density by sample.", "s1: 0.5"],
      ["library-variants", [{ variant: "A1-B1", abundance: 1 }], "Library variant relative abundance by sample.", "A1-B1: 1"],
      ["copy-number", [{ region: "r<1", sampleKey: "s1", value: 1.5 }], "Copy-number value by genomic region and sample.", "r&lt;1 · s1: 1.5"],
    ] as const;
    for (const [kind, rows, description, label] of examples) {
      const figure = buildAnalysisFigure(kind, "Figure <title>", [...rows] as Record<string, unknown>[]);
      const svg = analysisFigureSvg(figure);
      expect(figure.description).toBe(description);
      expect(figure.bars).toHaveLength(1);
      expect(svg).toContain("Figure &lt;title&gt;");
      expect(svg).toContain(description);
      expect(svg).toContain(label);
      expect(svg).toContain('x="230" y="18"');
      expect(svg).toContain('height="10"');
    }
  });
  it("limits the canonical figure to twelve bars", () => expect(buildAnalysisFigure("growth", "Growth", Array.from({ length: 13 }, (_, index) => ({ sampleKey: index, endpointOd: index })) ).bars).toHaveLength(12));
  it("encodes downloadable content", () => expect(downloadHref("text/plain", "a b")).toBe("data:text/plain;charset=utf-8,a%20b"));
});
