import { describe, expect, it } from 'vitest';
import { SYMBOLS, CATEGORY_ORDER, symbolFor, fillTemplate } from '../src/model/symbols';
import { RESERVED } from '../src/model/params';

describe('symbol library', () => {
  const defs = Object.values(SYMBOLS);

  it('has one symbol per distinct drawing', () => {
    expect(defs.length).toBe(38);
  });

  for (const d of defs) {
    it(`${d.id} is well formed`, () => {
      expect(CATEGORY_ORDER).toContain(d.category);
      const [w, h] = d.size;
      expect(w % 2 === 0 && h % 2 === 0).toBe(true);
      const names = d.ports.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      if (d.id !== 'custom') {
        expect(d.body.length).toBeGreaterThan(0);
        for (const p of d.ports) {
          expect(Number.isInteger(p.at)).toBe(true);
          const len = p.side === 'l' || p.side === 'r' ? h : w;
          expect(p.at! > 0 && p.at! < len).toBe(true);
        }
      }
      for (const k of Object.keys(d.params ?? {})) if (k in RESERVED) expect(d.params![k]).toBeNull();
      for (const [vk, v] of Object.entries(d.variants ?? {})) {
        expect(v.name).toBeTruthy();
        const withV = symbolFor({ id: 'x', type: d.id, variant: vk }).def;
        expect(withV.body.length).toBeGreaterThan(d.body.length);
      }
    });
  }

  it('fills text templates from params', () => {
    expect(fillTemplate('↓{ratio|M}', { ratio: 8 })).toBe('↓8');
    expect(fillTemplate('↓{ratio|M}', {})).toBe('↓M');
  });

  it('places custom i/q ports one rail pitch apart and clear of corners', () => {
    const def = symbolFor({ id: 'f', type: 'custom', ports: [{ name: 'i', side: 'r', dir: 'out' }, { name: 'q', side: 'r', dir: 'out' }, { name: 'clk', side: 'l', dir: 'in' }] }).def;
    const i = def.ports.find((p) => p.name === 'i')!;
    const q = def.ports.find((p) => p.name === 'q')!;
    expect(q.at! - i.at!).toBe(6);
    expect(i.at!).toBeGreaterThanOrEqual(2);
    expect(q.at!).toBeLessThanOrEqual(def.size[1] - 2);
  });
});

describe('aliases', () => {
  it('every alias targets a real symbol, and no alias shadows one', async () => {
    const { ALIASES } = await import('../src/model/aliases');
    for (const [name, a] of Object.entries(ALIASES)) {
      expect(SYMBOLS[a.type], name).toBeDefined();
      expect(SYMBOLS[name], name).toBeUndefined();
      for (const [, to] of Object.entries(a.ports ?? {})) expect(SYMBOLS[a.type].ports.some((p) => p.name === to)).toBe(true);
      if (a.variant) expect(SYMBOLS[a.type].variants?.[a.variant]).toBeDefined();
    }
  });

  it('resolves alias types on load, keeping explicit fields and renaming ports', async () => {
    const { parseDoc } = await import('../src/io/schema');
    const { expand } = await import('../src/model/expand');
    const r = parseDoc(JSON.stringify({
      lineup: '0.1',
      blocks: [
        { id: 'l', type: 'lna' }, { id: 'p', type: 'pa', label: 'Final' }, { id: 'v', type: 'vco' },
        { id: 'c', type: 'combiner' }, { id: 'x', type: 'diplexer' }, { id: 'n', type: 'nco' }, { id: 'f', type: 'fir' },
      ],
      connections: [
        { from: 'l.out', to: 'c.i1' }, { from: 'p.out', to: 'c.i2' }, { from: 'c.out', to: 'x.lb' }, { from: 'n.out', to: 'f.in' },
      ],
    }));
    const d = r.doc!;
    const by = Object.fromEntries(d.blocks.map((b) => [b.id, b]));
    expect(by.l).toMatchObject({ type: 'amp', label: 'LNA' });
    expect(by.p).toMatchObject({ type: 'amp', label: 'Final' });
    expect(by.v).toMatchObject({ type: 'lo', label: 'VCO', variant: 'adjustable' });
    expect(by.c).toMatchObject({ type: 'splitter', flip: true });
    expect(by.n.ports?.[0].name).toBe('out');
    expect(d.connections.map((c) => `${c.from}>${c.to}`)).toEqual(['l.out>c.o1', 'p.out>c.o2', 'c.in>x.tx', 'n.out>f.in']);
    expect(expand(d).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
