// Regenerates docs/SYMBOLS.md from /symbols/*.json.  Run: npm run symbols:doc
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('symbols');
const order = ['gain', 'filter', 'conversion', 'source', 'passive', 'converter', 'dsp', 'generic'];
const names = { gain: 'Gain', filter: 'Filters', conversion: 'Conversion', source: 'Sources', passive: 'RF passives', converter: 'Converters', dsp: 'DSP', generic: 'Generic' };
const syms = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'aliases.json').map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

let out = `# Symbols\n\nGenerated from \`/symbols\` by \`npm run symbols:doc\`. Use the **type** in a block's \`type\` field and the **port** names in connections (\`blockId.port\`).\n\nPort notation: \`name\` (direction, domain, side). Directions: in, out, bi (bidirectional). Ports marked *optional* draw only when connected. **DSP ✓** means the block takes a block-level \`domain\` (\`signal\`, \`digital\` or \`complex\`) that changes its signal ports.\n`;
for (const cat of order) {
  const list = syms.filter((s) => s.category === cat).sort((a, b) => a.id.localeCompare(b.id));
  if (!list.length) continue;
  out += `\n## ${names[cat]}\n\n| Type | Name | Ports | Properties | Variants | DSP |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const s of list) {
    const ports = s.ports
      .map((p) => `\`${p.name}\` (${p.dir}, ${p.domain ?? 'signal'}${p.signal === 'diff' ? ', diff' : ''}${p.fixed ? ', fixed' : ''}${p.rail ? `, rail ${p.rail}` : ''}, ${p.side}${p.optional ? ', optional' : ''})`)
      .join('<br>');
    const props = Object.keys(s.params ?? {}).map((k) => `\`${k}\``).join(', ') || '—';
    const variants = Object.keys(s.variants ?? {}).map((k) => `\`${k}\``).join(', ') || '—';
    const dsp = s.dsp ? '✓' : '';
    out += `| \`${s.id}\` | ${s.name} | ${ports.length ? ports : s.generator === 'switch' ? '`c` (bi), `t1`…`tN` (bi, N = `throws`), `ctrl` (in, ctrl, optional)' : '—'} | ${props} | ${variants} | ${dsp} |\n`;
  }
}
out += `\nAny other \`type\` loads as a labelled custom block with a warning. Custom blocks (\`type: "custom"\`) take a \`ports\` array and optional \`size\`; ports named \`i\` and \`q\` on the same side are placed one rail pitch (6 units) apart so I/Q pairs line up. A custom block can also carry an \`icon\`: SVG path data in grid units drawn inside its box.\n\nSet \`variant\` on a block to use a symbol variant; \`adjustable\` adds a diagonal tuning arrow.\n`;
const aliases = JSON.parse(fs.readFileSync(path.join(dir, 'aliases.json'), 'utf8')).aliases;
out += `\n## Aliases\n\nThese names are accepted as a block \`type\` and resolve to a core symbol on load (and in the quick-add box). Fields the block sets itself win over the alias defaults; aliases with port renames rewrite connection endpoints.\n\n| Alias | Becomes | Defaults |\n| --- | --- | --- |\n`;
for (const [name, a] of Object.entries(aliases)) {
  const d = [a.label !== undefined && `label "${a.label}"`, a.variant && `variant ${a.variant}`, a.flip && 'flipped', a.domain && `domain ${a.domain}`, a.params && Object.entries(a.params).map(([k, v]) => `${k} ${v}`).join(', '), a.ports && `ports ${Object.entries(a.ports).map(([f, t]) => `${f}→${t}`).join(', ')}`, a.customPorts && `ports ${a.customPorts.map((p) => p.name).join(', ')}`].filter(Boolean).join('; ') || '—';
  out += `| \`${name}\` | \`${a.type}\` | ${d} |\n`;
}
fs.writeFileSync('docs/SYMBOLS.md', out);
console.log(`docs/SYMBOLS.md: ${syms.length} symbols`);
