/**
 * One step number for the whole app.
 *
 * Four possible sources, and they must never be on screen at the same time, so
 * this hook resolves exactly one and reports which:
 *
 *   1. **FitFlow's own background counter** (`lib/backgroundSteps.ts`, backed by
 *      the native foreground service in `android/.../steps/`). THE PRIMARY
 *      SOURCE. Counts with the app closed, swiped away and across reboots, using
 *      nothing but the phone's hardware step sensor and the user's permission.
 *   2. **Health Connect** (`services/healthService.ts`) — optional, for people
 *      who already keep data there or wear a watch that writes to it. Nothing
 *      depends on it; it is a bonus source, not the mechanism.
 *   3. **Hardware counter, foreground only** (`lib/nativePedometer.ts`) — the
 *      fallback for an Android build where the service will not start (no
 *      battery exemption, or the user declined the ongoing notification).
 *   4. **Accelerometer heuristic** (`lib/pedometer.ts`) — the PWA/browser
 *      fallback, where none of the native tiers exist at all.
 *
 * Tiers 3 and 4 feed the same local day store, and tiers 1 and 2 fold in on top
 * via `adoptDeviceCount` (a max, never an overwrite), so the number never jumps
 * backwards when one tier takes over from another.
 *
 * ## Why the background tier wins
 *
 * It is the only one whose count includes the hours the app was not running. If
 * it reports, everything else is by definition a subset of it.
 *
 * ## Persistence
 *
 * The native service persists to SharedPreferences; the web layer mirrors to
 * IndexedDB and to Firestore at `step_days/<uid>_<YYYY-MM-DD>` (see
 * `services/stepSyncService`). On mount the higher of the local and server
 * counts is adopted, which is what makes a reinstall or a second device pick up
 * the real total instead of restarting at zero.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  formatActiveTime,
  isPedometerSupported,
  kmToMiles,
  localDateKey,
  pedometer,
  snapshotFrom,
} from '../lib/pedometer';
import type { PedometerStatus, StepSnapshot } from '../lib/pedometer';
import {
  checkActivityPermission,
  isNativePedometerAvailable,
  requestActivityPermission,
  startNativeStepUpdates,
} from '../lib/nativePedometer';
import type { ActivityPermission } from '../lib/nativePedometer';
import {
  getBackgroundStatus,
  isBackgroundStepsSupported,
  onBackgroundSteps,
  openBatterySettings,
  readTodayBackgroundSteps,
  requestActivityAccess,
  requestNotificationAccess,
  startBackgroundCounting,
  stopBackgroundCounting,
} from '../lib/backgroundSteps';
import type { BackgroundStepsStatus } from '../lib/backgroundSteps';
import { fetchStepDay, upsertStepDay } from '../services/stepSyncService';

export type StepSource = 'background-service' | 'health-connect' | 'hardware-counter' | 'device-sensor' | 'none';

export interface StepState extends StepSnapshot {
  source: StepSource;
  status: PedometerStatus;
  /** Android ACTIVITY_RECOGNITION state; 'granted' on web, where it does not apply. */
  permission: ActivityPermission;
  /** True when a user gesture is needed before counting can start. */
  needsPermission: boolean;
  /** True when the user actively refused, so the UI must stop asking and explain. */
  permissionDenied: boolean;
  supported: boolean;
  /** Full native background-counting status; null on platforms without it. */
  background: BackgroundStepsStatus | null;
  /** True when steps are being counted with the app closed, right now. */
  countsInBackground: boolean;
  /**
   * Set when background counting is on but at risk of being killed overnight by
   * an OEM battery manager. Not an error — a thing worth telling the user.
   */
  needsBatteryExemption: boolean;
  /** Plain-language statement of what this app genuinely cannot do. */
  limitsNote: string;
}

interface Options {
  /** Steps from Health Connect, when connected. */
  deviceSteps?: number | null;
  /** Whether to start any sensor at all. */
  enabled?: boolean;
  /** Signed-in user, for the Firestore mirror. Omit to stay local-only. */
  uid?: string | null;
  /** Bodyweight in kg, for the calorie formula. */
  weightKg?: number | null;
  /** Height in cm, for the stride/distance formula. */
  heightCm?: number | null;
}

