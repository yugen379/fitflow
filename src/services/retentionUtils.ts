// Retention analytics — pure computation over a set of "active day" markers.
//
// No browser/Firebase imports → fully unit-testable by `npm run proof:retention`.
// analyticsService.ts handles the Firestore I/O (recording active days, fetching
// them); this module turns a signup date + the set of active-day strings into the
// product metrics: streaks, rolling active counts, and D1/D7/D30 retention.

export interface RetentionStats {
  totalActiveDays: number;
  currentStreak: number;       // consecutive days ending today (grace: counts if active yesterday)
  longestStreak: number;       // longest consecutive run ever
  activeLast7: number;         // active days within the last 7 (incl. today)
  activeLast30: number;        // active days within the last 30 (incl. today)
  daysSinceSignup: number;
  d1: boolean;                 // returned ≥1 day after signup
  d7: boolean;                 // returned ≥7 days after signup
  d30: boolean;                // returned ≥30 days after signup
}

// 'YYYY-MM-DD' in LOCAL time (matches how active days are recorded on-device).
export const dayKey = (d: Date): string => {
  const dt = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Convert a 'YYYY-MM-DD' string to a whole-day ordinal (days since epoch, UTC) so
// gaps/streaks are pure integer arithmetic and immune to DST/timezone drift.
// Returns null for anything malformed.
const dayOrdinal = (key: unknown): number | null => {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  // Reject impossible dates that JS rolled over (e.g. 2024-02-31).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / 86400000);
};

/**
 * Compute retention/consistency stats. Pure: deterministic for the same inputs.
 * Tolerates malformed/duplicate day strings, an unknown signup, and active days
 * that predate signup. Never throws.
 */
export const computeRetention = (
  signupDay: string,
  activeDays: string[],
  todayDay: string,
): RetentionStats => {
  const todayOrd = dayOrdinal(todayDay) ?? Math.floor(Date.now() / 86400000);

  // Unique, valid, sorted ascending day ordinals.
  const ordSet = new Set<number>();
  for (const k of Array.isArray(activeDays) ? activeDays : []) {
    const o = dayOrdinal(k);
    if (o !== null) ordSet.add(o);
  }
  const ords = Array.from(ordSet).sort((a, b) => a - b);

  const signupOrd = dayOrdinal(signupDay) ?? (ords.length ? ords[0] : todayOrd);
  const daysSinceSignup = Math.max(0, todayOrd - signupOrd);

  // Longest consecutive run anywhere.
  let longestStreak = 0, run = 0, prev: number | null = null;
  for (const o of ords) {
    run = prev !== null && o === prev + 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prev = o;
  }

  // Current streak: consecutive days ending at today, or at yesterday (grace so a
  // streak isn't "lost" until a full day is missed). Counts backward from anchor.
  let currentStreak = 0;
  const anchor = ordSet.has(todayOrd) ? todayOrd : ordSet.has(todayOrd - 1) ? todayOrd - 1 : null;
  if (anchor !== null) {
    let cur = anchor;
    while (ordSet.has(cur)) { currentStreak++; cur--; }
  }

  const activeLast7 = ords.filter((o) => o > todayOrd - 7 && o <= todayOrd).length;
  const activeLast30 = ords.filter((o) => o > todayOrd - 30 && o <= todayOrd).length;

  // Cohort retention: did the user return at least N days after signing up?
  const maxOffset = ords.reduce((mx, o) => Math.max(mx, o - signupOrd), 0);
  const d1 = maxOffset >= 1;
  const d7 = maxOffset >= 7;
  const d30 = maxOffset >= 30;

  return {
    totalActiveDays: ords.length,
    currentStreak,
    longestStreak,
    activeLast7,
    activeLast30,
    daysSinceSignup,
    d1,
    d7,
    d30,
  };
};
