// Packs skills/sig-diagrams into public/sig-diagrams-skill.zip (folder inside the zip, as the
// Claude apps expect), so the deployed site can offer it for download. Runs before dev/build.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'skills', 'sig-diagrams');
const out = path.join(root, 'public', 'sig-diagrams-skill.zip');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === '__pycache__' || e.name.startsWith('.')) return [];
    return e.isDirectory() ? walk(p) : [p];
  });
}

const entries = [];
const central = [];
let offset = 0;
// Fixed timestamp so the zip is reproducible: 2026-01-01 00:00.
const dosTime = 0;
const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
for (const file of walk(src).sort()) {
  const name = Buffer.from(`sig-diagrams/${path.relative(src, file).split(path.sep).join('/')}`);
  const data = fs.readFileSync(file);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  entries.push(local, name, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(dosTime, 12);
  cen.writeUInt16LE(dosDate, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(comp.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(name.toString().endsWith('.py') ? (0o100755 << 16) >>> 0 : (0o100644 << 16) >>> 0, 38);
  cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += local.length + name.length + comp.length;
}
const cenSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cenSize, 12);
end.writeUInt32LE(offset, 16);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...entries, ...central, end]));
console.log(`public/sig-diagrams-skill.zip: ${central.length / 2} files, ${fs.statSync(out).size} bytes`);
