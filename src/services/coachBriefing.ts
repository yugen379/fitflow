// Proactive Coach — pure, deterministic nudge engine.
//
// This module has NO browser, React, or Firebase imports so it can be unit-tested
// by a Node harness (`npm run proof:briefing`) exactly like `barcodeUtils.ts`.
//
// The engine turns a snapshot of the user's day (time, macros, hydration, sleep,
// training, streak, habits) into 1–3 prioritised, specific, actionable nudges.
// It is the *moat* feature: a coach that initiates instead of waiting to be asked.
// Gemini only polishes the wording afterwards (see getCoachBriefing); the SELECTION
// of what to surface is deterministic here, so correctness is provable and the
// feature degrades to perfectly sensible copy with zero AI calls.

export type CoachTone = 'push' | 'nudge' | 'care' | 'celebrate';

export interface CoachContext {
  hour: number;                       // 0–23, user-local
  goal?: string;                      // 'muscle_gain' | 'fat_loss' | 'general' | ...
  weightKg?: number;
  caloriesConsumed?: number;          // today
  proteinConsumed?: number;           // grams, today
  waterMl?: number;                   // today
  trainedToday?: boolean;
  mealsLogged?: number;               // today
  sleepHours?: number;                // last night
  streak?: number;
  preferredWorkoutHour?: number | null;   // 0–23, inferred from history
  daysSinceLastWorkout?: number | null;
}

export type NudgeActionKind = 'navigate' | 'water';

export interface CoachNudge {
  id: string;
  icon: string;
  title: string;
  message: string;
  tone: CoachTone;
  action: { label: string; route: string; kind?: NudgeActionKind };
  priority: number;                   // higher = surfaced first
}

export interface CoachBriefing {
  headline: string;
  subtitle: string;
  nudges: CoachNudge[];               // always 1–3, priority-ordered
  source: 'AI' | 'engine';
}

export interface CoachTargets {
  calories: number;
  proteinG: number;
  waterMl: number;
}

// Daily targets from goal + bodyweight. Mirrors the formulas already used in
// Home.tsx (calorie target) and heuristicCoachReply (protein / water) so the
// proactive coach never contradicts the rest of the app.
export const computeTargets = (goal?: string, weightKg?: number): CoachTargets => {
  const w = typeof weightKg === 'number' && weightKg > 0 ? weightKg : 70;
  const g = goal || 'general';
  const calories = g === 'fat_loss' ? 1800 : g === 'muscle_gain' ? 2800 : 2200;
  const proteinFactor = g === 'muscle_gain' ? 2.0 : g === 'fat_loss' ? 1.8 : 1.6;
  return {
    calories,
    proteinG: Math.round(w * proteinFactor),
    waterMl: Math.round(w * 35),
  };
};

export const partOfDay = (hour: number): 'morning' | 'midday' | 'evening' | 'night' => {
  const h = clampHour(hour);
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'midday';
  if (h < 22) return 'evening';
  return 'night';
};

const clampHour = (h: number): number => {
  if (!Number.isFinite(h)) return 12;
  return Math.min(23, Math.max(0, Math.floor(h)));
};

// Non-negative finite number, else 0.
const pos = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const validHour = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 23 ? Math.floor(v) : null;

const validDays = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

const HEADLINES: Record<string, string> = {
  'train-window': 'Training time.',
  'train-gap': 'Time to move.',
  'train-plan': 'Plan your session.',
  'train-evening': 'One more chance to move.',
  'protein-gap': 'Close your protein gap.',
  hydrate: 'Hydration check.',
  'fuel-start': 'Fuel the day.',
  'log-meals': 'Log your day.',
  'streak-risk': 'Protect your streak.',
  'recover-lowsleep': 'Recover smart today.',
  winddown: 'Wind down.',
  'all-good': "You're locked in.",
  default: 'Your move.',
};

const greet = (pod: string): string =>
  pod === 'morning' ? 'Good morning — set up your day.'
    : pod === 'midday' ? "Midday check — here's your focus."
    : pod === 'evening' ? "Evening — let's finish strong."
    : 'Late hours — keep it calm.';

/**
 * The deterministic heart of the proactive coach. Pure function: same context in,
 * same briefing out. Never throws — every numeric input is sanitised, and there is
 * always at least one fallback nudge so the briefing is never empty.
 */
