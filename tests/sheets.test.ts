import { describe, expect, it } from 'vitest';
import { collapseToSheet, flatten, sheetPorts } from '../src/model/sheets';
import { expand } from '../src/model/expand';
import { serialize } from '../src/model/doc';
import { parseDoc } from '../src/io/schema';
import type { LineupDoc } from '../src/model/types';

const doc = (): LineupDoc => ({
  lineup: '0.1',
  blocks: [
    { id: 'ant', type: 'antenna', x: 0, y: 0 },
    { id: 'fe', type: 'sheet', sheet: 'frontend', x: 10, y: 0 },
    { id: 'mix', type: 'mixer', x: 30, y: 0 },
    { id: 'lo', type: 'lo', x: 30, y: 10 },
  ],
  connections: [{ from: 'ant.io', to: 'fe.rf_in' }, { from: 'fe.rf_out', to: 'mix.rf' }, { from: 'lo.out', to: 'mix.lo' }],
  sheets: {
    frontend: {
      title: 'Front end',
      blocks: [
        { id: 'rf_in', type: 'port_in', x: 0, y: 4 },
        { id: 'bpf', type: 'bpf', params: { il: 1.5 }, x: 8, y: 4 },
        { id: 'lna', type: 'amp', params: { gain: 18, nf: 1 }, x: 16, y: 4 },
        { id: 'rf_out', type: 'port_out', x: 24, y: 4 },
      ],
      connections: [{ from: 'rf_in.out', to: 'bpf.in' }, { from: 'bpf.out', to: 'lna.in' }, { from: 'lna.out', to: 'rf_out.in' }],
    },
  },
});

describe('sheets', () => {
  it('a sheet block gets its ports from the port blocks inside', () => {
    const d = doc();
    const ports = sheetPorts(d, d.blocks[1]);
    expect(ports.map((p) => `${p.name}:${p.side}:${p.dir}`)).toEqual(['rf_in:l:in', 'rf_out:r:out']);
    const ex = expand(d);
    expect(ex.issues).toEqual([]);
    expect(ex.wires.length).toBe(3);
  });

  it('flattens through sheet ports with prefixed ids', () => {
    const f = flatten(doc());
    expect(f.issues).toEqual([]);
    expect(f.doc.blocks.map((b) => b.id)).toEqual(['ant', 'fe/bpf', 'fe/lna', 'mix', 'lo']);
    expect(f.doc.connections.map((c) => `${c.from}>${c.to}`).sort()).toEqual(['ant.io>fe/bpf.in', 'fe/bpf.out>fe/lna.in', 'fe/lna.out>mix.rf', 'lo.out>mix.lo']);
    expect(f.drivers.get('fe.rf_out')).toBe('fe/lna.out');
    expect(expand(f.doc).issues).toEqual([]);
  });

  it('nested sheets flatten recursively; a sheet containing itself is reported', () => {
    const d = doc();
    d.sheets!.outer = { blocks: [{ id: 'i', type: 'port_in' }, { id: 'inner', type: 'sheet', sheet: 'frontend' }, { id: 'o', type: 'port_out' }], connections: [{ from: 'i.out', to: 'inner.rf_in' }, { from: 'inner.rf_out', to: 'o.in' }] };
    d.blocks[1].sheet = 'outer';
    d.connections = [{ from: 'ant.io', to: 'fe.i' }, { from: 'fe.o', to: 'mix.rf' }, { from: 'lo.out', to: 'mix.lo' }];
    const f = flatten(d);
    expect(f.doc.blocks.map((b) => b.id)).toContain('fe/inner/lna');
    expect(f.doc.connections.some((c) => c.from === 'fe/inner/lna.out' && c.to === 'mix.rf')).toBe(true);
    d.sheets!.loop = { blocks: [{ id: 'me', type: 'sheet', sheet: 'loop' }], connections: [] };
    d.blocks.push({ id: 'l', type: 'sheet', sheet: 'loop' });
    expect(flatten(d).issues.some((m) => m.includes('contains itself'))).toBe(true);
  });

  it('collapses a selection into a sheet and flattens back to the same circuit', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [
        { id: 'ant', type: 'antenna', x: 0, y: 0 }, { id: 'bpf', type: 'bpf', x: 10, y: 0 }, { id: 'lna', type: 'amp', x: 20, y: 0 },
        { id: 'mix', type: 'mixer', x: 30, y: 0 }, { id: 'lo', type: 'lo', x: 30, y: 10 },
      ],
      connections: [{ from: 'ant.io', to: 'bpf.in' }, { from: 'bpf.out', to: 'lna.in' }, { from: 'lna.out', to: 'mix.rf' }, { from: 'lo.out', to: 'mix.lo' }],
    };
    const before = flatten(d).doc.connections.map((c) => `${c.from}>${c.to}`).sort();
    collapseToSheet(d, new Set(['bpf', 'lna']), 'fe', 'fe1');
    expect(d.blocks.map((b) => b.id)).toEqual(['ant', 'mix', 'lo', 'fe1']);
    expect(Object.keys(d.sheets!)).toEqual(['fe']);
    expect(expand(d).issues).toEqual([]);
    const after = flatten(d).doc.connections.map((c) => `${c.from.replace('fe1/', '')}>${c.to.replace('fe1/', '')}`).sort();
    expect(after).toEqual(before);
  });

  it('saves sheets and every block field, and loads them back unchanged', () => {
    const d = doc();
    Object.assign(d.blocks[2], { variant: 'adjustable', flipV: true, domain: 'digital' });
    d.blocks.push({ id: 'k', type: 'custom', label: 'K', icon: 'M2,2 H4', size: [8, 6] });
    d.analysis = { pin: -40, bw: 1e6, showLevels: true };
    const text = serialize(d);
    const r = parseDoc(text);
    expect(r.warnings).toEqual([]);
    expect(serialize(r.doc!)).toBe(text);
    const back = JSON.parse(text);
    expect(back.sheets.frontend.blocks.length).toBe(4);
    expect(back.blocks.find((b: { id: string }) => b.id === 'mix')).toMatchObject({ variant: 'adjustable', flipV: true, domain: 'digital' });
    expect(back.blocks.find((b: { id: string }) => b.id === 'k')).toMatchObject({ icon: 'M2,2 H4' });
  });
});
