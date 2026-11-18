<script lang="ts">
  import Canvas from './editor/Canvas.svelte';
  import Palette from './ui/Palette.svelte';
  import Properties from './ui/Properties.svelte';
  import { editor } from './editor/store.svelte';
  import { serialize, emptyDoc } from './model/doc';
  import { download, pickFile, slug } from './io/files';
  import { buildPDF, buildPNG, buildSVG } from './io/export';
  import { loadAutosave } from './io/autosave';
  import zeroIf from '../examples/zero-if-rx.sig.json?raw';
  import iqTx from '../examples/iq-tx.sig.json?raw';
  import superhet from '../examples/superhet-ddc.sig.json?raw';

  const EXAMPLES: Record<string, string> = { 'Zero-IF receiver': zeroIf, 'Superhet + DDC receiver': superhet, 'I/Q transmitter': iqTx };

  let menu = $state<'export' | 'examples' | null>(null);

  const errors = $derived(editor.expanded.issues.filter((i) => i.level === 'error').length);
  const warnings = $derived(editor.expanded.issues.filter((i) => i.level === 'warning').length);

  async function open() {
    const f = await pickFile();
    if (f) await editor.loadText(await f.text());
  }

  function save() {
    download(`${slug(editor.doc.title)}.sig.json`, serialize(editor.snapshot()));
    editor.notify('Saved');
  }

  async function exportAs(kind: 'svg' | 'pdf' | 'png2' | 'png4' | 'copy') {
    menu = null;
    const b = editor.bounds();
    if (!b) return editor.notify('Nothing to export', 'warning');
    const svg = buildSVG(b);
    const name = slug(editor.doc.title);
    if (kind === 'svg') download(`${name}.svg`, svg, 'image/svg+xml');
    else if (kind === 'pdf') {
      try {
        download(`${name}.pdf`, await buildPDF(svg));
      } catch (e) {
        editor.notify(`PDF export failed: ${(e as Error).message}`, 'error');
      }
    }
    else if (kind === 'copy') {
      try {
        const png = await buildPNG(svg, 2);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([svg], { type: 'text/plain' }) })]);
        editor.notify('Copied as image');
      } catch {
        editor.notify("Clipboard isn't available here; use Export SVG/PNG", 'error');
      }
    } else download(`${name}.png`, await buildPNG(svg, kind === 'png4' ? 4 : 2));
  }

  function newDoc() {
    editor.edit((d) => {
      Object.assign(d, emptyDoc());
      delete d.groups;
      delete d.notes;
    });
    editor.sel = { blocks: [], conn: null };
    editor.loadWarnings = [];
  }

  function inField(t: EventTarget | null) {
    return !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
  }

  function onKey(e: KeyboardEvent) {
    if (inField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) editor.undo();
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) editor.redo();
    else if (mod && k === 's') save();
    else if (mod && k === 'o') open();
    else if (mod && k === 'a') editor.sel = { blocks: editor.doc.blocks.map((b) => b.id), conn: null };
    else if (mod && k === 'd') editor.duplicate();
    else if (mod && (k === 'c' || k === 'x')) {
      const text = editor.copy();
      if (!text) return;
      navigator.clipboard?.writeText(text).catch(() => {});
      if (k === 'x') editor.deleteSelection();
      editor.notify(`${k === 'x' ? 'Cut' : 'Copied'} ${editor.fragment()?.blocks.length ?? 'selected'} block(s)`);
    }
    else if (mod) return;
    else if (k === 'delete' || k === 'backspace') editor.deleteSelection();
    else if (k === 'r') editor.rotateSelection();
    else if (k === 'f') editor.flipSelection();
    else if (k === 'l') editor.autoLayout();
    else if (k === 'g') editor.groupSelection();
    else if (k === 'n') editor.addNote();
    else if (k === '0') editor.fit();
    else if (k === '/') editor.openQuickAdd(false);
    else if (k === 'tab' && editor.sel.blocks.length === 1) editor.openQuickAdd(true);
    else if (k === 'escape') {
      editor.sel = { blocks: [], conn: null };
      menu = null;
    } else return;
    e.preventDefault();
  }

  async function onPaste(e: ClipboardEvent) {
    if (inField(e.target)) return;
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (text && text.startsWith('{')) {
      e.preventDefault();
      let frag = null;
      try {
        const j = JSON.parse(text);
        if (j && j.fragment === true && Array.isArray(j.blocks)) frag = j;
      } catch {
        /* not JSON: loadText reports it */
      }
      if (frag) editor.pasteFragment(frag, true);
      else await editor.loadText(text);
    } else if (!text) editor.pasteFragment(undefined, true);
  }

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  }

  async function onDrop(e: DragEvent) {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    await editor.loadText(await f.text());
  }

  $effect(() => {
    (async () => {
      const saved = await loadAutosave();
      if (!saved || !(await editor.loadText(saved, { quiet: true, record: false }))) await editor.loadText(zeroIf, { quiet: true, record: false });
    })();
  });
