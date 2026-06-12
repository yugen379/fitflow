import { Capacitor } from '@capacitor/core';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface DailyHealthMetrics {
  steps: number;
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

const PERMS = {
  read: [
    { accessType: 'read', recordType: 'Steps' },
    { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
    { accessType: 'read', recordType: 'ExerciseSession' },
    { accessType: 'read', recordType: 'HeartRate' },
    { accessType: 'read', recordType: 'SleepSession' },
    { accessType: 'read', recordType: 'Weight' },
  ],
};

export const requestHealthPermissions = async (): Promise<boolean> => {
  if (!isNative()) return true; // web flow handled separately
  const plugin = await getNativePlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.requestHealthPermissions({ readTypes: PERMS.read.map(p => p.recordType) });
    return !!res?.grantedPermissions?.length || !!res?.granted;
  } catch {
    return false;
  }
};

const startOfToday = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
};

export const fetchTodayHealth = async (): Promise<DailyHealthMetrics> => {
  const start = startOfToday();
  const end = new Date();
  const empty: DailyHealthMetrics = { steps: 0, activeMinutes: 0, caloriesBurned: 0, source: 'none' };

  if (!isNative()) return { ...empty, source: 'google-fit-web' };

  const plugin = await getNativePlugin();
  if (!plugin) return empty;

  const timeRangeFilter = {
    type: 'between' as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };

  try {
    const [stepsRes, calRes, hrRes, sessRes] = await Promise.all([
      plugin.readRecords({ type: 'Steps', timeRangeFilter }).catch(() => null),
      plugin.readRecords({ type: 'ActiveCaloriesBurned', timeRangeFilter }).catch(() => null),
      plugin.readRecords({ type: 'HeartRate', timeRangeFilter }).catch(() => null),
      plugin.readRecords({ type: 'ExerciseSession', timeRangeFilter }).catch(() => null),
    ]);

    const steps = (stepsRes?.records || []).reduce((a: number, r: any) => a + (r.count || 0), 0);
    const calories = (calRes?.records || []).reduce((a: number, r: any) => a + (r.energy?.inKilocalories || r.energy?.value || 0), 0);
    const hrSamples = (hrRes?.records || []).flatMap((r: any) => (r.samples || []).map((s: any) => s.beatsPerMinute || 0)).filter(Boolean);
    const heartRateAvg = hrSamples.length ? Math.round(hrSamples.reduce((a: number, b: number) => a + b, 0) / hrSamples.length) : undefined;

    // Prefer real exercise-session duration when available; fall back to a
    // calories-based estimate so the number is never zero on days with no
    // recorded session but real activity.
    const sessionMinutes = (sessRes?.records || []).reduce((a: number, r: any) => {
      const start = r.startTime ? new Date(r.startTime).getTime() : 0;
      const end = r.endTime ? new Date(r.endTime).getTime() : 0;
      return end > start ? a + (end - start) / 60000 : a;
    }, 0);
    const activeMinutes = sessionMinutes > 0
      ? Math.round(sessionMinutes)
      : Math.round(calories / 8);

    return {
      steps,
      activeMinutes,
      caloriesBurned: Math.round(calories),
      heartRateAvg,
      source: platform() === 'ios' ? 'healthkit' : 'health-connect',
    };
  } catch {
    return empty;
  }
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
