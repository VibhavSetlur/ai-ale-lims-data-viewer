export type AnalysisFigureKind = "compare" | "growth" | "library-variants" | "copy-number";
export type AnalysisFigureBar = { label: string; value: number };
export type AnalysisFigure = { title: string; description: string; bars: AnalysisFigureBar[] };

export function activeResultCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [columns.join(","), ...rows.map(row => columns.map(column => JSON.stringify(row[column] ?? "")).join(","))].join("\r\n");
}

const escapeXml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

export function buildAnalysisFigure(kind: AnalysisFigureKind, title: string, rows: Record<string, unknown>[]): AnalysisFigure {
  const description = kind === "compare"
    ? "Mutation loci by the number of selected samples containing each locus."
    : kind === "growth"
      ? "Growth endpoint optical density by sample."
      : kind === "library-variants"
        ? "Library variant relative abundance by sample."
        : "Copy-number value by genomic region and sample.";
  const bars = rows.slice(0, 12).map((row) => {
    if (kind === "compare") return { label: `${row.gene ?? "unknown"}:${row.position ?? ""}`, value: Object.keys((row.values as Record<string, unknown> | undefined) ?? {}).length };
    if (kind === "growth") return { label: String(row.sampleKey ?? "sample"), value: Number(row.endpointOd ?? 0) };
    if (kind === "library-variants") return { label: String(row.variant ?? "variant"), value: Number(row.abundance ?? 0) };
    return { label: `${row.region ?? "region"} · ${row.sampleKey ?? "sample"}`, value: Number(row.value ?? 0) };
  });
  return { title, description, bars };
}

export function analysisFigureSvg(figure: AnalysisFigure): string {
  const maximum = Math.max(1, ...figure.bars.map(item => item.value));
  const bars = figure.bars.map((item, index) => {
    const y = 18 + index * 15;
    const width = Math.round((item.value / maximum) * 280);
    return `<text x="20" y="${y + 12}">${escapeXml(item.label)}: ${escapeXml(item.value)}</text><rect x="230" y="${y}" width="${width}" height="10" fill="#9a5b30"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="210" viewBox="0 0 540 210" role="img" aria-labelledby="title description"><title id="title">${escapeXml(figure.title)}</title><desc id="description">${escapeXml(figure.description)}</desc>${bars}</svg>`;
}

export const downloadHref = (mime: string, text: string) => `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
