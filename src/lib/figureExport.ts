// Figure export utilities for the AI-ALE LIMS viewer.
//
// GOAL: every visualization in the app can be saved as a publication-quality
// figure without any server round-trip (the public deployment is a static
// site with no backend). Four output formats are supported, all generated in
// the browser with zero extra dependencies:
//   - PNG : a rasterized bitmap (default; what most people want for slides/email)
//   - SVG : the vector source of an SVG chart (scales crisply for manuscripts)
//   - HTML: a standalone self-contained page (for HTML/flex charts whose labels
//           must stay at fixed pixel size, e.g. the barcode "Rows" view)
//   - Print: opens the browser print dialog scoped to the figure (-> Save as PDF)
//
// All exporters are best-effort and never throw into the UI; they return a
// boolean / format string so the caller can show a small confirmation.

export type FigureExportFormat = 'png' | 'svg' | 'html';

function safeFilePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'figure';
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke a tick later so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadText(filename: string, text: string, type: string) {
  downloadBlob(filename, new Blob([text], { type }));
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));
}

// Collect all same-origin CSS so a cloned/serialized fragment renders with the
// app's real styling (tokens, fonts, data colors). Cross-origin sheets cannot
// be read and are skipped gracefully.
function collectStyles(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
      if (rules) parts.push(rules);
    } catch {
      // cross-origin stylesheet, ignore
    }
  }
  return parts.join('\n');
}

// Resolve the page's effective background so a rasterized figure does not come
// out transparent (PNG with alpha looks broken on a white slide).
function pageBackground(): string {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  } catch { /* ignore */ }
  return '#ffffff';
}

/* ------------------------------------------------------------------ SVG ---- */

function inlineSvgForDownload(svg: SVGSVGElement, title: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('role', 'img');
  clone.setAttribute('aria-label', title);
  // Ensure intrinsic size attributes exist so the file opens at a sensible size.
  const rect = svg.getBoundingClientRect();
  if (!clone.getAttribute('width') && rect.width) clone.setAttribute('width', String(Math.round(rect.width)));
  if (!clone.getAttribute('height') && rect.height) clone.setAttribute('height', String(Math.round(rect.height)));
  if (!clone.querySelector('title')) {
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.textContent = title;
    clone.insertBefore(titleEl, clone.firstChild);
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    :root { color-scheme: light; }
    text { font-family: Inter, Arial, sans-serif; }
    .font-mono, text.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  `;
  clone.insertBefore(style, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}\n`;
}

export function exportSvgFigure(svg: SVGSVGElement | null, title: string, filenameBase: string): boolean {
  if (!svg) return false;
  const filename = `${safeFilePart(filenameBase)}-${timestamp()}.svg`;
  downloadText(filename, inlineSvgForDownload(svg, title), 'image/svg+xml;charset=utf-8');
  return true;
}

/* ------------------------------------------------------------------ PNG ---- */

// Rasterize an <svg> element to PNG at a chosen pixel scale (default 2x for
// crisp output). Returns a promise that resolves true on success.
async function svgToPng(svg: SVGSVGElement, filenameBase: string, scale = 2, bg = '#ffffff'): Promise<boolean> {
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || Number(svg.getAttribute('width')) || 800));
  const h = Math.max(1, Math.round(rect.height || Number(svg.getAttribute('height')) || 600));
  const svgText = inlineSvgForDownload(svg, filenameBase);
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(canvas);
    if (!blob) return false;
    downloadBlob(`${safeFilePart(filenameBase)}-${timestamp()}.png`, blob);
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

// Rasterize an arbitrary HTML element to PNG by wrapping its serialized markup
// in an SVG <foreignObject> and drawing that to a canvas. This keeps HTML/flex
// charts (e.g. barcode Rows) pixel-accurate. Best-effort: complex CSS edge
// cases can fall back to the HTML export.
async function htmlElementToPng(element: HTMLElement, filenameBase: string, scale = 2, bg = '#ffffff'): Promise<boolean> {
  const rect = element.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const clone = element.cloneNode(true) as HTMLElement;
  syncFormState(element, clone);
  const styles = collectStyles();
  // Serialize into XHTML-compatible markup for foreignObject.
  const wrapper = document.createElement('div');
  wrapper.appendChild(clone);
  const inner = wrapper.innerHTML;
  const svgText =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;background:${bg};overflow:hidden">` +
    `<style>${styles}</style>${inner}</div>` +
    `</foreignObject></svg>`;
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(canvas);
    if (!blob) return false;
    downloadBlob(`${safeFilePart(filenameBase)}-${timestamp()}.png`, blob);
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
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

// Mirror live form state (checkboxes, selects, inputs) onto a clone so a
// serialized snapshot reflects what the user currently sees.
function syncFormState(source: HTMLElement, clone: HTMLElement) {
  const srcEls = source.querySelectorAll('input,select,textarea');
  const cloneEls = clone.querySelectorAll('input,select,textarea');
  cloneEls.forEach((el, i) => {
    const src = srcEls[i];
    if (el instanceof HTMLInputElement && src instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (src.checked) el.setAttribute('checked', 'checked'); else el.removeAttribute('checked');
      } else {
        el.setAttribute('value', src.value);
      }
    } else if (el instanceof HTMLSelectElement && src instanceof HTMLSelectElement) {
      Array.from(el.options).forEach((opt, j) => {
        if (src.options[j]?.selected) opt.setAttribute('selected', 'selected'); else opt.removeAttribute('selected');
      });
    } else if (el instanceof HTMLTextAreaElement && src instanceof HTMLTextAreaElement) {
      el.textContent = src.value;
    }
  });
}

