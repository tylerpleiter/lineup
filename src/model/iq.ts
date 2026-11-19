// I/Q linked-pair rules: propagation from split/merge blocks, unlink, relink, and
// keeping connections in their shortest form.

import { formatRef, parseRef, type Ref } from './expand';
import { symbolFor, SYMBOLS } from './symbols';
import { RAIL_PITCH, railOf, type Block, type Connection, type Domain, type LineupDoc, type PortDef, type Rail } from './types';

const SIGNAL_DOMAINS: Domain[] = ['signal', 'digital', 'complex'];
const isRail = (n: string): n is Rail => n === 'i' || n === 'q';
/** Rail carried by a port reference (by its symbol's port def), if any. */
function refRail(doc: LineupDoc, r: Ref): Rail | undefined {
  return railOf(portDef(doc, r) ?? { name: r.port });
}

function portDef(doc: LineupDoc, r: Ref): PortDef | undefined {
  const b = doc.blocks.find((x) => x.id === r.block);
  if (!b) return undefined;
  return symbolFor(b).def.ports.find((p) => p.name === r.port);
}

/** Connections with endpoints ordered driver → load, using symbol port directions. */
function directed(doc: LineupDoc): { a: Ref; b: Ref; c: Connection }[] {
  const out: { a: Ref; b: Ref; c: Connection }[] = [];
  for (const c of doc.connections) {
    let a = parseRef(c.from);
    let b = parseRef(c.to);
    if (!a || !b) continue;
    const pa = portDef(doc, a);
    const pb = portDef(doc, b);
    if (pa?.dir === 'in' && pb?.dir !== 'in') [a, b] = [b, a];
    out.push({ a, b, c });
  }
  return out;
}

/**
 * Mark blocks downstream of a split block's i/q outputs, and upstream of a merge block's
 * i/q inputs, as I/Q pairs. Returns the ids it changed.
 */
export function propagateIQ(doc: LineupDoc): string[] {
  const changed: string[] = [];
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const edges = directed(doc);
  const sigPort = (r: Ref) => {
    const d = portDef(doc, r)?.domain ?? 'signal';
    return SIGNAL_DOMAINS.includes(d);
  };
  const mark = (b: Block) => {
    // Custom blocks pack/unpack I/Q (serializers, FPGA blocks): propagation stops there.
    if (b.iq || b.type === 'custom' || b.type === 'sheet' || !SYMBOLS[b.type]) return false;
    b.iq = true;
    changed.push(b.id);
    return true;
  };

  // Forward from split outputs.
  const fwd: string[] = [];
  for (const { a, b } of edges) {
    const src = byId.get(a.block);
    const dst = byId.get(b.block);
    if (!src || !dst || src.iq || !refRail(doc, a) || refRail(doc, b) || !sigPort(b)) continue;
    if (mark(dst)) fwd.push(dst.id);
  }
  while (fwd.length) {
    const id = fwd.shift()!;
    for (const { a, b } of edges) {
      if (a.block !== id || refRail(doc, b) || !sigPort(a) || !sigPort(b)) continue;
      const dst = byId.get(b.block);
      if (dst && mark(dst)) fwd.push(dst.id);
    }
  }

  // Backward from merge inputs.
  const back: string[] = [];
  for (const { a, b } of edges) {
    const src = byId.get(a.block);
    const dst = byId.get(b.block);
    if (!src || !dst || dst.iq || !refRail(doc, b) || refRail(doc, a) || !sigPort(a)) continue;
    if (mark(src)) back.push(src.id);
  }
  while (back.length) {
    const id = back.shift()!;
    for (const { a, b } of edges) {
      if (b.block !== id || refRail(doc, a) || !sigPort(a) || !sigPort(b)) continue;
      const src = byId.get(a.block);
      if (src && mark(src)) back.push(src.id);
    }
  }
  return changed;
}

