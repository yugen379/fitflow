/**
 * Achievement engine — 52 tiered unlocks.
 *
 * Pure and deterministic: every badge is a threshold over a stats snapshot, so
 * the whole system is a `filter` over one object with no I/O and no clock of its
 * own. That makes it trivially testable (`npm run proof:achievements`) and means
 * the same code can evaluate live state, a replay of history, or a fixture.
 *
 * Progress is reported for locked badges too, because "72% to Marathon Walker"
 * is the thing that actually pulls someone out for a walk — a locked grid of
 * grey squares does not.
 */

import { msg } from '../i18n/i18n';

export type AchievementCategory =
  | 'daily-steps'
  | 'rpg-titles'
  | 'streaks'
  | 'distance'
  | 'time-quests';

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'legend';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** The stat this badge measures. */
  metric: keyof AchievementStats;
  /** Value of `metric` required to unlock. */
  threshold: number;
  /** Rendered next to the threshold, e.g. "steps" or "km". */
  unit: string;
}

/**
 * Everything the engine is allowed to look at. Anything not in here cannot
 * influence an unlock, which keeps badges honest.
 */
export interface AchievementStats {
  /** Best single-day step count ever. */
  bestDaySteps: number;
  /** Steps today. */
  todaySteps: number;
  /** Lifetime steps. */
  totalSteps: number;
  /** Lifetime distance, km. */
  totalDistanceKm: number;
  /** Consecutive days meeting the daily step goal. */
  stepStreak: number;
  /** Consecutive days with any logged activity. */
  activityStreak: number;
  /** Days that ever hit 10k. */
  daysOver10k: number;
  /** Total logged workouts. */
  totalWorkouts: number;
  /** Total active minutes across all time. */
  activeMinutes: number;
  /** Distinct days the app recorded activity. */
  activeDays: number;
}

export const EMPTY_STATS: AchievementStats = {
  bestDaySteps: 0,
  todaySteps: 0,
  totalSteps: 0,
  totalDistanceKm: 0,
  stepStreak: 0,
  activityStreak: 0,
  daysOver10k: 0,
  totalWorkouts: 0,
  activeMinutes: 0,
  activeDays: 0,
};

/** English, marked for translation: show with tDyn(). */
export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  'daily-steps': msg('Daily Steps'),
  'rpg-titles': msg('RPG Titles'),
  streaks: msg('Streaks & Combos'),
  distance: msg('Distance Odyssey'),
  'time-quests': msg('Time Quests'),
};

export const TIER_COLORS: Record<AchievementTier, string> = {
  bronze: '#C88B4A',
  silver: '#9FB3C8',
  gold: '#FFD700',
  legend: '#CCFF00',
};

const a = (
  id: string,
  name: string,
  description: string,
  category: AchievementCategory,
  tier: AchievementTier,
  metric: keyof AchievementStats,
  threshold: number,
  unit: string,
): Achievement => ({ id, name, description, category, tier, metric, threshold, unit });

