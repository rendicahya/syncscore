/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Served from https://<user>.github.io/syncscore/
  base: '/syncscore/',
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      // The user decides when a new version is activated (no reload mid-work).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/syncscore/',
        name: 'SyncScore — Smart Grade Synchronization',
        short_name: 'SyncScore',
        description: 'Sinkronisasi nilai mahasiswa dari Sumber ke Target berdasarkan NIM, sepenuhnya di browser.',
        lang: 'id',
        start_url: '/syncscore/',
        scope: '/syncscore/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        categories: ['education', 'productivity', 'utilities'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the static app shell. Student data lives in IndexedDB and is never cached here.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
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
