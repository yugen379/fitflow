import { db } from '../lib/firestore';
import { collection, doc, getDoc, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { callAwardXp } from './xpService';
import { daysBetweenKeys } from './retentionUtils';
import { dayKeysOf, hasConsecutiveRun, sinceDaysAgo } from './badgeUtils';
import { reportSwallowed } from '../lib/telemetry';
import { t, msg, tDyn } from '../i18n/i18n';

export interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  requirement: string;
}

// name / description / requirement are msg()-marked English: show them with tDyn().
export const ALL_BADGES: Badge[] = [
  // Onboarding & Social
  { id: 'pioneer',            name: msg('Pioneer'),           icon: '🚀', description: msg('Joined FitFlow AI.'),                         requirement: msg('Complete onboarding') },
  { id: 'social_butterfly',   name: msg('Social Butterfly'),  icon: '🦋', description: msg('Made your first community post.'),            requirement: msg('Post to community') },
  { id: 'challenge_accepted', name: msg('Challenge Accepted'), icon: '⚔️', description: msg('Joined your first challenge.'),              requirement: msg('Join a challenge') },

  // Nutrition
  { id: 'nutrition_master',   name: msg('Nutrition Master'),  icon: '🥗', description: msg('Logged your first meal.'),                    requirement: msg('Log a meal') },
  { id: 'scanner_pro',        name: msg('Scanner Pro'),        icon: '📷', description: msg('Used the barcode scanner to log a product.'), requirement: msg('Scan a product barcode') },
  { id: 'ai_chef',            name: msg('AI Chef'),            icon: '🤖', description: msg('Generated your first AI meal plan.'),        requirement: msg('Generate an AI meal plan') },
  { id: 'macro_master',       name: msg('Macro Master'),       icon: '⚗️', description: msg('Tracked macros for 7 consecutive days.'),   requirement: msg('7-day macro logging streak') },

  // Hydration & Wellness
  { id: 'hydration_hero',     name: msg('Hydration Hero'),    icon: '💧', description: msg('Logged your water intake.'),                  requirement: msg('Log water') },
  { id: 'sleep_master',       name: msg('Sleep Master'),       icon: '😴', description: msg('Logged 8+ hours of sleep three times.'),     requirement: msg('Log 8h sleep x3') },
  { id: 'wellness_zen',       name: msg('Wellness Zen'),       icon: '🧘', description: msg('Logged mood and stress 3 days in a row.'),   requirement: msg('Wellness log x3 days') },

  // Workouts
  { id: 'iron_will',          name: msg('Iron Will'),          icon: '💪', description: msg('Logged your first workout session.'),        requirement: msg('Log a workout') },
  { id: 'calorie_crusher',    name: msg('Calorie Crusher'),    icon: '🔥', description: msg('Burned 500+ calories in one session.'),      requirement: msg('500+ cal in one session') },
  { id: 'week_warrior',       name: msg('Week Warrior'),       icon: '🗓️', description: msg('Completed 5 workouts in a single week.'),   requirement: msg('5 workouts in 7 days') },
  { id: 'marathoner',         name: msg('Marathoner'),         icon: '🏃', description: msg('Covered more than 5km in one activity.'),    requirement: msg('Activity distance > 5km') },
  { id: 'early_bird',         name: msg('Early Bird'),         icon: '🌅', description: msg('Started a workout before 8am.'),             requirement: msg('Workout before 8am') },
  { id: 'night_owl',          name: msg('Night Owl'),           icon: '🌙', description: msg('Started a workout after 9pm.'),             requirement: msg('Workout after 9pm') },

  // Streaks
  { id: 'streak_3',           name: msg('On A Roll'),          icon: '🌀', description: msg('Kept a 3-day active streak.'),               requirement: msg('3-day streak') },
  { id: 'streak_7',           name: msg('Consistency King'),   icon: '👑', description: msg('Kept a 7-day active streak.'),               requirement: msg('7-day streak') },
  { id: 'streak_30',          name: msg('Unstoppable'),        icon: '🏆', description: msg('Maintained a 30-day streak.'),               requirement: msg('30-day streak') },

  // Milestones
  { id: 'centurion',          name: msg('Centurion'),          icon: '💯', description: msg('Earned 1,000 XP points.'),                   requirement: msg('1000 XP total') },
  { id: 'level_5',            name: msg('Level 5'),             icon: '⭐', description: msg('Reached Level 5.'),                        requirement: msg('Reach level 5') },
  { id: 'comeback_kid',       name: msg('Comeback Kid'),       icon: '🔄', description: msg('Came back after a 7-day break.'),            requirement: msg('Log after 7-day inactivity') },
];

// ─── Core award function ───────────────────────────────────────────────────────

export async function checkAndAwardBadge(userId: string, badgeId: string): Promise<Badge | null> {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return null;

    const profile = userSnap.data();
    const currentBadges: string[] = profile.badges || [];

    if (currentBadges.includes(badgeId)) return null;

    const badge = ALL_BADGES.find(b => b.id === badgeId);
    if (!badge) return null;

    // The server grants the badge and its 150 XP (functions/src/xp.ts) — the
    // rules no longer let the app write `badges` or `points`. It grants each
    // badge once, and re-checks the ones it can verify (XP, level, streak).
    const result = await callAwardXp('badge', badgeId);
    if (!result.badgeGranted) return null;

    await addDoc(collection(db, 'notifications'), {
      userId,
      title: t('Achievement Unlocked!'),
      body: t('You earned the {icon} {badge} badge and 150 XP!', { icon: badge.icon, badge: tDyn(badge.name) }),
      timestamp: serverTimestamp(),
      read: false,
      type: 'achievement',
    });

    return badge;
  } catch (err) {
    console.error('Badge award error:', err);
    return null;
  }
}

