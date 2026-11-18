import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { crc32, embedInPNG, extractFromPNG, extractFromSVG, svgMetadata, sourceFromFile } from '../src/io/embed';

/** A valid 1×1 PNG built from scratch. */
function tinyPNG(): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 255, 255]));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

const json = JSON.stringify({ lineup: '0.1', title: 'Σ test − 2.4 µs ]]> end', blocks: [{ id: 'a', type: 'amp' }], connections: [] }, null, 2);

describe('embedded source', () => {
  it('crc32 matches zlib', () => {
    const b = new TextEncoder().encode('iTXtsig.json hello Σ');
    expect(crc32(b)).toBe(zlib.crc32(Buffer.from(b)));
  });

  it('PNG round-trips UTF-8 JSON and stays a valid PNG', () => {
    const png = embedInPNG(tinyPNG(), json);
    expect(extractFromPNG(png)).toBe(json);
    // Every chunk CRC still checks out, and the iTXt sits right after IHDR.
    const buf = Buffer.from(png);
    let off = 8;
    const types: string[] = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString('latin1');
      types.push(type);
      expect(buf.readUInt32BE(off + 8 + len)).toBe(zlib.crc32(buf.subarray(off + 4, off + 8 + len)));
      off += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'iTXt', 'IDAT', 'IEND']);
  });

  it('re-embedding replaces the old source instead of adding another', () => {
    const twice = embedInPNG(embedInPNG(tinyPNG(), '{"old":1}'), json);
    expect(extractFromPNG(twice)).toBe(json);
    expect(Buffer.from(twice).toString('latin1').split('sig.json').length - 1).toBe(1);
  });

  it('PNGs without source give null', () => {
    expect(extractFromPNG(tinyPNG())).toBeNull();
    expect(extractFromPNG(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('SVG round-trips, including "]]>" in the text', () => {
    const svg = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">${svgMetadata(json)}<rect/></svg>`;
    expect(extractFromSVG(svg)).toBe(json);
    expect(extractFromSVG('<svg></svg>')).toBeNull();
  });

  it('opens files by type', async () => {
    const png = embedInPNG(tinyPNG(), json);
    const r1 = await sourceFromFile(new File([png as BlobPart], 'rx.png', { type: 'image/png' }));
    expect(r1).toEqual({ text: json });
    const r2 = await sourceFromFile(new File([`<svg>${svgMetadata(json)}</svg>`], 'rx.svg', { type: 'image/svg+xml' }));
    expect(r2).toEqual({ text: json });
    const r3 = await sourceFromFile(new File(['<svg></svg>'], 'other.svg'));
    expect('error' in r3).toBe(true);
    const r4 = await sourceFromFile(new File([json], 'rx.sig.json'));
    expect(r4).toEqual({ text: json });
  });
});
