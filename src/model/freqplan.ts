// Frequency plan: carry frequencies from sources (the input signal, LOs, clocks) through the
// diagram, through mixers (sum/difference), multipliers/dividers, ADC aliasing and
// DDC/DUC shifts, and check filters' passbands and mixer images.

import { expand, type Expanded, type Instance, type Wire } from './expand';
import { eng } from './params';
import type { Analysis, LineupDoc } from './types';

export interface FreqIssue {
  level: 'warning' | 'info';
  msg: string;
  block: string;
}

export interface FreqPlan {
  /** Frequency on each driven port, by port key ("mix.if"), Hz (signed for complex streams). */
  byPort: Map<string, number>;
  issues: FreqIssue[];
}

const AUX_IN = new Set(['lo', 'clk', 'ctrl']);
/** Wires into LO, clock and control inputs; a multiplier's LO-domain `in` is still its signal input. */
const isAuxIn = (w: Wire) => w.to.domain === 'clk' || w.to.domain === 'ctrl' || (w.to.domain === 'lo' && w.to.name === 'lo');

export function fmtHz(f: number): string {
  const e = eng(Math.abs(f));
  return `${f < 0 ? '−' : ''}${e.num} ${e.prefix}Hz`;
}

const num = (inst: Instance, k: string) => (typeof inst.params[k] === 'number' ? (inst.params[k] as number) : undefined);
/** Mixer mode: "diff" (|RF − LO|, the default) or "sum" (RF + LO), from a `mix` param. */
const mode = (inst: Instance, dflt: 'diff' | 'sum') => (inst.params.mix === 'sum' || inst.params.mix === 'diff' ? (inst.params.mix as 'sum' | 'diff') : dflt);

/** Fold f into the first Nyquist zone of sample rate fs; returns the alias and the zone (1-based). */
export function alias(f: number, fs: number): { f: number; zone: number } {
  const a = Math.abs(f) % fs;
  const zone = Math.floor(Math.abs(f) / (fs / 2)) + 1;
  return { f: a > fs / 2 ? fs - a : a, zone };
}

