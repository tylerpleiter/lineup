// Alias types: common names (lna, pa, saw, pll, fir…) that resolve to one of the core
// symbols with a default label/variant. Keeps the symbol set small while letting people
// and AI agents write the names they think in.

import data from '../../symbols/aliases.json';
import { formatRef, parseRef } from './expand';
import { normDomain, type Block, type LineupDoc, type PortDef } from './types';

export interface Alias {
  type: string;
  label?: string;
  variant?: string;
  flip?: boolean;
  /** Alias port name → target port name. */
  ports?: Record<string, string>;
  /** Ports for aliases of custom blocks. */
  customPorts?: PortDef[];
}

export const ALIASES: Record<string, Alias> = (data as { aliases: Record<string, Alias> }).aliases;

/** Apply an alias's defaults to a block in place. Returns the port renames to apply, if any. */
export function applyAlias(b: Block): Record<string, string> | undefined {
  const a = ALIASES[b.type];
  if (!a) return undefined;
  b.type = a.type;
  if (a.label !== undefined && b.label === undefined) b.label = a.label;
  if (a.variant && b.variant === undefined) b.variant = a.variant;
  if (a.flip && b.flip === undefined) b.flip = true;
  if (a.customPorts && !b.ports) b.ports = a.customPorts.map((p) => ({ signal: 'se', ...p }));
  return a.ports;
}

/** Resolve every alias in a document (blocks and the connection endpoints on renamed ports). */
export function resolveAliases(doc: { blocks: Block[]; connections?: LineupDoc['connections'] }): string[] {
  const notes: string[] = [];
  // Legacy rf / if / bb domains collapse into "signal".
  for (const b of doc.blocks) for (const p of b.ports ?? []) if (p.domain) p.domain = normDomain(p.domain);
  for (const c of doc.connections ?? []) if (c.domain) c.domain = normDomain(c.domain);
  for (const b of doc.blocks) {
    const from = b.type;
    const renames = applyAlias(b);
    if (b.type === from) continue;
    notes.push(`${b.id}: "${from}" → ${b.type}${b.label ? ` (${b.label})` : ''}`);
    if (!renames) continue;
    for (const c of doc.connections ?? []) {
      for (const end of ['from', 'to'] as const) {
        const r = parseRef(c[end]);
        if (r && r.block === b.id && renames[r.port]) c[end] = formatRef({ ...r, port: renames[r.port] });
      }
    }
  }
  return notes;
}
