// Document helpers: ids, edits that keep references consistent, and canonical serialisation.

import { formatRef, parseRef } from './expand';
import { symbolFor } from './symbols';
import { FORMAT_VERSION, type Block, type Connection, type LineupDoc } from './types';
import { uniqueId } from './iq';

export function emptyDoc(): LineupDoc {
  return { lineup: FORMAT_VERSION, title: 'Untitled', blocks: [], connections: [] };
}

const ID_PREFIX: Record<string, string> = { antenna: 'ant', iq_demod: 'dmd', iq_mod: 'mod', duplexer: 'dup', splitter: 'spl', custom: 'blk' };

export function newBlockId(doc: LineupDoc, type: string): string {
  const base = ID_PREFIX[type] ?? type.replace(/[^a-z0-9]/gi, '');
  const ids = new Set(doc.blocks.map((b) => b.id));
  for (let n = 1; ; n++) if (!ids.has(`${base}${n}`)) return `${base}${n}`;
}

export function renameBlock(doc: LineupDoc, from: string, to: string): boolean {
  if (!/^[A-Za-z_][\w-]*$/.test(to) || doc.blocks.some((b) => b.id === to)) return false;
  const b = doc.blocks.find((x) => x.id === from);
  if (!b) return false;
  b.id = to;
  const re = (s: string) => {
    const r = parseRef(s);
    return r && r.block === from ? formatRef({ ...r, block: to }) : s;
  };
  for (const c of doc.connections) {
    c.from = re(c.from);
    c.to = re(c.to);
  }
  for (const g of doc.groups ?? []) g.members = g.members.map((m) => (m === from ? to : m));
  for (const n of doc.notes ?? []) if (n.near === from) n.near = to;
  return true;
}

export function removeBlocks(doc: LineupDoc, ids: Set<string>): void {
  doc.blocks = doc.blocks.filter((b) => !ids.has(b.id));
  doc.connections = doc.connections.filter((c) => !ids.has(parseRef(c.from)?.block ?? '') && !ids.has(parseRef(c.to)?.block ?? ''));
  for (const g of doc.groups ?? []) g.members = g.members.filter((m) => !ids.has(m));
  if (doc.groups) doc.groups = doc.groups.filter((g) => g.members.length);
}

/** Blocks in signal-flow order: topological over connections, ties broken by current order. */
export function signalOrder(doc: LineupDoc): Block[] {
  const idx = new Map(doc.blocks.map((b, i) => [b.id, i]));
  const succ = new Map<string, Set<string>>();
  const indeg = new Map<string, number>(doc.blocks.map((b) => [b.id, 0]));
  for (const c of doc.connections) {
    let a = parseRef(c.from);
    let b = parseRef(c.to);
    if (!a || !b || !idx.has(a.block) || !idx.has(b.block) || a.block === b.block) continue;
    const ba = doc.blocks[idx.get(a.block)!];
    const pa = symbolFor(ba).def.ports.find((p) => p.name === a!.port);
    if (pa?.dir === 'in') [a, b] = [b, a];
    const s = succ.get(a.block) ?? new Set();
    if (!s.has(b.block)) {
      s.add(b.block);
      indeg.set(b.block, (indeg.get(b.block) ?? 0) + 1);
    }
    succ.set(a.block, s);
  }
  const ready = doc.blocks.filter((b) => indeg.get(b.id) === 0).map((b) => b.id);
  const out: Block[] = [];
  const done = new Set<string>();
  while (out.length < doc.blocks.length) {
    if (!ready.length) {
      // Cycle: take the first remaining block in document order.
      const next = doc.blocks.find((b) => !done.has(b.id))!;
      ready.push(next.id);
      indeg.set(next.id, 0);
    }
    ready.sort((x, y) => idx.get(x)! - idx.get(y)!);
    const id = ready.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    out.push(doc.blocks[idx.get(id)!]);
    for (const n of succ.get(id) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 1) - 1);
      if (indeg.get(n) === 0 && !done.has(n)) ready.push(n);
    }
  }
  return out;
}

const BLOCK_KEYS: (keyof Block)[] = ['id', 'type', 'label', 'x', 'y', 'rot', 'flip', 'iq', 'iqOverride', 'signal', 'size', 'ports', 'params', 'show'];
const CONN_KEYS: (keyof Connection)[] = ['from', 'to', 'label', 'domain', 'via'];

function pick<T extends object>(o: T, keys: (keyof T)[], skip: Set<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || skip.has(k)) continue;
    if (Array.isArray(v) && v.length === 0 && k !== 'members') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    if ((k === 'rot' && v === 0) || (k === 'flip' && v === false) || (k === 'iq' && v === false)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Canonical JSON: stable key order, blocks in signal order, empty fields dropped,
 * so files diff cleanly in git.
 */
export function serialize(doc: LineupDoc): string {
  const skipB = new Set<keyof Block>();
  const skipC = new Set<keyof Connection>();
  const out: Record<string, unknown> = { lineup: FORMAT_VERSION };
  if (doc.title) out.title = doc.title;
  if (doc.theme && doc.theme !== 'mono') out.theme = doc.theme;
  if (doc.style && Object.keys(doc.style).length) out.style = doc.style;
  out.blocks = signalOrder(doc).map((b) => {
    const clean = pick(b, BLOCK_KEYS, skipB);
    if (clean.params) {
      const p: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(clean.params)) if (v !== null && v !== '' && v !== undefined) p[k] = v;
      if (Object.keys(p).length) clean.params = p as Block['params'];
      else delete clean.params;
    }
    return clean;
  });
  out.connections = doc.connections.map((c) => pick(c, CONN_KEYS, skipC));
  if (doc.groups?.length) out.groups = doc.groups.map((g) => ({ id: g.id, ...(g.label ? { label: g.label } : {}), members: g.members }));
  if (doc.notes?.length) out.notes = doc.notes;
  return compactJSON(out);
}

/** Pretty JSON, but short objects and arrays of numbers stay on one line. */
export function compactJSON(v: unknown): string {
  const inline = (val: unknown): string => {
    if (val === null || typeof val !== 'object') return JSON.stringify(val) ?? 'null';
    if (Array.isArray(val)) return `[${val.map(inline).join(', ')}]`;
    const entries = Object.entries(val as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')}}`;
  };
  const lines = (val: unknown, indent: string): string => {
    if (val === null || typeof val !== 'object') return JSON.stringify(val) ?? 'null';
    const flat = inline(val);
    if (flat.length + indent.length <= 100) return flat;
    const inner = indent + '  ';
    if (Array.isArray(val)) return `[\n${val.map((x) => inner + lines(x, inner)).join(',\n')}\n${indent}]`;
    const entries = Object.entries(val as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${lines(x, inner)}`).join(',\n')}\n${indent}}`;
  };
  return lines(v, '') + '\n';
}

export { uniqueId };
