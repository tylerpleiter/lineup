<script lang="ts">
  // Cascade (lineup) analysis of the signal chain and its frequency plan, in a drawer under the canvas.
  import { editor } from '../editor/store.svelte';
  import { editText, parseParam } from '../model/params';
  import { fmtHz } from '../model/freqplan';
  import type { Stage } from '../model/cascade';

  const a = $derived(editor.doc.analysis ?? {});
  const c = $derived(editor.cascade);
  const fp = $derived(editor.freqPlan);

  const f1 = (v: number | undefined) => (v === undefined || !isFinite(v) ? '' : v.toFixed(1));

  /** Frequency leaving a stage. */
  function fOut(i: number): number | undefined {
    if (!c || !fp) return undefined;
    const next = c.stages[i + 1];
    if (next?.wire) return fp.byPort.get(next.wire.from.key);
    const inst = editor.flatEx.byId.get(c.stages[i].inst);
    for (const p of inst?.ports ?? []) if (p.dir !== 'in' && fp.byPort.has(p.key)) return fp.byPort.get(p.key);
    return undefined;
  }

  const shown = (s: Stage, k: 'gain' | 'nf') => (s.assumed.includes(k) ? '' : f1(s[k]));

  const COLS = ['Stage', 'Type', 'G (dB)', 'NF (dB)', 'IIP3 (dBm)', 'OP1dB (dBm)', 'ΣG (dB)', 'ΣNF (dB)', 'ΣIIP3 (dBm)', 'ΣOIP3 (dBm)', 'ΣOP1dB (dBm)', 'Pout (dBm)', 'f out'];
  function rows(): string[][] {
    if (!c) return [];
    return c.stages.map((s, i) => [
      s.inst,
      s.type,
      shown(s, 'gain'),
      shown(s, 'nf'),
      f1(s.iip3),
      f1(s.op1),
      f1(s.cum.gain),
      f1(s.cum.nf),
      f1(s.cum.iip3),
      f1(s.cum.oip3),
      f1(s.cum.op1),
      f1(s.cum.pout),
      fOut(i) !== undefined ? fmtHz(fOut(i)!) : '',
    ]);
  }

  function totalsText(): string[] {
    const t = c?.totals;
    if (!t) return [];
    const out = [`Gain ${f1(t.gain)} dB`, `NF ${f1(t.nf)} dB`];
    if (t.iip3 !== undefined) out.push(`IIP3 ${f1(t.iip3)} dBm`, `OIP3 ${f1(t.oip3)} dBm`);
    if (t.op1 !== undefined) out.push(`OP1dB ${f1(t.op1)} dBm`);
    if (t.noiseFloor !== undefined) out.push(`kTB ${f1(t.noiseFloor)} dBm`, `MDS ${f1(t.mds)} dBm`, `Output noise ${f1(t.outNoise)} dBm`);
    if (t.pout !== undefined) out.push(`Pout ${f1(t.pout)} dBm`);
    if (t.snr !== undefined) out.push(`SNR ${f1(t.snr)} dB`);
    return out;
  }

  async function copy(kind: 'csv' | 'md') {
    const r = rows();
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const text =
      kind === 'csv'
        ? [COLS, ...r].map((x) => x.map(esc).join(',')).join('\n')
        : [`| ${COLS.join(' | ')} |`, `|${COLS.map(() => '---').join('|')}|`, ...r.map((x) => `| ${x.join(' | ')} |`), '', totalsText().join(' · ')].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      editor.notify(`Copied cascade as ${kind === 'csv' ? 'CSV' : 'Markdown'}`);
    } catch {
      editor.notify("Clipboard isn't available here", 'error');
    }
  }

  function setNum(key: 'pin' | 'fin' | 'bw', text: string) {
    const v = key === 'pin' ? parseParam('p1db', text) : parseParam('freq', text);
    if (text.trim() === '') editor.setAnalysis({ [key]: undefined });
    else if (typeof v === 'number') editor.setAnalysis({ [key]: v });
    else editor.notify(`Couldn't read "${text}"`, 'error');
  }

  const onEnter = (e: KeyboardEvent) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur();
  const pathLabel = $derived(a.path?.length ? a.path.join(' → ') : 'Auto: main input to the furthest stage');
  const warnings = $derived([...(c?.warnings ?? []), ...(fp?.issues.map((i) => i.msg) ?? [])]);
</script>

