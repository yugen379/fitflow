/**
 * Tier 2 of the step stack: the phone's hardware step counter.
 *
 * Wraps `@capgo/capacitor-pedometer` (v8, peer `@capacitor/core >=8.0.0`,
 * which matches the Capacitor 8.3 this app is on). On Android it reads
 * `Sensor.TYPE_STEP_COUNTER`, a dedicated low-power core that counts steps
 * without waking the CPU, which is both far more accurate and far cheaper than
 * the accelerometer heuristic in `pedometer.ts`.
 *
 * ## The delta trap
 *
 * This is the single most important thing about this module, and it is NOT in
 * the plugin's README. Reading its Android source
 * (`CapacitorPedometerPlugin.java`) shows `startMeasurementUpdates()` sets
 * `initialStepCount = -1`, and `onSensorChanged` then reports:
 *
 *     numberOfSteps = stepsSinceBoot - initialStepCount
 *
 * So `numberOfSteps` is **steps since this measurement session started**, not
 * steps today and not steps since boot. It resets to 0 on every start. Treating
 * it as a daily total would wipe the user's count every time the app resumes.
 *
 * This module therefore reports monotonic session deltas, and the caller folds
 * each delta into the day's running total. `sessionDelta` is clamped at zero so
 * a restart can only ever add nothing, never subtract.
 *
 * ## What this tier does NOT give you
 *
 * The same source unregisters the sensor listener on stop and on destroy, so
 * counting pauses when the app is backgrounded or killed. Steps taken while
 * FitFlow is closed are recovered from Health Connect (tier 1), which reads the
 * OS's own record. See `HONEST_LIMITS` below, which the UI renders verbatim.
 */

import { Capacitor } from '@capacitor/core';

import { sessionDelta } from '../services/stepSyncPolicy';

export type ActivityPermission = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface NativeStepEvent {
  /** Steps added since the previous event. Never negative. */
  delta: number;
  /** Raw session total the plugin reported, for diagnostics. */
  sessionTotal: number;
}

/** Rendered in the UI wherever the app claims to count steps. */
export const HONEST_LIMITS =
  'The hardware counter runs while FitFlow is open. Android stops delivering ' +
  'sensor events once the app is closed, so steps taken while it is shut are ' +
  'picked up from Health Connect instead.';

type PedometerModule = typeof import('@capgo/capacitor-pedometer');
type Plugin = PedometerModule['CapacitorPedometer'];

let cached: Plugin | null = null;
let loadFailed = false;

/**
 * Dynamic import, matching the pattern in `healthService.ts`: the native plugin
 * must never be pulled into the web bundle, where it cannot work anyway.
 */
const getPlugin = async (): Promise<Plugin | null> => {
  if (cached) return cached;
  if (loadFailed) return null;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import('@capgo/capacitor-pedometer');
    cached = mod.CapacitorPedometer;
    return cached;
  } catch {
    // Plugin not present in this build (e.g. an older APK) — fall through to
    // the accelerometer tier rather than breaking the screen.
    loadFailed = true;
    return null;
  }
};

/** True when this build can talk to a hardware step counter at all. */
export const isNativePedometerAvailable = async (): Promise<boolean> => {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.isAvailable();
    return result?.stepCounting === true;
  } catch {
    // Some devices genuinely have no step-counter core.
    return false;
  }
};

/**
 * Permission state without showing anything. Safe on every launch.
 * On Android this is `ACTIVITY_RECOGNITION`; below API 29 the plugin reports
 * granted, because no runtime permission existed yet.
 */
export const checkActivityPermission = async (): Promise<ActivityPermission> => {
  const plugin = await getPlugin();
  if (!plugin) return 'denied';
  try {
    const status = await plugin.checkPermissions();
    return status?.activityRecognition ?? 'denied';
  } catch {
    return 'denied';
  }
};

/**
 * Show the Android runtime permission dialog. Must be called from a user
 * gesture: Android will not surface the sheet for a background caller, and a
 * silent no-op would look like a broken button.
 */
export const requestActivityPermission = async (): Promise<ActivityPermission> => {
  const plugin = await getPlugin();
  if (!plugin) return 'denied';
  try {
    const status = await plugin.requestPermissions();
    return status?.activityRecognition ?? 'denied';
  } catch {
    return 'denied';
  }
};

interface Session {
  stop: () => Promise<void>;
}

/**
 * Start the hardware counter and stream deltas.
 *
 * Returns null when the tier is unusable (no plugin, no sensor, no permission),
 * so the caller can fall through to the accelerometer without special-casing.
 */
export const startNativeStepUpdates = async (
  onStep: (event: NativeStepEvent) => void,
): Promise<Session | null> => {
  const plugin = await getPlugin();
  if (!plugin) return null;
  if ((await checkActivityPermission()) !== 'granted') return null;
  if (!(await isNativePedometerAvailable())) return null;

  // Session-local: the plugin restarts its own counter from zero on every
  // start, so this must restart from zero alongside it.
  let lastSessionTotal = 0;

  let handle: { remove: () => Promise<void> } | null = null;
  try {
    handle = await plugin.addListener('measurement', (event) => {
      const sessionTotal = Number(event?.numberOfSteps);
      if (!Number.isFinite(sessionTotal) || sessionTotal < 0) return;
      // Clamped in stepSyncPolicy: a plugin restart resets sessionTotal to 0,
      // and a negative delta must never claw back steps the user actually took.
      const delta = sessionDelta(sessionTotal, lastSessionTotal);
      lastSessionTotal = sessionTotal;
      if (delta > 0) onStep({ delta, sessionTotal });
    });

    // Started AFTER the listener is attached: the sensor can fire immediately
    // on a device that is already walking, and an event before the listener
    // exists is a step silently dropped.
    await plugin.startMeasurementUpdates();
  } catch {
    await handle?.remove().catch(() => {});
    return null;
  }

  return {
    stop: async () => {
      try {
        await plugin.stopMeasurementUpdates();
      } catch {
        // Already stopped, or the activity is going away — nothing to salvage.
      }
      await handle?.remove().catch(() => {});
    },
  };
};
