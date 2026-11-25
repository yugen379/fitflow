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

import type { ContactId, JointAngles, PoseKeyframe, Posture, Skeleton, Vec3 } from './types';

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

  // --- Generated-clip extras (all optional; absent = legacy behaviour) ----
  /** Carry the elbow flexion axis with the humerus so it never flips at 90 deg of flexion. */
  carriedElbowAxis?: boolean;
  /** Ignore gripHalfWidth — the pose authors its own shoulder abduction. */
  noGripBias?: boolean;
  /** Supine clips: keep the authored tibia instead of IK-ing the feet to the floor. */
  freeLegs?: boolean;
  /** Landmark held at x = z = 0 so feet (or hands) never slide across the floor. */
  anchor?: 'pelvis' | 'feet' | 'hands' | 'footL' | 'footR';
  /** Hanging clips: height of the bar the hands are pinned to. */
  barY?: number;
  /** Floor clips: which body parts may carry weight. Default: all of them. */
  contacts?: ContactId[];
  /** Clamp every authored angle into ROM_LIMITS before solving. */
  enforceRom?: boolean;
}

// ---------------------------------------------------------------------------
// Range of motion
// ---------------------------------------------------------------------------

/**
 * Conservative anatomical range-of-motion limits, degrees, in the BODY frame
 * (i.e. before any whole-body pitch/roll). Generated clips are clamped into
 * these by the solver, and `scripts/exercise-motions-proof.mjs` asserts every
 * authored pose already sits inside them, so a clamp never silently hides a
 * bad keyframe.
 */
export const ROM_LIMITS = {
  /** Hip flexion = femur + trunk lean (sagittal component). Negative is extension. */
  hipFlex: [-35, 150],
  /** Frontal-plane hip abduction (femur angle x |sin(leg yaw)|). */
  hipAbd: [0, 55],
  /** Knee flexion = femur - tibia. Negative is hyperextension. */
  kneeFlex: [-5, 160],
  /** Ankle dorsiflexion = -tibia - foot pitch. Negative is plantarflexion. */
  ankleDorsi: [-75, 45],
  shoulderFlex: [-75, 185],
  shoulderAbd: [-25, 185],
  elbowFlex: [-5, 155],
  trunkTwist: [-60, 60],
  trunkSide: [-45, 45],
  neck: [-50, 60],
} as const;

export type RomKey = keyof typeof ROM_LIMITS;

const clampTo = (v: number, range: readonly [number, number]): number =>
  v < range[0] ? range[0] : v > range[1] ? range[1] : v;

/** Per-side resolved pose values, with every optional override folded in. */
export interface ResolvedSide {
  femur: number;
  tibia: number;
  legYaw: number;
  footPitch: number;
  shoulderFlex: number;
  shoulderAbd: number;
  elbow: number;
}

export const resolveSide = (pose: PoseKeyframe, side: 1 | -1): ResolvedSide => {
  const R = side === 1;
  return {
    femur: safeNumber(R ? pose.femurDegR : pose.femurDegL, safeNumber(pose.femurDeg, 0)),
    tibia: safeNumber(R ? pose.tibiaDegR : pose.tibiaDegL, safeNumber(pose.tibiaDeg, 0)),
    legYaw: safeNumber(R ? pose.legYawDegR : pose.legYawDegL, 0),
    footPitch: safeNumber(R ? pose.footPitchDegR : pose.footPitchDegL, 0),
    shoulderFlex: safeNumber(R ? pose.shoulderFlexDegR : pose.shoulderFlexDegL, safeNumber(pose.shoulderFlexDeg, 0)),
    shoulderAbd: safeNumber(R ? pose.shoulderAbdDegR : pose.shoulderAbdDegL, safeNumber(pose.shoulderAbdDeg, 0)),
    elbow: safeNumber(R ? pose.elbowDegR : pose.elbowDegL, safeNumber(pose.elbowDeg, 0)),
  };
};