<section class="analysis" aria-label="Cascade analysis">
  <div class="bar">
    <strong>Cascade</strong>
    <label>P<sub>in</sub> <input value={a.pin !== undefined ? editText('p1db', a.pin) : ''} placeholder="dBm" onkeydown={onEnter} onchange={(e) => setNum('pin', e.currentTarget.value)} /></label>
    <label>f<sub>in</sub> <input value={a.fin !== undefined ? editText('freq', a.fin) : ''} placeholder="e.g. 2.44 GHz" onkeydown={onEnter} onchange={(e) => setNum('fin', e.currentTarget.value)} /></label>
    <label>Noise BW <input value={a.bw !== undefined ? editText('bw', a.bw) : ''} placeholder="e.g. 20 MHz" onkeydown={onEnter} onchange={(e) => setNum('bw', e.currentTarget.value)} /></label>
    <span class="sep"></span>
    <label class="toggle"><input type="checkbox" checked={!!a.showLevels} onchange={(e) => editor.setAnalysis({ showLevels: e.currentTarget.checked })} /><span class="track"></span> Levels</label>
    <label class="toggle"><input type="checkbox" checked={!!a.showFreq} onchange={(e) => editor.setAnalysis({ showFreq: e.currentTarget.checked })} /><span class="track"></span> Frequencies</label>
    <span class="grow"></span>
    <button class="small" onclick={() => copy('csv')} disabled={!c?.stages.length}>Copy CSV</button>
    <button class="small" onclick={() => copy('md')} disabled={!c?.stages.length}>Copy Markdown</button>
    <button class="close" onclick={() => (editor.analysisOpen = false)} aria-label="Close analysis">×</button>
  </div>
  <div class="path">
    <span class="hint">Path</span>
    <span class="p" title={pathLabel}>{pathLabel}</span>
    <button class="small" onclick={() => editor.pathFromSelection()} disabled={!editor.sel.blocks.length} title="Run the cascade through the selected blocks, in signal order (one block: from the input to it)">Through selection</button>
    {#if a.path?.length}<button class="small" onclick={() => editor.setAnalysis({ path: undefined })}>Auto</button>{/if}
  </div>
  {#if c?.error}
    <p class="msg">{c.error}</p>
  {:else if c}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="l">Stage</th>
            <th>G</th><th>NF</th><th>IIP3</th><th>OP1dB</th>
            <th class="cum">ΣG</th><th class="cum">ΣNF</th><th class="cum">ΣIIP3</th><th class="cum">ΣOIP3</th><th class="cum">ΣOP1dB</th>
            <th>P<sub>out</sub></th><th>Backoff</th><th>f<sub>out</sub></th>
          </tr>
          <tr class="units"><th></th><th>dB</th><th>dB</th><th>dBm</th><th>dBm</th><th class="cum">dB</th><th class="cum">dB</th><th class="cum">dBm</th><th class="cum">dBm</th><th class="cum">dBm</th><th>dBm</th><th>dB</th><th></th></tr>
        </thead>
        <tbody>
          {#each c.stages as s, i (s.inst)}
            <tr onclick={() => editor.reveal(s.inst)} class:sel={editor.sel.blocks.includes(s.block) && s.inst.startsWith(editor.prefix) && !s.inst.slice(editor.prefix.length).includes('/')}>
              <td class="l"><span class="mono">{s.inst}</span>{#if s.label && s.label !== s.block}<span class="hint lbl">{s.label}</span>{/if}</td>
              <td class:assumed={s.assumed.includes('gain')}>{f1(s.gain)}</td>
              <td class:assumed={s.assumed.includes('nf')}>{f1(s.nf)}</td>
              <td>{f1(s.iip3)}</td>
              <td>{f1(s.op1)}</td>
              <td class="cum">{f1(s.cum.gain)}</td>
              <td class="cum">{f1(s.cum.nf)}</td>
              <td class="cum">{f1(s.cum.iip3)}</td>
              <td class="cum">{f1(s.cum.oip3)}</td>
              <td class="cum">{f1(s.cum.op1)}</td>
              <td>{f1(s.cum.pout)}</td>
              <td class:bad={(s.cum.backoff ?? 99) < 0} class:warn={(s.cum.backoff ?? 99) >= 0 && (s.cum.backoff ?? 99) < 3}>{f1(s.cum.backoff)}</td>
              <td>{fOut(i) !== undefined ? fmtHz(fOut(i)!) : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="totals">
      {#each totalsText() as t}<span>{t}</span>{/each}
      {#if a.pin === undefined}<span class="hint">Set P<sub>in</sub> for levels and SNR</span>{/if}
      {#if !a.bw}<span class="hint">Set a noise BW for the noise floor</span>{/if}
    </div>
  {/if}
  {#if warnings.length}
    <ul class="warns">
      {#each warnings as w}<li>{w}</li>{/each}
    </ul>
  {/if}
  <p class="foot hint">Grey values are assumed (0 dB gain, noiseless). Passive blocks use their insertion loss for gain and NF. Click a row to find its block.</p>
</section>

<style>
  .analysis {
    flex: none;
    max-height: 44%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
    background: #fff;
    font-size: 12.5px;
    min-height: 0;
  }
  .bar,
  .path {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    flex-wrap: wrap;
  }
  .path {
    padding-top: 0;
    gap: 8px;
  }
  .path .p {
    font-family: var(--mono);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
  }
  .bar input:not([type='checkbox']) {
    width: 92px;
    padding: 3px 6px;
    border: 1px solid var(--line);
    border-radius: 5px;
    font: inherit;
  }
  .bar label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--muted);
  }
  .sep {
    width: 1px;
    height: 16px;
    background: var(--line);
  }
  .grow {
    flex: 1;
  }
  .close {
    all: unset;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
    color: var(--muted);
  }
  .scroll {
    overflow: auto;
    min-height: 0;
    padding: 0 12px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 3px 8px;
    text-align: right;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  th {
    position: sticky;
    top: 0;
    background: #fff;
    font-weight: 600;
  }
  tr.units th {
    top: 21px;
    font-weight: 400;
    color: var(--muted);
    font-size: 11px;
  }
  .l {
    text-align: left;
  }
  .cum {
    background: var(--panel);
  }
  th.cum {
    background: #f1f3f5;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover td {
    background: var(--hover);
  }
  tbody tr.sel td {
    background: #e8f0fe;
  }
  .assumed {
    color: #aab0b8;
    font-style: italic;
  }
  .bad {
    color: #d13438;
    font-weight: 600;
  }
  .warn {
    color: #b7791f;
  }
  .mono {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .totals {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding: 6px 12px;
    font-variant-numeric: tabular-nums;
  }
  .totals span:not(.hint) {
    font-weight: 600;
  }
  .warns {
    margin: 0;
    padding: 2px 12px 4px 28px;
    color: #9a5b00;
  }
  .msg {
    padding: 4px 12px;
    color: var(--muted);
  }
  .foot {
    padding: 0 12px 6px;
    margin: 0;
    font-size: 11px;
  }
  .hint {
    color: var(--muted);
  }
  .lbl {
    margin-left: 8px;
  }
</style>
