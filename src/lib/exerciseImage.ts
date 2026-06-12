import { Exercise } from '../types';

// Curated Unsplash photo IDs grouped by training style. All are
// long-running editorial photos that have been stable for years.
// Hashing the exercise name/id to a specific photo means the same
// exercise always shows the same image (no flicker across sessions).
const PHOTOS: Record<string, string[]> = {
  Strength: [
    '1571019613454-1cb2f99b2d8b', // barbell deadlift
    '1581009146145-b5ef050c2e1e', // gym deadlift
    '1534438327276-14e5300c3a48', // bench press
    '1599058917212-d750089bc07e', // ropes
    '1517963879433-6ad2b056fb20', // intense gym
    '1583500178690-f7fd39c2acc2', // squat rack
    '1541534741688-6078c6bfb5c5', // dumbbells
    '1574680096145-d05b474e2155', // gym setup
  ],
  Cardio: [
    '1486218119243-13883505764c', // treadmill
    '1571902943202-507ec2618e8f', // outdoor run
    '1502904550040-7534597429ae', // sprint
    '1517637382994-f02da38c6728', // cyclist
    '1518611012118-696072aa579a', // street run
  ],
  HIIT: [
    '1517836357463-d25dfeac3438', // HIIT box jump
    '1599058917212-d750089bc07e', // battle ropes
    '1517963879433-6ad2b056fb20', // sweat
    '1605296867304-46d5465a13f1', // kettlebell swing
  ],
  Yoga: [
    '1545205597-3d9d02c29597', // yoga mat
    '1593810450967-f9c42742e326', // yoga pose
    '1599901860904-17e6ed7083a0', // meditation
    '1506905925346-21bda4d32df4', // sun salutation
  ],
  Flexibility: [
    '1599447331798-1a6dc6c6f15c', // standing stretch
    '1506629905527-5e8c5e9c0e7a', // floor stretch
    '1574680178050-55c6a6a96e0a', // dynamic stretch
  ],
  Recovery: [
    '1506629905270-3ab26ad5b69d', // foam roller
    '1601925260368-ae2f83cf8b7f', // ice bath
    '1599058917212-d750089bc07e', // recovery
  ],
};

// Per–muscle group images, used when category mapping isn't tight enough.
const MUSCLE_PHOTOS: Record<string, string> = {
  Chest:     '1534438327276-14e5300c3a48',
  Back:      '1581009146145-b5ef050c2e1e',
  Legs:      '1583500178690-f7fd39c2acc2',
  Quads:     '1583500178690-f7fd39c2acc2',
  Hamstrings:'1581009146145-b5ef050c2e1e',
  Glutes:    '1571019613454-1cb2f99b2d8b',
  Shoulders: '1571019613454-1cb2f99b2d8b',
  Arms:      '1541534741688-6078c6bfb5c5',
  Biceps:    '1541534741688-6078c6bfb5c5',
  Triceps:   '1534438327276-14e5300c3a48',
  Core:      '1517836357463-d25dfeac3438',
  Abs:       '1517836357463-d25dfeac3438',
  'Full Body': '1599058917212-d750089bc07e',
};

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const photoUrl = (id: string, w = 800) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

/**
 * Deterministic, network-stable fallback image for an exercise.
 * - First tries the exercise's category bucket.
 * - Falls back to its primary muscle group.
 * - Falls back to a generic strength photo.
 */
export const getExerciseImage = (exercise: Pick<Exercise, 'id' | 'name' | 'category' | 'muscleGroups'>, w = 800): string => {
  const seed = `${exercise.id || ''}${exercise.name || ''}`;
  const bucket = PHOTOS[exercise.category] || PHOTOS.Strength;
  if (bucket && bucket.length > 0) {
    const idx = hash(seed) % bucket.length;
    return photoUrl(bucket[idx], w);
  }
  const muscle = exercise.muscleGroups?.find(m => MUSCLE_PHOTOS[m]);
  if (muscle) return photoUrl(MUSCLE_PHOTOS[muscle], w);
  return photoUrl('1571019613454-1cb2f99b2d8b', w);
};