export const buildBriefing = (ctxIn: CoachContext): CoachBriefing => {
  const ctx = ctxIn || ({} as CoachContext);
  const hour = clampHour(ctx.hour);
  const pod = partOfDay(hour);
  const goal = ctx.goal || 'general';
  const goalLabel = goal.replace(/_/g, ' ');
  const targets = computeTargets(goal, ctx.weightKg);

  const cal = pos(ctx.caloriesConsumed);
  const protein = pos(ctx.proteinConsumed);
  const water = pos(ctx.waterMl);
  const meals = pos(ctx.mealsLogged);
  const sleep = pos(ctx.sleepHours);
  const streak = pos(ctx.streak);
  const trained = !!ctx.trainedToday;
  const pwh = validHour(ctx.preferredWorkoutHour);
  const daysSince = validDays(ctx.daysSinceLastWorkout);

  const proteinPct = protein / targets.proteinG;
  const waterPct = water / targets.waterMl;
  const nothingLogged = cal === 0 && meals === 0;

  const candidates: CoachNudge[] = [];

  // 1) Low-sleep recovery (morning/midday): protect the user from grinding tired.
  if (sleep > 0 && sleep < 6 && (pod === 'morning' || pod === 'midday')) {
    candidates.push({
      id: 'recover-lowsleep',
      icon: '😴',
      title: 'Go easier today',
      message: `Only ${round(sleep)}h of sleep last night. Train at ~70% or swap to a Zone-2 walk — you'll still adapt without digging a hole.`,
      tone: 'care',
      action: { label: 'Plan recovery', route: '/wellness' },
      priority: 84,
    });
  }

  // 2) Training — exactly one training nudge, chosen by time + history.
  if (!trained && pod !== 'night') {
    if (pwh != null && hour >= pwh - 1) {
      candidates.push({
        id: 'train-window',
        icon: '💪',
        title: `Your ${fmtHour(pwh)} window is open`,
        message: `You usually train around ${fmtHour(pwh)}. Thirty focused minutes is enough to keep the plan moving.`,
        tone: 'push',
        action: { label: 'Start workout', route: '/workout' },
        priority: 86,
      });
    } else if (daysSince != null && daysSince >= 2) {
      candidates.push({
        id: 'train-gap',
        icon: '🔥',
        title: `${daysSince} days since your last session`,
        message: `Momentum beats motivation. Knock out a short session today and the streak rebuilds itself.`,
        tone: 'push',
        action: { label: "Let's move", route: '/workout' },
        priority: 80,
      });
    } else if (pwh != null) {
      candidates.push({
        id: 'train-plan',
        icon: '📋',
        title: `Training around ${fmtHour(pwh)}`,
        message: `Keep your usual ${fmtHour(pwh)} window clear and fuel up beforehand — protein plus some carbs.`,
        tone: 'nudge',
        action: { label: 'Preview workout', route: '/workout' },
        priority: 52,
      });
    } else if (pod === 'evening') {
      candidates.push({
        id: 'train-evening',
        icon: '⚡',
        title: 'Still time to move',
        message: `Even 20 minutes counts. One lift, two exercises — show up small and let momentum do the rest.`,
        tone: 'push',
        action: { label: 'Quick workout', route: '/workout' },
        priority: 58,
      });
    }
  }

  // 3) Protein gap — only when they're actually eating (else the log-meal nudge covers it).
  if ((protein > 0 || meals > 0)) {
    if ((pod === 'evening' || pod === 'night') && proteinPct < 0.8) {
      const gap = Math.max(0, Math.round(targets.proteinG - protein));
      if (gap > 0) {
        candidates.push({
          id: 'protein-gap',
          icon: '🥩',
          title: `${gap}g protein to go`,
          message: `You're at ${round(protein)}g of your ${targets.proteinG}g target. A shake or a tub of Greek yogurt closes the gap before bed.`,
          tone: 'nudge',
          action: { label: 'Log protein', route: '/track' },
          priority: 72,
        });
      }
    } else if (pod === 'midday' && proteinPct < 0.35) {
      candidates.push({
        id: 'protein-gap',
        icon: '🥩',
        title: 'Front-load your protein',
        message: `You're at ${round(protein)}g of ${targets.proteinG}g. Aim for ~30g this meal so you're not chasing it tonight.`,
        tone: 'nudge',
        action: { label: 'Log a meal', route: '/track' },
        priority: 50,
      });
    }
  }

  // 4) Hydration.
  if (waterPct < 0.4 && (pod === 'midday' || pod === 'evening')) {
    candidates.push({
      id: 'hydrate',
      icon: '💧',
      title: 'Hydration is behind',
      message: `${round(water)}ml of your ${targets.waterMl}ml goal so far. A 500ml top-up now keeps energy and focus steady.`,
      tone: 'nudge',
      action: { label: 'Add water', route: '/', kind: 'water' },
      priority: 60,
    });
  }

  // 5) Nothing logged yet — get the day started.
  if (nothingLogged) {
    if (pod === 'morning') {
      candidates.push({
        id: 'fuel-start',
        icon: '🍳',
        title: 'Log breakfast',
        message: `Fuel the day and unlock today's macro targets for ${goalLabel}. Even a rough estimate gets you guided.`,
        tone: 'nudge',
        action: { label: 'Log breakfast', route: '/track' },
        priority: 66,
      });
    } else if (pod === 'midday') {
      candidates.push({
        id: 'fuel-start',
        icon: '🍽️',
        title: 'Nothing logged yet',
        message: `Add a meal so I can steer your protein and calories for the rest of the day.`,
        tone: 'nudge',
        action: { label: 'Log a meal', route: '/track' },
        priority: 64,
      });
    } else {
      candidates.push({
        id: 'log-meals',
        icon: '📔',
        title: 'Log today before bed',
        message: `A few taps now means tomorrow's plan adapts to where you actually landed.`,
        tone: 'nudge',
        action: { label: 'Log meals', route: '/track' },
        priority: 56,
      });
    }
  }

  // 6) Streak protection — high priority because a lapse is costly.
  if (streak >= 3 && (pod === 'evening' || pod === 'night') && nothingLogged && !trained && waterPct < 0.3) {
    candidates.push({
      id: 'streak-risk',
      icon: '🔥',
      title: `Save your ${round(streak)}-day streak`,
      message: `Nothing logged today yet. One meal, a glass of water, or a short walk keeps the streak alive before midnight.`,
      tone: 'push',
      action: { label: 'Keep the streak', route: '/track' },
      priority: 90,
    });
  }

  // 7) Wind down at night.
  if (pod === 'night' && hour >= 22) {
    candidates.push({
      id: 'winddown',
      icon: '🌙',
      title: 'Start winding down',
      message: `Screens off in ~45 minutes and aim for 7+ hours. Recovery is the rep you can't skip — it's where the work compounds.`,
      tone: 'care',
      action: { label: 'Log sleep', route: '/wellness' },
      priority: 46,
    });
  }

  // 8) Everything in range — celebrate, don't nag.
  const allGood = trained && cal > 0 && proteinPct >= 0.8 && waterPct >= 0.8;
  if (allGood) {
    candidates.push({
      id: 'all-good',
      icon: '✅',
      title: 'Everything in range',
      message: `Training, protein, and hydration all on point today. Bank the recovery — you've earned it.`,
      tone: 'celebrate',
      action: { label: 'Recover well', route: '/wellness' },
      priority: 44,
    });
  }

  // Fallback — always have something useful to say.
  if (candidates.length === 0) {
    candidates.push({
      id: 'default',
      icon: '🎯',
      title: `Keep ${goalLabel} on track`,
      message: `Pick your next move — log a meal, start a session, or ask me anything. Small consistent actions compound.`,
      tone: 'nudge',
      action: { label: 'Ask your coach', route: '/coach' },
      priority: 10,
    });
  }

  // Sort by priority, dedupe by id (keep highest), cap at 3.
  const seen = new Set<string>();
  const nudges = candidates
    .sort((a, b) => b.priority - a.priority)
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .slice(0, 3);

  const top = nudges[0];
  const headline = HEADLINES[top.id] || greet(pod);
  const subtitle =
    top.tone === 'celebrate'
      ? "Nothing urgent — enjoy it."
      : nudges.length > 1
        ? `${nudges.length} things your coach lined up for right now.`
        : 'One focus for right now.';

  return { headline, subtitle, nudges, source: 'engine' };
};

