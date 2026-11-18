// Orthogonal wire routing on the grid.
// A* over (grid point, heading) with costs for length, bends, running over other nets'
// wires and passing through label areas. Block cells (inflated by one unit) are walls.
// Differential pairs are routed as one centreline and offset ±0.5 units afterwards.

import type { Pt } from '../model/geometry';
import type { Expanded, Instance, Wire } from '../model/expand';
import { RAIL_PITCH } from '../model/types';

export interface Routed {
  wire: Wire;
  /** Centreline, grid units. */
  path: Pt[];
  /** Drawn polylines: one for single-ended, two (P, N) for differential. */
  lines: Pt[][];
}

export interface RouteResult {
  routes: Routed[];
  dots: Pt[];
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const BEND = 3;
const OVERLAP = 40;
const CROSS = 2;
const NEAR = 6;
const LABEL = 5;
const MARGIN = 10;

function dirOf(n: Pt): number {
  if (n[0] > 0.5) return 0;
  if (n[1] > 0.5) return 1;
  if (n[0] < -0.5) return 2;
  return 3;
}

class Heap {
  private a: number[] = [];
  private p: number[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number, pri: number) {
    const a = this.a;
    const p = this.p;
    a.push(v);
    p.push(pri);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      [a[i], a[j]] = [a[j], a[i]];
      [p[i], p[j]] = [p[j], p[i]];
      i = j;
    }
  }
  pop(): number {
    const a = this.a;
    const p = this.p;
    const top = a[0];
    const lastA = a.pop()!;
    const lastP = p.pop()!;
    if (a.length) {
      a[0] = lastA;
      p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Approximate area of the text under a cell, used as a soft obstacle. */
export function labelBox(inst: Instance): [number, number, number, number] | null {
  if (!inst.labelLines.length) return null;
  const chars = Math.max(...inst.labelLines.map((s) => s.length));
  const half = Math.max(inst.w / 2, chars * 0.32);
  const cx = inst.x + inst.w / 2;
  return [cx - half, inst.y + inst.h, cx + half, inst.y + inst.h + 0.6 + inst.labelLines.length * 1.3];
}

export function simplify(path: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of path) {
    const n = out.length;
    if (n && out[n - 1][0] === p[0] && out[n - 1][1] === p[1]) continue;
    if (n >= 2) {
      const a = out[n - 2];
      const b = out[n - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) {
        out[n - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** Offset an orthogonal polyline by `d` to the left of its direction of travel (screen coords). */
export function offsetPath(path: Pt[], d: number): Pt[] {
  if (path.length < 2) return path.map((p) => [...p] as Pt);
  const left = (a: Pt, b: Pt): Pt => {
    const dx = Math.sign(b[0] - a[0]);
    const dy = Math.sign(b[1] - a[1]);
    return [dy, -dx];
  };
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i === 0) {
      const L = left(path[0], path[1]);
      out.push([p[0] + d * L[0], p[1] + d * L[1]]);
    } else if (i === path.length - 1) {
      const L = left(path[i - 1], path[i]);
      out.push([p[0] + d * L[0], p[1] + d * L[1]]);
    } else {
      const L1 = left(path[i - 1], path[i]);
      const L2 = left(path[i], path[i + 1]);
      const same = L1[0] === L2[0] && L1[1] === L2[1];
      out.push(same ? [p[0] + d * L1[0], p[1] + d * L1[1]] : [p[0] + d * (L1[0] + L2[0]), p[1] + d * (L1[1] + L2[1])]);
    }
  }
  return out;
}

/** Join points with right-angle elbows, continuing the previous direction where possible. */
export function orthogonalize(points: Pt[]): Pt[] {
  const out: Pt[] = [points[0]];
  let horiz = true;
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    if (a[0] !== b[0] && a[1] !== b[1]) {
      const elbow: Pt = horiz ? [b[0], a[1]] : [a[0], b[1]];
      out.push(elbow);
      horiz = !horiz;
    } else if (a[0] !== b[0] || a[1] !== b[1]) horiz = a[1] === b[1];
    out.push(b);
  }
  return out;
}

/** Waypoints for a wire: a connection's `via`, shifted down a rail pitch for the Q wire of a pair→pair link. */
export function wireVia(w: Wire): Pt[] | undefined {
  if (!w.via?.length) return undefined;
  const shift = w.rail === 'q' && w.from.rail === 'q' && w.to.rail === 'q' ? RAIL_PITCH : 0;
  return w.via.map((v) => [v[0], v[1] + shift] as Pt);
}

export function route(ex: Expanded): RouteResult {
  const { instances, wires } = ex;
  // Bounds.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const i of instances) {
    grow(i.x, i.y);
    grow(i.x + i.w, i.y + i.h + 4);
  }
  for (const w of wires) for (const v of wireVia(w) ?? []) grow(v[0], v[1]);
  if (!isFinite(minX)) return { routes: [], dots: [] };
  minX = Math.floor(minX) - MARGIN;
  minY = Math.floor(minY) - MARGIN;
  maxX = Math.ceil(maxX) + MARGIN;
  maxY = Math.ceil(maxY) + MARGIN;
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  const N = W * H;
  const at = (x: number, y: number) => (y - minY) * W + (x - minX);

  const blocked = new Uint8Array(N);
  const soft = new Uint8Array(N);
  for (const inst of instances) {
    for (let y = Math.ceil(inst.y - 1); y <= Math.floor(inst.y + inst.h + 1); y++) {
      for (let x = Math.ceil(inst.x - 1); x <= Math.floor(inst.x + inst.w + 1); x++) {
        if (x > inst.x - 1 && x < inst.x + inst.w + 1 && y > inst.y - 1 && y < inst.y + inst.h + 1) blocked[at(x, y)] = 1;
      }
    }
    const lb = labelBox(inst);
    if (lb) {
      for (let y = Math.ceil(lb[1]); y <= Math.floor(lb[3]); y++)
        for (let x = Math.ceil(lb[0]); x <= Math.floor(lb[2]); x++) if (x >= minX && x <= maxX && y >= minY && y <= maxY) soft[at(x, y)] = 1;
    }
  }

  // Occupancy by orientation: net index + 1 of the first wire through each point (0 = free).
  const hOcc = new Int32Array(N);
  const vOcc = new Int32Array(N);
  const near = new Int32Array(N);
  const netIds = new Map<string, number>();
  const netOf = (w: Wire) => {
    if (!netIds.has(w.net)) netIds.set(w.net, netIds.size + 1);
    return netIds.get(w.net)!;
  };

  const g = new Float64Array(N * 4);
  const came = new Int32Array(N * 4);
  const stamp = new Int32Array(N * 4);
  let gen = 0;

  /** A* between two grid points. startDir/endDir: forced first heading / required last heading, or -1. */
  function search(s: Pt, e: Pt, startDir: number, endDir: number, net: number): Pt[] | null {
    gen++;
    const sx = Math.round(s[0]);
    const sy = Math.round(s[1]);
    const ex = Math.round(e[0]);
    const ey = Math.round(e[1]);
    if (sx < minX || sx > maxX || sy < minY || sy > maxY || ex < minX || ex > maxX || ey < minY || ey > maxY) return null;
    const goal = at(ex, ey);
    const heap = new Heap();
    const h = (x: number, y: number) => Math.abs(x - ex) + Math.abs(y - ey);
    const startStates = startDir >= 0 ? [startDir] : [0, 1, 2, 3];
    for (const d of startStates) {
      const st = at(sx, sy) * 4 + d;
      g[st] = 0;
      came[st] = -1;
      stamp[st] = gen;
      heap.push(st, h(sx, sy));
    }
    let found = -1;
    let iter = 0;
    while (heap.size && iter++ < 400000) {
      const st = heap.pop();
      const idx = st >> 2;
      const d = st & 3;
      if (idx === goal) {
        found = st;
        break;
      }
      const x = (idx % W) + minX;
      const y = Math.floor(idx / W) + minY;
      const gs = g[st];
      const first = came[st] === -1;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3)) continue;
        if (first && startDir >= 0 && nd !== startDir) continue;
        const nx = x + DX[nd];
        const ny = y + DY[nd];
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const ni = at(nx, ny);
        if (ni === goal) {
          if (endDir >= 0 && nd !== endDir) continue;
        } else if (blocked[ni]) continue;
        let cost = 1;
        if (nd !== d && !first) cost += BEND;
        const horiz = nd === 0 || nd === 2;
        const par = horiz ? hOcc[ni] : vOcc[ni];
        const crs = horiz ? vOcc[ni] : hOcc[ni];
        if (par && par !== net) cost += OVERLAP;
        if (crs && crs !== net) cost += CROSS;
        if (near[ni] && near[ni] !== net) cost += NEAR;
        if (soft[ni]) cost += LABEL;
        const ns = ni * 4 + nd;
        const ng = gs + cost;
        if (stamp[ns] === gen && g[ns] <= ng) continue;
        stamp[ns] = gen;
        g[ns] = ng;
        came[ns] = st;
        heap.push(ns, ng + h(nx, ny));
      }
    }
    if (found < 0) return null;
    const pts: Pt[] = [];
    for (let st = found; st !== -1; st = came[st]) {
      const idx = st >> 2;
      pts.push([(idx % W) + minX, Math.floor(idx / W) + minY]);
    }
    return pts.reverse();
  }

