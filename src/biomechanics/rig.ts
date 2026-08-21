/**
 * Forward-kinematics solver for the anatomical avatar.
 *
 * Coordinate system: metres, Y-up, +Z is the direction the athlete faces,
 * +X is the athlete's right. The floor is y = 0.
 *
 * Two frames are in play, deliberately:
 *   - Legs are solved in the WORLD frame, because the floor and gravity define
 *     where a femur and a tibia can point.
 *   - Arms are solved in the TRUNK frame, because shoulder flexion/abduction
 *     are anatomically defined relative to the torso, not the room.
 *
 * The solver is allocation-free per call apart from the returned skeleton: all
 * intermediate vector maths runs on scratch scalars, so it is safe to call at
 * 60 Hz from a requestAnimationFrame loop.
 */

import type { JointAngles, PoseKeyframe, Posture, Skeleton, Vec3 } from './types';

// ---------------------------------------------------------------------------
// Proportions — a 1.78 m athlete, anthropometrically plausible segment lengths.
// ---------------------------------------------------------------------------

export const RIG = {
  ankleHeight: 0.09,
  footLength: 0.19,
  shank: 0.43,
  thigh: 0.44,
  /** Half the distance between the hip joints. */
  hipHalfWidth: 0.09,
  /** Pelvis centre to the mid-point between the shoulders. */
  torso: 0.52,
  /** Half the distance between the shoulder joints. */
  shoulderHalfWidth: 0.2,
  neck: 0.1,
  headRadius: 0.115,
  upperArm: 0.31,
  forearm: 0.27,
  hand: 0.09,
} as const;

/** Standing hip height with straight legs — used for grounding sanity checks. */
export const STANDING_HIP_HEIGHT = RIG.ankleHeight + RIG.shank + RIG.thigh;

/** Bench pad height for supine clips. */
export const BENCH_HEIGHT = 0.45;

/**
 * Grip width is expressed as a shoulder-abduction bias, because that is how a
 * lifter actually widens a grip. The barbell half-grip (0.42 m) is the
 * authoring reference and therefore biases by zero; narrower implements pull
 * the arms back toward the midline.
 */
const GRIP_REFERENCE_HALF_WIDTH = 0.42;
const GRIP_ABDUCTION_GAIN = 60;

const DEG = Math.PI / 180;

/** Coerce any incoming number to a finite one. The solver must be total. */
const safeNumber = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad / DEG;

// ---------------------------------------------------------------------------
// Small vector helpers. Kept local and monomorphic so V8 keeps them inlined.
// ---------------------------------------------------------------------------

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);

const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);

const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  // A zero-length direction can only come from a degenerate authored pose;
  // falling back to "down" keeps the chain finite instead of emitting NaN.
  if (l < 1e-9) return v3(0, -1, 0);
  return v3(a.x / l, a.y / l, a.z / l);
};

/** Rodrigues rotation of `v` about the unit axis `axis` by `rad`. */
const rotateAbout = (v: Vec3, axis: Vec3, rad: number): Vec3 => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return v3(v.x * c + k.x * s + axis.x * d, v.y * c + k.y * s + axis.y * d, v.z * c + k.z * s + axis.z * d);
};

/**
 * Unit direction for a segment traversed distally, given its inclination from
 * straight-down, positive rotating toward +Z (forward).
 */
const dirFromDown = (deg: number): Vec3 => {
  const r = toRad(deg);
  return v3(0, -Math.cos(r), Math.sin(r));
};

/** Angle at `b` in the chain a-b-c, in degrees, 0..180. */
export const angleBetween = (a: Vec3, b: Vec3, c: Vec3): number => {
  const u = normalize(sub(a, b));
  const w = normalize(sub(c, b));
  const d = Math.min(1, Math.max(-1, dot(u, w)));
  return toDeg(Math.acos(d));
};

// ---------------------------------------------------------------------------
// Trunk frame
// ---------------------------------------------------------------------------

