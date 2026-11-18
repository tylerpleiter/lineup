import type { ParamValue } from './types';

export interface ParamMeta {
  /** Short symbol used on the diagram, e.g. "G", "NF". Empty = value only. */
  sym: string;
  unit: string;
  /** How the stored number is shown. */
  kind: 'db' | 'dbm' | 'hz' | 'count' | 'sps' | 'ratio';
  name: string;
}

/** Reserved keys: stored as plain numbers in base units so a cascade engine can trust them. */
export const RESERVED: Record<string, ParamMeta> = {
  gain: { sym: 'G', unit: 'dB', kind: 'db', name: 'Gain' },
  nf: { sym: 'NF', unit: 'dB', kind: 'db', name: 'Noise figure' },
  oip3: { sym: 'OIP3', unit: 'dBm', kind: 'dbm', name: 'Output IP3' },
  iip3: { sym: 'IIP3', unit: 'dBm', kind: 'dbm', name: 'Input IP3' },
  p1db: { sym: 'P1dB', unit: 'dBm', kind: 'dbm', name: 'Output P1dB' },
  il: { sym: 'IL', unit: 'dB', kind: 'db', name: 'Insertion loss' },
  freq: { sym: '', unit: 'Hz', kind: 'hz', name: 'Frequency' },
  fc: { sym: 'fc', unit: 'Hz', kind: 'hz', name: 'Cutoff / center' },
  bw: { sym: 'BW', unit: 'Hz', kind: 'hz', name: 'Bandwidth' },
  bits: { sym: '', unit: 'bit', kind: 'count', name: 'Resolution' },
  fs: { sym: 'fs', unit: 'S/s', kind: 'sps', name: 'Sample rate' },
  ratio: { sym: '', unit: '', kind: 'ratio', name: 'Ratio' },
};

const PREFIX: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Engineering notation with 3 significant figures, e.g. 2.44e9 → "2.44 G". */
export function eng(v: number): { num: string; prefix: string } {
  if (v === 0 || !isFinite(v)) return { num: String(v), prefix: '' };
  const a = Math.abs(v);
  for (const [scale, prefix] of PREFIX) {
    if (a >= scale * 0.9995) {
      const n = v / scale;
      return { num: String(Number(n.toPrecision(3))), prefix };
    }
  }
  return { num: String(Number(v.toPrecision(3))), prefix: '' };
}

function sig3(v: number): string {
  return String(Number(v.toPrecision(3)));
}

/** Text for a param value, without the key symbol: "18 dB", "2.44 GHz". */
export function formatValue(key: string, v: ParamValue): string {
  if (typeof v === 'string') return v;
  const meta = RESERVED[key];
  if (!meta) return sig3(v);
  switch (meta.kind) {
    case 'db':
    case 'dbm':
      return `${sig3(v)} ${meta.unit}`;
    case 'hz':
    case 'sps': {
      const e = eng(v);
      return `${e.num} ${e.prefix}${meta.unit}`;
    }
    case 'count':
      return meta.unit === 'bit' ? `${v}-bit` : `${v} ${meta.unit}`;
    default:
      return sig3(v);
  }
}

/** Text drawn under a block for a shown param: "G = 18 dB", "2.44 GHz", "14 b". */
export function formatParam(key: string, v: ParamValue): string {
  const meta = RESERVED[key];
  const val = formatValue(key, v);
  if (meta) return meta.sym ? `${meta.sym} = ${val}` : val;
  return `${key} = ${val}`;
}

const PREFIX_IN: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12 };

/**
 * Parse user input for a param. Reserved keys accept engineering notation with optional
 * units ("2.44G", "20 MHz", "-3dB"); anything that doesn't parse stays a string.
 */
export function parseParam(key: string, input: string): ParamValue | undefined {
  const s = input.trim();
  if (s === '') return undefined;
  if (!RESERVED[key]) {
    const n = Number(s);
    return s !== '' && isFinite(n) && /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(s) ? n : s;
  }
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([TGMkKmuµnp]?)\s*-?(hz|s\/s|sps|dbm|db|b|bits?)?$/i);
  if (!m) return s;
  let n = Number(m[1]);
  let prefix = m[2] ?? '';
  const unit = (m[3] ?? '').toLowerCase();
  // "m" alone after a number is milli, except "dBm" which the unit group already took.
  if (prefix && (unit === 'db' || unit === 'dbm')) prefix = '';
  if (prefix) n *= PREFIX_IN[prefix] ?? 1;
  return n;
}

/** Input text shown in the properties panel for a stored value. */
export function editText(key: string, v: ParamValue | undefined | null): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  return formatValue(key, v);
}
