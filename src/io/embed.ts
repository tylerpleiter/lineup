// Diagram source embedded in exported images, so an SVG or PNG pasted into an issue or doc
// still carries the exact diagram (like draw.io). Tools and agents can read it back out,
// and Lineup can open the image again for editing.
//
//   SVG: <metadata id="sig-source" data-format="sig.json"><![CDATA[ …json… ]]></metadata>
//   PNG: an iTXt chunk with keyword "sig.json" holding the UTF-8 JSON, uncompressed.

export const SVG_META_ID = 'sig-source';
export const PNG_KEYWORD = 'sig.json';

// ---- SVG -------------------------------------------------------------------

export function svgMetadata(json: string): string {
  // "]]>" can't appear inside CDATA: split it across two sections.
  const safe = json.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<metadata id="${SVG_META_ID}" data-format="sig.json"><![CDATA[${safe}]]></metadata>`;
}

export function extractFromSVG(svg: string): string | null {
  const m = new RegExp(`<metadata[^>]*id="${SVG_META_ID}"[^>]*>([\\s\\S]*?)</metadata>`).exec(svg);
  if (!m) return null;
  const body = m[1].trim();
  // Join CDATA sections; fall back to entity-decoded text.
  const cdata = [...body.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((x) => x[1]);
  if (cdata.length) return cdata.join('');
  return body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// ---- PNG -------------------------------------------------------------------

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPNG(b: Uint8Array): boolean {
  return b.length > 8 && SIG.every((v, i) => b[i] === v);
}

/** Return a copy of the PNG with an iTXt "sig.json" chunk right after IHDR (replacing any old one). */
export function embedInPNG(png: Uint8Array, json: string): Uint8Array {
  if (!isPNG(png)) throw new Error('Not a PNG');
  const enc = new TextEncoder();
  const text = enc.encode(json);
  const key = enc.encode(PNG_KEYWORD);
  // keyword \0 compression-flag(0) compression-method(0) language \0 translated-keyword \0 text
  const data = new Uint8Array(key.length + 5 + text.length);
  data.set(key, 0);
  data.set([0, 0, 0, 0, 0], key.length);
  data.set(text, key.length + 5);
  const type = enc.encode('iTXt');
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput));

  // Copy chunks, dropping any previous sig.json chunk, inserting ours after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let off = 8;
  while (off + 12 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + off).getUint32(0);
    const t = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    const whole = png.subarray(off, end);
    const isOurs = t === 'iTXt' && readITXtKeyword(png.subarray(off + 8, off + 8 + len)) === PNG_KEYWORD;
    if (!isOurs) parts.push(whole);
    if (t === 'IHDR') parts.push(chunk);
    off = end;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function readITXtKeyword(data: Uint8Array): string {
  const nul = data.indexOf(0);
  return String.fromCharCode(...data.subarray(0, nul < 0 ? Math.min(79, data.length) : nul));
}

/** The embedded diagram JSON in a PNG, or null. Reads uncompressed iTXt (what Lineup writes) and tEXt. */
export function extractFromPNG(png: Uint8Array): string | null {
  if (!isPNG(png)) return null;
  const dec = new TextDecoder();
  let off = 8;
  while (off + 12 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + off).getUint32(0);
    const t = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    if ((t === 'iTXt' || t === 'tEXt') && readITXtKeyword(data) === PNG_KEYWORD) {
      if (t === 'tEXt') return dec.decode(data.subarray(PNG_KEYWORD.length + 1));
      let p = PNG_KEYWORD.length + 1;
      const compressed = data[p];
      p += 2;
      p = data.indexOf(0, p) + 1; // language tag
      p = data.indexOf(0, p) + 1; // translated keyword
      if (compressed) return null; // Lineup never compresses; skip foreign compressed chunks.
      return dec.decode(data.subarray(p));
    }
    if (t === 'IEND') break;
    off += 12 + len;
  }
  return null;
}

/** Diagram source from a dropped/opened file: .sig.json/.json text, or an SVG/PNG with embedded source. */
export async function sourceFromFile(file: File): Promise<{ text: string } | { error: string }> {
  const name = file.name.toLowerCase();
  if (file.type === 'image/png' || name.endsWith('.png')) {
    const json = extractFromPNG(new Uint8Array(await file.arrayBuffer()));
    return json ? { text: json } : { error: `${file.name} has no Lineup diagram inside (only PNGs exported from Lineup do)` };
  }
  const text = await file.text();
  if (file.type === 'image/svg+xml' || name.endsWith('.svg') || /^\s*(<\?xml|<svg)/.test(text)) {
    const json = extractFromSVG(text);
    return json ? { text: json } : { error: `${file.name} has no Lineup diagram inside (only SVGs exported from Lineup do)` };
  }
  return { text };
}
