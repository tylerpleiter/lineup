// Auto-layout with ELK (layered, left → right, fixed port positions).
// I/Q pairs are laid out as one node twice the rail pitch tall so both rails stay straight.
// LO / clock / control sources are kept out of the main flow and placed next to the port they feed.

import { expand, type Expanded, type Instance, type PortInst } from '../model/expand';
import { labelBox } from '../render/route';
import { G, type Block, type LineupDoc } from '../model/types';

// ELK is large, so it loads on first use and stays out of the main bundle.
let elkPromise: Promise<{ layout(g: unknown): Promise<{ children?: { id: string; x?: number; y?: number }[] }> }> | null = null;
function getElk() {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default());
  return elkPromise;
}
const AUX = new Set(['lo', 'clk', 'ctrl']);

function elkSide(p: PortInst): string {
  if (p.n[0] < -0.5) return 'WEST';
  if (p.n[0] > 0.5) return 'EAST';
  if (p.n[1] < -0.5) return 'NORTH';
  return 'SOUTH';
}

/** Blocks that only drive LO/clock/control ports and have no signal inputs. */
function auxSources(ex: Expanded): Set<string> {
  const out = new Set<string>();
  for (const [id, list] of ex.byBlock) {
    const outs = ex.wires.filter((w) => w.from.block === id);
    const ins = ex.wires.filter((w) => w.to.block === id && !AUX.has(w.to.domain));
    if (outs.length && !ins.length && outs.every((w) => AUX.has(w.to.domain)) && list.length === 1) out.add(id);
  }
  return out;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;
}

/**
 * Place blocks. With `all`, every block is placed; otherwise only blocks without x/y,
 * shifted so already-placed blocks keep their positions.
 */
export async function layoutDoc(doc: LineupDoc, all = false): Promise<void> {
  const targets = doc.blocks.filter((b) => all || b.x === undefined || b.y === undefined);
  if (!targets.length) return;
  const placed = doc.blocks.filter((b) => !targets.includes(b));
  const saved = new Map(doc.blocks.map((b) => [b.id, { x: b.x, y: b.y }]));
  // Expand with everything at the origin to get local port positions.
  for (const b of doc.blocks) {
    b.x = 0;
    b.y = 0;
  }
  const ex = expand(doc);
  const aux = auxSources(ex);

  const children: object[] = [];
  const nodeSize = new Map<string, { w: number; h: number }>();
  for (const [id, list] of ex.byBlock) {
    if (aux.has(id)) continue;
    const w = Math.max(...list.map((i) => i.w));
    const bottom = Math.max(...list.map((i) => i.y + i.h));
    const lb = labelBox(list[list.length - 1]);
    const h = lb ? Math.max(bottom, lb[3]) : bottom;
    nodeSize.set(id, { w, h });
    const ports = list.flatMap((inst) =>
      inst.ports.map((p) => ({
        id: p.key,
        x: p.p[0] * G,
        y: p.p[1] * G,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': elkSide(p) },
      })),
    );
    children.push({ id, width: w * G, height: h * G, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } });
  }
  const edges = ex.wires
    .filter((w) => !aux.has(w.from.block) && !aux.has(w.to.block) && w.from.block !== w.to.block)
    .map((w, i) => ({ id: `e${i}`, sources: [w.from.key], targets: [w.to.key] }));

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(4 * G),
      'elk.spacing.nodeNode': String(4 * G),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(2 * G),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
    },
    children,
    edges,
  };

  let res: { children?: { id: string; x?: number; y?: number }[] };
  try {
    res = await (await getElk()).layout(graph);
  } catch (e) {
    console.warn('ELK layout failed, falling back to a row', e);
    res = { children: [] };
    let x = 0;
    for (const c of children as { id: string; width: number }[]) {
      res.children!.push({ id: c.id, x, y: 0 });
      x += c.width + 4 * G;
    }
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of res.children ?? []) pos.set(c.id, { x: Math.round((c.x ?? 0) / G), y: Math.round((c.y ?? 0) / G) });

  // Aux sources sit below/above (or left of) the port they feed.
  const boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  for (const [id, p] of pos) boxes.push({ id, ...p, ...nodeSize.get(id)! });
  for (const id of aux) {
    const inst: Instance = ex.byBlock.get(id)![0];
    const w = ex.wires.find((x) => x.from.block === id)!;
    const tp = pos.get(w.to.block);
    if (!tp) {
      pos.set(id, { x: 0, y: 0 });
      continue;
    }
    const T = [tp.x + w.to.p[0], tp.y + w.to.p[1]];
    const out = w.from.p; // local, instance at origin
    let x: number;
    let y: number;
    if (w.to.n[1] > 0.5) {
      x = T[0] - 3 - out[0];
      y = T[1] + 3;
    } else if (w.to.n[1] < -0.5) {
      x = T[0] - 3 - out[0];
      y = T[1] - 3 - inst.h;
    } else {
      x = T[0] - 4 - inst.w;
      y = T[1] - out[1];
    }
    const box = { id, x, y, w: inst.w, h: inst.h + 3 };
    const down = w.to.n[1] >= 0 ? 1 : -1;
    for (let k = 0; k < 12 && boxes.some((b) => overlaps(box, b)); k++) box.y += 2 * down;
    boxes.push(box);
    pos.set(id, { x: box.x, y: box.y });
  }

  // Keep placed blocks where they are: shift the new layout by their mean offset.
  let dx = 0;
  let dy = 0;
  if (!all && placed.length) {
    const offs = placed.map((b) => [saved.get(b.id)!.x! - (pos.get(b.id)?.x ?? 0), saved.get(b.id)!.y! - (pos.get(b.id)?.y ?? 0)]);
    dx = Math.round(offs.reduce((s, o) => s + o[0], 0) / offs.length);
    dy = Math.round(offs.reduce((s, o) => s + o[1], 0) / offs.length);
  } else {
    // Start at a tidy origin.
    const minX = Math.min(...[...pos.values()].map((p) => p.x));
    const minY = Math.min(...[...pos.values()].map((p) => p.y));
    dx = 4 - minX;
    dy = 4 - minY;
  }
  for (const b of doc.blocks as Block[]) {
    if (targets.includes(b)) {
      const p = pos.get(b.id) ?? { x: 0, y: 0 };
      b.x = p.x + dx;
      b.y = p.y + dy;
    } else {
      b.x = saved.get(b.id)!.x;
      b.y = saved.get(b.id)!.y;
    }
  }
}
