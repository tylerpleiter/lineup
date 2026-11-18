// Crossing hops: where a horizontal wire crosses a vertical wire of another net, the
// horizontal wire jumps over it with a small arc. Returns SVG path data per drawn line.

import type { Pt } from '../model/geometry';
import type { Routed } from './route';
import { G } from '../model/types';

const R = 4; // hop radius, px

interface VSeg {
  x: number;
  y0: number;
  y1: number;
  net: string;
}

const f = (v: number) => Math.round(v * 100) / 100;

export function linePaths(routes: Routed[], hops: boolean): string[][] {
  const verticals: VSeg[] = [];
  if (hops) {
    for (const r of routes)
      for (const line of r.lines)
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (a[0] === b[0] && a[1] !== b[1]) verticals.push({ x: a[0] * G, y0: Math.min(a[1], b[1]) * G, y1: Math.max(a[1], b[1]) * G, net: r.wire.net });
        }
  }
  return routes.map((r) =>
    r.lines.map((line) => {
      const pts: Pt[] = line.map((p) => [p[0] * G, p[1] * G]);
      let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (hops && a[1] === b[1] && a[0] !== b[0]) {
          const dir = Math.sign(b[0] - a[0]);
          const lo = Math.min(a[0], b[0]);
          const hi = Math.max(a[0], b[0]);
          const xs = verticals
            .filter((v) => v.net !== r.wire.net && v.x > lo + R + 1 && v.x < hi - R - 1 && v.y0 < a[1] - 0.5 && v.y1 > a[1] + 0.5)
            .map((v) => v.x)
            .sort((p, q) => (p - q) * dir);
          let last = -Infinity;
          for (const x of xs) {
            if (Math.abs(x - last) < 2 * R + 2) continue;
            last = x;
            // Left-to-right sweeps clockwise (arc above); right-to-left counter-clockwise.
            d += ` L${f(x - R * dir)},${f(a[1])} A${R},${R} 0 0 ${dir > 0 ? 1 : 0} ${f(x + R * dir)},${f(a[1])}`;
          }
        }
        d += ` L${f(b[0])},${f(b[1])}`;
      }
      return d;
    }),
  );
}