export function frequencyPlan(doc: LineupDoc, ex: Expanded = expand(doc), analysis: Analysis = doc.analysis ?? {}): FreqPlan {
  const byPort = new Map<string, number>();
  const issues: FreqIssue[] = [];
  const into = new Map<string, Wire[]>(); // inst → wires arriving
  const outOf = new Map<string, Wire[]>(); // inst → wires leaving
  for (const w of ex.wires) {
    into.set(w.to.inst, [...(into.get(w.to.inst) ?? []), w]);
    outOf.set(w.from.inst, [...(outOf.get(w.from.inst) ?? []), w]);
  }
  const inFreq = (inst: Instance, port?: string): number | undefined => {
    for (const w of into.get(inst.id) ?? []) {
      if (port && w.to.name !== port) continue;
      const f = byPort.get(w.from.key);
      if (f !== undefined) return f;
    }
    return undefined;
  };
  /** First known frequency arriving on a signal (non-LO/clock/control) port. */
  const sigIn = (inst: Instance) => {
    for (const w of into.get(inst.id) ?? []) {
      if (isAuxIn(w)) continue;
      const f = byPort.get(w.from.key);
      if (f !== undefined) return f;
    }
    return undefined;
  };
  const hasSignalInput = (inst: Instance) => (into.get(inst.id) ?? []).some((w) => !isAuxIn(w));

  // What a block puts on its outputs, given what has reached its inputs so far.
  const outputFreq = (inst: Instance): number | undefined => {
    const t = inst.block.type;
    const own = num(inst, 'freq');
    if (!hasSignalInput(inst) || t === 'lo' || t === 'xo') {
      if (own !== undefined) return own;
      if (t === 'antenna' || t === 'port_in') return analysis.fin;
      return undefined;
    }
    switch (t) {
      case 'mixer':
      case 'iq_demod': {
        const rf = inFreq(inst, 'rf');
        const lo = inFreq(inst, 'lo');
        if (rf === undefined || lo === undefined) return undefined;
        return mode(inst, 'diff') === 'sum' ? rf + lo : Math.abs(rf - lo);
      }
      case 'iq_mod': {
        const bb = inFreq(inst, 'i') ?? inFreq(inst, 'q');
        const lo = inFreq(inst, 'lo');
        if (lo === undefined) return undefined;
        return mode(inst, 'sum') === 'sum' ? lo + (bb ?? 0) : Math.abs(lo - (bb ?? 0));
      }
      case 'mult':
      case 'div': {
        const f = sigIn(inst);
        const r = num(inst, 'ratio');
        if (f === undefined) return undefined;
        if (!r) return f;
        return t === 'mult' ? f * r : f / r;
      }
      case 'adc': {
        const f = sigIn(inst);
        const fs = num(inst, 'fs');
        if (f === undefined || !fs) return f;
        return alias(f, fs).f;
      }
      case 'ddc':
      case 'duc': {
        const f = sigIn(inst);
        if (f === undefined) return undefined;
        const nco = own ?? 0;
        return t === 'ddc' ? f - nco : f + nco;
      }
      case 'cmul': {
        const a = inFreq(inst, 'a');
        const b = inFreq(inst, 'b');
        return a !== undefined && b !== undefined ? a + b : undefined;
      }
      default:
        return sigIn(inst);
    }
  };

  // Propagate until nothing changes (each pass moves at least one stage further).
  for (let pass = 0; pass < ex.instances.length + 2; pass++) {
    let changed = false;
    for (const inst of ex.instances) {
      const f = outputFreq(inst);
      if (f === undefined) continue;
      const keys = new Set((outOf.get(inst.id) ?? []).map((w) => w.from.key));
      // Unwired outputs too, so the end of a chain still reports what it carries.
      for (const p of inst.ports) if (p.dir === 'out' && !AUX_IN.has(p.domain)) keys.add(p.key);
      for (const k of keys) {
        if (byPort.get(k) !== f) {
          byPort.set(k, f);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // ---- Checks ---------------------------------------------------------------
  for (const inst of ex.instances) {
    if (inst.rail === 'q') continue;
    const t = inst.block.type;
    const f = sigIn(inst);
    const fc = num(inst, 'fc');
    const bw = num(inst, 'bw');
    const id = inst.block.id;
    if (f !== undefined && fc !== undefined) {
      const af = Math.abs(f);
      if (t === 'bpf' && bw && Math.abs(af - fc) > bw / 2) issues.push({ level: 'warning', block: id, msg: `${fmtHz(f)} reaching ${id} is outside its passband (${fmtHz(fc)} ± ${fmtHz(bw / 2)})` });
      if ((t === 'lpf' || t === 'aaf') && af > fc) issues.push({ level: 'warning', block: id, msg: `${fmtHz(f)} reaching ${id} is above its ${fmtHz(fc)} cutoff` });
      if (t === 'hpf' && af < fc) issues.push({ level: 'warning', block: id, msg: `${fmtHz(f)} reaching ${id} is below its ${fmtHz(fc)} cutoff` });
      if (t === 'bsf' && bw && Math.abs(af - fc) < bw / 2) issues.push({ level: 'warning', block: id, msg: `${fmtHz(f)} reaching ${id} is in its stop band` });
    }
    if (t === 'adc' && f !== undefined) {
      const fs = num(inst, 'fs');
      if (fs) {
        const a = alias(f, fs);
        if (a.zone > 1) issues.push({ level: 'info', block: id, msg: `${id} samples ${fmtHz(f)} in Nyquist zone ${a.zone}; it appears at ${fmtHz(a.f)}` });
      }
    }
    if (t === 'mixer' && mode(inst, 'diff') === 'diff') {
      const rf = inFreq(inst, 'rf');
      const lo = inFreq(inst, 'lo');
      if (rf === undefined || lo === undefined) continue;
      const ifF = Math.abs(rf - lo);
      if (ifF < 0.01 * rf) continue; // direct conversion: the image is the signal itself
      const image = 2 * lo - rf;
      // Filters upstream of the RF port, walking back through single-input stages.
      const filters: Instance[] = [];
      let cur: Instance | undefined = inst;
      let port: string | undefined = 'rf';
      for (let hops = 0; cur && hops < 50; hops++) {
        const w: Wire | undefined = (into.get(cur.id) ?? []).find((x) => (port ? x.to.name === port : !isAuxIn(x)));
        if (!w) break;
        cur = ex.byId.get(w.from.inst);
        port = undefined;
        if (cur && num(cur, 'fc') !== undefined && ['bpf', 'lpf', 'hpf', 'bsf', 'filter'].includes(cur.block.type)) filters.push(cur);
      }
      const passes = (flt: Instance) => {
        const c = num(flt, 'fc')!;
        const b = num(flt, 'bw');
        switch (flt.block.type) {
          case 'bpf':
            return b ? Math.abs(image - c) <= b / 2 : true;
          case 'lpf':
            return image <= c;
          case 'hpf':
            return image >= c;
          case 'bsf':
            return b ? Math.abs(image - c) >= b / 2 : true;
          default:
            return true;
        }
      };
      if (image > 0 && filters.every(passes)) {
        const via = filters.length ? `passes ${filters.map((x) => x.block.id).join(', ')}` : 'has no filter in front of it';
        issues.push({ level: 'warning', block: id, msg: `${id}: image at ${fmtHz(image)} ${via} (IF ${fmtHz(ifF)})` });
      }
    }
  }
  return { byPort, issues };
}
