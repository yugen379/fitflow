import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DailyHealthMetrics, isHealthAvailable, hasHealthPermissions,
  requestHealthPermissions, syncTodayActivity,
} from '../services/healthService';
import { isNativeApp } from '../lib/firebase';

export type ActivityStatus = 'checking' | 'unavailable' | 'disconnected' | 'connected';

// Foreground refresh cadence. Health Connect reads are local and cheap; the
// phone (or watch) does the actual step counting in the background at OS level,
// so re-reading is all that "live updating" needs.
const REFRESH_MS = 3 * 60 * 1000;

/**
 * Today's device activity (steps / distance / calories), kept fresh
 * automatically: on mount, whenever the app returns to the foreground, and on
 * an interval while visible. `connect()` runs the one-time permission sheet.
 */
export const useTodayActivity = (uid?: string, heightCm?: number) => {
  const [metrics, setMetrics] = useState<DailyHealthMetrics | null>(null);
  const [status, setStatus] = useState<ActivityStatus>('checking');
  const stateRef = useRef({ uid, heightCm, status: 'checking' as ActivityStatus });
  stateRef.current = { uid, heightCm, status };

  const refresh = useCallback(async () => {
    const { uid: id, heightCm: h, status: s } = stateRef.current;
    if (!id || s !== 'connected') return;
    const m = await syncTodayActivity(id, h);
    if (m) setMetrics(m);
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!stateRef.current.uid) return false;
    const granted = await requestHealthPermissions();
    if (!granted) return false;
    setStatus('connected');
    stateRef.current.status = 'connected';
    await refresh();
    return true;
  }, [refresh]);

  // Initial availability + silent permission check (no UI).
  useEffect(() => {
    if (!uid) return;
    if (!isNativeApp()) { setStatus('unavailable'); return; }
    let cancelled = false;
    (async () => {
      const { available } = await isHealthAvailable();
      if (cancelled) return;
      if (!available) { setStatus('unavailable'); return; }
      const granted = await hasHealthPermissions();
      if (cancelled) return;
      setStatus(granted ? 'connected' : 'disconnected');
      if (granted) {
        stateRef.current.status = 'connected';
        await refresh();
      }
    })();
    return () => { cancelled = true; };
  }, [uid, refresh]);

  // Auto-refresh: foreground return (Capacitor fires visibilitychange on app
  // resume) + a slow interval while visible. Also rolls the day over naturally,
  // since every fetch recomputes the midnight→now window.
  useEffect(() => {
    if (status !== 'connected') return;
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [status, refresh]);

  return { metrics, status, connect, refresh };
};
