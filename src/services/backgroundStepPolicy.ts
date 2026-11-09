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
 *
 * ## The 1,103,660-step bug (v1.6.4)
 *
 * The old rule was "a reading lower than the last one means a reboot, so the
 * new value is itself the delta", guarded only by a 200,000 per-reading cap.
 * Some OEM sensor HALs (seen on a redONE handset) do NOT keep one monotonic
 * since-boot counter: the value drops to a small number without any reboot —
 * typically when another listener registers on the same sensor — and later
 * jumps back to the large cumulative value. Each drop was booked as a reboot
 * and each jump back as ~150k "new" steps, which slipped under the 200k cap.
 * A handful of those cycles produced a 1.1M-step morning.
 *
 * Three independent guards now stand in the way, each one alone enough to
 * stop that pattern:
 *
 *   1. A reboot is only believed when the device ACTUALLY rebooted (boot
 *      count changed, or elapsed-since-boot went backwards). A drop without a
 *      reboot is a sensor reset: re-baseline and claim nothing.
 *   2. Cadence: no delta may exceed what a human can physically walk in the
 *      time since the last reading (MAX_STEPS_PER_SECOND, plus a little slack
 *      for batched delivery). An implausible jump re-baselines and claims
 *      nothing.
 *   3. A day can never exceed MAX_PLAUSIBLE_DAY_STEPS, and a stored day above
 *      it is treated as corrupt and reset rather than displayed.
 *   4. Jump-back detection. Cadence alone is not enough when the drop and the
 *      jump back are hours apart (5 steps/s × 3 h = 54k allowed). So the
 *      highest raw value seen this boot (`peakRaw`) is remembered; when the
 *      counter returns to it, only the steps walked ABOVE the peak are new,
 *      minus whatever was already credited while it was below.
 */

/** A single reading can never carry more than this — kept as a final backstop. */
export const MAX_PLAUSIBLE_DELTA = 200_000;

/**
 * Upper bound on walking/running cadence. Elite sprinters peak around 4.5
 * steps/s; 5 leaves headroom without letting a sensor jump through.
 */
export const MAX_STEPS_PER_SECOND = 5;

/** Absorbs batched-delivery jitter on short gaps between readings. */
export const CADENCE_SLACK_STEPS = 60;

/**
 * No real day exceeds this. An ultramarathon is ~60–80k steps; anything above
 * 100k is a counting fault, never a walk.
 */
export const MAX_PLAUSIBLE_DAY_STEPS = 100_000;

export interface CounterState {
  /** Steps attributed to the current local day. */
  stepsToday: number;
  /** The last raw cumulative sensor value we wrote down. */
  lastRaw: number;
  /** False until the very first reading has established a baseline. */
  hasBaseline: boolean;
  /** elapsedRealtime (ms since boot) at the last reading; -1 if unknown. */
  lastElapsedMs: number;
  /** Settings.Global.BOOT_COUNT at the last reading; -1 if unavailable. */
  bootCount: number;
  /** Highest raw value seen since boot; -1/absent = unknown (use lastRaw). */
  peakRaw?: number;
  /** Steps credited while the counter sat below `peakRaw` (after a drop). */
  dropSteps?: number;
}

export const emptyCounterState = (): CounterState => ({
  stepsToday: 0,
  lastRaw: 0,
  hasBaseline: false,
  lastElapsedMs: -1,
  bootCount: -1,
  peakRaw: -1,
  dropSteps: 0,
});

/** The effective peak: never below the last raw value. */
export const effectivePeak = (state: CounterState): number => {
  const peak = Number(state.peakRaw);
  return Number.isFinite(peak) && peak > state.lastRaw ? peak : state.lastRaw;
};

const effectiveDropSteps = (state: CounterState): number => {
  const n = Number(state.dropSteps);
  return Number.isFinite(n) && n > 0 && state.lastRaw < effectivePeak(state) ? n : 0;
};

/** What the device tells us alongside each raw value. */
export interface ReadingContext {
  /** ms since boot (SystemClock.elapsedRealtime). */
  elapsedMs: number;
  /** Settings.Global.BOOT_COUNT, or -1 if the OEM doesn't provide it. */
  bootCount: number;
}

