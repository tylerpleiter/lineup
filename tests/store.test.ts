import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/io/autosave', () => ({ saveAutosave: async () => {}, loadAutosave: async () => null }));
globalThis.requestAnimationFrame ??= ((f: FrameRequestCallback) => setTimeout(() => f(0), 0)) as typeof requestAnimationFrame;

const { editor } = await import('../src/editor/store.svelte');

const doc = {
  lineup: '0.1',
  blocks: [
    { id: 'dmd', type: 'iq_demod', x: 0, y: 0 },
    { id: 'dec', type: 'decim', domain: 'digital', x: 20, y: 0 },
    { id: 'ssi', type: 'custom', label: 'SSI', x: 40, y: 0, ports: [{ name: 'in', side: 'l', dir: 'in', domain: 'digital' }, { name: 'out', side: 'r', dir: 'out', domain: 'digital' }] },
  ],
  connections: [{ from: 'dmd.i', to: 'dec.in' }, { from: 'dmd.q', to: 'dec.in' }],
};

describe('editor: connecting an I/Q pair to a custom block', () => {
  it('a drag from either rail packs the whole pair into the custom port', async () => {
    await editor.loadText(JSON.stringify(doc), { quiet: true });
    expect(editor.connect('dec:q.out', 'ssi.in')).toBeNull();
    expect(editor.cur.connections.at(-1)).toMatchObject({ from: 'dec.out', to: 'ssi.in' });
    expect(editor.expanded.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(editor.expanded.wires.filter((w) => w.to.block === 'ssi').map((w) => w.from.inst).sort()).toEqual(['dec:i', 'dec:q']);
  });

  it('upgrades an earlier one-rail link, and Alt keeps a single rail', async () => {
    await editor.loadText(JSON.stringify({ ...doc, connections: [...doc.connections, { from: 'dec:i.out', to: 'ssi.in' }] }), { quiet: true });
    expect(editor.connect('dec:q.out', 'ssi.in')).toBeNull();
    expect(editor.cur.connections.filter((c) => c.to === 'ssi.in')).toEqual([{ from: 'dec.out', to: 'ssi.in' }]);

    await editor.loadText(JSON.stringify(doc), { quiet: true });
    expect(editor.connect('dec:i.out', 'ssi.in', { oneRail: true })).toBeNull();
    expect(editor.cur.connections.at(-1)).toMatchObject({ from: 'dec:i.out', to: 'ssi.in' });
  });
});
