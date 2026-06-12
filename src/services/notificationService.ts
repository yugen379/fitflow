import {
  addDoc, collection, serverTimestamp, query, where, getDocs, orderBy, limit, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppNotification } from '../types';

const SHOWN_KEY = (uid: string, kind: string) => `ff_notif_${kind}_${uid}`;
const todayKey = () => new Date().toDateString();

export const sendLocalNotification = async (
  userId: string,
  title: string,
  body: string,
  type: AppNotification['type'],
) => {
  try {
    await addDoc(collection(db, 'notifications'), {
      userId, title, body, type, read: false, timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error sending local notification:', error);
  }
};

/**
 * Whole days since the user's most recent workout. 0 = trained today, null = no
 * history (or query failed). Used by the proactive coach to surface "it's been N
 * days" nudges. Never throws.
 */
export const getDaysSinceLastWorkout = async (userId: string): Promise<number | null> => {
  try {
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const ts = snap.docs[0].data().timestamp?.toDate?.();
    if (!ts) return null;
    const last = new Date(ts as Date);
    last.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today.getTime() - last.getTime()) / 86400000));
  } catch {
    return null;
  }
};

/**
 * Proactively drop the coach's single most important nudge into the in-app
 * notification feed — at most once per day, and only when the top nudge actually
 * changes. This is the "coach reaches out" half of the feature; it complements
 * scheduleReminders' time-based pings. Idempotent via localStorage. Never throws.
 */
export const pushTopNudge = async (
  userId: string,
  nudge: { id: string; title: string; message: string } | undefined | null,
): Promise<void> => {
  if (!userId || !nudge || !nudge.id) return;
  try {
    const key = SHOWN_KEY(userId, 'coach-nudge');
    const stamp = `${todayKey()}|${nudge.id}`;
    // Skip if we've already pushed this exact nudge today. If the top nudge
    // changes later in the day, the new one is allowed through (genuinely
    // proactive) — but the same one never repeats.
    if (localStorage.getItem(key) === stamp) return;
    await sendLocalNotification(userId, nudge.title, nudge.message, 'reminder');
    localStorage.setItem(key, stamp);
  } catch {
    // ignore — the on-screen briefing card is the primary surface
  }
};

/**
 * Inspect the user's last ~50 workouts and return the hour bucket they most often train.
 * Returns null if not enough data (<3 workouts).
 */
export const getMostCommonWorkoutHour = async (userId: string): Promise<number | null> => {
  try {
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(50),
    );
    const snap = await getDocs(q);
    if (snap.size < 3) return null;
    const counts: Record<number, number> = {};
    snap.forEach(d => {
      const ts = d.data().timestamp?.toDate?.();
      if (!ts) return;
      const h = (ts as Date).getHours();
      counts[h] = (counts[h] || 0) + 1;
    });
    let bestHour: number | null = null;
    let bestCount = 0;
    Object.entries(counts).forEach(([h, c]) => {
      if (c > bestCount) { bestCount = c; bestHour = parseInt(h, 10); }
    });
    return bestHour;
  } catch {
    return null;
  }
};

/**
 * Persist the inferred workout time back to the user profile so the FCM scheduler can use it.
 * Returns the hour we set, or null if no change.
 */
export const inferAndPersistPreferredWorkoutTime = async (
  userId: string,
  current?: string,
): Promise<number | null> => {
  const inferredHour = await getMostCommonWorkoutHour(userId);
  if (inferredHour === null) return null;
  const inferredTime = `${String(inferredHour).padStart(2, '0')}:00`;
  if (current === inferredTime) return inferredHour;
  try {
    await updateDoc(doc(db, 'users', userId), {
      preferredWorkoutTime: inferredTime,
      preferredWorkoutTimeSource: 'inferred',
    });
  } catch {
    // ignore
  }
  return inferredHour;
};

/**
 * Daily smart reminder. Fires once per kind per day, only after the right hour has arrived.
 *  - hydration nudge at 10:00 if user is online before noon
 *  - workout window nudge 30 min before user's most-common workout hour
 *  - end-of-day macro check at 20:00
 */
export const scheduleReminders = async (userId: string, preferredTime?: string) => {
  if (!userId) return;
  const today = todayKey();
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // 1. Hydration at 10:00
  if (hour >= 10 && hour < 12) {
    const key = SHOWN_KEY(userId, 'hydration');
    if (localStorage.getItem(key) !== today) {
      await sendLocalNotification(
        userId,
        'Hydration check',
        'Knock out a glass of water now to keep energy steady through the afternoon.',
        'reminder',
      );
      localStorage.setItem(key, today);
    }
  }

  // 2. Workout-time nudge
  const inferred = await inferAndPersistPreferredWorkoutTime(userId, preferredTime);
  const targetHour = inferred ?? (preferredTime ? parseInt(preferredTime.split(':')[0], 10) : null);
  if (targetHour !== null) {
    const nudgeHour = (targetHour - 1 + 24) % 24;
    const key = SHOWN_KEY(userId, 'workout-window');
    const inWindow =
      (hour === nudgeHour && minute >= 30) || (hour === targetHour && minute < 30);
    if (inWindow && localStorage.getItem(key) !== today) {
      await sendLocalNotification(
        userId,
        'Training window opens soon',
        `You usually train around ${targetHour}:00. Got 30 minutes ready?`,
        'reminder',
      );
      localStorage.setItem(key, today);
    }
  }

  // 3. End-of-day macro reflection at 20:00
  if (hour >= 20 && hour < 22) {
    const key = SHOWN_KEY(userId, 'end-of-day');
    if (localStorage.getItem(key) !== today) {
      await sendLocalNotification(
        userId,
        'Wrap up your day',
        "Log your last meal and water so tomorrow's plan adapts to where you actually landed.",
        'reminder',
      );
      localStorage.setItem(key, today);
    }
  }
};
