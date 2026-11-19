// Cascade analysis along one signal path: gain, noise figure (Friis), IP3, P1dB and running
// levels, stage by stage. Works on a flattened diagram (see sheets.ts), so a path can run
// through sheet blocks.

import { expand, type Expanded, type Instance, type Wire } from './expand';
import type { Analysis, LineupDoc } from './types';

export interface StageIn {
  gain: number;
  nf: number;
  /** Input-referred IP3, dBm (from iip3, or oip3 − gain). */
  iip3?: number;
  /** Output P1dB, dBm. */
  op1?: number;
  /** Params that weren't given and were assumed. */
  assumed: string[];
}

export interface Stage extends StageIn {
  /** Instance id in the flattened diagram ("fe/lna", "lpf:i"). */
  inst: string;
  block: string;
  label: string;
  type: string;
  /** Wire into this stage (absent for the first). */
  wire?: Wire;
  cum: { gain: number; nf: number; iip3?: number; oip3?: number; op1?: number; ip1?: number; pout?: number; backoff?: number };
}

export interface Cascade {
  stages: Stage[];
  /** Instance ids along the path, in order. */
  path: string[];
  totals?: Stage['cum'] & { noiseFloor?: number; mds?: number; snr?: number; outNoise?: number };
  error?: string;
  warnings: string[];
}

const db = (lin: number) => 10 * Math.log10(lin);
const lin = (d: number) => Math.pow(10, d / 10);
const AUX = new Set(['lo', 'clk', 'ctrl']);
const QUIET = new Set(['antenna', 'port_in', 'port_out', 'node', 'adc', 'dac']);
/** Thermal noise at 290 K, dBm/Hz. */
export const KT = -174;

/** Read a stage's RF numbers from its params, filling gaps the way RF engineers do by hand. */
export function stageValues(inst: Instance): StageIn {
  const p = inst.params;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : undefined);
  const assumed: string[] = [];
  let gain = num('gain');
  const il = num('il');
  if (gain === undefined && il !== undefined) gain = -il;
  if (gain === undefined) {
    gain = 0;
    assumed.push('gain');
  }
  let nf = num('nf');
  // A passive stage's noise figure equals its loss.
  if (nf === undefined && gain < 0 && (il !== undefined || num('gain') !== undefined)) nf = -gain;
  if (nf === undefined) {
    nf = 0;
    assumed.push('nf');
  }
  const iip3 = num('iip3') ?? (num('oip3') !== undefined ? num('oip3')! - gain : undefined);
  const op1 = num('p1db');
  return { gain, nf, iip3, op1, assumed };
}

/** Signal graph over instances: analog signal wires, I rail only for I/Q pairs. */
function graph(ex: Expanded) {
  const out = new Map<string, { to: string; wire: Wire }[]>();
  const indeg = new Map<string, number>();
  for (const w of ex.wires) {
    if (AUX.has(w.domain) || w.domain === 'digital' || w.domain === 'complex') continue;
    if (w.from.rail === 'q' || w.to.rail === 'q') continue;
    if (w.from.inst === w.to.inst) continue;
    out.set(w.from.inst, [...(out.get(w.from.inst) ?? []), { to: w.to.inst, wire: w }]);
    indeg.set(w.to.inst, (indeg.get(w.to.inst) ?? 0) + 1);
  }
  return { out, indeg };
}

function bfs(out: Map<string, { to: string; wire: Wire }[]>, from: string, to: string): { to: string; wire: Wire }[] | null {
  const prev = new Map<string, { from: string; wire: Wire }>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const n = q.shift()!;
    if (n === to) break;
    for (const e of out.get(n) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { from: n, wire: e.wire });
      q.push(e.to);
    }
  }
  if (from !== to && !prev.has(to)) return null;
  const steps: { to: string; wire: Wire }[] = [];
  for (let n = to; n !== from; n = prev.get(n)!.from) steps.unshift({ to: n, wire: prev.get(n)!.wire });
  return steps;
}

/**
 * Pick the path: through the selected blocks in signal order (one selected block: from the
 * input to it; none: from the main input to the furthest stage).
 */
