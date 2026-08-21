import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'logo.svg', 'logo-mark.svg', 'maskable-icon.svg', 'icons/*.webp'],
        manifest: {
          name: 'FitFlow — Train smarter. Move farther.',
          short_name: 'FitFlow',
          description: 'AI-personalized workouts, nutrition, recovery, and community. All-in-one fitness, built to replace the rest.',
          theme_color: '#06070A',
          background_color: '#06070A',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          categories: ['health', 'fitness', 'lifestyle'],
          icons: [
            { src: '/icons/icon-72.webp',  sizes: '72x72',   type: 'image/webp', purpose: 'any' },
            { src: '/icons/icon-96.webp',  sizes: '96x96',   type: 'image/webp', purpose: 'any' },
            { src: '/icons/icon-128.webp', sizes: '128x128', type: 'image/webp', purpose: 'any' },
            { src: '/icons/icon-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'any' },
            { src: '/icons/icon-256.webp', sizes: '256x256', type: 'image/webp', purpose: 'any' },
            { src: '/icons/icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any' },
            { src: '/icons/icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'maskable' },
            { src: '/logo.svg',            sizes: 'any',     type: 'image/svg+xml', purpose: 'any' },
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 3000000,
          // Take over immediately on update and purge stale precaches so a new
          // deploy can never leave a returning user on a broken half-cached app.
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          // Firebase reserves /__/auth/* and /__/firebase/* for OAuth handlers and SDK init.
          // If the service worker serves the SPA shell for these, sign-in redirect breaks.
          // /delete-account is a static HTML page (Play data-deletion URL) — never serve the SPA shell for it.
          navigateFallbackDenylist: [/^\/__\//, /^\/delete-account$/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'unsplash-images',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        }
      })
    ],
    define: {
      // SECURITY: the client bundle NEVER carries a Gemini key — under any mode
      // or env combination. Every AI call routes through the geminiProxy Cloud
      // Function (VITE_GEMINI_PROXY_URL); without a proxy URL the app degrades
      // to its deterministic fallbacks. The old conditional here inlined the raw
      // key whenever the proxy URL was absent at build time, which is exactly
      // how it leaked into the v1.4.0 APK/AAB. The only legitimate consumers of
      // a raw GEMINI_API_KEY are the Node proof harnesses, which read the real
      // process.env at runtime — this define never touches those.
      // `npm run build` also runs scripts/scan-bundle-secrets.mjs as a hard gate.
      'process.env.GEMINI_API_KEY': JSON.stringify(''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('node_modules')) return;
            // three.js only ever arrives through the lazily-loaded Lab route, so
            // giving it its own chunk keeps it cacheable across Lab updates.
            if (id.includes('node_modules/three/')) return 'three';
            // Redux sits on the critical path (the Provider is at the app root),
            // so it gets a named chunk rather than being folded into a page.
            if (
              id.includes('@reduxjs/toolkit') ||
              id.includes('react-redux') ||
              id.includes('node_modules/redux') ||
              id.includes('reselect') ||
              id.includes('node_modules/immer')
            ) {
              return 'redux';
            }
            if (id.includes('firebase/firestore')) return 'firebase-firestore';
            if (id.includes('firebase/auth')) return 'firebase-auth';
            if (id.includes('firebase/messaging')) return 'firebase-messaging';
            if (id.includes('firebase/app') || id.includes('@firebase')) return 'firebase-core';
            if (id.includes('recharts') || id.includes('victory-vendor') || id.includes('d3-')) return 'charts';
            if (id.includes('motion')) return 'motion';
            if (id.includes('react-router')) return 'router';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('html5-qrcode')) return 'qrcode';
            if (id.includes('@google/genai')) return 'gemini';
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('react/') || id.includes('react-is')) return 'react';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['.trycloudflare.com', '.loca.lt', '.ngrok-free.app', '.ngrok.io'],
    },
  };
});
