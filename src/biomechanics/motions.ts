/**
 * Authored motion clips.
 *
 * Every keyframe below was solved against the rig in `rig.ts` rather than eyeballed:
 * the squat bottom puts the bar over the mid-foot, the deadlift start puts the
 * hands at plate height (0.225 m), and the bench clip grounds the feet through
 * the analytic tibia IK. `scripts/biomechanics-proof.mjs` asserts all of it.
 */

import { MUSCLE_COUNT, MUSCLE_INDEX } from './types';
import type {
  ActivationMap,
  EquipmentId,
  EquipmentOption,
  MotionClip,
  MovementPhase,
  MuscleId,
  PoseKeyframe,
} from './types';

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export const EQUIPMENT: Readonly<Record<EquipmentId, EquipmentOption>> = {
  barbell: { id: 'barbell', label: 'Barbell', gripHalfWidth: 0.42, showPlates: true },
  dumbbell: { id: 'dumbbell', label: 'Dumbbells', gripHalfWidth: 0.26, showPlates: false },
  cable: { id: 'cable', label: 'Cable', gripHalfWidth: 0.22, showPlates: false },
  bodyweight: { id: 'bodyweight', label: 'Bodyweight', gripHalfWidth: 0.2, showPlates: false },
};

export const EQUIPMENT_ORDER: EquipmentId[] = ['barbell', 'dumbbell', 'cable', 'bodyweight'];

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const kf = (
  t: number,
  trunkDeg: number,
  femurDeg: number,
  tibiaDeg: number,
  shoulderFlexDeg: number,
  shoulderAbdDeg: number,
  elbowDeg: number,
  activation: ActivationMap,
  shoulderRotDeg = 0,
): PoseKeyframe => ({
  t,
  trunkDeg,
  femurDeg,
  tibiaDeg,
  shoulderFlexDeg,
  shoulderAbdDeg,
  elbowDeg,
  shoulderRotDeg,
  activation,
});

const BACK_SQUAT: MotionClip = {
  id: 'squats',
  name: 'Back Squat',
  posture: 'standing',
  barAnchor: 'traps',
  armsFollowGravity: false,
  equipment: ['barbell', 'dumbbell', 'bodyweight'],
  primary: ['quads', 'glutes'],
  secondary: ['hamstrings', 'erectors', 'abs', 'calves', 'traps'],
  phases: [
    { phase: 'eccentric', start: 0, end: 0.46 },
    { phase: 'isometric', start: 0.46, end: 0.56 },
    { phase: 'concentric', start: 0.56, end: 0.94 },
    { phase: 'lockout', start: 0.94, end: 1 },
  ],
  cues: {
    eccentric: 'Break at the hips and knees together. Control the descent — 2 to 3 seconds.',
    isometric: 'Hip crease below the knee. Stay braced; no bouncing out of the hole.',
    concentric: 'Drive the floor away. Hips and chest rise at the same rate.',
    lockout: 'Stand tall, glutes squeezed, ribs down. Do not hyperextend.',
  },
  keyframes: [
    kf(0.0, 6, 2, 2, -40, 27, 113, { quads: 0.25, glutes: 0.22, erectors: 0.32, abs: 0.26, calves: 0.2, traps: 0.34, hamstrings: 0.16 }),
    kf(0.16, 17, 26, -5, -40, 27, 113, { quads: 0.45, glutes: 0.4, erectors: 0.48, abs: 0.36, calves: 0.24, traps: 0.34, hamstrings: 0.3 }),
    kf(0.33, 32, 58, -13, -40, 27, 113, { quads: 0.68, glutes: 0.62, erectors: 0.62, abs: 0.46, calves: 0.3, traps: 0.34, hamstrings: 0.42 }),
    kf(0.5, 45, 90, -20, -40, 27, 113, { quads: 0.86, glutes: 0.82, erectors: 0.76, abs: 0.56, calves: 0.36, traps: 0.36, hamstrings: 0.5 }),
    kf(0.64, 40, 70, -16, -40, 27, 113, { quads: 1.0, glutes: 0.96, erectors: 0.82, abs: 0.54, calves: 0.46, traps: 0.36, hamstrings: 0.56 }),
    kf(0.82, 22, 34, -8, -40, 27, 113, { quads: 0.74, glutes: 0.72, erectors: 0.6, abs: 0.42, calves: 0.36, traps: 0.34, hamstrings: 0.4 }),
    kf(1.0, 6, 2, 2, -40, 27, 113, { quads: 0.28, glutes: 0.34, erectors: 0.34, abs: 0.3, calves: 0.24, traps: 0.34, hamstrings: 0.2 }),
  ],
};

