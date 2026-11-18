import { RAIL_PITCH, type Block, type PortDef, type Side, type SymbolDef } from './types';

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
  // Short labels (FIR, NCO, DSP) fit the standard 6-unit cell; longer ones get 8.
  const minW = (label ?? 'Block').length <= 4 ? 6 : 8;
  const w = Math.max(minW, even(2 * Math.max(count('t'), count('b')) + 2));
  return [w, h];
}

/**
 * Resolve the symbol a block is drawn with. Custom blocks (and unknown types) get a
 * synthesised box symbol sized to their ports.
 */
export function symbolFor(block: Block, inferredPorts?: PortDef[]): { def: SymbolDef; known: boolean } {
  const base = SYMBOLS[block.type];
  if (base && block.type !== 'custom') {
    const v = block.variant ? base.variants?.[block.variant] : undefined;
    if (!v) return { def: base, known: true };
    return {
      def: {
        ...base,
        body: [base.body, v.body].filter(Boolean).join(' '),
        fill: [base.fill, v.fill].filter(Boolean).join(' ') || undefined,
        ports: [...base.ports, ...(v.ports ?? [])],
      },
      known: true,
    };
  }
  const custom = SYMBOLS.custom;
  let ports: PortDef[] = (block.ports && block.ports.length ? block.ports : base ? custom.ports : inferredPorts ?? []).map((p) => ({ ...p }));
  const [w, h] = customSize(ports, block.size, block.label ?? (base ? custom.label : block.type));
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
    body: block.icon ? `${box} ${block.icon}` : box,
    mask: box,
    ports,
    labelInside: true,
    label: base ? custom.label : block.type,
  };
  return { def, known: !!base };
}

/** Fill "{param|fallback}" placeholders in symbol text from block params. */
export function fillTemplate(text: string, params: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\|([^}]*)\}/g, (_, k: string, fb: string) => {
    const v = params[k];
    return v === undefined || v === null || v === '' ? fb : String(typeof v === 'number' ? Number(v.toPrecision(4)) : v);
  });
}

export function defaultLabel(def: SymbolDef): string {
  return def.label ?? '';
}
