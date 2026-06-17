// Proactive re-engagement — pure decision logic (firebase-free, Node-importable).
//
// This is the brain behind the three push triggers that move retention the most:
//   1. Streak-at-risk  — loss-aversion evening nudge before a streak breaks
//   3. Meal-time nudge — a midday prompt to log when nothing's been logged today
//   2. Win-back        — tiered resurrection for users who've gone quiet (D1…D30)
//
// All the Firestore I/O + FCM send lives in the Cloud Functions (admin SDK); this
// module only DECIDES whether to send and writes the copy. No browser/Firebase/
// React imports, so `npm run proof:engagement` proves every branch deterministically.
// The Cloud Functions mirror these same constants — keep them in sync (there is a
// proof assertion comment beside each in functions/src/index.ts).

// --- Day arithmetic (mirrors retentionUtils, kept local so this stays standalone) ---

/** 'YYYY-MM-DD' → whole-day ordinal (UTC), or null if malformed. DST/tz-proof. */
export const dayOrdinal = (key: unknown): number | null => {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / 86400000);
};

/** Whole days between two 'YYYY-MM-DD' keys (today - past). null if either malformed. */
export const daysBetween = (past: unknown, today: unknown): number | null => {
  const a = dayOrdinal(past), b = dayOrdinal(today);
  if (a === null || b === null) return null;
  return b - a;
};

export interface PushCopy {
  title: string;
  body: string;
}

// ===========================================================================
// 1. STREAK-AT-RISK  — the single biggest retention lever (loss aversion)
// ===========================================================================

// Only protect a streak that's worth keeping (a 1-day "streak" breaking is a
// non-event; a 6-day one breaking is the #1 churn trigger).
export const STREAK_RISK_MIN = 2;
// Evening window: late enough that "log before midnight" is urgent, early enough
// the user is still awake. Inclusive lower bound, exclusive at midnight.
export const STREAK_RISK_HOUR = 19;

export interface StreakRiskInput {
  currentStreak: number;        // denormalized on the user doc by recordActiveDay
  lastActiveDay: string;        // 'YYYY-MM-DD' of the most recent active day
  today: string;                // 'YYYY-MM-DD' (server, converted to user-local)
  hourLocal: number;            // user's local hour 0–23
  alreadyNotifiedDay?: string | null; // streakRiskNotifiedDate (idempotency)
}

/**
 * Send a streak-risk nudge when: the streak is worth protecting, the user has NOT
 * already logged today (so the streak really is at risk), it's the evening window,
 * and we haven't already nudged them today. Pure + total — never throws.
 */
export const shouldSendStreakRisk = (i: StreakRiskInput): boolean => {
  if (!i || typeof i !== 'object') return false;
  const streak = Number(i.currentStreak);
  if (!Number.isFinite(streak) || streak < STREAK_RISK_MIN) return false;

  // Active today already → streak is safe, nothing to warn about.
  if (i.lastActiveDay === i.today && dayOrdinal(i.today) !== null) return false;

  // The last active day must be exactly yesterday — i.e. the streak is alive but
  // unconfirmed today. If they missed yesterday too, the streak is already gone
  // (win-back handles that case, not this one).
  const gap = daysBetween(i.lastActiveDay, i.today);
  if (gap !== 1) return false;

  const hour = Number(i.hourLocal);
  if (!Number.isFinite(hour) || hour < STREAK_RISK_HOUR || hour > 23) return false;

  // Already nudged today → don't double-push.
  if (i.alreadyNotifiedDay && i.alreadyNotifiedDay === i.today) return false;

  return true;
};

export const streakRiskMessage = (currentStreak: number): PushCopy => {
  const n = Math.max(STREAK_RISK_MIN, Math.floor(Number(currentStreak) || STREAK_RISK_MIN));
  return {
    title: `🔥 Your ${n}-day streak ends at midnight`,
    body: `Don't lose it now — a quick log keeps your ${n}-day streak alive.`,
  };
};

