import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDoc } from '../src/io/schema';
import { propagateIQ } from '../src/model/iq';
import { expand } from '../src/model/expand';
import { flatten } from '../src/model/sheets';

const py = ['python3', 'python'].find((c) => spawnSync(c, ['--version']).status === 0);
const CHECK = 'skills/sig-diagrams/scripts/check.py';

function runCheck(doc: unknown): { code: number; out: string } {
  const f = path.join(os.tmpdir(), `sig-${Math.random().toString(36).slice(2)}.sig.json`);
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = spawnSync(py!, [CHECK, f], { encoding: 'utf8' });
  fs.unlinkSync(f);
  return { code: r.status ?? -1, out: r.stdout + r.stderr };
}

function appErrors(doc: unknown): string[] {
  const r = parseDoc(JSON.stringify(doc));
  if (!r.doc) return [r.error!];
  // Every page (top level and each sheet) is checked on its own, plus sheet loops across pages.
  const pages = [r.doc, ...Object.values(r.doc.sheets ?? {}).map((sh) => ({ ...r.doc!, ...sh }))];
  const errs = pages.flatMap((pg) => {
    propagateIQ(pg);
    return expand(pg).issues.filter((i) => i.level === 'error').map((i) => i.msg);
  });
  return [...r.warnings, ...errs, ...flatten(r.doc).issues.filter((m) => m.includes('contains itself'))];
}

