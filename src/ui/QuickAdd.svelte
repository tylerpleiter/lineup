<script lang="ts">
  // Type-to-add box: "/" places a block at the pointer, Tab chains one after the selection.
  import { editor } from '../editor/store.svelte';
  import { SYMBOLS, CATEGORY_NAMES } from '../model/symbols';
  import { ALIASES } from '../model/aliases';

  let q = $state('');
  let idx = $state(0);
  let input = $state<HTMLInputElement>();

  // Core symbols plus aliases ("lna" → Amplifier labelled LNA) so people can type the names they use.
  type Entry = { id: string; name: string; category: string; label?: string; via?: string };
  const all: Entry[] = [
    ...Object.values(SYMBOLS).map((d) => ({ id: d.id, name: d.name, category: d.category, label: d.label })),
    ...Object.entries(ALIASES).map(([id, a]) => ({ id, name: a.label ?? id.toUpperCase(), category: SYMBOLS[a.type]?.category ?? 'generic', label: a.label, via: SYMBOLS[a.type]?.name ?? a.type })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const results = $derived.by(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.slice(0, 12);
    const scored = all
      .map((d) => {
        const id = d.id.toLowerCase();
        const name = d.name.toLowerCase();
        const score = id === s ? 0 : id.startsWith(s) ? 1 : name.startsWith(s) ? 2 : id.includes(s) ? 3 : name.includes(s) ? 4 : (d.label ?? '').toLowerCase().includes(s) ? 5 : 99;
        return { d, score };
      })
      .filter((x) => x.score < 99)
      .sort((a, b) => a.score - b.score || a.d.name.localeCompare(b.d.name));
    return scored.slice(0, 12).map((x) => x.d);
  });

  $effect(() => {
    void q;
    idx = 0;
  });
  $effect(() => {
    input?.focus();
  });

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') idx = Math.min(results.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') idx = Math.max(0, idx - 1);
    else if (e.key === 'Enter' && results[idx]) editor.quickPick(results[idx].id);
    else if (e.key === 'Escape' || (e.key === 'Tab' && !q)) editor.quickAdd = null;
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

{#if editor.quickAdd}
  {@const qa = editor.quickAdd}
  <div class="qa" style:left={`${Math.max(8, Math.min(qa.sx, editor.viewport.w - 290))}px`} style:top={`${Math.max(8, Math.min(qa.sy, editor.viewport.h - 330))}px`}>
    <div class="head">{qa.chain ? `Add after ${qa.chain}` : 'Add block'}</div>
    <input bind:this={input} bind:value={q} onkeydown={key} onblur={() => setTimeout(() => (editor.quickAdd = null), 120)} placeholder="Type a block: lna, bpf, mixer…" spellcheck="false" aria-label="Block type" />
    <ul>
      {#each results as d, i (d.id)}
        <li>
          <button class:on={i === idx} onmousedown={(e) => e.preventDefault()} onclick={() => editor.quickPick(d.id)} onmouseenter={() => (idx = i)}>
            <span>{d.name}</span><code>{d.id}</code><em>{d.via ? `${d.via}` : (CATEGORY_NAMES[d.category] ?? '')}</em>
          </button>
        </li>
      {:else}
        <li class="none">No match</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .qa {
    position: absolute;
    z-index: 20;
    width: 280px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 10px 32px rgba(15, 23, 42, 0.16);
    padding: 8px;
  }
  .head {
    font-size: 11px;
    color: var(--muted);
    margin: 0 2px 6px;
  }
  input {
    width: 100%;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    max-height: 260px;
    overflow-y: auto;
  }
  button {
    all: unset;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 1fr auto;
    width: 100%;
    padding: 5px 7px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  button.on {
    background: var(--hover);
  }
  code {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }
  em {
    grid-column: 1 / -1;
    font-style: normal;
    font-size: 11px;
    color: var(--muted);
  }
  .none {
    color: var(--muted);
    padding: 6px;
  }
</style>
