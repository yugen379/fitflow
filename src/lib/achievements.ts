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

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  'daily-steps': 'Daily Steps',
  'rpg-titles': 'RPG Titles',
  streaks: 'Streaks & Combos',
  distance: 'Distance Odyssey',
  'time-quests': 'Time Quests',
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
// The catalogue — 52 badges
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: Achievement[] = [
  // ── Daily step milestones (10) ────────────────────────────────────────────
  a('steps-1k', 'First Thousand', 'Walk 1,000 steps in a day.', 'daily-steps', 'bronze', 'bestDaySteps', 1000, 'steps'),
  a('steps-3k', 'Pavement Starter', 'Walk 3,000 steps in a day.', 'daily-steps', 'bronze', 'bestDaySteps', 3000, 'steps'),
  a('steps-5k', 'Street Roamer', 'Walk 5,000 steps in a day.', 'daily-steps', 'bronze', 'bestDaySteps', 5000, 'steps'),
  a('steps-7k', 'Active Nomad', 'Walk 7,000 steps in a day.', 'daily-steps', 'silver', 'bestDaySteps', 7000, 'steps'),
  a('steps-10k', 'Daily Master', 'Hit the classic 10,000 steps.', 'daily-steps', 'silver', 'bestDaySteps', 10000, 'steps'),
  a('steps-12k', 'Pace Setter', 'Walk 12,000 steps in a day.', 'daily-steps', 'silver', 'bestDaySteps', 12000, 'steps'),
  a('steps-14k', 'Urban Trekker', 'Walk 14,000 steps in a day.', 'daily-steps', 'gold', 'bestDaySteps', 14000, 'steps'),
  a('steps-18k', 'Distance Hunter', 'Walk 18,000 steps in a day.', 'daily-steps', 'gold', 'bestDaySteps', 18000, 'steps'),
  a('steps-20k', 'Marathon Walker', 'Walk 20,000 steps in a single day.', 'daily-steps', 'gold', 'bestDaySteps', 20000, 'steps'),
  a('steps-30k', 'Ultra Explorer', 'Walk 30,000 steps in a single day.', 'daily-steps', 'legend', 'bestDaySteps', 30000, 'steps'),

  // ── RPG titles (10) ───────────────────────────────────────────────────────
  a('rpg-novice', 'Novice Wanderer', 'Accumulate 10,000 lifetime steps.', 'rpg-titles', 'bronze', 'totalSteps', 10000, 'steps'),
  a('rpg-elf', 'Elf 4: Walking Explorer', 'Accumulate 50,000 lifetime steps.', 'rpg-titles', 'bronze', 'totalSteps', 50000, 'steps'),
  a('rpg-ranger', 'Ranger of the Forest', 'Accumulate 100,000 lifetime steps.', 'rpg-titles', 'silver', 'totalSteps', 100000, 'steps'),
  a('rpg-scout', 'Twilight Scout', 'Accumulate 200,000 lifetime steps.', 'rpg-titles', 'silver', 'totalSteps', 200000, 'steps'),
  a('rpg-shadow', 'Shadow Strider', 'Accumulate 350,000 lifetime steps.', 'rpg-titles', 'silver', 'totalSteps', 350000, 'steps'),
  a('rpg-warden', 'Warden of the Path', 'Accumulate 500,000 lifetime steps.', 'rpg-titles', 'gold', 'totalSteps', 500000, 'steps'),
  a('rpg-titan', 'Titan of Endurance', 'Accumulate 750,000 lifetime steps.', 'rpg-titles', 'gold', 'totalSteps', 750000, 'steps'),
  a('rpg-ascendant', 'Ascendant Pathfinder', 'Accumulate 1,000,000 lifetime steps.', 'rpg-titles', 'legend', 'totalSteps', 1000000, 'steps'),
  a('rpg-mythic', 'Mythic Voyager', 'Accumulate 2,000,000 lifetime steps.', 'rpg-titles', 'legend', 'totalSteps', 2000000, 'steps'),
  a('rpg-eternal', 'Eternal Nomad', 'Accumulate 5,000,000 lifetime steps.', 'rpg-titles', 'legend', 'totalSteps', 5000000, 'steps'),

  // ── Streaks & combos (11) ─────────────────────────────────────────────────
  a('combo-triple', 'Triple Down', 'Hit your step goal 3 days running.', 'streaks', 'bronze', 'stepStreak', 3, 'days'),
  a('combo-5', 'High Five', 'Hit your step goal 5 days running.', 'streaks', 'bronze', 'stepStreak', 5, 'days'),
  a('combo-7', '7-Day Unstoppable', 'A full week at goal.', 'streaks', 'silver', 'stepStreak', 7, 'days'),
  a('combo-14', '14-Day Iron Will', 'Two straight weeks at goal.', 'streaks', 'silver', 'stepStreak', 14, 'days'),
  a('combo-21', '21-Day Habit', 'Three weeks — long enough to stick.', 'streaks', 'gold', 'stepStreak', 21, 'days'),
  a('combo-30', '30-Day Legend', 'A full month at goal.', 'streaks', 'gold', 'stepStreak', 30, 'days'),
  a('combo-60', '60-Day Relentless', 'Two months without missing.', 'streaks', 'legend', 'stepStreak', 60, 'days'),
  a('combo-100', 'Century Streak', '100 consecutive days at goal.', 'streaks', 'legend', 'stepStreak', 100, 'days'),
  a('act-7', 'Consistent Week', 'Seven days of logged activity in a row.', 'streaks', 'bronze', 'activityStreak', 7, 'days'),
  a('act-30', 'Monthly Discipline', 'Thirty days of logged activity in a row.', 'streaks', 'gold', 'activityStreak', 30, 'days'),
  a('tenk-50', 'Fifty Times Ten', 'Hit 10,000 steps on 50 separate days.', 'streaks', 'gold', 'daysOver10k', 50, 'days'),

  // ── Distance odyssey (11) ─────────────────────────────────────────────────
  a('dist-5', 'First Five', 'Cover 5 km in total.', 'distance', 'bronze', 'totalDistanceKm', 5, 'km'),
  a('dist-10', 'City Crosser', 'Cover 10 km in total.', 'distance', 'bronze', 'totalDistanceKm', 10, 'km'),
  a('dist-25', 'District Runner', 'Cover 25 km in total.', 'distance', 'bronze', 'totalDistanceKm', 25, 'km'),
  a('dist-50', 'Moonwalk Orbit', 'Cover 50 km in total.', 'distance', 'silver', 'totalDistanceKm', 50, 'km'),
  a('dist-100', 'Century Trek', 'Cover 100 km in total.', 'distance', 'silver', 'totalDistanceKm', 100, 'km'),
  a('dist-250', 'Regional Voyager', 'Cover 250 km in total.', 'distance', 'silver', 'totalDistanceKm', 250, 'km'),
  a('dist-500', 'Continental Leap', 'Cover 500 km in total.', 'distance', 'gold', 'totalDistanceKm', 500, 'km'),
  a('dist-1000', 'Globe Trotter', 'Cover 1,000 km in total.', 'distance', 'gold', 'totalDistanceKm', 1000, 'km'),
  a('dist-2500', 'Transcontinental', 'Cover 2,500 km in total.', 'distance', 'legend', 'totalDistanceKm', 2500, 'km'),
  a('dist-5000', 'Ocean Crosser', 'Cover 5,000 km in total.', 'distance', 'legend', 'totalDistanceKm', 5000, 'km'),
  a('dist-10000', 'Circumnavigator', 'Cover 10,000 km in total.', 'distance', 'legend', 'totalDistanceKm', 10000, 'km'),

  // ── Time quests (10) ──────────────────────────────────────────────────────
  a('time-60', 'First Hour', 'One hour of active movement.', 'time-quests', 'bronze', 'activeMinutes', 60, 'min'),
  a('time-300', 'Five Hour Club', 'Five hours of active movement.', 'time-quests', 'bronze', 'activeMinutes', 300, 'min'),
  a('time-600', 'Ten Hour Journey', 'Ten hours on the move.', 'time-quests', 'silver', 'activeMinutes', 600, 'min'),
  a('time-1500', 'Day and a Half', '25 hours of active movement.', 'time-quests', 'silver', 'activeMinutes', 1500, 'min'),
  a('time-3000', 'Fifty Hour Ascent', '50 hours on the move.', 'time-quests', 'gold', 'activeMinutes', 3000, 'min'),
  a('time-6000', 'Hundred Hour Odyssey', '100 hours on the move.', 'time-quests', 'legend', 'activeMinutes', 6000, 'min'),
  a('work-1', 'First Session', 'Log your first workout.', 'time-quests', 'bronze', 'totalWorkouts', 1, 'sessions'),
  a('work-25', 'Twenty-Five Strong', 'Log 25 workouts.', 'time-quests', 'silver', 'totalWorkouts', 25, 'sessions'),
  a('work-100', 'Century of Sessions', 'Log 100 workouts.', 'time-quests', 'gold', 'totalWorkouts', 100, 'sessions'),
  a('days-365', 'A Year in Motion', 'Be active on 365 separate days.', 'time-quests', 'legend', 'activeDays', 365, 'days'),
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
  'Pavement Novice',
  'Trail Walker',
  'Route Finder',
  'Path Seeker',
  'Terrain Reader',
  'Distance Keeper',
  'Horizon Chaser',
  'Summit Scout',
  'Vanguard Strider',
  'Apex Pathfinder',
  'Mythic Voyager',
  'Eternal Nomad',
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