describe('agent skill', () => {
  it('is in sync with the docs, schema and symbols', () => {
    const r = spawnSync('node', ['scripts/sync-skill.mjs', '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });

  it('SKILL.md has the frontmatter agents need', () => {
    const md = fs.readFileSync('skills/sig-diagrams/SKILL.md', 'utf8');
    expect(md).toMatch(/^---\nname: sig-diagrams\ndescription: .{40,200}\n---\n/); // claude.ai caps descriptions at 200 characters
  });

  it.skipIf(!py)('check.py passes the examples', () => {
    for (const f of fs.readdirSync('examples')) {
      const r = spawnSync(py!, [CHECK, path.join('examples', f)], { encoding: 'utf8' });
      expect(r.status, r.stdout).toBe(0);
    }
  });

  const base = { lineup: '0.1' };
  const cases: [string, unknown][] = [
    ['clean chain with aliases', { ...base, blocks: [{ id: 'a', type: 'lna' }, { id: 'f', type: 'saw' }, { id: 'm', type: 'mixer' }, { id: 'v', type: 'vco' }], connections: [{ from: 'a.out', to: 'f.in' }, { from: 'f.out', to: 'm.rf' }, { from: 'v.out', to: 'm.lo' }] }],
    ['I/Q split and merge', { ...base, blocks: [{ id: 'd', type: 'iq_demod' }, { id: 'l', type: 'lpf' }, { id: 'g', type: 'amp' }, { id: 'm', type: 'iq_mod' }], connections: [{ from: 'd.i', to: 'l.in' }, { from: 'd.q', to: 'l.in' }, { from: 'l.out', to: 'g.in' }, { from: 'g.out', to: 'm.i' }, { from: 'g.out', to: 'm.q' }] }],
    ['missing port', { ...base, blocks: [{ id: 'a', type: 'amp' }, { id: 'b', type: 'amp' }], connections: [{ from: 'a.out', to: 'b.rf' }] }],
    ['output to output', { ...base, blocks: [{ id: 'a', type: 'amp' }, { id: 'b', type: 'amp' }], connections: [{ from: 'a.out', to: 'b.out' }] }],
    ['two drivers', { ...base, blocks: [{ id: 'a', type: 'amp' }, { id: 'b', type: 'amp' }, { id: 'c', type: 'amp' }], connections: [{ from: 'a.out', to: 'c.in' }, { from: 'b.out', to: 'c.in' }] }],
    ['single path into a pair', { ...base, blocks: [{ id: 'a', type: 'amp' }, { id: 'l', type: 'lpf', iq: true }], connections: [{ from: 'a.out', to: 'l.in' }] }],
    ['pair into a single block', { ...base, blocks: [{ id: 'l', type: 'lpf', iq: true }, { id: 'a', type: 'amp' }], connections: [{ from: 'l.out', to: 'a.in' }] }],
    ['unknown block', { ...base, blocks: [{ id: 'a', type: 'amp' }], connections: [{ from: 'a.out', to: 'zz.in' }] }],
    ['string in a reserved param', { ...base, blocks: [{ id: 'a', type: 'amp', params: { gain: '18 dB' } }], connections: [] }],
  ];
  for (const [name, doc] of cases) {
    it.skipIf(!py)(`check.py agrees with the app: ${name}`, () => {
      const app = appErrors(doc);
      const r = runCheck(doc);
      expect(r.code === 0, `app: ${app.join('; ')}\ncheck.py: ${r.out}`).toBe(app.length === 0);
    });
  }
});

describe('agent skill: newer rules', () => {
  const base = { lineup: '0.1' };
  const cases: [string, unknown][] = [
    ['switch throws from params and aliases', { ...base, blocks: [{ id: 's', type: 'sp4t' }, { id: 'f', type: 'bpf' }, { id: 't', type: 'switch', params: { throws: 3 } }], connections: [{ from: 's.t4', to: 'f.in' }, { from: 'f.out', to: 't.t3' }] }],
    ['switch port beyond its throws', { ...base, blocks: [{ id: 's', type: 'switch' }, { id: 'f', type: 'bpf' }], connections: [{ from: 's.t3', to: 'f.in' }] }],
    ['I/Q packed into a custom block', { ...base, blocks: [{ id: 'd', type: 'iq_demod' }, { id: 'a', type: 'adc' }, { id: 'k', type: 'custom', label: 'SSI' }], connections: [{ from: 'd.i', to: 'a.in' }, { from: 'd.q', to: 'a.in' }, { from: 'a.out', to: 'k.in' }] }],
    ['complex DSP chain', { ...base, blocks: [{ id: 'a', type: 'adc' }, { id: 'c', type: 'ddc' }, { id: 'f', type: 'lpf', domain: 'complex' }, { id: 'n', type: 'node', domain: 'complex' }, { id: 'x', type: 'decim', domain: 'complex' }], connections: [{ from: 'a.out', to: 'c.in' }, { from: 'c.out', to: 'f.in' }, { from: 'f.out', to: 'n.in' }, { from: 'n.o1', to: 'x.in' }] }],
  ];
  for (const [name, doc] of cases) {
    it.skipIf(!py)(`check.py agrees with the app: ${name}`, () => {
      const app = appErrors(doc);
      const r = runCheck(doc);
      expect(r.code === 0, `app: ${app.join('; ')}\ncheck.py: ${r.out}`).toBe(app.length === 0);
    });
  }

  const sheet = (inner: object[] = [], conns: object[] = []) => ({
    blocks: [{ id: 'i', type: 'port_in' }, { id: 'g', type: 'amp' }, { id: 'o', type: 'port_out' }, ...inner],
    connections: [{ from: 'i.out', to: 'g.in' }, { from: 'g.out', to: 'o.in' }, ...conns],
  });
  const sheetCases: [string, unknown][] = [
    ['sheet block with ports from its sheet', { ...base, blocks: [{ id: 'a', type: 'antenna' }, { id: 's', type: 'sheet', sheet: 'fe' }, { id: 'm', type: 'mixer' }], connections: [{ from: 'a.io', to: 's.i' }, { from: 's.o', to: 'm.rf' }], sheets: { fe: sheet() } }],
    ['missing sheet', { ...base, blocks: [{ id: 's', type: 'sheet', sheet: 'nope' }], connections: [] }],
    ['bad port on a sheet block', { ...base, blocks: [{ id: 'a', type: 'amp' }, { id: 's', type: 'sheet', sheet: 'fe' }], connections: [{ from: 'a.out', to: 's.zz' }], sheets: { fe: sheet() } }],
    ['error inside a sheet', { ...base, blocks: [{ id: 's', type: 'sheet', sheet: 'fe' }], connections: [], sheets: { fe: sheet([{ id: 'b', type: 'amp' }], [{ from: 'b.out', to: 'g.in' }]) } }],
    ['sheet that contains itself', { ...base, blocks: [{ id: 's', type: 'sheet', sheet: 'fe' }], connections: [], sheets: { fe: sheet([{ id: 'x', type: 'sheet', sheet: 'fe' }]) } }],
    ['I/Q pair through a sheet', { ...base, blocks: [{ id: 'd', type: 'iq_demod' }, { id: 's', type: 'sheet', sheet: 'fe' }], connections: [{ from: 'd.i', to: 's.i' }, { from: 'd.q', to: 's.i' }], sheets: { fe: sheet() } }],
  ];
  for (const [name, doc] of sheetCases) {
    it.skipIf(!py)(`check.py agrees with the app: ${name}`, () => {
      const app = appErrors(doc);
      const r = runCheck(doc);
      expect(r.code === 0, `app: ${app.join('; ')}\ncheck.py: ${r.out}`).toBe(app.length === 0);
    });
  }

  it.skipIf(!py)('check.py warns about domain mismatches like the app', () => {
    const r = runCheck({ ...base, blocks: [{ id: 'x', type: 'amp' }, { id: 'f', type: 'lpf', domain: 'digital' }], connections: [{ from: 'x.out', to: 'f.in' }] });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/analog ↔ real digital/);
  });
});