/** Whether the device rebooted between the stored state and this reading. */
export const didReboot = (state: CounterState, ctx: ReadingContext): boolean => {
  if (state.bootCount >= 0 && ctx.bootCount >= 0) return ctx.bootCount !== state.bootCount;
  // No boot counter: elapsed-since-boot only ever grows within one boot.
  return state.lastElapsedMs >= 0 && ctx.elapsedMs < state.lastElapsedMs;
};

/** Most steps a person could take in `elapsedMs`. */
export const cadenceCeiling = (elapsedMs: number): number =>
  Math.floor(Math.max(0, elapsedMs) / 1000) * MAX_STEPS_PER_SECOND + CADENCE_SLACK_STEPS;

/**
 * The delta a raw `TYPE_STEP_COUNTER` reading contributes.
 *
 *   • normal case: a plain difference — and because the hardware never
 *     stopped, it includes every step taken while the app was closed;
 *   • REAL reboot: the counter restarted at zero, so the new value is itself
 *     the delta (bounded by what could be walked since boot);
 *   • drop WITHOUT a reboot: a sensor reset, not walking — claim nothing;
 *   • a rise faster than human cadence: a sensor jump — claim nothing;
 *   • first reading ever, or a state from before these guards existed (no
 *     elapsed time recorded): establish the baseline, claim nothing.
 */
export const rawReadingDelta = (rawValue: unknown, state: CounterState, ctx: ReadingContext): number => {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (!state.hasBaseline || state.lastElapsedMs < 0) return 0;

  let delta: number;
  if (didReboot(state, ctx)) {
    delta = raw <= cadenceCeiling(ctx.elapsedMs) ? raw : 0;
  } else if (raw < state.lastRaw) {
    delta = 0;
  } else {
    const peak = effectivePeak(state);
    if (state.lastRaw < peak && raw >= peak) {
      // The counter returned to its real cumulative value after a drop. Only
      // steps above the old peak are new, less what the drop already credited.
      delta = raw - peak - effectiveDropSteps(state);
    } else {
      delta = raw - state.lastRaw;
    }
    if (delta > cadenceCeiling(ctx.elapsedMs - state.lastElapsedMs)) delta = 0;
  }

  if (!Number.isFinite(delta) || delta <= 0) return 0;
  if (delta > MAX_PLAUSIBLE_DELTA) return 0;
  if (state.stepsToday + delta > MAX_PLAUSIBLE_DAY_STEPS) return 0;
  return delta;
};

/** A stored day above the ceiling is corrupt: treat it as zero, never display it. */
export const sanitizeDaySteps = (steps: number): number =>
  Number.isFinite(steps) && steps > 0 && steps <= MAX_PLAUSIBLE_DAY_STEPS ? steps : 0;

/** Apply a raw reading, returning the next state. Never mutates the input. */
export const applyRawReading = (rawValue: unknown, state: CounterState, ctx: ReadingContext): CounterState => {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return state;
  const clean = { ...state, stepsToday: sanitizeDaySteps(state.stepsToday) };
  const delta = rawReadingDelta(raw, clean, ctx);

  // Peak tracking: a fresh baseline or a real reboot starts a new peak.
  const fresh = !clean.hasBaseline || clean.lastElapsedMs < 0 || didReboot(clean, ctx);
  const peakRaw = fresh ? raw : Math.max(effectivePeak(clean), raw);
  const dropSteps = raw < peakRaw ? effectiveDropSteps(clean) + delta : 0;

  return {
    stepsToday: clean.stepsToday + delta,
    lastRaw: raw,
    hasBaseline: true,
    lastElapsedMs: ctx.elapsedMs,
    bootCount: ctx.bootCount,
    peakRaw,
    dropSteps,
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
  const finished = sanitizeDaySteps(state.stepsToday);
  return {
    state: { ...state, stepsToday: 0 },
    archived: finished > 0 ? { day: storedDay, steps: finished } : null,
  };
};
