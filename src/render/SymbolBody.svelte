<script lang="ts">
  // Draws a symbol's body in a group already transformed to grid units.
  import type { SymbolDef } from '../model/types';
  import type { Theme } from './theme';
  import { G } from '../model/types';

  let { def, theme }: { def: SymbolDef; theme: Theme } = $props();
</script>

{#if def.mask}<path d={def.mask} fill={theme.background} stroke="none" />{/if}
{#if def.body}<path d={def.body} fill="none" stroke={theme.stroke} stroke-width={theme.body / G} stroke-linejoin="round" stroke-linecap="round" />{/if}
{#if def.fill}<path d={def.fill} fill={theme.stroke} stroke="none" />{/if}
