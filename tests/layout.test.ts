import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseDoc } from '../src/io/schema';
import { layoutDoc } from '../src/layout/elk';
import { expand } from '../src/model/expand';
import { route } from '../src/render/route';
import { propagateIQ } from '../src/model/iq';

describe('layout + routing', () => {
  for (const f of ['examples/zero-if-rx.sig.json', 'examples/iq-tx.sig.json', 'examples/superhet-ddc.sig.json']) {
    it(`${f}: places every block without overlaps and routes every wire`, async () => {
      const doc = parseDoc(fs.readFileSync(f, 'utf8')).doc!;
      propagateIQ(doc);
      await layoutDoc(doc);
      expect(doc.blocks.every((b) => Number.isInteger(b.x) && Number.isInteger(b.y))).toBe(true);
      const ex = expand(doc);
      for (const a of ex.instances)
        for (const b of ex.instances)
          if (a !== b) {
            const ov = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(ov, `${a.id} overlaps ${b.id}`).toBe(false);
          }
      const t0 = performance.now();
      const r = route(ex);
      const ms = performance.now() - t0;
      expect(r.routes.length).toBe(ex.wires.length);
      for (const rt of r.routes) {
        // Orthogonal, and ends on its ports.
        for (let i = 1; i < rt.path.length; i++) expect(rt.path[i][0] === rt.path[i - 1][0] || rt.path[i][1] === rt.path[i - 1][1]).toBe(true);
        expect(rt.path[0]).toEqual(rt.wire.from.p);
        expect(rt.path[rt.path.length - 1]).toEqual(rt.wire.to.p);
      }
      console.log(f, 'route ms', ms.toFixed(1), doc.blocks.map((b) => `${b.id}@${b.x},${b.y}`).join(' '));
    });
  }
});
