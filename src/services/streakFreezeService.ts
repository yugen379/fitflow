// Streak freeze / repair (Feature 5) — Firestore I/O.
//
// The moment a streak breaks is the #1 rage-quit churn event. A freeze protects a
// missed day so the run survives. Free users get FREE_FREEZES_PER_MONTH; Pro gets
// unlimited (a real, non-gating premium hook tied to the existing entitlement engine).
//
// Freeze markers live in streak_freezes/{uid}_{YYYY-MM-DD}. The streak math that
// honours them is the pure streakWithFreezes() in retentionUtils (proven 100%).
// All operations are best-effort and never throw.

import { collection, doc, getDocs, query, where, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dayKey } from './retentionUtils';
import { isProUnlocked } from '../lib/billing';
import type { UserProfile } from '../types';

export const FREE_FREEZES_PER_MONTH = 1;

/** 'YYYY-MM' for the given date (local). Used to reset the monthly free allowance. */
export const monthKey = (d: Date = new Date()): string => dayKey(d).slice(0, 7);

export interface FreezeStatus {
  isPro: boolean;
  limit: number;        // Infinity for Pro
  used: number;         // used this calendar month
  remaining: number;    // Infinity for Pro
}

/** How many freezes the user may still use this month, given their plan + usage. */
export const getFreezeStatus = (profile?: UserProfile | null): FreezeStatus => {
  const isPro = isProUnlocked(profile);
  const limit = isPro ? Infinity : FREE_FREEZES_PER_MONTH;
  const thisMonth = monthKey();
  const used = (profile as any)?.streakFreezeMonth === thisMonth
    ? Math.max(0, Number((profile as any)?.streakFreezeUsedThisMonth) || 0)
    : 0;
  const remaining = isPro ? Infinity : Math.max(0, limit - used);
  return { isPro, limit, used, remaining };
};

/** All freeze-day keys for a user (for the streak computation). Never throws. */
export const getFreezeDays = async (uid: string): Promise<string[]> => {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'streak_freezes'), where('userId', '==', uid)));
    return snap.docs.map((d) => d.data().day as string).filter((d) => typeof d === 'string');
  } catch {
    return [];
  }
};

export interface UseFreezeResult {
  ok: boolean;
  reason?: 'no-allowance' | 'error';
  day?: string;
}

/**
 * Spend one freeze to protect a missed day (defaults to yesterday — the day whose
 * miss would break the current streak). Enforces the monthly allowance for free
 * users; Pro is unlimited. Idempotent per day. Never throws.
 */
export const spendStreakFreeze = async (
  uid: string,
  profile?: UserProfile | null,
  day?: string,
): Promise<UseFreezeResult> => {
  if (!uid) return { ok: false, reason: 'error' };
  const status = getFreezeStatus(profile);
  if (status.remaining <= 0) return { ok: false, reason: 'no-allowance' };

  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); })();
  const target = day || yesterday;

  try {
    await setDoc(
      doc(db, 'streak_freezes', `${uid}_${target}`),
      { userId: uid, day: target, timestamp: serverTimestamp() },
      { merge: true },
    );
    // Increment the monthly counter (reset if we've rolled into a new month).
    if (!status.isPro) {
      const thisMonth = monthKey();
      const used = (profile as any)?.streakFreezeMonth === thisMonth
        ? Math.max(0, Number((profile as any)?.streakFreezeUsedThisMonth) || 0)
        : 0;
      await updateDoc(doc(db, 'users', uid), {
        streakFreezeMonth: thisMonth,
        streakFreezeUsedThisMonth: used + 1,
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true, day: target };
  } catch {
    return { ok: false, reason: 'error' };
  }
};
