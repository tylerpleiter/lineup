<script lang="ts">
  import { editor } from '../editor/store.svelte';
  import { symbolFor } from '../model/symbols';
  import { RESERVED, editText, parseParam } from '../model/params';
  import { DOMAINS, SIGNAL_PATH_DOMAINS, type Block, type BlockDomain, type Domain, type ParamValue, type PortDef, type Rail } from '../model/types';
  import { SYMBOLS } from '../model/symbols';
  import type { Issue } from '../model/expand';

  const sel = $derived(editor.sel);
  const block = $derived(sel.blocks.length === 1 ? editor.cur.blocks.find((b) => b.id === sel.blocks[0]) : undefined);
  const def = $derived(block ? (editor.expanded.byBlock.get(block.id)?.[0]?.def ?? symbolFor(block).def) : undefined);
  const sheetNames = $derived(Object.keys(editor.doc.sheets ?? {}).sort());
  const unused = $derived(new Set(editor.unusedSheets()));
  const conn = $derived(sel.conn !== null ? editor.cur.connections[sel.conn] : undefined);
  const multi = $derived(sel.blocks.length > 1 ? editor.cur.blocks.filter((b) => sel.blocks.includes(b.id)) : []);
  const canLink = $derived(multi.length === 2 && multi[0].type === multi[1].type && !multi[0].iq && !multi[1].iq);
  /** The block's effective domain: its own setting, or what the symbol's signal ports carry. */
  const blockDomain = $derived.by((): BlockDomain => {
    if (!block || !def) return 'signal';
    if (block.domain) return block.domain;
    const p = def.ports.find((x) => !x.fixedDomain && ['signal', 'digital', 'complex'].includes(x.domain ?? 'signal'));
    return (p?.domain as BlockDomain | undefined) ?? 'signal';
  });
  const hasSignalPorts = $derived(!!def?.ports.some((p) => !p.fixed && SIGNAL_PATH_DOMAINS.includes(p.domain ?? 'signal')));
  // Missing sheets are reported per page by expand(); loops only show up once the file is flattened.
  const issues = $derived([
    ...editor.flat.issues.filter((m) => m.includes('contains itself')).map((msg): Issue => ({ level: 'error', msg })),
    ...editor.expanded.issues,
  ]);
  const group = $derived(sel.group ? editor.cur.groups?.find((g) => g.id === sel.group) : undefined);
  const note = $derived(sel.note !== null && sel.note !== undefined ? editor.cur.notes?.[sel.note] : undefined);
  const isCustom = $derived(!!block && block.type !== 'sheet' && (block.type === 'custom' || !SYMBOLS[block.type]));
  const customPorts = $derived(block && isCustom ? (block.ports ?? def?.ports ?? []) : []);

  function setPorts(fn: (ports: PortDef[]) => void) {
    if (!block) return;
    editor.updateBlock(block.id, (b) => {
      b.ports = JSON.parse(JSON.stringify(b.ports ?? def?.ports ?? []));
      fn(b.ports!);
      // Offsets aren't editable here: clear them so ports re-spread evenly and the box fits.
      for (const p of b.ports!) delete p.at;
    });
  }

  function addPort() {
    setPorts((ports) => {
      const names = new Set(ports.map((p) => p.name));
      let n = 1;
      while (names.has(`p${n}`)) n++;
      const ins = ports.filter((p) => p.side === 'l').length;
      const outs = ports.filter((p) => p.side === 'r').length;
      ports.push({ name: `p${n}`, side: ins <= outs ? 'l' : 'r', dir: ins <= outs ? 'in' : 'out', signal: 'se' });
    });
  }

  let newKey = $state('');
  let newVal = $state('');

  const paramKeys = $derived.by(() => {
    if (!block || !def) return [];
    const keys = Object.keys(def.params ?? {});
    for (const k of Object.keys(block.params ?? {})) if (!keys.includes(k)) keys.push(k);
    for (const r of ['i', 'q'] as Rail[]) for (const k of Object.keys(block.iqOverride?.[r]?.params ?? {})) if (!keys.includes(k)) keys.push(k);
    return keys;
  });

  function valueFor(b: Block, key: string): ParamValue | undefined {
    const rail = b.iq && editor.railEdit !== 'both' ? editor.railEdit : undefined;
    if (rail && b.iqOverride?.[rail]?.params?.[key] !== undefined) return b.iqOverride[rail]!.params![key];
    return b.params?.[key];
  }

  function setParam(key: string, text: string) {
    if (!block) return;
    const v = parseParam(key, text);
    const rail = block.iq && editor.railEdit !== 'both' ? editor.railEdit : undefined;
    editor.updateBlock(block.id, (b) => {
      if (rail) {
        b.iqOverride ??= {};
        const ov = (b.iqOverride[rail] ??= {});
        ov.params ??= {};
        if (v === undefined || v === b.params?.[key]) delete ov.params[key];
        else ov.params[key] = v;
        if (!Object.keys(ov.params).length) delete ov.params;
        if (!Object.keys(ov).length) delete b.iqOverride[rail];
        if (!Object.keys(b.iqOverride).length) delete b.iqOverride;
      } else {
        b.params ??= {};
        if (v === undefined) delete b.params[key];
        else b.params[key] = v;
        // Editing both rails clears per-rail overrides of this key.
        for (const r of ['i', 'q'] as Rail[]) delete b.iqOverride?.[r]?.params?.[key];
      }
    });
  }

  function toggleShow(key: string) {
    if (!block) return;
    editor.updateBlock(block.id, (b) => {
      const s = new Set(b.show ?? []);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      b.show = [...s];
      if (!b.show.length) delete b.show;
    });
  }

  function removeParam(key: string) {
    if (!block) return;
    editor.updateBlock(block.id, (b) => {
      delete b.params?.[key];
      for (const r of ['i', 'q'] as Rail[]) delete b.iqOverride?.[r]?.params?.[key];
      if (b.show) b.show = b.show.filter((k) => k !== key);
    });
  }

  function addParam() {
    const k = newKey.trim();
    if (!/^[A-Za-z_][\w-]*$/.test(k)) {
      editor.notify('Property names start with a letter: letters, digits, _ and -', 'error');
      return;
    }
    setParam(k, newVal || '?');
    newKey = '';
    newVal = '';
  }

  function selectIssue(i: (typeof issues)[number]) {
    if (i.block) editor.sel = { blocks: [i.block], conn: null };
    else if (i.conn !== undefined) editor.sel = { blocks: [], conn: i.conn };
  }

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };
</script>