/** Anatomical readings of an authored pose, body frame, per side (suffix L/R). */
export const measurePose = (pose: PoseKeyframe): Record<string, number> => {
  const trunk = safeNumber(pose.trunkDeg, 0);
  const out: Record<string, number> = {
    trunkTwist: safeNumber(pose.trunkTwistDeg, 0),
    trunkSide: safeNumber(pose.trunkSideDeg, 0),
    neck: safeNumber(pose.neckDeg, 0),
  };
  for (const side of [-1, 1] as const) {
    const r = resolveSide(pose, side);
    const tag = side === 1 ? 'R' : 'L';
    const yaw = toRad(r.legYaw);
    out[`hipFlex${tag}`] = r.femur * Math.cos(yaw) + trunk;
    out[`hipAbd${tag}`] = Math.abs(r.femur * Math.sin(yaw));
    out[`kneeFlex${tag}`] = r.femur - r.tibia;
    out[`ankleDorsi${tag}`] = -r.tibia - r.footPitch;
    out[`shoulderFlex${tag}`] = r.shoulderFlex;
    out[`shoulderAbd${tag}`] = r.shoulderAbd;
    out[`elbowFlex${tag}`] = r.elbow;
  }
  return out;
};

/** Every ROM violation in a pose, as human-readable strings. Empty = plausible. */
export const romViolations = (pose: PoseKeyframe, tolerance = 0.5): string[] => {
  const m = measurePose(pose);
  const bad: string[] = [];
  for (const key of Object.keys(m)) {
    const value = m[key];
    const base = key.replace(/[LR]$/, '') as RomKey;
    const range = ROM_LIMITS[base];
    if (!range) continue;
    if (!Number.isFinite(value) || value < range[0] - tolerance || value > range[1] + tolerance) {
      bad.push(`${key}=${Number.isFinite(value) ? value.toFixed(1) : String(value)} outside [${range[0]}, ${range[1]}]`);
    }
  }
  return bad;
};

