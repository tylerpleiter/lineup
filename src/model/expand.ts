// Expansion: turn a document (logical blocks + connections) into what is drawn:
// instances (an I/Q block becomes two), resolved ports in world coordinates, wires, and issues.

import { apply, applyVec, cellMatrix, mul, rotatedSize, sideLocal, type Mat, type Pt } from './geometry';
import { formatParam } from './params';
import { symbolFor } from './symbols';
import { sheetPorts } from './sheets';
import {
  RAIL_PITCH,
  SIGNAL_PATH_DOMAINS,
  type Block,
  type Connection,
  type Dir,
  type Domain,
  type LineupDoc,
  type Params,
  type PortDef,
  type Rail,
  type Signal,
  type SymbolDef,
  railOf,
} from './types';

export interface PortInst {
  /** `instanceId.port`, unique per drawn port. */
  key: string;
  inst: string;
  block: string;
  rail?: Rail;
  name: string;
  def: PortDef;
  /** Port point, world grid units. */
  p: Pt;
  /** Outward unit normal. */
  n: Pt;
  dir: Dir;
  signal: Signal;
  domain: Domain;
  width?: number;
  lead: number;
}

export interface Instance {
  id: string;
  block: Block;
  rail?: Rail;
  def: SymbolDef;
  known: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** World transform from symbol-local grid units. */
  m: Mat;
  ports: PortInst[];
  params: Params;
  /** Lines drawn under the cell (label first), or inside for custom blocks. */
  labelLines: string[];
  /** The first label line is the block label (drawn larger) rather than a param. */
  titled?: boolean;
  innerLabel?: string;
}

export interface Wire {
  id: string;
  conn: number;
  rail?: Rail;
  from: PortInst;
  to: PortInst;
  signal: Signal;
  domain: Domain;
  width?: number;
  label?: string;
  /** "I" / "Q" marker drawn where a split block's rail starts. */
  railMark?: string;
  via?: [number, number][];
  /** Wires sharing a source port form one net (fan-out). */
  net: string;
  level?: 'error' | 'warning';
}

export interface Issue {
  level: 'error' | 'warning';
  msg: string;
  conn?: number;
  block?: string;
}

export interface Expanded {
  instances: Instance[];
  byId: Map<string, Instance>;
  /** Instances per logical block id. */
  byBlock: Map<string, Instance[]>;
  wires: Wire[];
  issues: Issue[];
}

export interface Ref {
  block: string;
  rail?: Rail;
  port: string;
}

export function parseRef(ref: string): Ref | null {
  const m = /^([^.:\s]+)(?::([iq]))?\.([^.\s]+)$/.exec(ref ?? '');
  if (!m) return null;
  return { block: m[1], rail: m[2] as Rail | undefined, port: m[3] };
}

export function formatRef(r: Ref): string {
  return `${r.block}${r.rail ? ':' + r.rail : ''}.${r.port}`;
}

/** Ports referenced by connections, for blocks whose type has no symbol. */
function inferPorts(doc: LineupDoc, blockId: string): PortDef[] {
  const seen = new Map<string, PortDef>();
  for (const c of doc.connections) {
    const f = parseRef(c.from);
    const t = parseRef(c.to);
    if (f?.block === blockId && !seen.has(f.port)) seen.set(f.port, { name: f.port, side: 'r', dir: 'out', signal: 'se' });
    if (t?.block === blockId && !seen.has(t.port)) seen.set(t.port, { name: t.port, side: 'l', dir: 'in', signal: 'se' });
  }
  return [...seen.values()];
}

function railParams(b: Block, rail?: Rail): Params {
  const base = { ...(b.params ?? {}) };
  if (rail && b.iqOverride?.[rail]?.params) Object.assign(base, b.iqOverride[rail]!.params);
  return base;
}

/**
 * A port's domain after the block-level setting: a DSP-capable block set to digital or
 * complex carries that on its signal (and LO) ports, unless the symbol fixes the port.
 */
export function portDomain(b: Block, def: SymbolDef, p: PortDef): Domain {
  const base = p.domain ?? 'signal';
  if (!def.dsp || !b.domain || p.fixedDomain) return base;
  if (base === 'signal' || base === 'digital' || base === 'complex') return b.domain;
  if (base === 'lo' && b.domain !== 'signal') return b.domain;
  return base;
}