const BENCH_PRESS: MotionClip = {
  id: 'bench_press',
  name: 'Bench Press',
  posture: 'supine',
  barAnchor: 'wrists',
  armsFollowGravity: false,
  equipment: ['barbell', 'dumbbell', 'cable'],
  supinePelvisY: 0.55,
  primary: ['pecs', 'triceps'],
  // Quads belong here: leg drive is a real contributor on a braced bench, and
  // the heatmap shades them, so the legend has to declare them too.
  secondary: ['delt_front', 'lats', 'biceps', 'abs', 'glutes', 'quads'],
  phases: [
    { phase: 'eccentric', start: 0, end: 0.46 },
    { phase: 'isometric', start: 0.46, end: 0.55 },
    { phase: 'concentric', start: 0.55, end: 0.94 },
    { phase: 'lockout', start: 0.94, end: 1 },
  ],
  cues: {
    eccentric: 'Elbows tucked near 45 degrees. Bar tracks to the lower chest.',
    isometric: 'Touch, do not sink. Stay tight through the upper back.',
    concentric: 'Press back and up in a slight arc toward the shoulders.',
    lockout: 'Elbows locked, shoulder blades still retracted.',
  },
  keyframes: [
    kf(0.0, -86, 52, -40, 94, 20, 4, { pecs: 0.52, triceps: 0.86, delt_front: 0.46, abs: 0.3, glutes: 0.28, quads: 0.24 }),
    kf(0.22, -86, 52, -40, 55, 34, 60, { pecs: 0.66, triceps: 0.6, delt_front: 0.6, lats: 0.24, abs: 0.32, glutes: 0.28, quads: 0.24 }),
    kf(0.46, -86, 52, -40, -22, 44, 109, { pecs: 0.9, triceps: 0.46, delt_front: 0.8, lats: 0.36, biceps: 0.2, abs: 0.36, glutes: 0.3, quads: 0.26 }),
    kf(0.55, -86, 52, -40, -23, 45, 110, { pecs: 0.94, triceps: 0.5, delt_front: 0.82, lats: 0.38, biceps: 0.22, abs: 0.38, glutes: 0.3, quads: 0.26 }),
    kf(0.74, -86, 52, -40, 55, 34, 60, { pecs: 1.0, triceps: 0.78, delt_front: 0.86, lats: 0.3, abs: 0.36, glutes: 0.3, quads: 0.26 }),
    kf(1.0, -86, 52, -40, 94, 20, 4, { pecs: 0.56, triceps: 0.9, delt_front: 0.5, abs: 0.3, glutes: 0.28, quads: 0.24 }),
  ],
};

