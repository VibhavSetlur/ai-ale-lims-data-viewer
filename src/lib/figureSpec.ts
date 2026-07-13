export type FigureKind = 'pairing' | 'libraryBars' | 'libraryHeatmap' | 'mutationHeatmap' | 'lineChart' | 'multiLinePanels' | 'barcodeBars' | 'barcodeHeatmap';

export interface FigureTextOptions {
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
}

export interface FigureRenderOptions extends FigureTextOptions {
  width: number;
  height: number;
  fontScale: number;
  background: string;
  showLegend: boolean;
  showValues: boolean;
  cellSize: number;
  emptyColor: string;
  aiMarkerColor: string;
  borderColor: string;
  textColor: string;
  mutedTextColor: string;
}

export interface PairingCellSpec {
  a: string;
  b: string;
  label: string;
  value?: number;
  valueLabel?: string;
  color: string;
  ai: boolean;
}

export interface PairingFigureSpec {
  kind: 'pairing';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  rows: { id: string; label: string; ai?: boolean }[];
  columns: { id: string; label: string; ai?: boolean }[];
  cells: PairingCellSpec[];
  metricLabel?: string;
}

export interface LibraryVariantFigureSpecBase {
  kind: 'libraryBars' | 'libraryHeatmap';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  metric: 'abundance' | 'count';
  samples: { id: string; label: string; subtitle?: string; group?: string }[];
  variants: { id: string; label: string; color: string; aiA?: boolean; aiB?: boolean }[];
  values: { sampleId: string; variantId: string; value: number; valueLabel: string; normalizedValue?: number }[];
  maxValue?: number;
  normalizedBars?: boolean;
}

export interface LibraryBarsFigureSpec extends LibraryVariantFigureSpecBase {
  kind: 'libraryBars';
}

export interface LibraryHeatmapFigureSpec extends LibraryVariantFigureSpecBase {
  kind: 'libraryHeatmap';
}

export interface MutationHeatmapFigureSpec {
  kind: 'mutationHeatmap';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  samples: { id: string; label: string; group?: string; transfer?: number | null }[];
  mutations: { id: string; label: string; subtitle?: string; metric: string; min?: number; max?: number; checked?: boolean }[];
  values: { mutationId: string; sampleId: string; value?: number; valueLabel?: string; provided?: boolean }[];
}

export interface LineChartFigureSpec {
  kind: 'lineChart';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  logY?: boolean;
  showPoints?: boolean;
  series: { id: string; label: string; color: string; points: { x: number; y: number; label?: string }[]; emphasis?: boolean }[];
  referenceLines?: { y: number; label: string; color?: string; dash?: boolean }[];
}

export interface MultiLinePanelFigureSpec {
  kind: 'multiLinePanels';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  logY?: boolean;
  showPoints?: boolean;
  sharedY?: boolean;
  panels: {
    id: string;
    label: string;
    subtitle?: string;
    series: { id: string; label: string; color: string; points: { x: number; y: number; label?: string }[]; emphasis?: boolean }[];
  }[];
}

export interface BarcodeChartPanelSpec {
  id: string;
  label: string;
  subtitle?: string;
  transfers: number[];
  candidates: { id: string; label: string; color: string }[];
  values: { candidateId: string; transfer: number; value: number; fraction: number; valueLabel?: string }[];
}

export interface BarcodeBarsFigureSpec {
  kind: 'barcodeBars';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  normalize: 'count' | 'fraction';
  colorMode?: string;
  panels: BarcodeChartPanelSpec[];
}

export interface BarcodeHeatmapFigureSpec {
  kind: 'barcodeHeatmap';
  title: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  legendTitle?: string;
  caption?: string;
  width?: number;
  height?: number;
  panels: BarcodeChartPanelSpec[];
}

export type FigureSpec = PairingFigureSpec | LibraryBarsFigureSpec | LibraryHeatmapFigureSpec | MutationHeatmapFigureSpec | LineChartFigureSpec | MultiLinePanelFigureSpec | BarcodeBarsFigureSpec | BarcodeHeatmapFigureSpec;

const FONT_SANS = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export const DEFAULT_FIGURE_OPTIONS: FigureRenderOptions = {
  title: '',
  subtitle: '',
  xTitle: 'VerB partner',
  yTitle: 'VerA partner',
  legendTitle: 'Partner pairing',
  caption: '',
  width: 1200,
  height: 900,
  fontScale: 1,
  background: '#ffffff',
  showLegend: true,
  showValues: false,
  cellSize: 34,
  emptyColor: '#f1f5f9',
  aiMarkerColor: '#111827',
  borderColor: '#cbd5e1',
  textColor: '#0f172a',
  mutedTextColor: '#64748b',
};

export function defaultOptionsForSpec(spec: FigureSpec): FigureRenderOptions {
  const inferred = inferFigureSize(spec);
  return {
    ...DEFAULT_FIGURE_OPTIONS,
    title: spec.title,
    subtitle: spec.subtitle ?? '',
    xTitle: spec.xTitle ?? defaultAxisTitle(spec, 'x'),
    yTitle: spec.yTitle ?? defaultAxisTitle(spec, 'y'),
    legendTitle: spec.legendTitle ?? defaultLegendTitle(spec),
    caption: spec.caption ?? '',
    width: spec.width ?? inferred.width,
    height: spec.height ?? inferred.height,
    showValues: spec.kind === 'libraryHeatmap' ? true : DEFAULT_FIGURE_OPTIONS.showValues,
    cellSize: spec.kind === 'libraryHeatmap' ? 28 : DEFAULT_FIGURE_OPTIONS.cellSize,
  };
}

export function renderFigureSpecSvg(spec: FigureSpec, options: FigureRenderOptions): string {
  if (spec.kind === 'pairing') return renderPairingSvg(spec, options);
  if (spec.kind === 'libraryBars') return renderLibraryBarsSvg(spec, options);
  if (spec.kind === 'libraryHeatmap') return renderLibraryHeatmapSvg(spec, options);
  if (spec.kind === 'mutationHeatmap') return renderMutationHeatmapSvg(spec, options);
  if (spec.kind === 'multiLinePanels') return renderMultiLinePanelsSvg(spec, options);
  if (spec.kind === 'barcodeBars') return renderBarcodeBarsSvg(spec, options);
  if (spec.kind === 'barcodeHeatmap') return renderBarcodeHeatmapSvg(spec, options);
  return renderLineChartSvg(spec, options);
}

export async function figureSpecToPngBlob(spec: FigureSpec, options: FigureRenderOptions, scale = 3): Promise<Blob> {
  return svgToPngBlob(renderFigureSpecSvg(spec, options), options.width, options.height, scale);
}

export async function svgToPngBlob(svgText: string, width: number, height: number, scale = 3): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('PNG conversion failed');
    return blob;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function figureFilename(base: string): string {
  const safe = base.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'figure';
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${safe}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

function inferFigureSize(spec: FigureSpec): { width: number; height: number } {
  if (spec.kind === 'pairing') {
    return {
      width: Math.max(900, Math.min(2200, 330 + spec.columns.length * 42)),
      height: Math.max(680, Math.min(1800, 260 + spec.rows.length * 42)),
    };
  }
  if (spec.kind === 'libraryBars') {
    return {
      width: Math.max(980, Math.min(2600, 360 + spec.samples.length * 52)),
      height: 820,
    };
  }
  if (spec.kind === 'libraryHeatmap') {
    return {
      width: Math.max(1000, Math.min(2600, 390 + spec.samples.length * 34)),
      height: Math.max(760, Math.min(2200, 250 + spec.variants.length * 32)),
    };
  }
  if (spec.kind === 'mutationHeatmap') {
    return {
      width: Math.max(1000, Math.min(2800, 380 + spec.samples.length * 34)),
      height: Math.max(760, Math.min(2400, 250 + spec.mutations.length * 30)),
    };
  }
  if (spec.kind === 'multiLinePanels') {
    const cols = spec.panels.length <= 2 ? spec.panels.length : spec.panels.length <= 6 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(spec.panels.length / Math.max(1, cols)));
    return {
      width: Math.max(1000, Math.min(2400, 250 + cols * 360)),
      height: Math.max(760, Math.min(2600, 230 + rows * 260)),
    };
  }
  if (spec.kind === 'barcodeBars' || spec.kind === 'barcodeHeatmap') {
    const cols = spec.panels.length <= 2 ? spec.panels.length : 2;
    const rows = Math.max(1, Math.ceil(spec.panels.length / Math.max(1, cols)));
    return {
      width: Math.max(1100, Math.min(2200, 280 + cols * 430)),
      height: Math.max(780, Math.min(2600, 240 + rows * 300)),
    };
  }
  return { width: 1100, height: 760 };
}

