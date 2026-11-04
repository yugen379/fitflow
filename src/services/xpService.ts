import { app } from '../lib/firebase';
import { checkProgressionBadges } from './badgeService';
import { reportSwallowed } from '../lib/telemetry';

/**
 * XP is awarded by the SERVER (functions/src/xp.ts) since v1.6.2.
 *
 * The app used to `increment(points)` itself, and the rules accepted any value,
 * so a modified client could write any score onto the shared leaderboard. The
 * rules now reject `points`, `level` and `badges` from clients entirely.
 *
 * The app reports WHAT happened (the id of the meal / workout / water log /
 * wellness log / route it just saved). The server checks the record is the
 * caller's, works out the XP from the record itself, awards each record once
 * and caps each activity type per day. The new total reaches the UI through
 * the profile snapshot listener, exactly as before.
 */
export type XpReason = 'meal' | 'workout' | 'water' | 'wellness' | 'run' | 'badge' | 'onboarding';

export interface XpResult {
  awarded: number;
  points: number;
  level: number;
  duplicate?: boolean;
  capped?: boolean;
  badgeGranted?: boolean;
}

/** The callable, loaded on first use so firebase/functions stays off the boot path. */
export const callAwardXp = async (reason: XpReason, refId = ''): Promise<XpResult> => {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const res = await httpsCallable<{ reason: XpReason; refId: string }, XpResult>(
    getFunctions(app),
    'awardXp',
  )({ reason, refId });
  return res.data;
};

/**
 * Award XP for a record the user just saved. XP is a reward, never a blocker:
 * a failure here never breaks the logging flow, but it is counted, because XP
 * that silently fails to land is a progress bar that stops moving.
 */
export const awardXp = async (userId: string, reason: XpReason, refId: string): Promise<void> => {
  if (!userId || !refId) return;
  try {
    const { points, level } = await callAwardXp(reason, refId);
    try {
      await checkProgressionBadges(userId, points, level);
    } catch (err) {
      reportSwallowed('xpService.progressionBadges', err, { userId, points, level });
    }
  } catch (err) {
    reportSwallowed('xpService.awardXp', err, { userId, reason });
  }
};
