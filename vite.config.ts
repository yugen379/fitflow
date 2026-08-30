import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The package a module belongs to, e.g. "recharts" or "@sentry/react".
 *
 * Substring matching on raw ids is how `id.includes('react/')` silently
 * swallowed the entire Sentry SDK — "@sentry/react/" contains "react/" — and
 * pinned ~165 kB gzipped of never-executed code to the critical path. Matching
 * on a real package boundary makes that impossible.
 */
const packageOf = (id: string): string => {
  const match = id.split('\\').join('/').match(/node_modules\/(?:\.pnpm\/)?((?:@[^/]+\/)?[^/]+)/);
  return match ? match[1] : '';
};

/** Small libraries both our code and a vendor bundle pull in. */
const SHARED_RUNTIME = new Set([
  'react',
  'scheduler',
  'react-is',
  'use-sync-external-store',
  'clsx',
  'tailwind-merge',
  'tiny-invariant',
  'object-assign',
]);

const REDUX = new Set(['@reduxjs/toolkit', 'react-redux', 'redux', 'redux-thunk', 'reselect', 'immer']);

const CHARTS = new Set([
  'recharts',
  'victory-vendor',
  'decimal.js-light',
  'internmap',
  'react-smooth',
  'es-toolkit',
  'eventemitter3',
  'fast-equals',
]);

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
          // The pose model + MediaPipe wasm are ~17 MB fetched lazily the first
          // time Form Check opens. Precaching them would make every first load
          // of the app pay for a feature most sessions never touch, so they are
          // excluded here and cached on first use by the runtime rule below.
          globIgnores: ['**/pose/**'],
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
              // Pose model + wasm: immutable, versioned by filename, and huge.
              // CacheFirst means Form Check pays the download once per device
              // and works offline every time after that.
              urlPattern: /\/pose\/.*\.(task|wasm|js)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'pose-model',
                expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
                rangeRequests: true
              }
            },
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
            const name = packageOf(id);
            if (!name) return;

            // Tiny utilities shared between our own code and a heavyweight
            // vendor library. Left unassigned, Rollup is free to file `clsx`
            // (500 bytes) inside the recharts chunk — and then the entry has to
            // download 377 kB of charting to call cn(). Pinning them next to
            // React keeps that class of accident impossible.
            if (SHARED_RUNTIME.has(name)) return 'react';

            // Loaded only through a dynamic import in lib/telemetry.ts, and only
            // when a DSN is configured. It must never be merged into a chunk the
            // entry statically imports.
            if (name.startsWith('@sentry')) return 'sentry';
            if (name === 'posthog-js') return 'posthog';

            if (name === 'three') return 'three';
            if (REDUX.has(name)) return 'redux';

            // Capacitor's runtime is shared by every plugin. Unassigned, Rollup
            // filed it inside whichever plugin chunk it happened to pick, which
            // then had to be fetched eagerly to boot at all.
            if (name === '@capacitor/core') return 'capacitor';

            // Match the umbrella `firebase` package by SUBPATH, never by
            // substring: 'firebase/app-check' is also a substring of
            // '@capacitor-firebase/app-check'.
            const firebasePath = name === 'firebase' ? id.split('/firebase/')[1] ?? '' : '';
            if (name === '@firebase/firestore' || firebasePath.startsWith('firestore')) return 'firebase-firestore';
            if (name === '@firebase/auth' || firebasePath.startsWith('auth')) return 'firebase-auth';
            if (name === '@firebase/messaging' || firebasePath.startsWith('messaging')) return 'firebase-messaging';
            if (name === '@firebase/app-check' || firebasePath.startsWith('app-check')) return 'firebase-appcheck';
            if (name === 'firebase' || name.startsWith('@firebase')) return 'firebase-core';

            if (CHARTS.has(name) || name.startsWith('d3-')) return 'charts';
            if (name === 'motion' || name === 'framer-motion' || name.startsWith('motion-')) return 'motion';
            if (name === 'react-router' || name === 'react-router-dom') return 'router';
            if (name === 'lucide-react') return 'icons';
            if (name === 'html5-qrcode') return 'qrcode';
            if (name === '@google/genai') return 'gemini';
            if (name === 'react-dom') return 'react-dom';
            if (name === 'react') return 'react';

            // Everything else is left to Rollup, which is the right default for
            // long-tail dependencies.
            return undefined;
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
