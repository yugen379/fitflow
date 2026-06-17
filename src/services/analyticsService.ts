// Retention analytics — Firestore I/O (#4).
//
// recordActiveDay drops one idempotent marker per user per local day; getRetention
// reads the markers and computes streaks + D1/D7/D30 via the pure retentionUtils.
// Best-effort: instrumentation must never break the app, so everything degrades
// gracefully and never throws.

import { collection, doc, setDoc, getDocs, updateDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dayKey, computeRetention, streakWithFreezes, RetentionStats } from './retentionUtils';
import { getFreezeDays } from './streakFreezeService';

/**
 * Mark today active for this user. Idempotent (one doc per uid+day). Never throws.
 *
 * Also denormalizes lastActiveDay + currentStreak onto the user doc and resets the
 * win-back tier (the user is back). The proactive-engagement Cloud Functions read
 * those cheap fields instead of re-querying every user's activity_days — see
 * engagementUtils / functions/src/index.ts (streak-risk + win-back).
 */
export const recordActiveDay = async (uid: string): Promise<void> => {
  if (!uid) return;
  const day = dayKey(new Date());
  try {
    await setDoc(
      doc(db, 'activity_days', `${uid}_${day}`),
      { userId: uid, day, timestamp: serverTimestamp() },
      { merge: true },
    );
  } catch {
    // ignore — losing one day's marker is harmless
  }
  // Best-effort denormalization for the server-side nudge engine.
  try {
    const snap = await getDocs(query(collection(db, 'activity_days'), where('userId', '==', uid)));
    const days = snap.docs.map((d) => d.data().day as string).filter((d) => typeof d === 'string');
    if (!days.includes(day)) days.push(day);
    const freezeDays = await getFreezeDays(uid);
    const currentStreak = streakWithFreezes(days, freezeDays, day);
    await updateDoc(doc(db, 'users', uid), {
      lastActiveDay: day,
      currentStreak,
      winbackLastTier: 0,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // ignore — denormalization is an accelerator, never a dependency
  }
};

/**
 * Fetch all active-day markers and compute retention stats. signupDate falls back
 * to the earliest active day, then to today. Returns a sensible single-day result
 * on any failure so the UI always has something to render.
 */
export const getRetentionStats = async (
  uid: string,
  signupDate?: Date | null,
): Promise<RetentionStats> => {
  const today = dayKey(new Date());
  try {
    const snap = await getDocs(query(collection(db, 'activity_days'), where('userId', '==', uid)));
    const days = snap.docs.map((d) => d.data().day as string).filter((d) => typeof d === 'string');
    const sorted = [...days].sort();
    const signupDay = signupDate ? dayKey(signupDate) : (sorted.length ? sorted[0] : today);
    // Always count today as active (the user is here right now).
    if (!days.includes(today)) days.push(today);
    const stats = computeRetention(signupDay, days, today);
    // Honour streak freezes so a protected streak shows unbroken (Feature 5).
    const freezeDays = await getFreezeDays(uid);
    return freezeDays.length
      ? { ...stats, currentStreak: streakWithFreezes(days, freezeDays, today) }
      : stats;
  } catch {
    return computeRetention(today, [today], today);
  }
};