function defaultAxisTitle(spec: FigureSpec, axis: 'x' | 'y'): string {
  if (spec.kind === 'pairing') return axis === 'x' ? (DEFAULT_FIGURE_OPTIONS.xTitle ?? '') : (DEFAULT_FIGURE_OPTIONS.yTitle ?? '');
  if (spec.kind === 'libraryBars') return axis === 'x' ? 'Selected samples' : metricTitle(spec.metric, spec.normalizedBars);
  if (spec.kind === 'libraryHeatmap') return axis === 'x' ? 'Selected samples' : 'Library variant';
  if (spec.kind === 'mutationHeatmap') return axis === 'x' ? 'Selected samples' : 'Mutation or copy-number region';
  if (spec.kind === 'barcodeBars' || spec.kind === 'barcodeHeatmap') return axis === 'x' ? 'Transfer' : (spec.kind === 'barcodeBars' && spec.normalize === 'count' ? 'Read count' : 'Fraction of reads');
  return axis === 'x' ? 'Transfer' : 'Value';
}

function defaultLegendTitle(spec: FigureSpec): string {
  if (spec.kind === 'pairing') return DEFAULT_FIGURE_OPTIONS.legendTitle ?? '';
  if (spec.kind === 'mutationHeatmap') return 'Cell value';
  if (spec.kind === 'lineChart') return 'Lineages';
  if (spec.kind === 'multiLinePanels') return 'Lineages';
  if (spec.kind === 'barcodeBars' || spec.kind === 'barcodeHeatmap') return 'Barcode candidates';
  return 'Library variants';
}

function metricTitle(metric: 'abundance' | 'count', normalized?: boolean): string {
  if (metric === 'count') return 'Barcode count';
  return normalized ? 'Share of visible variants' : 'Relative abundance';
}