export function findPath(ex: Expanded, selected: string[]): { steps: { to: string; wire?: Wire }[]; error?: string } {
  const { out, indeg } = graph(ex);
  const nodes = new Set([...out.keys(), ...[...out.values()].flat().map((e) => e.to)]);
  if (!nodes.size) return { steps: [], error: 'No analog signal path to analyse' };
  const sources = [...nodes].filter((n) => !indeg.get(n));
  const pref = (n: string) => {
    const t = ex.byId.get(n)?.block.type;
    return t === 'antenna' || t === 'port_in' ? 0 : 1;
  };
  // Instances of selected blocks (I rail for pairs) that are on the signal graph.
  const sel = selected.map((b) => (ex.byBlock.get(b)?.[0]?.id ?? b)).filter((n) => nodes.has(n));
  // Rank by longest distance from any source (handles DAGs; cycles are cut).
  const rank = new Map<string, number>();
  const visit = (n: string, d: number, stack: Set<string>) => {
    if (stack.has(n) || (rank.get(n) ?? -1) >= d) return;
    rank.set(n, d);
    stack.add(n);
    for (const e of out.get(n) ?? []) visit(e.to, d + 1, stack);
    stack.delete(n);
  };
  for (const s of sources.length ? sources : [...nodes].slice(0, 1)) visit(s, 0, new Set());
  sel.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  let waypoints: string[];
  if (sel.length >= 2) waypoints = sel;
  else {
    const reaching = (target: string) => sources.filter((s) => bfs(out, s, target)).sort((a, b) => pref(a) - pref(b));
    if (sel.length === 1) {
      const src = reaching(sel[0])[0] ?? sel[0];
      waypoints = src === sel[0] ? [sel[0]] : [src, sel[0]];
    } else {
      const src = [...sources].sort((a, b) => pref(a) - pref(b) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0))[0] ?? [...nodes][0];
      // Furthest stage reachable from the source.
      let best = src;
      let bestLen = 0;
      for (const n of nodes) {
        const p = bfs(out, src, n);
        if (p && p.length > bestLen) {
          best = n;
          bestLen = p.length;
        }
      }
      waypoints = [src, best];
    }
  }
  const steps: { to: string; wire?: Wire }[] = [{ to: waypoints[0] }];
  for (let i = 1; i < waypoints.length; i++) {
    const seg = bfs(out, waypoints[i - 1], waypoints[i]);
    if (!seg) {
      const name = (n: string) => ex.byId.get(n)?.block.id ?? n;
      return { steps: [], error: `No signal path from ${name(waypoints[i - 1])} to ${name(waypoints[i])}` };
    }
    steps.push(...seg);
  }
  return { steps };
}

/** Cascade along a path of instances. */
export function cascadeAlong(ex: Expanded, steps: { to: string; wire?: Wire }[], analysis: Analysis = {}): Cascade {
  const stages: Stage[] = [];
  const warnings: string[] = [];
  let G = 1; // linear cumulative gain
  let F = 1; // linear cumulative noise factor
  let invIIP3 = 0; // 1 / input-referred IP3, 1/mW
  let invOP1 = 0; // 1 / output P1dB, 1/mW
  for (const step of steps) {
    const inst = ex.byId.get(step.to)!;
    const v = stageValues(inst);
    const g = lin(v.gain);
    F = F + (lin(v.nf) - 1) / G;
    if (v.iip3 !== undefined) invIIP3 += G / lin(v.iip3);
    invOP1 = invOP1 / g + (v.op1 !== undefined ? 1 / lin(v.op1) : 0);
    G *= g;
    const cum: Stage['cum'] = { gain: db(G), nf: db(F) };
    if (invIIP3 > 0) {
      cum.iip3 = db(1 / invIIP3);
      cum.oip3 = cum.iip3 + cum.gain;
    }
    if (invOP1 > 0) {
      cum.op1 = db(1 / invOP1);
      cum.ip1 = cum.op1 - cum.gain + 1;
    }
    if (analysis.pin !== undefined) {
      cum.pout = analysis.pin + cum.gain;
      if (cum.op1 !== undefined) {
        cum.backoff = cum.op1 - cum.pout;
        if (cum.backoff < 0) warnings.push(`${inst.block.id} is ${(-cum.backoff).toFixed(1)} dB past its cascaded P1dB at ${analysis.pin} dBm in`);
      }
    }
    const b = inst.block;
    stages.push({ ...v, inst: inst.id, block: b.id, label: b.label ?? inst.def.label ?? b.id, type: b.type, wire: step.wire, cum });
  }
  const last = stages.at(-1)?.cum;
  let totals: Cascade['totals'] = last ? { ...last } : undefined;
  if (totals && analysis.bw) {
    const floor = KT + db(analysis.bw);
    totals = { ...totals, noiseFloor: floor, mds: floor + totals.nf, outNoise: floor + totals.nf + totals.gain };
    if (analysis.pin !== undefined) totals.snr = analysis.pin - floor - totals.nf;
  }
  // Sources, sinks and converters are expected to have no gain/NF of their own.
  const missing = stages.filter((s) => s.assumed.includes('gain') && s.assumed.includes('nf') && !QUIET.has(s.type)).map((s) => s.block);
  if (missing.length) warnings.push(`No gain/NF/IL on ${missing.join(', ')}: treated as lossless and noiseless`);
  return { stages, path: steps.map((s) => s.to), totals, warnings };
}

/** Analyse a (flattened) diagram along the path through the selected blocks. */
export function cascade(doc: LineupDoc, selected: string[] = [], ex: Expanded = expand(doc)): Cascade {
  const p = findPath(ex, selected);
  if (p.error) return { stages: [], path: [], warnings: [], error: p.error };
  return cascadeAlong(ex, p.steps, doc.analysis ?? {});
}
