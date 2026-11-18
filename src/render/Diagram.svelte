<script lang="ts" module>
  import type { Pt } from '../model/geometry';
  import { G } from '../model/types';

  export const px = (v: number) => Math.round(v * G * 100) / 100;
  export const pts = (line: Pt[]) => line.map((p) => `${px(p[0])},${px(p[1])}`).join(' ');

  /** Longest segment of a path, preferring horizontal ones (for labels and bus marks). */
  export function longestSegment(path: Pt[]): { a: Pt; b: Pt; horiz: boolean } | null {
    let best: { a: Pt; b: Pt; horiz: boolean; len: number } | null = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const horiz = a[1] === b[1];
      const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + (horiz ? 2 : 0);
      if (!best || len > best.len) best = { a, b, horiz, len };
    }
    return best;
  }
</script>

<script lang="ts">
  // The drawn diagram: everything inside this group is what gets exported.
  import type { Expanded, Instance } from '../model/expand';
  import type { RouteResult } from './route';
  import { apply, svgMatrix } from '../model/geometry';
  import type { LineupDoc } from '../model/types';
  import type { Theme } from './theme';
  import SymbolBody from './SymbolBody.svelte';
  import { fillTemplate } from '../model/symbols';
  import { linePaths } from './hops';
  import { groupBoxes, noteBoxes } from './annot';

  let { ex, routed, doc, theme }: { ex: Expanded; routed: RouteResult; doc: LineupDoc; theme: Theme } = $props();

  const paths = $derived(linePaths(routed.routes, doc.style?.hops !== false));
  const pm = $derived(!!doc.style?.pmMarks);

  /** + / − label positions at a differential pin pair. */
  function pmAt(p: { p: Pt; n: Pt }): { plus: Pt; minus: Pt } {
    const horiz = Math.abs(p.n[0]) > 0.5;
    const out: Pt = [p.p[0] + p.n[0] * 0.9, p.p[1] + p.n[1] * 0.9];
    return horiz
      ? { plus: [out[0], out[1] - 1.15], minus: [out[0], out[1] + 1.15] }
      : { plus: [out[0] - 1.15, out[1]], minus: [out[0] + 1.15, out[1]] };
  }

  const connected = $derived(new Set(ex.wires.flatMap((w) => [w.from.key, w.to.key])));

  function leads(inst: Instance) {
    const out: { a: Pt; b: Pt; w: number }[] = [];
    for (const p of inst.ports) {
      if (p.def.optional && !connected.has(p.key)) continue;
      const end: Pt = [p.p[0] - p.n[0] * p.lead, p.p[1] - p.n[1] * p.lead];
      const w = p.domain === 'digital' ? theme.domains.digital.width : theme.body;
      if (p.signal === 'diff') {
        const u: Pt = Math.abs(p.n[0]) > 0.5 ? [0, 0.5] : [0.5, 0];
        out.push({ a: [p.p[0] - u[0], p.p[1] - u[1]], b: [end[0] - u[0], end[1] - u[1]], w });
        out.push({ a: [p.p[0] + u[0], p.p[1] + u[1]], b: [end[0] + u[0], end[1] + u[1]], w });
      } else out.push({ a: p.p, b: end, w });
    }
    return out;
  }

  const groups = $derived(groupBoxes(doc, ex));
  const notes = $derived(noteBoxes(doc, ex));
</script>

