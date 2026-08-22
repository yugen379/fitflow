/**
 * Route prefetching.
 *
 * Code-splitting makes the first screen fast and every *other* screen slow: the
 * first tap on a nav item pays for a network round trip before anything moves.
 * Prefetching closes that gap by pulling a route's chunk into the HTTP cache
 * before the user commits to it, so the tap itself resolves from memory.
 *
 * Three rules keep this from becoming the thing that makes the app slow:
 *
 *   1. **Never compete with the first paint.** Warming waits for the app to be
 *      interactive and then for an idle callback. A prefetch that delays the
 *      screen the user is actually looking at is a regression, not a feature.
 *   2. **Respect the connection.** Save-Data, 2g and slow-2g get nothing
 *      speculative. Someone metering their data did not ask us to download
 *      screens they may never open.
 *   3. **Heavy routes need intent.** The 3D Lab pulls ~120 kB of three.js. That
 *      is fetched when a user shows they are heading there — a pointer landing
 *      on the entry card — never on a hunch.
 *
 * The import specifiers below must stay byte-identical to the ones in App.tsx,
 * because that string is what Vite matches to decide these are the same chunk.
 */

import { hasPersistedAuthSession } from './authSession';

export type RouteKey =
  | 'home'
  | 'track'
  | 'workout'
  | 'community'
  | 'profile'
  | 'wellness'
  | 'explore'
  | 'library'
  | 'analytics'
  | 'mealPlan'
  | 'challenges'
  | 'settings'
  | 'coach'
  | 'pro'
  | 'nutritionGoals'
  | 'onboarding'
  | 'steps'
  | 'achievements'
  | 'lab';

type Loader = () => Promise<unknown>;

const loaders: Record<RouteKey, Loader> = {
  home: () => import('../pages/Home'),
  track: () => import('../pages/Track'),
  workout: () => import('../pages/Workout'),
  community: () => import('../pages/Community'),
  profile: () => import('../pages/Profile'),
  wellness: () => import('../pages/Wellness'),
  explore: () => import('../pages/Explore'),
  library: () => import('../pages/Library'),
  analytics: () => import('../pages/Analytics'),
  mealPlan: () => import('../pages/MealPlan'),
  challenges: () => import('../pages/Challenges'),
  settings: () => import('../pages/Settings'),
  coach: () => import('../pages/Coach'),
  pro: () => import('../pages/Pro'),
  nutritionGoals: () => import('../pages/NutritionGoals'),
  onboarding: () => import('../pages/Onboarding'),
  steps: () => import('../pages/Steps'),
  achievements: () => import('../pages/Achievements'),
  lab: () => import('../pages/Lab'),
};

/** URL path -> route key, so nav links can prefetch by href. */
const BY_PATH: Readonly<Record<string, RouteKey>> = {
  '/': 'home',
  '/track': 'track',
  '/workout': 'workout',
  '/community': 'community',
  '/profile': 'profile',
  '/wellness': 'wellness',
  '/explore': 'explore',
  '/library': 'library',
  '/analytics': 'analytics',
  '/meal-plan': 'mealPlan',
  '/challenges': 'challenges',
  '/settings': 'settings',
  '/coach': 'coach',
  '/pro': 'pro',
  '/nutrition-goals': 'nutritionGoals',
  '/onboarding': 'onboarding',
  '/steps': 'steps',
  '/achievements': 'achievements',
  '/lab': 'lab',
};

/**
 * Routes worth warming without being asked. These are the bottom-nav
 * destinations — the screens essentially every session visits.
 *
 * `lab` is deliberately absent: three.js is far too heavy to fetch on spec.
 */
const SPECULATIVE: RouteKey[] = ['home', 'steps', 'track', 'workout', 'profile'];

const started = new Set<RouteKey>();

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Whether speculative work is welcome right now. Explicit user intent bypasses
 * this — if someone is reaching for the Lab, they want the Lab.
 */
export const prefetchAllowed = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  const type = connection.effectiveType;
  return type !== '2g' && type !== 'slow-2g';
};

/**
 * Pull a route's chunk into cache. Idempotent, never throws, and never blocks:
 * a failed prefetch is a non-event because the real navigation will retry.
 */
