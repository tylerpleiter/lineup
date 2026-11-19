import type { Domain } from '../model/types';

export interface LineStyle {
  width: number;
  dash?: string;
  /** Draw as a hollow line: the centre `hollow` px are cut out in the background colour. */
  hollow?: number;
}

export interface Theme {
  stroke: string;
  background: string;
  font: string;
  /** Symbol body stroke, px. */
  body: number;
  domains: Record<Domain, LineStyle>;
  colors?: Partial<Record<Domain, string>>;
}

// Black on white. Every distinction is carried by line pattern and weight, never colour.
export const MONO: Theme = {
  stroke: '#000',
  background: '#fff',
  font: "Inter, Helvetica, Arial, 'Liberation Sans', sans-serif",
  body: 1.5,
  domains: {
    signal: { width: 1.5 },
    lo: { width: 1.5, dash: '6 3' },
    clk: { width: 1, dash: '3 3' },
    digital: { width: 2.5 },
    // Complex samples: a hollow double line, distinct from a differential pair (two thin
    // lines a grid unit apart) and from a real digital bus (solid heavy line).
    complex: { width: 4.5, hollow: 1.7 },
    ctrl: { width: 1, dash: '1 3' },
  },
};

// Same line patterns as mono, plus a hue per domain for slides and screens.
export const COLOR: Theme = {
  ...MONO,
  colors: {
    signal: '#1d4ed8',
    lo: '#c2410c',
    clk: '#a16207',
    digital: '#334155',
    complex: '#6d28d9',
    ctrl: '#64748b',
  },
};

export const THEMES: Record<string, Theme> = { mono: MONO, color: COLOR };

export function themeFor(name: string | undefined): Theme {
  return THEMES[name ?? 'mono'] ?? MONO;
}
