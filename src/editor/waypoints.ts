// Moving a wire segment: shift one segment of the routed path perpendicular to itself,
// keeping a one-unit stub out of each port, and return the new waypoints (`via`).

import type { Pt } from '../model/geometry';
import { simplify } from '../render/route';

/** Index of the path segment nearest to p (grid units). */
export function nearestSegment(path: Pt[], p: Pt): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const x = Math.max(Math.min(a[0], b[0]), Math.min(Math.max(a[0], b[0]), p[0]));
    const y = Math.max(Math.min(a[1], b[1]), Math.min(Math.max(a[1], b[1]), p[1]));
    const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = i - 1;
    }
  }
  return best;
}

export function moveSegment(path: Pt[], seg: number, delta: number, fromN: Pt, toN: Pt): [number, number][] {
  let pts = path.map((p) => [...p] as Pt);
  let i = seg;
  // Keep a stub on the port ends so the wire still leaves each port straight.
  if (i === 0) {
    const stub: Pt = [pts[0][0] + fromN[0], pts[0][1] + fromN[1]];
    pts = [pts[0], stub, ...pts.slice(1)];
    i = 1;
    pts[1] = [...stub];
    pts.splice(1, 0, [...stub]);
    i = 2;
  }
  if (i + 1 === pts.length - 1) {
    const last = pts[pts.length - 1];
    const stub: Pt = [last[0] + toN[0], last[1] + toN[1]];
    pts.splice(pts.length - 1, 0, [...stub], [...stub]);
  }
  const a = pts[i];
  const b = pts[i + 1];
  const horiz = a[1] === b[1];
  if (horiz) {
    a[1] += delta;
    b[1] += delta;
  } else {
    a[0] += delta;
    b[0] += delta;
  }
  const clean = simplify(pts);
  return clean.slice(1, -1).map((p) => [Math.round(p[0]), Math.round(p[1])] as [number, number]);
}