const DEADLIFT: MotionClip = {
  id: 'deadlift',
  name: 'Deadlift',
  posture: 'standing',
  barAnchor: 'wrists',
  armsFollowGravity: true,
  equipment: ['barbell', 'dumbbell'],
  primary: ['erectors', 'glutes', 'hamstrings'],
  secondary: ['quads', 'lats', 'traps', 'forearms', 'abs'],
  // A deadlift starts from the floor, so the concentric comes first.
  phases: [
    { phase: 'concentric', start: 0, end: 0.5 },
    { phase: 'lockout', start: 0.5, end: 0.6 },
    { phase: 'eccentric', start: 0.6, end: 0.96 },
    { phase: 'isometric', start: 0.96, end: 1 },
  ],
  cues: {
    concentric: 'Push the floor away, then snap the hips through. Bar stays against the legs.',
    lockout: 'Stand tall with the glutes. No lean back, no shrug.',
    eccentric: 'Hips back first, bar past the knees, then bend the knees.',
    isometric: 'Reset on the floor. Take the slack out before the next rep.',
  },
  keyframes: [
    kf(0.0, 73, 67, -24, 0, 4, 3, { erectors: 0.8, hamstrings: 0.76, glutes: 0.7, quads: 0.6, lats: 0.6, traps: 0.55, forearms: 0.8, abs: 0.5 }),
    kf(0.18, 68, 48, -16, 0, 4, 3, { erectors: 0.95, hamstrings: 0.88, glutes: 0.86, quads: 0.5, lats: 0.66, traps: 0.6, forearms: 0.85, abs: 0.54 }),
    kf(0.35, 50, 26, -8, 0, 4, 3, { erectors: 1.0, hamstrings: 0.9, glutes: 0.95, quads: 0.36, lats: 0.62, traps: 0.62, forearms: 0.85, abs: 0.52 }),
    kf(0.5, 5, 1, 2, 0, 4, 3, { erectors: 0.62, hamstrings: 0.5, glutes: 0.8, quads: 0.2, lats: 0.5, traps: 0.7, forearms: 0.8, abs: 0.44 }),
    kf(0.6, 5, 1, 2, 0, 4, 3, { erectors: 0.6, hamstrings: 0.48, glutes: 0.78, quads: 0.2, lats: 0.5, traps: 0.7, forearms: 0.8, abs: 0.44 }),
    kf(0.78, 45, 20, -6, 0, 4, 3, { erectors: 0.85, hamstrings: 0.82, glutes: 0.66, quads: 0.26, lats: 0.55, traps: 0.6, forearms: 0.82, abs: 0.5 }),
    kf(1.0, 73, 67, -24, 0, 4, 3, { erectors: 0.7, hamstrings: 0.66, glutes: 0.5, quads: 0.44, lats: 0.5, traps: 0.5, forearms: 0.75, abs: 0.45 }),
  ],
};

const OVERHEAD_PRESS: MotionClip = {
  id: 'shoulder_press',
  name: 'Overhead Press',
  posture: 'standing',
  barAnchor: 'wrists',
  armsFollowGravity: false,
  equipment: ['barbell', 'dumbbell'],
  primary: ['delt_front', 'delt_side', 'triceps'],
  secondary: ['traps', 'abs', 'erectors', 'glutes'],
  phases: [
    { phase: 'concentric', start: 0, end: 0.46 },
    { phase: 'lockout', start: 0.46, end: 0.56 },
    { phase: 'eccentric', start: 0.56, end: 0.94 },
    { phase: 'isometric', start: 0.94, end: 1 },
  ],
  cues: {
    concentric: 'Move the head back, press through, then push the head forward under the bar.',
    lockout: 'Bar over the mid-foot, biceps by the ears, glutes and abs tight.',
    eccentric: 'Lower under control to the front rack. Elbows stay under the bar.',
    isometric: 'Rack position: bar on the front delts, forearms vertical.',
  },
  keyframes: [
    kf(0.0, 4, 1, 2, 73, 27, 138, { delt_front: 0.55, delt_side: 0.5, triceps: 0.3, traps: 0.4, abs: 0.4, erectors: 0.4, glutes: 0.3 }, 150),
    kf(0.2, 3, 1, 2, 100, 26, 100, { delt_front: 0.92, delt_side: 0.8, triceps: 0.52, traps: 0.55, abs: 0.5, erectors: 0.48, glutes: 0.36 }, 120),
    kf(0.34, 2, 1, 2, 130, 22, 55, { delt_front: 1.0, delt_side: 0.88, triceps: 0.72, traps: 0.66, abs: 0.5, erectors: 0.46, glutes: 0.36 }, 70),
    kf(0.46, 1, 0, 2, 172, 18, 5, { delt_front: 0.7, delt_side: 0.62, triceps: 0.9, traps: 0.78, abs: 0.44, erectors: 0.42, glutes: 0.34 }, 20),
    kf(0.56, 1, 0, 2, 172, 18, 5, { delt_front: 0.66, delt_side: 0.58, triceps: 0.92, traps: 0.8, abs: 0.42, erectors: 0.4, glutes: 0.34 }, 20),
    kf(0.76, 3, 1, 2, 120, 24, 70, { delt_front: 0.82, delt_side: 0.74, triceps: 0.6, traps: 0.6, abs: 0.46, erectors: 0.44, glutes: 0.34 }, 90),
    kf(1.0, 4, 1, 2, 73, 27, 138, { delt_front: 0.58, delt_side: 0.52, triceps: 0.32, traps: 0.42, abs: 0.4, erectors: 0.4, glutes: 0.3 }, 150),
  ],
};