export function portSignal(b: Block, p: PortDef, domain: Domain = p.domain ?? 'signal'): Signal {
  // A complex stream is one logical line; it has no differential form.
  if (domain === 'complex') return 'se';
  if (!p.fixed && b.signal && SIGNAL_PATH_DOMAINS.includes(domain)) return b.signal;
  return p.signal ?? 'se';
}

/** Custom and unknown blocks can pack an I/Q pair into one port, or unpack one port into a pair. */
export function isCustomBlock(def: SymbolDef): boolean {
  return !!def.labelInside;
}

function buildInstance(doc: LineupDoc, b: Block, rail?: Rail): Instance {
  const { def, known } = symbolFor(b, b.type === 'sheet' ? sheetPorts(doc, b) : SYMBOLS_UNKNOWN(b) ? inferPorts(doc, b.id) : undefined);
  const rot = b.rot ?? 0;
  const [w, h] = rotatedSize(def.size, rot);
  const x = b.x ?? 0;
  const y = (b.y ?? 0) + (rail === 'q' ? RAIL_PITCH : 0);
  const m = mul([1, 0, 0, 1, x, y], cellMatrix(def.size, rot, !!b.flip, !!b.flipV));
  const id = rail ? `${b.id}:${rail}` : b.id;
  const params = railParams(b, rail);
  const ports: PortInst[] = def.ports.map((pd) => {
    const loc = sideLocal(pd.side, pd.at ?? 0, def.size);
    let width = pd.width;
    if (pd.widthFrom && typeof params[pd.widthFrom] === 'number') width = params[pd.widthFrom] as number;
    const domain = portDomain(b, def, pd);
    const signal = portSignal(b, pd, domain);
    return {
      key: `${id}.${pd.name}`,
      inst: id,
      block: b.id,
      rail,
      name: pd.name,
      def: pd,
      p: apply(m, loc.p),
      n: applyVec(m, loc.n),
      dir: pd.dir,
      signal,
      domain,
      width,
      lead: signal === 'diff' ? (pd.diffLead ?? pd.lead ?? 1) : (pd.lead ?? 1),
    };
  });
  return { id, block: b, rail, def, known, x, y, w, h, m, ports, params, labelLines: [] };
}

function SYMBOLS_UNKNOWN(b: Block): boolean {
  return b.type !== 'sheet' && (!symbolFor(b).known || b.type === 'custom');
}

function labelText(b: Block, def: SymbolDef, rail?: Rail): string {
  const own = rail ? b.iqOverride?.[rail]?.label : undefined;
  if (own !== undefined) return own;
  return b.label ?? def.label ?? '';
}

function shownLines(b: Block, inst: Instance, other?: Instance): string[] {
  const out: string[] = [];
  for (const key of b.show ?? []) {
    const v = inst.params[key];
    if (v === undefined || v === null || v === '') continue;
    const line = formatParam(key, v);
    const ov = other?.params[key];
    if (other && ov !== undefined && ov !== v) {
      // Rails differ: show both values, I first.
      const iLine = formatParam(key, other.rail === 'i' ? ov : v);
      const qLine = formatParam(key, other.rail === 'i' ? v : ov);
      out.push(`${iLine} (I) / ${qLine.split(' = ').pop()} (Q)`);
    } else out.push(line);
  }
  return out;
}

function pickDomain(c: Connection, a: PortInst, b: PortInst): Domain {
  if (c.domain) return c.domain;
  const ds = [a.domain, b.domain];
  for (const d of ['complex', 'digital', 'lo', 'clk', 'ctrl'] as Domain[]) if (ds.includes(d)) return d;
  return a.domain;
}