<aside class="props">
  {#if block && def}
    <h2>{def.name}</h2>
    <div class="field">
      <label for="p-id">ID</label>
      <input id="p-id" value={block.id} onkeydown={onEnter} onchange={(e) => editor.rename(block.id, e.currentTarget.value.trim())} spellcheck="false" />
    </div>
    <div class="field">
      <label for="p-label">Label</label>
      <input
        id="p-label"
        value={editor.railEdit !== 'both' && block.iq ? (block.iqOverride?.[editor.railEdit]?.label ?? '') : (block.label ?? '')}
        placeholder={def.label || '(none)'}
        onkeydown={onEnter}
        onchange={(e) => {
          const v = e.currentTarget.value;
          const rail = block.iq && editor.railEdit !== 'both' ? editor.railEdit : undefined;
          editor.updateBlock(block.id, (b) => {
            if (rail) {
              b.iqOverride ??= {};
              const ov = (b.iqOverride[rail] ??= {});
              if (v === '') delete ov.label;
              else ov.label = v;
            } else if (v === '') delete b.label;
            else b.label = v;
          });
        }}
      />
    </div>
    {#if block.type === 'sheet'}
      <div class="field">
        <label for="p-sheet">Sheet</label>
        <div class="row tight">
          <select id="p-sheet" style="flex:1;min-width:0" value={block.sheet ?? ''} onchange={(e) => editor.setSheet(block.id, e.currentTarget.value)}>
            {#if !block.sheet || !editor.doc.sheets?.[block.sheet]}<option value={block.sheet ?? ''}>{block.sheet ?? '(none)'} (missing)</option>{/if}
            {#each sheetNames as n}<option value={n}>{editor.doc.sheets?.[n]?.title && editor.doc.sheets[n].title !== n ? `${n} — ${editor.doc.sheets[n].title}` : n}</option>{/each}
          </select>
          <button class="small" onclick={() => editor.openSheet(block.id)} disabled={!block.sheet || !editor.doc.sheets?.[block.sheet]} title="Open the sheet (double-click the block, or Enter)">Open</button>
        </div>
      </div>
      {#if block.sheet && editor.doc.sheets?.[block.sheet]}
        <div class="field">
          <label for="p-sheetname">Sheet name</label>
          <input id="p-sheetname" value={block.sheet} spellcheck="false" onkeydown={onEnter} onchange={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== block.sheet && !editor.renameSheet(block.sheet!, v)) {
              editor.notify('Sheet names are letters, digits, _ and -, and must be unique', 'error');
              e.currentTarget.value = block.sheet!;
            }
          }} />
        </div>
        <p class="hint">Ports come from the sheet's input and output port blocks. Every block using "{block.sheet}" shares its contents.</p>
      {/if}
    {/if}
    {#if block.type === 'mixer'}
      <div class="opts">
        <span class="lbl">Output</span>
        <div class="seg" role="group" aria-label="Mixer output">
          <button class:on={block.params?.mix !== 'sum'} onclick={() => editor.updateBlock(block.id, (b) => { if (b.params) delete b.params.mix; })} title="|RF − LO| (downconversion)">Difference</button>
          <button class:on={block.params?.mix === 'sum'} onclick={() => editor.updateBlock(block.id, (b) => { b.params = { ...(b.params ?? {}), mix: 'sum' }; })} title="RF + LO (upconversion)">Sum</button>
        </div>
      </div>
    {/if}
    <div class="opts">
      {#if def.dsp}
        <span class="lbl">Domain</span>
        <div class="seg" role="group" aria-label="Domain">
          {#each [['signal', 'Analog'], ['digital', 'Digital'], ['complex', 'Complex']] as [d, name]}
            <button class:on={blockDomain === d} onclick={() => editor.setBlockStyle(block.id, { domain: d as BlockDomain })} title={d === 'complex' ? 'Complex (I+jQ) samples on one line' : d === 'digital' ? 'Real-valued samples or a bus' : 'Analog signal'}>{name}</button>
          {/each}
        </div>
      {/if}
      {#if hasSignalPorts && blockDomain === 'signal' && block.type !== 'sheet'}
        <span class="lbl">Signal</span>
        <div class="seg" role="group" aria-label="Signal">
          <button class:on={(block.signal ?? 'se') === 'se'} onclick={() => editor.setBlockStyle(block.id, { signal: 'se' })}>Single-ended</button>
          <button class:on={block.signal === 'diff'} onclick={() => editor.setBlockStyle(block.id, { signal: 'diff' })}>Differential</button>
        </div>
      {/if}
      {#if blockDomain !== 'complex' && block.type !== 'sheet'}
        <span class="lbl">Path</span>
        <div class="seg" role="group" aria-label="Path">
          <button class:on={!block.iq} onclick={() => editor.setBlockStyle(block.id, { iq: false })}>Single</button>
          <button class:on={!!block.iq} onclick={() => editor.setBlockStyle(block.id, { iq: true })} title="Drawn as linked I and Q blocks">I/Q pair</button>
        </div>
      {/if}
      {#if block.iq}
        <span class="lbl">Edit</span>
        <div class="row tight">
          <div class="seg" role="group" aria-label="Rail to edit">
            {#each ['both', 'i', 'q'] as r}
              <button class:on={editor.railEdit === r} onclick={() => (editor.railEdit = r as typeof editor.railEdit)}>{r === 'both' ? 'Both' : r.toUpperCase() + ' only'}</button>
            {/each}
          </div>
          <button class="small" onclick={() => editor.unlinkPair(block.id)} title="Split into two independent blocks">Unlink</button>
        </div>
      {/if}
      {#if def.variants}
        <span class="lbl">Variant</span>
        <div class="seg" role="group" aria-label="Variant">
          <button class:on={!block.variant} onclick={() => editor.updateBlock(block.id, (b) => delete b.variant)}>{def.variants.adjustable ? 'Fixed' : 'Standard'}</button>
          {#each Object.entries(def.variants) as [vk, v]}
            <button class:on={block.variant === vk} onclick={() => editor.updateBlock(block.id, (b) => (b.variant = vk))}>{v.name}</button>
          {/each}
        </div>
      {/if}
      <span class="lbl">Orient</span>
      <div class="row tight">
        <div class="seg" role="group" aria-label="Orientation">
          <button onclick={() => editor.rotateSelection()} title="Rotate 90° (R)">⟳ Rotate</button>
          <button class:on={!!block.flip} onclick={() => editor.flipSelection(false)} title="Flip horizontally (F)">⇋</button>
          <button class:on={!!block.flipV} onclick={() => editor.flipSelection(true)} title="Flip vertically (Shift+F)">⇅</button>
        </div>
        {#if block.rot}<span class="hint">{block.rot}°</span>{/if}
      </div>
    </div>

    {#if isCustom}
      <h3>Ports</h3>
      <div class="ports">
        {#each customPorts as p, pi (pi + p.name)}
          <div class="prow">
            <input value={p.name} aria-label="Port name" spellcheck="false" onkeydown={onEnter} onchange={(e) => {
              const v = e.currentTarget.value.trim();
              if (block.ports) {
                if (!editor.renamePort(block.id, p.name, v)) editor.notify('Port names must be unique: letters, digits, _ and -', 'error');
              } else setPorts((ports) => (ports[pi].name = v));
            }} />
            <select value={p.side} aria-label="Side" onchange={(e) => setPorts((ports) => { ports[pi].side = e.currentTarget.value as PortDef['side']; delete ports[pi].at; })}>
              <option value="l">left</option><option value="r">right</option><option value="t">top</option><option value="b">bottom</option>
            </select>
            <select value={p.dir} aria-label="Direction" onchange={(e) => setPorts((ports) => (ports[pi].dir = e.currentTarget.value as PortDef['dir']))}>
              <option value="in">in</option><option value="out">out</option><option value="bi">bi</option>
            </select>
            <select value={p.domain ?? 'signal'} aria-label="Domain" onchange={(e) => setPorts((ports) => (ports[pi].domain = e.currentTarget.value as Domain))}>
              {#each DOMAINS as d}<option value={d}>{d}</option>{/each}
            </select>
            <button class="icon" title="Remove port" aria-label="Remove port" onclick={() => (block.ports ? editor.removePort(block.id, p.name) : setPorts((ports) => ports.splice(pi, 1)))}>×</button>
            {#if p.domain === 'digital'}
              <input class="w" type="number" min="1" value={p.width ?? ''} placeholder="width" aria-label="Bus width" onchange={(e) => setPorts((ports) => { const v = Number(e.currentTarget.value); if (v > 0) ports[pi].width = v; else delete ports[pi].width; })} />
            {/if}
          </div>
        {/each}
      </div>
      <div class="row"><button class="small" onclick={addPort}>Add port</button><span class="hint">Ports named i / q make this a split or merge block.</span></div>
      <div class="row">
        <span class="hint">Size</span>
        <input class="num" type="number" min="4" step="2" value={block.size?.[0] ?? ''} placeholder={String(def.size[0])} aria-label="Width" onchange={(e) => editor.updateBlock(block.id, (b) => { const w = Number(e.currentTarget.value); if (w >= 4) b.size = [w, b.size?.[1] ?? def.size[1]]; else delete b.size; })} />
        ×
        <input class="num" type="number" min="4" step="2" value={block.size?.[1] ?? ''} placeholder={String(def.size[1])} aria-label="Height" onchange={(e) => editor.updateBlock(block.id, (b) => { const h = Number(e.currentTarget.value); if (h >= 4) b.size = [b.size?.[0] ?? def.size[0], h]; else delete b.size; })} />
        <span class="hint">grid units</span>
      </div>
      <div class="field col">
        <label for="p-icon">Icon (SVG path, grid units)</label>
        <textarea id="p-icon" rows="2" spellcheck="false" placeholder="e.g. M2,2 L6,4 L2,6 Z" value={block.icon ?? ''} onchange={(e) => editor.updateBlock(block.id, (b) => { const v = e.currentTarget.value.trim(); if (v) b.icon = v; else delete b.icon; })}></textarea>
      </div>
    {/if}

    {#if block.type !== 'sheet'}
    <h3>Properties</h3>
    {#if !paramKeys.length}<p class="hint">No properties yet.</p>{/if}
    {#each paramKeys as key (key)}
      {@const meta = RESERVED[key]}
      {@const shown = block.show?.includes(key)}
      <div class="param">
        <label for={`pp-${key}`} title={meta ? `${meta.name} (${meta.unit || 'count'})` : 'Custom property'}>{meta ? meta.name : key}</label>
        <input id={`pp-${key}`} value={editText(key, valueFor(block, key))} placeholder={meta?.unit ?? ''} onkeydown={onEnter} onchange={(e) => setParam(key, e.currentTarget.value)} spellcheck="false" />
        <button class="icon" class:on={shown} onclick={() => toggleShow(key)} title={shown ? 'Shown on diagram' : 'Show on diagram'} aria-label="Show on diagram">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="8" cy="8" r="2" fill={shown ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.3" />{#if !shown}<path d="M2 14 14 2" stroke="currentColor" stroke-width="1.3" />{/if}</svg>
        </button>
        {#if !(def.params && key in def.params)}
          <button class="icon" onclick={() => removeParam(key)} title="Remove" aria-label="Remove property">×</button>
        {/if}
      </div>
    {/each}
    <div class="param add">
      <input placeholder="name" bind:value={newKey} onkeydown={(e) => e.key === 'Enter' && addParam()} spellcheck="false" />
      <input placeholder="value" bind:value={newVal} onkeydown={(e) => e.key === 'Enter' && addParam()} spellcheck="false" />
      <button class="small" onclick={addParam}>Add</button>
    </div>
    <p class="hint">Accepts units: 2.44G, 20 MHz, -3 dB, 30 dBm.</p>
    {/if}
    <div class="row end"><button class="small danger" onclick={() => editor.deleteSelection()}>Delete block</button></div>
  {:else if multi.length}
    <h2>{multi.length} blocks</h2>
    <div class="row">
      <button class="small" onclick={() => editor.rotateSelection()}>Rotate</button>
      <button class="small" onclick={() => editor.flipSelection()}>Flip</button>
      <button class="small" onclick={() => editor.autoLayout()} title="Re-run auto-layout on the selection">Tidy</button>
      <button class="small" onclick={() => editor.groupSelection()} title="Group (G)">Group</button>
      <button class="small" onclick={() => editor.makeSheet()} title="Move the selection into a new sheet (hierarchical block)">Make sheet</button>
      <button class="small" onclick={() => editor.duplicate()} title="Duplicate (Ctrl+D)">Duplicate</button>
      <button class="small danger" onclick={() => editor.deleteSelection()}>Delete</button>
    </div>
    <h3>Align</h3>
    <div class="row">
      <div class="seg" role="group" aria-label="Align horizontally">
        <button onclick={() => editor.align('left')} title="Align left edges">Left</button>
        <button onclick={() => editor.align('center')} title="Align centers">Center</button>
        <button onclick={() => editor.align('right')} title="Align right edges">Right</button>
      </div>
      <div class="seg" role="group" aria-label="Align vertically">
        <button onclick={() => editor.align('top')} title="Align tops">Top</button>
        <button onclick={() => editor.align('middle')} title="Align signal axis to the first selected block">Middle</button>
        <button onclick={() => editor.align('bottom')} title="Align bottoms">Bottom</button>
      </div>
    </div>
    {#if multi.length >= 3}
      <div class="row">
        <button class="small" onclick={() => editor.distribute('h')}>Distribute horizontally</button>
        <button class="small" onclick={() => editor.distribute('v')}>Vertically</button>
      </div>
    {/if}
    {#if canLink}
      <button class="small" onclick={() => editor.relinkPair(multi[0].id, multi[1].id)}>Link as I/Q pair</button>
    {/if}
  {:else if group}
    <h2>Group</h2>
    <div class="field">
      <label for="g-label">Label</label>
      <input id="g-label" value={group.label ?? ''} onkeydown={onEnter} onchange={(e) => {
        const v = e.currentTarget.value;
        editor.edit((d) => {
          const g = d.groups?.find((x) => x.id === group.id);
          if (!g) return false;
          if (v) g.label = v;
          else delete g.label;
        });
      }} />
    </div>
    <p class="hint">{group.members.join(', ')}</p>
    <div class="row">
      <button class="small" onclick={() => (editor.sel = { blocks: [...group.members], conn: null })}>Select members</button>
      <button class="small danger" onclick={() => editor.deleteSelection()}>Ungroup</button>
    </div>
  {:else if note}
    <h2>Note</h2>
    <textarea rows="4" value={note.text} aria-label="Note text" onchange={(e) => {
      const v = e.currentTarget.value;
      const i = sel.note!;
      editor.edit((d) => {
        if (d.notes?.[i]) d.notes[i].text = v || 'Note';
      });
    }}></textarea>
    <p class="hint">Drag the note on the canvas to move it.</p>
    <div class="row end"><button class="small danger" onclick={() => editor.deleteSelection()}>Delete note</button></div>
  {:else if conn}
    <h2>Connection</h2>
    <p class="mono">{conn.from} → {conn.to}</p>
    <div class="field">
      <label for="c-label">Label</label>
      <input id="c-label" value={conn.label ?? ''} placeholder="e.g. −30 dBm" onkeydown={onEnter} onchange={(e) => {
        const v = e.currentTarget.value;
        editor.updateConn(sel.conn!, (c) => (v ? (c.label = v) : delete c.label));
      }} />
    </div>
    <div class="field">
      <label for="c-dom">Domain</label>
      <select id="c-dom" value={conn.domain ?? ''} onchange={(e) => {
        const v = e.currentTarget.value as Domain | '';
        editor.updateConn(sel.conn!, (c) => (v ? (c.domain = v) : delete c.domain));
      }}>
        <option value="">From ports</option>
        {#each DOMAINS as d}<option value={d}>{d}</option>{/each}
      </select>
    </div>
    <div class="row end"><button class="small danger" onclick={() => editor.deleteSelection()}>Delete connection</button></div>
  {:else}
    <h2>{editor.sheetPath.length ? 'Sheet' : 'Diagram'}</h2>
    <div class="field">
      <label for="d-title">Title</label>
      <input id="d-title" value={editor.cur.title ?? ''} onkeydown={onEnter} onchange={(e) => {
        const v = e.currentTarget.value;
        editor.edit((d) => {
          d.title = v || undefined;
        });
      }} />
    </div>
    <div class="row">
      <span class="hint">Theme</span>
      <div class="seg" role="group" aria-label="Theme">
        <button class:on={(editor.doc.theme ?? 'mono') === 'mono'} onclick={() => editor.edit((d) => { delete d.theme; })}>Mono</button>
        <button class:on={editor.doc.theme === 'color'} onclick={() => editor.edit((d) => { d.theme = 'color'; })}>Color</button>
      </div>
    </div>
    <label class="toggle"><input type="checkbox" checked={editor.doc.style?.hops !== false} onchange={(e) => {
      const on = e.currentTarget.checked;
      editor.edit((d) => { d.style ??= {}; if (on) delete d.style.hops; else d.style.hops = false; if (!Object.keys(d.style).length) delete d.style; });
    }} /><span class="track"></span> Hop over crossing wires</label>
    <label class="toggle"><input type="checkbox" checked={!!editor.doc.style?.pmMarks} onchange={(e) => {
      const on = e.currentTarget.checked;
      editor.edit((d) => { d.style ??= {}; if (on) d.style.pmMarks = true; else delete d.style.pmMarks; if (!Object.keys(d.style).length) delete d.style; });
    }} /><span class="track"></span> Mark differential pins + / −</label>
    <p class="hint">{editor.cur.blocks.length} blocks · {editor.cur.connections.length} connections</p>
    {#if sheetNames.length}
      <h3>Sheets</h3>
      <ul class="sheets">
        {#each sheetNames as n}
          <li>
            <span class="mono">{n}</span>
            {#if editor.doc.sheets?.[n]?.title && editor.doc.sheets[n].title !== n}<span class="hint">{editor.doc.sheets[n].title}</span>{/if}
            {#if unused.has(n)}
              <span class="hint">unused</span>
              <button class="small danger" onclick={() => editor.deleteSheet(n)}>Delete</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <h3>Checks</h3>
    {#if !issues.length && !editor.loadWarnings.length}<p class="hint ok">No problems found.</p>{/if}
    <ul class="issues">
      {#each issues as i}
        <li class={i.level}><button onclick={() => selectIssue(i)}>{i.msg}</button></li>
      {/each}
      {#each editor.loadWarnings as w}
        <li class="warning"><span>Schema: {w}</span></li>
      {/each}
    </ul>
    <h3>Shortcuts</h3>
    <dl class="keys">
      <dt>Drag port → port</dt><dd>Connect</dd>
      <dt>Space + drag / middle</dt><dd>Pan</dd>
      <dt>Wheel</dt><dd>Zoom</dd>
      <dt>R / F / ⇧F</dt><dd>Rotate / flip / flip vertical</dd>
      <dt>Del</dt><dd>Delete</dd>
      <dt>L</dt><dd>Auto-layout</dd>
      <dt>/</dt><dd>Quick add at pointer</dd>
      <dt>Tab</dt><dd>Add next block in chain</dd>
      <dt>G / N</dt><dd>Group selection / add note</dd>
      <dt>Ctrl C / V / D</dt><dd>Copy / paste / duplicate</dd>
      <dt>Drag wire</dt><dd>Reroute (dbl-click resets)</dd>
      <dt>0</dt><dd>Fit</dd>
      <dt>Ctrl Z / Ctrl ⇧ Z</dt><dd>Undo / redo</dd>
      <dt>Ctrl V</dt><dd>Paste a .sig.json</dd>
    </dl>
  {/if}
</aside>

<style>
  .props {
    width: 280px;
    flex: none;
    overflow-y: auto;
    border-left: 1px solid var(--line);
    background: var(--panel);
    padding: 14px 14px 24px;
    font-size: 13px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 600;
  }
  h3 {
    margin: 18px 0 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .field {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .field label,
  .param label {
    color: var(--muted);
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
    flex-wrap: wrap;
  }
  .ports {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .prow {
    display: grid;
    grid-template-columns: 1fr 62px 52px 64px 16px;
    gap: 3px;
    align-items: center;
  }
  .prow select,
  .prow input {
    padding: 3px 4px;
    font-size: 12px;
  }
  .prow .w {
    grid-column: 1 / 3;
  }
  .num {
    width: 58px;
  }
  .field.col {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  textarea {
    width: 100%;
    font: inherit;
    font-size: 12px;
    padding: 5px 7px;
    border: 1px solid var(--line);
    border-radius: 6px;
    resize: vertical;
  }
  .opts {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: center;
    gap: 7px 8px;
    margin: 10px 0 4px;
  }
  .lbl {
    color: var(--muted);
    font-size: 12px;
  }
  .row.tight {
    margin: 0;
  }
  .row.end {
    margin-top: 18px;
  }
  .param {
    display: grid;
    grid-template-columns: 92px 1fr 26px 18px;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
  }
  .param label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .param.add {
    grid-template-columns: 92px 1fr auto;
    margin-top: 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
  }
  .check.left {
    margin: 6px 0;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: none;
    padding: 4px 9px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    color: var(--text);
  }
  .seg button + button {
    border-left: 1px solid var(--line);
  }
  .seg button.on {
    background: var(--text);
    color: #fff;
  }
  .icon {
    border: none;
    background: none;
    padding: 2px;
    cursor: pointer;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
  }
  .icon.on {
    color: var(--accent);
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    margin: 4px 0;
  }
  .hint.ok {
    color: #2b8a57;
  }
  .mono {
    font-family: var(--mono);
    font-size: 12px;
    word-break: break-all;
  }
  .issues {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .issues li {
    border-left: 3px solid;
    padding: 4px 6px;
    margin-bottom: 4px;
    background: #fff;
    font-size: 12px;
    border-radius: 0 4px 4px 0;
  }
  .issues li.error {
    border-color: #e5484d;
  }
  .issues li.warning {
    border-color: #f5a524;
  }
  .issues button {
    all: unset;
    cursor: pointer;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    font-size: 12px;
    margin: 0;
  }
  .keys dt {
    color: var(--muted);
  }
  .keys dd {
    margin: 0;
  }
  .sheets {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    font-size: 12.5px;
  }
  .sheets li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }
  .sheets .mono {
    font-family: var(--mono);
  }
  .sheets button {
    margin-left: auto;
  }
</style>
