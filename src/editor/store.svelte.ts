// Editor state: the document, selection, view, and undo/redo history.
// Edits work on a plain copy of the document and swap it in, so model code never sees proxies.

import { expand, formatRef, parseRef, type Ref } from '../model/expand';
import { emptyDoc, newBlockId, removeBlocks, renameBlock, serialize } from '../model/doc';
import { normalizeConnections, propagateIQ, relink, unlink } from '../model/iq';
import { route } from '../render/route';
import { symbolFor, SYMBOLS } from '../model/symbols';
import { layoutDoc } from '../layout/elk';
import { parseDoc } from '../io/schema';
import { saveAutosave } from '../io/autosave';
import { G, type Block, type LineupDoc, type Rail } from '../model/types';
import { inlinePorts, spliceBlock, wiresUnder } from '../model/splice';
import { ALIASES, applyAlias, resolveAliases } from '../model/aliases';

export interface Selection {
  blocks: string[];
  conn: number | null;
  group?: string | null;
  note?: number | null;
}

/** Clipboard payload for copied blocks (not a full diagram). */
interface Fragment {
  lineup: string;
  fragment: true;
  blocks: Block[];
  connections: LineupDoc['connections'];
}

const HISTORY = 200;

class Editor {
  doc = $state<LineupDoc>(emptyDoc());
  sel = $state<Selection>({ blocks: [], conn: null });
  /** Which rail edits apply to when an I/Q pair is selected. */
  railEdit = $state<'both' | Rail>('both');
  view = $state({ tx: 40, ty: 40, k: 1 });
  toast = $state<{ text: string; level: 'info' | 'warning' | 'error' } | null>(null);
  loadWarnings = $state<string[]>([]);
  canUndo = $state(false);
  canRedo = $state(false);
  /** Quick-add box: screen position, and whether the pick continues the chain from the selection. */
  quickAdd = $state<{ sx: number; sy: number; world: { x: number; y: number }; chain: string | null } | null>(null);
  /** Last pointer position over the canvas, world grid units. */
  pointer = { x: 0, y: 0, sx: 0, sy: 0 };

  expanded = $derived(expand(this.doc));
  routed = $derived(route(this.expanded));

  private past: string[] = [];
  private future: string[] = [];
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Snapshot taken at the start of a direct (drag) edit. */
  private pending: string | null = null;

  snapshot(): LineupDoc {
    return $state.snapshot(this.doc) as LineupDoc;
  }

  private record(before: string) {
    this.past.push(before);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.canUndo = true;
    this.canRedo = false;
    this.scheduleSave();
  }

  /** Apply an edit to a copy of the document and record it for undo. */
  edit(fn: (d: LineupDoc) => void | boolean): boolean {
    const before = JSON.stringify(this.snapshot());
    const d = JSON.parse(before) as LineupDoc;
    if (fn(d) === false) return false;
    const after = JSON.stringify(d);
    if (after === before) return false;
    this.doc = d;
    this.record(before);
    return true;
  }

  /** Begin a direct edit (dragging): changes go straight to the live doc until endDirect(). */
  beginDirect() {
    this.pending = JSON.stringify(this.snapshot());
  }

  endDirect() {
    if (this.pending === null) return;
    const before = this.pending;
    this.pending = null;
    if (JSON.stringify(this.snapshot()) !== before) this.record(before);
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(JSON.stringify(this.snapshot()));
    this.doc = JSON.parse(prev);
    this.afterHistory();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(JSON.stringify(this.snapshot()));
    this.doc = JSON.parse(next);
    this.afterHistory();
  }

