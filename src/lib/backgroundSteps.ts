/**
 * Tier 1: FitFlow's own background step counter.
 *
 * Bridge to the native plugin in
 * `android/app/src/main/java/com/fitflow/app/steps/`. That is a real foreground
 * service holding a `Sensor.TYPE_STEP_COUNTER` listener, so it counts while the
 * app is closed, swiped away, and after a reboot — with no Health Connect, no
 * Google account and no third-party app involved.
 *
 * This replaces Health Connect as the primary source. Health Connect is still
 * supported for people who already keep their data there (and for steps a watch
 * recorded), but nothing depends on it any more: if it is absent, uninstalled or
 * never connected, background counting still works.
 *
 * ## What the user has to grant
 *
 * Three things, which fail independently and so are surfaced independently:
 *
 *   1. **Physical activity** (`ACTIVITY_RECOGNITION`) — required. Gates the
 *      sensor, and is also the prerequisite that makes a `health` foreground
 *      service legal on Android 14+. Without it nothing counts.
 *   2. **Notifications** — the ongoing "counting your steps" notification.
 *      Counting still works without it; the user just cannot see it is on.
 *   3. **Unrestricted battery** — not a runtime permission, but the one that
 *      decides whether counting survives overnight on aggressive OEM builds.
 *      Without it Xiaomi/Samsung/Huawei power managers will eventually kill even
 *      a foreground service.
 *
 * ## Honest limits
 *
 * Genuinely not solvable, and stated in the UI rather than hidden:
 *   • Devices with no hardware step-counter sensor cannot use this tier at all;
 *     they fall back to the in-app accelerometer.
 *   • Steps taken between a reboot and the service restarting are lost. The boot
 *     receiver keeps that window to seconds.
 *   • If the service is killed across midnight, steps taken before midnight are
 *     observed afterwards and land on the new day. A cumulative counter carries
 *     no per-step timestamps, so this cannot be corrected after the fact.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

export type PermissionValue = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface BackgroundStepsStatus {
  /** False when the phone has no hardware step counter — this tier is unusable. */
  sensorAvailable: boolean;
  activityRecognition: PermissionValue;
  notifications: PermissionValue;
  /** True when the user has exempted FitFlow from battery optimisation. */
  batteryOptimizationExempt: boolean;
  /** True when the foreground service is counting right now. */
  serviceRunning: boolean;
  /** True when the user has switched background counting on. */
  enabled: boolean;
}

export interface TodaySteps {
  day: string;
  steps: number;
}

interface BackgroundStepsPlugin {
  getStatus(): Promise<BackgroundStepsStatus>;
  requestActivityPermission(): Promise<BackgroundStepsStatus>;
  requestNotificationPermission(): Promise<BackgroundStepsStatus>;
  openBatterySettings(): Promise<void>;
  start(): Promise<BackgroundStepsStatus>;
  stop(): Promise<BackgroundStepsStatus>;
  getToday(): Promise<TodaySteps>;
  getHistory(): Promise<{ days: Record<string, number> }>;
  addListener(
    eventName: 'stepsChanged',
    listener: (event: TodaySteps) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const BackgroundSteps = registerPlugin<BackgroundStepsPlugin>('BackgroundSteps');

/** The status a non-Android platform reports: this tier simply does not exist. */
const UNAVAILABLE: BackgroundStepsStatus = {
  sensorAvailable: false,
  activityRecognition: 'denied',
  notifications: 'denied',
  batteryOptimizationExempt: false,
  serviceRunning: false,
  enabled: false,
};

/** Only the Android build ships the native service. */
export const isBackgroundStepsSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const getBackgroundStatus = async (): Promise<BackgroundStepsStatus> => {
  if (!isBackgroundStepsSupported()) return UNAVAILABLE;
  try {
    return await BackgroundSteps.getStatus();
  } catch {
    // Plugin missing from this build (an older APK) — fall through to the
    // in-app sensor tiers rather than breaking the screen.
    return UNAVAILABLE;
  }
};

/**
 * Ask for physical-activity access. Must come from a user gesture: Android will
 * not show the sheet for a background caller, and a silent no-op looks like a
 * broken button. Starts the service itself on grant.
 */
export const requestActivityAccess = async (): Promise<BackgroundStepsStatus> => {
  if (!isBackgroundStepsSupported()) return UNAVAILABLE;
  try {
    return await BackgroundSteps.requestActivityPermission();
  } catch {
    return getBackgroundStatus();
  }
};

export const requestNotificationAccess = async (): Promise<BackgroundStepsStatus> => {
  if (!isBackgroundStepsSupported()) return UNAVAILABLE;
  try {
    return await BackgroundSteps.requestNotificationPermission();
  } catch {
    return getBackgroundStatus();
  }
};

/** Opens the system battery-optimisation list so counting can survive overnight. */
export const openBatterySettings = async (): Promise<void> => {
  if (!isBackgroundStepsSupported()) return;
  try {
    await BackgroundSteps.openBatterySettings();
  } catch {
    // No such screen on this OEM build; the plugin already falls back to the
    // app-info page, so there is nothing further to try here.
  }
};

export const startBackgroundCounting = async (): Promise<BackgroundStepsStatus> => {
  if (!isBackgroundStepsSupported()) return UNAVAILABLE;
  try {
    return await BackgroundSteps.start();
  } catch {
    return getBackgroundStatus();
  }
};

export const stopBackgroundCounting = async (): Promise<BackgroundStepsStatus> => {
  if (!isBackgroundStepsSupported()) return UNAVAILABLE;
  try {
    return await BackgroundSteps.stop();
  } catch {
    return getBackgroundStatus();
  }
};

/** Today's count from the native store. 0 when the tier is unavailable. */
export const readTodayBackgroundSteps = async (): Promise<number> => {
  if (!isBackgroundStepsSupported()) return 0;
  try {
    const today = await BackgroundSteps.getToday();
    const steps = Number(today?.steps);
    return Number.isFinite(steps) && steps > 0 ? steps : 0;
  } catch {
    return 0;
  }
};

/** Retained daily history from the native store, today included. */
export const readBackgroundHistory = async (): Promise<Record<string, number>> => {
  if (!isBackgroundStepsSupported()) return {};
  try {
    const result = await BackgroundSteps.getHistory();
    const days = result?.days ?? {};
    const out: Record<string, number> = {};
    for (const [day, value] of Object.entries(days)) {
      const steps = Number(value);
      if (Number.isFinite(steps) && steps > 0) out[day] = steps;
    }
    return out;
  } catch {
    return {};
  }
};

/** Live updates while the WebView is open. Returns a no-op unsubscribe when unsupported. */
export const onBackgroundSteps = async (
  listener: (event: TodaySteps) => void,
): Promise<() => void> => {
  if (!isBackgroundStepsSupported()) return () => {};
  try {
    const handle = await BackgroundSteps.addListener('stepsChanged', listener);
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
};
