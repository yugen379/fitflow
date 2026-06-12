// Retention analytics — Firestore I/O (#4).
//
// recordActiveDay drops one idempotent marker per user per local day; getRetention
// reads the markers and computes streaks + D1/D7/D30 via the pure retentionUtils.
// Best-effort: instrumentation must never break the app, so everything degrades
// gracefully and never throws.

import { collection, doc, setDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dayKey, computeRetention, RetentionStats } from './retentionUtils';

/** Mark today active for this user. Idempotent (one doc per uid+day). Never throws. */
export const recordActiveDay = async (uid: string): Promise<void> => {
  if (!uid) return;
  try {
    const day = dayKey(new Date());
    await setDoc(
      doc(db, 'activity_days', `${uid}_${day}`),
      { userId: uid, day, timestamp: serverTimestamp() },
      { merge: true },
    );
  } catch {
    // ignore — losing one day's marker is harmless
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
    return computeRetention(signupDay, days, today);
  } catch {
    return computeRetention(today, [today], today);
  }
};
