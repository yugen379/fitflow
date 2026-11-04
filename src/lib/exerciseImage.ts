import { Exercise } from '../types';

// Every ID below was fetched (HTTP 200) and LOOKED AT on 2026-11-04. The old
// list described photos wrongly ("box jump" was a deadlift, "dumbbells" was an
// overhead barbell press), six IDs were dead 404s, and the component never used
// it anyway: every Strength/Yoga/Flexibility/Recovery card showed the same
// overhead-press photo — a hip stretch and an ab-wheel rollout included.
// If you add a photo, open it first and describe what is actually in it.
const P = {
  overheadPress: '1541534741688-6078c6bfb5c5', // woman, barbell overhead, from behind
  backSquat:     '1574680178050-55c6a6a96e0a', // woman in a squat rack, bar on back
  backSquatBW:   '1574680096145-d05b474e2155', // black-and-white, bar on back
  deadliftSetup: '1517836357463-d25dfeac3438', // barbell deadlift set-up, close on the bar
  deadliftDark:  '1605296867304-46d5465a13f1', // man gripping a barbell, dark gym
  curl:          '1581009146145-b5ef050c2e1e', // man doing an EZ-bar curl
  dumbbellRack:  '1534438327276-14e5300c3a48', // rows of dumbbells, gym floor
  crunch:        '1571019613454-1cb2f99b2d8b', // woman doing a crunch on a mat
  floorClass:    '1518611012118-696072aa579a', // group, all-fours kickbacks on mats
  trailRun:      '1486218119243-13883505764c', // man running a gravel trail
  trackSprint:   '1502904550040-7534597429ae', // aerial view, sprinters on a track
  cardioFloor:   '1571902943202-507ec2618e8f', // treadmills and benches, empty gym
  battleRopes:   '1599058917212-d750089bc07e', // woman with battle ropes
  beachYoga:     '1545205597-3d9d02c29597',   // tree pose on a beach
  downwardDog:   '1599901860904-17e6ed7083a0', // downward dog, black-and-white
  floorStretch:  '1593810450967-f9c42742e326', // seated wide-leg forward fold
  bandStretch:   '1517637382994-f02da38c6728', // resistance-band shoulder stretch
  yogaMats:      '1601925260368-ae2f83cf8b7f', // rolled yoga mats on a shelf
} as const;

const CATEGORY_PHOTOS: Record<string, string[]> = {
  Cardio:      [P.trailRun, P.trackSprint, P.cardioFloor],
  HIIT:        [P.battleRopes, P.floorClass],
  Yoga:        [P.beachYoga, P.downwardDog],
  Flexibility: [P.floorStretch, P.bandStretch],
  Recovery:    [P.yogaMats, P.floorStretch],
};

// Strength is 80 of the 137 exercises, so it is split by PRIMARY muscle (the
// first listed) — a curl should not wear a squat photo.
const STRENGTH_BY_MUSCLE: Record<string, string[]> = {
  Core: [P.crunch, P.floorClass], Abs: [P.crunch], Obliques: [P.crunch],
  Legs: [P.backSquat, P.backSquatBW], Quads: [P.backSquat, P.backSquatBW],
  Glutes: [P.floorClass, P.backSquat], Hamstrings: [P.deadliftSetup],
  Calves: [P.backSquatBW], Hips: [P.floorClass], 'Hip Flexors': [P.floorClass],
  Back: [P.deadliftSetup, P.deadliftDark], Lats: [P.deadliftDark],
  'Lower Back': [P.deadliftSetup], Rhomboids: [P.deadliftDark], Traps: [P.deadliftDark],
  Arms: [P.curl], Biceps: [P.curl], Triceps: [P.curl, P.dumbbellRack], Forearms: [P.curl],
  Chest: [P.dumbbellRack], Pecs: [P.dumbbellRack],
  Shoulders: [P.overheadPress], Shoulder: [P.overheadPress], Delts: [P.overheadPress],
  'Full Body': [P.deadliftDark, P.battleRopes],
};
const STRENGTH_DEFAULT = [P.dumbbellRack, P.deadliftSetup, P.overheadPress];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const exercisePhotoId = (
  exercise: Pick<Exercise, 'id' | 'name' | 'category' | 'muscleGroups'>,
): string => {
  const pool =
    CATEGORY_PHOTOS[exercise.category] ||
    STRENGTH_BY_MUSCLE[exercise.muscleGroups?.[0] ?? ''] ||
    STRENGTH_DEFAULT;
  // Same exercise -> same photo every session (no flicker).
  return pool[hash(`${exercise.id || ''}${exercise.name || ''}`) % pool.length];
};

export const getExerciseImage = (
  exercise: Pick<Exercise, 'id' | 'name' | 'category' | 'muscleGroups'>,
  w = 800,
): string =>
  `https://images.unsplash.com/photo-${exercisePhotoId(exercise)}?w=${w}&q=80&auto=format&fit=crop`;

/** Every photo the picker can return — for the proof harness. */
export const ALL_EXERCISE_PHOTO_IDS: string[] = Object.values(P);
