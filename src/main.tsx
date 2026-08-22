import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { warmGoogleIdentity } from './lib/gsi';
import { warmDataLayer, preloadAllRoutes, prefetchAllowed } from './lib/prefetch';
import { hasPersistedAuthSession } from './lib/authSession';
import { runPreload, PRELOAD_DEADLINE_MS, ROUTES_GRACE_MS } from './lib/preload';
import type { PreloadTask } from './lib/preload';

// Both are kicked off before React renders and both are mutually exclusive in
// practice: a signed-out user gets the Google sign-in widget warming, a signed-in
// user gets Firestore warming. Neither pays for the other's download, and
// neither blocks anything.
warmGoogleIdentity();
warmDataLayer();

/**
 * Drive the inline splash's progress bar.
 *
 * The splash lives outside React (it is painted from the first HTML response,
 * long before React exists), so it is updated by touching the DOM directly. A
 * CSS custom property carries the width, which keeps the update to a single
 * style write per step rather than a re-render.
 */
const setSplashProgress = (percent: number): void => {
  const splash = document.getElementById('ff-splash');
  if (!splash) return;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  splash.style.setProperty('--ff-progress', `${clamped}%`);
  const label = document.getElementById('ff-pct');
  if (label) label.textContent = clamped >= 100 ? 'Ready' : `Loading ${clamped}%`;
};

/**
 * Retire the inline splash.
 *
 * Removed on the frame *after* React has committed, so there is never a gap
 * where neither the splash nor the app is on screen. If anything here throws,
 * the splash is torn out anyway — a stuck overlay would be worse than a missing
 * fade.
 */
const dismissSplash = () => {
  const splash = document.getElementById('ff-splash');
  if (!splash) return;
  requestAnimationFrame(() => {
    splash.setAttribute('data-leaving', 'true');
    const remove = () => splash.remove();
    splash.addEventListener('transitionend', remove, { once: true });
    // Belt and braces: transitionend never fires under prefers-reduced-motion.
    setTimeout(remove, 400);
  });
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * The boot preload.
 *
 * React is already rendering above — the app is being built behind the splash,
 * not after it — so this buys the remaining round trips rather than delaying
 * anything. When it finishes, every route chunk is in memory and the first tap
 * on any tab is a memory read.
 *
 * The plan adapts to the visitor:
 *   • `data` (Firestore, ~80 kB) only for someone with a persisted session. A
 *     signed-out visitor looking at a sign-in button must never pay for it, and
 *     scripts/perf-proof.mjs fails the build if they do.
 *   • `routes` only when the connection welcomes speculative work — Save-Data
 *     and 2g get the shell and nothing more.
 */
const buildCriticalPlan = (): PreloadTask[] => {
  const tasks: PreloadTask[] = [
    {
      id: 'fonts',
      weight: 1,
      // Webfonts swapping in after the splash leaves is a visible reflow on the
      // first screen; waiting here means the app appears settled when it lands.
      run: () =>
        typeof document !== 'undefined' && (document as Document & { fonts?: FontFaceSet }).fonts
          ? (document as Document & { fonts: FontFaceSet }).fonts.ready
          : Promise.resolve(),
    },
    {
      id: 'shell',
      weight: 1,
      // One frame, so the bar cannot complete before React has painted anything.
      run: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    },
  ];

  // Firestore (~80 kB) only for someone with a persisted session. A signed-out
  // visitor looking at a sign-in button must never pay for it, and
  // scripts/perf-proof.mjs fails the build if they do.
  if (hasPersistedAuthSession()) {
    tasks.push({ id: 'data', weight: 2, run: () => import('./lib/firestore') });
  }
  return tasks;
};

/** Critical work owns the first 60% of the bar, route chunks the last 40%. */
const CRITICAL_SHARE = 0.6;

const boot = async () => {
  try {
    setSplashProgress(0);

    await runPreload(
      buildCriticalPlan(),
      ({ percent }) => setSplashProgress(percent * CRITICAL_SHARE),
      PRELOAD_DEADLINE_MS,
    );

    // Started ONCE, and deliberately not awaited directly: if the grace window
    // expires this promise carries on downloading in the background while the
    // user is already using the app.
    //
    // Gated on a persisted session as well as the connection: every app page
    // statically imports `lib/firestore`, so preloading routes for a signed-out
    // visitor would pull Firestore onto a boot that only needs to draw a
    // sign-in button. See planIds().
    if (hasPersistedAuthSession() && prefetchAllowed()) {
      const routes = preloadAllRoutes();
      await runPreload(
        [{ id: 'routes', weight: 1, run: () => routes }],
        ({ percent }) => setSplashProgress(CRITICAL_SHARE * 100 + percent * (1 - CRITICAL_SHARE)),
        ROUTES_GRACE_MS,
      );
    }
  } catch {
    // Preload is an optimisation. It must never be the reason the app does not
    // start, so any failure falls through to dismissing the splash.
  } finally {
    setSplashProgress(100);
    dismissSplash();
  }
};

try {
  void boot();
} catch {
  document.getElementById('ff-splash')?.remove();
}
