import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { computeLevel } from './missionUtils';
import { checkProgressionBadges } from './badgeService';

/**
 * Award XP and keep the stored `level` in sync with the curve.
 *
 * `points` is incremented atomically (no read-modify-write races between a meal
 * log and a water tap landing together), then the authoritative total is read
 * back and `level` is rewritten only when the curve says it changed — that
 * write is what makes the Home XP bar's level-up moment fire everywhere the
 * profile is displayed. XP is a reward, never a blocker: any failure here is
 * swallowed so logging flows can't be broken by a points hiccup.
 */
export const awardXp = async (userId: string, amount: number): Promise<void> => {
  if (!userId || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return;
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { points: increment(Math.floor(amount)) });
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const points = typeof snap.data().points === 'number' ? snap.data().points : 0;
    const { level } = computeLevel(points);
    if (snap.data().level !== level) {
      await updateDoc(userRef, { level });
    }
    try { await checkProgressionBadges(userId, points, level); } catch { /* best-effort */ }
  } catch {
    /* swallow — see note above */
  }
};
