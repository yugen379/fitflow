/**
 * Boot preloader.
 *
 * Loads everything the app needs while the splash is still up, and reports real
 * progress so the splash can show a percentage instead of a decorative shimmer
 * that tells the user nothing.
 *
 * ## What "completely loaded" means here
 *
 * The app is code-split: the first screen is small and every OTHER screen costs
 * a network round trip on first visit. That is what makes a tap feel slow later
 * on. So the preloader pulls every route chunk during boot, which is what turns
 * subsequent navigation into a memory read — no network, no Suspense fallback.
 *
 * ## The rules it will not break
 *
 *   1. **Never hang.** Every task is wrapped so a rejection cannot stall the
 *      sequence, and the whole run is bounded by a hard deadline. A preloader
 *      that can trap the user behind a splash is far worse than a slow screen.
 *   2. **Never download Firestore for a signed-out visitor.** ~80 kB that
 *      someone looking at a sign-in button will never use. The plan is built
 *      from whether a persisted session exists, and there is a regression test
 *      pinning it.
 *   3. **Critical first, speculative last.** Progress is weighted so the bar
 *      moves in proportion to real work, and the things the first screen needs
 *      run before the things later screens need.
 */

export interface PreloadTask {
  id: string;
  /** Relative cost. The bar advances by weight/total as each task settles. */
  weight: number;
  run: () => Promise<unknown>;
}

export interface PreloadProgress {
  /** 0..100, monotonic — it can never go backwards or exceed 100. */
  percent: number;
  /** The task that just finished, or null before anything has. */
  lastCompleted: string | null;
  done: boolean;
}

export interface PreloadResult {
  percent: number;
  /** Tasks that settled in time, whether they resolved or rejected. */
  completed: string[];
  /** Tasks that rejected. Boot continues; the real call site will retry. */
  failed: string[];
  /** True when the deadline fired before every task settled. */
  timedOut: boolean;
  durationMs: number;
}

/** Nothing may hold the splash longer than this, whatever the network is doing. */
export const PRELOAD_DEADLINE_MS = 4000;

/**
 * Extra time the splash will wait for SPECULATIVE work (all route chunks) once
 * the critical work is done.
 *
 * Two phases, because one was wrong in both directions. Blocking on the full
 * preload measured 684 ms on a fast connection — exactly what was asked for —
 * but 7.6 s on Fast 3G, which is an unacceptable stretch of staring at a
 * loading bar. Not preloading at all gives the fast first paint back and makes
 * every first tab tap pay a round trip.
 *
 * So: critical work always blocks, route chunks get this grace window, and if
 * they overrun they simply keep downloading in the background while the user
 * gets on with the app. Fast connections still see a complete preload; slow
 * ones are not held hostage by one.
 */
export const ROUTES_GRACE_MS = 1500;

const settle = async (task: PreloadTask): Promise<boolean> => {
  try {
    await task.run();
    return true;
  } catch {
    // A failed preload is a non-event: the real import retries on navigation.
    return false;
  }
};

/**
 * Run a preload plan, reporting weighted progress.
 *
 * Tasks run CONCURRENTLY — they are mostly network-bound and serialising them
 * would make boot slower than not preloading at all — but progress is reported
 * as each settles, so the bar reflects work finished rather than time elapsed.
 */
export const runPreload = async (
  tasks: PreloadTask[],
  onProgress: (progress: PreloadProgress) => void,
  deadlineMs: number = PRELOAD_DEADLINE_MS,
): Promise<PreloadResult> => {
  const startedAt = Date.now();

  if (tasks.length === 0) {
    onProgress({ percent: 100, lastCompleted: null, done: true });
    return { percent: 100, completed: [], failed: [], timedOut: false, durationMs: 0 };
  }

  const total = tasks.reduce((sum, t) => sum + Math.max(0, t.weight), 0) || 1;
  const completed: string[] = [];
  const failed: string[] = [];
  let earned = 0;
  let reported = 0;
  let finished = false;

  const report = (lastCompleted: string | null, done: boolean) => {
    // Monotonic and clamped: a bar that jumps backwards reads as a bug even
    // when the underlying work is fine.
    const next = Math.min(100, Math.max(reported, Math.round((earned / total) * 100)));
    reported = next;
    onProgress({ percent: done ? 100 : next, lastCompleted, done });
  };

  const all = Promise.all(
    tasks.map(async (task) => {
      const ok = await settle(task);
      if (finished) return;
      earned += Math.max(0, task.weight);
      (ok ? completed : failed).push(task.id);
      report(task.id, false);
    }),
  );

  let timedOut = false;
  await Promise.race([
    all,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, deadlineMs),
    ),
  ]);

  finished = true;
  report(null, true);

  return {
    percent: 100,
    completed,
    failed,
    timedOut,
    durationMs: Date.now() - startedAt,
  };
};

export interface PlanOptions {
  /** True when a persisted auth session exists, i.e. this user needs Firestore. */
  hasSession: boolean;
  /** False on Save-Data / 2g, where speculative route warming is unwelcome. */
  allowSpeculative: boolean;
}

/**
 * Build the boot plan.
 *
 * Kept separate from the runner and free of imports so the harness can assert
 * the SHAPE of a plan — particularly that a signed-out visitor is never handed
 * a Firestore task.
 */
export const planIds = ({ hasSession, allowSpeculative }: PlanOptions): string[] => {
  const ids = ['fonts', 'shell'];
  if (hasSession) ids.push('data');
  // Route chunks require a session as well as a willing connection. Every app
  // page statically imports `lib/firestore`, so preloading them for a
  // signed-out visitor drags ~80 kB of Firestore onto a boot whose only job is
  // to render a sign-in button. scripts/perf-proof.mjs caught exactly that and
  // fails the build if it comes back.
  //
  // Nothing is lost: a signed-out visitor cannot reach those screens without
  // signing in first, and once they do, `warmLikelyRoutes` warms the common
  // destinations. Their next launch has a persisted session and preloads fully.
  if (hasSession && allowSpeculative) ids.push('routes');
  return ids;
};
