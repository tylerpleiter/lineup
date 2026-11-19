import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { expand } from '../src/model/expand';
import { propagateIQ, unlink, relink } from '../src/model/iq';
import { serialize } from '../src/model/doc';
import { parseDoc } from '../src/io/schema';
import { formatParam, parseParam } from '../src/model/params';
import type { LineupDoc } from '../src/model/types';

const load = (f: string) => parseDoc(fs.readFileSync(f, 'utf8'));

describe('examples', () => {
  for (const f of ['examples/zero-if-rx.sig.json', 'examples/iq-tx.sig.json', 'examples/superhet-ddc.sig.json']) {
    it(`${f} validates and expands without errors`, () => {
      const r = load(f);
      expect(r.error).toBeUndefined();
      expect(r.warnings).toEqual([]);
      propagateIQ(r.doc!);
      const ex = expand(r.doc!);
      expect(ex.issues.filter((i) => i.level === 'error')).toEqual([]);
    });
  }
});

describe('I/Q expansion', () => {
  it('zero-IF: lpf, vga, adc each draw two instances and wires go I→I, Q→Q', () => {
    const doc = load('examples/zero-if-rx.sig.json').doc!;
    const ex = expand(doc);
    expect(ex.byBlock.get('lpf')!.length).toBe(2);
    const w = ex.wires.filter((x) => x.from.block === 'lpf');
    expect(w.map((x) => `${x.from.inst}->${x.to.inst}`).sort()).toEqual(['lpf:i->vga:i', 'lpf:q->vga:q']);
    const split = ex.wires.filter((x) => x.from.block === 'dmd' && x.to.block === 'lpf');
    expect(split.map((x) => x.to.inst).sort()).toEqual(['lpf:i', 'lpf:q']);
    expect(split.every((x) => x.signal === 'diff')).toBe(true);
  });

  it('propagates iq downstream of a split block and upstream of a merge block', () => {
    const doc: LineupDoc = {
      lineup: '0.1',
      blocks: [
        { id: 'd', type: 'iq_demod' }, { id: 'f', type: 'lpf' }, { id: 'a', type: 'adc' },
        { id: 'g', type: 'amp' }, { id: 'm', type: 'iq_mod' }, { id: 'lo', type: 'lo' },
      ],
      connections: [
        { from: 'd.i', to: 'f.in' }, { from: 'd.q', to: 'f.in' }, { from: 'f.out', to: 'a.in' },
        { from: 'g.out', to: 'm.i' }, { from: 'g.out', to: 'm.q' }, { from: 'lo.out', to: 'd.lo' },
      ],
    };
    expect(propagateIQ(doc).sort()).toEqual(['a', 'f', 'g']);
    expect(doc.blocks.find((b) => b.id === 'lo')!.iq).toBeUndefined();
    expect(expand(doc).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('unlink then relink round-trips', () => {
    const doc = load('examples/zero-if-rx.sig.json').doc!;
    doc.blocks.forEach((b, i) => { b.x = i * 10; b.y = 0; });
    const before = serialize(doc);
    const ids = unlink(doc, 'vga')!;
    expect(ids).toEqual(['vga_i', 'vga_q']);
    expect(doc.connections.some((c) => c.from === 'lpf:i.out' && c.to === 'vga_i.in')).toBe(true);
    expect(expand(doc).issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(relink(doc, 'vga_i', 'vga_q')).toBe('vga');
    expect(serialize(doc)).toBe(before);
  });
});

describe('rules', () => {
  it('flags se→diff, out→out and fan-in', () => {
    const doc: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'a', type: 'amp' }, { id: 'b', type: 'amp', signal: 'diff' }, { id: 'c', type: 'amp' }],
      connections: [{ from: 'a.out', to: 'b.in' }, { from: 'a.out', to: 'c.out' }, { from: 'b.out', to: 'c.in' }, { from: 'a.out', to: 'c.in' }],
    };
    const msgs = expand(doc).issues.map((i) => i.msg).join('\n');
    expect(msgs).toMatch(/differential/);
    expect(msgs).toMatch(/output connected to output/);
    expect(msgs).toMatch(/2 drivers/);
  });

  it('unknown types load as custom blocks with inferred ports', () => {
    const doc: LineupDoc = { lineup: '0.1', blocks: [{ id: 'x', type: 'warp_drive' }, { id: 'a', type: 'amp' }], connections: [{ from: 'a.out', to: 'x.plasma' }] };
    const ex = expand(doc);
    expect(ex.issues[0].level).toBe('warning');
    expect(ex.wires.length).toBe(1);
  });
});

describe('params', () => {
  it('parses engineering input and formats display', () => {
    expect(parseParam('freq', '2.44G')).toBeCloseTo(2.44e9);
    expect(parseParam('fc', '20 MHz')).toBeCloseTo(20e6);
    expect(parseParam('gain', '-3dB')).toBe(-3);
    expect(parseParam('oip3', '30 dBm')).toBe(30);
    expect(parseParam('vendor', 'Qorvo')).toBe('Qorvo');
    expect(formatParam('freq', 2.44e9)).toBe('2.44 GHz');
    expect(formatParam('gain', 18)).toBe('G = 18 dB');
    expect(formatParam('fs', 61.44e6)).toBe('fs = 61.4 MS/s');
  });
});

describe('serialize', () => {
  it('orders blocks by signal flow', () => {
    const doc = load('examples/zero-if-rx.sig.json').doc!;
    doc.blocks.reverse();
    doc.blocks.forEach((b) => { b.x = 1; b.y = 2; });
    const s = JSON.parse(serialize(doc));
    const order = s.blocks.map((b: { id: string }) => b.id);
    expect(order.indexOf('ant')).toBeLessThan(order.indexOf('bpf1'));
    expect(order.indexOf('lna')).toBeLessThan(order.indexOf('dmd'));
    expect(order.indexOf('dmd')).toBeLessThan(order.indexOf('lpf'));
  });
});

describe('bits', () => {
  it('formats and parses bit counts', () => {
    expect(formatParam('bits', 14)).toBe('14-bit');
    expect(parseParam('bits', '14-bit')).toBe(14);
    expect(parseParam('bits', '12')).toBe(12);
  });
});

describe('domains', () => {
  it('legacy rf/if/bb load as the signal domain without schema warnings', () => {
    const r = parseDoc(JSON.stringify({
      lineup: '0.1',
      blocks: [{ id: 'c', type: 'custom', ports: [{ name: 'o', side: 'r', dir: 'out', domain: 'bb' }] }, { id: 'a', type: 'amp' }],
      connections: [{ from: 'c.o', to: 'a.in', domain: 'if' }],
    }));
    expect(r.warnings).toEqual([]);
    expect(r.doc!.blocks[0].ports![0].domain).toBe('signal');
    expect(r.doc!.connections[0].domain).toBe('signal');
    expect(expand(r.doc!).wires[0].domain).toBe('signal');
  });
});

describe('custom blocks and I/Q', () => {
  it('an I/Q pair can be packed into a custom block port, and unpacked out of one', () => {
    const doc: LineupDoc = {
      lineup: '0.1',
      blocks: [
        { id: 'd', type: 'iq_demod' }, { id: 'a', type: 'adc' },
        { id: 'ssi', type: 'custom', label: 'SSI', ports: [{ name: 'in', side: 'l', dir: 'in', domain: 'digital' }, { name: 'out', side: 'r', dir: 'out', domain: 'digital' }] },
        { id: 'des', type: 'custom', label: 'DES', ports: [{ name: 'in', side: 'l', dir: 'in', domain: 'digital' }, { name: 'out', side: 'r', dir: 'out', domain: 'digital' }] },
        { id: 'dac', type: 'dac' }, { id: 'm', type: 'iq_mod' },
      ],
      connections: [
        { from: 'd.i', to: 'a.in' }, { from: 'd.q', to: 'a.in' }, { from: 'a.out', to: 'ssi.in' },
        { from: 'ssi.out', to: 'des.in' },
        { from: 'des.out', to: 'dac.in' }, { from: 'dac.out', to: 'm.i' }, { from: 'dac.out', to: 'm.q' },
      ],
    };
    propagateIQ(doc);
    const by = Object.fromEntries(doc.blocks.map((b) => [b.id, b]));
    expect(by.a.iq).toBe(true);
    expect(by.dac.iq).toBe(true);
    expect(by.ssi.iq).toBeUndefined();
    const ex = expand(doc);
    expect(ex.issues).toEqual([]);
    expect(ex.wires.filter((w) => w.to.block === 'ssi').length).toBe(2);
    expect(ex.wires.filter((w) => w.from.block === 'des').length).toBe(2);
  });
});

describe('block domains', () => {
  it('a DSP-capable block takes its domain; fixed ports keep theirs', () => {
    const doc: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'a', type: 'adc' }, { id: 'f', type: 'lpf', domain: 'digital' }, { id: 'c', type: 'ddc' }, { id: 'g', type: 'amp', domain: 'complex', signal: 'diff' }],
      connections: [{ from: 'a.out', to: 'f.in' }, { from: 'f.out', to: 'c.in' }, { from: 'c.out', to: 'g.in' }],
    };
    const ex = expand(doc);
    expect(ex.issues).toEqual([]);
    expect(ex.wires.map((w) => w.domain)).toEqual(['digital', 'digital', 'complex']);
    expect(ex.byBlock.get('g')![0].ports.every((p) => p.signal === 'se')).toBe(true);
  });

  it('warns on analog ↔ digital and real ↔ complex links', () => {
    const doc: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'x', type: 'amp' }, { id: 'f', type: 'lpf', domain: 'digital' }, { id: 'g', type: 'amp', domain: 'complex' }],
      connections: [{ from: 'x.out', to: 'f.in' }, { from: 'f.out', to: 'g.in' }],
    };
    const msgs = expand(doc).issues.map((i) => `${i.level}: ${i.msg}`);
    expect(msgs).toEqual([
      'warning: x.out → f.in: analog ↔ real digital; add an ADC/DAC, or set the block\'s domain',
      'warning: f.out → g.in: real digital ↔ complex; set both blocks to the same domain',
    ]);
  });

  it('flipV mirrors a block vertically', () => {
    const doc: LineupDoc = { lineup: '0.1', blocks: [{ id: 'm', type: 'mixer', x: 0, y: 0, flipV: true }], connections: [] };
    const lo = expand(doc).byBlock.get('m')![0].ports.find((p) => p.name === 'lo')!;
    expect(lo.p).toEqual([3, 0]);
    expect(lo.n).toEqual([0, -1]);
  });
});