// ===========================================================================
// 3. MEAL-TIME LOGGING NUDGE — retention + catalog data growth in one mechanic
// ===========================================================================

// Midday window: if nothing's been logged by early afternoon, a gentle prompt.
// Deliberately ONE nudge/day around lunch so it never feels spammy, and it sits
// in a different part of the day from the evening streak nudge (no collision).
export const MEAL_NUDGE_HOUR_START = 12;
export const MEAL_NUDGE_HOUR_END = 15;   // exclusive

export interface MealNudgeInput {
  lastMealAtMs: number | null;  // user.lastMealAt (ms) of the most recent meal
  nowMs: number;                // server now (ms)
  startOfTodayMs: number;       // ms at user-local midnight today
  hourLocal: number;            // user's local hour 0–23
  alreadyNudgedDay?: string | null; // mealNudgeDate (idempotency)
  today: string;                // 'YYYY-MM-DD'
}

/** True when we're in the midday window, the user has logged no meal today, and
 *  we haven't already nudged them today. Pure + total. */
export const shouldSendMealNudge = (i: MealNudgeInput): boolean => {
  if (!i || typeof i !== 'object') return false;
  const hour = Number(i.hourLocal);
  if (!Number.isFinite(hour) || hour < MEAL_NUDGE_HOUR_START || hour >= MEAL_NUDGE_HOUR_END) return false;

  if (i.alreadyNudgedDay && i.alreadyNudgedDay === i.today) return false;

  // Logged a meal already today → no nudge needed.
  const last = Number(i.lastMealAtMs);
  const start = Number(i.startOfTodayMs);
  if (Number.isFinite(last) && Number.isFinite(start) && last >= start) return false;

  return true;
};

export const mealNudgeMessage = (): PushCopy => ({
  title: "Haven't logged today?",
  body: 'Capture a meal in 2 taps — scan a barcode or just describe it.',
});

// ===========================================================================
// 2. WIN-BACK — resurrect users who've gone quiet (highest-ROI re-engagement)
// ===========================================================================

// Tiered touchpoints after the last active day. Each fires once; the set resets
// when the user returns (recordActiveDay clears winbackLastTier).
export const WINBACK_TIERS = [1, 3, 7, 14, 30] as const;
export type WinbackTier = (typeof WINBACK_TIERS)[number];

const WINBACK_COPY: Record<WinbackTier, PushCopy> = {
  1: { title: 'Pick up where you left off', body: 'A 2-minute log keeps your momentum going. You’ve got this.' },
  3: { title: 'Your coach misses you', body: 'Three days off is fine — jump back in and we’ll adjust your plan.' },
  7: { title: 'One week — let’s restart', body: 'A fresh week is the perfect reset. Log one thing to get rolling.' },
  14: { title: 'Still here for you', body: 'Two weeks out. Your data’s exactly where you left it — come finish what you started.' },
  30: { title: 'We saved your spot', body: 'A month away happens. One tap brings your whole plan back to life.' },
};

export interface WinbackInput {
  lastActiveDay: string;            // 'YYYY-MM-DD'
  today: string;                    // 'YYYY-MM-DD'
  lastTierNotified?: number | null; // winbackLastTier (idempotency, reset on return)
}

/**
 * Decide the win-back message for a lapsed user, or null if none is due. Fires only
 * on the exact tier days (so a user gets at most 5 nudges over a month, never daily),
 * and never repeats a tier already sent. Pure + total — never throws.
 */
export const winbackForInput = (i: WinbackInput): { tier: WinbackTier; copy: PushCopy } | null => {
  if (!i || typeof i !== 'object') return null;
  const gap = daysBetween(i.lastActiveDay, i.today);
  if (gap === null) return null;
  if (!WINBACK_TIERS.includes(gap as WinbackTier)) return null;
  const tier = gap as WinbackTier;
  // Already sent this exact tier (or a later one) → skip.
  const last = Number(i.lastTierNotified);
  if (Number.isFinite(last) && last >= tier) return null;
  return { tier, copy: WINBACK_COPY[tier] };
};