<g font-family={theme.font} fill={theme.stroke}>
  {#each groups as gr}
    <rect x={px(gr.x0)} y={px(gr.y0)} width={px(gr.x1 - gr.x0)} height={px(gr.y1 - gr.y0)} fill="none" stroke={theme.stroke} stroke-width="1" stroke-dasharray="5 3" />
    {#if gr.label}<text x={px(gr.x0 + 0.6)} y={px(gr.y0 + 1.3)} font-size="11">{gr.label}</text>{/if}
  {/each}

  {#each routed.routes as r, ri}
    {@const st = theme.domains[r.wire.domain]}
    {#each paths[ri] as d}
      <path {d} fill="none" stroke={theme.colors?.[r.wire.domain] ?? theme.stroke} stroke-width={st.width} stroke-dasharray={st.dash} stroke-linejoin="miter" stroke-linecap="butt" />
    {/each}
    {#if pm && r.wire.signal === 'diff'}
      {#each [r.wire.from, r.wire.to] as end}
        {@const m = pmAt(end)}
        <text x={px(m.plus[0])} y={px(m.plus[1])} font-size="9" text-anchor="middle" dominant-baseline="central">+</text>
        <text x={px(m.minus[0])} y={px(m.minus[1])} font-size="9" text-anchor="middle" dominant-baseline="central">−</text>
      {/each}
    {/if}
    {@const seg = longestSegment(r.path)}
    {#if seg && r.wire.domain === 'digital' && r.wire.width}
      {@const m = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2]}
      {#if seg.horiz}
        <line x1={px(m[0]) - 3} y1={px(m[1]) + 5} x2={px(m[0]) + 3} y2={px(m[1]) - 5} stroke={theme.stroke} stroke-width="1" />
        <text x={px(m[0]) + 2} y={px(m[1]) + 13} font-size="9" text-anchor="middle">{r.wire.width}</text>
      {:else}
        <line x1={px(m[0]) - 5} y1={px(m[1]) + 3} x2={px(m[0]) + 5} y2={px(m[1]) - 3} stroke={theme.stroke} stroke-width="1" />
        <text x={px(m[0]) + 6} y={px(m[1]) + 3} font-size="9">{r.wire.width}</text>
      {/if}
    {/if}
    {#if seg && r.wire.label}
      {@const m = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2]}
      {#if seg.horiz}
        <text x={px(m[0])} y={px(m[1]) - (r.wire.signal === 'diff' ? 9 : 5)} font-size="10" font-style="italic" text-anchor="middle">{r.wire.label}</text>
      {:else}
        <text x={px(m[0]) + 6} y={px(m[1])} font-size="10" font-style="italic" dominant-baseline="central">{r.wire.label}</text>
      {/if}
    {/if}
    {#if r.wire.railMark}
      {@const p = r.wire.from.p}
      <text x={px(p[0] + r.wire.from.n[0] * 1.1)} y={px(p[1]) - (r.wire.signal === 'diff' ? 8 : 4)} font-size="10" text-anchor="middle">{r.wire.railMark}</text>
    {/if}
  {/each}
  {#each routed.dots as d}
    <circle cx={px(d[0])} cy={px(d[1])} r="2.5" fill={theme.stroke} />
  {/each}

  {#each ex.instances as inst (inst.id)}
    {#each leads(inst) as l}
      <line x1={px(l.a[0])} y1={px(l.a[1])} x2={px(l.b[0])} y2={px(l.b[1])} stroke={theme.stroke} stroke-width={l.w} />
    {/each}
    <g transform={`scale(${G}) ${svgMatrix(inst.m)}`}>
      <SymbolBody def={inst.def} {theme} />
    </g>
    {#each inst.def.texts ?? [] as t}
      {@const p = apply(inst.m, t.at)}
      <text x={px(p[0])} y={px(p[1])} font-size={(t.size ?? 1) * G} text-anchor={t.anchor ?? 'middle'} dominant-baseline="central" font-style={t.italic ? 'italic' : undefined}>{fillTemplate(t.text, inst.params)}</text>
    {/each}
    {#if inst.innerLabel}
      <text x={px(inst.x + inst.w / 2)} y={px(inst.y + inst.h / 2)} font-size="12" text-anchor="middle" dominant-baseline="central">{inst.innerLabel}</text>
    {/if}
    {#each inst.labelLines as line, k}
      <text x={px(inst.x + inst.w / 2)} y={px(inst.y + inst.h + 1.2 + k * 1.3)} font-size={k === 0 && inst.titled ? 12 : 10} text-anchor="middle" dominant-baseline="central">{line}</text>
    {/each}
  {/each}

  {#each notes as n}
    <text x={px(n.x)} y={px(n.y)} font-size="10" text-anchor={n.anchor} font-style="italic">
      {#each n.text.split('\n') as line, k}<tspan x={px(n.x)} dy={k ? 13 : 0}>{line}</tspan>{/each}
    </text>
  {/each}
</g>
