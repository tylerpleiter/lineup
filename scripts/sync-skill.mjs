// Copies the format docs, schema and symbol data into skills/sig-diagrams so the agent
// skill always matches this version of Lineup.  Run: npm run skill:sync
// With --check, writes nothing and exits 1 if the skill is out of date (used by the tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills', 'sig-diagrams');
const ref = path.join(skill, 'references');
const check = process.argv.includes('--check');
const stale = [];
function write(file, content) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old === content) return;
  if (check) stale.push(path.relative(root, file));
  else fs.writeFileSync(file, content);
}
if (!check) fs.mkdirSync(ref, { recursive: true });

const banner = '<!-- Copied from the Lineup repo by `npm run skill:sync`. Edit the original, not this copy. -->\n\n';
for (const [from, to] of [['docs/FORMAT.md', 'FORMAT.md'], ['docs/SYMBOLS.md', 'SYMBOLS.md']]) {
  const text = fs.readFileSync(path.join(root, from), 'utf8').replace(/\]\((SYMBOLS|FORMAT)\.md\)/g, ']($1.md)').replace(/\]\(\.\.\/schema\/lineup\.schema\.json\)/g, '](lineup.schema.json)');
  write(path.join(ref, to), banner + text);
}
write(path.join(ref, 'lineup.schema.json'), fs.readFileSync(path.join(root, 'schema', 'lineup.schema.json'), 'utf8'));

// Compact symbol data for scripts/check.py: ports per type, plus aliases.
const dir = path.join(root, 'symbols');
const symbols = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'aliases.json').sort()) {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const port = (p) => ({ name: p.name, dir: p.dir, domain: p.domain ?? 'signal', signal: p.signal ?? 'se', ...(p.fixed ? { fixed: true } : {}), ...(p.rail ? { rail: p.rail } : {}), ...(p.optional ? { optional: true } : {}) });
  symbols[s.id] = {
    ports: s.ports.map(port),
    params: Object.keys(s.params ?? {}),
    variants: Object.fromEntries(Object.entries(s.variants ?? {}).map(([k, v]) => [k, (v.ports ?? []).map(port)])),
  };
}
const aliases = JSON.parse(fs.readFileSync(path.join(dir, 'aliases.json'), 'utf8')).aliases;
write(path.join(skill, 'scripts', 'symbols.json'), JSON.stringify({ symbols, aliases }, null, 1) + '\n');
if (check) {
  if (stale.length) {
    console.error(`skills/sig-diagrams is out of date (${stale.join(', ')}). Run: npm run skill:sync`);
    process.exit(1);
  }
  console.log('skills/sig-diagrams is up to date');
} else console.log(`skills/sig-diagrams synced: ${Object.keys(symbols).length} symbols, ${Object.keys(aliases).length} aliases`);