const BACKGROUND_NOTE =
  'FitFlow counts your steps with the phone’s own step sensor, including while the app is closed. ' +
  'Steps taken between a restart and FitFlow starting up again are the only ones it cannot see.';

const FOREGROUND_NOTE =
  'Steps are only counted while FitFlow is open. Turn on background counting to keep counting with the app closed.';

export const useSteps = ({
  deviceSteps = null,
  enabled = true,
  uid = null,
  weightKg = null,
  heightCm = null,
}: Options = {}): StepState & {
  requestPermission: () => Promise<void>;
  enableBackgroundCounting: () => Promise<void>;
  disableBackgroundCounting: () => Promise<void>;
  requestNotifications: () => Promise<void>;
  openBatterySettings: () => Promise<void>;
} => {
  const [snapshot, setSnapshot] = useState<StepSnapshot>(() => snapshotFrom(localDateKey(), 0, 0));
  const [status, setStatus] = useState<PedometerStatus>('idle');
  const [permission, setPermission] = useState<ActivityPermission>('granted');
  const [hardwareActive, setHardwareActive] = useState(false);
  const [background, setBackground] = useState<BackgroundStepsStatus | null>(null);

  const uidRef = useRef(uid);
  uidRef.current = uid;

  // ── Body data drives the formulas ─────────────────────────────────────────
  useEffect(() => {
    pedometer.setBody({ weightKg, heightCm });
  }, [weightKg, heightCm]);

  // ── Subscribe to the local store ──────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = pedometer.subscribe((next, nextStatus) => {
      setSnapshot(next);
      setStatus(nextStatus);
    });
    return unsubscribe;
  }, []);

  // ── Firestore mirror ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return;
    // Named, so the cleanup can deregister THIS handler specifically. Both Home
    // and /steps mount `useSteps`, and during a route transition both exist for
    // a moment — a blind `setSyncHandler(null)` from the outgoing screen used to
    // switch step syncing off for the rest of the session.
    const handler = (snap: StepSnapshot) => {
      void upsertStepDay(uidRef.current ?? undefined, {
        day: snap.date,
        steps: snap.steps,
        distanceKm: snap.distanceKm,
        calories: snap.calories,
        activeMs: snap.activeMs,
        source: 'client',
      }).then(
        (wrote) => { if (wrote) pedometer.noteSyncError(null); },
        (error: any) => pedometer.noteSyncError(String(error?.code || error?.message || error).slice(0, 90)),
      );
    };
    pedometer.setSyncHandler(handler);
    return () => pedometer.clearSyncHandler(handler);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const remote = await fetchStepDay(uid, localDateKey());
      if (!cancelled && remote > 0) await pedometer.adoptDeviceCount(remote);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // ── Tier 1: the background service ────────────────────────────────────────
  // Read its status and its stored count on mount, and again whenever the app
  // returns to the foreground — that resume is exactly when it has news, since
  // it has been counting the whole time the WebView was gone.
  const refreshBackground = useCallback(async () => {
    if (!isBackgroundStepsSupported()) return;
    const [next, steps] = await Promise.all([getBackgroundStatus(), readTodayBackgroundSteps()]);
    setBackground(next);
    if (steps > 0) await pedometer.adoptDeviceCount(steps);
  }, []);

  useEffect(() => {
    void refreshBackground();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshBackground();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshBackground]);

  // Live pushes from the service while the WebView happens to be open.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const off = await onBackgroundSteps((event) => {
        const steps = Number(event?.steps);
        if (Number.isFinite(steps) && steps > 0) void pedometer.adoptDeviceCount(steps);
      });
      if (cancelled) off();
      else dispose = off;
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const backgroundActive = background?.serviceRunning === true;

  // ── Android permission state for the foreground-only tier ─────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await isNativePedometerAvailable())) return;
      const state = await checkActivityPermission();
      if (!cancelled) setPermission(state);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Health Connect is now strictly a bonus source.
  const healthConnectLeading = deviceSteps !== null && deviceSteps > 0;

  // ── Tier 3: foreground hardware counter ───────────────────────────────────
  // Pointless while the service is already counting the same sensor.
  useEffect(() => {
    if (!enabled || backgroundActive || healthConnectLeading || permission !== 'granted') {
      setHardwareActive(false);
      return;
    }
    let session: { stop: () => Promise<void> } | null = null;
    let cancelled = false;

    void (async () => {
      const started = await startNativeStepUpdates(({ delta }) => pedometer.addSteps(delta));
      if (cancelled) {
        await started?.stop();
        return;
      }
      session = started;
      setHardwareActive(started !== null);
    })();

    return () => {
      cancelled = true;
      setHardwareActive(false);
      void session?.stop();
    };
  }, [enabled, backgroundActive, healthConnectLeading, permission]);

  // ── Tier 4: accelerometer, only when nothing else is carrying it ──────────
  useEffect(() => {
    if (!enabled || backgroundActive || healthConnectLeading || hardwareActive) return;
    void pedometer.start();
    return () => pedometer.stop();
  }, [enabled, backgroundActive, healthConnectLeading, hardwareActive]);

  // ── Tier 2: Health Connect folds in on top ────────────────────────────────
  useEffect(() => {
    if (!healthConnectLeading) return;
    void pedometer.adoptDeviceCount(deviceSteps as number);
  }, [deviceSteps, healthConnectLeading]);

  /**
   * The single "let FitFlow count my steps" action.
   *
   * Prefers the background service, because that is the one that actually keeps
   * counting when the app is closed. Falls back to the foreground-only grant on
   * a device with no step sensor, and to the iOS/web motion grant off Android.
   */
  const requestPermission = useCallback(async () => {
    if (isBackgroundStepsSupported()) {
      const next = await requestActivityAccess();
      setBackground(next);
      setPermission(next.activityRecognition);
      if (next.activityRecognition === 'granted') {
        await refreshBackground();
        return;
      }
    }
    if (await isNativePedometerAvailable()) {
      const next = await requestActivityPermission();
      setPermission(next);
      if (next !== 'granted') setStatus(await pedometer.requestPermission());
      return;
    }
    setStatus(await pedometer.requestPermission());
  }, [refreshBackground]);

  const enableBackgroundCounting = useCallback(async () => {
    const status0 = await getBackgroundStatus();
    // Permission first: start() rejects without it, and the rejection would be
    // invisible to the user.
    if (status0.activityRecognition !== 'granted') {
      const granted = await requestActivityAccess();
      setBackground(granted);
      setPermission(granted.activityRecognition);
      if (granted.activityRecognition !== 'granted') return;
    }
    setBackground(await startBackgroundCounting());
    await refreshBackground();
  }, [refreshBackground]);

  const disableBackgroundCounting = useCallback(async () => {
    setBackground(await stopBackgroundCounting());
  }, []);

  const requestNotifications = useCallback(async () => {
    setBackground(await requestNotificationAccess());
  }, []);

  const openBattery = useCallback(async () => {
    await openBatterySettings();
    // The user leaves the app to flip a system toggle, so the answer only
    // arrives on the way back; the visibility listener above picks it up.
  }, []);

  const source: StepSource = backgroundActive
    ? 'background-service'
    : healthConnectLeading
      ? 'health-connect'
      : hardwareActive
        ? 'hardware-counter'
        : status === 'running'
          ? 'device-sensor'
          : 'none';

  const needsPermission =
    !backgroundActive &&
    (permission === 'prompt' || permission === 'prompt-with-rationale' || status === 'permission-required');

  return useMemo(
    () => ({
      ...snapshot,
      source,
      status,
      permission,
      needsPermission,
      permissionDenied: permission === 'denied' || status === 'denied',
      supported: isPedometerSupported() || permission === 'granted' || background?.sensorAvailable === true,
      background,
      countsInBackground: backgroundActive,
      needsBatteryExemption: backgroundActive && background?.batteryOptimizationExempt === false,
      limitsNote: backgroundActive ? BACKGROUND_NOTE : FOREGROUND_NOTE,
      requestPermission,
      enableBackgroundCounting,
      disableBackgroundCounting,
      requestNotifications,
      openBatterySettings: openBattery,
    }),
    [
      snapshot,
      source,
      status,
      permission,
      needsPermission,
      background,
      backgroundActive,
      requestPermission,
      enableBackgroundCounting,
      disableBackgroundCounting,
      requestNotifications,
      openBattery,
    ],
  );
};

export { formatActiveTime, kmToMiles };
