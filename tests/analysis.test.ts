import { describe, expect, it } from 'vitest';
import { cascade, stageValues } from '../src/model/cascade';
import { alias, frequencyPlan } from '../src/model/freqplan';
import { expand } from '../src/model/expand';
import { flatten } from '../src/model/sheets';
import type { LineupDoc } from '../src/model/types';

const rx = (): LineupDoc => ({
  lineup: '0.1',
  analysis: { pin: -60, bw: 1e6, fin: 2.44e9 },
  blocks: [
    { id: 'ant', type: 'antenna' },
    { id: 'lna', type: 'amp', params: { gain: 20, nf: 2, iip3: -5 } },
    { id: 'mix', type: 'mixer', params: { gain: -7, nf: 7, iip3: 10 } },
    { id: 'lo', type: 'lo', params: { freq: 2.3e9 } },
    { id: 'ifa', type: 'amp', params: { gain: 20, nf: 5, oip3: 30, p1db: 15 } },
  ],
  connections: [{ from: 'ant.io', to: 'lna.in' }, { from: 'lna.out', to: 'mix.rf' }, { from: 'lo.out', to: 'mix.lo' }, { from: 'mix.if', to: 'ifa.in' }],
});

describe('cascade', () => {
  it('matches hand-worked Friis noise figure, gain and IIP3', () => {
    const c = cascade(rx());
    expect(c.error).toBeUndefined();
    expect(c.stages.map((s) => s.block)).toEqual(['ant', 'lna', 'mix', 'ifa']);
    const t = c.totals!;
    expect(t.gain).toBeCloseTo(33, 6);
    // F = 1.585 + (5.012 − 1)/100 + (3.162 − 1)/(100 · 0.1995) = 1.7335 → 2.389 dB
    expect(t.nf).toBeCloseTo(2.389, 2);
    // 1/IIP3 = 1/0.3162 + 100/10 + 19.95/10 mW⁻¹ → −11.81 dBm
    expect(t.iip3!).toBeCloseTo(-11.81, 1);
    expect(t.oip3!).toBeCloseTo(-11.81 + 33, 1);
    expect(t.op1!).toBeCloseTo(15, 6);
    expect(t.pout).toBeCloseTo(-27, 6);
    expect(t.noiseFloor).toBeCloseTo(-114, 6);
    expect(t.snr!).toBeCloseTo(-60 + 114 - 2.389, 2);
  });

  it('passives use insertion loss as gain and noise figure', () => {
    const v = stageValues(expand({ lineup: '0.1', blocks: [{ id: 'f', type: 'bpf', params: { il: 2.5 } }], connections: [] }).instances[0]);
    expect(v).toMatchObject({ gain: -2.5, nf: 2.5, assumed: [] });
  });

  it('follows the selected branch through a switched bank', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [
        { id: 'in', type: 'port_in' }, { id: 's1', type: 'switch' },
        { id: 'a', type: 'bpf', params: { il: 1 } }, { id: 'b', type: 'bpf', params: { il: 3 } },
        { id: 's2', type: 'switch' }, { id: 'out', type: 'port_out' },
      ],
      connections: [
        { from: 'in.out', to: 's1.c' }, { from: 's1.t1', to: 'a.in' }, { from: 's1.t2', to: 'b.in' },
        { from: 'a.out', to: 's2.t1' }, { from: 'b.out', to: 's2.t2' }, { from: 's2.c', to: 'out.in' },
      ],
    };
    expect(cascade(d, ['b', 'out']).stages.map((s) => s.block)).toEqual(['b', 's2', 'out']);
    expect(cascade(d, ['in', 'b', 'out']).totals!.gain).toBeCloseTo(-3, 6);
    expect(cascade(d, ['a']).stages.map((s) => s.block)).toEqual(['in', 's1', 'a']);
  });

  it('runs through sheets once flattened', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'ant', type: 'antenna' }, { id: 'fe', type: 'sheet', sheet: 'fe' }, { id: 'ifa', type: 'amp', params: { gain: 10, nf: 6 } }],
      connections: [{ from: 'ant.io', to: 'fe.i' }, { from: 'fe.o', to: 'ifa.in' }],
      sheets: { fe: { blocks: [{ id: 'i', type: 'port_in' }, { id: 'lna', type: 'amp', params: { gain: 15, nf: 1 } }, { id: 'o', type: 'port_out' }], connections: [{ from: 'i.out', to: 'lna.in' }, { from: 'lna.out', to: 'o.in' }] } },
    };
    const c = cascade(flatten(d).doc);
    expect(c.stages.map((s) => s.block)).toEqual(['ant', 'fe/lna', 'ifa']);
    expect(c.totals!.gain).toBeCloseTo(25, 6);
  });
});

describe('frequency plan', () => {
  it('carries frequencies through a mixer and flags an unfiltered image', () => {
    const d = rx();
    const p = frequencyPlan(d);
    expect(p.byPort.get('lna.out')).toBe(2.44e9);
    expect(p.byPort.get('mix.if')).toBeCloseTo(140e6, 0);
    expect(p.issues.map((i) => i.msg)).toEqual(['mix: image at 2.16 GHz has no filter in front of it (IF 140 MHz)']);
  });

  it('an image-reject BPF before the mixer clears the warning; an out-of-band signal is flagged', () => {
    const d = rx();
    d.blocks.splice(1, 0, { id: 'pre', type: 'bpf', params: { fc: 2.44e9, bw: 100e6 } });
    d.connections[0] = { from: 'ant.io', to: 'pre.in' };
    d.connections.push({ from: 'pre.out', to: 'lna.in' });
    expect(frequencyPlan(d).issues).toEqual([]);
    d.analysis!.fin = 2.6e9;
    expect(frequencyPlan(d).issues.some((i) => i.msg.includes('outside its passband'))).toBe(true);
  });

  it('aliases through an ADC and shifts through a DDC', () => {
    // 140 MHz at 122.88 MS/s: 140 − 122.88 = 17.12 MHz, third Nyquist zone.
    expect(alias(140e6, 122.88e6)).toEqual({ f: expect.closeTo(17.12e6, 0), zone: 3 });
    const d: LineupDoc = {
      lineup: '0.1',
      analysis: { fin: 140e6 },
      blocks: [{ id: 'in', type: 'port_in' }, { id: 'adc', type: 'adc', params: { fs: 122.88e6 } }, { id: 'ddc', type: 'ddc', params: { freq: 15e6 } }, { id: 'out', type: 'port_out', domain: 'complex' }],
      connections: [{ from: 'in.out', to: 'adc.in' }, { from: 'adc.out', to: 'ddc.in' }, { from: 'ddc.out', to: 'out.in' }],
    };
    const p = frequencyPlan(d);
    expect(p.byPort.get('adc.out')).toBeCloseTo(17.12e6, 0);
    expect(p.byPort.get('ddc.out')).toBeCloseTo(2.12e6, 0);
    expect(p.issues[0].msg).toMatch(/Nyquist zone 3/);
  });

  it('multipliers scale the LO chain', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'xo', type: 'lo', params: { freq: 1e9 } }, { id: 'x2', type: 'mult', params: { ratio: 2 } }, { id: 'a', type: 'amp' }],
      connections: [{ from: 'xo.out', to: 'x2.in' }, { from: 'x2.out', to: 'a.in' }],
    };
    expect(frequencyPlan(d).byPort.get('x2.out')).toBe(2e9);
  });
});