const BARBELL_ROW: MotionClip = {
  id: 'cable_row',
  name: 'Barbell Row',
  posture: 'standing',
  barAnchor: 'wrists',
  armsFollowGravity: false,
  equipment: ['barbell', 'dumbbell', 'cable'],
  primary: ['lats', 'traps', 'delt_rear'],
  secondary: ['biceps', 'forearms', 'erectors', 'hamstrings', 'glutes'],
  phases: [
    { phase: 'concentric', start: 0, end: 0.46 },
    { phase: 'isometric', start: 0.46, end: 0.56 },
    { phase: 'eccentric', start: 0.56, end: 0.94 },
    { phase: 'lockout', start: 0.94, end: 1 },
  ],
  cues: {
    concentric: 'Lead with the elbows, pull the bar to the lower ribs.',
    isometric: 'Squeeze the shoulder blades together for a beat.',
    eccentric: 'Let the bar travel out under control; keep the torso angle fixed.',
    lockout: 'Arms long, lats still loaded. Torso does not rise.',
  },
  keyframes: [
    // Trunk is held at 50 degrees throughout; shoulder flexion of 50 in the
    // trunk frame is exactly a vertically hanging arm at that lean.
    kf(0.0, 50, 20, -8, 46, 20, 2, { lats: 0.42, traps: 0.4, delt_rear: 0.3, biceps: 0.28, forearms: 0.7, erectors: 0.6, hamstrings: 0.5, glutes: 0.45 }),
    kf(0.22, 50, 20, -8, -8, 35, 86, { lats: 0.78, traps: 0.7, delt_rear: 0.6, biceps: 0.55, forearms: 0.78, erectors: 0.66, hamstrings: 0.52, glutes: 0.47 }),
    kf(0.46, 50, 20, -8, -67, 27, 128, { lats: 1.0, traps: 0.92, delt_rear: 0.84, biceps: 0.72, forearms: 0.82, erectors: 0.7, hamstrings: 0.54, glutes: 0.5 }),
    kf(0.56, 50, 20, -8, -68, 27, 129, { lats: 0.98, traps: 0.96, delt_rear: 0.88, biceps: 0.74, forearms: 0.82, erectors: 0.7, hamstrings: 0.54, glutes: 0.5 }),
    kf(0.78, 50, 20, -8, -8, 35, 86, { lats: 0.7, traps: 0.62, delt_rear: 0.54, biceps: 0.5, forearms: 0.78, erectors: 0.66, hamstrings: 0.52, glutes: 0.47 }),
    kf(1.0, 50, 20, -8, 46, 20, 2, { lats: 0.45, traps: 0.42, delt_rear: 0.32, biceps: 0.3, forearms: 0.72, erectors: 0.62, hamstrings: 0.5, glutes: 0.45 }),
  ],
};

export const MOTION_CLIPS: MotionClip[] = [BACK_SQUAT, BENCH_PRESS, DEADLIFT, OVERHEAD_PRESS, BARBELL_ROW];

const CLIP_BY_ID = new Map(MOTION_CLIPS.map((c) => [c.id, c]));

export const getClip = (id: string): MotionClip | undefined => CLIP_BY_ID.get(id);

/** Falls back to the squat so the viewport can never be handed `undefined`. */
export const getClipOrDefault = (id: string | null | undefined): MotionClip =>
  (id ? CLIP_BY_ID.get(id) : undefined) ?? BACK_SQUAT;

/**
 * Exercises in `src/data/exerciseLibrary.json` that map onto a 3D clip.
 * Anything not listed here simply has no 3D view, which the UI states plainly
 * instead of rendering an unrelated movement.
 */