// ---------------------------------------------------------------------------
// The catalogue — 52 badges. Name and description are msg()-marked English:
// show them with tDyn().
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: Achievement[] = [
  // ── Daily step milestones (10) ────────────────────────────────────────────
  a('steps-1k', msg('First Thousand'), msg('Walk 1,000 steps in a day.'), 'daily-steps', 'bronze', 'bestDaySteps', 1000, 'steps'),
  a('steps-3k', msg('Pavement Starter'), msg('Walk 3,000 steps in a day.'), 'daily-steps', 'bronze', 'bestDaySteps', 3000, 'steps'),
  a('steps-5k', msg('Street Roamer'), msg('Walk 5,000 steps in a day.'), 'daily-steps', 'bronze', 'bestDaySteps', 5000, 'steps'),
  a('steps-7k', msg('Active Nomad'), msg('Walk 7,000 steps in a day.'), 'daily-steps', 'silver', 'bestDaySteps', 7000, 'steps'),
  a('steps-10k', msg('Daily Master'), msg('Hit the classic 10,000 steps.'), 'daily-steps', 'silver', 'bestDaySteps', 10000, 'steps'),
  a('steps-12k', msg('Pace Setter'), msg('Walk 12,000 steps in a day.'), 'daily-steps', 'silver', 'bestDaySteps', 12000, 'steps'),
  a('steps-14k', msg('Urban Trekker'), msg('Walk 14,000 steps in a day.'), 'daily-steps', 'gold', 'bestDaySteps', 14000, 'steps'),
  a('steps-18k', msg('Distance Hunter'), msg('Walk 18,000 steps in a day.'), 'daily-steps', 'gold', 'bestDaySteps', 18000, 'steps'),
  a('steps-20k', msg('Marathon Walker'), msg('Walk 20,000 steps in a single day.'), 'daily-steps', 'gold', 'bestDaySteps', 20000, 'steps'),
  a('steps-30k', msg('Ultra Explorer'), msg('Walk 30,000 steps in a single day.'), 'daily-steps', 'legend', 'bestDaySteps', 30000, 'steps'),

  // ── RPG titles (10) ───────────────────────────────────────────────────────
  a('rpg-novice', msg('Novice Wanderer'), msg('Accumulate 10,000 lifetime steps.'), 'rpg-titles', 'bronze', 'totalSteps', 10000, 'steps'),
  a('rpg-elf', msg('Elf 4: Walking Explorer'), msg('Accumulate 50,000 lifetime steps.'), 'rpg-titles', 'bronze', 'totalSteps', 50000, 'steps'),
  a('rpg-ranger', msg('Ranger of the Forest'), msg('Accumulate 100,000 lifetime steps.'), 'rpg-titles', 'silver', 'totalSteps', 100000, 'steps'),
  a('rpg-scout', msg('Twilight Scout'), msg('Accumulate 200,000 lifetime steps.'), 'rpg-titles', 'silver', 'totalSteps', 200000, 'steps'),
  a('rpg-shadow', msg('Shadow Strider'), msg('Accumulate 350,000 lifetime steps.'), 'rpg-titles', 'silver', 'totalSteps', 350000, 'steps'),
  a('rpg-warden', msg('Warden of the Path'), msg('Accumulate 500,000 lifetime steps.'), 'rpg-titles', 'gold', 'totalSteps', 500000, 'steps'),
  a('rpg-titan', msg('Titan of Endurance'), msg('Accumulate 750,000 lifetime steps.'), 'rpg-titles', 'gold', 'totalSteps', 750000, 'steps'),
  a('rpg-ascendant', msg('Ascendant Pathfinder'), msg('Accumulate 1,000,000 lifetime steps.'), 'rpg-titles', 'legend', 'totalSteps', 1000000, 'steps'),
  a('rpg-mythic', msg('Mythic Voyager'), msg('Accumulate 2,000,000 lifetime steps.'), 'rpg-titles', 'legend', 'totalSteps', 2000000, 'steps'),
  a('rpg-eternal', msg('Eternal Nomad'), msg('Accumulate 5,000,000 lifetime steps.'), 'rpg-titles', 'legend', 'totalSteps', 5000000, 'steps'),

  // ── Streaks & combos (11) ─────────────────────────────────────────────────
  a('combo-triple', msg('Triple Down'), msg('Hit your step goal 3 days running.'), 'streaks', 'bronze', 'stepStreak', 3, 'days'),
  a('combo-5', msg('High Five'), msg('Hit your step goal 5 days running.'), 'streaks', 'bronze', 'stepStreak', 5, 'days'),
  a('combo-7', msg('7-Day Unstoppable'), msg('A full week at goal.'), 'streaks', 'silver', 'stepStreak', 7, 'days'),
  a('combo-14', msg('14-Day Iron Will'), msg('Two straight weeks at goal.'), 'streaks', 'silver', 'stepStreak', 14, 'days'),
  a('combo-21', msg('21-Day Habit'), msg('Three weeks — long enough to stick.'), 'streaks', 'gold', 'stepStreak', 21, 'days'),
  a('combo-30', msg('30-Day Legend'), msg('A full month at goal.'), 'streaks', 'gold', 'stepStreak', 30, 'days'),
  a('combo-60', msg('60-Day Relentless'), msg('Two months without missing.'), 'streaks', 'legend', 'stepStreak', 60, 'days'),
  a('combo-100', msg('Century Streak'), msg('100 consecutive days at goal.'), 'streaks', 'legend', 'stepStreak', 100, 'days'),
  a('act-7', msg('Consistent Week'), msg('Seven days of logged activity in a row.'), 'streaks', 'bronze', 'activityStreak', 7, 'days'),
  a('act-30', msg('Monthly Discipline'), msg('Thirty days of logged activity in a row.'), 'streaks', 'gold', 'activityStreak', 30, 'days'),
  a('tenk-50', msg('Fifty Times Ten'), msg('Hit 10,000 steps on 50 separate days.'), 'streaks', 'gold', 'daysOver10k', 50, 'days'),

  // ── Distance odyssey (11) ─────────────────────────────────────────────────
  a('dist-5', msg('First Five'), msg('Cover 5 km in total.'), 'distance', 'bronze', 'totalDistanceKm', 5, 'km'),
  a('dist-10', msg('City Crosser'), msg('Cover 10 km in total.'), 'distance', 'bronze', 'totalDistanceKm', 10, 'km'),
  a('dist-25', msg('District Runner'), msg('Cover 25 km in total.'), 'distance', 'bronze', 'totalDistanceKm', 25, 'km'),
  a('dist-50', msg('Moonwalk Orbit'), msg('Cover 50 km in total.'), 'distance', 'silver', 'totalDistanceKm', 50, 'km'),
  a('dist-100', msg('Century Trek'), msg('Cover 100 km in total.'), 'distance', 'silver', 'totalDistanceKm', 100, 'km'),
  a('dist-250', msg('Regional Voyager'), msg('Cover 250 km in total.'), 'distance', 'silver', 'totalDistanceKm', 250, 'km'),
  a('dist-500', msg('Continental Leap'), msg('Cover 500 km in total.'), 'distance', 'gold', 'totalDistanceKm', 500, 'km'),
  a('dist-1000', msg('Globe Trotter'), msg('Cover 1,000 km in total.'), 'distance', 'gold', 'totalDistanceKm', 1000, 'km'),
  a('dist-2500', msg('Transcontinental'), msg('Cover 2,500 km in total.'), 'distance', 'legend', 'totalDistanceKm', 2500, 'km'),
  a('dist-5000', msg('Ocean Crosser'), msg('Cover 5,000 km in total.'), 'distance', 'legend', 'totalDistanceKm', 5000, 'km'),
  a('dist-10000', msg('Circumnavigator'), msg('Cover 10,000 km in total.'), 'distance', 'legend', 'totalDistanceKm', 10000, 'km'),

  // ── Time quests (10) ──────────────────────────────────────────────────────
  a('time-60', msg('First Hour'), msg('One hour of active movement.'), 'time-quests', 'bronze', 'activeMinutes', 60, 'min'),
  a('time-300', msg('Five Hour Club'), msg('Five hours of active movement.'), 'time-quests', 'bronze', 'activeMinutes', 300, 'min'),
  a('time-600', msg('Ten Hour Journey'), msg('Ten hours on the move.'), 'time-quests', 'silver', 'activeMinutes', 600, 'min'),
  a('time-1500', msg('Day and a Half'), msg('25 hours of active movement.'), 'time-quests', 'silver', 'activeMinutes', 1500, 'min'),
  a('time-3000', msg('Fifty Hour Ascent'), msg('50 hours on the move.'), 'time-quests', 'gold', 'activeMinutes', 3000, 'min'),
  a('time-6000', msg('Hundred Hour Odyssey'), msg('100 hours on the move.'), 'time-quests', 'legend', 'activeMinutes', 6000, 'min'),
  a('work-1', msg('First Session'), msg('Log your first workout.'), 'time-quests', 'bronze', 'totalWorkouts', 1, 'sessions'),
  a('work-25', msg('Twenty-Five Strong'), msg('Log 25 workouts.'), 'time-quests', 'silver', 'totalWorkouts', 25, 'sessions'),
  a('work-100', msg('Century of Sessions'), msg('Log 100 workouts.'), 'time-quests', 'gold', 'totalWorkouts', 100, 'sessions'),
  a('days-365', msg('A Year in Motion'), msg('Be active on 365 separate days.'), 'time-quests', 'legend', 'activeDays', 365, 'days'),
];

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface AchievementProgress {
  achievement: Achievement;
  unlocked: boolean;
  /** Current value of the achievement's metric. */
  current: number;
  /** 0–1. */
  ratio: number;
  /** How much of the metric remains; 0 once unlocked. */
  remaining: number;
}

