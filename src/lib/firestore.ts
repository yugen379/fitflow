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

import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

import { app, firebaseConfig } from './firebase';

/**
 * Persistent (IndexedDB) cache: profile/meals/workouts render instantly from
 * disk on reopen and sync in the background — the app stays usable offline and
 * cold starts stop waiting on the network. The multi-tab manager keeps the PWA
 * safe when open in more than one tab and falls back gracefully where
 * unsupported.
 */
/**
 * Create the Firestore instance, degrading rather than failing.
 *
 * The persistent cache is worth having, but it is NOT worth the app for. It
 * depends on IndexedDB, and the multi-tab manager additionally depends on a
 * leader election across tabs — both of which can fail or stall on a real
 * phone: private browsing, storage pressure, a corrupted database, or several
 * tabs of the app open at once (a user reported exactly that, with four tabs).
 *
 * When it stalls there is no error to catch. The snapshot listener simply never
 * fires, which is indistinguishable from a dead network and is how the app came
 * to sit on "Loading your training data" indefinitely.
 *
 * So each level falls back to a simpler one. Losing offline persistence costs a
 * slower cold start; losing Firestore costs the entire app.
 */
const createDb = (): Firestore => {
  const databaseId = firebaseConfig.firestoreDatabaseId;

  try {
    return initializeFirestore(
      app,
      { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
      databaseId,
    );
  } catch (error) {
    console.warn('Firestore persistent cache unavailable, falling back to memory:', error);
  }

  try {
    // No IndexedDB, no leader election — just an in-memory cache. Every read
    // costs the network, but reads WORK.
    return initializeFirestore(app, { localCache: memoryLocalCache() }, databaseId);
  } catch (error) {
    console.warn('Firestore memory cache init failed, using defaults:', error);
  }

  // `initializeFirestore` also throws if it has already run for this app, in
  // which case the existing instance is the right answer.
  return getFirestore(app, databaseId);
};

export const db = createDb();

/**
 * Tear down an `onSnapshot` listener without ever throwing.
 *
 * The Firestore JS SDK can throw `INTERNAL ASSERTION FAILED: Unexpected state`
 * out of `unsubscribe()` when its async queue is torn down while a watch-stream
 * change is still in flight — most easily reproduced by unmounting a screen
 * whose listener has just errored (a permission denial, or going offline), and
 * made more likely by React StrictMode's deliberate mount/unmount/mount cycle.
 *
 * Because that throw happens inside an effect CLEANUP, React treats it as a
 * render-phase error and unmounts the whole subtree into the nearest error
 * boundary. In other words, a failure to stop listening takes down the entire
 * page — which is never the right trade. This was doing exactly that to the
 * Track screen.
 *
 * Detaching a listener has no meaningful failure mode for the user, so
 * swallowing the error is correct rather than merely convenient: worst case the
 * SDK has already released it.
 */
export const safeUnsubscribe = (unsubscribe?: (() => void) | null): void => {
  if (typeof unsubscribe !== 'function') return;
  try {
    unsubscribe();
  } catch {
    // Already torn down, or the SDK's internal queue is in a bad state. Either
    // way there is nothing left for the caller to do about it.
  }
};
