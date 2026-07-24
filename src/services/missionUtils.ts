// Today's Mission + XP/Level — pure, deterministic engine.
//
// This module has NO browser, React, or Firebase imports so it can be unit-tested
// by a Node harness (`npm run proof:mission`) exactly like `coachBriefing.ts`.
//
// Two responsibilities:
//   1. The LEVEL CURVE — one progressive formula for turning lifetime XP (the
//      `users.points` field) into a level. Before this module existed, `level`
//      was written once at signup and never again, and Home faked progress with
//      `points % 100`. Every consumer (Home XP bar, Profile, level badges) now
//      derives from computeLevel so they can never disagree.
//   2. TODAY'S MISSION — the Home hero widget's brain. Turns a snapshot of the
//      day into exactly three rows (workout / calories / steps), picks the ONE
//      next action to highlight, and flags streak-risk urgency. The app must
//      always answer "what should I do RIGHT NOW?" — this is where that answer
//      is computed, deterministically, so it is provable and works offline.
//
// Targets come from coachBriefing.computeTargets so the mission can never
// contradict what the proactive coach is nudging about.

import { computeTargets } from './coachBriefing';

// ─── XP awards ────────────────────────────────────────────────────────────────
// Centralised award sizes for the two core actions (wired in dataService).
// Existing award sites (water ml/25, wellness +30, badges +150, runs km×100)
// keep their historical values — changing them would retroactively devalue
// what users already earned.
export const XP_AWARDS = {
  meal: 15,
  workout: 40,
} as const;

// ─── Level curve ──────────────────────────────────────────────────────────────
// Progressive scaling: each level costs 50 XP more than the last.
//   L1→2: 100 · L2→3: 150 · L3→4: 200 · L4→5: 250 · L5→6: 300 …
// Cumulative: L2 at 100, L3 at 250, L4 at 450, L5 at 700, L6 at 1,000 — so the
// Centurion badge (1,000 XP) and Level 6 land together, and onboarding's
// starter 100 XP delivers the classic instant Level 2 early win.
const MAX_LEVEL = 99;

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number): number => {
  const l = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1)));
  return 100 + (l - 1) * 50;
};

/** Total lifetime XP required to *reach* `level`. */
export const xpForLevel = (level: number): number => {
  const l = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1)));
  // Sum of arithmetic series 100 + 150 + … for (l-1) terms.
  const n = l - 1;
  return n * 100 + (n * (n - 1) * 50) / 2;
};

export interface LevelInfo {
  level: number;        // 1..99
  intoLevel: number;    // XP earned inside the current level
  toNext: number;       // XP needed to finish the current level
  pct: number;          // 0..100 progress through the current level
}

/** Lifetime XP → level info. Garbage in (NaN, negatives, strings) → Level 1. */
export const computeLevel = (points: unknown): LevelInfo => {
  const p =
    typeof points === 'number' && Number.isFinite(points) && points > 0
      ? Math.floor(points)
      : 0;
  let level = 1;
  while (level < MAX_LEVEL && p >= xpForLevel(level + 1)) level++;
  const base = xpForLevel(level);
  const toNext = xpToNext(level);
  const intoLevel = Math.min(p - base, toNext);
  return {
    level,
    intoLevel,
    toNext,
    pct: Math.min(100, Math.max(0, Math.round((intoLevel / toNext) * 100))),
  };
};

// ─── Today's Mission ──────────────────────────────────────────────────────────

export const STEPS_GOAL = 8000;

export interface MissionSnapshot {
  hour: number;                    // 0–23, user-local
  goal?: string;                   // 'muscle_gain' | 'fat_loss' | ...
  weightKg?: number;
  caloriesConsumed?: number;       // today
  mealsLogged?: number;            // today
  workoutsToday?: number;          // sessions completed today
  /** Steps today from Health Connect; null/undefined = not connected. 0 is a real value. */
  steps?: number | null;
  streak?: number;
}

export type MissionTaskId = 'workout' | 'calories' | 'steps';
export type MissionTaskState = 'done' | 'next' | 'pending' | 'over';

export interface MissionTask {
  id: MissionTaskId;
  icon: string;
  label: string;
  current: number;
  target: number;
  unit: string;
  pct: number;                     // 0..100 bar fill
  state: MissionTaskState;
  action: { label: string; route: string; kind?: 'navigate' | 'steps-connect' };
}

export interface Mission {
  tasks: MissionTask[];            // always exactly 3, fixed order
  next: MissionTaskId | null;      // null ⇔ complete
  done: number;
  total: number;
  complete: boolean;
  urgency: 'normal' | 'streak-risk';
  headline: string;
}

const clampHour = (h: number): number => {
  if (!Number.isFinite(h)) return 12;
  return Math.min(23, Math.max(0, Math.floor(h)));
};

const pos = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const pctOf = (current: number, target: number): number =>
  Math.min(100, Math.max(0, Math.round((current / Math.max(1, target)) * 100)));

