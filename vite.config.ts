import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// `base: './'` keeps the build relocatable, so it works on GitHub Pages under /lineup/.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { chunkSizeWarningLimit: 1600 },
  test: { include: ['tests/**/*.test.ts'] },
});
