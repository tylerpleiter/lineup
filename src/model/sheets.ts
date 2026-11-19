// Hierarchical sheets.
//
// A sheet is a sub-diagram stored in `doc.sheets[name]`. A block `{type: "sheet", sheet: name}`
// stands for it: each `port_in` block inside becomes an input port (left side) named after the
// port block's id, each `port_out` an output port (right side). For analysis the hierarchy is
// flattened: inner blocks get ids like "rxfe/lna" and connections run straight through ports.

import { formatRef, parseRef, type Ref } from './expand';
import { symbolFor } from './symbols';
import type { Block, Connection, Domain, LineupDoc, PortDef, Sheet } from './types';

export const MAX_DEPTH = 8;

/** Ports of a sheet block, from the port_in / port_out blocks of its sheet, ordered top to bottom. */
export function sheetPorts(doc: Pick<LineupDoc, 'sheets'>, b: Block): PortDef[] {
  const sheet = b.sheet ? doc.sheets?.[b.sheet] : undefined;
  if (!sheet) return [];
  const order = (x: Block, i: number) => (x.y ?? i * 10) + (x.x ?? 0) / 1000;
  const portsOf = (type: string) =>
    sheet.blocks
      .map((x, i) => ({ x, k: order(x, i) }))
      .filter(({ x }) => x.type === type)
      .sort((p, q) => p.k - q.k)
      .map(({ x }) => x);
  const port = (x: Block, dir: 'in' | 'out'): PortDef => ({
    name: x.id,
    side: dir === 'in' ? 'l' : 'r',
    dir,
    signal: x.signal ?? 'se',
    domain: (x.domain as Domain | undefined) ?? 'signal',
  });
  return [...portsOf('port_in').map((x) => port(x, 'in')), ...portsOf('port_out').map((x) => port(x, 'out'))];
}

/** Names of sheets used (directly or indirectly) by a sheet, to stop cycles. */
export function sheetUses(doc: Pick<LineupDoc, 'sheets'>, name: string, seen = new Set<string>()): Set<string> {
  const sh = doc.sheets?.[name];
  if (!sh || seen.has(name)) return seen;
  seen.add(name);
  for (const b of sh.blocks) if (b.type === 'sheet' && b.sheet) sheetUses(doc, b.sheet, seen);
  return seen;
}

export interface Flat {
  doc: LineupDoc;
  /** View-level ref of a sheet block port ("rxfe.out") → the flattened ref that drives it. */
  drivers: Map<string, string>;
  issues: string[];
}

interface Level {
  blocks: Block[];
  connections: Connection[];
  /** port_in id → flattened refs it feeds; port_out id → flattened ref that drives it. */
  inputs: Map<string, string[]>;
  outputs: Map<string, string>;
}

/**
 * Inline every sheet block. Block ids inside a sheet are prefixed with the sheet block's id
 * and "/"; port_in / port_out blocks disappear and connections join straight through them.
 */
export function flatten(doc: LineupDoc): Flat {
  const issues: string[] = [];
  const drivers = new Map<string, string>();

  function level(content: Pick<Sheet, 'blocks' | 'connections'>, prefix: string, depth: number, stack: string[]): Level {
    const blocks: Block[] = [];
    const connections: Connection[] = [];
    const inner = new Map<string, Level>();
    for (const b of content.blocks) {
      if (b.type === 'sheet') {
        const sh = b.sheet ? doc.sheets?.[b.sheet] : undefined;
        if (!sh) {
          issues.push(`${prefix}${b.id}: sheet "${b.sheet ?? ''}" not found`);
          continue;
        }
        if (depth >= MAX_DEPTH || stack.includes(b.sheet!)) {
          issues.push(`${prefix}${b.id}: sheet "${b.sheet}" contains itself`);
          continue;
        }
        const lv = level(sh, `${prefix}${b.id}/`, depth + 1, [...stack, b.sheet!]);
        inner.set(b.id, lv);
        blocks.push(...lv.blocks);
        connections.push(...lv.connections);
        continue;
      }
      if (prefix && (b.type === 'port_in' || b.type === 'port_out')) continue;
      blocks.push({ ...b, id: prefix + b.id });
    }
    const isPort = (r: Ref, type: string) => prefix !== '' && content.blocks.some((x) => x.id === r.block && x.type === type);
    // Resolve one endpoint to flattened refs (several when a sheet input fans out inside).
    const resolve = (r: Ref, asDriver: boolean): string[] => {
      const lv = inner.get(r.block);
      if (lv) {
        if (asDriver) {
          const d = lv.outputs.get(r.port);
          return d ? [d] : [];
        }
        return lv.inputs.get(r.port) ?? [];
      }
      return [formatRef({ ...r, block: prefix + r.block })];
    };
    const inputs = new Map<string, string[]>();
    const outputs = new Map<string, string>();
    for (const c of content.connections) {
      let f = parseRef(c.from);
      let t = parseRef(c.to);
      if (!f || !t) continue;
      // Orient driver → load so sheet ports resolve the right way round.
      const fDef = content.blocks.find((x) => x.id === f!.block);
      const fPort = fDef && fDef.type !== 'sheet' ? symbolFor(fDef).def.ports.find((p) => p.name === f!.port) : undefined;
      const fIsSheetInput = fDef?.type === 'sheet' && (inner.get(f.block)?.inputs.has(f.port) ?? false);
      if ((fPort?.dir === 'in') || fIsSheetInput || isPort(t, 'port_in') || isPort(f, 'port_out')) [f, t] = [t, f];
      if (isPort(f, 'port_in')) {
        inputs.set(f.block, [...(inputs.get(f.block) ?? []), ...resolve(t, false)]);
        continue;
      }
      if (isPort(t, 'port_out')) {
        const d = resolve(f, true)[0];
        if (d) outputs.set(t.block, d);
        continue;
      }
      const froms = resolve(f, true);
      const tos = resolve(t, false);
      for (const a of froms) for (const z of tos) connections.push({ ...c, from: a, to: z });
      if (inner.has(f.block) && froms[0]) drivers.set(`${prefix}${f.block}.${f.port}`, froms[0]);
      // Inside a sheet, its port_in block's output shows whatever drives the sheet input.
      if (inner.has(t.block) && froms[0]) drivers.set(`${prefix}${t.block}/${t.port}.out`, froms[0]);
    }
    for (const [id, lv] of inner) for (const [port, d] of lv.outputs) drivers.set(`${prefix}${id}.${port}`, d);
    return { blocks, connections, inputs, outputs };
  }

  const top = level(doc, '', 0, []);
  const { sheets: _sheets, ...rest } = doc;
  void _sheets;
  return { doc: { ...rest, blocks: top.blocks, connections: top.connections }, drivers, issues };
}