export const EXERCISE_TO_CLIP: Readonly<Record<string, string>> = {
  squats: 'squats',
  tabata_squats: 'squats',
  leg_press: 'squats',
  lunges: 'squats',
  bench_press: 'bench_press',
  incline_press: 'bench_press',
  pushups: 'bench_press',
  deadlift: 'deadlift',
  romanian_deadlift: 'deadlift',
  hip_thrust: 'deadlift',
  kettlebell_swings: 'deadlift',
  shoulder_press: 'shoulder_press',
  cable_row: 'cable_row',
  lat_pulldown: 'cable_row',
  face_pulls: 'cable_row',
  pullups: 'cable_row',
};

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Smoothstep easing between keyframes — real lifts do not move linearly. */
const ease = (u: number): number => u * u * (3 - 2 * u);

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export interface SampledPose extends PoseKeyframe {
  phase: MovementPhase;
}

/**
 * Interpolate a clip at normalised time `t`.
 *
 * `activationOut` is an optional caller-owned buffer; passing one makes the
 * whole call allocation-free, which matters because the render loop samples
 * every frame.
 */
export const sampleClip = (
  clip: MotionClip,
  t: number,
  activationOut?: Float32Array,
): { pose: SampledPose; activation: Float32Array } => {
  const time = clamp01(t);
  const frames = clip.keyframes;

  let i = 0;
  // Linear scan: clips hold at most a handful of keyframes, so this beats a
  // binary search and keeps the hot path branch-predictable.
  while (i < frames.length - 2 && frames[i + 1].t <= time) i++;

  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const span = b.t - a.t;
  const u = span <= 1e-9 ? 0 : ease(clamp01((time - a.t) / span));

  const activation = activationOut && activationOut.length === MUSCLE_COUNT ? activationOut : new Float32Array(MUSCLE_COUNT);
  for (let m = 0; m < MUSCLE_COUNT; m++) activation[m] = 0;

  const fold = (map: ActivationMap, weight: number) => {
    for (const key of Object.keys(map) as MuscleId[]) {
      const idx = MUSCLE_INDEX[key];
      if (idx === undefined) continue;
      activation[idx] += (map[key] ?? 0) * weight;
    }
  };
  fold(a.activation, 1 - u);
  fold(b.activation, u);

  const pose: SampledPose = {
    t: time,
    trunkDeg: lerp(a.trunkDeg, b.trunkDeg, u),
    femurDeg: lerp(a.femurDeg, b.femurDeg, u),
    tibiaDeg: lerp(a.tibiaDeg, b.tibiaDeg, u),
    shoulderFlexDeg: lerp(a.shoulderFlexDeg, b.shoulderFlexDeg, u),
    shoulderAbdDeg: lerp(a.shoulderAbdDeg, b.shoulderAbdDeg, u),
    elbowDeg: lerp(a.elbowDeg, b.elbowDeg, u),
    activation: {},
    phase: phaseAt(clip, time),
  };

  return { pose, activation };
};

/** Which phase the timeline position `t` falls in. */
export const phaseAt = (clip: MotionClip, t: number): MovementPhase => {
  const time = clamp01(t);
  for (const span of clip.phases) {
    if (time >= span.start && time < span.end) return span.phase;
  }
  return clip.phases[clip.phases.length - 1].phase;
};

/** Start of the phase containing `t` — powers "snap to phase" scrubbing. */
export const phaseSpanAt = (clip: MotionClip, t: number) => {
  const time = clamp01(t);
  for (const span of clip.phases) {
    if (time >= span.start && time < span.end) return span;
  }
  return clip.phases[clip.phases.length - 1];
};

/** Ordered, de-duplicated list of muscles this clip actually recruits. */
export const recruitedMuscles = (clip: MotionClip): MuscleId[] => [
  ...clip.primary,
  ...clip.secondary.filter((m) => !clip.primary.includes(m)),
];

/** Peak activation reached by each muscle anywhere in the clip. */
export const peakActivation = (clip: MotionClip): Float32Array => {
  const peak = new Float32Array(MUSCLE_COUNT);
  for (const frame of clip.keyframes) {
    for (const key of Object.keys(frame.activation) as MuscleId[]) {
      const idx = MUSCLE_INDEX[key];
      const value = frame.activation[key] ?? 0;
      if (value > peak[idx]) peak[idx] = value;
    }
  }
  return peak;
};