export const prefetchRoute = (route: RouteKey): void => {
  if (started.has(route)) return;
  const load = loaders[route];
  if (!load) return;
  started.add(route);
  try {
    void load().catch(() => {
      // Let a later real navigation try again rather than caching the failure.
      started.delete(route);
    });
  } catch {
    started.delete(route);
  }
};

/** Prefetch by href, for components that only know the link target. */
export const prefetchPath = (path: string): void => {
  const route = BY_PATH[path];
  if (route) prefetchRoute(route);
};

/**
 * Warm the data layer for a returning user.
 *
 * Firestore is no longer a static import, which is what took ~80 kB off the boot
 * path — but for someone who is already signed in it is needed the moment auth
 * resolves. Left purely on demand, that would serialise: download auth, resolve
 * the user, only then start downloading Firestore.
 *
 * So it is kicked off from the first frame instead, but only when a persisted
 * session says this user will actually need it. Signed-out users still download
 * nothing. This is a fetch, not an await: it races alongside boot and is
 * normally resolved before `useAuth` asks for it.
 */
export const warmDataLayer = (): void => {
  if (typeof window === 'undefined') return;
  if (!hasPersistedAuthSession()) return;
  try {
    void import('./firestore').catch(() => {
      // The real import in useAuth will retry and surface any genuine failure.
    });
  } catch {
    /* non-critical */
  }
};

const onIdle = (fn: () => void, timeout = 2500): void => {
  const ric = (window as Window & { requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(() => fn(), { timeout });
  else setTimeout(fn, 900);
};

/**
 * Warm the common destinations once the app is settled.
 *
 * Chunks are fetched one at a time with an idle gap between them, so warming
 * can never saturate the connection the current screen is still using.
 */
export const warmLikelyRoutes = (): void => {
  if (typeof window === 'undefined' || !prefetchAllowed()) return;

  const queue = SPECULATIVE.filter((route) => !started.has(route));
  const step = () => {
    const next = queue.shift();
    if (!next) return;
    prefetchRoute(next);
    if (queue.length > 0) onIdle(step);
  };

  onIdle(step);
};

/**
 * Props that turn any element into a prefetch trigger.
 *
 * `onPointerEnter` covers mouse and stylus; `onPointerDown` covers touch, where
 * there is no hover — the gap between finger-down and finger-up is small, but on
 * a slow connection it is still a useful head start.
 */
export const prefetchHandlers = (route: RouteKey) => ({
  onPointerEnter: () => prefetchRoute(route),
  onPointerDown: () => prefetchRoute(route),
  onFocus: () => prefetchRoute(route),
});

export const prefetchPathHandlers = (path: string) => ({
  onPointerEnter: () => prefetchPath(path),
  onPointerDown: () => prefetchPath(path),
  onFocus: () => prefetchPath(path),
});

/** Test/debug hook: which routes have been warmed so far. */
export const prefetchedRoutes = (): RouteKey[] => [...started];

/**
 * Every route chunk, for the boot preloader.
 *
 * `warmLikelyRoutes` deliberately trickles a handful of destinations one at a
 * time AFTER the app is interactive. This is the other half: during the splash,
 * when there is no screen to compete with, pull everything so the first tap on
 * any tab resolves from memory instead of the network.
 *
 * `lab` is included here — unlike in the speculative set — because the splash is
 * the one moment where paying for three.js costs the user nothing they can see.
 * It is last in the list and the preloader is deadline-bounded, so on a slow
 * connection it is simply the thing that does not finish.
 */
export const preloadAllRoutes = async (): Promise<void> => {
  const order: RouteKey[] = [
    ...SPECULATIVE,
    'community', 'wellness', 'explore', 'library', 'analytics',
    'mealPlan', 'challenges', 'settings', 'coach', 'pro',
    'nutritionGoals', 'achievements', 'onboarding', 'lab',
  ];
  await Promise.all(
    order.map(async (route) => {
      if (started.has(route)) return;
      started.add(route);
      try {
        await loaders[route]();
      } catch {
        started.delete(route);
      }
    }),
  );
};

/** True once every route chunk has been pulled — the preload success signal. */
export const allRoutesPreloaded = (): boolean =>
  (Object.keys(loaders) as RouteKey[]).every((route) => started.has(route));
