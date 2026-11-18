import type { Domain } from '../model/types';

export interface LineStyle {
  width: number;
  dash?: string;
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
  font: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  body: 1.5,
  domains: {
    signal: { width: 1.5 },
    lo: { width: 1.5, dash: '6 3' },
    clk: { width: 1, dash: '3 3' },
    digital: { width: 2.5 },
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
    ctrl: '#64748b',
  },
};

export const THEMES: Record<string, Theme> = { mono: MONO, color: COLOR };

export function themeFor(name: string | undefined): Theme {
  return THEMES[name ?? 'mono'] ?? MONO;
}