export interface TrunkFrame {
  /** Pelvis to chest, unit. */
  up: Vec3;
  /** Out of the chest, unit, perpendicular to `up` in the sagittal plane. */
  forward: Vec3;
  /** The athlete's right, unit. */
  right: Vec3;
}

/**
 * Build the trunk frame for a forward lean of `trunkDeg` from vertical.
 * At 0 degrees this is the identity-ish frame (up = +Y, forward = +Z).
 */
export const trunkFrame = (trunkDeg: number): TrunkFrame => {
  const r = toRad(trunkDeg);
  const up = v3(0, Math.cos(r), Math.sin(r));
  const forward = v3(0, -Math.sin(r), Math.cos(r));
  // right = up x forward. At trunkDeg 0 that is (+1, 0, 0) — the athlete's
  // right hand. Taking the cross the other way round silently mirrors the
  // shoulder rotations, which is invisible on symmetric lifts and very visible
  // on everything else, so the order matters.
  const right = cross(up, forward);
  return { up, forward, right };
};

/**
 * Humerus direction for a shoulder flexion/abduction pair expressed in the
 * trunk frame. `side` is +1 for the right arm, -1 for the left.
 *
 * Order of operations: start pointing down the body, abduct out to the side
 * about the chest normal, then flex forward about the trunk's right axis.
 */
export const humerusDirection = (
  frame: TrunkFrame,
  flexDeg: number,
  abdDeg: number,
  side: 1 | -1,
): Vec3 => {
  const down = scale(frame.up, -1);
  // Abduction swings the arm away from the midline (+X for the right arm);
  // flexion then carries it toward the chest normal, hence the negative angle
  // about the right axis.
  const abducted = rotateAbout(down, frame.forward, side * toRad(abdDeg));
  return normalize(rotateAbout(abducted, frame.right, -toRad(flexDeg)));
};

/**
 * Forearm direction: rotate the humerus direction about the elbow's flexion
 * axis so the hand travels toward the front of the body.
 */
export const forearmDirection = (
  humerus: Vec3,
  frame: TrunkFrame,
  elbowDeg: number,
  rotationDeg = 0,
): Vec3 => {
  let axis = cross(humerus, frame.forward);
  // When the humerus is parallel to the chest normal (arm pointing straight out
  // of the chest) the cross product collapses; the trunk's right axis is the
  // correct flexion axis in that configuration.
  if (length(axis) < 1e-6) axis = frame.right;
  axis = normalize(axis);
  // Internal/external rotation of the humerus swings the whole elbow-flexion
  // plane around the upper-arm axis. Without this fourth degree of freedom a
  // front rack is geometrically unreachable — the forearms can never come
  // vertical under the bar — so it is not optional detail.
  if (rotationDeg !== 0) axis = normalize(rotateAbout(axis, humerus, toRad(rotationDeg)));
  return normalize(rotateAbout(humerus, axis, toRad(elbowDeg)));
};

// ---------------------------------------------------------------------------
// Leg grounding
// ---------------------------------------------------------------------------

/**
 * Solve the tibia inclination that puts the ankle exactly on the floor for a
 * given knee height. Used by supine clips, where the pelvis is pinned to the
 * bench and the feet must still reach the ground.
 *
 * Returns `null` when the floor is out of reach, so callers can fall back to
 * the authored angle rather than silently rendering a broken leg.
 */
export const solveTibiaForFloor = (kneeY: number, kneeIsForwardOfAnkle: boolean): number | null => {
  const drop = kneeY - RIG.ankleHeight;
  if (drop <= 0 || drop > RIG.shank) return null;
  const cos = drop / RIG.shank;
  const deg = toDeg(Math.acos(Math.min(1, Math.max(-1, cos))));
  return kneeIsForwardOfAnkle ? -deg : deg;
};

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

export interface SolveOptions {
  posture: Posture;
  /** Pelvis height for supine clips. Ignored when standing. */
  supinePelvisY?: number;
  /** Forces the humerus to hang vertically in world space. */
  armsFollowGravity?: boolean;
  /** Half the distance between the hands, metres — set by the equipment picker. */
  gripHalfWidth?: number;
}

