// Figure export utilities for the AI-ALE LIMS viewer.
//
// GOAL: every visualization exports as a clean, publication-quality figure with
// no server round-trip and no extra dependencies. Formats:
//   - PNG : high-resolution bitmap (3x) for slides/email
//   - SVG : self-contained vector for manuscripts (fully editable, scales crisply)
//   - HTML: standalone page for HTML/flex charts whose labels must stay fixed-px
//   - Print: opens the print dialog scoped to the figure (-> Save as PDF)
//
// THE KEY FIX (why exports used to come out as "madness"): the on-screen charts
// style themselves with CSS custom properties (var(--data-cn), var(--text-faint))
// and Tailwind utility classes (text-[10px]). When an <svg> is cloned and saved
// standalone, those variables and classes have NOTHING to resolve against, so
// colors vanish and text loses its size. We fix this by INLINING the resolved
// computed style of every node onto the clone before serializing, producing a
// self-contained figure that renders identically anywhere (file, canvas, print).
//
// All exporters are best-effort and never throw into the UI.

export type FigureExportFormat = 'png' | 'svg' | 'html';

const FONT_SANS = 'Inter, system-ui, -apple-system, Segoe UI, Arial, sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function safeFilePart(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'figure';
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function nowUtc(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadText(filename: string, text: string, type: string) {
  downloadBlob(filename, new Blob([text], { type }));
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));
}

/* ---------------------------------------------- computed-style inlining ---- */

// Presentation properties that an SVG needs baked in to render standalone. We
// copy the RESOLVED value (var()/Tailwind already collapsed by the browser).
const SVG_STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'color',
] as const;

// Walk original + clone together and write each element's resolved style as
// presentation attributes on the clone. This is what makes var()/Tailwind colors
// and font sizes survive serialization.
function inlineComputedStyles(orig: SVGElement, clone: SVGElement) {
  const cs = window.getComputedStyle(orig);
  for (const prop of SVG_STYLE_PROPS) {
    let val = cs.getPropertyValue(prop);
    if (!val) continue;
    val = val.trim();
    if (!val || val === 'none' && prop !== 'fill' && prop !== 'stroke') continue;
    // Normalize font stacks to ones a standalone renderer definitely has.
    if (prop === 'font-family') {
      val = /mono/i.test(val) ? FONT_MONO : FONT_SANS;
    }
    clone.setAttribute(prop, val);
  }
  const oc = orig.children, cc = clone.children;
  for (let i = 0; i < oc.length && i < cc.length; i++) {
    inlineComputedStyles(oc[i] as SVGElement, cc[i] as SVGElement);
  }
}

// Build a fully self-contained SVG string from a live chart <svg>, optionally
// framed with a title bar + source caption so it reads as a finished figure.
function buildStandaloneSvg(svg: SVGSVGElement, opts: { title?: string; caption?: string; frame?: boolean } = {}): string {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox?.baseVal;
  const innerW = Math.max(1, Math.round((vb && vb.width) || rect.width || Number(svg.getAttribute('width')) || 800));
  const innerH = Math.max(1, Math.round((vb && vb.height) || rect.height || Number(svg.getAttribute('height')) || 600));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  // Strip tooltip/crosshair overlays that only make sense interactively.
  clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  clone.setAttribute('width', String(innerW));
  clone.setAttribute('height', String(innerH));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${innerW} ${innerH}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const title = opts.title?.trim();
  const caption = opts.caption?.trim();
  const frame = opts.frame !== false;

  if (!frame) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(clone)}\n`;
  }

  // Frame: white card, title, the chart, and a source caption.
  const padX = 24, padTop = title ? 46 : 18, padBottom = caption ? 34 : 18;
  const totalW = innerW + padX * 2;
  const totalH = innerH + padTop + padBottom;
  clone.setAttribute('x', String(padX));
  clone.setAttribute('y', String(padTop));

  const titleSvg = title
    ? `<text x="${padX}" y="26" font-family="${FONT_SANS}" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`
    : '';
  const captionSvg = caption
    ? `<text x="${padX}" y="${totalH - 12}" font-family="${FONT_MONO}" font-size="10.5" fill="#64748b">${escapeXml(caption)}</text>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" font-family="${FONT_SANS}">