function renderLibraryBarsSvg(spec: LibraryBarsFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(620, Math.round(options.width));
  const height = Math.max(520, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 10.5 * fs;
  const valueSize = 9 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 92;
  const padRight = options.showLegend ? 250 : 42;
  const padTop = 132;
  const padBottom = options.caption ? 150 : 126;
  const plotW = Math.max(160, width - padLeft - padRight);
  const plotH = Math.max(160, height - padTop - padBottom);
  const plotX = padLeft;
  const plotY = padTop;
  const baseY = plotY + plotH;
  const slot = plotW / Math.max(1, spec.samples.length);
  const barW = Math.max(5, Math.min(34, slot * 0.58));
  const valueMap = new Map(spec.values.map(v => [`${v.sampleId}|${v.variantId}`, v]));
  const sampleTotals = spec.samples.map(sample => spec.variants.reduce((sum, variant) => sum + (valueMap.get(`${sample.id}|${variant.id}`)?.value ?? 0), 0));
  const yMax = spec.normalizedBars ? 1 : Math.max(spec.maxValue ?? 0, ...sampleTotals, spec.metric === 'count' ? 1 : 0.01);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);

  ticks.forEach(tick => {
    const y = baseY - tick * plotH;
    const tickValue = spec.normalizedBars || spec.metric === 'abundance' ? tick : yMax * tick;
    parts.push(`<line x1="${plotX}" x2="${plotX + plotW}" y1="${y}" y2="${y}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.62"/>`);
    parts.push(`<text x="${plotX - 10}" y="${y + tickSize * 0.34}" text-anchor="end" font-family="${FONT_SANS}" font-size="${tickSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(formatMetric(tickValue, spec.metric))}</text>`);
  });
  parts.push(`<line x1="${plotX}" x2="${plotX}" y1="${plotY}" y2="${baseY}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  parts.push(`<line x1="${plotX}" x2="${plotX + plotW}" y1="${baseY}" y2="${baseY}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  const yTitleX = 30;
  parts.push(`<text x="${yTitleX}" y="${plotY + plotH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 ${yTitleX} ${plotY + plotH / 2})">${escapeXml(options.yTitle || metricTitle(spec.metric, spec.normalizedBars))}</text>`);

  spec.samples.slice(1).forEach((sample, idx) => {
    if (!sample.group || sample.group === spec.samples[idx]?.group) return;
    const x = plotX + (idx + 1) * slot;
    parts.push(`<line x1="${x}" x2="${x}" y1="${plotY}" y2="${baseY + 8}" stroke="${escapeAttr(options.borderColor)}" stroke-dasharray="4 5" stroke-width="1"/>`);
  });

  spec.samples.forEach((sample, sampleIdx) => {
    const slotX = plotX + sampleIdx * slot;
    const x = slotX + (slot - barW) / 2;
    const sampleTotal = sampleTotals[sampleIdx] ?? 0;
    const denom = spec.normalizedBars ? (sampleTotal > 0 ? sampleTotal : 1) : yMax;
    let yCursor = baseY;
    spec.variants.forEach(variant => {
      const entry = valueMap.get(`${sample.id}|${variant.id}`);
      const value = entry?.value ?? 0;
      if (value <= 0) return;
      const drawn = spec.normalizedBars ? value / denom : value;
      const h = Math.max(0.5, drawn / Math.max(0.000001, yMax) * plotH);
      yCursor -= h;
      parts.push(`<rect x="${x}" y="${yCursor}" width="${barW}" height="${h}" rx="${h > 4 ? 1.6 : 0}" fill="${escapeAttr(variant.color)}" stroke="rgba(15,23,42,0.2)" stroke-width="${h > 7 ? 0.45 : 0}"/>`);
      if (options.showValues && h > valueSize * 1.45 && barW > 18) {
        const shown = spec.normalizedBars && spec.metric === 'abundance' ? drawn : value;
        parts.push(`<text x="${x + barW / 2}" y="${yCursor + h / 2 + valueSize * 0.34}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${valueSize}" font-weight="750" fill="${escapeAttr(readableTextForFill(variant.color))}">${escapeXml(formatMetric(shown, spec.metric))}</text>`);
      }
    });
    const labelX = slotX + slot / 2;
    parts.push(`<g transform="translate(${labelX} ${baseY + 18}) rotate(-45)">`);
    parts.push(`<text text-anchor="end" font-family="${FONT_MONO}" font-size="${tickSize}" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(sample.label, 34))}</text>`);
    parts.push(`</g>`);
  });
  parts.push(`<text x="${plotX + plotW / 2}" y="${height - (options.caption ? 82 : 34)}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Selected samples')}</text>`);
  if (options.showLegend) drawVariantLegend(parts, spec, options, width - padRight + 34, padTop, padRight - 58, fs);
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function renderLibraryHeatmapSvg(spec: LibraryHeatmapFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(620, Math.round(options.width));
  const height = Math.max(520, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 10.5 * fs;
  const valueSize = 8.8 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 170;
  const padRight = options.showLegend ? 235 : 42;
  const padTop = 162;
  const padBottom = options.caption ? 78 : 48;
  const availableW = Math.max(120, width - padLeft - padRight);
  const availableH = Math.max(120, height - padTop - padBottom);
  const requestedCell = Math.max(12, Math.min(72, options.cellSize || 28));
  const cellW = Math.max(10, Math.min(requestedCell, availableW / Math.max(1, spec.samples.length)));
  const cellH = Math.max(10, Math.min(requestedCell, availableH / Math.max(1, spec.variants.length)));
  const cell = Math.min(cellW, cellH);
  const gridW = cell * spec.samples.length;
  const gridH = cell * spec.variants.length;
  const gridX = padLeft + Math.max(0, (availableW - gridW) / 2);
  const gridY = padTop + Math.max(0, (availableH - gridH) / 2);
  const valueMap = new Map(spec.values.map(v => [`${v.sampleId}|${v.variantId}`, v]));
  const maxValue = Math.max(0.000001, spec.maxValue ?? Math.max(...spec.values.map(v => v.normalizedValue ?? v.value), 0));
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);
  parts.push(`<text x="${gridX + gridW / 2}" y="${gridY - 64}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Selected samples')}</text>`);
  parts.push(`<text x="${gridX - 130}" y="${gridY + gridH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 ${gridX - 130} ${gridY + gridH / 2})">${escapeXml(options.yTitle || 'Library variant')}</text>`);

  spec.samples.forEach((sample, i) => {
    const x = gridX + i * cell + cell / 2;
    parts.push(`<g transform="translate(${x} ${gridY - 14}) rotate(-45)">`);
    parts.push(`<text text-anchor="start" font-family="${FONT_MONO}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(sample.label, 32))}</text>`);
    parts.push(`</g>`);
  });

  spec.variants.forEach((variant, rowIdx) => {
    const y = gridY + rowIdx * cell;
    const parsed = splitVariantLabel(variant.label);
    const label = parsed ? `${parsed[0]} / ${parsed[1]}` : variant.label;
    parts.push(`<rect x="${gridX - 154}" y="${y + 1}" width="${142}" height="${Math.max(1, cell - 2)}" rx="3" fill="${rowIdx % 2 ? '#f8fafc' : '#ffffff'}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.45"/>`);
    parts.push(`<circle cx="${gridX - 142}" cy="${y + cell / 2}" r="${Math.max(3, Math.min(5, cell * 0.18))}" fill="${escapeAttr(variant.color)}"/>`);
    parts.push(`<text x="${gridX - 132}" y="${y + cell / 2 + tickSize * 0.34}" font-family="${FONT_MONO}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(label, 18))}</text>`);
    if (variant.aiA || variant.aiB) parts.push(`<text x="${gridX - 40}" y="${y + cell / 2 + tickSize * 0.34}" font-family="${FONT_SANS}" font-size="${8.5 * fs}" font-weight="800" fill="#7c2d12">${escapeXml(variant.aiA && variant.aiB ? 'A/B AI' : variant.aiA ? 'A AI' : 'B AI')}</text>`);
    spec.samples.forEach((sample, colIdx) => {
      const x = gridX + colIdx * cell;
      const entry = valueMap.get(`${sample.id}|${variant.id}`);
      const value = entry?.value ?? 0;
      const normalized = entry?.normalizedValue ?? value;
      const alpha = value > 0 ? Math.max(0.14, Math.min(1, normalized / maxValue)) : 1;
      const fill = value > 0 ? variant.color : options.emptyColor;
      parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${Math.max(1, cell - 2)}" height="${Math.max(1, cell - 2)}" rx="${Math.max(1.5, cell * 0.09)}" fill="${escapeAttr(fill)}" fill-opacity="${value > 0 ? alpha.toFixed(3) : '0.7'}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.55" stroke-width="0.65"/>`);
      if (options.showValues && value > 0 && cell > 19) {
        parts.push(`<text x="${x + cell / 2}" y="${y + cell / 2 + valueSize * 0.35}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${Math.min(valueSize, cell * 0.26)}" font-weight="750" fill="${escapeAttr(alpha > 0.58 ? readableTextForFill(variant.color) : options.textColor)}">${escapeXml(entry?.valueLabel ?? formatMetric(value, spec.metric))}</text>`);
      }
    });
  });
  parts.push(`<rect x="${gridX}" y="${gridY}" width="${gridW}" height="${gridH}" fill="none" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.45"/>`);
  if (options.showLegend) drawVariantLegend(parts, spec, options, width - padRight + 30, padTop, padRight - 54, fs);
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function renderMutationHeatmapSvg(spec: MutationHeatmapFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(680, Math.round(options.width));
  const height = Math.max(520, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 10 * fs;
  const valueSize = 8.5 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 220;
  const padRight = options.showLegend ? 230 : 42;
  const padTop = 166;
  const padBottom = options.caption ? 86 : 52;
  const availableW = Math.max(120, width - padLeft - padRight);
  const availableH = Math.max(120, height - padTop - padBottom);
  const requestedCell = Math.max(10, Math.min(68, options.cellSize || 28));
  const cellW = Math.max(8, Math.min(requestedCell, availableW / Math.max(1, spec.samples.length)));
  const cellH = Math.max(8, Math.min(requestedCell, availableH / Math.max(1, spec.mutations.length)));
  const cell = Math.min(cellW, cellH);
  const gridW = cell * spec.samples.length;
  const gridH = cell * spec.mutations.length;
  const gridX = padLeft + Math.max(0, (availableW - gridW) / 2);
  const gridY = padTop + Math.max(0, (availableH - gridH) / 2);
  const valueMap = new Map(spec.values.map(v => [`${v.mutationId}|${v.sampleId}`, v]));
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);

  parts.push(`<text x="${gridX + gridW / 2}" y="${gridY - 66}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Selected samples')}</text>`);
  parts.push(`<text x="${gridX - 176}" y="${gridY + gridH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 ${gridX - 176} ${gridY + gridH / 2})">${escapeXml(options.yTitle || 'Mutation or copy-number region')}</text>`);

  spec.samples.forEach((sample, i) => {
    const x = gridX + i * cell + cell / 2;
    parts.push(`<g transform="translate(${x} ${gridY - 16}) rotate(-45)">`);
    parts.push(`<text text-anchor="start" font-family="${FONT_MONO}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(sample.label, 30))}</text>`);
    parts.push(`</g>`);
  });

  spec.samples.slice(1).forEach((sample, idx) => {
    const previous = spec.samples[idx];
    if (!sample.group || sample.group === previous?.group) return;
    const x = gridX + (idx + 1) * cell;
    parts.push(`<line x1="${x}" x2="${x}" y1="${gridY - 8}" y2="${gridY + gridH}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.25" stroke-dasharray="4 4"/>`);
  });

  spec.mutations.forEach((mutation, rowIdx) => {
    const y = gridY + rowIdx * cell;
    parts.push(`<rect x="${gridX - 206}" y="${y + 1}" width="${192}" height="${Math.max(1, cell - 2)}" rx="3" fill="${mutation.checked ? '#fff7ed' : rowIdx % 2 ? '#f8fafc' : '#ffffff'}" stroke="${mutation.checked ? '#f59e0b' : escapeAttr(options.borderColor)}" stroke-opacity="0.68"/>`);
    const metricColor = mutation.metric === 'copy_number' ? '#047857' : '#1d4ed8';
    parts.push(`<text x="${gridX - 196}" y="${y + cell / 2 - tickSize * 0.08}" font-family="${FONT_MONO}" font-size="${tickSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(mutation.label, 28))}</text>`);
    parts.push(`<text x="${gridX - 196}" y="${y + cell / 2 + tickSize * 0.9}" font-family="${FONT_SANS}" font-size="${Math.max(7, tickSize * 0.78)}" fill="${metricColor}">${escapeXml(truncateLabel(mutation.subtitle || mutation.metric, 34))}</text>`);
    spec.samples.forEach((sample, colIdx) => {
      const x = gridX + colIdx * cell;
      const entry = valueMap.get(`${mutation.id}|${sample.id}`);
      const hasValue = typeof entry?.value === 'number' && Number.isFinite(entry.value);
      const fill = hasValue ? heatmapColor(entry.value as number, mutation.min ?? 0, mutation.max ?? 1, mutation.metric) : options.emptyColor;
      parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${Math.max(1, cell - 2)}" height="${Math.max(1, cell - 2)}" rx="${Math.max(1.4, cell * 0.09)}" fill="${escapeAttr(fill)}" stroke="${entry?.provided ? '#d97706' : escapeAttr(options.borderColor)}" stroke-width="${entry?.provided ? 1.7 : 0.65}" stroke-opacity="0.85"/>`);
      if (entry?.provided && !hasValue) parts.push(`<text x="${x + cell / 2}" y="${y + cell / 2 + valueSize * 0.36}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${Math.min(valueSize, cell * 0.28)}" font-weight="800" fill="#b45309">0</text>`);
      if (options.showValues && hasValue && cell > 19) {
        parts.push(`<text x="${x + cell / 2}" y="${y + cell / 2 + valueSize * 0.35}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${Math.min(valueSize, cell * 0.26)}" font-weight="750" fill="${escapeAttr(readableTextForFill(fill))}">${escapeXml(entry?.valueLabel ?? formatGenericValue(entry.value as number, mutation.metric))}</text>`);
      }
    });
  });
  parts.push(`<rect x="${gridX}" y="${gridY}" width="${gridW}" height="${gridH}" fill="none" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.45"/>`);
  if (options.showLegend) drawMutationHeatmapLegend(parts, spec, options, width - padRight + 30, padTop, fs);
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

type FigureLineSeries = { id: string; label: string; color: string; points: { x: number; y: number; label?: string }[]; emphasis?: boolean };

function renderBarcodeBarsSvg(spec: BarcodeBarsFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(760, Math.round(options.width));
  const height = Math.max(560, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 9.5 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 72;
  const padRight = options.showLegend ? 240 : 38;
  const padTop = 120;
  const padBottom = options.caption ? 108 : 78;
  const panels = spec.panels;
  const cols = panels.length <= 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(Math.max(1, panels.length) / cols));
  const gapX = 28;
  const gapY = 44;
  const plotAreaW = Math.max(220, width - padLeft - padRight);
  const plotAreaH = Math.max(180, height - padTop - padBottom);
  const panelW = Math.max(190, (plotAreaW - gapX * (cols - 1)) / cols);
  const panelH = Math.max(150, (plotAreaH - gapY * (rows - 1)) / rows);
  const maxCount = Math.max(1, ...panels.flatMap(p => p.values.map(v => v.value)));
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);
  panels.forEach((panel, idx) => drawBarcodeBarPanel(parts, panel, spec.normalize, padLeft + (idx % cols) * (panelW + gapX), padTop + Math.floor(idx / cols) * (panelH + gapY), panelW, panelH, maxCount, options, fs, tickSize));
  parts.push(`<text x="${padLeft + plotAreaW / 2}" y="${height - (options.caption ? 78 : 30)}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Transfer')}</text>`);
  parts.push(`<text x="24" y="${padTop + plotAreaH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 24 ${padTop + plotAreaH / 2})">${escapeXml(options.yTitle || (spec.normalize === 'count' ? 'Read count' : 'Fraction of reads'))}</text>`);
  if (options.showLegend) drawBarcodeLegend(parts, panels, options, width - padRight + 30, padTop, fs);
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function renderBarcodeHeatmapSvg(spec: BarcodeHeatmapFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(760, Math.round(options.width));
  const height = Math.max(560, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 9.5 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 150;
  const padRight = options.showLegend ? 235 : 42;
  const padTop = 132;
  const padBottom = options.caption ? 90 : 58;
  const panels = spec.panels;
  const cols = panels.length <= 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(Math.max(1, panels.length) / cols));
  const gapX = 26;
  const gapY = 50;
  const plotAreaW = Math.max(220, width - padLeft - padRight);
  const plotAreaH = Math.max(180, height - padTop - padBottom);
  const panelW = Math.max(220, (plotAreaW - gapX * (cols - 1)) / cols);
  const panelH = Math.max(170, (plotAreaH - gapY * (rows - 1)) / rows);
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);
  panels.forEach((panel, idx) => drawBarcodeHeatmapPanel(parts, panel, padLeft + (idx % cols) * (panelW + gapX), padTop + Math.floor(idx / cols) * (panelH + gapY), panelW, panelH, options, fs, tickSize));
  parts.push(`<text x="${padLeft + plotAreaW / 2}" y="${height - (options.caption ? 62 : 28)}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Transfer')}</text>`);
  if (options.showLegend) drawBarcodeLegend(parts, panels, options, width - padRight + 30, padTop, fs);
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function drawBarcodeBarPanel(parts: string[], panel: BarcodeChartPanelSpec, normalize: 'count' | 'fraction', x0: number, y0: number, panelW: number, panelH: number, maxCount: number, options: FigureRenderOptions, fs: number, tickSize: number) {
  const pad = { l: 44, r: 12, t: 32, b: 34 };
  const plotX = x0 + pad.l;
  const plotY = y0 + pad.t;
  const plotW = panelW - pad.l - pad.r;
  const plotH = panelH - pad.t - pad.b;
  const valueMap = new Map(panel.values.map(v => [`${v.candidateId}|${v.transfer}`, v]));
  const yMax = normalize === 'fraction' ? 1 : maxCount;
  parts.push(`<rect x="${x0}" y="${y0}" width="${panelW}" height="${panelH}" rx="8" fill="#f8fafc" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.75"/>`);
  parts.push(`<text x="${x0 + 10}" y="${y0 + 17}" font-family="${FONT_MONO}" font-size="${10.5 * fs}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(panel.label, 38))}</text>`);
  if (panel.subtitle) parts.push(`<text x="${x0 + 10}" y="${y0 + 31}" font-family="${FONT_SANS}" font-size="${8.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(truncateLabel(panel.subtitle, 48))}</text>`);
  [0, 0.25, 0.5, 0.75, 1].forEach(tick => {
    const y = plotY + plotH - tick * plotH;
    const label = normalize === 'fraction' ? `${Math.round(tick * 100)}%` : formatTick(yMax * tick);
    parts.push(`<line x1="${plotX}" x2="${plotX + plotW}" y1="${y}" y2="${y}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.52"/>`);
    parts.push(`<text x="${plotX - 6}" y="${y + tickSize * 0.34}" text-anchor="end" font-family="${FONT_SANS}" font-size="${tickSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(label)}</text>`);
  });
  const slot = plotW / Math.max(1, panel.transfers.length);
  const barW = Math.max(8, Math.min(34, slot * 0.58));
  panel.transfers.forEach((transfer, ti) => {
    const x = plotX + ti * slot + (slot - barW) / 2;
    let yCursor = plotY + plotH;
    panel.candidates.forEach(candidate => {
      const entry = valueMap.get(`${candidate.id}|${transfer}`);
      const raw = entry?.value ?? 0;
      if (raw <= 0) return;
      const v = normalize === 'fraction' ? (entry?.fraction ?? 0) : raw;
      const h = Math.max(0.6, (v / Math.max(1e-9, yMax)) * plotH);
      yCursor -= h;
      parts.push(`<rect x="${x}" y="${yCursor}" width="${barW}" height="${h}" rx="${h > 5 ? 1.5 : 0}" fill="${escapeAttr(candidate.color)}" stroke="rgba(15,23,42,0.22)" stroke-width="0.4"/>`);
    });
    parts.push(`<text x="${x + barW / 2}" y="${plotY + plotH + 17}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.mutedTextColor)}">T${escapeXml(String(transfer))}</text>`);
  });
  parts.push(`<line x1="${plotX}" x2="${plotX}" y1="${plotY}" y2="${plotY + plotH}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  parts.push(`<line x1="${plotX}" x2="${plotX + plotW}" y1="${plotY + plotH}" y2="${plotY + plotH}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
}

function drawBarcodeHeatmapPanel(parts: string[], panel: BarcodeChartPanelSpec, x0: number, y0: number, panelW: number, panelH: number, options: FigureRenderOptions, fs: number, tickSize: number) {
  const pad = { l: 112, r: 12, t: 40, b: 18 };
  const gridX = x0 + pad.l;
  const gridY = y0 + pad.t;
  const gridW = panelW - pad.l - pad.r;
  const gridH = panelH - pad.t - pad.b;
  const cellW = Math.max(12, Math.min(32, gridW / Math.max(1, panel.transfers.length)));
  const cellH = Math.max(11, Math.min(26, gridH / Math.max(1, panel.candidates.length)));
  const valueMap = new Map(panel.values.map(v => [`${v.candidateId}|${v.transfer}`, v]));
  parts.push(`<rect x="${x0}" y="${y0}" width="${panelW}" height="${panelH}" rx="8" fill="#f8fafc" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.75"/>`);
  parts.push(`<text x="${x0 + 10}" y="${y0 + 17}" font-family="${FONT_MONO}" font-size="${10.5 * fs}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(panel.label, 38))}</text>`);
  if (panel.subtitle) parts.push(`<text x="${x0 + 10}" y="${y0 + 31}" font-family="${FONT_SANS}" font-size="${8.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(truncateLabel(panel.subtitle, 48))}</text>`);
  panel.transfers.forEach((transfer, ti) => {
    const x = gridX + ti * cellW + cellW / 2;
    parts.push(`<text x="${x}" y="${gridY - 8}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.mutedTextColor)}">T${escapeXml(String(transfer))}</text>`);
  });
  panel.candidates.forEach((candidate, ri) => {
    const y = gridY + ri * cellH;
    parts.push(`<circle cx="${gridX - 100}" cy="${y + cellH / 2}" r="4" fill="${escapeAttr(candidate.color)}"/>`);
    parts.push(`<text x="${gridX - 92}" y="${y + cellH / 2 + tickSize * 0.34}" font-family="${FONT_MONO}" font-size="${tickSize}" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(candidate.label, 14))}</text>`);
    panel.transfers.forEach((transfer, ti) => {
      const entry = valueMap.get(`${candidate.id}|${transfer}`);
      const frac = entry?.fraction ?? 0;
      const x = gridX + ti * cellW;
      const fill = entry && entry.value > 0 ? candidate.color : options.emptyColor;
      const opacity = entry && entry.value > 0 ? Math.max(0.15, Math.min(1, frac)) : 0.7;
      parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${Math.max(1, cellW - 2)}" height="${Math.max(1, cellH - 2)}" rx="2" fill="${escapeAttr(fill)}" fill-opacity="${opacity.toFixed(3)}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.55" stroke-width="0.55"/>`);
      if (options.showValues && frac >= 0.25 && cellW > 20 && cellH > 15) parts.push(`<text x="${x + cellW / 2}" y="${y + cellH / 2 + 3}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${Math.min(8.5 * fs, cellH * 0.42)}" font-weight="750" fill="${escapeAttr(readableTextForFill(candidate.color))}">${Math.round(frac * 100)}</text>`);
    });
  });
}

function drawBarcodeLegend(parts: string[], panels: BarcodeChartPanelSpec[], options: FigureRenderOptions, x: number, y: number, fs: number) {
  const candidates = new Map<string, BarcodeChartPanelSpec['candidates'][number]>();
  panels.forEach(panel => panel.candidates.forEach(candidate => { if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate); }));
  parts.push(`<text x="${x}" y="${y}" font-family="${FONT_SANS}" font-size="${12 * fs}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(options.legendTitle || 'Barcode candidates')}</text>`);
  let ly = y + 26;
  Array.from(candidates.values()).slice(0, 16).forEach((candidate, idx) => {
    const rowY = ly + idx * 20;
    parts.push(`<rect x="${x}" y="${rowY - 11}" width="14" height="14" rx="3" fill="${escapeAttr(candidate.color)}" stroke="${escapeAttr(options.borderColor)}"/>`);
    parts.push(`<text x="${x + 22}" y="${rowY}" font-family="${FONT_MONO}" font-size="${10.5 * fs}" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(candidate.label, 20))}</text>`);
  });
  if (candidates.size > 16) parts.push(`<text x="${x}" y="${ly + 16 * 20 + 6}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">+ ${candidates.size - 16} more candidates</text>`);
}

function renderLineChartSvg(spec: LineChartFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(620, Math.round(options.width));
  const height = Math.max(460, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 10.5 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 78;
  const padRight = options.showLegend ? 250 : 42;
  const padTop = 118;
  const padBottom = options.caption ? 114 : 78;
  const plotW = Math.max(160, width - padLeft - padRight);
  const plotH = Math.max(160, height - padTop - padBottom);
  const allPoints = spec.series.flatMap(s => s.points);
  const xVals = allPoints.map(p => p.x).filter(Number.isFinite);
  const yVals = allPoints.map(p => p.y).filter(v => Number.isFinite(v) && (!spec.logY || v > 0));
  const xMin = xVals.length ? Math.min(...xVals) : 0;
  const xMaxRaw = xVals.length ? Math.max(...xVals) : 1;
  const xMax = xMaxRaw <= xMin ? xMin + 1 : xMaxRaw;
  const yMinRaw = yVals.length ? Math.min(...yVals) : 0;
  const yMaxRaw = yVals.length ? Math.max(...yVals) : 1;
  const logFloor = Math.max(0.001, Math.min(yMinRaw > 0 ? yMinRaw * 0.8 : 0.001, yMaxRaw / 1000));
  const yMax = Math.max(spec.logY ? yMaxRaw * 1.15 : yMaxRaw * 1.1, spec.logY ? 0.01 : 1);
  const sx = (x: number) => padLeft + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * plotW;
  const sy = (y: number) => {
    if (spec.logY) {
      const lo = Math.log10(logFloor);
      const hi = Math.log10(Math.max(logFloor * 1.01, yMax));
      const v = Math.log10(Math.max(logFloor, y));
      return padTop + plotH - ((v - lo) / Math.max(1e-9, hi - lo)) * plotH;
    }
    return padTop + plotH - (y / Math.max(1e-9, yMax)) * plotH;
  };
  const xTicks = niceTicks(xMin, xMax, 6);
  const yTicks = spec.logY ? logTicks(logFloor, yMax) : niceTicks(0, yMax, 5);
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);
  const baseY = padTop + plotH;

  yTicks.forEach(v => {
    const y = sy(v);
    parts.push(`<line x1="${padLeft}" x2="${padLeft + plotW}" y1="${y}" y2="${y}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.58"/>`);
    parts.push(`<text x="${padLeft - 10}" y="${y + tickSize * 0.34}" text-anchor="end" font-family="${FONT_SANS}" font-size="${tickSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(formatTick(v))}</text>`);
  });
  xTicks.forEach(v => {
    const x = sx(v);
    parts.push(`<line x1="${x}" x2="${x}" y1="${padTop}" y2="${baseY}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.28"/>`);
    parts.push(`<text x="${x}" y="${baseY + 20}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${tickSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(formatTick(v))}</text>`);
  });
  parts.push(`<line x1="${padLeft}" x2="${padLeft}" y1="${padTop}" y2="${baseY}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  parts.push(`<line x1="${padLeft}" x2="${padLeft + plotW}" y1="${baseY}" y2="${baseY}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  parts.push(`<text x="${padLeft + plotW / 2}" y="${height - (options.caption ? 80 : 32)}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Transfer')}</text>`);
  parts.push(`<text x="26" y="${padTop + plotH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 26 ${padTop + plotH / 2})">${escapeXml(options.yTitle || 'Value')}</text>`);

  (spec.referenceLines ?? []).forEach(ref => {
    if (!Number.isFinite(ref.y) || (spec.logY && ref.y <= 0)) return;
    const y = sy(ref.y);
    parts.push(`<line x1="${padLeft}" x2="${padLeft + plotW}" y1="${y}" y2="${y}" stroke="${escapeAttr(ref.color ?? '#64748b')}" stroke-width="1.1" stroke-dasharray="${ref.dash ? '5 4' : 'none'}" stroke-opacity="0.72"/>`);
    parts.push(`<text x="${padLeft + plotW - 4}" y="${y - 5}" text-anchor="end" font-family="${FONT_SANS}" font-size="${9.5 * fs}" fill="${escapeAttr(ref.color ?? options.mutedTextColor)}">${escapeXml(ref.label)}</text>`);
  });

  spec.series.forEach(series => {
    const pts = series.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!spec.logY || p.y > 0)).sort((a, b) => a.x - b.x);
    if (pts.length === 0) return;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
    const opacity = series.emphasis ? 1 : 0.72;
    parts.push(`<path d="${d}" fill="none" stroke="${escapeAttr(series.color)}" stroke-width="${series.emphasis ? 3.2 : 2}" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="${opacity}"/>`);
    if (options.showValues || spec.showPoints !== false) {
      pts.forEach(p => parts.push(`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${series.emphasis ? 3.6 : 2.8}" fill="${escapeAttr(series.color)}" stroke="#ffffff" stroke-width="1" stroke-opacity="0.95"/>`));
    }
  });
  if (options.showLegend) drawLineLegend(parts, spec, options, width - padRight + 32, padTop, fs);
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function renderMultiLinePanelsSvg(spec: MultiLinePanelFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(720, Math.round(options.width));
  const height = Math.max(560, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 9.2 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 62;
  const padRight = options.showLegend ? 230 : 34;
  const padTop = 118;
  const padBottom = options.caption ? 108 : 76;
  const panels = spec.panels;
  const panelCount = Math.max(1, panels.length);
  const cols = panelCount <= 2 ? panelCount : panelCount <= 6 ? 2 : 3;
  const rows = Math.ceil(panelCount / cols);
  const gapX = 22;
  const gapY = 42;
  const plotAreaW = Math.max(220, width - padLeft - padRight);
  const plotAreaH = Math.max(200, height - padTop - padBottom);
  const panelW = Math.max(160, (plotAreaW - gapX * (cols - 1)) / cols);
  const panelH = Math.max(130, (plotAreaH - gapY * (rows - 1)) / rows);
  const plotPad = { l: 44, r: 14, t: 26, b: 34 };
  const allSeries = panels.flatMap(p => p.series);
  const allPoints = allSeries.flatMap(s => s.points);
  const globalX = domainForPoints(allPoints, spec.logY);
  const globalY = yDomainForPoints(allPoints, spec.logY);
  const parts = svgStart(width, height, options, options.title || spec.title);
  drawTitle(parts, spec, options, width, padRight, titleSize, subtitleSize);

  panels.forEach((panel, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x0 = padLeft + col * (panelW + gapX);
    const y0 = padTop + row * (panelH + gapY);
    const points = panel.series.flatMap(s => s.points);
    const xDomain = domainForPoints(points, spec.logY, globalX);
    const yDomain = spec.sharedY === false ? yDomainForPoints(points, spec.logY, globalY) : globalY;
    drawSmallLinePanel(parts, panel, x0, y0, panelW, panelH, plotPad, xDomain, yDomain, spec.logY ?? false, spec.showPoints !== false, options, fs, tickSize);
  });

  parts.push(`<text x="${padLeft + plotAreaW / 2}" y="${height - (options.caption ? 78 : 30)}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'Transfer')}</text>`);
  parts.push(`<text x="24" y="${padTop + plotAreaH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 24 ${padTop + plotAreaH / 2})">${escapeXml(options.yTitle || 'Value')}</text>`);
  if (options.showLegend) {
    const unique = new Map<string, FigureLineSeries>();
    allSeries.forEach(series => { if (!unique.has(series.label)) unique.set(series.label, series); });
    drawLineLegendItems(parts, Array.from(unique.values()), options, width - padRight + 28, padTop, fs, options.legendTitle || 'Lineages');
  }
  drawCaption(parts, options, width, height, captionSize);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function drawSmallLinePanel(parts: string[], panel: MultiLinePanelFigureSpec['panels'][number], x0: number, y0: number, panelW: number, panelH: number, pad: { l: number; r: number; t: number; b: number }, xDomain: { min: number; max: number }, yDomain: { min: number; max: number; logFloor: number }, logY: boolean, showPoints: boolean, options: FigureRenderOptions, fs: number, tickSize: number) {
  const innerW = panelW - pad.l - pad.r;
  const innerH = panelH - pad.t - pad.b;
  const px = x0 + pad.l;
  const py = y0 + pad.t;
  const sx = (x: number) => px + ((x - xDomain.min) / Math.max(1e-9, xDomain.max - xDomain.min)) * innerW;
  const sy = (y: number) => {
    if (logY) {
      const lo = Math.log10(yDomain.logFloor);
      const hi = Math.log10(Math.max(yDomain.logFloor * 1.01, yDomain.max));
      const v = Math.log10(Math.max(yDomain.logFloor, y));
      return py + innerH - ((v - lo) / Math.max(1e-9, hi - lo)) * innerH;
    }
    return py + innerH - ((y - yDomain.min) / Math.max(1e-9, yDomain.max - yDomain.min)) * innerH;
  };
  parts.push(`<rect x="${x0}" y="${y0}" width="${panelW}" height="${panelH}" rx="8" fill="#f8fafc" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.75"/>`);
  parts.push(`<text x="${x0 + 10}" y="${y0 + 16}" font-family="${FONT_MONO}" font-size="${10.5 * fs}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(panel.label, 36))}</text>`);
  if (panel.subtitle) parts.push(`<text x="${x0 + 10}" y="${y0 + 31}" font-family="${FONT_SANS}" font-size="${8.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(truncateLabel(panel.subtitle, 44))}</text>`);
  const yTicksLocal = logY ? logTicks(yDomain.logFloor, yDomain.max).slice(0, 5) : niceTicks(yDomain.min, yDomain.max, 4).slice(0, 6);
  yTicksLocal.forEach(v => {
    const y = sy(v);
    parts.push(`<line x1="${px}" x2="${px + innerW}" y1="${y}" y2="${y}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.58"/>`);
    parts.push(`<text x="${px - 6}" y="${y + tickSize * 0.34}" text-anchor="end" font-family="${FONT_SANS}" font-size="${tickSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(formatTick(v))}</text>`);
  });
  niceTicks(xDomain.min, xDomain.max, 4).slice(0, 6).forEach(v => {
    const x = sx(v);
    parts.push(`<line x1="${x}" x2="${x}" y1="${py}" y2="${py + innerH}" stroke="${escapeAttr(options.borderColor)}" stroke-opacity="0.24"/>`);
    parts.push(`<text x="${x}" y="${py + innerH + 17}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${tickSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(formatTick(v))}</text>`);
  });
  parts.push(`<line x1="${px}" x2="${px}" y1="${py}" y2="${py + innerH}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  parts.push(`<line x1="${px}" x2="${px + innerW}" y1="${py + innerH}" y2="${py + innerH}" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.55"/>`);
  panel.series.forEach(series => {
    const pts = series.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!logY || p.y > 0)).sort((a, b) => a.x - b.x);
    if (pts.length === 0) return;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${escapeAttr(series.color)}" stroke-width="${series.emphasis ? 2.6 : 1.8}" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="${series.emphasis ? 1 : 0.85}"/>`);
    if (showPoints) pts.forEach(p => parts.push(`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${series.emphasis ? 3 : 2.3}" fill="${escapeAttr(series.color)}" stroke="#ffffff" stroke-width="0.9"/>`));
  });
}

function domainForPoints(points: { x: number; y: number }[], logY?: boolean, fallback?: { min: number; max: number }): { min: number; max: number } {
  void logY;
  const xs = points.map(p => p.x).filter(Number.isFinite);
  if (!xs.length) return fallback ?? { min: 0, max: 1 };
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { min, max: max <= min ? min + 1 : max };
}

function yDomainForPoints(points: { x: number; y: number }[], logY?: boolean, fallback?: { min: number; max: number; logFloor: number }): { min: number; max: number; logFloor: number } {
  const ys = points.map(p => p.y).filter(v => Number.isFinite(v) && (!logY || v > 0));
  if (!ys.length) return fallback ?? { min: 0, max: 1, logFloor: 0.001 };
  const minRaw = logY ? Math.min(...ys) : Math.min(0, ...ys);
  const maxRaw = Math.max(...ys);
  const logFloor = Math.max(0.001, Math.min(minRaw > 0 ? minRaw * 0.8 : 0.001, maxRaw / 1000 || 0.001));
  return { min: logY ? logFloor : minRaw, max: Math.max(logY ? 0.01 : 1, maxRaw * 1.12), logFloor };
}

function svgStart(width: number, height: number, options: FigureRenderOptions, title: string): string[] {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(title)}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(options.background)}"/>`,
  ];
}

function drawTitle(parts: string[], spec: FigureSpec, options: FigureRenderOptions, width: number, padRight: number, titleSize: number, subtitleSize: number) {
  parts.push(`<text x="36" y="42" font-family="${FONT_SANS}" font-size="${titleSize}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(options.title || spec.title)}</text>`);
  if (options.subtitle) {
    wrapText(options.subtitle, Math.max(40, width - 72 - padRight), subtitleSize).slice(0, 2).forEach((line, i) => {
      parts.push(`<text x="36" y="${68 + i * subtitleSize * 1.35}" font-family="${FONT_SANS}" font-size="${subtitleSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(line)}</text>`);
    });
  }
}

function drawCaption(parts: string[], options: FigureRenderOptions, width: number, height: number, captionSize: number) {
  if (!options.caption) return;
  const captionY = height - 24;
  wrapText(options.caption, width - 72, captionSize).slice(0, 2).forEach((line, i) => {
    parts.push(`<text x="36" y="${captionY + i * captionSize * 1.3}" font-family="${FONT_SANS}" font-size="${captionSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(line)}</text>`);
  });
}

function drawMutationHeatmapLegend(parts: string[], spec: MutationHeatmapFigureSpec, options: FigureRenderOptions, x: number, y: number, fs: number) {
  const labelSize = 12 * fs;
  parts.push(`<text x="${x}" y="${y}" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(options.legendTitle || 'Cell value')}</text>`);
  let ly = y + 26;
  parts.push(`<text x="${x}" y="${ly}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">Frequency uses fixed 0% to 100%</text>`);
  ly += 20;
  parts.push(`<text x="${x}" y="${ly}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">Copy number uses row range</text>`);
  ly += 24;
  const gradW = 136;
  [0, 0.25, 0.5, 0.75, 1].forEach((t, i) => {
    parts.push(`<rect x="${x + i * (gradW / 5)}" y="${ly}" width="${gradW / 5 + 1}" height="14" fill="${heatmapColor(t, 0, 1, 'frequency')}"/>`);
  });
  parts.push(`<rect x="${x}" y="${ly}" width="${gradW}" height="14" fill="none" stroke="${escapeAttr(options.borderColor)}"/>`);
  ly += 32;
  parts.push(`<rect x="${x}" y="${ly - 12}" width="16" height="16" rx="3" fill="${escapeAttr(options.emptyColor)}" stroke="${escapeAttr(options.borderColor)}"/>`);
  parts.push(`<text x="${x + 26}" y="${ly}" font-family="${FONT_SANS}" font-size="${11 * fs}" fill="${escapeAttr(options.mutedTextColor)}">No data</text>`);
  ly += 25;
  parts.push(`<rect x="${x}" y="${ly - 12}" width="16" height="16" rx="3" fill="#ffffff" stroke="#d97706" stroke-width="1.7"/>`);
  parts.push(`<text x="${x + 26}" y="${ly}" font-family="${FONT_SANS}" font-size="${11 * fs}" fill="${escapeAttr(options.mutedTextColor)}">Provided donor DNA</text>`);
  const metrics = dedupe(spec.mutations.map(m => m.metric)).slice(0, 4);
  if (metrics.length > 0) {
    ly += 30;
    parts.push(`<text x="${x}" y="${ly}" font-family="${FONT_SANS}" font-size="${10 * fs}" font-weight="700" fill="${escapeAttr(options.mutedTextColor)}">Rows: ${escapeXml(metrics.join(', '))}</text>`);
  }
}

function drawLineLegend(parts: string[], spec: LineChartFigureSpec, options: FigureRenderOptions, x: number, y: number, fs: number) {
  drawLineLegendItems(parts, spec.series, options, x, y, fs, options.legendTitle || 'Lineages');
}

function drawLineLegendItems(parts: string[], seriesList: FigureLineSeries[], options: FigureRenderOptions, x: number, y: number, fs: number, title: string) {
  const labelSize = 12 * fs;
  parts.push(`<text x="${x}" y="${y}" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(title)}</text>`);
  let ly = y + 26;
  seriesList.slice(0, 14).forEach((series, idx) => {
    const rowY = ly + idx * 20;
    parts.push(`<line x1="${x}" x2="${x + 16}" y1="${rowY - 4}" y2="${rowY - 4}" stroke="${escapeAttr(series.color)}" stroke-width="${series.emphasis ? 3.2 : 2}" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${x + 8}" cy="${rowY - 4}" r="3" fill="${escapeAttr(series.color)}" stroke="#ffffff" stroke-width="1"/>`);
    parts.push(`<text x="${x + 26}" y="${rowY}" font-family="${FONT_MONO}" font-size="${10.5 * fs}" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(series.label, 22))}</text>`);
  });
  if (seriesList.length > 14) {
    parts.push(`<text x="${x}" y="${ly + 14 * 20 + 6}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">+ ${seriesList.length - 14} more lineages</text>`);
  }
}

function drawVariantLegend(parts: string[], spec: LibraryBarsFigureSpec | LibraryHeatmapFigureSpec, options: FigureRenderOptions, x: number, y: number, maxWidth: number, fs: number) {
  const labelSize = 12 * fs;
  parts.push(`<text x="${x}" y="${y}" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(options.legendTitle || 'Library variants')}</text>`);
  let ly = y + 24;
  parts.push(`<text x="${x}" y="${ly}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(metricTitle(spec.metric, spec.kind === 'libraryBars' && spec.normalizedBars))}</text>`);
  ly += 24;
  spec.variants.slice(0, 16).forEach((variant, idx) => {
    const rowY = ly + idx * 20;
    parts.push(`<rect x="${x}" y="${rowY - 11}" width="14" height="14" rx="3" fill="${escapeAttr(variant.color)}" stroke="${escapeAttr(options.borderColor)}"/>`);
    parts.push(`<text x="${x + 22}" y="${rowY}" font-family="${FONT_MONO}" font-size="${10.5 * fs}" fill="${escapeAttr(options.textColor)}">${escapeXml(truncateLabel(variant.label, 20))}</text>`);
    if (variant.aiA || variant.aiB) parts.push(`<text x="${x + Math.min(maxWidth - 34, 132)}" y="${rowY}" font-family="${FONT_SANS}" font-size="${8.5 * fs}" font-weight="800" fill="#7c2d12">AI</text>`);
  });
  if (spec.variants.length > 16) {
    parts.push(`<text x="${x}" y="${ly + 16 * 20 + 6}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">+ ${spec.variants.length - 16} more variants</text>`);
  }
  if (spec.kind === 'libraryHeatmap') {
    const gy = ly + Math.min(17, spec.variants.length + 1) * 20 + 12;
    parts.push(`<text x="${x}" y="${gy}" font-family="${FONT_SANS}" font-size="${10 * fs}" font-weight="700" fill="${escapeAttr(options.mutedTextColor)}">Cell intensity</text>`);
    [0.2, 0.45, 0.7, 1].forEach((opacity, i) => {
      parts.push(`<rect x="${x + i * 22}" y="${gy + 9}" width="18" height="14" rx="3" fill="#2563eb" fill-opacity="${opacity}" stroke="${escapeAttr(options.borderColor)}"/>`);
    });
  }
}

function formatMetric(value: number, metric: 'abundance' | 'count'): string {
  if (!Number.isFinite(value) || value <= 0) return metric === 'count' ? '0' : '0%';
  if (metric === 'count') return Math.round(value).toLocaleString();
  if (value < 0.001) return '<0.1%';
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function formatGenericValue(value: number, metric: string): string {
  if (!Number.isFinite(value)) return '';
  if (metric === 'frequency') return `${Math.round(value * 100)}%`;
  if (metric === 'copy_number') return value.toFixed(1);
  return value.toPrecision(3);
}

function heatmapColor(value: number, min: number, max: number, metric: string): string {
  const span = max - min;
  const t = span > 1e-9 ? Math.max(0, Math.min(1, (value - min) / span)) : (value > 0 ? 1 : 0);
  const hue = metric === 'copy_number' ? 160 : metric === 'frequency' ? 214 : 215;
  const sat = metric === 'other' ? 8 : 70;
  const light = 96 - t * 58;
  return hslToHex(hue, sat, light);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = light - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(value % 1 === 0 ? 0 : 1);
  if (Math.abs(value) >= 1) return value.toFixed(value % 1 === 0 ? 0 : 1);
  return value.toPrecision(2);
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = Math.max(1e-9, max - min);
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 0.5 && ticks.length < 12; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks.length ? ticks : [min, max];
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  const decLo = Math.floor(Math.log10(Math.max(1e-9, min)));
  const decHi = Math.ceil(Math.log10(Math.max(min * 1.01, max)));
  for (let d = decLo; d <= decHi; d++) {
    const v = Math.pow(10, d);
    if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v);
  }
  return ticks.length >= 2 ? ticks : [min, max];
}

function truncateLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, Math.max(1, max - 3))}...` : label;
}

function splitVariantLabel(label: string): [string, string] | null {
  const match = label.match(/^(A\d+)-(B\d+)$/i);
  return match ? [match[1].toUpperCase(), match[2].toUpperCase()] : null;
}

function readableTextForFill(color: string): string {
  const hex = normalizeHex(color);
  if (hex) return textOnColor(hex);
  const hsl = color.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!hsl) return '#ffffff';
  const hue = Number.parseFloat(hsl[1]);
  const light = Number.parseFloat(hsl[3]);
  const threshold = hue >= 45 && hue <= 200 ? 52 : 62;
  return light >= threshold ? '#0f172a' : '#ffffff';
}

function renderPairingSvg(spec: PairingFigureSpec, options: FigureRenderOptions): string {
  const width = Math.max(520, Math.round(options.width));
  const height = Math.max(420, Math.round(options.height));
  const fs = Math.max(0.6, Math.min(1.8, options.fontScale || 1));
  const titleSize = 24 * fs;
  const subtitleSize = 13 * fs;
  const labelSize = 12 * fs;
  const tickSize = 11 * fs;
  const valueSize = 9.5 * fs;
  const captionSize = 10.5 * fs;
  const padLeft = 132;
  const padRight = options.showLegend ? 210 : 46;
  const padTop = 130;
  const padBottom = options.caption ? 64 : 42;
  const rows = spec.rows;
  const columns = spec.columns;
  const availableW = Math.max(120, width - padLeft - padRight);
  const availableH = Math.max(120, height - padTop - padBottom);
  const requestedCell = Math.max(12, Math.min(80, options.cellSize || 34));
  const cell = Math.max(10, Math.min(requestedCell, availableW / Math.max(1, columns.length), availableH / Math.max(1, rows.length)));
  const gridW = cell * columns.length;
  const gridH = cell * rows.length;
  const gridX = padLeft + Math.max(0, (availableW - gridW) / 2);
  const gridY = padTop + Math.max(0, (availableH - gridH) / 2);
  const cellByKey = new Map(spec.cells.map(c => [`${c.a}|${c.b}`, c]));
  const values = spec.cells.map(c => c.value ?? 0).filter(Number.isFinite);
  const maxValue = Math.max(0, ...values);
  const uniqueColors = dedupe(spec.cells.map(c => c.color)).slice(0, 12);

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(options.title || spec.title)}">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(options.background)}"/>`);
  parts.push(`<text x="36" y="42" font-family="${FONT_SANS}" font-size="${titleSize}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(options.title || spec.title)}</text>`);
  if (options.subtitle) {
    wrapText(options.subtitle, Math.max(40, width - 72 - padRight), subtitleSize).slice(0, 2).forEach((line, i) => {
      parts.push(`<text x="36" y="${68 + i * subtitleSize * 1.35}" font-family="${FONT_SANS}" font-size="${subtitleSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(line)}</text>`);
    });
  }

  parts.push(`<text x="${gridX + gridW / 2}" y="${gridY - 58}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}">${escapeXml(options.xTitle || 'VerB partner')}</text>`);
  parts.push(`<text x="${gridX - 96}" y="${gridY + gridH / 2}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="700" fill="${escapeAttr(options.textColor)}" transform="rotate(-90 ${gridX - 96} ${gridY + gridH / 2})">${escapeXml(options.yTitle || 'VerA partner')}</text>`);

  columns.forEach((col, i) => {
    const x = gridX + i * cell + cell / 2;
    const y = gridY - 13;
    parts.push(`<g transform="translate(${x} ${y}) rotate(-45)">`);
    parts.push(`<text text-anchor="start" font-family="${FONT_MONO}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.textColor)}">${escapeXml(col.label)}</text>`);
    if (col.ai) parts.push(`<text x="${Math.max(22, col.label.length * tickSize * 0.62)}" y="0" font-family="${FONT_SANS}" font-size="${8.5 * fs}" font-weight="800" fill="#7c2d12">AI</text>`);
    parts.push(`</g>`);
  });

  rows.forEach((row, rowIdx) => {
    const y = gridY + rowIdx * cell;
    parts.push(`<text x="${gridX - 14}" y="${y + cell / 2 + tickSize * 0.35}" text-anchor="end" font-family="${FONT_MONO}" font-size="${tickSize}" font-weight="650" fill="${escapeAttr(options.textColor)}">${escapeXml(row.label)}</text>`);
    if (row.ai) parts.push(`<text x="${gridX - 10}" y="${y + cell / 2 + tickSize * 0.35}" font-family="${FONT_SANS}" font-size="${8.5 * fs}" font-weight="800" fill="#7c2d12">AI</text>`);
    columns.forEach((col, colIdx) => {
      const x = gridX + colIdx * cell;
      const found = cellByKey.get(`${row.id}|${col.id}`);
      const fill = found ? found.color : options.emptyColor;
      const opacity = found && maxValue > 0 && found.value != null ? Math.max(0.45, Math.min(1, 0.35 + 0.65 * found.value / maxValue)) : 1;
      parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${Math.max(1, cell - 2)}" height="${Math.max(1, cell - 2)}" rx="${Math.max(1.5, cell * 0.09)}" fill="${escapeAttr(fill)}" fill-opacity="${opacity.toFixed(3)}" stroke="${escapeAttr(options.borderColor)}" stroke-width="0.75"/>`);
      if (found) {
        parts.push(`<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${Math.max(2.2, cell * 0.12)}" fill="#ffffff" fill-opacity="0.86" stroke="rgba(15,23,42,0.18)" stroke-width="0.5"/>`);
        if (options.showValues && found.valueLabel) {
          parts.push(`<text x="${x + cell / 2}" y="${y + cell / 2 + valueSize * 0.35}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${Math.min(valueSize, cell * 0.28)}" font-weight="750" fill="${escapeAttr(textOnColor(found.color))}">${escapeXml(found.valueLabel)}</text>`);
        }
        if (found.ai) {
          const r = Math.max(3, cell * 0.15);
          parts.push(`<circle cx="${x + cell - r - 2}" cy="${y + r + 2}" r="${r}" fill="${escapeAttr(options.aiMarkerColor)}" stroke="#ffffff" stroke-width="1.2"/>`);
        }
      }
    });
  });

  parts.push(`<rect x="${gridX}" y="${gridY}" width="${gridW}" height="${gridH}" fill="none" stroke="${escapeAttr(options.textColor)}" stroke-opacity="0.45" stroke-width="1"/>`);

  if (options.showLegend) {
    const lx = width - padRight + 32;
    let ly = padTop;
    parts.push(`<text x="${lx}" y="${ly}" font-family="${FONT_SANS}" font-size="${labelSize}" font-weight="750" fill="${escapeAttr(options.textColor)}">${escapeXml(options.legendTitle || 'Partner pairing')}</text>`);
    ly += 24;
    parts.push(`<rect x="${lx}" y="${ly - 12}" width="16" height="16" rx="3" fill="${uniqueColors[0] ? escapeAttr(uniqueColors[0]) : '#2563eb'}" stroke="${escapeAttr(options.borderColor)}"/>`);
    parts.push(`<circle cx="${lx + 8}" cy="${ly - 4}" r="3" fill="#ffffff" fill-opacity="0.86"/>`);
    parts.push(`<text x="${lx + 26}" y="${ly}" font-family="${FONT_SANS}" font-size="${11 * fs}" fill="${escapeAttr(options.mutedTextColor)}">Observed pair</text>`);
    ly += 25;
    parts.push(`<rect x="${lx}" y="${ly - 12}" width="16" height="16" rx="3" fill="${escapeAttr(options.emptyColor)}" stroke="${escapeAttr(options.borderColor)}"/>`);
    parts.push(`<text x="${lx + 26}" y="${ly}" font-family="${FONT_SANS}" font-size="${11 * fs}" fill="${escapeAttr(options.mutedTextColor)}">No observed pair</text>`);
    ly += 25;
    parts.push(`<rect x="${lx}" y="${ly - 12}" width="16" height="16" rx="3" fill="#94a3b8" stroke="${escapeAttr(options.borderColor)}"/>`);
    parts.push(`<circle cx="${lx + 13}" cy="${ly - 9}" r="4" fill="${escapeAttr(options.aiMarkerColor)}" stroke="#ffffff" stroke-width="1"/>`);
    parts.push(`<text x="${lx + 26}" y="${ly}" font-family="${FONT_SANS}" font-size="${11 * fs}" fill="${escapeAttr(options.mutedTextColor)}">AI partner</text>`);
    if (spec.metricLabel) {
      ly += 29;
      wrapText(spec.metricLabel, padRight - 54, 11 * fs).slice(0, 4).forEach((line, i) => {
        parts.push(`<text x="${lx}" y="${ly + i * 15 * fs}" font-family="${FONT_SANS}" font-size="${10.5 * fs}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(line)}</text>`);
      });
      ly += 60;
    }
    if (uniqueColors.length > 1) {
      parts.push(`<text x="${lx}" y="${ly}" font-family="${FONT_SANS}" font-size="${10 * fs}" font-weight="700" fill="${escapeAttr(options.mutedTextColor)}">Variant colors</text>`);
      ly += 12;
      uniqueColors.forEach((color, i) => {
        const x = lx + (i % 6) * 22;
        const y = ly + Math.floor(i / 6) * 20;
        parts.push(`<rect x="${x}" y="${y}" width="15" height="15" rx="3" fill="${escapeAttr(color)}" stroke="${escapeAttr(options.borderColor)}"/>`);
      });
    }
  }

  if (options.caption) {
    const captionY = height - 24;
    wrapText(options.caption, width - 72, captionSize).slice(0, 2).forEach((line, i) => {
      parts.push(`<text x="36" y="${captionY + i * captionSize * 1.3}" font-family="${FONT_SANS}" font-size="${captionSize}" fill="${escapeAttr(options.mutedTextColor)}">${escapeXml(line)}</text>`);
    });
  }
  parts.push(`</svg>`);
  return parts.join('\n');
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const approxChars = Math.max(12, Math.floor(maxWidth / Math.max(4, fontSize * 0.58)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > approxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach(value => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function textOnColor(color: string): string {
  const hex = normalizeHex(color);
  if (!hex) return '#0f172a';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.58 ? '#0f172a' : '#ffffff';
}

function normalizeHex(color: string): string | null {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  return null;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
}

function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('SVG preview image failed to load'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}
