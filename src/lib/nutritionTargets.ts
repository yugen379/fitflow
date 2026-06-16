import type { UserProfile, MacroTargets, DayTargets } from '../types';

// ---------------------------------------------------------------------------
// Single source of truth for a user's effective daily nutrition targets.
// Pure (no firebase/React) so the proof harness can exercise it directly.
//
// Resolution order:
//   1. base calories from goal
//   2. macro split — percent mode (free) or exact grams (premium)
//   3. day-type override (premium) — workout vs rest day calorie/carb/protein
// ---------------------------------------------------------------------------

export interface DailyTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  dayType: 'workout' | 'rest' | 'base';
  macroMode: 'percent' | 'grams';
}

export const baseCaloriesFor = (goal?: string): number =>
  goal === 'fat_loss' ? 1800 : goal === 'muscle_gain' ? 2800 : 2200;

export const defaultSplitFor = (goal?: string) =>
  goal === 'fat_loss' ? { proteinPct: 35, carbsPct: 35, fatsPct: 30 }
    : goal === 'muscle_gain' ? { proteinPct: 30, carbsPct: 45, fatsPct: 25 }
      : { proteinPct: 25, carbsPct: 45, fatsPct: 30 };

const round = (n: number) => Math.max(0, Math.round(n || 0));

export const computeDailyTargets = (
  profile: Partial<UserProfile> | null | undefined,
  date: Date = new Date(),
): DailyTargets => {
  const goal = profile?.goal;
  let calories = baseCaloriesFor(goal);
  const mt = profile?.macroTargets as MacroTargets | undefined;

  let proteinG: number;
  let carbsG: number;
  let fatsG: number;
  const macroMode: 'percent' | 'grams' = mt?.mode === 'grams' ? 'grams' : 'percent';

  if (macroMode === 'grams' && mt) {
    proteinG = round(mt.proteinG ?? 0);
    carbsG = round(mt.carbsG ?? 0);
    fatsG = round(mt.fatsG ?? 0);
    // In gram mode the grams define the calorie target.
    const derived = round(proteinG * 4 + carbsG * 4 + fatsG * 9);
    if (derived > 0) calories = derived;
  } else {
    const split = mt && mt.mode === 'percent'
      ? { proteinPct: mt.proteinPct ?? 0, carbsPct: mt.carbsPct ?? 0, fatsPct: mt.fatsPct ?? 0 }
      : defaultSplitFor(goal);
    const sum = (split.proteinPct + split.carbsPct + split.fatsPct) || 100;
    proteinG = round((calories * (split.proteinPct / sum)) / 4);
    carbsG = round((calories * (split.carbsPct / sum)) / 4);
    fatsG = round((calories * (split.fatsPct / sum)) / 9);
  }

  // Goal-by-day override (premium).
  let dayType: 'workout' | 'rest' | 'base' = 'base';
  const dt = profile?.dayTargets as DayTargets | undefined;
  if (dt?.enabled && dt.schedule) {
    const weekday = String(date.getDay()); // 0=Sun .. 6=Sat
    const t = dt.schedule[weekday];
    if (t === 'workout' || t === 'rest') {
      dayType = t;
      const ov = t === 'workout' ? dt.workout : dt.rest;
      if (ov) {
        if (typeof ov.calories === 'number' && ov.calories > 0) calories = round(ov.calories);
        if (typeof ov.carbsG === 'number') carbsG = round(ov.carbsG);
        if (typeof ov.proteinG === 'number') proteinG = round(ov.proteinG);
      }
    }
  }

  return { calories, proteinG, carbsG, fatsG, dayType, macroMode };
};
