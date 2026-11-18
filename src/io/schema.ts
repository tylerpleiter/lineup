import Ajv2020 from 'ajv/dist/2020';
import schema from '../../schema/lineup.schema.json';
import type { LineupDoc } from '../model/types';
import { resolveAliases } from '../model/aliases';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export interface LoadResult {
  doc?: LineupDoc;
  /** Schema problems; the file still loads when the basic shape is usable. */
  warnings: string[];
  error?: string;
}

/** Parse and check a Lineup file. Loads leniently: only a missing blocks/connections array is fatal. */
export function parseDoc(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { warnings: [], error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as LineupDoc).blocks)) {
    return { warnings: [], error: 'Not a Lineup file: expected an object with a "blocks" array' };
  }
  const doc = raw as LineupDoc;
  doc.connections ??= [];
  doc.lineup ??= '0.1';
  const warnings: string[] = [];
  if (!validate(doc)) {
    for (const e of validate.errors ?? []) {
      warnings.push(`${e.instancePath || '/'} ${e.message}${e.params && 'additionalProperty' in e.params ? `: ${e.params.additionalProperty}` : ''}`);
    }
  }
  resolveAliases(doc);
  return { doc, warnings };
}
