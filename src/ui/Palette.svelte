<script lang="ts">
  import { CATEGORY_NAMES, CATEGORY_ORDER, SYMBOLS, fillTemplate, symbolFor } from '../model/symbols';
  import { editor } from '../editor/store.svelte';
  import SymbolBody from '../render/SymbolBody.svelte';
  import { MONO } from '../render/theme';
  import { G } from '../model/types';

  let filter = $state('');

  const cats = $derived(
    CATEGORY_ORDER.map((c) => ({
      id: c,
      name: CATEGORY_NAMES[c] ?? c,
      items: Object.values(SYMBOLS)
        .filter((s) => s.category === c)
        .filter((s) => !filter || `${s.id} ${s.name}`.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((c) => c.items.length),
  );

  function iconDef(type: string) {
    return symbolFor({ id: 'icon', type }).def;
  }

  // Thicker icon strokes so small previews read clearly.
  const iconTheme = { ...MONO, body: 2.2 };
</script>

<aside class="palette">
  <input class="search" placeholder="Search blocks" bind:value={filter} aria-label="Search blocks" />
  {#each cats as cat}
    <h3>{cat.name}</h3>
    <div class="grid">
      {#each cat.items as s (s.id)}
        {@const d = iconDef(s.id)}
        {@const m = Math.max(d.size[0], d.size[1])}
        <button
          class="item"
          title={`${s.name} (${s.id}) — click to add, or drag onto the canvas`}
          draggable="true"
          ondragstart={(e) => {
            e.dataTransfer?.setData('application/x-lineup-symbol', s.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
          }}
          onclick={() => editor.addBlock(s.id)}
        >
          <svg viewBox={`${(d.size[0] - m) / 2 - 0.4} ${(d.size[1] - m) / 2 - 0.4} ${m + 0.8} ${m + 0.8}`} width="34" height="34" aria-hidden="true">
            {#each d.ports as p}
              {@const len = p.lead ?? 1}
              {@const at = p.at ?? 0}
              {#if !p.optional}
                {#if p.side === 'l'}<line x1="0" y1={at} x2={len} y2={at} stroke="#000" stroke-width={2.2 / G} />{/if}
                {#if p.side === 'r'}<line x1={d.size[0]} y1={at} x2={d.size[0] - len} y2={at} stroke="#000" stroke-width={2.2 / G} />{/if}
                {#if p.side === 't'}<line x1={at} y1="0" x2={at} y2={len} stroke="#000" stroke-width={2.2 / G} />{/if}
                {#if p.side === 'b'}<line x1={at} y1={d.size[1]} x2={at} y2={d.size[1] - len} stroke="#000" stroke-width={2.2 / G} />{/if}
              {/if}
            {/each}
            <SymbolBody def={d} theme={iconTheme} />
            {#each d.texts ?? [] as t}
              <text x={t.at[0]} y={t.at[1]} font-size={t.size ?? 1} text-anchor="middle" dominant-baseline="central" font-family={MONO.font}>{fillTemplate(t.text, {})}</text>
            {/each}
          </svg>
          <span>{s.name}</span>
        </button>
      {/each}
    </div>
  {/each}
</aside>

<style>
  .palette {
    width: 212px;
    flex: none;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    background: var(--panel);
    padding: 10px 10px 24px;
  }
  .search {
    width: 100%;
    margin-bottom: 4px;
  }
  h3 {
    margin: 14px 2px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 4px 5px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    cursor: grab;
    font: inherit;
    font-size: 11px;
    color: var(--text);
    line-height: 1.15;
    text-align: center;
  }
  .item:hover {
    background: var(--hover);
    border-color: var(--line);
  }
  .item:active {
    cursor: grabbing;
  }
</style>
