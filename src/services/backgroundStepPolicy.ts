/**
 * The step-accounting rules the native service runs on, mirrored in TypeScript.
 *
 * `StepStore.java` is the real implementation and it cannot be imported by a
 * Node harness. These functions are a line-for-line mirror of its arithmetic,
 * so `npm run proof:steps` can prove the rules that decide whether a user's day
 * is correct — the reboot discontinuity in particular, which is the one that
 * would silently destroy a step count and which is essentially untestable by
 * hand (it needs a device reboot mid-walk).
 *
 * They are also used directly by the web layer wherever it has to reason about
 * a cumulative counter, so this is shared logic and not a test double.
 *
 * **If you change the arithmetic here, change `StepStore.applyRawReading` too.**
 */

/**
 * A single reading cannot plausibly carry more than a few days of walking.
 * Anything larger is a sensor glitch or a counter that wrapped, and folding it
 * in would permanently corrupt the day.
 */
export const MAX_PLAUSIBLE_DELTA = 200_000;

export interface CounterState {
  /** Steps attributed to the current local day. */
  stepsToday: number;
  /** The last raw cumulative sensor value we wrote down. */
  lastRaw: number;
  /** False until the very first reading has established a baseline. */
  hasBaseline: boolean;
}

export const emptyCounterState = (): CounterState => ({
  stepsToday: 0,
  lastRaw: 0,
  hasBaseline: false,
});

/**
 * The delta a raw `TYPE_STEP_COUNTER` reading contributes.
 *
 * The sensor reports steps SINCE LAST BOOT and keeps counting whether or not
 * anything is listening, so:
 *
 *   • the normal case is a plain difference — and because the hardware never
 *     stopped, that difference automatically includes every step taken while
 *     the app was closed. This is the whole mechanism;
 *   • a reading LOWER than the last one means the device rebooted and the
 *     counter restarted at zero, so the new value is itself the delta;
 *   • the first reading ever has nothing to subtract from, so it establishes
 *     the baseline and claims nothing. Steps taken between boot and the first
 *     listener registration on a fresh install are genuinely unknowable, and
 *     are not invented.
 */
export const rawReadingDelta = (rawValue: unknown, state: CounterState): number => {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return 0;

  if (!state.hasBaseline) return 0;

  const delta = raw >= state.lastRaw ? raw - state.lastRaw : raw;

  if (!Number.isFinite(delta) || delta <= 0) return 0;
  if (delta > MAX_PLAUSIBLE_DELTA) return 0;
  return delta;
};

/** Apply a raw reading, returning the next state. Never mutates the input. */
export const applyRawReading = (rawValue: unknown, state: CounterState): CounterState => {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return state;

  return {
    stepsToday: state.stepsToday + rawReadingDelta(raw, state),
    lastRaw: raw,
    hasBaseline: true,
  };
};

/**
 * Roll to a new local day, archiving the finished one.
 *
 * The raw baseline is deliberately carried over untouched: it tracks the
 * hardware counter, which knows nothing about days. Resetting it here would
 * make the first reading after midnight look like a reboot and hand the user a
 * spurious few thousand steps.
 */
export const rollDay = (
  state: CounterState,
  storedDay: string,
  today: string,
): { state: CounterState; archived: { day: string; steps: number } | null } => {
  if (storedDay === today) return { state, archived: null };
  return {
    state: { stepsToday: 0, lastRaw: state.lastRaw, hasBaseline: state.hasBaseline },
    archived: state.stepsToday > 0 ? { day: storedDay, steps: state.stepsToday } : null,
  };
};
