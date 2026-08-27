// The exercise library's vocabulary — one definition, used by the data and by
// the filters that search it.
//
// These lists used to live as string literals inside Library.tsx while the JSON
// was tagged by hand, and the two drifted apart with nothing to notice:
//
//   • Squats — the most-searched exercise in any fitness app — was tagged
//     ['Quads','Glutes','Hamstrings'] and the filter chip said "Legs", so
//     filtering by Legs hid it. Seven exercises were invisible to every muscle
//     filter.
//   • Eleven more were invisible to every equipment filter (Yoga Mat, Bench,
//     Pull-up Bar, Jump Rope, Wall, Box were all untaggable).
//   • The "Resistance Band" chip matched nothing at all — a dead filter.
//
// `npm run proof:library` now fails if any exercise is unreachable from any
// filter, so the vocabulary and the data cannot drift apart again.

export const CATEGORIES = [
  'Strength', 'Cardio', 'HIIT', 'Yoga', 'Flexibility', 'Recovery',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Filterable muscle regions — the chips a user actually taps.
 *
 * Deliberately coarse. An exercise may ALSO carry finer tags (Quads, Glutes,
 * Triceps…) for the AI coach and the detail screen, but every exercise must
 * carry at least one of these, or it cannot be found.
 */
export const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Full Body',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/**
 * Finer tags mapped to the region they belong to.
 *
 * Used to normalise the dataset: anything tagged 'Quads' also gets 'Legs', so
 * the coarse filter finds it while the specific tag survives for display.
 */
export const MUSCLE_PARENT: Record<string, MuscleGroup> = {
  Quads: 'Legs', Quadriceps: 'Legs', Hamstrings: 'Legs', Glutes: 'Legs',
  Calves: 'Legs', Adductors: 'Legs', Abductors: 'Legs', Hips: 'Legs',
  Biceps: 'Arms', Triceps: 'Arms', Forearms: 'Arms',
  Shoulder: 'Shoulders', Delts: 'Shoulders', Deltoids: 'Shoulders',
  Traps: 'Back', Lats: 'Back', 'Lower Back': 'Back', Rhomboids: 'Back',
  Abs: 'Core', Obliques: 'Core', 'Hip Flexors': 'Core',
  Pecs: 'Chest',
};

/** Equipment the filter offers. Every value here exists in the dataset. */
export const EQUIPMENT = [
  'None', 'Dumbbells', 'Barbell', 'Resistance Band', 'Machine', 'Kettlebell',
  'Pull-up Bar', 'Bench', 'Yoga Mat', 'Jump Rope', 'Box', 'Cable',
  'Wall',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Add the parent region for any fine-grained tag. Idempotent. */
export const normaliseMuscles = (tags: string[]): string[] => {
  const out = new Set<string>();
  for (const t of tags || []) {
    out.add(t);
    const parent = MUSCLE_PARENT[t];
    if (parent) out.add(parent);
  }
  return Array.from(out);
};
