/**
 * Per-user, per-day step persistence in Firestore.
 *
 * IndexedDB (see `lib/pedometer.ts`) already survives reloads and works
 * offline, but it dies with the browser profile: clear site data, reinstall the
 * APK, or sign in on a second device and the history is gone. This mirrors each
 * day to Firestore so the total genuinely survives, and so the proactive coach
 * and analytics can read step history server-side.
 *
 * ## Document shape
 *
 * Collection `step_days`, id `<uid>_<YYYY-MM-DD>` — the same convention as the
 * existing `activity_days` and `streak_freezes` collections, so one predictable
 * id scheme covers all the per-day markers and the rules can pattern-match the
 * uid prefix.
 *
 * ## Why writes are monotonic
 *
 * Two devices, or a fresh install with an empty IndexedDB, can both hold a
 * "today" count. If the lower one wrote last it would erase real steps. So a
 * write only ever raises the stored count: `upsertStepDay` merges with
 * `max(local, remote)`, and `firestore.rules` enforces the same invariant
 * server-side (`incoming().steps >= existing().steps`) so a buggy or hostile
 * client cannot walk a day backwards either.
 *
 * The one deliberate exception is the day rolling over: a new date is a new
 * document, never an update to yesterday's.
 *
 * ## Cost
 *
 * Writes are throttled to one every 90 seconds per day-document, and skipped
 * entirely when nothing changed. A heavy 20,000-step day costs well under a
 * hundred writes, not one per step.
 */

import { doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';

import { db } from '../lib/firestore';
import { cleanSteps, mergeDayCount, shouldWrite } from './stepSyncPolicy';

export interface StepDay {
  day: string;
  steps: number;
  distanceKm: number;
  calories: number;
  activeMs: number;
  source: string;
}

export const stepDayId = (uid: string, day: string): string => `${uid}_${day}`;

/** Last write per day key, so a date rollover is never throttled by the old day. */
const lastWriteAt = new Map<string, number>();
/** Last count actually persisted, so an unchanged count costs nothing. */
const lastWritten = new Map<string, number>();

/**
 * Raise today's stored count. Never throws: a failed sync must not disturb the
 * on-screen number, which is already correct locally.
 *
 * @returns true when a write was actually issued.
 */
export const upsertStepDay = async (
  uid: string | undefined,
  entry: StepDay,
  options: { force?: boolean } = {},
): Promise<boolean> => {
  if (!uid || !entry?.day) return false;
  const steps = cleanSteps(entry.steps);
  if (steps <= 0) return false;

  const key = stepDayId(uid, entry.day);
  const now = Date.now();

  // The write policy is pure and lives in stepSyncPolicy, so the harness can
  // prove it without pulling Firebase into a Node process.
  if (
    !shouldWrite({
      steps,
      lastWrittenSteps: lastWritten.get(key) ?? 0,
      lastWriteAt: lastWriteAt.get(key) ?? 0,
      now,
      force: options.force,
    })
  ) {
    return false;
  }

  const ref = doc(db, 'step_days', key);

  try {
    // Read-then-max rather than a blind write: another device may legitimately
    // be ahead of this one, and the rules would reject a lower number anyway.
    const existing = await getDoc(ref);
    const remoteSteps = existing.exists() ? cleanSteps(existing.data()?.steps) : 0;
    if (mergeDayCount(steps, remoteSteps) > steps) {
      // Remote already knows more. Record it so we stop retrying, and let the
      // caller adopt the higher number.
      lastWritten.set(key, remoteSteps);
      lastWriteAt.set(key, now);
      return false;
    }

    await setDoc(
      ref,
      {
        userId: uid,
        day: entry.day,
        steps: Math.round(steps),
        distanceKm: Math.round(cleanSteps(entry.distanceKm) * 100) / 100,
        calories: Math.round(cleanSteps(entry.calories)),
        activeMs: Math.round(cleanSteps(entry.activeMs)),
        source: typeof entry.source === 'string' ? entry.source : 'unknown',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    lastWritten.set(key, steps);
    lastWriteAt.set(key, now);
    lastError = null;
    return true;
  } catch (error: any) {
    // Offline, rules rejection, or a signed-out race. The local count stands,
    // but the reason is recorded so the Steps screen can show it instead of
    // silently never persisting — `step_days` sat empty on the server for a
    // whole release without anything surfacing.
    lastError = String(error?.code || error?.message || error).slice(0, 120);
    console.warn('step_days write failed:', error);
    return false;
  }
};

/** Why the most recent write failed, or null if the last one succeeded. */
let lastError: string | null = null;
export const lastStepSyncError = (): string | null => lastError;

/** Today's stored count on the server, or 0. Used to seed a fresh install. */
export const fetchStepDay = async (uid: string | undefined, day: string): Promise<number> => {
  if (!uid || !day) return 0;
  try {
    const snapshot = await getDoc(doc(db, 'step_days', stepDayId(uid, day)));
    return snapshot.exists() ? cleanSteps(snapshot.data()?.steps) : 0;
  } catch {
    return 0;
  }
};

/**
 * Recent history as a `{ 'YYYY-MM-DD': steps }` map, newest `days` days.
 *
 * Ordering by `day` descending relies on the composite index declared in
 * `firestore.indexes.json` (userId ASC, day DESC). Without it Firestore throws
 * a FAILED_PRECONDITION at runtime rather than at build time, which is why the
 * index ships alongside this function.
 */
export const fetchStepHistory = async (
  uid: string | undefined,
  days = 365,
): Promise<Record<string, number>> => {
  if (!uid) return {};
  try {
    const snapshot = await getDocs(
      query(
        collection(db, 'step_days'),
        where('userId', '==', uid),
        orderBy('day', 'desc'),
        limit(Math.max(1, Math.min(400, days))),
      ),
    );
    const out: Record<string, number> = {};
    snapshot.forEach((document) => {
      const data = document.data();
      if (typeof data?.day === 'string') out[data.day] = cleanSteps(data.steps);
    });
    return out;
  } catch {
    // Missing index or offline: the local IndexedDB history still renders.
    return {};
  }
};

/** Test seam — the throttle is module-level state that a harness must be able to clear. */
export const __resetStepSyncThrottle = (): void => {
  lastWriteAt.clear();
  lastWritten.clear();
};