const safe = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/** Progress for one achievement. Never throws, never returns NaN. */
export const evaluate = (achievement: Achievement, stats: AchievementStats): AchievementProgress => {
  const current = safe(stats[achievement.metric]);
  const threshold = achievement.threshold;
  const unlocked = current >= threshold;
  const ratio = threshold > 0 ? Math.max(0, Math.min(1, current / threshold)) : 0;
  return {
    achievement,
    unlocked,
    current,
    ratio,
    remaining: unlocked ? 0 : Math.max(0, threshold - current),
  };
};

export const evaluateAll = (stats: AchievementStats): AchievementProgress[] =>
  ACHIEVEMENTS.map((achievement) => evaluate(achievement, stats));

export const unlockedCount = (stats: AchievementStats): number =>
  ACHIEVEMENTS.reduce((count, achievement) => count + (evaluate(achievement, stats).unlocked ? 1 : 0), 0);

/**
 * The nearest unlocks, for the "next up" queue.
 *
 * Sorted by how close they are, excluding anything already earned and anything
 * at literally zero progress — a badge you have not started is not a nudge, it
 * is noise.
 */
export const nextAchievements = (stats: AchievementStats, limit = 3): AchievementProgress[] =>
  evaluateAll(stats)
    .filter((entry) => !entry.unlocked && entry.ratio > 0)
    .sort((left, right) => right.ratio - left.ratio)
    .slice(0, limit);