/** A copy of `pose` clamped into ROM_LIMITS. Total: any input yields a finite, in-range pose. */
export const clampPoseToRom = (pose: PoseKeyframe): PoseKeyframe => {
  const out: PoseKeyframe = { ...pose };
  const trunk = clampTo(safeNumber(pose.trunkDeg, 0), [-180, 180]);
  out.trunkDeg = trunk;
  out.trunkTwistDeg = clampTo(safeNumber(pose.trunkTwistDeg, 0), ROM_LIMITS.trunkTwist);
  out.trunkSideDeg = clampTo(safeNumber(pose.trunkSideDeg, 0), ROM_LIMITS.trunkSide);
  out.neckDeg = clampTo(safeNumber(pose.neckDeg, 0), ROM_LIMITS.neck);
  for (const side of [-1, 1] as const) {
    const r = resolveSide(pose, side);
    const yaw = clampTo(r.legYaw, [-95, 95]);
    const c = Math.cos(toRad(yaw));
    const sn = Math.abs(Math.sin(toRad(yaw)));
    let legYaw = yaw;
    let femur = clampTo(r.femur, [-180, 180]);
    // Abduction bound first, then the flexion bound on the sagittal component.
    if (sn > 1e-6) femur = clampTo(femur, [-ROM_LIMITS.hipAbd[1] / sn, ROM_LIMITS.hipAbd[1] / sn]);
    if (c > 1e-3) femur = clampTo(femur, [(ROM_LIMITS.hipFlex[0] - trunk) / c, (ROM_LIMITS.hipFlex[1] - trunk) / c]);
    const hip = femur * Math.cos(toRad(legYaw)) + trunk;
    const abd = Math.abs(femur * Math.sin(toRad(legYaw)));
    if (hip < ROM_LIMITS.hipFlex[0] - 1e-6 || hip > ROM_LIMITS.hipFlex[1] + 1e-6 || abd > ROM_LIMITS.hipAbd[1] + 1e-6) {
      // Abduction and flexion bounds conflict (an extreme trunk lean with a
      // sideways leg): fall back to a sagittal leg, which is always solvable.
      legYaw = 0;
      femur = clampTo(r.femur, [ROM_LIMITS.hipFlex[0] - trunk, ROM_LIMITS.hipFlex[1] - trunk]);
    }
    const tibia = clampTo(r.tibia, [femur - ROM_LIMITS.kneeFlex[1], femur - ROM_LIMITS.kneeFlex[0]]);
    const footPitch = clampTo(r.footPitch, [-tibia - ROM_LIMITS.ankleDorsi[1], -tibia - ROM_LIMITS.ankleDorsi[0]]);
    const shoulderFlex = clampTo(r.shoulderFlex, ROM_LIMITS.shoulderFlex);
    const shoulderAbd = clampTo(r.shoulderAbd, ROM_LIMITS.shoulderAbd);
    const elbow = clampTo(r.elbow, ROM_LIMITS.elbowFlex);
    if (side === 1) {
      out.femurDegR = femur; out.tibiaDegR = tibia; out.legYawDegR = legYaw; out.footPitchDegR = footPitch;
      out.shoulderFlexDegR = shoulderFlex; out.shoulderAbdDegR = shoulderAbd; out.elbowDegR = elbow;
    } else {
      out.femurDegL = femur; out.tibiaDegL = tibia; out.legYawDegL = legYaw; out.footPitchDegL = footPitch;
      out.shoulderFlexDegL = shoulderFlex; out.shoulderAbdDegL = shoulderAbd; out.elbowDegL = elbow;
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Feet & contacts
// ---------------------------------------------------------------------------

/** Ankle-to-toe vector length and its legacy downward tilt (the original flat foot). */
const FOOT_LEN = Math.hypot(RIG.ankleHeight * 0.4, RIG.footLength);
const FOOT_TILT = Math.atan2(RIG.ankleHeight * 0.4, RIG.footLength);
/** On a flat foot the toe marker sits this far above the floor. */
const TOE_CONTACT = RIG.ankleHeight * 0.6;

/** How far below each landmark the body surface that touches the floor is. */
const CONTACT_RADIUS = { knee: 0.055, hand: 0.025, wrist: 0.035, elbow: 0.05, pelvis: 0.1, chest: 0.11, head: RIG.headRadius } as const;

const ALL_CONTACTS: ContactId[] = ['feet', 'knees', 'hands', 'elbows', 'pelvis', 'back', 'head'];

/** Heel contact relative to the ankle for a foot pitch (toes-down positive). */
const heelOffset = (pitchDeg: number): Vec3 => {
  const p = toRad(pitchDeg);
  // The heel sits under and just behind the ankle; toes-down pitch swings it up and back.
  return v3(0, -RIG.ankleHeight * Math.cos(p) + 0.03 * Math.sin(p), -0.03 * Math.cos(p) - RIG.ankleHeight * Math.sin(p));
};

/** Rotate about the vertical; positive yaw swings +Z toward +X (the athlete's right). */
const yawVec = (v: Vec3, yawDeg: number): Vec3 => {
  if (yawDeg === 0) return v;
  const r = toRad(yawDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return v3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
};

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/**
 * Solve a full skeleton from one pose.
 *
 * Standing poses are grounded by translating the whole figure so the ankles sit
 * at `RIG.ankleHeight`; supine poses pin the pelvis to the bench and run a
 * one-shot analytic IK on the tibia so the feet still reach the floor. Floor
 * poses rest their lowest contact on the floor; hanging poses pin the hands to
 * the bar.
 */
export const solvePose = (rawPose: PoseKeyframe, opts: SolveOptions): Skeleton => {
  const pose = opts.enforceRom ? clampPoseToRom(rawPose) : rawPose;
  // Every numeric input is sanitised at the door. Poses arrive from authored
  // data, from React props and from a scrub position the user drags, and a
  // single NaN anywhere in that chain would otherwise propagate silently into
  // the vertex buffers and render an invisible avatar with no error at all.
  const trunkDeg = safeNumber(pose.trunkDeg, 0);
  const shoulderRotDeg = safeNumber(pose.shoulderRotDeg, 0);
  const twistDeg = safeNumber(pose.trunkTwistDeg, 0);
  const sideBendDeg = safeNumber(pose.trunkSideDeg, 0);
  const neckDeg = safeNumber(pose.neckDeg, 0);
  const rootPitch = safeNumber(pose.rootPitchDeg, 0);
  const rootRoll = safeNumber(pose.rootRollDeg, 0);
  const liftY = safeNumber(pose.liftY, 0);
  const sideR = resolveSide(pose, 1);
  const sideL = resolveSide(pose, -1);
  const hasFootPitch = pose.footPitchDegL !== undefined || pose.footPitchDegR !== undefined;

  const supine = opts.posture === 'supine';
  // Supine clips author trunkDeg as the lean from vertical exactly like
  // standing ones (a bench press sits at 84-90), so the frame needs no
  // special-casing — only the grounding rule below differs.
  let trunk = trunkFrame(trunkDeg);
  if (sideBendDeg !== 0 || twistDeg !== 0) {
    let { up, forward, right } = trunk;
    if (sideBendDeg !== 0) {
      // Positive bends toward the athlete's right: rotate about the chest normal.
      up = normalize(rotateAbout(up, forward, -toRad(sideBendDeg)));
      right = normalize(rotateAbout(right, forward, -toRad(sideBendDeg)));
    }
    if (twistDeg !== 0) {
      forward = normalize(rotateAbout(forward, up, toRad(twistDeg)));
      right = normalize(rotateAbout(right, up, toRad(twistDeg)));
    }
    trunk = { up, forward, right };
  }

  // --- Pelvis (provisional; standing poses are grounded afterwards) ---------
  const pelvis0 = v3(0, supine ? safeNumber(opts.supinePelvisY, BENCH_HEIGHT + 0.1) : 0, 0);

  // --- Legs (world frame) ---------------------------------------------------
  const legFor = (side: 1 | -1, r: ResolvedSide) => {
    const hip = add(pelvis0, v3(side * RIG.hipHalfWidth, 0, 0));
    const femurDir = yawVec(dirFromDown(r.femur), r.legYaw);
    const knee = add(hip, scale(femurDir, RIG.thigh));
    let tibiaDeg = r.tibia;
    if (supine && !opts.freeLegs) {
      const solved = solveTibiaForFloor(knee.y, r.femur >= 0);
      if (solved !== null) tibiaDeg = solved;
    }
    const tibiaDir = yawVec(dirFromDown(tibiaDeg), r.legYaw);
    const ankle = add(knee, scale(tibiaDir, RIG.shank));
    // Legacy foot: a fixed, flat ankle-to-toe vector. Pitch rotates it about the ankle.
    const pitch = hasFootPitch ? toRad(r.footPitch) : 0;
    const toe = hasFootPitch
      ? add(ankle, v3(0, -FOOT_LEN * Math.sin(FOOT_TILT + pitch), FOOT_LEN * Math.cos(FOOT_TILT + pitch)))
      : add(ankle, v3(0, -RIG.ankleHeight * 0.4, RIG.footLength));
    return { hip, knee, ankle, toe };
  };

  const legL = legFor(-1, sideL);
  const legR = legFor(1, sideR);

  // --- Torso, head ----------------------------------------------------------
  const chest = add(pelvis0, scale(trunk.up, RIG.torso));
  const neck = add(chest, scale(trunk.up, RIG.neck * 0.5));
  const headDir = neckDeg !== 0 ? normalize(rotateAbout(trunk.up, trunk.right, toRad(neckDeg))) : trunk.up;
  const head = add(neck, scale(headDir, RIG.neck * 0.5 + RIG.headRadius));

  // --- Arms -----------------------------------------------------------------
  const gripHalf = safeNumber(opts.gripHalfWidth, RIG.shoulderHalfWidth);
  // A wider grip is not a sideways teleport of the hands — it is achieved by
  // abducting the shoulder. Converting grip width into an abduction bias keeps
  // the arm chain anatomically intact instead of stretching the forearm.
  const abdBias = opts.armsFollowGravity || opts.noGripBias
    ? 0
    : Math.max(-14, Math.min(8, (gripHalf - GRIP_REFERENCE_HALF_WIDTH) * GRIP_ABDUCTION_GAIN));

  const armFor = (side: 1 | -1, r: ResolvedSide) => {
    const shoulder = add(chest, scale(trunk.right, side * RIG.shoulderHalfWidth));
    const humerus = opts.armsFollowGravity
      ? v3(0, -1, 0)
      : humerusDirection(trunk, r.shoulderFlex, r.shoulderAbd + abdBias, side);
    const elbow = add(shoulder, scale(humerus, RIG.upperArm));
    const forearm = opts.carriedElbowAxis && !opts.armsFollowGravity
      ? carriedForearmDirection(trunk, r.shoulderFlex, r.shoulderAbd + abdBias, side, r.elbow, shoulderRotDeg)
      : forearmDirection(humerus, trunk, r.elbow, shoulderRotDeg);
    const wrist = add(elbow, scale(forearm, RIG.forearm));
    const hand = add(wrist, scale(forearm, RIG.hand));
    return { shoulder, elbow, wrist, hand };
  };

  const armL = armFor(-1, sideL);
  const armR = armFor(1, sideR);

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

  const keys = Object.keys(skeleton) as (keyof Skeleton)[];

  // Heels are not joints but they are contacts; carry them through the root
  // transform so floor grounding can see them.
  let heelL = add(legL.ankle, heelOffset(hasFootPitch ? sideL.footPitch : 0));
  let heelR = add(legR.ankle, heelOffset(hasFootPitch ? sideR.footPitch : 0));

  // --- Whole-body pitch / roll about the pelvis -----------------------------
  if (rootPitch !== 0 || rootRoll !== 0) {
    const pitchAxis = v3(1, 0, 0);
    const rollAxis = v3(0, 0, 1);
    const xform = (p: Vec3): Vec3 => {
      let rel = sub(p, pelvis0);
      // Positive pitch tips the head forward (+Y toward +Z).
      if (rootPitch !== 0) rel = rotateAbout(rel, pitchAxis, toRad(rootPitch));
      // Positive roll drops the athlete's right side (+X toward -Y).
      if (rootRoll !== 0) rel = rotateAbout(rel, rollAxis, -toRad(rootRoll));
      return add(pelvis0, rel);
    };
    for (const key of keys) skeleton[key] = xform(skeleton[key]);
    heelL = xform(heelL);
    heelR = xform(heelR);
  }

  // --- Grounding ------------------------------------------------------------
  const shiftAll = (dx: number, dy: number, dz: number) => {
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12 && Math.abs(dz) < 1e-12) return;
    for (const key of keys) {
      skeleton[key] = v3(skeleton[key].x + dx, skeleton[key].y + dy, skeleton[key].z + dz);
    }
  };

  if (opts.posture === 'standing') {
    const lowest = Math.min(skeleton.ankleL.y, skeleton.ankleR.y);
    const lift = Number.isFinite(lowest) ? RIG.ankleHeight - lowest : 0;
    if (Math.abs(lift) > 1e-6) shiftAll(0, lift, 0);
  } else if (opts.posture === 'floor') {
    const lowest = lowestContact(skeleton, heelL, heelR, opts.contacts);
    if (Number.isFinite(lowest)) shiftAll(0, -lowest, 0);
  } else if (opts.posture === 'hanging') {
    const handY = (skeleton.handL.y + skeleton.handR.y) / 2;
    if (Number.isFinite(handY)) shiftAll(0, safeNumber(opts.barY, 2.25) - handY, 0);
  }

  // --- Horizontal anchor ----------------------------------------------------
  if (opts.anchor) {
    let ax: number;
    let az: number;
    if (opts.anchor === 'feet') {
      ax = (skeleton.toeL.x + skeleton.toeR.x) / 2;
      az = (skeleton.toeL.z + skeleton.toeR.z) / 2;
    } else if (opts.anchor === 'footL' || opts.anchor === 'footR') {
      const toe = opts.anchor === 'footL' ? skeleton.toeL : skeleton.toeR;
      ax = toe.x;
      az = toe.z;
    } else if (opts.anchor === 'hands') {
      ax = (skeleton.handL.x + skeleton.handR.x) / 2;
      az = (skeleton.handL.z + skeleton.handR.z) / 2;
    } else {
      ax = skeleton.pelvis.x;
      az = skeleton.pelvis.z;
    }
    if (Number.isFinite(ax) && Number.isFinite(az)) shiftAll(-ax, 0, -az);
  }

  const shiftZ = safeNumber(pose.shiftZ, 0);
  if (liftY !== 0 || shiftZ !== 0) shiftAll(0, liftY, shiftZ);

  return skeleton;
};

/** Height of the lowest weight-bearing surface of a solved skeleton (before grounding). */
const lowestContact = (s: Skeleton, heelL: Vec3, heelR: Vec3, contacts?: ContactId[]): number => {
  const list = contacts && contacts.length > 0 ? contacts : ALL_CONTACTS;
  let lowest = Infinity;
  const consider = (y: number) => {
    if (Number.isFinite(y) && y < lowest) lowest = y;
  };
  for (const c of list) {
    if (c === 'feet') {
      consider(s.toeL.y - TOE_CONTACT);
      consider(s.toeR.y - TOE_CONTACT);
      consider(heelL.y);
      consider(heelR.y);
    } else if (c === 'knees') {
      consider(s.kneeL.y - CONTACT_RADIUS.knee);
      consider(s.kneeR.y - CONTACT_RADIUS.knee);
    } else if (c === 'hands') {
      consider(s.handL.y - CONTACT_RADIUS.hand);
      consider(s.handR.y - CONTACT_RADIUS.hand);
      consider(s.wristL.y - CONTACT_RADIUS.wrist);
      consider(s.wristR.y - CONTACT_RADIUS.wrist);
    } else if (c === 'elbows') {
      consider(s.elbowL.y - CONTACT_RADIUS.elbow);
      consider(s.elbowR.y - CONTACT_RADIUS.elbow);
    } else if (c === 'pelvis') {
      consider(s.pelvis.y - CONTACT_RADIUS.pelvis);
    } else if (c === 'back') {
      consider(s.chest.y - CONTACT_RADIUS.chest);
    } else if (c === 'head') {
      consider(s.head.y - CONTACT_RADIUS.head);
    }
  }
  return lowest;
};

/**
 * Lowest body surface of an already-solved skeleton over every contact except
 * the heels (which are not joints). Floor clips must read ~0; anything clearly
 * negative means a limb has gone through the floor.
 */
export const floorClearance = (s: Skeleton): number => {
  let lowest = lowestContact(s, v3(0, Infinity, 0), v3(0, Infinity, 0));
  // Toe-only foot reading is too strict for a flat foot whose heel is down, so
  // also accept the ankle at its standing height as a contact.
  lowest = Math.min(lowest, s.ankleL.y - RIG.ankleHeight, s.ankleR.y - RIG.ankleHeight);
  return lowest;
};

/**
 * Forearm direction with the elbow axis carried by the same shoulder rotations
 * as the humerus. `forearmDirection` derives the axis from a cross product with
 * the chest normal, which flips sign once the arm passes 90 deg of flexion — an
 * overhead triceps extension would bend the elbow the wrong way. Carrying the
 * anatomical axis (-right at rest) through abduction and flexion keeps elbow
 * flexion pointing the same anatomical direction everywhere.
 */
export const carriedForearmDirection = (
  frame: TrunkFrame,
  flexDeg: number,
  abdDeg: number,
  side: 1 | -1,
  elbowDeg: number,
  rotationDeg = 0,
): Vec3 => {
  const humerus = humerusDirection(frame, flexDeg, abdDeg, side);
  let axis = scale(frame.right, -1);
  axis = rotateAbout(axis, frame.forward, side * toRad(abdDeg));
  axis = normalize(rotateAbout(axis, frame.right, -toRad(flexDeg)));
  // Mirrored per side so a positive value means the same anatomical rotation on both arms.
  if (rotationDeg !== 0) axis = normalize(rotateAbout(axis, humerus, -side * toRad(rotationDeg)));
  return normalize(rotateAbout(humerus, axis, toRad(elbowDeg)));
};

/**
 * Signed knee flexion read off a solved skeleton, degrees: positive is normal
 * flexion, negative is a knee bending backwards. The sign comes from the
 * pelvis's lateral axis, which travels with any whole-body pitch or roll.
 */
export const signedKneeFlex = (s: Skeleton, side: 'L' | 'R'): number => {
  const hip = side === 'L' ? s.hipL : s.hipR;
  const knee = side === 'L' ? s.kneeL : s.kneeR;
  const ankle = side === 'L' ? s.ankleL : s.ankleR;
  const femur = normalize(sub(knee, hip));
  const tibia = normalize(sub(ankle, knee));
  const mag = toDeg(Math.acos(Math.min(1, Math.max(-1, dot(femur, tibia)))));
  const lateral = normalize(sub(s.hipR, s.hipL));
  const sign = dot(cross(femur, tibia), lateral) >= -1e-9 ? 1 : -1;
  return sign * mag;
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
export const barPosition = (s: Skeleton, anchor: 'wrists' | 'traps' | 'wristR' | 'pelvis', trunkDeg: number): Vec3 => {
  if (anchor === 'wristR') return v3(s.wristR.x, s.wristR.y, s.wristR.z);
  if (anchor === 'pelvis') return v3(s.pelvis.x, s.pelvis.y + 0.12, s.pelvis.z);
  if (anchor === 'wrists') {
    return v3((s.wristL.x + s.wristR.x) / 2, (s.wristL.y + s.wristR.y) / 2, (s.wristL.z + s.wristR.z) / 2);
  }
  const frame = trunkFrame(trunkDeg);
  const base = v3((s.shoulderL.x + s.shoulderR.x) / 2, (s.shoulderL.y + s.shoulderR.y) / 2, (s.shoulderL.z + s.shoulderR.z) / 2);
  return add(base, scale(frame.forward, -0.07));
};

export const vecUtils = { v3, add, sub, scale, dot, cross, length, normalize, rotateAbout, dirFromDown };
