import type { Rot, Side } from './types';

export type Pt = [number, number];
/** Affine matrix [a, b, c, d, e, f] mapping (x, y) to (a x + c y + e, b x + d y + f), as in SVG. */
export type Mat = [number, number, number, number, number, number];

export function mul(m: Mat, n: Mat): Mat {
  // m after n
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function applyVec(m: Mat, v: Pt): Pt {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

/**
 * Local transform of a symbol cell of size [w, h]: flip (horizontal, then vertical) first,
 * then rotate clockwise, then shift so the rotated cell's top-left corner is at (0, 0).
 */
export function cellMatrix(size: [number, number], rot: Rot = 0, flip = false, flipV = false): Mat {
  const [w, h] = size;
  const FH: Mat = flip ? [-1, 0, 0, 1, w, 0] : [1, 0, 0, 1, 0, 0];
  const FV: Mat = flipV ? [1, 0, 0, -1, 0, h] : [1, 0, 0, 1, 0, 0];
  const F = mul(FV, FH);
  let R: Mat;
  switch (rot) {
    case 90:
      R = [0, 1, -1, 0, h, 0];
      break;
    case 180:
      R = [-1, 0, 0, -1, w, h];
      break;
    case 270:
      R = [0, -1, 1, 0, 0, w];
      break;
    default:
      R = [1, 0, 0, 1, 0, 0];
  }
  return mul(R, F);
}

export function rotatedSize(size: [number, number], rot: Rot = 0): [number, number] {
  return rot === 90 || rot === 270 ? [size[1], size[0]] : [size[0], size[1]];
}

export function sideLocal(side: Side, at: number, size: [number, number]): { p: Pt; n: Pt } {
  const [w, h] = size;
  switch (side) {
    case 'l':
      return { p: [0, at], n: [-1, 0] };
    case 'r':
      return { p: [w, at], n: [1, 0] };
    case 't':
      return { p: [at, 0], n: [0, -1] };
    default:
      return { p: [at, h], n: [0, 1] };
  }
}

export function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function svgMatrix(m: Mat): string {
  return `matrix(${m.map(round).join(',')})`;
}
