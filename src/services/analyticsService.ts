// Retention analytics — Firestore I/O (#4).
//
// recordActiveDay drops one idempotent marker per user per local day; getRetention
// reads the markers and computes streaks + D1/D7/D30 via the pure retentionUtils.
// Best-effort: instrumentation must never break the app, so everything degrades
// gracefully and never throws.

import { collection, doc, setDoc, getDocs, updateDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firestore';
import { dayKey, computeRetention, streakWithFreezes, daysBetweenKeys, RetentionStats } from './retentionUtils';
import { getFreezeDays } from './streakFreezeService';
import { reportSwallowed } from '../lib/telemetry';
import { checkAndAwardBadge, checkStreakBadge } from './badgeService';

/**
 * Mark today active for this user. Idempotent (one doc per uid+day). Never throws.
 *
 * Also denormalizes lastActiveDay + currentStreak onto the user doc and resets the
 * win-back tier (the user is back). The proactive-engagement Cloud Functions read
 * those cheap fields instead of re-querying every user's activity_days — see
 * engagementUtils / functions/src/index.ts (streak-risk + win-back).
 */
/**
 * The day this session has already recorded, per uid.
 *
 * Recording is idempotent, but the denormalisation below reads every active-day
 * marker the user has. That is fine once per day; it is not fine on every meal
 * and workout write, which is where this is now called from. Once today is
 * banked there is nothing left to recompute until the date changes.
 */
let recordedFor: { uid: string; day: string } | null = null;

/**
 * Mark today active for this user. Idempotent (one doc per uid+day). Never throws.
 *
 * Also denormalizes lastActiveDay + currentStreak + streak onto the user doc and
 * resets the win-back tier (the user is back). The proactive-engagement Cloud
 * Functions read those cheap fields instead of re-querying every user's
 * activity_days — see engagementUtils / functions/src/index.ts (streak-risk +
 * win-back).
 *
 * `streak` is written alongside `currentStreak` because `streak` is the field the
 * entire UI reads — Home, Profile, Analytics, both leaderboards, the AI coach's
 * context and the XP bar. It used to be maintained by a separate counter that
 * measured ELAPSED HOURS rather than calendar days, so it incremented again on
 * every extra log within 24h and reset to 1 whenever two consecutive days were
 * more than 24h apart (logging at 08:00 then 08:01 the next day broke it). There
 * is now exactly one streak in the app, and it is this proof-tested one.
 */
export const recordActiveDay = async (uid: string): Promise<void> => {
  if (!uid) return;
  const day = dayKey(new Date());
  if (recordedFor && recordedFor.uid === uid && recordedFor.day === day) return;
  try {
    await setDoc(
      doc(db, 'activity_days', `${uid}_${day}`),
      { userId: uid, day, timestamp: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    // The log still succeeded, so this stays non-fatal. It is not harmless
    // though: this marker IS the streak, and a day lost here is a streak
    // broken for a reason the user will never be able to explain.
    reportSwallowed('analytics.recordActiveDay.marker', err, { uid, day });
  }
  // Best-effort denormalization for the server-side nudge engine and the UI.
  try {
    const snap = await getDocs(query(collection(db, 'activity_days'), where('userId', '==', uid)));
    const days = snap.docs.map((d) => d.data().day as string).filter((d) => typeof d === 'string');

    // The most recent day BEFORE today, for the comeback badge. Computed before
    // today is appended so it cannot see itself.
    const previousDay = days
      .filter((d) => (daysBetweenKeys(d, day) ?? 0) > 0)
      .sort()
      .pop();

    if (!days.includes(day)) days.push(day);
    const freezeDays = await getFreezeDays(uid);
    const currentStreak = streakWithFreezes(days, freezeDays, day);
    await updateDoc(doc(db, 'users', uid), {
      lastActiveDay: day,
      currentStreak,
      // One streak, one number, everywhere.
      streak: currentStreak,
      winbackLastTier: 0,
      updatedAt: serverTimestamp(),
    });
    recordedFor = { uid, day };

    // Badges that depend on the streak had no caller at all until now, so
    // "On A Roll", "Consistency King" and "Unstoppable" were displayed in the
    // Profile gallery as goals nobody could ever reach.
    await checkStreakBadge(uid, currentStreak);
    const gap = previousDay ? daysBetweenKeys(previousDay, day) : null;
    if (gap !== null && gap >= 7) await checkAndAwardBadge(uid, 'comeback_kid');
  } catch (err) {
    // Non-fatal by design, but everything downstream reads these fields:
    // the streak the whole UI shows, the server-side nudge engine, and the
    // streak + comeback badges. Failing here is silent and total.
    reportSwallowed('analytics.recordActiveDay.denormalize', err, { uid, day });
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
  } catch (err) {
    // The fallback FABRICATES a plausible answer (a brand-new one-day
    // streak) so the UI has something to render. That is a lie the user
    // cannot detect, so it must not also be a lie the developer cannot see.
    reportSwallowed('analytics.getRetentionStats.fallback', err, { uid });
    return computeRetention(today, [today], today);
  }
};
