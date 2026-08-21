/**
 * The Firestore instance, deliberately in its own module.
 *
 * `firebase/firestore` is ~80 kB gzipped — the single heaviest dependency in the
 * app. While `db` was created inside `lib/firebase.ts`, every module that
 * touched auth also dragged Firestore in, which put it on the boot path for
 * every cold start including signed-out ones that never query anything.
 *
 * Splitting it means:
 *   • signed-out users never download Firestore at all;
 *   • signed-in users get it warmed in parallel from the first frame
 *     (see `warmDataLayer` in lib/prefetch.ts), so nothing is serialised behind
 *     auth resolving;
 *   • `lib/firebase.ts` must never import this module statically — only via
 *     `await import()` — or the whole point is undone. There is a regression
 *     test for exactly that in scripts/perf-proof.mjs.
 */

import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

import { app, firebaseConfig } from './firebase';

/**
 * Persistent (IndexedDB) cache: profile/meals/workouts render instantly from
 * disk on reopen and sync in the background — the app stays usable offline and
 * cold starts stop waiting on the network. The multi-tab manager keeps the PWA
 * safe when open in more than one tab and falls back gracefully where
 * unsupported.
 */
export const db = initializeFirestore(
  app,
  { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
  firebaseConfig.firestoreDatabaseId,
);
