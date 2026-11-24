import type { UserProfile } from '../types';
import { computeDailyTargets } from './nutritionTargets';

// ---------------------------------------------------------------------------
// What the coach knows about TODAY.
//
// The chat used to get only goal/weight/age, so with six meals logged it
// answered "I don't have information about what you've eaten today" — the
// "personal coach" could not see the user's own data. This builds a compact
// factual block that is attached to the outgoing message (works with the
// already-deployed proxy; no server change needed).
// ---------------------------------------------------------------------------

export interface TodayMeal { name: string; calories?: number; protein?: number; carbs?: number; fats?: number }

const n = (v: unknown) => Math.round(Number(v) || 0);

/** Pure formatter, exported for the proof harness. */
export const formatCoachContext = (
  profile: Partial<UserProfile> | null | undefined,
  meals: TodayMeal[],
  now: Date = new Date(),
): string => {
  const t = computeDailyTargets(profile, now);
  const tot = meals.reduce(
    (a, m) => ({ kcal: a.kcal + n(m.calories), p: a.p + n(m.protein), c: a.c + n(m.carbs), f: a.f + n(m.fats) }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
  const lines = meals.slice(0, 12).map(m =>
    `- ${String(m.name || 'Food').slice(0, 80)}: ${n(m.calories)} kcal (P ${n(m.protein)}g, C ${n(m.carbs)}g, F ${n(m.fats)}g)`);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return [
    `[FitFlow app data for today, local time ${hh}:${mm}. Use it when relevant; do not say you lack it.]`,
    meals.length ? `Meals logged today:\n${lines.join('\n')}` : 'Meals logged today: none yet.',
    `Totals: ${tot.kcal} kcal, P ${tot.p}g, C ${tot.c}g, F ${tot.f}g.`,
    `Daily targets: ${t.calories} kcal, P ${t.proteinG}g, C ${t.carbsG}g, F ${t.fatsG}g.`,
    profile?.streak ? `Current streak: ${profile.streak} days.` : '',
  ].filter(Boolean).join('\n').slice(0, 1400); // the proxy clips the whole message at 2000 chars
};

/** Reads today's meals (one-shot) and formats them. Never throws. */
export const buildCoachContext = async (profile: Partial<UserProfile> | null | undefined): Promise<string> => {
  let meals: TodayMeal[] = [];
  if (profile?.uid) {
    try {
      const [{ collection, query, where, orderBy, getDocs }, { db }] = await Promise.all([
        import('firebase/firestore'), import('./firestore'),
      ]);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const snap = await getDocs(query(collection(db, 'meals'),
        where('userId', '==', profile.uid), where('timestamp', '>=', start),
        orderBy('timestamp', 'desc'))); // same shape as Track's query, so it uses the same index
      meals = snap.docs.map(d => d.data() as TodayMeal);
    } catch { /* offline or rules: answer without meals rather than fail */ }
  }
  return formatCoachContext(profile, meals);
};