  private afterHistory() {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
    const ids = new Set(this.doc.blocks.map((b) => b.id));
    this.sel = { blocks: this.sel.blocks.filter((b) => ids.has(b)), conn: this.sel.conn !== null && this.sel.conn < this.doc.connections.length ? this.sel.conn : null };
    this.scheduleSave();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void saveAutosave(serialize(this.snapshot())), 400);
  }

  notify(text: string, level: 'info' | 'warning' | 'error' = 'info') {
    this.toast = { text, level };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), level === 'error' ? 5000 : 3000);
  }

  // ---- Loading -------------------------------------------------------------

  /** Load file text. Unplaced blocks are auto-laid out. Undoable. */
  async loadText(text: string, opts: { quiet?: boolean; record?: boolean } = {}): Promise<boolean> {
    const r = parseDoc(text);
    if (!r.doc) {
      this.notify(r.error ?? 'Could not load file', 'error');
      return false;
    }
    const d = JSON.parse(JSON.stringify(r.doc)) as LineupDoc;
    propagateIQ(d);
    normalizeConnections(d);
    if (d.blocks.some((b) => b.x === undefined || b.y === undefined)) await layoutDoc(d);
    const before = JSON.stringify(this.snapshot());
    this.doc = d;
    if (opts.record !== false) this.record(before);
    this.sel = { blocks: [], conn: null };
    this.loadWarnings = r.warnings;
    if (!opts.quiet) {
      if (r.warnings.length) this.notify(`Loaded with ${r.warnings.length} schema warning${r.warnings.length > 1 ? 's' : ''}`, 'warning');
      else this.notify(`Loaded "${d.title ?? 'diagram'}"`);
    }
    requestAnimationFrame(() => this.fit());
    return true;
  }

  async autoLayout() {
    const d = JSON.parse(JSON.stringify(this.snapshot())) as LineupDoc;
    const sel = new Set(this.sel.blocks);
    if (sel.size > 1) {
      // Tidy just the selection, keeping the rest pinned.
      for (const b of d.blocks) if (sel.has(b.id)) delete b.x, delete b.y;
      await layoutDoc(d, false);
    } else await layoutDoc(d, true);
    this.edit((x) => {
      x.blocks = d.blocks;
      // Hand-drawn bends no longer fit the new positions: reset the affected wires to automatic routing.
      for (const c of x.connections) {
        const touched = sel.size <= 1 || sel.has(parseRef(c.from)?.block ?? '') || sel.has(parseRef(c.to)?.block ?? '');
        if (touched) delete c.via;
      }
    });
    requestAnimationFrame(() => this.fit());
  }

  // ---- Block edits ---------------------------------------------------------

  addBlock(type: string, at?: { x: number; y: number }): string {
    let id = '';
    const anchorId = !at && this.sel.blocks.length === 1 ? this.sel.blocks[0] : null;
    const anchor = anchorId ? this.expanded.byBlock.get(anchorId)?.[0] : undefined;
    this.edit((d) => {
      id = newBlockId(d, type);
      const b: Block = { id, type };
      applyAlias(b);
      const def = SYMBOLS[b.type];
      if (def?.show?.length) b.show = [...def.show];
      const size = symbolFor(b).def.size;
      if (anchor) {
        // Clicking the palette with one block selected continues the chain to its right.
        b.x = anchor.x + anchor.w + 4;
        b.y = Math.round(anchor.y + (anchor.h - size[1]) / 2);
      } else {
        const c = at ?? this.viewCenter();
        b.x = Math.round(c.x - size[0] / 2);
        b.y = Math.round(c.y - size[1] / 2);
      }
      // Find the nearest free spot (with room for wires) around the target, spiralling out.
      const free = (x: number, y: number) =>
        !d.blocks.some((o) => {
          const os = symbolFor(o).def.size;
          const oh = os[1] + (o.iq ? 6 : 0) + 3;
          return x < (o.x ?? 0) + os[0] + 3 && (o.x ?? 0) < x + size[0] + 3 && y < (o.y ?? 0) + oh + 1 && (o.y ?? 0) < y + size[1] + 4;
        });
      const x0 = b.x!;
      const y0 = b.y!;
      const order = anchor ? Array.from({ length: 30 }, (_, i) => [i, 0]) : [[0, 0], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16].flatMap(ring)];
      for (const [dx, dy] of order) {
        if (free(x0 + dx * 2, y0 + dy * 2)) {
          b.x = x0 + dx * 2;
          b.y = y0 + dy * 2;
          break;
        }
      }
      d.blocks.push(b);
    });
    this.sel = { blocks: [id], conn: null };
    return id;
  }

  updateBlock(id: string, fn: (b: Block) => void) {
    this.edit((d) => {
      const b = d.blocks.find((x) => x.id === id);
      if (!b) return false;
      fn(b);
    });
  }

  rename(from: string, to: string): boolean {
    let ok = false;
    this.edit((d) => {
      ok = renameBlock(d, from, to);
      return ok;
    });
    if (ok) this.sel = { blocks: this.sel.blocks.map((b) => (b === from ? to : b)), conn: this.sel.conn };
    else if (from !== to) this.notify(`Can't rename to "${to}": ids must be unique and start with a letter`, 'error');
    return ok;
  }

  deleteSelection() {
    const ids = new Set(this.sel.blocks);
    const conn = this.sel.conn;
    const group = this.sel.group;
    const note = this.sel.note;
    if (!ids.size && conn === null && !group && (note === null || note === undefined)) return;
    this.edit((d) => {
      if (conn !== null) d.connections.splice(conn, 1);
      if (ids.size) removeBlocks(d, ids);
      if (group) {
        d.groups = (d.groups ?? []).filter((g) => g.id !== group);
        if (!d.groups.length) delete d.groups;
      }
      if (note !== null && note !== undefined) {
        d.notes?.splice(note, 1);
        if (!d.notes?.length) delete d.notes;
      }
    });
    this.sel = { blocks: [], conn: null };
  }

  // ---- Groups and notes ----------------------------------------------------

  groupSelection() {
    const members = [...this.sel.blocks];
    if (!members.length) return;
    let id = '';
    this.edit((d) => {
      const ids = new Set((d.groups ?? []).map((g) => g.id));
      for (let n = 1; ; n++) if (!ids.has((id = `grp${n}`))) break;
      d.groups = [...(d.groups ?? []), { id, label: 'Group', members }];
    });
    this.sel = { blocks: [], conn: null, group: id };
  }

  addNote(at?: { x: number; y: number }) {
    const p = at ?? { x: this.pointer.x, y: this.pointer.y };
    let index = 0;
    this.edit((d) => {
      d.notes = [...(d.notes ?? []), { text: 'Note', x: Math.round(p.x), y: Math.round(p.y) }];
      index = d.notes.length - 1;
    });
    this.sel = { blocks: [], conn: null, note: index };
  }

  // ---- Clipboard -----------------------------------------------------------

  private clip: Fragment | null = null;

  /** Selected blocks and the connections between them. */
  fragment(): Fragment | null {
    const ids = new Set(this.sel.blocks);
    if (!ids.size) return null;
    const d = this.snapshot();
    return {
      lineup: d.lineup,
      fragment: true,
      blocks: d.blocks.filter((b) => ids.has(b.id)),
      connections: d.connections.filter((c) => ids.has(parseRef(c.from)?.block ?? '') && ids.has(parseRef(c.to)?.block ?? '')),
    };
  }

  copy(): string | null {
    const f = this.fragment();
    if (!f) return null;
    this.clip = f;
    return JSON.stringify(f, null, 2);
  }

  /** Paste a fragment: ids are renamed where they clash, positions offset or placed at the pointer. */
  pasteFragment(f: Fragment | null = this.clip, atPointer = false) {
    if (!f?.blocks?.length) return;
    resolveAliases(f);
    const newIds: string[] = [];
    this.edit((d) => {
      const map = new Map<string, string>();
      const xs = f.blocks.map((b) => b.x ?? 0);
      const ys = f.blocks.map((b) => b.y ?? 0);
      const dx = atPointer ? Math.round(this.pointer.x - Math.min(...xs)) : 4;
      const dy = atPointer ? Math.round(this.pointer.y - Math.min(...ys)) : 4;
      for (const b of f.blocks) {
        const nb: Block = JSON.parse(JSON.stringify(b));
        nb.id = d.blocks.some((x) => x.id === b.id) || map.size && [...map.values()].includes(b.id) ? newBlockId(d, b.type) : b.id;
        map.set(b.id, nb.id);
        if (nb.x !== undefined) nb.x += dx;
        if (nb.y !== undefined) nb.y += dy;
        d.blocks.push(nb);
        newIds.push(nb.id);
      }
      const re = (s: string) => {
        const r = parseRef(s);
        return r ? formatRef({ ...r, block: map.get(r.block) ?? r.block }) : s;
      };
      for (const c of f.connections ?? []) d.connections.push({ ...c, from: re(c.from), to: re(c.to), ...(c.via ? { via: c.via.map(([x, y]) => [x + dx, y + dy] as [number, number]) } : {}) });
    });
    this.sel = { blocks: newIds, conn: null };
    this.clip = f;
  }

  duplicate() {
    const f = this.fragment();
    if (f) this.pasteFragment(f);
  }

  // ---- Arrange -------------------------------------------------------------

  /** Align selected blocks: by left/center/right edges or top/middle/bottom (middle = main signal axis). */
  align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const ex = this.expanded;
    const boxes = this.sel.blocks.map((id) => {
      const l = ex.byBlock.get(id)!;
      return { id, x: l[0].x, y: l[0].y, w: l[0].w, h: l[0].h * l.length, cy: l[0].y + l[0].h / 2 };
    });
    if (boxes.length < 2) return;
    const minX = Math.min(...boxes.map((b) => b.x));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const ref = boxes[0];
    this.edit((d) => {
      for (const bx of boxes) {
        const b = d.blocks.find((x) => x.id === bx.id)!;
        if (how === 'left') b.x = minX;
        if (how === 'right') b.x = maxX - bx.w;
        if (how === 'center') b.x = Math.round(ref.x + ref.w / 2 - bx.w / 2);
        if (how === 'top') b.y = minY;
        if (how === 'bottom') b.y = maxY - bx.h;
        if (how === 'middle') b.y = Math.round(ref.cy - (bx.cy - bx.y));
      }
    });
  }

  distribute(axis: 'h' | 'v') {
    const ex = this.expanded;
    const boxes = this.sel.blocks
      .map((id) => {
        const l = ex.byBlock.get(id)!;
        return { id, x: l[0].x, y: l[0].y, w: l[0].w, h: l[0].h * l.length };
      })
      .sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    if (boxes.length < 3) return;
    const first = boxes[0];
    const last = boxes[boxes.length - 1];
    const total = boxes.reduce((s, b) => s + (axis === 'h' ? b.w : b.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (boxes.length - 1);
    this.edit((d) => {
      let pos = axis === 'h' ? first.x : first.y;
      for (const bx of boxes) {
        const b = d.blocks.find((x) => x.id === bx.id)!;
        if (axis === 'h') b.x = Math.round(pos);
        else b.y = Math.round(pos);
        pos += (axis === 'h' ? bx.w : bx.h) + gap;
      }
    });
  }

  // ---- Custom blocks -------------------------------------------------------

  /** Rename a port of a custom block and keep connections pointing at it. */
  renamePort(blockId: string, from: string, to: string): boolean {
    if (!/^[A-Za-z0-9_-]+$/.test(to)) return false;
    let ok = false;
    this.edit((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (!b?.ports || b.ports.some((p) => p.name === to)) return false;
      const p = b.ports.find((x) => x.name === from);
      if (!p) return false;
      p.name = to;
      const re = (s: string) => {
        const r = parseRef(s);
        return r && r.block === blockId && r.port === from ? formatRef({ ...r, port: to }) : s;
      };
      for (const c of d.connections) {
        c.from = re(c.from);
        c.to = re(c.to);
      }
      ok = true;
    });
    return ok;
  }

  removePort(blockId: string, name: string) {
    this.edit((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (!b?.ports) return false;
      b.ports = b.ports.filter((p) => p.name !== name);
      d.connections = d.connections.filter((c) => {
        const f = parseRef(c.from);
        const t = parseRef(c.to);
        return !((f?.block === blockId && f.port === name) || (t?.block === blockId && t.port === name));
      });
    });
  }

  rotateSelection() {
    const ids = new Set(this.sel.blocks);
    this.edit((d) => {
      for (const b of d.blocks) if (ids.has(b.id)) b.rot = (((b.rot ?? 0) + 90) % 360) as Block['rot'];
    });
  }

  flipSelection() {
    const ids = new Set(this.sel.blocks);
    this.edit((d) => {
      for (const b of d.blocks) if (ids.has(b.id)) b.flip = !b.flip;
    });
  }

  setIQ(id: string, on: boolean) {
    this.edit((d) => {
      const b = d.blocks.find((x) => x.id === id);
      if (!b) return false;
      b.iq = on;
      if (!on) delete b.iqOverride;
      normalizeConnections(d);
    });
  }

  unlinkPair(id: string) {
    let ids: [string, string] | null = null;
    this.edit((d) => {
      ids = unlink(d, id);
      return !!ids;
    });
    if (ids) this.sel = { blocks: ids, conn: null };
  }

  relinkPair(a: string, b: string) {
    let id: string | null = null;
    this.edit((d) => {
      id = relink(d, a, b);
      return !!id;
    });
    if (id) this.sel = { blocks: [id], conn: null };
    else this.notify('Only two plain blocks of the same type can be linked', 'error');
  }

  // ---- Connections ---------------------------------------------------------

  /** Connect two drawn ports (instance-level keys like "lpf:i.out"). Returns an error message or null. */
  connect(fromKey: string, toKey: string): string | null {
    const ex = this.expanded;
    const pa = ex.instances.flatMap((i) => i.ports).find((p) => p.key === fromKey);
    const pb = ex.instances.flatMap((i) => i.ports).find((p) => p.key === toKey);
    if (!pa || !pb) return 'No such port';
    if (pa.block === pb.block) return "Can't connect a block to itself";
    let a: Ref = { block: pa.block, rail: pa.rail, port: pa.name };
    let b: Ref = { block: pb.block, rail: pb.rail, port: pb.name };
    if (pa.dir === 'in' && pb.dir !== 'in') [a, b] = [b, a];
    // Drawing between two pairs on the same rail means "connect the pairs".
    if (a.rail && b.rail && a.rail === b.rail) {
      a = { ...a, rail: undefined };
      b = { ...b, rail: undefined };
    }
    const conn = { from: formatRef(a), to: formatRef(b) };
    const d = JSON.parse(JSON.stringify(this.snapshot())) as LineupDoc;
    if (d.connections.some((c) => c.from === conn.from && c.to === conn.to)) return 'Already connected';
    d.connections.push(conn);
    const changed = propagateIQ(d);
    normalizeConnections(d);
    if (changed.length) alignNewPairs(d, changed);
    const errs = expand(d).issues.filter((i) => i.level === 'error');
    const prevErrs = new Set(ex.issues.filter((i) => i.level === 'error').map((i) => i.msg));
    const fresh = errs.filter((e) => !prevErrs.has(e.msg));
    if (fresh.length) return fresh[0].msg;
    this.edit((x) => {
      x.blocks = d.blocks;
      x.connections = d.connections;
    });
    const warn = expand(d).issues.find((i) => i.level === 'warning' && i.msg.startsWith(`${conn.from} → ${conn.to}`));
    if (warn) this.notify(warn.msg, 'warning');
    else if (changed.length) this.notify(`I/Q path: ${changed.join(', ')} now drawn as I and Q pairs`);
    return null;
  }

  /** Set waypoints live during a segment drag (call inside beginDirect/endDirect). */
  setVia(i: number, via: [number, number][] | undefined) {
    const c = this.doc.connections[i];
    if (!c) return;
    if (via && via.length) c.via = via;
    else delete c.via;
  }

  /** If an unconnected inline block sits on a wire, splice it in. Returns true when it did. */
  trySplice(id: string): boolean {
    const d0 = this.snapshot();
    if (!inlinePorts(d0, id)) return false;
    const insts = this.expanded.byBlock.get(id);
    if (!insts) return false;
    const cell = insts[0];
    const hits = wiresUnder(this.expanded, this.routed.routes as never, { x: cell.x, y: cell.y, w: cell.w, h: insts.length * cell.h });
    if (!hits.length) return false;
    const ci = hits[0];
    // Line the block's input up with the wire when the wire runs horizontally through it.
    const r = this.routed.routes.find((x) => x.wire.conn === ci)!;
    let wireY: number | null = null;
    for (let i = 1; i < r.path.length; i++) {
      const a = r.path[i - 1];
      const b = r.path[i];
      if (a[1] === b[1] && a[1] > cell.y && a[1] < cell.y + cell.h * insts.length) wireY = a[1];
    }
    const d = JSON.parse(JSON.stringify(d0)) as LineupDoc;
    if (!spliceBlock(d, id, ci)) return false;
    const before = new Set(this.expanded.issues.filter((i) => i.level === 'error').map((i) => i.msg));
    let ex = expand(d);
    const b = d.blocks.find((x) => x.id === id)!;
    if (wireY !== null) {
      const inPort = ex.byBlock.get(id)![0].ports.find((p) => p.name === inlinePorts(d, id)!.inp.name)!;
      b.y = (b.y ?? 0) + Math.round(wireY - inPort.p[1]);
      ex = expand(d);
    }
    if (ex.issues.some((i) => i.level === 'error' && !before.has(i.msg))) return false;
    // Make room: if the block now overlaps neighbours, shift everything to its right over.
    const me = ex.byBlock.get(id)!;
    const mx0 = me[0].x;
    const mx1 = me[0].x + me[0].w;
    const my0 = me[0].y;
    const my1 = me[me.length - 1].y + me[0].h;
    const crowded = ex.instances.some((o) => o.block.id !== id && o.x < mx1 + 3 && o.x + o.w > mx0 - 3 && o.y < my1 && o.y + o.h > my0);
    if (crowded) {
      const shift = mx1 - mx0 + 4;
      for (const o of d.blocks) if (o.id !== id && (o.x ?? 0) >= mx0 - 1) o.x = (o.x ?? 0) + shift;
      for (const c of d.connections) if (c.via) c.via = c.via.map(([vx, vy]) => [vx >= mx0 ? vx + shift : vx, vy]);
    }
    this.edit((x) => {
      x.blocks = d.blocks;
      x.connections = d.connections;
    });
    this.notify(`Inserted ${id} into the wire`);
    return true;
  }

  openQuickAdd(chain: boolean) {
    const { sx, sy, x, y } = this.pointer;
    const anchor = chain && this.sel.blocks.length === 1 ? this.sel.blocks[0] : null;
    this.quickAdd = { sx: anchor ? this.viewport.w / 2 - 140 : sx, sy: anchor ? 80 : sy, world: { x, y }, chain: anchor };
  }

  /** Add a block from the quick-add box: at the pointer, or chained after the selection and connected. */
  quickPick(type: string) {
    const q = this.quickAdd;
    this.quickAdd = null;
    if (!q) return;
    if (!q.chain) {
      const id = this.addBlock(type, q.world);
      this.trySplice(id);
      return;
    }
    const anchorId = q.chain;
    const ex = this.expanded;
    const anchor = ex.byBlock.get(anchorId)?.[0];
    if (!anchor) return;
    const used = new Set(ex.wires.flatMap((w) => [w.from.key, w.to.key]));
    const outs = anchor.ports.filter((p) => (p.dir === 'out' || (p.dir === 'bi' && p.n[0] > 0.5)) && !['lo', 'clk', 'ctrl'].includes(p.domain));
    const out = outs.find((p) => !used.has(p.key)) ?? outs[0];
    this.sel = { blocks: [anchorId], conn: null };
    const id = this.addBlock(type);
    if (!out) return;
    const d = this.snapshot();
    const nb = d.blocks.find((b) => b.id === id)!;
    const io = inlinePorts(d, id);
    const inName = io?.inp.name ?? symbolFor(nb).def.ports.find((p) => p.dir !== 'out')?.name;
    if (!inName) return;
    // Line up the new block's input with the anchor's output, and follow I/Q pairs.
    this.updateBlock(id, (b) => {
      if (anchor.block.iq && !out.def.rail) b.iq = true;
      const tmp = expand({ ...d, blocks: [{ ...b, x: 0, y: 0 }], connections: [] });
      const ip = tmp.byBlock.get(id)![0].ports.find((p) => p.name === inName);
      if (ip) {
        b.y = Math.round(out.p[1] - ip.p[1]);
        b.x = Math.round(out.p[0] + 4 - ip.p[0]);
      }
    });
    const fromKey = out.key;
    const toInst = this.expanded.byBlock.get(id)![0];
    const err = this.connect(fromKey, `${toInst.id}.${inName}`);
    if (err) this.notify(err, 'error');
    this.sel = { blocks: [id], conn: null };
  }

  updateConn(i: number, fn: (c: LineupDoc['connections'][number]) => void) {
    this.edit((d) => {
      const c = d.connections[i];
      if (!c) return false;
      fn(c);
    });
  }

  // ---- View ----------------------------------------------------------------

  viewport = { w: 800, h: 600 };

  viewCenter(): { x: number; y: number } {
    const { tx, ty, k } = this.view;
    return { x: (this.viewport.w / 2 - tx) / k / G, y: (this.viewport.h / 2 - ty) / k / G };
  }

  /** Diagram bounds in grid units, including labels. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    const ex = this.expanded;
    if (!ex.instances.length) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of ex.instances) {
      x0 = Math.min(x0, i.x);
      y0 = Math.min(y0, i.y);
      x1 = Math.max(x1, i.x + i.w);
      const chars = Math.max(0, ...i.labelLines.map((s) => s.length));
      const half = Math.max(i.w / 2, chars * 0.32);
      x0 = Math.min(x0, i.x + i.w / 2 - half);
      x1 = Math.max(x1, i.x + i.w / 2 + half);
      y1 = Math.max(y1, i.y + i.h + (i.labelLines.length ? 0.6 + i.labelLines.length * 1.3 : 0));
    }
    for (const r of this.routed.routes)
      for (const l of r.lines)
        for (const p of l) {
          x0 = Math.min(x0, p[0]);
          y0 = Math.min(y0, p[1]);
          x1 = Math.max(x1, p[0]);
          y1 = Math.max(y1, p[1]);
        }
    // Groups add padding and a label row.
    if (this.doc.groups?.length) {
      x0 -= 2.5;
      y0 -= 2.5;
      x1 += 2.5;
      y1 += 2.5;
    }
    return { x0, y0, x1, y1 };
  }

  fit() {
    const b = this.bounds();
    const { w, h } = this.viewport;
    if (!b) {
      this.view = { tx: 40, ty: 40, k: 1 };
      return;
    }
    const pad = 40;
    const bw = (b.x1 - b.x0) * G;
    const bh = (b.y1 - b.y0) * G;
    const k = Math.min(2, Math.max(0.2, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh)));
    this.view = { k, tx: (w - bw * k) / 2 - b.x0 * G * k, ty: (h - bh * k) / 2 - b.y0 * G * k };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const { tx, ty, k } = this.view;
    const nk = Math.min(4, Math.max(0.15, k * factor));
    const f = nk / k;
    this.view = { k: nk, tx: sx - (sx - tx) * f, ty: sy - (sy - ty) * f };
  }
}

/** Offsets on the square ring at distance r, nearest first. */
function ring(r: number): number[][] {
  const out: number[][] = [];
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  return out.sort((a, b) => Math.hypot(a[0], a[1] * 1.3) - Math.hypot(b[0], b[1] * 1.3));
}

/**
 * Blocks that just became I/Q pairs move so their I rail lines up with the split port
 * feeding them, with room for wires. Blocks fed by something else stay put.
 */
function alignNewPairs(d: LineupDoc, ids: string[]) {
  for (const id of ids) {
    const ex = expand(d);
    const w = ex.wires.find((x) => x.to.block === id && x.to.rail === 'i' && x.railMark === 'I');
    if (!w) continue;
    const b = d.blocks.find((x) => x.id === id)!;
    const inst = ex.byBlock.get(id)![0];
    const local = [w.to.p[0] - inst.x, w.to.p[1] - inst.y];
    b.y = Math.round(w.from.p[1] - local[1]);
    if (inst.x < w.from.p[0] + 4) b.x = Math.round(w.from.p[0] + 4 - local[0]);
  }
}

export const editor = new Editor();
export { parseRef };
