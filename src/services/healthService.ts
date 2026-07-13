import { Capacitor } from '@capacitor/core';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface DailyHealthMetrics {
  steps: number;
  /** Kilometres walked today — estimated from steps × stride (user height). */
  distanceKm: number;
  activeMinutes: number;
  caloriesBurned: number;
  heartRateAvg?: number;
  source: 'health-connect' | 'healthkit' | 'google-fit-web' | 'none';
}

const isNative = () => Capacitor.isNativePlatform();
const platform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

let nativePluginCache: any = null;

const getNativePlugin = async () => {
  if (nativePluginCache) return nativePluginCache;
  if (platform() === 'android') {
    try {
      // dynamic import keeps the web bundle clean
      const mod: any = await import('capacitor-health-connect');
      nativePluginCache = mod.HealthConnect;
      return nativePluginCache;
    } catch {
      return null;
    }
  }
  // iOS would import a HealthKit plugin here once shipped
  return null;
};

export const isHealthAvailable = async (): Promise<{ available: boolean; source: DailyHealthMetrics['source'] }> => {
  if (!isNative()) {
    // PWA falls back to Google Fit OAuth flow already in the app
    return { available: true, source: 'google-fit-web' };
  }
  const plugin = await getNativePlugin();
  if (!plugin) return { available: false, source: 'none' };
  try {
    const status = await plugin.checkAvailability();
    const ok = status?.availability === 'Available' || status?.available === true;
    return { available: !!ok, source: platform() === 'ios' ? 'healthkit' : 'health-connect' };
  } catch {
    return { available: false, source: 'none' };
  }
};

// Record types this plugin version actually supports (capacitor-health-connect
// has no Distance/ExerciseSession/SleepSession — distance is derived from steps).
const HC_READ_TYPES = ['Steps', 'ActiveCaloriesBurned', 'HeartRateSeries'];

export const requestHealthPermissions = async (): Promise<boolean> => {
  if (!isNative()) return true; // web flow handled separately
  const plugin = await getNativePlugin();
  if (!plugin) return false;
  try {
    // The plugin API takes { read, write } — passing anything else silently
    // requests nothing (this was why Health Connect never linked up).
    const res = await plugin.requestHealthPermissions({ read: HC_READ_TYPES, write: [] });
    return !!res?.hasAllPermissions || !!res?.grantedPermissions?.length;
  } catch {
    return false;
  }
};

/** Permission status without showing any UI — safe to call on every launch. */
export const hasHealthPermissions = async (): Promise<boolean> => {
  if (!isNative()) return false;
  const plugin = await getNativePlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.checkHealthPermissions({ read: HC_READ_TYPES, write: [] });
    return !!res?.hasAllPermissions || !!res?.grantedPermissions?.length;
  } catch {
    return false;
  }
};

const startOfToday = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
};

const toKcal = (energy: any): number => {
  const v = Number(energy?.value ?? energy?.inKilocalories ?? 0);
  if (!v) return 0;
  switch (energy?.unit) {
    case 'calories': return v / 1000;
    case 'joules': return v / 4184;
    case 'kilojoules': return v / 4.184;
    default: return v; // kilocalories
  }
};

// Walking stride ≈ 41.4% of height; fall back to a population-average stride.
const strideMetres = (heightCm?: number): number =>
  heightCm && heightCm > 100 ? (heightCm * 0.414) / 100 : 0.73;

// Follow pagination so a day with many per-source chunks isn't undercounted.
const readAll = async (plugin: any, type: string, timeRangeFilter: any): Promise<any[]> => {
  const out: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await plugin.readRecords({ type, timeRangeFilter, pageToken }).catch(() => null);
    if (!res) break;
    out.push(...(res.records || []));
    pageToken = res.pageToken;
    if (!pageToken) break;
  }
  return out;
};