export function uniqueId(doc: LineupDoc, base: string): string {
  const ids = new Set(doc.blocks.map((b) => b.id));
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}${n}`)) return `${base}${n}`;
}

/** Split an I/Q pair into two ordinary blocks, `<id>_i` and `<id>_q`, rewiring connections. */
export function unlink(doc: LineupDoc, id: string): [string, string] | null {
  const b = doc.blocks.find((x) => x.id === id);
  if (!b || !b.iq) return null;
  const idI = uniqueId(doc, `${id}_i`);
  const idQ = uniqueId(doc, `${id}_q`);
  const make = (rail: Rail, nid: string): Block => {
    const nb: Block = JSON.parse(JSON.stringify({ ...b, id: nid }));
    delete nb.iq;
    delete nb.iqOverride;
    const ov = b.iqOverride?.[rail];
    if (ov?.params) nb.params = { ...(nb.params ?? {}), ...ov.params };
    if (ov?.label !== undefined) nb.label = ov.label;
    if (rail === 'q' && b.y !== undefined) nb.y = b.y + RAIL_PITCH;
    return nb;
  };
  const bi = make('i', idI);
  const bq = make('q', idQ);
  const idx = doc.blocks.indexOf(b);
  doc.blocks.splice(idx, 1, bi, bq);
  const byId = new Map(doc.blocks.map((x) => [x.id, x]));

  const next: Connection[] = [];
  for (const c of doc.connections) {
    const f = parseRef(c.from)!;
    const t = parseRef(c.to)!;
    const touchesF = f?.block === id;
    const touchesT = t?.block === id;
    if (!touchesF && !touchesT) {
      next.push(c);
      continue;
    }
    const mine = touchesF ? f : t;
    const other = touchesF ? t : f;
    const otherBlock = byId.get(other.block);
    const rewrite = (rail: Rail, otherRail?: Rail): Connection => {
      const m: Ref = { block: rail === 'i' ? idI : idQ, port: mine.port };
      const o: Ref = { ...other, rail: otherRail ?? other.rail };
      const nc: Connection = { ...c, from: formatRef(touchesF ? m : o), to: formatRef(touchesF ? o : m) };
      if (rail === 'q') delete nc.label;
      return nc;
    };
    if (mine.rail) next.push(rewrite(mine.rail));
    else if (otherBlock?.iq && !other.rail) next.push(rewrite('i', 'i'), rewrite('q', 'q'));
    else if (otherBlock?.iq && other.rail) next.push(rewrite(other.rail));
    else if (refRail(doc, other)) next.push(rewrite(refRail(doc, other)!));
    else {
      const d = otherBlock ? symbolFor(otherBlock).def.ports.find((p) => p.name === other.port)?.domain : undefined;
      if (d === 'lo' || d === 'clk' || d === 'ctrl') next.push(rewrite('i'), rewrite('q'));
      else next.push(rewrite('i'));
    }
  }
  doc.connections = next;
  normalizeConnections(doc);
  return [idI, idQ];
}

/** Link two ordinary blocks of the same type into one I/Q pair. The upper one becomes I. */
export function relink(doc: LineupDoc, aId: string, bId: string): string | null {
  const a = doc.blocks.find((x) => x.id === aId);
  const b = doc.blocks.find((x) => x.id === bId);
  if (!a || !b || a.type !== b.type || a.iq || b.iq || a === b) return null;
  const [bi, bq] = (a.y ?? 0) <= (b.y ?? 0) ? [a, b] : [b, a];
  const base = bi.id.replace(/_[iI]$/, '');
  const removing = new Set([bi.id, bq.id]);
  const others = { ...doc, blocks: doc.blocks.filter((x) => !removing.has(x.id)) };
  const nid = uniqueId(others, base);
  const merged: Block = JSON.parse(JSON.stringify(bi));
  merged.id = nid;
  merged.iq = true;
  const qDiff: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(bq.params ?? {})) if (bi.params?.[k] !== v) qDiff[k] = v;
  if (Object.keys(qDiff).length) merged.iqOverride = { q: { params: qDiff } };
  if (bq.label !== undefined && bq.label !== bi.label) merged.iqOverride = { ...(merged.iqOverride ?? {}), q: { ...(merged.iqOverride?.q ?? {}), label: bq.label } };
  const idx = Math.min(doc.blocks.indexOf(bi), doc.blocks.indexOf(bq));
  doc.blocks = doc.blocks.filter((x) => !removing.has(x.id));
  doc.blocks.splice(idx, 0, merged);
  const re = (s: string) => {
    const r = parseRef(s);
    if (!r) return s;
    if (r.block === bi.id) return formatRef({ block: nid, rail: 'i', port: r.port });
    if (r.block === bq.id) return formatRef({ block: nid, rail: 'q', port: r.port });
    return s;
  };
  doc.connections = doc.connections.map((c) => ({ ...c, from: re(c.from), to: re(c.to) }));
  for (const g of doc.groups ?? []) g.members = [...new Set(g.members.map((m) => (removing.has(m) ? nid : m)))];
  normalizeConnections(doc);
  return nid;
}

/** Rewrite connections to their shortest equivalent form and drop duplicates. */
export function normalizeConnections(doc: LineupDoc): void {
  const byId = new Map(doc.blocks.map((x) => [x.id, x]));
  const iq = (r: Ref) => !!byId.get(r.block)?.iq;
  // 1. A rail implied by the other end's port name (dmd.i → lpf:i.in) is dropped.
  let conns = doc.connections.map((c) => {
    const f = parseRef(c.from);
    const t = parseRef(c.to);
    if (!f || !t) return c;
    if (t.rail && !iq(f) && refRail(doc, f) === t.rail) t.rail = undefined;
    if (f.rail && !iq(t) && refRail(doc, t) === f.rail) f.rail = undefined;
    return { ...c, from: formatRef(f), to: formatRef(t) };
  });
  // 2. Rail pairs collapse into one connection.
  const key = (c: Connection, strip: boolean) => {
    const f = parseRef(c.from)!;
    const t = parseRef(c.to)!;
    if (!f || !t || !strip) return `${c.from}|${c.to}`;
    return `${formatRef({ ...f, rail: undefined })}|${formatRef({ ...t, rail: undefined })}`;
  };
  const railsOf = (c: Connection) => {
    const f = parseRef(c.from);
    const t = parseRef(c.to);
    return { f, t };
  };
  const groups = new Map<string, Connection[]>();
  for (const c of conns) {
    const { f, t } = railsOf(c);
    if (!f || !t || (!f.rail && !t.rail)) continue;
    const k = key(c, true);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const drop = new Set<Connection>();
  const add: Connection[] = [];
  for (const [k, list] of groups) {
    const hasRail = (r: Rail) =>
      list.find((c) => {
        const { f, t } = railsOf(c);
        const fr = f!.rail;
        const tr = t!.rail;
        // Both iq ends: rails must match; one plain aux end: only the iq end has a rail.
        if (fr && tr) return fr === r && tr === r;
        return (fr ?? tr) === r;
      });
    const ci = hasRail('i');
    const cq = hasRail('q');
    if (!ci || !cq) continue;
    const { f, t } = railsOf(ci);
    // Only collapse when the plain form draws exactly these two wires.
    const bothIQ = iq(f!) && iq(t!);
    const auxPlain = iq(f!) !== iq(t!) && !refRail(doc, iq(f!) ? t! : f!);
    if (!bothIQ && !auxPlain) continue;
    if (!bothIQ) {
      const plainEnd = iq(f!) ? t! : f!;
      const d = byId.get(plainEnd.block) ? symbolFor(byId.get(plainEnd.block)!).def.ports.find((p) => p.name === plainEnd.port)?.domain : undefined;
      if (d !== 'lo' && d !== 'clk' && d !== 'ctrl') continue;
    }
    const [fs, ts] = k.split('|');
    drop.add(ci);
    drop.add(cq);
    const merged: Connection = { ...ci, from: fs, to: ts };
    add.push(merged);
  }
  conns = conns.filter((c) => !drop.has(c));
  // Keep merged connections in the position of their first member.
  conns.push(...add);
  // 3. Exact duplicates.
  const seen = new Set<string>();
  doc.connections = conns.filter((c) => {
    const k = key(c, false);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
