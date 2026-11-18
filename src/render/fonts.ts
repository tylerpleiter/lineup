// Inter, bundled (OFL-1.1, see assets/fonts/OFL.txt). The canvas uses it via @font-face;
// exports embed it so SVG/PNG/PDF files look the same on machines without Inter.

import regularWoff2 from '../assets/fonts/Inter-Regular.woff2?url';
import italicWoff2 from '../assets/fonts/Inter-Italic.woff2?url';
import regularTtf from '../assets/fonts/Inter-Regular.ttf?url';
import italicTtf from '../assets/fonts/Inter-Italic.ttf?url';

export const FONT_FAMILY = 'Inter';

const cache = new Map<string, Promise<string>>();

function base64(url: string): Promise<string> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          let s = '';
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(s);
        }),
    );
  }
  return cache.get(url)!;
}

/** @font-face rules with the fonts inlined, for a standalone SVG. Italic only when the drawing uses it. */
export async function embeddedFontCSS(italic: boolean): Promise<string> {
  const face = (b64: string, style: string) =>
    `@font-face{font-family:'${FONT_FAMILY}';font-style:${style};font-weight:400;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  const rules = [face(await base64(regularWoff2), 'normal')];
  if (italic) rules.push(face(await base64(italicWoff2), 'italic'));
  return rules.join('');
}

/** TrueType data for jsPDF, which can't read WOFF2. */
export async function ttfBase64(): Promise<{ regular: string; italic: string }> {
  const [regular, italic] = await Promise.all([base64(regularTtf), base64(italicTtf)]);
  return { regular, italic };
}

/** Make sure the browser has the font before measuring or rasterising text. */
export async function ensureFontsLoaded(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`12px ${FONT_FAMILY}`), document.fonts.load(`italic 12px ${FONT_FAMILY}`)]);
  } catch {
    /* fall back to the system font */
  }
}