/**
 * Level from unlock count. Deliberately separate from the XP level in
 * missionUtils: that one measures logging discipline, this one measures
 * movement, and conflating them would make both meaningless.
 */
export interface PathfinderLevel {
  level: number;
  title: string;
  unlocked: number;
  total: number;
}

const TITLES = [
  msg('Pavement Novice'),
  msg('Trail Walker'),
  msg('Route Finder'),
  msg('Path Seeker'),
  msg('Terrain Reader'),
  msg('Distance Keeper'),
  msg('Horizon Chaser'),
  msg('Summit Scout'),
  msg('Vanguard Strider'),
  msg('Apex Pathfinder'),
  msg('Mythic Voyager'),
  msg('Eternal Nomad'),
];

export const pathfinderLevel = (stats: AchievementStats): PathfinderLevel => {
  const unlocked = unlockedCount(stats);
  const total = ACHIEVEMENTS.length;
  // One level per four unlocks, capped at the title list.
  const level = Math.min(TITLES.length, Math.max(1, Math.ceil(unlocked / 4) || 1));
  return { level, title: TITLES[level - 1], unlocked, total };
};

/** Which badges are newly unlocked between two snapshots — drives the confetti. */
export const newlyUnlocked = (before: AchievementStats, after: AchievementStats): Achievement[] =>
  ACHIEVEMENTS.filter(
    (achievement) => !evaluate(achievement, before).unlocked && evaluate(achievement, after).unlocked,
  );
