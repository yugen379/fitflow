import { db } from '../lib/firestore';
import { collection, doc, updateDoc, arrayUnion, getDoc, getDocs, addDoc, increment, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { computeLevel } from './missionUtils';
import { daysBetweenKeys } from './retentionUtils';
import { dayKeysOf, hasConsecutiveRun, sinceDaysAgo } from './badgeUtils';

export interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  requirement: string;
}

export const ALL_BADGES: Badge[] = [
  // Onboarding & Social
  { id: 'pioneer',            name: 'Pioneer',           icon: '🚀', description: 'Joined FitFlow AI.',                         requirement: 'Complete onboarding' },
  { id: 'social_butterfly',   name: 'Social Butterfly',  icon: '🦋', description: 'Made your first community post.',            requirement: 'Post to community' },
  { id: 'challenge_accepted', name: 'Challenge Accepted', icon: '⚔️', description: 'Joined your first challenge.',              requirement: 'Join a challenge' },

  // Nutrition
  { id: 'nutrition_master',   name: 'Nutrition Master',  icon: '🥗', description: 'Logged your first meal.',                    requirement: 'Log a meal' },
  { id: 'scanner_pro',        name: 'Scanner Pro',        icon: '📷', description: 'Used the barcode scanner to log a product.', requirement: 'Scan a product barcode' },
  { id: 'ai_chef',            name: 'AI Chef',            icon: '🤖', description: 'Generated your first AI meal plan.',        requirement: 'Generate an AI meal plan' },
  { id: 'macro_master',       name: 'Macro Master',       icon: '⚗️', description: 'Tracked macros for 7 consecutive days.',   requirement: '7-day macro logging streak' },

  // Hydration & Wellness
  { id: 'hydration_hero',     name: 'Hydration Hero',    icon: '💧', description: 'Logged your water intake.',                  requirement: 'Log water' },
  { id: 'sleep_master',       name: 'Sleep Master',       icon: '😴', description: 'Logged 8+ hours of sleep three times.',     requirement: 'Log 8h sleep x3' },
  { id: 'wellness_zen',       name: 'Wellness Zen',       icon: '🧘', description: 'Logged mood and stress 3 days in a row.',   requirement: 'Wellness log x3 days' },

  // Workouts
  { id: 'iron_will',          name: 'Iron Will',          icon: '💪', description: 'Logged your first workout session.',        requirement: 'Log a workout' },
  { id: 'calorie_crusher',    name: 'Calorie Crusher',    icon: '🔥', description: 'Burned 500+ calories in one session.',      requirement: '500+ cal in one session' },
  { id: 'week_warrior',       name: 'Week Warrior',       icon: '🗓️', description: 'Completed 5 workouts in a single week.',   requirement: '5 workouts in 7 days' },
  { id: 'marathoner',         name: 'Marathoner',         icon: '🏃', description: 'Covered more than 5km in one activity.',    requirement: 'Activity distance > 5km' },
  { id: 'early_bird',         name: 'Early Bird',         icon: '🌅', description: 'Started a workout before 8am.',             requirement: 'Workout before 8am' },
  { id: 'night_owl',          name: 'Night Owl',           icon: '🌙', description: 'Started a workout after 9pm.',             requirement: 'Workout after 9pm' },

  // Streaks
  { id: 'streak_3',           name: 'On A Roll',          icon: '🌀', description: 'Kept a 3-day active streak.',               requirement: '3-day streak' },
  { id: 'streak_7',           name: 'Consistency King',   icon: '👑', description: 'Kept a 7-day active streak.',               requirement: '7-day streak' },
  { id: 'streak_30',          name: 'Unstoppable',        icon: '🏆', description: 'Maintained a 30-day streak.',               requirement: '30-day streak' },

  // Milestones
  { id: 'centurion',          name: 'Centurion',          icon: '💯', description: 'Earned 1,000 XP points.',                   requirement: '1000 XP total' },
  { id: 'level_5',            name: 'Level 5',             icon: '⭐', description: 'Reached Level 5.',                        requirement: 'Reach level 5' },
  { id: 'comeback_kid',       name: 'Comeback Kid',       icon: '🔄', description: 'Came back after a 7-day break.',            requirement: 'Log after 7-day inactivity' },
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

    // `arrayUnion` makes the badge itself race-free, but the 150 XP must be an
    // atomic increment too: written as `profile.points + 150` it discarded any
    // XP awarded between the read above and this write — and two badges earned
    // together (which happens constantly, e.g. a workout that also breaks a
    // streak) awarded 150 total instead of 300.
    await updateDoc(userRef, {
      badges: arrayUnion(badgeId),
      points: increment(150),
    });
    // Re-read the authoritative total so `level` matches the curve rather than
    // a figure computed from a stale snapshot.
    const after = await getDoc(userRef);
    const newPoints = typeof after.data()?.points === 'number' ? after.data()!.points : 0;
    const newLevel = computeLevel(newPoints).level;
    if (after.data()?.level !== newLevel) {
      await updateDoc(userRef, { level: newLevel });
    }

    await addDoc(collection(db, 'notifications'), {
      userId,
      title: 'Achievement Unlocked!',
      body: `You earned the ${badge.icon} ${badge.name} badge and 150 XP!`,
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
  } catch { /* best-effort — a badge must never break a workout save */ }
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
  } catch { /* best-effort */ }
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
  } catch { /* best-effort */ }
}