// ─── Specialised helpers ───────────────────────────────────────────────────────

/** Call after saving any workout to check time-of-day badges. */
export async function checkWorkoutTimeBadge(userId: string): Promise<void> {
  const hour = new Date().getHours();
  if (hour < 8)   await checkAndAwardBadge(userId, 'early_bird');
  if (hour >= 21) await checkAndAwardBadge(userId, 'night_owl');
}

/** Call after saving a workout – awards calorie milestone badge if hit. */
export async function checkCalorieBadge(userId: string, caloriesBurned: number): Promise<void> {
  if (caloriesBurned >= 500) await checkAndAwardBadge(userId, 'calorie_crusher');
}

/** Call after updating the user's streak counter. */
export async function checkStreakBadge(userId: string, streak: number): Promise<void> {
  if (streak >= 3)  await checkAndAwardBadge(userId, 'streak_3');
  if (streak >= 7)  await checkAndAwardBadge(userId, 'streak_7');
  if (streak >= 30) await checkAndAwardBadge(userId, 'streak_30');
}

/** Call after points/level change to award XP and level milestones. */
export async function checkProgressionBadges(userId: string, points: number, level: number): Promise<void> {
  if (points >= 1000) await checkAndAwardBadge(userId, 'centurion');
  if (level >= 5)     await checkAndAwardBadge(userId, 'level_5');
}


// ─── History-dependent badges ─────────────────────────────────────────────────
//
// Ten of the badges in ALL_BADGES had no awarding path anywhere in the app. They
// were rendered in the Profile gallery next to the earnable ones, with their
// requirement text, as goals — and no sequence of user actions could ever unlock
// them. The rest of this file is what makes them real.
//
// Every check below opens with `alreadyEarned`, a single document read, so once a
// badge is won its query never runs again. The queries themselves are bounded to
// the window the requirement actually needs.

/** One document read. `null` when the profile can't be reached. */
const earnedBadges = async (userId: string): Promise<Set<string> | null> => {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return null;
    const list = snap.data().badges;
    return new Set<string>(Array.isArray(list) ? list : []);
  } catch {
    return null;
  }
};
/** Call after a community post — "Social Butterfly". */
export async function checkSocialBadge(userId: string): Promise<void> {
  await checkAndAwardBadge(userId, 'social_butterfly');
}

/** Call after joining a challenge — "Challenge Accepted". */
export async function checkChallengeBadge(userId: string): Promise<void> {
  await checkAndAwardBadge(userId, 'challenge_accepted');
}

/** Call after saving a workout — "Week Warrior": 5 workouts inside 7 days. */
export async function checkWeeklyWorkoutBadge(userId: string): Promise<void> {
  try {
    const earned = await earnedBadges(userId);
    if (!earned || earned.has('week_warrior')) return;
    const snap = await getDocs(query(
      collection(db, 'workouts'),
      where('userId', '==', userId),
      where('timestamp', '>=', sinceDaysAgo(6)),
      limit(20),
    ));
    if (snap.size >= 5) await checkAndAwardBadge(userId, 'week_warrior');
  } catch (err) {
    // Still best-effort: the workout save must not fail because a badge
    // lookup did. But a checker that always throws is a badge that can never
    // be earned, which is invisible from the outside — so it is counted.
    reportSwallowed('badgeService.weekWarrior', err, { userId });
  }
}

/** Call after a meal log — "Macro Master": macros logged 7 days running. */
export async function checkMacroBadge(userId: string): Promise<void> {
  try {
    const earned = await earnedBadges(userId);
    if (!earned || earned.has('macro_master')) return;
    const snap = await getDocs(query(
      collection(db, 'meals'),
      where('userId', '==', userId),
      where('timestamp', '>=', sinceDaysAgo(8)),
      limit(200),
    ));
    // Only meals that actually carry macros count — the badge says "tracked
    // macros", not "logged something".
    const withMacros = snap.docs.filter((d) => {
      const m = d.data();
      return [m.protein, m.carbs, m.fats].some((v) => typeof v === 'number' && v > 0);
    });
    if (hasConsecutiveRun(dayKeysOf(withMacros), 7)) {
      await checkAndAwardBadge(userId, 'macro_master');
    }
  } catch (err) {
    reportSwallowed('badgeService.macroMaster', err, { userId });
  }
}

/**
 * Call after a recovery log — "Sleep Master" (8h+ three times) and
 * "Wellness Zen" (mood + stress three days running).
 */
export async function checkWellnessBadges(userId: string): Promise<void> {
  try {
    const earned = await earnedBadges(userId);
    if (!earned) return;

    if (!earned.has('sleep_master')) {
      const snap = await getDocs(query(
        collection(db, 'sleep_logs'),
        where('userId', '==', userId),
        where('hours', '>=', 8),
        limit(3),
      ));
      if (snap.size >= 3) await checkAndAwardBadge(userId, 'sleep_master');
    }

    if (!earned.has('wellness_zen')) {
      const snap = await getDocs(query(
        collection(db, 'wellness_logs'),
        where('userId', '==', userId),
        where('timestamp', '>=', sinceDaysAgo(6)),
        limit(50),
      ));
      if (hasConsecutiveRun(dayKeysOf(snap.docs), 3)) {
        await checkAndAwardBadge(userId, 'wellness_zen');
      }
    }
  } catch (err) {
    reportSwallowed('badgeService.wellness', err, { userId });
  }
}
