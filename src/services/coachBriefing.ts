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

import { formatVolume } from '../lib/units'; // pure, import-free
import { t, msg, tDyn } from '../i18n/i18n'; // pure, import-free

const IMPERIAL = { system: 'imperial' } as const;

export type CoachTone = 'push' | 'nudge' | 'care' | 'celebrate';

export interface CoachContext {
  /** The user's chosen daily calorie target, when set. */
  calorieTarget?: number;
  /** The Fuel tab's (safety-bounded) protein target; wins over the bodyweight formula. */
  proteinTarget?: number;
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
  /** Display system for the water line (data stays ml). Plain string so the ctx stays JSON. */
  unitSystem?: 'metric' | 'imperial';
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
export const computeTargets = (goal?: string, weightKg?: number, calorieTarget?: number, proteinTarget?: number): CoachTargets => {
  const w = typeof weightKg === 'number' && weightKg > 0 ? weightKg : 70;
  const g = goal || 'general';
  // The user's own target (meal plan / nutrition goals) always wins, so every
  // widget shows the SAME number (was: Home 1800 vs meal plan 2000).
  const calories = typeof calorieTarget === 'number' && calorieTarget > 0
    ? Math.round(calorieTarget)
    : g === 'fat_loss' ? 1800 : g === 'muscle_gain' ? 2800 : 2200;
  const proteinFactor = g === 'muscle_gain' ? 2.0 : g === 'fat_loss' ? 1.8 : 1.6;
  return {
    calories,
    // Same number Fuel shows (was: coach 162 g vs Fuel 185 g for one user).
    proteinG: typeof proteinTarget === 'number' && proteinTarget > 0
      ? Math.round(proteinTarget)
      : Math.round(w * proteinFactor),
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
  'train-window': msg('Training time.'),
  'train-gap': msg('Time to move.'),
  'train-plan': msg('Plan your session.'),
  'train-evening': msg('One more chance to move.'),
  'protein-gap': msg('Close your protein gap.'),
  hydrate: msg('Hydration check.'),
  'fuel-start': msg('Fuel the day.'),
  'log-meals': msg('Log your day.'),
  // The Mission card above already says "Protect your N-day streak" — the
  // coach adds the next step instead of repeating it (it said it 3 times).
  'streak-risk': msg('One small log keeps it alive.'),
  'recover-lowsleep': msg('Recover smart today.'),
  winddown: msg('Wind down.'),
  'all-good': msg("You're locked in."),
  default: msg('Your move.'),
};

/** A goal id as words for the middle of a sentence ("muscle gain"), in the app's language. */
export const goalWords = (goal: string): string =>
  goal === 'muscle_gain' ? t('muscle gain')
    : goal === 'fat_loss' ? t('fat loss')
    : goal === 'general' ? t('general')
    : goal === 'maintenance' ? t('maintenance')
    : goal === 'athletic_performance' ? t('athletic performance')
    : goal.replace(/_/g, ' ');

const greet = (pod: string): string =>
  pod === 'morning' ? t('Good morning — set up your day.')
    : pod === 'midday' ? t("Midday check — here's your focus.")
    : pod === 'evening' ? t("Evening — let's finish strong.")
    : t('Late hours — keep it calm.');

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
  const goalLabel = goalWords(goal);
  const targets = computeTargets(goal, ctx.weightKg, ctx.calorieTarget, ctx.proteinTarget);

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
      title: t('Go easier today'),
      message: t("Only {hours}h of sleep last night. Train at ~70% or swap to a Zone-2 walk — you'll still adapt without digging a hole.", { hours: round(sleep) }),
      tone: 'care',
      action: { label: t('Plan recovery'), route: '/wellness' },
      priority: 84,
    });
  }

  // 2) Training — exactly one training nudge, chosen by time + history.
  if (!trained && pod !== 'night') {
    if (pwh != null && hour >= pwh - 1) {
      candidates.push({
        id: 'train-window',
        icon: '💪',
        title: t('Your {time} window is open', { time: fmtHour(pwh) }),
        message: t('You usually train around {time}. Thirty focused minutes is enough to keep the plan moving.', { time: fmtHour(pwh) }),
        tone: 'push',
        action: { label: t('Start workout'), route: '/workout' },
        priority: 86,
      });
    } else if (daysSince != null && daysSince >= 2) {
      candidates.push({
        id: 'train-gap',
        icon: '🔥',
        title: t('{n} days since your last session', { n: daysSince }),
        message: t(`Momentum beats motivation. Knock out a short session today and the streak rebuilds itself.`),
        tone: 'push',
        action: { label: t("Let's move"), route: '/workout' },
        priority: 80,
      });
    } else if (pwh != null) {
      candidates.push({
        id: 'train-plan',
        icon: '📋',
        title: t('Training around {time}', { time: fmtHour(pwh) }),
        message: t('Keep your usual {time} window clear and fuel up beforehand — protein plus some carbs.', { time: fmtHour(pwh) }),
        tone: 'nudge',
        action: { label: t('Preview workout'), route: '/workout' },
        priority: 52,
      });
    } else if (pod === 'evening') {
      candidates.push({
        id: 'train-evening',
        icon: '⚡',
        title: t('Still time to move'),
        message: t(`Even 20 minutes counts. One lift, two exercises — show up small and let momentum do the rest.`),
        tone: 'push',
        action: { label: t('Quick workout'), route: '/workout' },
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
          title: t('{n}g protein to go', { n: gap }),
          message: t("You're at {protein}g of your {target}g target. A shake or a tub of Greek yogurt closes the gap before bed.", { protein: round(protein), target: targets.proteinG }),
          tone: 'nudge',
          action: { label: t('Log protein'), route: '/track' },
          priority: 72,
        });
      }
    } else if (pod === 'midday' && proteinPct < 0.35) {
      candidates.push({
        id: 'protein-gap',
        icon: '🥩',
        title: t('Front-load your protein'),
        message: t("You're at {protein}g of {target}g. Aim for ~30g this meal so you're not chasing it tonight.", { protein: round(protein), target: targets.proteinG }),
        tone: 'nudge',
        action: { label: t('Log a meal'), route: '/track' },
        priority: 50,
      });
    }
  }

  // 4) Hydration.
  if (waterPct < 0.4 && (pod === 'midday' || pod === 'evening')) {
    candidates.push({
      id: 'hydrate',
      icon: '💧',
      title: t('Hydration is behind'),
      message: ctx.unitSystem === 'imperial'
        ? t('{water} of your {goal} goal so far. A 16 fl oz top-up now keeps energy and focus steady.', { water: formatVolume(water, IMPERIAL), goal: formatVolume(targets.waterMl, IMPERIAL) })
        : t('{water}ml of your {goal}ml goal so far. A 500ml top-up now keeps energy and focus steady.', { water: round(water), goal: targets.waterMl }),
      tone: 'nudge',
      action: { label: t('Add water'), route: '/', kind: 'water' },
      priority: 60,
    });
  }

  // 5) Nothing logged yet — get the day started.
  if (nothingLogged) {
    if (pod === 'morning') {
      candidates.push({
        id: 'fuel-start',
        icon: '🍳',
        title: t('Log breakfast'),
        message: t("Fuel the day and unlock today's macro targets for {goal}. Even a rough estimate gets you guided.", { goal: goalLabel }),
        tone: 'nudge',
        action: { label: t('Log breakfast'), route: '/track' },
        priority: 66,
      });
    } else if (pod === 'midday') {
      candidates.push({
        id: 'fuel-start',
        icon: '🍽️',
        title: t('Nothing logged yet'),
        message: t(`Add a meal so I can steer your protein and calories for the rest of the day.`),
        tone: 'nudge',
        action: { label: t('Log a meal'), route: '/track' },
        priority: 64,
      });
    } else {
      candidates.push({
        id: 'log-meals',
        icon: '📔',
        title: t('Log today before bed'),
        message: t(`A few taps now means tomorrow's plan adapts to where you actually landed.`),
        tone: 'nudge',
        action: { label: t('Log meals'), route: '/track' },
        priority: 56,
      });
    }
  }

  // 6) Streak protection — high priority because a lapse is costly.
  if (streak >= 3 && (pod === 'evening' || pod === 'night') && nothingLogged && !trained && waterPct < 0.3) {
    candidates.push({
      id: 'streak-risk',
      icon: '🔥',
      title: t(`Log one thing before midnight`),
      message: t('Nothing logged today yet. A meal, a glass of water or a short walk keeps your {n} days going.', { n: round(streak) }),
      tone: 'push',
      action: { label: t('Keep the streak'), route: '/track' },
      priority: 90,
    });
  }

  // 7) Wind down at night.
  if (pod === 'night' && hour >= 22) {
    candidates.push({
      id: 'winddown',
      icon: '🌙',
      title: t('Start winding down'),
      message: t(`Screens off in ~45 minutes and aim for 7+ hours. Recovery is the rep you can't skip — it's where the work compounds.`),
      tone: 'care',
      action: { label: t('Log sleep'), route: '/wellness' },
      priority: 46,
    });
  }

  // 8) Everything in range — celebrate, don't nag.
  const allGood = trained && cal > 0 && proteinPct >= 0.8 && waterPct >= 0.8;
  if (allGood) {
    candidates.push({
      id: 'all-good',
      icon: '✅',
      title: t('Everything in range'),
      message: t(`Training, protein, and hydration all on point today. Bank the recovery — you've earned it.`),
      tone: 'celebrate',
      action: { label: t('Recover well'), route: '/wellness' },
      priority: 44,
    });
  }

  // Fallback — always have something useful to say.
  if (candidates.length === 0) {
    candidates.push({
      id: 'default',
      icon: '🎯',
      title: t('Keep {goal} on track', { goal: goalLabel }),
      message: t(`Pick your next move — log a meal, start a session, or ask me anything. Small consistent actions compound.`),
      tone: 'nudge',
      action: { label: t('Ask your coach'), route: '/coach' },
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
  const headline = tDyn(HEADLINES[top.id]) || greet(pod);
  const subtitle =
    top.tone === 'celebrate'
      ? t("Nothing urgent — enjoy it.")
      : nudges.length > 1
        ? t('{n} things your coach lined up for right now.', { n: nudges.length })
        : t('One focus for right now.');

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
