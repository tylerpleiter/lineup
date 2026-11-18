// Geometry for groups and notes, shared by the renderer and the editor's hit areas.

import type { Expanded } from '../model/expand';
import type { LineupDoc } from '../model/types';
import { labelBox } from './route';

export interface GroupBox {
  id: string;
  label?: string;
  members: string[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function groupBoxes(doc: LineupDoc, ex: Expanded): GroupBox[] {
  const out: GroupBox[] = [];
  for (const g of doc.groups ?? []) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of g.members)
      for (const inst of ex.byBlock.get(m) ?? []) {
        x0 = Math.min(x0, inst.x);
        y0 = Math.min(y0, inst.y);
        x1 = Math.max(x1, inst.x + inst.w);
        y1 = Math.max(y1, inst.y + inst.h);
        const lb = labelBox(inst);
        if (lb) {
          x0 = Math.min(x0, lb[0]);
          x1 = Math.max(x1, lb[2]);
          y1 = Math.max(y1, lb[3]);
        }
      }
    if (isFinite(x0)) out.push({ id: g.id, label: g.label, members: g.members, x0: x0 - 1.5, y0: y0 - 2.5, x1: x1 + 1.5, y1: y1 + 1 });
  }
  return out;
}

export interface NoteBox {
  index: number;
  text: string;
  /** Text anchor point, grid units. */
  x: number;
  y: number;
  anchor: 'start' | 'middle';
  /** Approximate bounds for hit-testing, grid units. */
  box: [number, number, number, number];
}

export function noteBoxes(doc: LineupDoc, ex: Expanded): NoteBox[] {
  return (doc.notes ?? []).map((n, index) => {
    let x = n.x ?? 0;
    let y = n.y ?? 0;
    let anchor: 'start' | 'middle' = 'start';
    if (n.near && (n.x === undefined || n.y === undefined)) {
      const inst = ex.byBlock.get(n.near)?.at(-1);
      if (inst) {
        const lb = labelBox(inst);
        x = inst.x + inst.w / 2;
        y = (lb ? lb[3] : inst.y + inst.h) + 1.2;
        anchor = 'middle';
      }
    }
    const lines = n.text.split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * 0.55 + 0.4;
    const h = lines.length * 1.3;
    const bx = anchor === 'middle' ? x - w / 2 : x - 0.2;
    return { index, text: n.text, x, y, anchor, box: [bx, y - 1, bx + w, y - 1 + h] };
  });
}
