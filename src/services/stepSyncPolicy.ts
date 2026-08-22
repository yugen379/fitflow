/**
 * The decisions behind the step-day mirror, with no Firebase in sight.
 *
 * `stepSyncService.ts` imports `firebase/firestore`, which means it can never
 * be loaded by the proof harnesses (the same constraint that keeps
 * `geminiService` firebase-free). The rules that are actually worth proving —
 * when a write is allowed, and how two counts for the same day combine — are
 * therefore pure functions here, imported by the service and by
 * `scripts/steps-proof.mjs` alike.
 */

/** One write per day-document per this interval, at most. */
export const WRITE_THROTTLE_MS = 90 * 1000;

/** A step count that is not a real, positive number is worth nothing. */
export const cleanSteps = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface WriteDecisionInput {
  /** The count we want to store. */
  steps: number;
  /** Highest count already persisted for this day, from this client. */
  lastWrittenSteps: number;
  /** Epoch ms of the last write for this day, or 0. */
  lastWriteAt: number;
  /** Now, epoch ms. */
  now: number;
  /** Bypass the throttle (page unload, sign-out, explicit flush). */
  force?: boolean;
}

/**
 * Whether to issue a Firestore write.
 *
 * Three gates, in order of cheapness: a count of zero is never worth a write;
 * a count we have already stored is never worth re-writing; and otherwise the
 * throttle applies unless forced. A 20,000-step day costs well under a hundred
 * writes rather than one per step.
 */
export const shouldWrite = ({
  steps,
  lastWrittenSteps,
  lastWriteAt,
  now,
  force = false,
}: WriteDecisionInput): boolean => {
  const value = cleanSteps(steps);
  if (value <= 0) return false;
  if (cleanSteps(lastWrittenSteps) >= value) return false;
  if (force) return true;
  return now - (lastWriteAt || 0) >= WRITE_THROTTLE_MS;
};

/**
 * Combine a local and a remote count for the same day.
 *
 * Always the maximum, never the most recent. Two devices, or a reinstall with
 * an empty local store, can each hold a "today" total; last-write-wins would
 * erase real steps. `firestore.rules` enforces the same invariant server-side,
 * so this is the client half of one rule rather than the whole of it.
 */
export const mergeDayCount = (local: unknown, remote: unknown): number =>
  Math.max(cleanSteps(local), cleanSteps(remote));

/**
 * Fold a remote history map into a local one, per day, taking the higher count.
 * Days present only remotely are added: a fresh install has no local history at
 * all, and dropping them would show an empty chart to a user with months of data.
 */
export const mergeHistory = (
  local: Record<string, number>,
  remote: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = { ...local };
  for (const [day, steps] of Object.entries(remote ?? {})) {
    out[day] = mergeDayCount(out[day], steps);
  }
  return out;
};

/**
 * The delta to add to a day's total from a native pedometer reading.
 *
 * `@capgo/capacitor-pedometer` reports steps since the CURRENT measurement
 * session, and restarts that session from zero on every
 * `startMeasurementUpdates()`. So a reading lower than the previous one means
 * the session restarted, not that the user un-walked: the delta is clamped at
 * zero so a restart can only ever contribute nothing.
 */
export const sessionDelta = (sessionTotal: unknown, previousTotal: unknown): number => {
  const current = Number(sessionTotal);
  if (!Number.isFinite(current) || current < 0) return 0;
  const previous = Number(previousTotal);
  const base = Number.isFinite(previous) && previous > 0 ? previous : 0;
  return Math.max(0, current - base);
};