/**
 * The deterministic heart of the Home hero. Pure function: same snapshot in,
 * same mission out. Never throws — every input is sanitised — and always
 * returns exactly three rows so the widget's layout can never jump around.
 */
export const buildMission = (snapIn: MissionSnapshot): Mission => {
  const snap = snapIn || ({} as MissionSnapshot);
  const hour = clampHour(snap.hour);
  const cal = pos(snap.caloriesConsumed);
  const meals = pos(snap.mealsLogged);
  const workouts = pos(snap.workoutsToday);
  const streak = pos(snap.streak);
  const stepsConnected =
    typeof snap.steps === 'number' && Number.isFinite(snap.steps) && snap.steps >= 0;
  const steps = stepsConnected ? Math.floor(snap.steps as number) : 0;
  const targets = computeTargets(snap.goal, snap.weightKg);

  // Workout — done after one session. Evenings suggest the quick version
  // (feedback engine: a missed session becomes a smaller ask, not a bigger one).
  const workoutDone = workouts > 0;
  const workout: MissionTask = {
    id: 'workout',
    icon: '💪',
    label: 'Workout',
    current: Math.min(workouts, 1),
    target: 1,
    unit: 'session',
    pct: workoutDone ? 100 : 0,
    state: workoutDone ? 'done' : 'pending',
    action: {
      label: workoutDone ? 'View session' : hour >= 17 ? 'Quick 15-min' : 'Start workout',
      route: '/workout',
    },
  };

  // Calories — "done" is a band, not a max: 85–115% of target. Above that the
  // row flips to 'over' and the action steers correction instead of more logging.
  const calOver = cal > targets.calories * 1.15;
  const calDone = !calOver && cal >= targets.calories * 0.85;
  const calories: MissionTask = {
    id: 'calories',
    icon: '🥗',
    label: 'Calories',
    current: Math.round(cal),
    target: targets.calories,
    unit: 'kcal',
    pct: pctOf(cal, targets.calories),
    state: calOver ? 'over' : calDone ? 'done' : 'pending',
    action: {
      label: calOver ? 'Review meals' : meals === 0 ? 'Log first meal' : 'Log meal',
      route: '/track',
    },
  };

  // Steps — counted by the OS in the background; the only manual action is
  // connecting Health Connect (or topping up with a walk).
  const stepsDone = stepsConnected && steps >= STEPS_GOAL;
  const stepsTask: MissionTask = {
    id: 'steps',
    icon: '👟',
    label: 'Steps',
    current: steps,
    target: STEPS_GOAL,
    unit: 'steps',
    pct: stepsConnected ? pctOf(steps, STEPS_GOAL) : 0,
    state: stepsDone ? 'done' : 'pending',
    action: stepsConnected
      ? { label: 'Take a walk', route: '/explore' }
      : { label: 'Connect', route: '/', kind: 'steps-connect' },
  };

  const tasks: MissionTask[] = [workout, calories, stepsTask];
  const done = tasks.filter((t) => t.state === 'done').length;
  const complete = done === tasks.length;

  // The ONE next action. Mornings with nothing eaten start with breakfast
  // (fuel before training); otherwise training leads, then food, then steps.
  // 'over' calories never get highlighted as "next" — the row's own state
  // already carries that message.
  let next: MissionTaskId | null = null;
  if (!complete) {
    const undone = (id: MissionTaskId) =>
      tasks.find((t) => t.id === id && t.state !== 'done' && t.state !== 'over');
    const order: MissionTaskId[] =
      hour < 12 && meals === 0 ? ['calories', 'workout', 'steps'] : ['workout', 'calories', 'steps'];
    for (const id of order) {
      if (undone(id)) { next = id; break; }
    }
  }
  for (const t of tasks) {
    if (t.id === next && t.state === 'pending') t.state = 'next';
  }

  // Streak-risk: evening, an established streak, and nothing on the board.
  // Warning UI only — nothing is ever deducted. Losing the streak IS the
  // penalty; the app's job is to prevent it, not to pile on.
  const urgency: Mission['urgency'] =
    streak >= 3 && hour >= 19 && workouts === 0 && meals === 0 ? 'streak-risk' : 'normal';

  const nextLabel = next ? tasks.find((t) => t.id === next)!.label.toLowerCase() : '';
  const headline = complete
    ? 'Mission complete — recover well.'
    : urgency === 'streak-risk'
      ? `Protect your ${streak}-day streak.`
      : next === null
        // Only reachable when every unfinished row is 'over' (calories blew the
        // band): nothing left to *start*, so steer correction instead.
        ? `${done} of ${tasks.length} done — rein the calories back in.`
        : done === 0
          ? `Today's mission — ${nextLabel} first.`
          : `${done} of ${tasks.length} done — ${nextLabel} next.`;

  return { tasks, next, done, total: tasks.length, complete, urgency, headline };
};