/**
 * Solve a full skeleton from one pose.
 *
 * Standing poses are grounded by translating the whole figure so the ankles sit
 * at `RIG.ankleHeight`; supine poses pin the pelvis to the bench and run a
 * one-shot analytic IK on the tibia so the feet still reach the floor.
 */
export const solvePose = (pose: PoseKeyframe, opts: SolveOptions): Skeleton => {
  // Every numeric input is sanitised at the door. Poses arrive from authored
  // data, from React props and from a scrub position the user drags, and a
  // single NaN anywhere in that chain would otherwise propagate silently into
  // the vertex buffers and render an invisible avatar with no error at all.
  const trunkDeg = safeNumber(pose.trunkDeg, 0);
  const femurDeg = safeNumber(pose.femurDeg, 0);
  const authoredTibiaDeg = safeNumber(pose.tibiaDeg, 0);
  const shoulderFlexDeg = safeNumber(pose.shoulderFlexDeg, 0);
  const shoulderAbdDeg = safeNumber(pose.shoulderAbdDeg, 0);
  const elbowDeg = safeNumber(pose.elbowDeg, 0);
  const shoulderRotDeg = safeNumber(pose.shoulderRotDeg, 0);

  const supine = opts.posture === 'supine';
  // Supine clips author trunkDeg as the lean from vertical exactly like
  // standing ones (a bench press sits at 84-90), so the frame needs no
  // special-casing — only the grounding rule below differs.
  const trunk = trunkFrame(trunkDeg);

  // --- Pelvis (provisional; standing poses are grounded afterwards) ---------
  const pelvis0 = v3(0, supine ? safeNumber(opts.supinePelvisY, BENCH_HEIGHT + 0.1) : 0, 0);

  // --- Legs (world frame) ---------------------------------------------------
  const femurDir = dirFromDown(femurDeg);
  let tibiaDeg = authoredTibiaDeg;

  const hipL0 = add(pelvis0, v3(-RIG.hipHalfWidth, 0, 0));
  const kneeProbe = add(hipL0, scale(femurDir, RIG.thigh));

  if (supine) {
    const solved = solveTibiaForFloor(kneeProbe.y, femurDeg >= 0);
    if (solved !== null) tibiaDeg = solved;
  }

  const tibiaDir = dirFromDown(tibiaDeg);

  const legFor = (side: 1 | -1) => {
    const hip = add(pelvis0, v3(side * RIG.hipHalfWidth, 0, 0));
    const knee = add(hip, scale(femurDir, RIG.thigh));
    const ankle = add(knee, scale(tibiaDir, RIG.shank));
    const toe = add(ankle, v3(0, -RIG.ankleHeight * 0.4, RIG.footLength));
    return { hip, knee, ankle, toe };
  };

  const legL = legFor(-1);
  const legR = legFor(1);

  // --- Torso, head ----------------------------------------------------------
  const chest = add(pelvis0, scale(trunk.up, RIG.torso));
  const neck = add(chest, scale(trunk.up, RIG.neck * 0.5));
  const head = add(neck, scale(trunk.up, RIG.neck * 0.5 + RIG.headRadius));

  // --- Arms -----------------------------------------------------------------
  const gripHalf = safeNumber(opts.gripHalfWidth, RIG.shoulderHalfWidth);
  // A wider grip is not a sideways teleport of the hands — it is achieved by
  // abducting the shoulder. Converting grip width into an abduction bias keeps
  // the arm chain anatomically intact instead of stretching the forearm.
  const abdBias = opts.armsFollowGravity
    ? 0
    : Math.max(-14, Math.min(8, (gripHalf - GRIP_REFERENCE_HALF_WIDTH) * GRIP_ABDUCTION_GAIN));

  const armFor = (side: 1 | -1) => {
    const shoulder = add(chest, scale(trunk.right, side * RIG.shoulderHalfWidth));
    const humerus = opts.armsFollowGravity
      ? v3(0, -1, 0)
      : humerusDirection(trunk, shoulderFlexDeg, shoulderAbdDeg + abdBias, side);
    const elbow = add(shoulder, scale(humerus, RIG.upperArm));
    const forearm = forearmDirection(humerus, trunk, elbowDeg, shoulderRotDeg);
    const wrist = add(elbow, scale(forearm, RIG.forearm));
    const hand = add(wrist, scale(forearm, RIG.hand));
    return { shoulder, elbow, wrist, hand };
  };

  const armL = armFor(-1);
  const armR = armFor(1);

  const skeleton: Skeleton = {
    pelvis: pelvis0,
    chest,
    neck,
    head,
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    wristL: armL.wrist,
    wristR: armR.wrist,
    handL: armL.hand,
    handR: armR.hand,
    hipL: legL.hip,
    hipR: legR.hip,
    kneeL: legL.knee,
    kneeR: legR.knee,
    ankleL: legL.ankle,
    ankleR: legR.ankle,
    toeL: legL.toe,
    toeR: legR.toe,
  };

  // --- Grounding ------------------------------------------------------------
  if (!supine) {
    const lowest = Math.min(skeleton.ankleL.y, skeleton.ankleR.y);
    const lift = Number.isFinite(lowest) ? RIG.ankleHeight - lowest : 0;
    if (Math.abs(lift) > 1e-6) {
      for (const key of Object.keys(skeleton) as (keyof Skeleton)[]) {
        skeleton[key] = v3(skeleton[key].x, skeleton[key].y + lift, skeleton[key].z);
      }
    }
  }

  return skeleton;
};

