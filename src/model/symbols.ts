import { RAIL_PITCH, type Block, type BlockDomain, type PortDef, type Side, type SymbolDef } from './types';

// Every file in /symbols is a symbol. Contributors add a symbol by adding a JSON file.
const files = import.meta.glob(['../../symbols/*.json', '!../../symbols/aliases.json'], { eager: true, import: 'default' }) as Record<string, SymbolDef>;

export const SYMBOLS: Record<string, SymbolDef> = {};
for (const def of Object.values(files)) if (def.id) SYMBOLS[def.id] = def;

export const CATEGORY_ORDER = ['gain', 'filter', 'conversion', 'source', 'passive', 'converter', 'dsp', 'generic'];
export const CATEGORY_NAMES: Record<string, string> = {
  gain: 'Gain',
  filter: 'Filters',
  conversion: 'Conversion',
  source: 'Sources',
  passive: 'RF passives',
  converter: 'Converters',
  dsp: 'DSP',
  generic: 'Generic',
};

/** Spread n ports evenly along a side of the given length, on integer grid points. */
function spread(n: number, len: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(Math.round((len * (k + 1)) / (n + 1)));
  return out;
}

/** Size a custom block from its port count: 2 units per port, at least 6, even numbers only. */
function customSize(ports: PortDef[], size?: [number, number], label?: string): [number, number] {
  if (size) return size;
  const count = (s: Side) => ports.filter((p) => p.side === s).length;
  const even = (v: number) => Math.ceil(v / 2) * 2;
  const hasIQ = (side: Side) => ports.some((p) => p.side === side && p.name === 'i') && ports.some((p) => p.side === side && p.name === 'q');
  // A side with i and q needs room for them one rail pitch apart, clear of the corners.
  const iqMin = hasIQ('l') || hasIQ('r') ? RAIL_PITCH + 6 : 0;
  const h = Math.max(6, iqMin, even(2 * Math.max(count('l'), count('r')) + 2));
  // Short labels (FIR, NCO, DSP) fit the standard 6-unit cell; longer ones widen the box so
  // the text stays inside it (12 px text ≈ 0.72 grid units per character, plus padding).
  const text = label ?? 'Block';
  const minW = text.length <= 4 ? 6 : Math.max(8, even(Math.ceil(text.length * 0.72) + 2));
  const w = Math.max(minW, even(2 * Math.max(count('t'), count('b')) + 2));
  return [w, h];
}

/**
 * Resolve the symbol a block is drawn with. Custom blocks (and unknown types) get a
 * synthesised box symbol sized to their ports.
 */
export function symbolFor(block: Block, inferredPorts?: PortDef[]): { def: SymbolDef; known: boolean } {
  let base = SYMBOLS[block.type];
  if (base && block.type !== 'custom' && block.type !== 'sheet') {
    if (base.generator) base = GENERATORS[base.generator]?.(base, block) ?? base;
    const v = block.variant ? base.variants?.[block.variant] : undefined;
    const icon = base.iconSlot && block.icon ? block.icon : undefined;
    if (!v && !icon) return { def: base, known: true };
    return {
      def: {
        ...base,
        body: [base.body, v?.body, icon].filter(Boolean).join(' '),
        fill: [base.fill, v?.fill].filter(Boolean).join(' ') || undefined,
        ports: [...base.ports, ...(v?.ports ?? [])],
        texts: icon ? [] : (v?.texts ?? base.texts),
      },
      known: true,
    };
  }
  const custom = SYMBOLS.custom;
  const isSheet = block.type === 'sheet';
  let ports: PortDef[] = (isSheet ? inferredPorts ?? [] : block.ports && block.ports.length ? block.ports : base ? custom.ports : inferredPorts ?? []).map((p) => ({ ...p }));
  const [w, h] = customSize(ports, block.size, block.label ?? (isSheet ? block.sheet : base ? custom.label : block.type));
  for (const side of ['l', 'r', 't', 'b'] as Side[]) {
    const onSide = ports.filter((p) => p.side === side && p.at === undefined);
    const len = side === 'l' || side === 'r' ? h : w;
    // i/q ports sit one rail pitch apart so I/Q pairs downstream line up straight.
    const pi = onSide.find((p) => p.name === 'i');
    const pq = onSide.find((p) => p.name === 'q');
    let rest = onSide;
    if (pi && pq && len >= RAIL_PITCH + 4) {
      pi.at = Math.floor((len - RAIL_PITCH) / 2);
      pq.at = pi.at + RAIL_PITCH;
      rest = onSide.filter((p) => p !== pi && p !== pq);
    }
    const at = spread(rest.length, len);
    const taken = new Set([pi?.at, pq?.at]);
    rest.forEach((p, i) => {
      let a = at[i];
      while (taken.has(a)) a++;
      p.at = a;
      taken.add(a);
    });
  }
  const box = `M1,1 H${w - 1} V${h - 1} H1 Z`;
  const def: SymbolDef = {
    ...custom,
    id: block.type,
    size: [w, h],
    // A sheet looks like a stack of pages: a second outline offset up and to the right.
    body: isSheet ? `${box} M1.6,1 V0.4 H${w - 0.4} V${h - 1.6} H${w - 1}` : block.icon ? `${box} ${block.icon}` : box,
    mask: box,
    ports,
    labelInside: true,
    label: isSheet ? (block.sheet ?? 'Sheet') : base ? custom.label : block.type,
    name: isSheet ? 'Sheet' : custom.name,
    dsp: isSheet ? false : custom.dsp,
  };
  return { def, known: !!base };
}

