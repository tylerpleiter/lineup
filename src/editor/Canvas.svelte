<script lang="ts">
  import { editor } from './store.svelte';
  import Diagram, { pts, px } from '../render/Diagram.svelte';
  import { themeFor } from '../render/theme';
  import { G } from '../model/types';
  import type { PortInst } from '../model/expand';
  import type { Pt } from '../model/geometry';
  import type { Routed } from '../render/route';
  import { moveSegment, nearestSegment } from './waypoints';
  import QuickAdd from '../ui/QuickAdd.svelte';
  import { groupBoxes, noteBoxes } from '../render/annot';

  let svg: SVGSVGElement;
  let host: HTMLDivElement;

  type Mode =
    | { kind: 'idle' }
    | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number }
    | { kind: 'marquee'; a: Pt; b: Pt }
    | { kind: 'drag'; start: Pt; orig: Map<string, [number, number]>; moved: boolean }
    | { kind: 'note'; index: number; start: Pt; orig: [number, number]; moved: boolean }
    | { kind: 'wire'; from: PortInst; cur: Pt; target: PortInst | null }
    | { kind: 'seg'; ci: number; route: Routed; seg: number; start: Pt; delta: number; began: boolean };

  let mode = $state<Mode>({ kind: 'idle' });
  let hoverInst = $state<string | null>(null);
  let space = $state(false);

  const ex = $derived(editor.expanded);
  const allPorts = $derived(ex.instances.flatMap((i) => i.ports));
  const selected = $derived(new Set(editor.sel.blocks));

  /** Screen → world px. */
  function world(e: { clientX: number; clientY: number }): Pt {
    const r = svg.getBoundingClientRect();
    const { tx, ty, k } = editor.view;
    return [(e.clientX - r.left - tx) / k, (e.clientY - r.top - ty) / k];
  }

  function compat(a: PortInst, b: PortInst): 'ok' | 'warn' | 'bad' {
    if (a.block === b.block) return 'bad';
    if (a.dir === b.dir && a.dir !== 'bi') return 'bad';
    if (a.signal !== b.signal) return 'warn';
    if (a.domain === 'digital' && b.domain === 'digital' && a.width && b.width && a.width !== b.width) return 'warn';
    return 'ok';
  }

  function nearestPort(p: Pt, from: PortInst): PortInst | null {
    let best: PortInst | null = null;
    let bd = (12 / editor.view.k) ** 2;
    for (const q of allPorts) {
      if (q.key === from.key) continue;
      const dx = q.p[0] * G - p[0];
      const dy = q.p[1] * G - p[1];
      const d = dx * dx + dy * dy;
      if (d < bd && compat(from, q) !== 'bad') {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  function onDown(e: PointerEvent) {
    if (e.button === 2) return;
    host.focus();
    const t = e.target as Element;
    const portEl = t.closest('[data-port]');
    const instEl = t.closest('[data-inst]');
    const connEl = t.closest('[data-conn]');
    const groupEl = t.closest('[data-group]');
    const noteEl = t.closest('[data-note]');
    svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || space) {
      mode = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: editor.view.tx, ty: editor.view.ty };
      return;
    }
    if (portEl) {
      const from = allPorts.find((p) => p.key === portEl.getAttribute('data-port'));
      if (from) {
        mode = { kind: 'wire', from, cur: world(e), target: null };
        return;
      }
    }
    if (instEl) {
      const id = instEl.getAttribute('data-inst')!;
      if (e.shiftKey) {
        const s = new Set(editor.sel.blocks);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        editor.sel = { blocks: [...s], conn: null };
      } else if (!selected.has(id)) editor.sel = { blocks: [id], conn: null };
      const orig = new Map<string, [number, number]>();
      for (const b of editor.doc.blocks) if (editor.sel.blocks.includes(b.id)) orig.set(b.id, [b.x ?? 0, b.y ?? 0]);
      editor.beginDirect();
      mode = { kind: 'drag', start: world(e), orig, moved: false };
      return;
    }
    if (noteEl) {
      const index = Number(noteEl.getAttribute('data-note'));
      const nb = noteBoxes(editor.doc, ex)[index];
      editor.sel = { blocks: [], conn: null, note: index };
      editor.beginDirect();
      mode = { kind: 'note', index, start: world(e), orig: [nb.x, nb.y], moved: false };
      return;
    }
    if (groupEl) {
      // Grabbing a group's frame selects it and drags its members together.
      const id = groupEl.getAttribute('data-group')!;
      const g = editor.doc.groups?.find((x) => x.id === id);
      editor.sel = { blocks: [], conn: null, group: id };
      const orig = new Map<string, [number, number]>();
      for (const b of editor.doc.blocks) if (g?.members.includes(b.id)) orig.set(b.id, [b.x ?? 0, b.y ?? 0]);
      editor.beginDirect();
      mode = { kind: 'drag', start: world(e), orig, moved: false };
      return;
    }
    if (connEl) {
      const ci = Number(connEl.getAttribute('data-conn'));
      editor.sel = { blocks: [], conn: ci };
      const route = editor.routed.routes.find((r) => r.wire.id === connEl.getAttribute('data-wire'));
      if (route) {
        const p = world(e);
        const g: Pt = [p[0] / G, p[1] / G];
        mode = { kind: 'seg', ci, route, seg: nearestSegment(route.path, g), start: g, delta: 0, began: false };
      }
      return;
    }
    const p = world(e);
    mode = { kind: 'marquee', a: p, b: p };
  }

  function onMove(e: PointerEvent) {
    const r = svg.getBoundingClientRect();
    const wp = world(e);
    editor.pointer = { x: wp[0] / G, y: wp[1] / G, sx: e.clientX - r.left, sy: e.clientY - r.top };
    const m = mode;
    if (m.kind === 'pan') {
      editor.view = { ...editor.view, tx: m.tx + e.clientX - m.sx, ty: m.ty + e.clientY - m.sy };
    } else if (m.kind === 'drag') {
      const p = world(e);
      const du = Math.round((p[0] - m.start[0]) / G);
      const dv = Math.round((p[1] - m.start[1]) / G);
      for (const b of editor.doc.blocks) {
        const o = m.orig.get(b.id);
        if (!o) continue;
        if (b.x !== o[0] + du) b.x = o[0] + du;
        if (b.y !== o[1] + dv) b.y = o[1] + dv;
      }
      if (du || dv) m.moved = true;
    } else if (m.kind === 'note') {
      const p = world(e);
      const du = Math.round((p[0] - m.start[0]) / G);
      const dv = Math.round((p[1] - m.start[1]) / G);
      const n = editor.doc.notes?.[m.index];
      if (n && (du || dv || m.moved)) {
        // Dragging a note attached to a block detaches it to a fixed position.
        delete n.near;
        n.x = Math.round(m.orig[0] + du);
        n.y = Math.round(m.orig[1] + dv);
        m.moved = true;
      }
    } else if (m.kind === 'marquee') {
      mode = { ...m, b: world(e) };
    } else if (m.kind === 'wire') {
      const cur = world(e);
      mode = { ...m, cur, target: nearestPort(cur, m.from) };
    } else if (m.kind === 'seg') {
      const p = world(e);
      const a = m.route.path[m.seg];
      const b = m.route.path[m.seg + 1];
      const horiz = a[1] === b[1];
      const delta = Math.round((horiz ? p[1] / G - m.start[1] : p[0] / G - m.start[0]));
      if (delta === m.delta) return;
      if (!m.began) editor.beginDirect();
      m.began = true;
      m.delta = delta;
      const w = m.route.wire;
      let via = moveSegment(m.route.path, m.seg, delta, w.from.n, w.to.n);
      // The Q wire of a pair→pair link follows the I wire's waypoints a rail pitch lower.
      if (w.rail === 'q' && w.from.rail === 'q' && w.to.rail === 'q') via = via.map(([x, y]) => [x, y - 6] as [number, number]);
      editor.setVia(m.ci, via);
    }
  }

  function onUp(e: PointerEvent) {
    const m = mode;
    mode = { kind: 'idle' };
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if (m.kind === 'note') editor.endDirect();
    else if (m.kind === 'drag') {
      editor.endDirect();
      if (m.moved && m.orig.size === 1 && !editor.sel.group) editor.trySplice([...m.orig.keys()][0]);
    } else if (m.kind === 'seg') {
      if (m.began) editor.endDirect();
    }
    else if (m.kind === 'marquee') {
      const x0 = Math.min(m.a[0], m.b[0]) / G;
      const x1 = Math.max(m.a[0], m.b[0]) / G;
      const y0 = Math.min(m.a[1], m.b[1]) / G;
      const y1 = Math.max(m.a[1], m.b[1]) / G;
      if ((x1 - x0) * G * editor.view.k < 4 && (y1 - y0) * G * editor.view.k < 4) {
        editor.sel = { blocks: [], conn: null };
        return;
      }
      const hit = new Set<string>(e.shiftKey ? editor.sel.blocks : []);
      for (const i of ex.instances) if (i.x < x1 && i.x + i.w > x0 && i.y < y1 && i.y + i.h > y0) hit.add(i.block.id);
      editor.sel = { blocks: [...hit], conn: null };
    } else if (m.kind === 'wire' && m.target) {
      const err = editor.connect(m.from.key, m.target.key);
      if (err) editor.notify(err, 'error');
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    editor.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/x-lineup-symbol')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function onDrop(e: DragEvent) {
    const type = e.dataTransfer?.getData('application/x-lineup-symbol');
    if (!type) return;
    e.preventDefault();
    e.stopPropagation();
    const p = world(e);
    const id = editor.addBlock(type, { x: p[0] / G, y: p[1] / G });
    editor.trySplice(id);
  }

  function onDbl(e: MouseEvent) {
    const connEl = (e.target as Element).closest('[data-conn]');
    if (!connEl) return;
    const ci = Number(connEl.getAttribute('data-conn'));
    if (editor.doc.connections[ci]?.via) {
      editor.updateConn(ci, (c) => delete c.via);
      editor.notify('Wire reset to automatic routing');
    }
  }

  $effect(() => {
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      editor.viewport = { w: r.width, h: r.height };
    });
    ro.observe(host);
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        space = true;
        if (e.target === document.body || host.contains(e.target as Node)) e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') space = false;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  });

  const gboxes = $derived(groupBoxes(editor.doc, ex));
  const nboxes = $derived(noteBoxes(editor.doc, ex));
  const showPortsFor = $derived(new Set([...(hoverInst ? [hoverInst] : []), ...editor.sel.blocks]));
  const issueWires = $derived(editor.routed.routes.filter((r) => r.wire.level));
  const gridSize = $derived(G * editor.view.k);
</script>

<div class="host" bind:this={host} tabindex="-1" role="application" aria-label="Diagram canvas" ondragover={onDragOver} ondrop={onDrop}>
  <svg
    bind:this={svg}
    class:panning={space || mode.kind === 'pan'}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onwheel={onWheel}
    ondblclick={onDbl}
    oncontextmenu={(e) => e.preventDefault()}
    role="presentation"
  >
    <defs>
      <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={editor.view.tx} y={editor.view.ty}>
        <circle cx="0.75" cy="0.75" r={editor.view.k > 0.5 ? 0.75 : 0} fill="#c9ced6" />
      </pattern>
      <pattern id="grid5" width={gridSize * 5} height={gridSize * 5} patternUnits="userSpaceOnUse" x={editor.view.tx} y={editor.view.ty}>
        <circle cx="1" cy="1" r="1" fill="#aeb4bf" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#fff" />
    <rect width="100%" height="100%" fill="url(#grid)" />
    <rect width="100%" height="100%" fill="url(#grid5)" />

    <g transform={`translate(${editor.view.tx},${editor.view.ty}) scale(${editor.view.k})`}>
      <g id="lineup-diagram">
        <Diagram {ex} routed={editor.routed} doc={editor.doc} theme={themeFor(editor.doc.theme)} />
      </g>

      <g class="ui">
        {#each gboxes as gb (gb.id)}
          {@const sel = editor.sel.group === gb.id}
          <rect data-group={gb.id} x={px(gb.x0)} y={px(gb.y0)} width={px(gb.x1 - gb.x0)} height={px(gb.y1 - gb.y0)} fill="none" stroke={sel ? '#2f6feb' : 'transparent'} stroke-width={sel ? 2 / editor.view.k : 8} stroke-opacity={sel ? 0.6 : 1} class="grouphit" pointer-events="stroke" />
          {#if sel}<rect data-group={gb.id} x={px(gb.x0)} y={px(gb.y0)} width={px(gb.x1 - gb.x0)} height={px(gb.y1 - gb.y0)} fill="none" stroke="transparent" stroke-width="8" class="grouphit" pointer-events="stroke" />{/if}
          <rect data-group={gb.id} x={px(gb.x0)} y={px(gb.y0)} width={Math.max(60, (gb.label?.length ?? 0) * 7 + 12)} height="18" fill="transparent" class="grouphit" />
        {/each}
        {#each nboxes as nb (nb.index)}
          <rect data-note={nb.index} x={px(nb.box[0])} y={px(nb.box[1])} width={px(nb.box[2] - nb.box[0])} height={px(nb.box[3] - nb.box[1])} fill="transparent" stroke={editor.sel.note === nb.index ? '#2f6feb' : 'none'} stroke-dasharray="3 2" stroke-width={1 / editor.view.k} class="notehit" />
        {/each}
        {#each issueWires as r}
          {#each r.lines as line}
            <polyline points={pts(line)} fill="none" stroke={r.wire.level === 'error' ? '#e5484d' : '#f5a524'} stroke-opacity="0.45" stroke-width="6" pointer-events="none" />
          {/each}
        {/each}
        {#each editor.routed.routes as r}
          <polyline
            points={pts(r.path)}
            data-conn={r.wire.conn}
            data-wire={r.wire.id}
            fill="none"
            stroke={editor.sel.conn === r.wire.conn ? '#2f6feb' : 'transparent'}
            stroke-opacity={editor.sel.conn === r.wire.conn ? 0.35 : 0}
            stroke-width={r.wire.signal === 'diff' ? 14 : 9}
            class="wirehit"
            class:manual={!!r.wire.via?.length}
          >
            <title>Drag a segment to reroute{r.wire.via?.length ? ' · double-click to reset' : ''}</title>
          </polyline>
        {/each}
        {#each ex.instances as inst (inst.id)}
          <rect
            data-inst={inst.block.id}
            x={px(inst.x)}
            y={px(inst.y)}
            width={px(inst.w)}
            height={px(inst.h)}
            fill="transparent"
            class="blockhit"
            role="presentation"
            onpointerenter={() => (hoverInst = inst.block.id)}
            onpointerleave={() => (hoverInst = hoverInst === inst.block.id ? null : hoverInst)}
          />
          {#if selected.has(inst.block.id)}
            <rect x={px(inst.x) - 3} y={px(inst.y) - 3} width={px(inst.w) + 6} height={px(inst.h) + 6} fill="none" stroke="#2f6feb" stroke-width={1.5 / editor.view.k} stroke-dasharray="4 3" rx="3" pointer-events="none" />
          {/if}
          {#if !ex.byBlock.get(inst.block.id)?.[0].known || ex.issues.some((i) => i.block === inst.block.id && i.level === 'error')}
            <rect x={px(inst.x) - 2} y={px(inst.y) - 2} width={px(inst.w) + 4} height={px(inst.h) + 4} fill="none" stroke="#f5a524" stroke-width="1" pointer-events="none" />
          {/if}
        {/each}
        {#each allPorts as p (p.key)}
          {@const wiring = mode.kind === 'wire'}
          {@const c = wiring && mode.kind === 'wire' ? compat(mode.from, p) : 'ok'}
          {#if wiring || showPortsFor.has(p.block)}
            <circle
              data-port={p.key}
              cx={px(p.p[0])}
              cy={px(p.p[1])}
              r={(mode.kind === 'wire' && mode.target?.key === p.key ? 6 : 4) / Math.max(editor.view.k, 0.6)}
              class="port"
              fill={!wiring ? '#2f6feb' : c === 'ok' ? '#30a46c' : c === 'warn' ? '#f5a524' : '#d0d4da'}
              fill-opacity={wiring && c === 'bad' ? 0.5 : 0.85}
              stroke="#fff"
              stroke-width={1 / editor.view.k}
              role="presentation"
              onpointerenter={() => (hoverInst = p.block)}
            >
              <title>{p.block}{p.rail ? ':' + p.rail : ''}.{p.name} · {p.dir} · {p.signal} · {p.domain}{p.width ? ` /${p.width}` : ''}</title>
            </circle>
          {/if}
        {/each}
        {#if mode.kind === 'wire'}
          {@const a = [px(mode.from.p[0]), px(mode.from.p[1])]}
          {@const b = mode.target ? [px(mode.target.p[0]), px(mode.target.p[1])] : mode.cur}
          {@const mx = (a[0] + b[0]) / 2}
          <polyline points={`${a[0]},${a[1]} ${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`} fill="none" stroke="#2f6feb" stroke-width={1.5 / editor.view.k} stroke-dasharray="5 4" pointer-events="none" />
        {/if}
        {#if mode.kind === 'marquee'}
          <rect
            x={Math.min(mode.a[0], mode.b[0])}
            y={Math.min(mode.a[1], mode.b[1])}
            width={Math.abs(mode.b[0] - mode.a[0])}
            height={Math.abs(mode.b[1] - mode.a[1])}
            fill="#2f6feb"
            fill-opacity="0.06"
            stroke="#2f6feb"
            stroke-width={1 / editor.view.k}
            pointer-events="none"
          />
        {/if}
      </g>
    </g>
  </svg>
  <QuickAdd />
  {#if !ex.instances.length}
    <div class="empty">
      <p>Drag a block from the left, or drop / paste a <code>.sig.json</code> file.</p>
    </div>
  {/if}
</div>

<style>
  .host {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    outline: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
  }
  svg.panning {
    cursor: grab;
  }
  .blockhit {
    cursor: move;
  }
  .wirehit {
    cursor: pointer;
  }
  .wirehit:hover {
    stroke: #2f6feb;
    stroke-opacity: 0.18;
  }
  .port {
    cursor: crosshair;
  }
  .grouphit,
  .notehit {
    cursor: move;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    color: var(--muted);
    font-size: 14px;
  }
  code {
    font-family: var(--mono);
    font-size: 13px;
  }
</style>