// Apply AI-polished copy onto an engine briefing without trusting the model for
// anything structural. Only headline/subtitle and per-nudge title/message can be
// overridden; ids, icons, actions, tone, priority and ordering stay fixed. Any
// missing or non-string field falls back to the engine copy. Pure + safe.
export const applyPolish = (
  base: CoachBriefing,
  polish: any,
): CoachBriefing => {
  if (!polish || typeof polish !== 'object') return base;
  const str = (v: unknown, fb: string) =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : fb;

  const byId: Record<string, any> =
    polish.nudges && typeof polish.nudges === 'object'
      ? (Array.isArray(polish.nudges)
          ? Object.fromEntries(polish.nudges.filter((n: any) => n && n.id).map((n: any) => [n.id, n]))
          : polish.nudges)
      : {};

  const nudges = base.nudges.map((n) => {
    const p = byId[n.id];
    if (!p) return n;
    return { ...n, title: str(p.title, n.title), message: str(p.message, n.message) };
  });

  return {
    headline: str(polish.headline, base.headline),
    subtitle: str(polish.subtitle, base.subtitle),
    nudges,
    source: 'AI',
  };
};

// --- tiny local formatters (kept here so the module stays dependency-free) ---
function round(n: number): number {
  return Math.round(n);
}
function fmtHour(h: number): string {
  const hr = clampHour(h);
  const period = hr < 12 ? 'am' : 'pm';
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return `${display}${period}`;
}