<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>
${titleSvg}
${serialize(clone)}
${captionSvg}
</svg>
`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
}

function serialize(node: Element): string {
  return new XMLSerializer().serializeToString(node);
}

/* ------------------------------------------------------------------ SVG ---- */

export function exportSvgFigure(svg: SVGSVGElement | null, title: string, filenameBase: string): boolean {
  if (!svg) return false;
  const text = buildStandaloneSvg(svg, { title, caption: `AI-ALE LIMS viewer · ${nowUtc()}` });
  downloadText(`${safeFilePart(filenameBase)}-${timestamp()}.svg`, text, 'image/svg+xml;charset=utf-8');
  return true;
}

/* ------------------------------------------------------------------ PNG ---- */

async function svgToPng(svg: SVGSVGElement, title: string, filenameBase: string, scale = 3): Promise<boolean> {
  const svgText = buildStandaloneSvg(svg, { title, caption: `AI-ALE LIMS viewer · ${nowUtc()}` });
  // Read the framed dimensions back out of the string we just built.
  const m = svgText.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  const w = m ? parseInt(m[1]) : 900;
  const h = m ? parseInt(m[2]) : 640;
  return rasterize(svgText, w, h, scale, `${safeFilePart(filenameBase)}-${timestamp()}.png`);
}

async function rasterize(svgText: string, w: number, h: number, scale: number, filename: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(canvas);
    if (!blob) return false;
    downloadBlob(filename, blob);
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

// Rasterize an HTML element (e.g. the barcode "Rows" view) to PNG via an SVG
// foreignObject. We bake the document's stylesheets in so it renders correctly.
async function htmlElementToPng(element: HTMLElement, title: string, filenameBase: string, scale = 3): Promise<boolean> {
  // Capture the FULL content (scrollWidth/Height), not just the visible viewport,
  // so a scrollable heatmap/table exports in its entirety as a publication figure.
  const w = Math.max(1, Math.round(Math.max(element.scrollWidth, element.getBoundingClientRect().width)));
  const innerH = Math.max(1, Math.round(Math.max(element.scrollHeight, element.getBoundingClientRect().height)));
  const padX = 20, padTop = 44, padBottom = 30;
  const totalW = w + padX * 2;
  const totalH = innerH + padTop + padBottom;
  const clone = element.cloneNode(true) as HTMLElement;
  syncFormState(element, clone);
  clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
  // Neutralize scroll clipping on the clone so the full table paints.
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.width = `${w}px`;
  const styles = collectStyles();
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svgText =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>` +
    `<text x="${padX}" y="26" font-family="${FONT_SANS}" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>` +
    `<text x="${padX}" y="${totalH - 10}" font-family="${FONT_MONO}" font-size="10.5" fill="#64748b">AI-ALE LIMS viewer · ${nowUtc()}</text>` +
    `<foreignObject x="${padX}" y="${padTop}" width="${w}" height="${innerH}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${innerH}px;background:#ffffff;color:#0f172a;overflow:hidden">` +
    `<style>${styles}</style>${xhtml}</div></foreignObject></svg>`;
  return rasterize(svgText, totalW, totalH, scale, `${safeFilePart(filenameBase)}-${timestamp()}.png`);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
}

function collectStyles(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
      if (rules) parts.push(rules);
    } catch { /* cross-origin, skip */ }
  }
  return parts.join('\n');
}

function syncFormState(source: HTMLElement, clone: HTMLElement) {
  const srcEls = source.querySelectorAll('input,select,textarea');
  const cloneEls = clone.querySelectorAll('input,select,textarea');
  cloneEls.forEach((el, i) => {
    const src = srcEls[i];
    if (el instanceof HTMLInputElement && src instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (src.checked) el.setAttribute('checked', 'checked'); else el.removeAttribute('checked');
      } else el.setAttribute('value', src.value);
    } else if (el instanceof HTMLSelectElement && src instanceof HTMLSelectElement) {
      Array.from(el.options).forEach((opt, j) => {
        if (src.options[j]?.selected) opt.setAttribute('selected', 'selected'); else opt.removeAttribute('selected');
      });
    }
  });
}

/* ------------------------------------------------------------------ HTML --- */

