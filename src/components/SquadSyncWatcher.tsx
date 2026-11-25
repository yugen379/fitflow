import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

/**
 * Keeps my numbers on every squad leaderboard current, in the background.
 *
 * Off the boot path on purpose: this component is lazy, waits 20 s after the
 * app settles, and only then dynamic-imports the squad service. After that it
 * publishes at most once every 10 minutes (shared across tabs/reloads via
 * localStorage) and only while the app is visible. The Squads page also
 * publishes on open, so a person looking at the board never sees stale numbers
 * of their own.
 */
const THROTTLE_MS = 10 * 60 * 1000;
const FIRST_DELAY_MS = 20 * 1000;
const key = (uid: string) => `ff_squad_sync_${uid}`;

export const SquadSyncWatcher = () => {
  const { profile } = useAuth();
  const uid = profile?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      let last = 0;
      try { last = Number(localStorage.getItem(key(uid))) || 0; } catch { /* private mode */ }
      if (Date.now() - last < THROTTLE_MS) return;
      try { localStorage.setItem(key(uid), String(Date.now())); } catch { /* private mode */ }
      try {
        const { publishAllMyWeeks } = await import('../services/squadService');
        if (!cancelled) await publishAllMyWeeks(uid);
      } catch {
        /* offline or not signed in yet: the next tick retries */
      }
    };
    const first = window.setTimeout(() => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (ric) ric(() => void tick()); else void tick();
    }, FIRST_DELAY_MS);
    const every = window.setInterval(() => void tick(), THROTTLE_MS);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(every); };
  }, [uid]);

  return null;
};