  function occupy(path: Pt[], net: number, diff: boolean) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const horiz = a[1] === b[1];
      const steps = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + Math.sign(b[0] - a[0]) * k;
        const y = a[1] + Math.sign(b[1] - a[1]) * k;
        if (x < minX || x > maxX || y < minY || y > maxY || !Number.isInteger(x) || !Number.isInteger(y)) continue;
        const idx = at(x, y);
        if (horiz) hOcc[idx] ||= net;
        else vOcc[idx] ||= net;
        if (diff) {
          for (const [ox, oy] of horiz ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
            const xx = x + ox;
            const yy = y + oy;
            if (xx >= minX && xx <= maxX && yy >= minY && yy <= maxY) near[at(xx, yy)] ||= net;
          }
        }
      }
    }
  }

  const routes: Routed[] = [];
  // Short wires first: they have the fewest alternatives.
  const order = wires
    .map((w, i) => ({ w, i, len: Math.abs(w.from.p[0] - w.to.p[0]) + Math.abs(w.from.p[1] - w.to.p[1]) }))
    .sort((a, b) => a.len - b.len || a.i - b.i);
  const byIndex: Routed[] = new Array(wires.length);
  for (const { w, i } of order) {
    const net = netOf(w);
    const a = w.from.p;
    const b = w.to.p;
    const sd = dirOf(w.from.n);
    const ed = (dirOf(w.to.n) + 2) & 3;
    const via = wireVia(w);
    let path: Pt[] = [];
    let ok = true;
    if (via) {
      // Manual waypoints are followed exactly, with stubs out of each port.
      const s1: Pt = [a[0] + w.from.n[0], a[1] + w.from.n[1]];
      const e1: Pt = [b[0] + w.to.n[0], b[1] + w.to.n[1]];
      path = orthogonalize([a, s1, ...via, e1, b]);
    }
    const stops: Pt[] = via ? [] : [a, b];
    for (let k = 0; k < stops.length - 1; k++) {
      const seg = search(stops[k], stops[k + 1], k === 0 ? sd : -1, k === stops.length - 2 ? ed : -1, net);
      if (!seg) {
        ok = false;
        break;
      }
      path.push(...(k ? seg.slice(1) : seg));
    }
    if (!ok && !via) {
      // Fallback: stubs and an L.
      const s1: Pt = [a[0] + w.from.n[0], a[1] + w.from.n[1]];
      const e1: Pt = [b[0] + w.to.n[0], b[1] + w.to.n[1]];
      path = [a, s1, [e1[0], s1[1]], e1, b];
    }
    path = simplify(path);
    occupy(path, net, w.signal === 'diff');
    let lines: Pt[][];
    if (w.signal === 'diff') {
      // P is the upper (or left) pin at the source; pick the offset sign that lands it there.
      const n = w.from.n;
      const u: Pt = Math.abs(n[0]) > 0.5 ? [0, -0.5] : [-0.5, 0];
      const L: Pt = path.length > 1 ? [Math.sign(path[1][1] - path[0][1]), -Math.sign(path[1][0] - path[0][0])] : [0, -1];
      const s = u[0] * L[0] + u[1] * L[1] > 0 ? 1 : -1;
      lines = [offsetPath(path, s * 0.5), offsetPath(path, -s * 0.5)];
    } else lines = [path];
    byIndex[i] = { wire: w, path, lines };
  }
  routes.push(...byIndex);

  // Junction dots where a net's wires branch (3+ directions at a point).
  const dots: Pt[] = [];
  const nets = new Map<string, Routed[]>();
  for (const r of routes) if (r.wire.signal === 'se') nets.set(r.wire.net, [...(nets.get(r.wire.net) ?? []), r]);
  for (const [, list] of nets) {
    if (list.length < 2) continue;
    const dirs = new Map<string, Set<number>>();
    for (const r of list) {
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1];
        const b = r.path[i];
        const steps = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
        const sx = Math.sign(b[0] - a[0]);
        const sy = Math.sign(b[1] - a[1]);
        const d = dirOf([sx, sy]);
        for (let k = 0; k < steps; k++) {
          const p = `${a[0] + sx * k},${a[1] + sy * k}`;
          const q = `${a[0] + sx * (k + 1)},${a[1] + sy * (k + 1)}`;
          (dirs.get(p) ?? dirs.set(p, new Set()).get(p)!).add(d);
          (dirs.get(q) ?? dirs.set(q, new Set()).get(q)!).add((d + 2) & 3);
        }
      }
    }
    for (const [k, s] of dirs) if (s.size >= 3) dots.push(k.split(',').map(Number) as Pt);
  }
  return { routes, dots };
}
