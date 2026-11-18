// Export the drawn diagram (the #lineup-diagram group) as standalone SVG or PNG.
// Only the diagram layer is serialised, so selection handles and the grid never leak out.

import { G } from '../model/types';
import { embedInPNG, svgMetadata } from './embed';
import { embeddedFontCSS, ensureFontsLoaded, ttfBase64 } from '../render/fonts';

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MARGIN = 2; // grid units

/** Standalone SVG of the diagram. With `source`, the diagram JSON is embedded so the file can be reopened. */
export async function buildSVG(bounds: Bounds, opts: { background?: boolean; source?: string; embedFont?: boolean } = {}): Promise<string> {
  const g = document.getElementById('lineup-diagram');
  if (!g) throw new Error('Diagram not mounted');
  const x = (bounds.x0 - MARGIN) * G;
  const y = (bounds.y0 - MARGIN) * G;
  const w = (bounds.x1 - bounds.x0 + 2 * MARGIN) * G;
  const h = (bounds.y1 - bounds.y0 + 2 * MARGIN) * G;
  const ser = new XMLSerializer();
  let inner = '';
  for (const child of Array.from(g.childNodes)) if (child.nodeType === Node.ELEMENT_NODE) inner += ser.serializeToString(child);
  inner = inner.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '').replace(/<!---->/g, '');
  const r = (v: number) => Math.round(v * 100) / 100;
  // Embed Inter so the file renders identically without it installed.
  const fonts = opts.embedFont !== false ? `<defs><style>${await embeddedFontCSS(inner.includes('font-style="italic"'))}</style></defs>` : '';
  const bg = opts.background !== false ? `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="#fff"/>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(x)} ${r(y)} ${r(w)} ${r(h)}" width="${r(w)}" height="${r(h)}">` +
    `${opts.source ? svgMetadata(opts.source) : ''}${fonts}${bg}${inner}</svg>\n`
  );
}

/** PNG rendered from the SVG. With `source`, the diagram JSON is embedded in an iTXt chunk. */
export async function buildPNG(svg: string, scale: number, background = true, source?: string): Promise<Blob> {
  const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  const w = Number(m?.[1] ?? 800);
  const h = Number(m?.[2] ?? 600);
  const src = background ? svg : svg.replace(/<rect [^>]*fill="#fff"\/>/, '');
  const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
  try {
    await ensureFontsLoaded();
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not render SVG'));
      img.src = url;
    });
    await img.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
    if (!source) return png;
    const bytes = embedInPNG(new Uint8Array(await png.arrayBuffer()), source);
    return new Blob([bytes as BlobPart], { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Vector PDF sized to the diagram. jsPDF and svg2pdf load on first use. */
export async function buildPDF(svg: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  const w = Number(m?.[1] ?? 800);
  const h = Number(m?.[2] ?? 600);
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
  // svg2pdf measures text, so the element must be in the document while it converts.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'pt', format: [w * 0.75, h * 0.75] });
    // Embed Inter (jsPDF needs TrueType). svg2pdf picks it from the font-family list.
    const ttf = await ttfBase64();
    pdf.addFileToVFS('Inter-Regular.ttf', ttf.regular);
    pdf.addFont('Inter-Regular.ttf', 'Inter', 'normal');
    pdf.addFileToVFS('Inter-Italic.ttf', ttf.italic);
    pdf.addFont('Inter-Italic.ttf', 'Inter', 'italic');
    await svg2pdf(el, pdf, { x: 0, y: 0, width: w * 0.75, height: h * 0.75 });
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}
