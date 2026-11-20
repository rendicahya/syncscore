/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Served from https://<user>.github.io/syncscore/
  base: '/syncscore/',
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
