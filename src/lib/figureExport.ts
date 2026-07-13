// Figure export utilities for the AI-ALE LIMS viewer.
//
// GOAL: provide the legacy DOM PNG fallback used by the PNG preview modal when a
// visualization does not yet provide a data-backed FigureSpec. Historical SVG,
// HTML, and print helpers remain here for compatibility with older code paths.
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

// Compose a container holding MANY panel <svg>s (e.g. the faceted growth-series
// small multiples) into ONE self-contained SVG, laid out on a grid that mirrors
// the on-screen positions. Each panel is inlined (styles baked) and placed via a
// <g transform>. This is what makes PNG/SVG/print export the WHOLE figure instead
// of silently downgrading to HTML when no single chart <svg> exists.
function buildComposedSvgFromPanels(container: HTMLElement, svgs: SVGSVGElement[], opts: { title?: string; caption?: string } = {}): string {
  // Derive each panel's intrinsic size and its on-screen position so we can keep
  // the same reading order and rough columns in the exported figure.
  const containerRect = container.getBoundingClientRect();
  type Panel = { svg: SVGSVGElement; w: number; h: number; left: number; top: number };
  const panels: Panel[] = svgs.map(svg => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    const w = Math.max(1, Math.round((vb && vb.width) || r.width || 300));
    const h = Math.max(1, Math.round((vb && vb.height) || r.height || 190));
    return { svg, w, h, left: r.left - containerRect.left, top: r.top - containerRect.top };
  });
  // Group panels into rows by their on-screen top (within a tolerance), then sort
  // each row by left. This reproduces the CSS-grid layout in the export.
  const tol = 12;
  const rows: Panel[][] = [];
  for (const p of [...panels].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = rows.find(r => Math.abs(r[0].top - p.top) <= tol);
    if (row) row.push(p); else rows.push([p]);
  }
  rows.forEach(r => r.sort((a, b) => a.left - b.left));

  const gap = 14;
  const cellW = Math.max(...panels.map(p => p.w));
  const cellH = Math.max(...panels.map(p => p.h));
  const cols = Math.max(1, ...rows.map(r => r.length));
  const nRows = rows.length;

  const padX = 24;
  const title = opts.title?.trim();
  const caption = opts.caption?.trim();
  const padTop = title ? 46 : 18;
  const padBottom = caption ? 34 : 18;
  const gridW = cols * cellW + (cols - 1) * gap;
  const gridH = nRows * cellH + (nRows - 1) * gap;
  const totalW = gridW + padX * 2;
  const totalH = gridH + padTop + padBottom;

  const groups: string[] = [];
  rows.forEach((row, ri) => {
    row.forEach((p, ci) => {
      const clone = p.svg.cloneNode(true) as SVGSVGElement;
      inlineComputedStyles(p.svg, clone);
      clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
      clone.removeAttribute('class');
      clone.setAttribute('width', String(p.w));
      clone.setAttribute('height', String(p.h));
      if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${p.w} ${p.h}`);
      clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const x = padX + ci * (cellW + gap);
      const y = padTop + ri * (cellH + gap);
      clone.setAttribute('x', String(x));
      clone.setAttribute('y', String(y));
      groups.push(serialize(clone));
    });
  });

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
${groups.join('\n')}
${captionSvg}
</svg>
`;
}

// Return the list of chart panel svgs in a container, excluding tiny legend/icon
// svgs and anything marked data-figure-omit.
function collectPanelSvgs(container: HTMLElement): SVGSVGElement[] {
  return Array.from(container.querySelectorAll('svg'))
    .filter(s => !s.closest('[data-figure-omit]'))
    .filter(s => {
      const r = (s as SVGSVGElement).getBoundingClientRect();
      return r.width * r.height > 3000; // drop inline icon svgs
    }) as SVGSVGElement[];
}

function serialize(node: Element): string {
  return new XMLSerializer().serializeToString(node);
}

// HTML/table figures (e.g. the library-variant heatmap) style themselves with
// CSS custom properties (var(--...)) and Tailwind classes. When cloned into a
// detached <foreignObject>, those variables no longer resolve, so backgrounds,
// borders and text colors vanish and the SVG-image often fails to load, which
// made PNG/SVG silently downgrade to HTML. We bake the RESOLVED computed style
// of the key presentation properties onto the clone so the figure renders the
// same colors it shows on screen.
const HTML_STYLE_PROPS = [
  'background-color', 'color', 'opacity', 'border-color', 'border-width',
  'border-style', 'box-shadow', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-align', 'writing-mode', 'transform',
  // Box-model / layout props so an HTML/table figure (e.g. the heatmap) renders
  // identically WITHOUT any external stylesheet. These are resolved computed
  // values, so var()/oklch collapse to concrete rgb()/px and survive serialization.
  'display', 'width', 'height', 'min-width', 'max-width', 'padding', 'margin',
  'border-radius', 'text-anchor', 'line-height', 'vertical-align', 'border-spacing',
  'border-collapse', 'white-space', 'overflow', 'box-sizing', 'letter-spacing',
] as const;

function inlineHtmlComputedStyles(orig: HTMLElement, clone: HTMLElement) {
  const cs = window.getComputedStyle(orig);
  for (const prop of HTML_STYLE_PROPS) {
    const val = cs.getPropertyValue(prop);
    if (val) clone.style.setProperty(prop, val);
  }
  const oc = orig.children, cc = clone.children;
  for (let i = 0; i < oc.length && i < cc.length; i++) {
    const oChild = oc[i], cChild = cc[i];
    if (oChild instanceof HTMLElement && cChild instanceof HTMLElement) {
      inlineHtmlComputedStyles(oChild, cChild);
    }
  }
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
  } catch (e) {
    console.warn('figure PNG rasterize failed', e);
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

// Rasterize an HTML element (e.g. the barcode "Rows" view) to PNG via an SVG
// foreignObject. Resolved computed styles are inlined onto the clone so it
// renders standalone without depending on the app stylesheet.
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
  inlineHtmlComputedStyles(element, clone);
  clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
  // Neutralize scroll clipping on the clone so the full table paints.
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.width = `${w}px`;
  // Rely solely on the inlined computed styles (inlineHtmlComputedStyles above)
  // which bake resolved presentation values directly onto every cloned node.
  // Embedding the full document stylesheet via collectStyles() broke rendering:
  // Tailwind v4 at-rules (@layer, @property, oklch(), @font-face url()) make the
  // standalone SVG-as-image fail to load in the browser's <img> decoder, silently
  // downgrading PNG export to HTML.
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svgText =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>` +
    `<text x="${padX}" y="26" font-family="${FONT_SANS}" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>` +
    `<text x="${padX}" y="${totalH - 10}" font-family="${FONT_MONO}" font-size="10.5" fill="#64748b">AI-ALE LIMS viewer · ${nowUtc()}</text>` +
    `<foreignObject x="${padX}" y="${padTop}" width="${w}" height="${innerH}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${innerH}px;background:#ffffff;color:#0f172a;overflow:hidden">` +
    `${xhtml}</div></foreignObject></svg>`;
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

// Wrap an HTML element (e.g. the library-variant heatmap <table>) in a fully
// self-contained SVG via foreignObject, relying on the inlined computed styles.
// This lets an "SVG" export of an HTML/table figure produce a real .svg file
// instead of silently downgrading to .html.
function htmlElementToSvgString(element: HTMLElement, title: string): string {
  const w = Math.max(1, Math.round(Math.max(element.scrollWidth, element.getBoundingClientRect().width)));
  const innerH = Math.max(1, Math.round(Math.max(element.scrollHeight, element.getBoundingClientRect().height)));
  const padX = 20, padTop = 44, padBottom = 30;
  const totalW = w + padX * 2;
  const totalH = innerH + padTop + padBottom;
  const clone = element.cloneNode(true) as HTMLElement;
  syncFormState(element, clone);
  inlineHtmlComputedStyles(element, clone);
  clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.width = `${w}px`;
  const xhtml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>` +
    `<text x="${padX}" y="26" font-family="${FONT_SANS}" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>` +
    `<text x="${padX}" y="${totalH - 10}" font-family="${FONT_MONO}" font-size="10.5" fill="#64748b">AI-ALE LIMS viewer \u00b7 ${nowUtc()}</text>` +
    `<foreignObject x="${padX}" y="${padTop}" width="${w}" height="${innerH}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${innerH}px;background:#ffffff;color:#0f172a;overflow:hidden">` +
    `${xhtml}</div></foreignObject></svg>
`;
}

function exportHtmlElementSvg(element: HTMLElement, title: string, filenameBase: string): boolean {
  try {
    const text = htmlElementToSvgString(element, title);
    downloadText(`${safeFilePart(filenameBase)}-${timestamp()}.svg`, text, 'image/svg+xml;charset=utf-8');
    return true;
  } catch (e) {
    console.warn('figure SVG export failed', e);
    return false;
  }
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
  const panels = svg ? [] : (target instanceof HTMLElement ? collectPanelSvgs(target) : []);
  if (svg) {
    bodyInner = buildStandaloneSvg(svg, { title, caption: `AI-ALE LIMS viewer · ${nowUtc()}` });
  } else if (panels.length > 1 && target instanceof HTMLElement) {
    bodyInner = buildComposedSvgFromPanels(target, panels, { title, caption: `AI-ALE LIMS viewer · ${nowUtc()}` });
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
//
// Views that compose their whole figure as ONE root <svg> (e.g. the faceted
// growth series) tag it with data-figure-root so we always serialize that svg
// directly, no area/count heuristics. This is additive: callers that pass a
// single svg or a div with one svg keep the existing behavior below.
function resolveSvg(target: HTMLElement | SVGSVGElement): SVGSVGElement | null {
  if (target instanceof SVGSVGElement) return target;
  // Prefer an explicitly-tagged composed root figure if present.
  const root = target.querySelector('svg[data-figure-root]');
  if (root) return root as SVGSVGElement;
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
    const el = target instanceof SVGSVGElement ? (target.parentElement as HTMLElement) : target;
    // Multi-panel figure (e.g. faceted growth series): compose all panel svgs
    // into ONE vector so the whole figure exports, not just one panel.
    if (el) {
      const panels = collectPanelSvgs(el);
      if (panels.length > 1) {
        const text = buildComposedSvgFromPanels(el, panels, { title, caption: `AI-ALE LIMS viewer \u00b7 ${nowUtc()}` });
        downloadText(`${safeFilePart(filenameBase)}-${timestamp()}.svg`, text, 'image/svg+xml;charset=utf-8');
        return 'svg';
      }
      // No vector panels (e.g. an HTML/table heatmap): still produce a real .svg
      // by embedding the element via foreignObject, never downgrade to HTML.
      if (exportHtmlElementSvg(el, title, filenameBase)) return 'svg';
      return exportElementHtml(el, title, filenameBase) ? 'html' : null;
    }
    return null;
  }
  if (format === 'html') {
    const el = target instanceof SVGSVGElement ? (target.parentElement as HTMLElement) : target;
    return exportElementHtml(el, title, filenameBase) ? 'html' : null;
  }
  // PNG
  const svg = resolveSvg(target);
  if (svg && await svgToPng(svg, title, filenameBase)) return 'png';
  if (target instanceof HTMLElement) {
    // Multi-panel figure: rasterize a composed single SVG of all panels (crisp,
    // reliable) before touching the fragile foreignObject HTML path.
    const panels = collectPanelSvgs(target);
    if (panels.length > 1) {
      const text = buildComposedSvgFromPanels(target, panels, { title, caption: `AI-ALE LIMS viewer \u00b7 ${nowUtc()}` });
      const m = text.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
      const w = m ? parseInt(m[1]) : 1000;
      const h = m ? parseInt(m[2]) : 700;
      if (await rasterize(text, w, h, 3, `${safeFilePart(filenameBase)}-${timestamp()}.png`)) return 'png';
    }
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
