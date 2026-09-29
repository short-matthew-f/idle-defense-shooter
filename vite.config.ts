import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';

// Base path: GitHub Pages serves the repo at /idle-defense-shooter/.
export default defineConfig({
  base: process.env.CITADEL_BASE ?? '/idle-defense-shooter/',
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Project Citadel',
        short_name: 'Citadel',
        description: 'An idle tower-defense game where the tower is the character.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