export const fetchTodayHealth = async (heightCm?: number): Promise<DailyHealthMetrics> => {
  const start = startOfToday();
  const end = new Date();
  const empty: DailyHealthMetrics = { steps: 0, distanceKm: 0, activeMinutes: 0, caloriesBurned: 0, source: 'none' };

  if (!isNative()) return { ...empty, source: 'google-fit-web' };

  const plugin = await getNativePlugin();
  if (!plugin) return empty;

  const timeRangeFilter = {
    type: 'between' as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };

  try {
    const [stepRecs, calRecs, hrRecs] = await Promise.all([
      readAll(plugin, 'Steps', timeRangeFilter),
      readAll(plugin, 'ActiveCaloriesBurned', timeRangeFilter),
      readAll(plugin, 'HeartRateSeries', timeRangeFilter),
    ]);

    const steps = stepRecs.reduce((a: number, r: any) => a + (Number(r.count) || 0), 0);
    let calories = calRecs.reduce((a: number, r: any) => a + toKcal(r.energy), 0);
    // No calories provider on many phones — estimate from steps (~0.04 kcal/step)
    // so the number is honest-adjacent rather than a flat 0 next to 8,000 steps.
    if (calories === 0 && steps > 0) calories = steps * 0.04;

    const hrSamples = hrRecs
      .flatMap((r: any) => (r.samples || []).map((s: any) => Number(s.beatsPerMinute) || 0))
      .filter(Boolean);
    const heartRateAvg = hrSamples.length
      ? Math.round(hrSamples.reduce((a: number, b: number) => a + b, 0) / hrSamples.length)
      : undefined;

    const distanceKm = Math.round(((steps * strideMetres(heightCm)) / 1000) * 100) / 100;
    // ~8 kcal/min of activity, or ~130 steps/min brisk walking — whichever
    // credits more, so neither a missing calories provider nor an unlogged
    // workout zeroes the number.
    const activeMinutes = Math.max(Math.round(calories / 8), Math.round(steps / 130));

    return {
      steps,
      distanceKm,
      activeMinutes,
      caloriesBurned: Math.round(calories),
      heartRateAvg,
      source: platform() === 'ios' ? 'healthkit' : 'health-connect',
    };
  } catch {
    return empty;
  }
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Firestore writes are throttled; the UI always gets fresh reads regardless.
const PERSIST_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastPersistAt = 0;
let lastPersistDate = '';

/**
 * Silent background sync: read today's activity from Health Connect and mirror
 * a compact snapshot onto the user doc (throttled) so the proactive coach and
 * analytics can see device activity. Never prompts, never throws.
 */
export const syncTodayActivity = async (userId: string, heightCm?: number): Promise<DailyHealthMetrics | null> => {
  if (!isNative() || !userId) return null;
  if (!(await hasHealthPermissions())) return null;
  const metrics = await fetchTodayHealth(heightCm);
  if (metrics.source === 'none') return null;

  const date = todayKey();
  const now = Date.now();
  if (now - lastPersistAt >= PERSIST_MIN_INTERVAL_MS || lastPersistDate !== date) {
    lastPersistAt = now;
    lastPersistDate = date;
    try {
      await updateDoc(doc(db, 'users', userId), {
        todayActivity: {
          date,
          steps: metrics.steps,
          distanceKm: metrics.distanceKm,
          caloriesBurned: metrics.caloriesBurned,
          activeMinutes: metrics.activeMinutes,
          updatedAt: now,
        },
        healthConnectConnected: metrics.source === 'health-connect',
        healthKitConnected: metrics.source === 'healthkit',
        lastHealthSync: serverTimestamp(),
        lastHealthSource: metrics.source,
      });
    } catch {
      // offline / permission-denied — the on-screen numbers still updated
    }
  }
  return metrics;
};

export const connectAndPersist = async (userId: string): Promise<DailyHealthMetrics | null> => {
  const granted = await requestHealthPermissions();
  if (!granted) return null;
  const metrics = await fetchTodayHealth();
  try {
    await updateDoc(doc(db, 'users', userId), {
      healthConnectConnected: metrics.source === 'health-connect',
      healthKitConnected: metrics.source === 'healthkit',
      lastHealthSync: serverTimestamp(),
      lastHealthSource: metrics.source,
    });
  } catch {
    // permission-denied is fine here — non-blocking
  }
  return metrics;
};
