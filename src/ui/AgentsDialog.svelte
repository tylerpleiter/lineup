<script lang="ts">
  // How to use Lineup with AI agents: the sig-diagrams skill, and a prompt for agents without skills.
  import { FORMAT_URL, SKILL_URL, SKILL_ZIP, SYMBOLS_URL } from '../config';
  import { editor } from '../editor/store.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let tab = $state<'code' | 'app' | 'other'>('code');

  const prompt = `I use Lineup (signal diagrams saved as .sig.json). Before creating or editing one, read the format guide ${FORMAT_URL} and the block/port reference ${SYMBOLS_URL}. Write blocks and connections only (no x/y; Lineup lays it out). If I give you an SVG or PNG exported from Lineup, the exact diagram JSON is embedded in it: a <metadata id="sig-source"> element in SVGs, an iTXt chunk named "sig.json" in PNGs.`;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      editor.notify(`Copied ${what}`);
    } catch {
      editor.notify("Couldn't access the clipboard", 'error');
    }
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={key} />

<div class="backdrop" role="presentation" onclick={onclose}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="agents-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => {
    // Keep editor shortcuts (R, Del, …) away from the canvas while the dialog is open.
    e.stopPropagation();
    if (e.key === 'Escape') onclose();
  }}>
    <header>
      <h2 id="agents-title">Use Lineup with AI agents</h2>
      <button class="x" onclick={onclose} aria-label="Close">×</button>
    </header>
    <p>
      The <strong>sig-diagrams</strong> skill teaches agents like Claude Code and Gemini CLI to create, edit, check and explain <code>.sig.json</code> diagrams. Diagrams you export as SVG or PNG carry their source, so an agent can read an image from an issue exactly.
    </p>
    <div class="actions">
      <a class="primary" href={SKILL_ZIP} download="sig-diagrams-skill.zip">Download skill (.zip)</a>
      <a href={SKILL_URL} target="_blank" rel="noopener">View on GitHub</a>
    </div>

    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'code'} class:on={tab === 'code'} onclick={() => (tab = 'code')}>Claude Code</button>
      <button role="tab" aria-selected={tab === 'app'} class:on={tab === 'app'} onclick={() => (tab = 'app')}>Claude app</button>
      <button role="tab" aria-selected={tab === 'other'} class:on={tab === 'other'} onclick={() => (tab = 'other')}>Other agents</button>
    </div>

    {#if tab === 'code'}
      <ol>
        <li>Unzip the download. You get a <code>sig-diagrams</code> folder.</li>
        <li>Move it to <code>.claude/skills/</code> in your project (shared with everyone on the repo), or to <code>~/.claude/skills/</code> for all your projects.</li>
        <li>Ask for a diagram, e.g. <em>"Draw the RX chain from this datasheet as rx.sig.json"</em>. Claude loads the skill on its own; you can also type <code>/sig-diagrams</code>.</li>
      </ol>
    {:else if tab === 'app'}
      <ol>
        <li>In Claude's settings, make sure code execution is turned on (Settings → Capabilities).</li>
        <li>Go to Customize → Skills, choose <strong>+</strong> → Create skill → Upload a skill, and pick the downloaded zip as-is.</li>
        <li>In a chat, attach a <code>.sig.json</code> or an exported SVG/PNG, or ask for a new diagram.</li>
      </ol>
      <p class="hint">Skill menus change between app versions; if the steps don't match, search Claude's help for "upload a skill".</p>
    {:else}
      <ol>
        <li>Agents that support the Agent Skills standard can use the unzipped <code>sig-diagrams</code> folder directly; check where your agent looks for skills.</li>
        <li>For any other agent, point it at <code>skills/sig-diagrams/SKILL.md</code> (e.g. from <code>AGENTS.md</code> or <code>GEMINI.md</code>), or paste this prompt:</li>
      </ol>
      <pre>{prompt}</pre>
      <button class="small" onclick={() => copy(prompt, 'prompt')}>Copy prompt</button>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(15, 23, 42, 0.28);
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .dialog {
    width: min(560px, 100%);
    max-height: calc(100vh - 40px);
    overflow-y: auto;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
    padding: 18px 22px 22px;
    font-size: 13px;
    line-height: 1.5;
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .x {
    border: none;
    background: none;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin: 12px 0 16px;
  }
  .actions a {
    padding: 7px 12px;
    border: 1px solid var(--line);
    border-radius: 7px;
    color: var(--text);
    text-decoration: none;
    font-weight: 500;
  }
  .actions a.primary {
    background: var(--text);
    border-color: var(--text);
    color: #fff;
  }
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    border: none;
    background: none;
    padding: 7px 10px;
    font: inherit;
    cursor: pointer;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--text);
  }
  ol {
    padding-left: 20px;
    margin: 12px 0;
  }
  li {
    margin-bottom: 6px;
  }
  code {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--panel);
    padding: 1px 4px;
    border-radius: 4px;
  }
  pre {
    white-space: pre-wrap;
    font-family: var(--mono);
    font-size: 11.5px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 10px;
    margin: 0 0 8px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
  }
</style>
