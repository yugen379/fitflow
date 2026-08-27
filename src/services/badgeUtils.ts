// Badge logic — pure computation over timestamps and day keys.
//
// No browser/Firebase imports → fully unit-testable by `npm run proof:badges`.
// badgeService.ts handles the Firestore I/O (reading the collections, awarding);
// this module answers the questions the requirements actually ask: "how many
// distinct days is that?", "is there a run of N in a row?", "how far back do I
// need to look?".
import { dayKey, daysBetweenKeys } from './retentionUtils';

/** The minimum shape the day extractors need — a Firestore doc, or a fake. */
export interface TimestampedDoc {
  data: () => { timestamp?: { toDate?: () => Date } } | undefined;
}

/**
 * Distinct LOCAL day keys, sorted ascending, from docs carrying a `timestamp`.
 *
 * Local, not UTC: a run of "consecutive days" has to mean consecutive days as
 * the user lived them. Docs with a missing or unparseable timestamp are dropped
 * rather than counted as an epoch day — one malformed record must not invent a
 * gap in someone's streak, nor a day they did not log.
 */
export const dayKeysOf = (docs: TimestampedDoc[]): string[] => {
  const days = new Set<string>();
  for (const d of docs) {
    const ts = d.data()?.timestamp?.toDate?.();
    if (ts instanceof Date && !isNaN(ts.getTime())) days.add(dayKey(ts));
  }
  return Array.from(days).sort();
};

/**
 * True when `days` (ascending, distinct 'YYYY-MM-DD') contains a run of
 * `needed` consecutive calendar days.
 *
 * Day distance goes through `daysBetweenKeys`, so this is immune to DST and to
 * the local UTC offset — subtracting two `Date`s is not, which is precisely how
 * the app's original streak counter broke on any day that was not exactly 24
 * hours long.
 */
export const hasConsecutiveRun = (days: string[], needed: number): boolean => {
  if (needed <= 0) return true;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && daysBetweenKeys(prev, d) === 1 ? run + 1 : 1;
    if (run >= needed) return true;
    prev = d;
  }
  return false;
};

/**
 * Local midnight, `n` days ago — the lower bound for a "last N days" query.
 *
 * Midnight, not "now minus n×24h": a window that starts at the current clock
 * time silently excludes the earliest part of the oldest day, so a genuine
 * 7-day run logged in the mornings would come back as 6.
 */
export const sinceDaysAgo = (n: number, now: Date = new Date()): Date => {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};