</script>

<svelte:window onkeydown={onKey} onpaste={onPaste} ondragover={onDragOver} ondrop={onDrop} onclick={(e) => !(e.target as HTMLElement).closest('.menu-wrap') && (menu = null)} />

<div class="app">
  <header>
    <div class="brand">
      <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3 2.5 L13.5 8 L3 13.5 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
      <span>Lineup</span>
    </div>
    <span class="title">{editor.doc.title ?? 'Untitled'}</span>
    <nav>
      <button onclick={newDoc}>New</button>
      <button onclick={open} title="Open (Ctrl+O)">Open</button>
      <div class="menu-wrap">
        <button onclick={() => (menu = menu === 'examples' ? null : 'examples')}>Examples ▾</button>
        {#if menu === 'examples'}
          <div class="menu">
            {#each Object.entries(EXAMPLES) as [name, text]}
              <button onclick={() => { menu = null; editor.loadText(text); }}>{name}</button>
            {/each}
          </div>
        {/if}
      </div>
      <span class="sep"></span>
      <button onclick={() => save()} title="Save (Ctrl+S)">Save</button>
      <div class="menu-wrap">
        <button onclick={() => (menu = menu === 'export' ? null : 'export')}>Export ▾</button>
        {#if menu === 'export'}
          <div class="menu">
            <button onclick={() => exportAs('svg')}>SVG</button>
            <button onclick={() => exportAs('pdf')}>PDF</button>
            <button onclick={() => exportAs('png2')}>PNG 2×</button>
            <button onclick={() => exportAs('png4')}>PNG 4×</button>
            <button onclick={() => exportAs('copy')}>Copy as image</button>
          </div>
        {/if}
      </div>
      <span class="sep"></span>
      <button onclick={() => editor.undo()} disabled={!editor.canUndo} title="Undo (Ctrl+Z)">Undo</button>
      <button onclick={() => editor.redo()} disabled={!editor.canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
      <span class="sep"></span>
      <button onclick={() => editor.autoLayout()} title="Auto-layout (L)">Auto-layout</button>
      <button onclick={() => editor.fit()} title="Fit (0)">Fit</button>
    </nav>
  </header>
  <main>
    <Palette />
    <Canvas />
    <Properties />
  </main>
  <footer>
    <button class="status" onclick={() => (editor.sel = { blocks: [], conn: null })} title="Show checks">
      {#if errors}<span class="dot err"></span>{errors} error{errors > 1 ? 's' : ''}{/if}
      {#if warnings}<span class="dot warn"></span>{warnings} warning{warnings > 1 ? 's' : ''}{/if}
      {#if !errors && !warnings}<span class="dot ok"></span>No problems{/if}
    </button>
    <span class="grow"></span>
    {#if editor.toast}<span class={`toast ${editor.toast.level}`}>{editor.toast.text}</span>{/if}
    <span class="grow"></span>
    <span>{Math.round(editor.view.k * 100)}%</span>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 46px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    background: #fff;
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.01em;
  }
  .title {
    color: var(--muted);
    font-size: 13px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }
  nav button {
    border: none;
    background: none;
    padding: 6px 9px;
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }
  nav button:hover:not(:disabled) {
    background: var(--hover);
  }
  nav button:disabled {
    color: #b5bac2;
    cursor: default;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 6px;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    padding: 4px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  }
  .menu button {
    text-align: left;
  }
  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 28px;
    padding: 0 12px;
    border-top: 1px solid var(--line);
    background: var(--panel);
    font-size: 12px;
    color: var(--muted);
    flex: none;
  }
  .status {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-left: 4px;
  }
  .dot.err {
    background: #e5484d;
  }
  .dot.warn {
    background: #f5a524;
  }
  .dot.ok {
    background: #30a46c;
  }
  .grow {
    flex: 1;
  }
  .toast {
    color: var(--text);
  }
  .toast.error {
    color: #c62a2f;
  }
  .toast.warning {
    color: #a35d00;
  }
</style>
