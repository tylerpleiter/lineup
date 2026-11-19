import { describe, expect, it } from 'vitest';
import { SYMBOLS, CATEGORY_ORDER, symbolFor, fillTemplate } from '../src/model/symbols';
import { RESERVED } from '../src/model/params';

describe('symbol library', () => {
  const defs = Object.values(SYMBOLS);

  it('has one symbol per distinct drawing', () => {
    expect(defs.length).toBe(41);
  });

  for (const raw of defs) {
    it(`${raw.id} is well formed`, () => {
      // Generated symbols (switch) are checked as drawn.
      const d = raw.generator ? symbolFor({ id: 'x', type: raw.id }).def : raw;
      expect(CATEGORY_ORDER).toContain(d.category);
      const [w, h] = d.size;
      expect(w % 2 === 0 && h % 2 === 0).toBe(true);
      const names = d.ports.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      if (d.id !== 'custom' && d.id !== 'sheet') {
        expect(d.body.length + (d.fill ?? '').length).toBeGreaterThan(0);
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
        if (v.texts) expect(withV.texts).toEqual(v.texts);
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

describe('generated switch', () => {
  it('sizes to its throws, keeps ports on grid and names throws t1…tN', () => {
    for (const n of [2, 3, 4, 8]) {
      const d = symbolFor({ id: 's', type: 'switch', params: { throws: n } }).def;
      expect(d.size).toEqual([6, 2 * n + 2]);
      const t = d.ports.filter((p) => p.name.startsWith('t'));
      expect(t.map((p) => p.name)).toEqual(Array.from({ length: n }, (_, k) => `t${k + 1}`));
      expect(t.every((p) => Number.isInteger(p.at) && p.at! > 0 && p.at! < 2 * n + 2)).toBe(true);
      expect(d.ports.find((p) => p.name === 'c')!.at).toBe(n + 1);
    }
  });

  it('spdt / sp4t aliases become switches with the right throws', async () => {
    const { parseDoc } = await import('../src/io/schema');
    const d = parseDoc(JSON.stringify({ lineup: '0.1', blocks: [{ id: 'a', type: 'spdt' }, { id: 'b', type: 'sp4t' }], connections: [] })).doc!;
    expect(d.blocks.map((b) => [b.type, b.params?.throws])).toEqual([['switch', 2], ['switch', 4]]);
  });
});
