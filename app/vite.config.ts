import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' lets us show a toast when a new SW is waiting, instead of
      // silently replacing the bundle (which surfaces as "still serving the
      // old build on the first navigation after a deploy").
      registerType: 'prompt',
      injectRegister: 'auto',
      workbox: {
        // Only cache the app shell — Firestore data flows through onSnapshot
        // and its own offline persistence, not the service worker.
        globPatterns: ['**/*.{js,css,html,ico,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Comandas — La Charcutería',
        short_name: 'Comandas',
        description: 'Pedidos y fulfillment para La Charcutería Artesanal',
        lang: 'es-CL',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#faf7f2',
        theme_color: '#221c17',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173 },
});