export function expand(doc: LineupDoc): Expanded {
  const instances: Instance[] = [];
  const byId = new Map<string, Instance>();
  const byBlock = new Map<string, Instance[]>();
  const issues: Issue[] = [];
  const seenIds = new Set<string>();

  for (const b of doc.blocks) {
    if (seenIds.has(b.id)) {
      issues.push({ level: 'error', msg: `Duplicate block id "${b.id}"`, block: b.id });
      continue;
    }
    seenIds.add(b.id);
    const rails: (Rail | undefined)[] = b.iq ? ['i', 'q'] : [undefined];
    const list = rails.map((r) => buildInstance(doc, b, r));
    if (!list[0].known) issues.push({ level: 'warning', msg: `Unknown block type "${b.type}" on ${b.id}; drawn as a custom block`, block: b.id });
    if (b.type === 'sheet' && !(b.sheet && doc.sheets?.[b.sheet])) issues.push({ level: 'error', msg: `${b.id}: sheet "${b.sheet ?? ''}" doesn't exist`, block: b.id });
    for (const inst of list) {
      instances.push(inst);
      byId.set(inst.id, inst);
    }
    byBlock.set(b.id, list);
  }

  // Labels: an I/Q pair shows its label and params once, under the Q instance.
  for (const [, list] of byBlock) {
    const b = list[0].block;
    if (list.length === 2) {
      const [iI, iQ] = list;
      const iLabel = b.iqOverride?.i?.label;
      if (iLabel) {
        iI.labelLines = [iLabel];
        iI.titled = true;
      }
      const lbl = labelText(b, iQ.def, 'q');
      if (iQ.def.labelInside) {
        // Boxes carry their label inside, on both rails.
        iI.innerLabel = labelText(b, iI.def, 'i');
        iQ.innerLabel = lbl;
        iI.labelLines = [];
        iI.titled = false;
        iQ.labelLines = shownLines(b, iQ, iI);
      } else {
        iQ.labelLines = [lbl, ...shownLines(b, iQ, iI)].filter((s) => s !== '');
        iQ.titled = lbl !== '';
      }
    } else {
      const inst = list[0];
      const lbl = labelText(b, inst.def);
      if (inst.def.labelInside) {
        inst.innerLabel = lbl;
        inst.labelLines = shownLines(b, inst);
      } else {
        inst.labelLines = [lbl, ...shownLines(b, inst)].filter((s) => s !== '');
        inst.titled = lbl !== '';
      }
    }
  }

  const findPort = (blockId: string, rail: Rail | undefined, port: string): PortInst | undefined => {
    const list = byBlock.get(blockId);
    if (!list) return undefined;
    const inst = rail ? list.find((i) => i.rail === rail) : list[0];
    return inst?.ports.find((p) => p.name === port);
  };

  const wires: Wire[] = [];
  doc.connections.forEach((c, ci) => {
    const f = parseRef(c.from);
    const t = parseRef(c.to);
    if (!f || !t) {
      issues.push({ level: 'error', msg: `Connection ${ci + 1}: bad endpoint "${!f ? c.from : c.to}" (use block.port)`, conn: ci });
      return;
    }
    const fb = byBlock.get(f.block);
    const tb = byBlock.get(t.block);
    if (!fb || !tb) {
      issues.push({ level: 'error', msg: `Connection ${c.from} → ${c.to}: no block "${!fb ? f.block : t.block}"`, conn: ci });
      return;
    }
    const fIQ = fb.length === 2;
    const tIQ = tb.length === 2;
    const fPortName = (r?: Rail) => findPort(f.block, fIQ ? r ?? 'i' : undefined, f.port);
    const tPortName = (r?: Rail) => findPort(t.block, tIQ ? r ?? 'i' : undefined, t.port);
    const fp0 = fPortName();
    const tp0 = tPortName();
    if (!fp0 || !tp0) {
      const which = !fp0 ? c.from : c.to;
      issues.push({ level: 'error', msg: `Connection ${c.from} → ${c.to}: no port "${which}"`, conn: ci });
      return;
    }

    // Work out which rails this connection draws.
    let pairs: { fr?: Rail; tr?: Rail; mark?: string }[] = [];
    const fRail = railOf(fp0.def);
    const tRail = railOf(tp0.def);
    const auxDomain = (d: Domain) => d === 'lo' || d === 'clk' || d === 'ctrl';
    if (fIQ && tIQ) {
      if (f.rail || t.rail) pairs = [{ fr: f.rail ?? t.rail, tr: t.rail ?? f.rail }];
      else pairs = [{ fr: 'i', tr: 'i' }, { fr: 'q', tr: 'q' }];
    } else if (!fIQ && tIQ) {
      if (fRail) pairs = [{ tr: fRail, mark: fRail.toUpperCase() }];
      else if (t.rail) pairs = [{ tr: t.rail }];
      else if (auxDomain(fp0.domain) || auxDomain(tp0.domain)) pairs = [{ tr: 'i' }, { tr: 'q' }];
      // A custom block (e.g. a deserializer) can unpack one port into both rails.
      else if (isCustomBlock(fb[0].def)) pairs = [{ tr: 'i' }, { tr: 'q' }];
      else {
        issues.push({ level: 'error', msg: `${c.from} → ${c.to}: a single path can't feed an I/Q pair; use a split block (I/Q demodulator, DDC) or pick a rail`, conn: ci });
        pairs = [{ tr: 'i' }];
      }
    } else if (fIQ && !tIQ) {
      if (tRail) pairs = [{ fr: tRail }];
      else if (f.rail) pairs = [{ fr: f.rail }];
      // A custom block (e.g. a serializer) can pack both rails into one port.
      else if (isCustomBlock(tb[0].def)) pairs = [{ fr: 'i' }, { fr: 'q' }];
      else {
        issues.push({ level: 'error', msg: `${c.from} → ${c.to}: an I/Q pair can only end at a merge block (I/Q modulator, DUC) or a chosen rail`, conn: ci });
        pairs = [{ fr: 'i' }];
      }
    } else pairs = [{}];

    for (const pr of pairs) {
      let a = findPort(f.block, fIQ ? pr.fr : undefined, f.port)!;
      let b = findPort(t.block, tIQ ? pr.tr : undefined, t.port)!;
      // Draw from the driving end: an input listed as `from` is swapped.
      if (a.dir === 'in' && b.dir !== 'in') [a, b] = [b, a];
      let level: Wire['level'];
      if (a.dir === 'out' && b.dir === 'out') {
        issues.push({ level: 'error', msg: `${c.from} → ${c.to}: output connected to output`, conn: ci });
        level = 'error';
      } else if (a.dir === 'in' && b.dir === 'in') {
        issues.push({ level: 'error', msg: `${c.from} → ${c.to}: input connected to input`, conn: ci });
        level = 'error';
      }
      let signal: Signal = a.signal;
      if (a.signal !== b.signal) {
        issues.push({ level: 'warning', msg: `${c.from} → ${c.to}: single-ended ↔ differential; insert a balun or set both blocks to the same signal`, conn: ci });
        level = level ?? 'warning';
        signal = 'se';
      }
      const domain = pickDomain(c, a, b);
      const kind = (d: Domain) => (d === 'signal' ? 'analog' : d === 'digital' ? 'real digital' : d === 'complex' ? 'complex' : null);
      const ka = kind(a.domain);
      const kb = kind(b.domain);
      if (!c.domain && ka && kb && ka !== kb) {
        const fix = ka === 'analog' || kb === 'analog' ? 'add an ADC/DAC, or set the block\'s domain' : 'set both blocks to the same domain';
        issues.push({ level: 'warning', msg: `${c.from} → ${c.to}: ${ka} ↔ ${kb}; ${fix}`, conn: ci });
        level = level ?? 'warning';
      }
      let width = a.width ?? b.width;
      if (domain === 'digital' && a.width && b.width && a.width !== b.width) {
        issues.push({ level: 'warning', msg: `${c.from} → ${c.to}: bus width ${a.width} ≠ ${b.width}`, conn: ci });
        level = level ?? 'warning';
      }
      wires.push({
        id: `w${ci}${pr.fr || pr.tr ? ':' + (pr.fr ?? pr.tr) : ''}`,
        conn: ci,
        rail: pr.fr ?? pr.tr,
        from: a,
        to: b,
        signal,
        domain,
        width: domain === 'digital' ? width : undefined,
        label: pr.fr === 'q' || pr.tr === 'q' ? undefined : c.label,
        railMark: pr.mark,
        via: c.via,
        net: a.key,
        level,
      });
    }
  });

  // Fan-in: more than one driver on a pure input.
  const drivers = new Map<string, Wire[]>();
  for (const w of wires) {
    if (w.to.dir !== 'in') continue;
    const list = drivers.get(w.to.key) ?? [];
    list.push(w);
    drivers.set(w.to.key, list);
  }
  for (const [key, list] of drivers) {
    // Both rails of one I/Q connection packed into a custom block's port count as one driver.
    if (new Set(list.map((w) => w.conn)).size > 1) {
      issues.push({ level: 'error', msg: `${key} has ${list.length} drivers; use a combiner or sum block`, conn: list[0].conn });
      for (const w of list) w.level = 'error';
    }
  }

  return { instances, byId, byBlock, wires, issues };
}
