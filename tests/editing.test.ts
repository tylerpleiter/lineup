import { describe, expect, it } from 'vitest';
import { spliceBlock, inlinePorts } from '../src/model/splice';
import { moveSegment, nearestSegment } from '../src/editor/waypoints';
import { expand } from '../src/model/expand';
import { route, orthogonalize } from '../src/render/route';
import { linePaths } from '../src/render/hops';
import type { LineupDoc } from '../src/model/types';
import type { Pt } from '../src/model/geometry';

const errors = (d: LineupDoc) => expand(d).issues.filter((i) => i.level === 'error');

describe('splice', () => {
  it('inserts a block into a plain connection', () => {
    const d: LineupDoc = { lineup: '0.1', blocks: [{ id: 'a', type: 'amp' }, { id: 'b', type: 'mixer' }, { id: 'f', type: 'bpf' }], connections: [{ from: 'a.out', to: 'b.rf', label: 'x' }] };
    expect(spliceBlock(d, 'f', 0)).toBe(true);
    expect(d.connections).toEqual([{ from: 'a.out', to: 'f.in', label: 'x' }, { from: 'f.out', to: 'b.rf' }]);
  });

  it('splices both rails after a split block and makes the block a pair', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'd', type: 'iq_demod' }, { id: 'l', type: 'lpf', iq: true }, { id: 'v', type: 'amp' }],
      connections: [{ from: 'd.i', to: 'l.in' }, { from: 'd.q', to: 'l.in' }],
    };
    expect(spliceBlock(d, 'v', 1)).toBe(true);
    expect(d.blocks.find((b) => b.id === 'v')!.iq).toBe(true);
    expect(d.connections.map((c) => `${c.from}>${c.to}`).sort()).toEqual(['d.i>v.in', 'd.q>v.in', 'v.out>l.in']);
    expect(errors(d)).toEqual([]);
  });

  it('splices before a merge block', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'g', type: 'amp', iq: true }, { id: 'm', type: 'iq_mod' }, { id: 'f', type: 'lpf' }],
      connections: [{ from: 'g.out', to: 'm.i' }, { from: 'g.out', to: 'm.q' }],
    };
    expect(spliceBlock(d, 'f', 0)).toBe(true);
    expect(d.connections.map((c) => `${c.from}>${c.to}`).sort()).toEqual(['f.out>m.i', 'f.out>m.q', 'g.out>f.in']);
    expect(errors(d)).toEqual([]);
  });

  it('refuses multi-port and already-connected blocks', () => {
    const d: LineupDoc = { lineup: '0.1', blocks: [{ id: 'a', type: 'amp' }, { id: 'b', type: 'amp' }, { id: 'm', type: 'iq_demod' }], connections: [{ from: 'a.out', to: 'b.in' }] };
    expect(inlinePorts(d, 'm')).toBeNull();
    expect(spliceBlock(d, 'm', 0)).toBe(false);
    expect(spliceBlock(d, 'a', 0)).toBe(false);
  });
});

describe('waypoints', () => {
  it('moving the middle segment of a Z-route writes via and the router follows it', () => {
    const d: LineupDoc = { lineup: '0.1', blocks: [{ id: 'a', type: 'amp', x: 0, y: 0 }, { id: 'b', type: 'amp', x: 20, y: 10 }], connections: [{ from: 'a.out', to: 'b.in' }] };
    const r = route(expand(d)).routes[0];
    const vertical = r.path.findIndex((p, i) => i > 0 && p[0] === r.path[i - 1][0]) - 1;
    const via = moveSegment(r.path, vertical, 3, r.wire.from.n, r.wire.to.n);
    d.connections[0].via = via;
    const r2 = route(expand(d)).routes[0];
    expect(r2.path[0]).toEqual([6, 3]);
    expect(r2.path[r2.path.length - 1]).toEqual([20, 13]);
    const xs = r2.path.filter((p, i) => i > 0 && p[0] === r2.path[i - 1][0]).map((p) => p[0]);
    expect(xs).toContain(r.path[vertical][0] + 3);
  });

  it('moving the first segment keeps a stub out of the port', () => {
    const path: Pt[] = [[6, 3], [20, 3]];
    const via = moveSegment(path, 0, 4, [1, 0], [-1, 0]);
    const full = orthogonalize([[6, 3], [7, 3], ...via, [19, 3], [20, 3]]);
    expect(full[1]).toEqual([7, 3]);
    expect(via.some((p) => p[1] === 7)).toBe(true);
    expect(nearestSegment(path, [10, 2])).toBe(0);
  });
});

describe('hops', () => {
  it('adds an arc where a horizontal wire crosses another net', () => {
    const d: LineupDoc = {
      lineup: '0.1',
      blocks: [{ id: 'a', type: 'amp', x: 0, y: 10 }, { id: 'b', type: 'amp', x: 40, y: 10 }, { id: 'c', type: 'amp', x: 14, y: 0, rot: 90 }, { id: 'e', type: 'amp', x: 14, y: 24, rot: 90 }],
      connections: [{ from: 'a.out', to: 'b.in' }, { from: 'c.out', to: 'e.in' }],
    };
    const paths = linePaths(route(expand(d)).routes, true).flat();
    expect(paths.some((p) => p.includes(' A4,4'))).toBe(true);
    expect(linePaths(route(expand(d)).routes, false).flat().some((p) => p.includes(' A'))).toBe(false);
  });
});
