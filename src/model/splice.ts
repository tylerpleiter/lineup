// Insert a two-port block into an existing connection ("drop on wire").

import { formatRef, parseRef, type Expanded } from './expand';
import { normalizeConnections, propagateIQ } from './iq';
import { symbolFor } from './symbols';
import { railOf, type Connection, type LineupDoc, type PortDef } from './types';

const AUX = new Set(['lo', 'clk', 'ctrl']);

/** The signal input and output of a block that can sit inline in a chain, or null. */
export function inlinePorts(doc: LineupDoc, blockId: string): { inp: PortDef; out: PortDef } | null {
  const b = doc.blocks.find((x) => x.id === blockId);
  if (!b) return null;
  const ports = symbolFor(b).def.ports.filter((p) => !p.optional && !AUX.has(p.domain ?? 'signal'));
  const ins = ports.filter((p) => p.dir === 'in' || (p.dir === 'bi' && p.side === 'l'));
  const outs = ports.filter((p) => p.dir === 'out' || (p.dir === 'bi' && p.side === 'r'));
  if (ins.length !== 1 || outs.length !== 1 || ports.length !== 2) return null;
  return { inp: ins[0], out: outs[0] };
}

/**
 * Splice `blockId` into connection `ci`. Rail siblings (dmd.i/dmd.q → lpf.in, or
 * lpf.out → mod.i/mod.q) move together so I/Q pairs stay consistent.
 * Returns false (doc untouched) when the block can't go inline there.
 */
export function spliceBlock(doc: LineupDoc, blockId: string, ci: number): boolean {
  const io = inlinePorts(doc, blockId);
  const c = doc.connections[ci];
  if (!io || !c) return false;
  if (doc.connections.some((x) => parseRef(x.from)?.block === blockId || parseRef(x.to)?.block === blockId)) return false;
  const f = parseRef(c.from);
  const t = parseRef(c.to);
  if (!f || !t || f.block === blockId || t.block === blockId) return false;
  const portOf = (r: { block: string; port: string }) => {
    const b = doc.blocks.find((x) => x.id === r.block);
    return b ? symbolFor(b).def.ports.find((p) => p.name === r.port) : undefined;
  };
  // Orient driver → load.
  let from = c.from;
  let to = c.to;
  if (portOf(f)?.dir === 'in' && portOf(t)?.dir !== 'in') [from, to] = [to, from];
  const fr = parseRef(from)!;
  const tr = parseRef(to)!;
  const block = doc.blocks.find((x) => x.id === blockId)!;
  const xin = formatRef({ block: blockId, port: io.inp.name });
  const xout = formatRef({ block: blockId, port: io.out.name });

  const group = new Set<Connection>([c]);
  const fRail = railOf(portOf(fr));
  const tRail = railOf(portOf(tr));
  const sameFromBlockOtherRail = (x: Connection) => {
    const a = parseRef(x.from);
    const b = parseRef(x.to);
    return a && b && a.block === fr.block && x.to === to && railOf(portOf(a)) && railOf(portOf(a)) !== fRail;
  };
  const sameFromOtherRailTarget = (x: Connection) => {
    const b = parseRef(x.to);
    return b && x.from === from && b.block === tr.block && railOf(portOf(b)) && railOf(portOf(b)) !== tRail;
  };
  const next: Connection[] = [];
  if (fRail) {
    // Split: both rails into the same load → both into the new block, one link out.
    for (const x of doc.connections) if (sameFromBlockOtherRail(x)) group.add(x);
    for (const x of doc.connections) {
      if (!group.has(x)) next.push(x);
      else next.push({ ...x, to: xin });
    }
    next.push({ from: xout, to });
  } else if (tRail) {
    // Merge: one driver into both rails of a merge block → one link in, both rails out.
    for (const x of doc.connections) if (sameFromOtherRailTarget(x)) group.add(x);
    let added = false;
    for (const x of doc.connections) {
      if (!group.has(x)) next.push(x);
      else {
        if (!added) next.push({ from, to: xin });
        added = true;
        next.push({ ...x, from: xout });
      }
    }
  } else {
    for (const x of doc.connections) {
      if (x !== c) next.push(x);
      else next.push({ from, to: xin, ...(c.label ? { label: c.label } : {}) }, { from: xout, to });
    }
    const fb = doc.blocks.find((x) => x.id === fr.block);
    const tb = doc.blocks.find((x) => x.id === tr.block);
    if (fb?.iq && tb?.iq && !fr.rail && !tr.rail) block.iq = true;
  }
  doc.connections = next;
  propagateIQ(doc);
  normalizeConnections(doc);
  return true;
}

/** Connections whose drawn path crosses the given cell (grid units). */
export function wiresUnder(ex: Expanded, routes: { wire: { conn: number }; path: [number, number][] }[], cell: { x: number; y: number; w: number; h: number }): number[] {
  const hits = new Set<number>();
  const inside = (x: number, y: number) => x > cell.x && x < cell.x + cell.w && y > cell.y && y < cell.y + cell.h;
  for (const r of routes) {
    for (let i = 1; i < r.path.length; i++) {
      const a = r.path[i - 1];
      const b = r.path[i];
      const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2;
      for (let k = 0; k <= steps; k++) {
        const t = steps ? k / steps : 0;
        if (inside(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) {
          hits.add(r.wire.conn);
          break;
        }
      }
    }
  }
  void ex;
  return [...hits];
}
