import { Capacitor, registerPlugin } from '@capacitor/core';
import { collection, doc, getDocs, limit, orderBy, query, setDoc, updateDoc, where, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firestore';
import { caloriesFor, strideMetresFor } from '../lib/stepFormulas';
import { massToKg, weightsToImport, importedWeightId, latestRestingHr, summarizeLastNight, sleepQuality, importedSleepId, type HcSleepSession } from '../lib/healthImport';
import { localDate } from '../lib/adaptiveTarget';

export interface DailyHealthMetrics {
  steps: number;
  /** Kilometres walked today — estimated from steps × stride (user height). */
  distanceKm: number;
  activeMinutes: number;
  caloriesBurned: number;
  heartRateAvg?: number;
  /** Latest resting heart rate today (watch/band), if any. */
  restingHr?: number;
  source: 'health-connect' | 'healthkit' | 'google-fit-web' | 'none';
}

const isNative = () => Capacitor.isNativePlatform();
const platform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

let nativePluginCache: { hc: any } | null = null;

/**
 * The Health Connect plugin, wrapped in a plain object.
 *
 * A Capacitor plugin is a Proxy that answers to ANY property — including
 * `then`. Returning it straight from an async function makes JavaScript treat
 * it as a promise and wait on `plugin.then(...)`, a native call that never
 * answers. That is why Health Connect never connected: this function hung, so
 * the availability check never finished and the Connect row never appeared.
 * Wrapping it ({ hc }) is not thenable, so it resolves at once.
 */
const getHc = async (): Promise<{ hc: any } | null> => {
  if (nativePluginCache) return nativePluginCache;
  if (platform() === 'android') {
    try {
      // dynamic import keeps the web bundle clean
      const mod: any = await import('capacitor-health-connect');
      nativePluginCache = { hc: mod.HealthConnect };
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
  const plugin = (await getHc())?.hc ?? null;
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
// Weight: a smart scale's weigh-ins feed the smart calorie target.
// RestingHeartRate: recovery signal for the coach.
const HC_READ_TYPES = ['Steps', 'ActiveCaloriesBurned', 'HeartRateSeries', 'Weight', 'RestingHeartRate'];

// Our own native plugin (android/.../health/SleepPlugin.java): sleep, and one
// permission sheet for everything.
interface FitSleepPlugin {
  checkPermission(): Promise<{ available: boolean; granted: boolean }>;
  requestPermission(o: { permissions: string[] }): Promise<{ available: boolean; granted: boolean }>;
  readSleep(o: { days: number }): Promise<{ granted: boolean; sessions: HcSleepSession[] }>;
}
const FitSleep = registerPlugin<FitSleepPlugin>('FitSleep');
const HC_PERMISSIONS = [
  'android.permission.health.READ_STEPS', 'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_HEART_RATE', 'android.permission.health.READ_WEIGHT',
  'android.permission.health.READ_RESTING_HEART_RATE', 'android.permission.health.READ_SLEEP',
];

export const requestHealthPermissions = async (): Promise<boolean> => {
  if (!isNative()) return true; // web flow handled separately
  const plugin = (await getHc())?.hc ?? null;
  if (!plugin) return false;
  // One sheet listing every type, sleep included (older app versions without
  // the native sleep plugin fall through to the plugin's own request below).
  if (platform() === 'android') {
    try {
      await FitSleep.requestPermission({ permissions: HC_PERMISSIONS });
      const res = await plugin.checkHealthPermissions({ read: HC_READ_TYPES, write: [] });
      if (res?.hasAllPermissions || res?.grantedPermissions?.length) return true;
    } catch { /* fall back to the plugin's own sheet */ }
  }
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
  const plugin = (await getHc())?.hc ?? null;
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

// Stride and calorie maths live in lib/stepFormulas.ts. They used to be
// duplicated here with a 0.73 m fallback while the pedometer used 0.78 m, which
// meant the same walk read as two different distances on two different screens.
const strideMetres = (heightCm?: number): number => strideMetresFor(heightCm);

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

export const fetchTodayHealth = async (heightCm?: number, weightKg?: number): Promise<DailyHealthMetrics> => {
  const start = startOfToday();
  const end = new Date();
  const empty: DailyHealthMetrics = { steps: 0, distanceKm: 0, activeMinutes: 0, caloriesBurned: 0, source: 'none' };

  if (!isNative()) return { ...empty, source: 'google-fit-web' };

  const plugin = (await getHc())?.hc ?? null;
  if (!plugin) return empty;

  const timeRangeFilter = {
    type: 'between' as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };

  try {
    const [stepRecs, calRecs, hrRecs, restRecs] = await Promise.all([
      readAll(plugin, 'Steps', timeRangeFilter),
      readAll(plugin, 'ActiveCaloriesBurned', timeRangeFilter),
      readAll(plugin, 'HeartRateSeries', timeRangeFilter),
      readAll(plugin, 'RestingHeartRate', timeRangeFilter),
    ]);
    const restingHr = latestRestingHr(restRecs.map((r: any) => ({ time: r.time, bpm: r.beatsPerMinute }))) ?? undefined;

    const steps = stepRecs.reduce((a: number, r: any) => a + (Number(r.count) || 0), 0);
    let calories = calRecs.reduce((a: number, r: any) => a + toKcal(r.energy), 0);
    // No calories provider on many phones — estimate from steps (~0.04 kcal/step)
    // so the number is honest-adjacent rather than a flat 0 next to 8,000 steps.
    if (calories === 0 && steps > 0) calories = caloriesFor(steps, weightKg);

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
      restingHr,
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
export const syncTodayActivity = async (userId: string, heightCm?: number, weightKg?: number): Promise<DailyHealthMetrics | null> => {
  if (!isNative() || !userId) return null;
  if (!(await hasHealthPermissions())) return null;
  const metrics = await fetchTodayHealth(heightCm, weightKg);
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
          ...(metrics.restingHr ? { restingHr: metrics.restingHr } : {}),
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
  // Scale weigh-ins: cheap to check, but no need more than every 6 hours.
  void importScaleWeights(userId).catch(() => {});
  void importLastNightSleep(userId).catch(() => {});
  return metrics;
};

const WEIGHT_IMPORT_KEY = 'ff_hc_weight_import_at';
const WEIGHT_IMPORT_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Copy smart-scale weigh-ins from Health Connect into weight history: one per
 * day, only days without a weight the user typed, ids fixed per day so a
 * re-sync can never duplicate. Returns how many were added. Never throws.
 */
export const importScaleWeights = async (userId: string, { force = false } = {}): Promise<number> => {
  try {
    if (!isNative() || !userId) return 0;
    const last = Number(localStorage.getItem(WEIGHT_IMPORT_KEY) || 0);
    if (!force && Date.now() - last < WEIGHT_IMPORT_EVERY_MS) return 0;
    const plugin = (await getHc())?.hc ?? null;
    if (!plugin) return 0;
    localStorage.setItem(WEIGHT_IMPORT_KEY, String(Date.now()));
    const since = new Date(); since.setDate(since.getDate() - 60);
    const recs = await readAll(plugin, 'Weight', { type: 'between', startTime: since.toISOString(), endTime: new Date().toISOString() });
    const hc = recs.map((r: any) => ({ time: String(r.time), kg: massToKg(r.weight) ?? NaN }));
    if (!hc.length) return 0;
    const existing = await getDocs(query(
      collection(db, 'weight_history'), where('userId', '==', userId), orderBy('timestamp', 'desc'), limit(180),
    ));
    const have = existing.docs.map((d) => d.data().timestamp?.toDate?.()).filter(Boolean).map((t: Date) => localDate(t));
    const add = weightsToImport(hc, have);
    let added = 0;
    for (const w of add) {
      try {
        await setDoc(doc(db, 'weight_history', importedWeightId(userId, w.date)), {
          userId, weight: w.kg, timestamp: Timestamp.fromDate(w.at), source: 'health-connect',
        });
        added++;
      } catch { /* already imported (create-only) or offline */ }
    }
    const newestTyped = existing.docs.map((d) => d.data().timestamp?.toDate?.() as Date | undefined).filter(Boolean)[0];
    if (added && add[0] && (!newestTyped || add[0].at > newestTyped)) {
      try { await updateDoc(doc(db, 'users', userId), { weight: add[0].kg }); } catch { /* non-blocking */ }
    }
    return added;
  } catch {
    return 0;
  }
};

export const connectAndPersist = async (userId: string): Promise<DailyHealthMetrics | null> => {
  const granted = await requestHealthPermissions();
  if (!granted) return null;
  const metrics = await fetchTodayHealth();
  // Bring in history straight away rather than on the next sync.
  void importScaleWeights(userId, { force: true }).catch(() => {});
  void importLastNightSleep(userId).catch(() => {});
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

const SLEEP_IMPORT_KEY = 'ff_hc_sleep_import_day';

/**
 * Last night's sleep from a watch or band, as today's sleep log (once a day,
 * fixed id). Home's "Sleep last night" and the weekly recap read it from there.
 * Returns hours, or null. Never throws.
 */
export const importLastNightSleep = async (userId: string): Promise<number | null> => {
  try {
    if (!isNative() || platform() !== 'android' || !userId) return null;
    const today = localDate(new Date());
    if (localStorage.getItem(SLEEP_IMPORT_KEY) === today) return null;
    const res = await FitSleep.readSleep({ days: 2 });
    if (!res?.granted) return null;
    const night = summarizeLastNight(res.sessions || []);
    if (!night) return null;  // nothing recorded yet: try again on the next sync
    const hours = Math.round((night.minutes / 60) * 10) / 10;
    try {
      await setDoc(doc(db, 'sleep_logs', importedSleepId(userId, today)), {
        userId, hours, quality: sleepQuality(night), timestamp: serverTimestamp(),
        source: 'health-connect', minutes: night.minutes, deepMin: night.deepMin, remMin: night.remMin,
      });
    } catch { /* already imported today (create-only) */ }
    localStorage.setItem(SLEEP_IMPORT_KEY, today);
    return hours;
  } catch {
    return null;
  }
};