// ---- Generated symbols -------------------------------------------------------

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const circ = (cx: number, cy: number, r: number) => `M${r3(cx - r)},${cy} A${r},${r} 0 1 1 ${r3(cx + r)},${cy} A${r},${r} 0 1 1 ${r3(cx - r)},${cy} Z`;

/** Number of throws for a switch block (2–8). */
export function switchThrows(block: Block): number {
  const n = Number(block.params?.throws ?? 2);
  return Number.isFinite(n) ? Math.max(2, Math.min(8, Math.round(n))) : 2;
}

/**
 * SPnT switch: throws one grid pitch (2 units) apart on the right, common port centred on
 * the left, so an SPDT is 6 units tall like every other symbol and an SP4T is 10.
 */
function genSwitch(base: SymbolDef, block: Block): SymbolDef {
  const n = switchThrows(block);
  const h = 2 * n + 2;
  const c = h / 2;
  const throws = Array.from({ length: n }, (_, k) => 2 + 2 * k);
  // Blade from the pivot towards the first throw, stopping short of its contact.
  const dx = 4.5 - 2;
  const dy = throws[0] - c;
  const len = Math.hypot(dx, dy);
  const bx = 2 + (dx * (len - 0.3)) / len;
  const by = c + (dy * (len - 0.3)) / len;
  const body = [`M1,${c} H2 M2,${c} L${r3(bx)},${r3(by)}`, ...throws.map((t) => `${circ(4.5, t, 0.25)} M4.75,${t} H5`)].join(' ');
  return {
    ...base,
    name: n === 2 ? 'SPDT switch' : `SP${n}T switch`,
    size: [6, h],
    body,
    fill: circ(2, c, 0.22),
    ports: [
      { name: 'c', side: 'l', at: c, dir: 'bi', signal: 'se' },
      ...throws.map((t, k) => ({ name: `t${k + 1}`, side: 'r' as const, at: t, dir: 'bi' as const, signal: 'se' as const })),
      { name: 'ctrl', side: 'b', at: 3, dir: 'in', signal: 'se', domain: 'ctrl', optional: true, lead: h - c - 1 },
    ],
  };
}

const GENERATORS: Record<string, (base: SymbolDef, block: Block) => SymbolDef> = { switch: genSwitch };

/** Fill "{param|fallback}" placeholders in symbol text from block params. */
export function fillTemplate(text: string, params: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\|([^}]*)\}/g, (_, k: string, fb: string) => {
    const v = params[k];
    return v === undefined || v === null || v === '' ? fb : String(typeof v === 'number' ? Number(v.toPrecision(4)) : v);
  });
}

/** What a symbol's signal ports carry before any block-level setting. */
export function nativeDomain(def: SymbolDef): BlockDomain {
  const p = def.ports.find((x) => !x.fixedDomain && ['signal', 'digital', 'complex'].includes(x.domain ?? 'signal'));
  return (p?.domain as BlockDomain | undefined) ?? 'signal';
}

/** A block's effective domain. */
export function blockDomain(block: Block, def: SymbolDef = symbolFor(block).def): BlockDomain {
  return (def.dsp && block.domain) || nativeDomain(def);
}

export function defaultLabel(def: SymbolDef): string {
  return def.label ?? '';
}