// ---------------------------------------------------------------------------
// Derived readouts
// ---------------------------------------------------------------------------

/**
 * Anatomical joint angles read straight off the solved skeleton, so the numbers
 * on screen can never drift from the geometry being rendered.
 *
 * Hip, knee and elbow are reported as flexion (0 = fully extended), which is
 * how a coach reads them; ankle is dorsiflexion from neutral; trunk is the
 * lean from vertical.
 */
export const readJointAngles = (s: Skeleton): JointAngles => {
  const hipInterior = angleBetween(s.chest, s.hipR, s.kneeR);
  const kneeInterior = angleBetween(s.hipR, s.kneeR, s.ankleR);
  const elbowInterior = angleBetween(s.shoulderR, s.elbowR, s.wristR);
  const shoulderInterior = angleBetween(s.pelvis, s.shoulderR, s.elbowR);

  const shankDir = normalize(sub(s.ankleR, s.kneeR));
  // Dorsiflexion: how far the shank leans away from vertical over a flat foot.
  const ankle = toDeg(Math.acos(Math.min(1, Math.max(-1, dot(shankDir, v3(0, -1, 0))))));

  const trunkDir = normalize(sub(s.chest, s.pelvis));
  const trunk = toDeg(Math.acos(Math.min(1, Math.max(-1, dot(trunkDir, v3(0, 1, 0))))));

  return {
    hip: round1(180 - hipInterior),
    knee: round1(180 - kneeInterior),
    ankle: round1(ankle),
    shoulder: round1(180 - shoulderInterior),
    elbow: round1(180 - elbowInterior),
    trunk: round1(trunk),
  };
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Where the implement sits for this pose. Wrist-anchored lifts take the
 * mid-point of the hands; trap-anchored lifts (back squat) ride just behind
 * the neck.
 */
export const barPosition = (s: Skeleton, anchor: 'wrists' | 'traps', trunkDeg: number): Vec3 => {
  if (anchor === 'wrists') {
    return v3((s.wristL.x + s.wristR.x) / 2, (s.wristL.y + s.wristR.y) / 2, (s.wristL.z + s.wristR.z) / 2);
  }
  const frame = trunkFrame(trunkDeg);
  const base = v3((s.shoulderL.x + s.shoulderR.x) / 2, (s.shoulderL.y + s.shoulderR.y) / 2, (s.shoulderL.z + s.shoulderR.z) / 2);
  return add(base, scale(frame.forward, -0.07));
};

export const vecUtils = { v3, add, sub, scale, dot, cross, length, normalize, rotateAbout, dirFromDown };