export function exportElementHtml(element: HTMLElement | null, title: string, filenameBase: string): boolean {
  if (!element) return false;
  const clone = element.cloneNode(true) as HTMLElement;
  syncFormState(element, clone);
  clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
  // Inline computed styles on any SVGs inside so they survive even in HTML export.
  const origSvgs = element.querySelectorAll('svg');
  const cloneSvgs = clone.querySelectorAll('svg');
  origSvgs.forEach((s, i) => { if (cloneSvgs[i]) inlineComputedStyles(s as SVGElement, cloneSvgs[i] as SVGElement); });
  const styles = collectStyles();
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${styles}
body { margin: 28px; background: #ffffff; color: #0f172a; font-family: ${FONT_SANS}; }
.fig-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
.fig-meta { font: 11px ${FONT_MONO}; color: #64748b; margin-bottom: 16px; }
@media print { body { margin: 0.35in; } .no-print, [data-figure-omit] { display: none !important; } }
</style></head>
<body>
<div class="fig-title">${escapeHtml(title)}</div>
<div class="fig-meta">AI-ALE LIMS viewer · ${nowUtc()}</div>
${clone.outerHTML}
</body></html>`;
  downloadText(`${safeFilePart(filenameBase)}-${timestamp()}.html`, html, 'text/html;charset=utf-8');
  return true;
}

/* ----------------------------------------------------------------- Print --- */

export function printFigure(target: HTMLElement | SVGSVGElement | null, title: string): boolean {
  if (!target) return false;
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;
  let bodyInner: string;
  const svg = target instanceof SVGSVGElement ? target : resolveSvg(target);
  if (svg) {
    bodyInner = buildStandaloneSvg(svg, { title, caption: `AI-ALE LIMS viewer · ${nowUtc()}` });
  } else if (target instanceof HTMLElement) {
    const clone = target.cloneNode(true) as HTMLElement;
    syncFormState(target, clone);
    clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
    bodyInner = `<div class="fig-title">${escapeHtml(title)}</div><div class="fig-meta">AI-ALE LIMS viewer · ${nowUtc()}</div>${clone.outerHTML}`;
  } else return false;
  const styles = collectStyles();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>${styles}
body { margin: 0.4in; background:#fff; color:#0f172a; font-family:${FONT_SANS}; }
.fig-title { font-size:16px; font-weight:700; margin-bottom:4px; }
.fig-meta { font:11px ${FONT_MONO}; color:#64748b; margin-bottom:14px; }
@page { size: auto; margin: 0.4in; }
[data-figure-omit] { display:none !important; }
</style></head><body>${bodyInner}</body></html>`);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* ignore */ } }, 400);
  return true;
}

/* --------------------------------------------------- High-level dispatch --- */

// Pick the single chart <svg> to export from a container. A grid of multiple
// SVGs rasterizes as HTML instead (no single vector makes sense there).
function resolveSvg(target: HTMLElement | SVGSVGElement): SVGSVGElement | null {
  if (target instanceof SVGSVGElement) return target;
  const svgs = target.querySelectorAll('svg');
  if (svgs.length === 1) return svgs[0] as SVGSVGElement;
  // If there are several, prefer the largest (the main chart, not a legend icon).
  let best: SVGSVGElement | null = null, bestArea = 0;
  svgs.forEach(s => {
    const r = (s as SVGSVGElement).getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = s as SVGSVGElement; }
  });
  // Only treat it as a single-chart export if one SVG clearly dominates.
  return svgs.length === 1 ? (svgs[0] as SVGSVGElement) : (bestArea > 60000 && svgs.length <= 3 ? best : null);
}

export async function exportFigure(
  target: HTMLElement | SVGSVGElement | null,
  format: FigureExportFormat,
  title: string,
  filenameBase: string,
): Promise<FigureExportFormat | null> {
  if (!target) return null;
  if (format === 'svg') {
    const svg = resolveSvg(target);
    if (svg) return exportSvgFigure(svg, title, filenameBase) ? 'svg' : null;
    // No single vector chart (e.g. a grid or an HTML rows view): fall back to HTML.
    const el = target instanceof SVGSVGElement ? (target.parentElement as HTMLElement) : target;
    return exportElementHtml(el, title, filenameBase) ? 'html' : null;
  }
  if (format === 'html') {
    const el = target instanceof SVGSVGElement ? (target.parentElement as HTMLElement) : target;
    return exportElementHtml(el, title, filenameBase) ? 'html' : null;
  }
  // PNG
  const svg = resolveSvg(target);
  if (svg && await svgToPng(svg, title, filenameBase)) return 'png';
  if (target instanceof HTMLElement) {
    if (await htmlElementToPng(target, title, filenameBase)) return 'png';
    return exportElementHtml(target, title, filenameBase) ? 'html' : null;
  }
  return null;
}

export async function exportBestFigure(
  target: HTMLElement | SVGSVGElement | null, title: string, filenameBase: string,
): Promise<FigureExportFormat | null> {
  if (!target) return null;
  const svg = resolveSvg(target);
  if (svg) return exportSvgFigure(svg, title, filenameBase) ? 'svg' : null;
  return exportFigure(target, 'png', title, filenameBase);
}
