import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDoc } from '../src/io/schema';
import { propagateIQ } from '../src/model/iq';
import { expand } from '../src/model/expand';

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
  propagateIQ(r.doc);
  return [...r.warnings, ...expand(r.doc).issues.filter((i) => i.level === 'error').map((i) => i.msg)];
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
