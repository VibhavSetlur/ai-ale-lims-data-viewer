export function activeResultCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [columns.join(","), ...rows.map(row => columns.map(column => JSON.stringify(row[column] ?? "")).join(","))].join("\r\n");
}

const escapeXml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

export function analysisFigureSvg(title: string, summary: { resultCount: number; sampleCount: number }): string {
  const values = [{ label: "Results", value: summary.resultCount }, { label: "Selected samples", value: summary.sampleCount }];
  const maximum = Math.max(1, ...values.map(item => item.value));
  const bars = values.map((item, index) => {
    const y = 70 + index * 55; const width = Math.round((item.value / maximum) * 300);
    return `<text x="20" y="${y + 20}">${escapeXml(item.label)}: ${item.value}</text><rect x="190" y="${y}" width="${width}" height="28" fill="#9a5b30"/><text x="${198 + width}" y="${y + 20}">${item.value}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="210" viewBox="0 0 540 210" role="img" aria-labelledby="title description"><title id="title">${escapeXml(title)}</title><desc id="description">Results and selected samples summary.</desc><rect width="100%" height="100%" fill="#fffaf2"/><text x="20" y="35" font-size="20" font-family="sans-serif">${escapeXml(title)}</text>${bars}</svg>`;
}

export const downloadHref = (mime: string, text: string) => `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