/* ------------------------------------------------------------------ HTML --- */

export function exportElementHtml(element: HTMLElement | null, title: string, filenameBase: string): boolean {
  if (!element) return false;
  const clone = element.cloneNode(true) as HTMLElement;
  syncFormState(element, clone);
  // Strip interactive chrome that makes no sense in a static figure.
  clone.querySelectorAll('[data-figure-omit]').forEach(el => el.remove());
  const styles = collectStyles();
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${styles}
body { margin: 24px; background: #ffffff; color: #0f172a; }
.export-note { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #475569; margin-bottom: 12px; }
@media print { body { margin: 0.35in; } .no-print { display: none !important; } }
</style>
</head>
<body>
<div class="export-note">${escapeHtml(title)} — exported from the AI-ALE LIMS viewer on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Open in a browser, then Print to PDF or place the SVG/HTML into a manuscript workflow.</div>
${clone.outerHTML}
</body>
</html>`;
  downloadText(`${safeFilePart(filenameBase)}-${timestamp()}.html`, html, 'text/html;charset=utf-8');
  return true;
}

/* ----------------------------------------------------------------- Print --- */

// Open the browser print dialog scoped to just the figure, so the user can
// "Save as PDF" a clean, full-resolution copy. Works for both SVG and HTML
// charts since it prints the live rendered DOM.
export function printFigure(element: HTMLElement | SVGSVGElement | null, title: string): boolean {
  if (!element) return false;
  const clone = element.cloneNode(true) as HTMLElement;
  if (element instanceof HTMLElement) syncFormState(element, clone);
  const styles = collectStyles();
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>${styles}
body { margin: 0.4in; background:#fff; color:#0f172a; }
.print-title { font:600 14px Inter,Arial,sans-serif; margin-bottom:4px; }
.print-meta { font:11px ui-monospace,monospace; color:#475569; margin-bottom:14px; }
@page { size: auto; margin: 0.4in; }
</style></head><body>
<div class="print-title">${escapeHtml(title)}</div>
<div class="print-meta">AI-ALE LIMS viewer — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
${clone.outerHTML}
</body></html>`);
  win.document.close();
  // Give the new window a tick to lay out before printing.
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* ignore */ } }, 350);
  return true;
}

/* --------------------------------------------------- High-level dispatch --- */

// Find the most informative target inside a container: prefer a single SVG
// chart (vector), otherwise treat the whole element as an HTML figure.
function resolveSvg(target: HTMLElement | SVGSVGElement): SVGSVGElement | null {
  if (target instanceof SVGSVGElement) return target;
  const svgs = target.querySelectorAll('svg');
  // Only use the SVG path when there is exactly ONE chart svg; multiple svgs
  // (a grid of charts) should rasterize the whole container instead.
  if (svgs.length === 1) return svgs[0] as SVGSVGElement;
  return null;
}

// Export a figure in an explicit format. PNG/SVG/HTML download a file; the
// returned value reports what actually happened (async for PNG).
export async function exportFigure(
  target: HTMLElement | SVGSVGElement | null,
  format: FigureExportFormat,
  title: string,
  filenameBase: string,
): Promise<FigureExportFormat | null> {
  if (!target) return null;
  const bg = pageBackground();
  if (format === 'svg') {
    const svg = resolveSvg(target);
    return svg && exportSvgFigure(svg, title, filenameBase) ? 'svg' : null;
  }
  if (format === 'html') {
    const el = target instanceof SVGSVGElement ? (target.parentElement as HTMLElement) : target;
    return exportElementHtml(el, title, filenameBase) ? 'html' : null;
  }
  // PNG
  const svg = resolveSvg(target);
  if (svg) {
    const ok = await svgToPng(svg, filenameBase, 2, bg);
    if (ok) return 'png';
  }
  if (target instanceof HTMLElement) {
    const ok = await htmlElementToPng(target, filenameBase, 2, bg);
    if (ok) return 'png';
    // Last resort: standalone HTML the user can print.
    return exportElementHtml(target, title, filenameBase) ? 'html' : null;
  }
  return null;
}

// Backwards-compatible default: pick the best single-file format automatically
// (SVG for a lone chart, otherwise PNG of the container).
export async function exportBestFigure(
  target: HTMLElement | SVGSVGElement | null,
  title: string,
  filenameBase: string,
): Promise<FigureExportFormat | null> {
  if (!target) return null;
  const svg = resolveSvg(target);
  if (svg) return exportSvgFigure(svg, title, filenameBase) ? 'svg' : null;
  return exportFigure(target, 'png', title, filenameBase);
}
