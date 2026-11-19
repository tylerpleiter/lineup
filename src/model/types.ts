// Core types for Lineup documents and symbol definitions.
// The JSON Schema in /schema/lineup.schema.json mirrors the document types here.

export type Side = 'l' | 'r' | 't' | 'b';
export type Dir = 'in' | 'out' | 'bi';
export type Signal = 'se' | 'diff';
/**
 * Line-style domain. `signal` is the analog RF/IF/baseband path, `digital` a real-valued
 * sample stream or bus, `complex` a complex (I+jQ) sample stream inside DSP; the rest are
 * auxiliary lines.
 */
export type Domain = 'signal' | 'lo' | 'clk' | 'digital' | 'complex' | 'ctrl';
/** What a DSP-capable block's signal ports carry, set per block. */
export type BlockDomain = 'signal' | 'digital' | 'complex';
export type Rail = 'i' | 'q';
export type Rot = 0 | 90 | 180 | 270;

export const DOMAINS: Domain[] = ['signal', 'lo', 'clk', 'digital', 'complex', 'ctrl'];
export const BLOCK_DOMAINS: BlockDomain[] = ['signal', 'digital', 'complex'];

/** Older files used rf / if / bb; they all mean the signal path. */
export function normDomain(d: string | undefined): Domain {
  if (!d || d === 'rf' || d === 'if' || d === 'bb') return 'signal';
  return (DOMAINS as string[]).includes(d) ? (d as Domain) : 'signal';
}
/** Domains that a block-level `signal` override applies to. */
export const SIGNAL_PATH_DOMAINS: Domain[] = ['signal'];

export type ParamValue = number | string;
export type Params = Record<string, ParamValue>;

export interface PortDef {
  name: string;
  side: Side;
  /** Offset along the side, in grid units, from the top (l/r) or left (t/b). */
  at?: number;
  dir: Dir;
  signal?: Signal;
  domain?: Domain;
  /** Bus width for digital ports. */
  width?: number;
  /** Take the bus width from this param (e.g. "bits"). */
  widthFrom?: string;
  /** Signal is fixed by the symbol and ignores the block-level override (e.g. balun sides). */
  fixed?: boolean;
  /** Lead length in grid units, from the port point to the symbol body. Default 1. */
  lead?: number;
  /** Lead length when the port is differential (pins sit ±0.5 off-axis, e.g. on a triangle's slanted edge). */
  diffLead?: number;
  /** Optional ports (control, reference) draw their lead only when connected. */
  optional?: boolean;
  /** This port carries one I/Q rail. Ports named "i"/"q" are rail ports implicitly. */
  rail?: Rail;
  /** Domain is fixed by the symbol and ignores the block-level domain (e.g. an ADC's digital output). */
  fixedDomain?: boolean;
}

export function railOf(p: { name: string; rail?: Rail } | undefined): Rail | undefined {
  if (!p) return undefined;
  if (p.rail) return p.rail;
  return p.name === 'i' || p.name === 'q' ? p.name : undefined;
}

export interface SymbolVariant {
  name: string;
  body?: string;
  fill?: string;
  ports?: PortDef[];
  /** Replaces the symbol's texts when set (e.g. a drawn response instead of "H(f)"). */
  texts?: SymbolText[];
}

export interface SymbolText {
  text: string;
  at: [number, number];
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  italic?: boolean;
}

export interface SymbolDef {
  id: string;
  name: string;
  category: string;
  size: [number, number];
  /** SVG path data in grid units, stroked with the theme stroke, no fill. */
  body: string;
  /** Paths filled with the stroke colour (dots, arrowheads). */
  fill?: string;
  /** Paths that get a white fill so wires behind them are masked. */
  mask?: string;
  texts?: SymbolText[];
  ports: PortDef[];
  params?: Record<string, ParamValue | null>;
  /** Params shown on the diagram by default when a block is created from the palette. */
  show?: string[];
  label?: string;
  variants?: Record<string, SymbolVariant>;
  /** Draw the label inside the body instead of below it (custom blocks). */
  labelInside?: boolean;
  description?: string;
  /** The block-level domain (analog / digital / complex) can be switched. */
  dsp?: boolean;
  /** A block's `icon` path may be drawn in this symbol, replacing its texts. */
  iconSlot?: boolean;
  /** Geometry is generated from params at load (e.g. "switch" from `throws`). */
  generator?: string;
}

export interface Block {
  id: string;
  type: string;
  label?: string;
  x?: number;
  y?: number;
  rot?: Rot;
  flip?: boolean;
  /** Mirror vertically. */
  flipV?: boolean;
  iq?: boolean;
  iqOverride?: Partial<Record<Rail, { params?: Params; label?: string }>>;
  signal?: Signal;
  /** For DSP-capable blocks: what the signal ports carry (default: the symbol's own). */
  domain?: BlockDomain;
  params?: Params;
  show?: string[];
  /** Symbol variant, e.g. "adjustable". */
  variant?: string;
  /** Custom blocks only. */
  ports?: PortDef[];
  /** Custom blocks, and symbols with an icon slot (filter): SVG path drawn in the cell, in grid units. */
  icon?: string;
  /** Custom blocks only: cell size in grid units [w, h]. */
  size?: [number, number];
  /** Sheet blocks only: name of the sub-diagram in the document's `sheets`. */
  sheet?: string;
}

export interface Connection {
  from: string;
  to: string;
  label?: string;
  domain?: Domain;
  via?: [number, number][];
}

export interface Group {
  id: string;
  label?: string;
  members: string[];
}

export interface Note {
  text: string;
  x?: number;
  y?: number;
  near?: string;
}

export interface DocStyle {
  /** Horizontal wires hop over crossing wires (default true). */
  hops?: boolean;
  /** Mark differential pins with + / − (default false). */
  pmMarks?: boolean;
}

/** Settings for cascade analysis and the frequency plan. */
export interface Analysis {
  /** Input signal power, dBm (enables running levels and SNR). */
  pin?: number;
  /** Input signal frequency, Hz (for sources without their own `freq`). */
  fin?: number;
  /** Noise bandwidth, Hz (for noise floor and SNR). */
  bw?: number;
  /**
   * Blocks the analysed path runs through, in flattened ids ("fe/lna" for a block inside
   * sheet block "fe"). Empty or absent: from the main input to the furthest stage.
   */
  path?: string[];
  /** Print signal levels along the analysed path on the diagram. */
  showLevels?: boolean;
  /** Print frequencies on wires. */
  showFreq?: boolean;
}

/** A sub-diagram. Its port_in / port_out blocks become the ports of the sheet blocks that use it. */
export interface Sheet {
  title?: string;
  blocks: Block[];
  connections: Connection[];
  groups?: Group[];
  notes?: Note[];
}

export interface LineupDoc {
  lineup: string;
  title?: string;
  theme?: 'mono' | 'color';
  style?: DocStyle;
  analysis?: Analysis;
  blocks: Block[];
  connections: Connection[];
  groups?: Group[];
  notes?: Note[];
  /** Sub-diagrams used by `sheet` blocks, by name. */
  sheets?: Record<string, Sheet>;
}

export const FORMAT_VERSION = '0.1';
/** Grid unit in px at 100% zoom. */
export const G = 10;
/** Vertical distance between the I and Q instances of a linked pair, in grid units. */
export const RAIL_PITCH = 6;