/**
 * Move the given blocks into a new sheet. Connections that cross the boundary become
 * port_in / port_out blocks inside and connections to the new sheet block outside.
 * Returns the new sheet block's id.
 */
export function collapseToSheet(doc: LineupDoc, ids: Set<string>, name: string, blockId: string): string {
  const moving = doc.blocks.filter((b) => ids.has(b.id));
  const xs = moving.map((b) => b.x ?? 0);
  const ys = moving.map((b) => b.y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const inner: Sheet = { title: name, blocks: moving.map((b) => ({ ...b, x: (b.x ?? 0) - minX + 12, y: (b.y ?? 0) - minY + 4 })), connections: [] };
  const outer: Connection[] = [];
  const used = new Set(moving.map((b) => b.id));
  const portName = (base: string) => {
    let n = base.replace(/[^\w-]/g, '_');
    for (let k = 2; used.has(n); k++) n = `${base}${k}`;
    used.add(n);
    return n;
  };
  // One sheet port per outside driver (inputs) / inside driver (outputs), so fan-outs share a port.
  const inPorts = new Map<string, string>();
  const outPorts = new Map<string, string>();
  let inY = 4;
  let outY = 4;
  const dirOf = (r: Ref) => {
    const b = doc.blocks.find((x) => x.id === r.block);
    return b ? symbolFor(b).def.ports.find((p) => p.name === r.port)?.dir : undefined;
  };
  for (const c of doc.connections) {
    let f = parseRef(c.from);
    let t = parseRef(c.to);
    if (!f || !t) {
      outer.push(c);
      continue;
    }
    if (dirOf(f) === 'in' && dirOf(t) !== 'in') [f, t] = [t, f];
    const fIn = ids.has(f.block);
    const tIn = ids.has(t.block);
    if (fIn && tIn) inner.connections.push(c);
    else if (!fIn && !tIn) outer.push(c);
    else if (tIn) {
      const key = formatRef(f);
      let p = inPorts.get(key);
      if (!p) {
        p = portName(t.port === 'in' ? 'in' : t.port);
        inPorts.set(key, p);
        inner.blocks.push({ id: p, type: 'port_in', label: p, x: 2, y: inY });
        inY += 8;
        outer.push({ from: key, to: `${blockId}.${p}` });
      }
      inner.connections.push({ ...c, from: `${p}.out`, to: formatRef(t) });
    } else {
      const key = formatRef(f);
      let p = outPorts.get(key);
      if (!p) {
        p = portName(f.port === 'out' ? 'out' : f.port);
        outPorts.set(key, p);
        const maxX = Math.max(...inner.blocks.map((b) => (b.x ?? 0) + 8));
        inner.blocks.push({ id: p, type: 'port_out', label: p, x: maxX + 4, y: outY });
        outY += 8;
        inner.connections.push({ from: key, to: `${p}.in` });
      }
      outer.push({ ...c, from: `${blockId}.${p}`, to: formatRef(t) });
    }
  }
  doc.sheets = { ...(doc.sheets ?? {}), [name]: inner };
  doc.blocks = doc.blocks.filter((b) => !ids.has(b.id));
  doc.blocks.push({ id: blockId, type: 'sheet', sheet: name, label: name, x: minX, y: minY });
  doc.connections = outer;
  for (const g of doc.groups ?? []) g.members = g.members.filter((m) => !ids.has(m));
  if (doc.groups) doc.groups = doc.groups.filter((g) => g.members.length);
  return blockId;
}
