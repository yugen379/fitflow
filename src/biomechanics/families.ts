/**
 * Parameterised motion families.
 *
 * The five hand-authored clips in motions.ts cover the barbell showcase lifts.
 * Every one of the 137 library exercises gets its demo from one of the
 * families below instead: each family is a function from a small parameter
 * set (variant, depth, implement...) to keyframes on the same FK rig.
 *
 * Where a contact must hold (hands on the floor in a push-up, both feet down
 * in a lunge, shoulders on the bench in a hip thrust) the keyframes are not
 * eyeballed — they are solved at build time against `solvePose` itself, with
 * a bisection or a tiny Gauss-Newton loop, so the rendered geometry and the
 * constraint can never disagree. `scripts/exercise-motions-proof.mjs`
 * re-checks all of it on the sampled, interpolated motion.
 *
 * Conventions (body frame, before any whole-body pitch):
 *   trunkDeg  lean from vertical, + forward      hip flexion  = femur + trunk
 *   femurDeg  from straight down, + knee forward knee flexion = femur - tibia
 *   shoulderFlexDeg 0 = arm by the side, 90 = forward, 180 = overhead
 *   rootPitchDeg +90 lays an upright body face-down, -90 face-up.
 *
 * This module is deliberately three.js-free and firebase-free.
 */

import { RIG, solvePose } from './rig';
import type { SolveOptions } from './rig';
import type {
  ActivationMap,
  BarAnchor,
  ClipProp,
  ClipSolveExtras,
  EquipmentId,
  MotionClip,
  MovementPhase,
  MuscleId,
  PhaseSpan,
  PoseKeyframe,
  Posture,
  Skeleton,
  Vec3,
} from './types';

// ---------------------------------------------------------------------------
// Public spec types
// ---------------------------------------------------------------------------

export const MOTION_FAMILIES = [
  'squat',
  'hinge',
  'lunge',
  'pushup',
  'benchPress',
  'overheadPress',
  'row',
  'verticalPull',
  'curl',
  'triceps',
  'raise',
  'core',
  'plank',
  'bridge',
  'jump',
  'cardio',
  'calf',
  'legMachine',
  'stretch',
] as const;

export type MotionFamily = (typeof MOTION_FAMILIES)[number];

export interface FamilyParams {
  /** Family-specific variant name. */
  variant?: string;
  /** 0..1 range-of-motion scale (squat depth, lunge depth...). */
  depth?: number;
  /** Mirror single-side movements onto the left side. */
  left?: boolean;
}

export interface ExerciseMotionSpec {
  family: MotionFamily;
  params: FamilyParams;
  /** Implements the demo can be shown with; first is the default. */
  equipment: EquipmentId[];
  /** Present when the demo is an honest approximation; the text says what is missing. */
  simplified?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PoseIn = Partial<PoseKeyframe>;

const pose = (p: PoseIn): PoseKeyframe => ({
  t: 0,
  trunkDeg: 0,
  femurDeg: 0,
  tibiaDeg: 0,
  shoulderFlexDeg: 0,
  shoulderAbdDeg: 10,
  elbowDeg: 8,
  activation: {},
  ...p,
});

interface Frame {
  t: number;
  pose: PoseIn;
  /** 0..1 — scales the family's muscle activation at this instant. */
  effort: number;
}

const F = (t: number, effort: number, p: PoseIn): Frame => ({ t, effort, pose: p });

type PhaseKind = 'rep' | 'pull' | 'hold' | 'cycle' | 'floorFirst';

interface FamilyOut {
  posture: Posture;
  solve: ClipSolveExtras;
  frames: Frame[];
  phases: PhaseKind;
  primary: MuscleId[];
  secondary: MuscleId[];
  cues: Record<MovementPhase, string>;
  barAnchor?: BarAnchor;
  armsFollowGravity?: boolean;
  supinePelvisY?: number;
  props?: ClipProp[];
  cableAnchor?: Vec3;
}

/** Solve options a generated clip renders with — the single source of truth for build-time IK and runtime. */
export const generatedSolveOptions = (clip: {
  posture: Posture;
  supinePelvisY?: number;
  armsFollowGravity: boolean;
  solve?: ClipSolveExtras;
}): SolveOptions => ({
  posture: clip.posture,
  supinePelvisY: clip.supinePelvisY,
  armsFollowGravity: clip.armsFollowGravity,
  carriedElbowAxis: clip.solve?.carriedElbowAxis ?? true,
  noGripBias: clip.solve?.noGripBias ?? true,
  freeLegs: clip.solve?.freeLegs,
  anchor: clip.solve?.anchor,
  barY: clip.solve?.barY,
  contacts: clip.solve?.contacts,
  enforceRom: true,
});

const optsOf = (out: Pick<FamilyOut, 'posture' | 'supinePelvisY' | 'armsFollowGravity' | 'solve'>): SolveOptions =>
  generatedSolveOptions({ ...out, armsFollowGravity: !!out.armsFollowGravity });

const S = (p: PoseIn, o: SolveOptions): Skeleton => solvePose(pose(p), o);

/** Bisection for a root of a monotone-ish scalar function. */
const bisect = (fn: (x: number) => number, lo: number, hi: number, iters = 48): number => {
  let a = lo;
  let b = hi;
  let fa = fn(a);
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = fn(m);
    if ((fm > 0) === (fa > 0)) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return (a + b) / 2;
};

/** Damped Gauss-Newton on up to three degree-valued unknowns. */
const solveN = (x0: number[], residual: (x: number[]) => number[], iters = 60): number[] => {
  let x = x0.slice();
  const n = x.length;
  const norm = (r: number[]) => Math.hypot(...r);
  let r = residual(x);
  let err = norm(r);
  for (let it = 0; it < iters && err > 1e-6; it++) {
    const h = 0.02;
    const J: number[][] = r.map(() => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] += h;
      const rp = residual(xp);
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    // Normal equations (J^T J + lambda I) dx = -J^T r.
    const A: number[][] = [];
    const g: number[] = [];
    for (let a = 0; a < n; a++) {
      A.push(new Array(n).fill(0));
      g.push(0);
      for (let i = 0; i < r.length; i++) g[a] -= J[i][a] * r[i];
      for (let b = 0; b < n; b++) for (let i = 0; i < r.length; i++) A[a][b] += J[i][a] * J[i][b];
      A[a][a] += 1e-7;
    }
    const dx = gauss(A, g);
    let step = 1;
    let improved = false;
    for (let k = 0; k < 12; k++) {
      const xn = x.map((v, i) => v + dx[i] * step);
      const rn = residual(xn);
      const en = norm(rn);
      if (en < err) {
        x = xn;
        r = rn;
        err = en;
        improved = true;
        break;
      }
      step /= 2;
    }
    if (!improved) break;
  }
  return x;
};

const gauss = (A: number[][], b: number[]): number[] => {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-12));
};

const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

/** Contact height of a hand (matches the floor-contact radius in rig.ts). */
const handBottom = (s: Skeleton, side: 'L' | 'R' | 'both') => {
  const yl = Math.min(s.handL.y - 0.025, s.wristL.y - 0.035);
  const yr = Math.min(s.handR.y - 0.025, s.wristR.y - 0.035);
  return side === 'L' ? yl : side === 'R' ? yr : Math.min(yl, yr);
};
const toeBottom = (s: Skeleton) => Math.min(s.toeL.y, s.toeR.y) - RIG.ankleHeight * 0.6;

/** Two-link leg IK in the sagittal plane: hip -> ankle offset (y down negative, z forward). Knee bends forward. */
const legIK = (dy: number, dz: number): { femur: number; tibia: number } => {
  const L1 = RIG.thigh;
  const L2 = RIG.shank;
  let D = Math.hypot(dy, dz);
  D = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, D));
  const base = (Math.atan2(dz, -dy) * 180) / Math.PI;
  const alpha = (Math.acos((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)) * 180) / Math.PI;
  const femur = base + alpha;
  const kr = (femur * Math.PI) / 180;
  const ky = -L1 * Math.cos(kr);
  const kz = L1 * Math.sin(kr);
  const tibia = (Math.atan2(dz - kz, -(dy - ky)) * 180) / Math.PI;
  return { femur, tibia };
};

const FOOT_LEN = Math.hypot(RIG.ankleHeight * 0.4, RIG.footLength);
const FOOT_TILT = (Math.atan2(RIG.ankleHeight * 0.4, RIG.footLength) * 180) / Math.PI;
const TOE_CONTACT = RIG.ankleHeight * 0.6;

/** Ankle position (y above floor, z) for a toe planted at z with the foot pitched `pitch` deg. */
const ankleFromToe = (toeZ: number, pitch: number, floorY = 0) => {
  const a = ((FOOT_TILT + pitch) * Math.PI) / 180;
  return { y: floorY + TOE_CONTACT + FOOT_LEN * Math.sin(a), z: toeZ - FOOT_LEN * Math.cos(a) };
};

/** Soft range-of-motion walls for the arm IK, so an unreachable target yields the closest legal pose. */
const armBounds = (flex: number, elbow: number): number[] => [
  (elbow < 2 ? 2 - elbow : elbow > 150 ? elbow - 150 : 0) * 0.05,
  (flex < -70 ? -70 - flex : flex > 180 ? flex - 180 : 0) * 0.05,
];

/** Pin each hand to where it already is in `ref` by re-solving that arm on `q`. */
const pinHands = (q: PoseIn, ref: PoseIn, o: SolveOptions): PoseIn => {
  const sr = S(ref, o);
  let out = fitArm(q, o, 'L', sr.wristL, [(ref.shoulderFlexDegL ?? ref.shoulderFlexDeg ?? 0) as number, (ref.elbowDegL ?? ref.elbowDeg ?? 5) as number]);
  out = fitArm(out, o, 'R', sr.wristR, [(ref.shoulderFlexDegR ?? ref.shoulderFlexDeg ?? 0) as number, (ref.elbowDegR ?? ref.elbowDeg ?? 5) as number]);
  return out;
};

/** Arm IK: adjust one arm's flexion, abduction and elbow so that its wrist lands on `target` (x, y, z). */
const fitArm = (base: PoseIn, o: SolveOptions, side: 'L' | 'R', target: Vec3, guess: [number, number]): PoseIn => {
  const fk = side === 'R' ? 'shoulderFlexDegR' : 'shoulderFlexDegL';
  const ak = side === 'R' ? 'shoulderAbdDegR' : 'shoulderAbdDegL';
  const ek = side === 'R' ? 'elbowDegR' : 'elbowDegL';
  const a0 = ((side === 'R' ? base.shoulderAbdDegR : base.shoulderAbdDegL) ?? base.shoulderAbdDeg ?? 10) as number;
  const [f, a, e] = solveN([guess[0], a0, guess[1]], ([fx, ax, ex]) => {
    const s = S({ ...base, [fk]: fx, [ak]: ax, [ek]: ex }, o);
    const w = side === 'R' ? s.wristR : s.wristL;
    const abdWall = (ax < -20 ? -20 - ax : ax > 180 ? ax - 180 : 0) * 0.05;
    return [w.x - target.x, w.y - target.y, w.z - target.z, abdWall, ...armBounds(fx, ex)];
  });
  return { ...base, [fk]: f, [ak]: a, [ek]: e };
};

const fitBothArms = (base: PoseIn, o: SolveOptions, targetY: number, targetZ: number, guess: [number, number]): PoseIn => {
  const [f, e] = solveN(guess, ([fx, ex]) => {
    const s = S({ ...base, shoulderFlexDeg: fx, elbowDeg: ex }, o);
    const w = mid(s.wristL, s.wristR);
    return [w.y - targetY, w.z - targetZ, ...armBounds(fx, ex)];
  });
  return { ...base, shoulderFlexDeg: f, elbowDeg: e };
};

/** Mirror the per-side fields of a pose (left <-> right). */
const mirror = (p: PoseIn): PoseIn => {
  const out: PoseIn = { ...p };
  const pairs: [keyof PoseKeyframe, keyof PoseKeyframe][] = [
    ['femurDegL', 'femurDegR'],
    ['tibiaDegL', 'tibiaDegR'],
    ['legYawDegL', 'legYawDegR'],
    ['footPitchDegL', 'footPitchDegR'],
    ['shoulderFlexDegL', 'shoulderFlexDegR'],
    ['shoulderAbdDegL', 'shoulderAbdDegR'],
    ['elbowDegL', 'elbowDegR'],
  ];
  const o = out as Record<string, unknown>;
  const src = p as Record<string, unknown>;
  for (const [l, r] of pairs) {
    o[l] = src[r];
    o[r] = src[l];
    if (o[l] === undefined) delete o[l];
    if (o[r] === undefined) delete o[r];
  }
  const yawL = o.legYawDegL as number | undefined;
  const yawR = o.legYawDegR as number | undefined;
  if (yawL !== undefined) o.legYawDegL = -yawL;
  if (yawR !== undefined) o.legYawDegR = -yawR;
  if (typeof p.trunkTwistDeg === 'number') out.trunkTwistDeg = -p.trunkTwistDeg;
  if (typeof p.trunkSideDeg === 'number') out.trunkSideDeg = -p.trunkSideDeg;
  if (typeof p.rootRollDeg === 'number') out.rootRollDeg = -p.rootRollDeg;
  return out;
};

/** Numeric blend of two partial poses (missing per-side fields fall back to the symmetric value). */
const blend = (a: PoseIn, b: PoseIn, u: number): PoseIn => {
  const full = (p: PoseIn) => {
    const q = pose(p) as unknown as Record<string, number>;
    for (const side of ['L', 'R']) {
      for (const [k, base] of [['femurDeg', 'femurDeg'], ['tibiaDeg', 'tibiaDeg'], ['shoulderFlexDeg', 'shoulderFlexDeg'], ['shoulderAbdDeg', 'shoulderAbdDeg'], ['elbowDeg', 'elbowDeg'], ['footPitchDeg', ''], ['legYawDeg', '']]) {
        if (q[`${k}${side}`] === undefined) q[`${k}${side}`] = base ? q[base] : 0;
      }
    }
    return q;
  };
  const A = full(a);
  const B = full(b);
  const out: Record<string, number> = {};
  for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (key === 'activation' || key === 't') continue;
    const av = A[key] ?? 0;
    const bv = B[key] ?? 0;
    if (typeof av === 'number' && typeof bv === 'number') out[key] = av + (bv - av) * u;
  }
  return out as unknown as PoseIn;
};

const num = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const lerpN = (a: number, b: number, u: number) => a + (b - a) * u;

const CUE_REP = (ecc: string, iso: string, con: string, lock: string): Record<MovementPhase, string> => ({
  eccentric: ecc,
  isometric: iso,
  concentric: con,
  lockout: lock,
});
const CUE_HOLD = (hold: string, breathe = 'Breathe slowly; keep the position, do not sag.'): Record<MovementPhase, string> => ({
  eccentric: breathe,
  isometric: hold,
  concentric: breathe,
  lockout: hold,
});
const CUE_CYCLE = (a: string, b: string): Record<MovementPhase, string> => ({
  eccentric: b,
  isometric: a,
  concentric: a,
  lockout: b,
});

const STAND: ClipSolveExtras = { contacts: ['feet'], anchor: 'feet' };

// ---------------------------------------------------------------------------
// 1. Squat
// ---------------------------------------------------------------------------

const squat = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'bodyweight';
  const depth = num(p.depth, 1);
  // No leg yaw: a yawed leg plane moves the ankle sideways as the hips travel
  // back, i.e. the feet would slide. Knees track straight over the toes.
  const yaw = 0;
  const legs = (d: number): PoseIn => ({
    femurDeg: 2 + 93 * d,
    tibiaDeg: 1 - 29 * d,
    legYawDegL: -yaw,
    legYawDegR: yaw,
  });
  const trunkAt = (d: number) =>
    2 + d * (v === 'back' ? 43 : v === 'front' || v === 'thruster' ? 22 : v === 'goblet' ? 28 : v === 'hack' ? 12 : 34);
  const arms = (d: number): PoseIn => {
    switch (v) {
      case 'back':
        return { shoulderFlexDeg: -40, shoulderAbdDeg: 27, elbowDeg: 113 };
      case 'front':
      case 'thruster':
        return { shoulderFlexDeg: 75, shoulderAbdDeg: 22, elbowDeg: 150 };
      case 'goblet':
        return { shoulderFlexDeg: 25, shoulderAbdDeg: 12, elbowDeg: 145 };
      case 'hack':
        return { shoulderFlexDeg: -20, shoulderAbdDeg: 30, elbowDeg: 120 };
      default:
        return { shoulderFlexDeg: 20 + 65 * d, shoulderAbdDeg: 8, elbowDeg: 10 };
    }
  };
  const at = (d: number, extra: PoseIn = {}): PoseIn => ({ trunkDeg: trunkAt(d), ...legs(d), ...arms(d), ...extra });
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'rep',
    primary: ['quads', 'glutes'],
    secondary: ['hamstrings', 'erectors', 'abs', 'calves'],
    barAnchor: v === 'back' ? 'traps' : 'wrists',
    cues: CUE_REP(
      'Sit down and back, knees tracking over the toes. Control the descent.',
      'Hip crease to knee height or below; chest proud, heels down.',
      'Drive the floor away; hips and chest rise together.',
      'Stand tall, glutes squeezed, ribs down.',
    ),
  };
  if (v === 'wallsit') {
    const base = at(0, { femurDeg: 88, tibiaDeg: 0, trunkDeg: 0, shoulderFlexDeg: 0, shoulderAbdDeg: 12, elbowDeg: 10 });
    out.frames = [F(0, 0.8, base), F(0.5, 0.85, { ...base, femurDeg: 86, tibiaDeg: -1 })];
    out.phases = 'hold';
    out.cues = CUE_HOLD('Back flat on the wall, thighs parallel, knees over ankles.');
    const s = S(base, optsOf(out));
    out.props = [{ kind: 'box', x: 0, y: 1.0, z: Math.min(s.chest.z, s.pelvis.z) - 0.17, sx: 1.4, sy: 2, sz: 0.08 }];
    return out;
  }
  if (v === 'legpress') {
    // Reclined seat, pelvis pinned; feet travel up a 45-degree sled line.
    const ext = { femurDeg: 112, tibiaDeg: 112 };
    const bent = { femurDeg: 112 + 38 * depth, tibiaDeg: 112 - 62 * depth };
    const base: PoseIn = { trunkDeg: -45, shoulderFlexDeg: 20, shoulderAbdDeg: 25, elbowDeg: 20, footPitchDegL: 0, footPitchDegR: 0 };
    const top = { ...base, ...ext, footPitchDegL: -60, footPitchDegR: -60 };
    const bottom = { ...base, ...bent, footPitchDegL: -40, footPitchDegR: -40 };
    out.posture = 'supine';
    out.supinePelvisY = 0.55;
    out.solve = { freeLegs: true };
    out.frames = [F(0, 0.4, top), F(0.45, 0.85, bottom), F(0.55, 0.95, bottom), F(0.95, 0.5, top)];
    out.props = [
      { kind: 'box', x: 0, y: 0.42, z: -0.05, sx: 0.4, sy: 0.08, sz: 0.4 },
      { kind: 'box', x: 0, y: 0.72, z: -0.32, sx: 0.4, sy: 0.08, sz: 0.7, pitchDeg: -45 },
      { kind: 'box', x: 0, y: 0.21, z: -0.05, sx: 0.12, sy: 0.42, sz: 0.12 },
    ];
    return out;
  }
  if (v === 'jump' || v === 'tuck') {
    const tuck: PoseIn = v === 'tuck'
      ? { trunkDeg: 10, femurDeg: 100, tibiaDeg: -25, footPitchDegL: 30, footPitchDegR: 30, shoulderFlexDeg: 60, elbowDeg: 60, liftY: 0.42 }
      : { trunkDeg: 2, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 35, footPitchDegR: 35, shoulderFlexDeg: -20, elbowDeg: 10, liftY: 0.3 };
    const stand = at(0, { footPitchDegL: 0, footPitchDegR: 0 });
    const down = at(depth * 0.75, { footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: -35, elbowDeg: 10 });
    const push = at(0, { footPitchDegL: 35, footPitchDegR: 35, shoulderFlexDeg: 90, elbowDeg: 10 });
    out.frames = [
      F(0, 0.3, stand),
      F(0.28, 0.8, down),
      F(0.42, 1, push),
      F(0.55, 0.5, { ...push, ...tuck, legYawDegL: -yaw, legYawDegR: yaw }),
      F(0.68, 0.4, { ...push, liftY: 0.02 }),
      F(0.8, 0.85, down),
    ];
    out.primary = ['quads', 'glutes', 'calves'];
    out.secondary = ['hamstrings', 'abs', 'delt_front'];
    out.cues = CUE_REP(
      'Quick dip into a quarter-to-half squat, arms swing back.',
      'Load the hips and ankles — no pause long enough to lose the stretch.',
      v === 'tuck' ? 'Explode up and pull the knees to the chest at the top.' : 'Explode through the balls of the feet, arms drive up.',
      'Land softly on the mid-foot, knees bending to absorb.',
    );
    return out;
  }
  if (v === 'thruster') {
    const rack = at(0);
    const bottom = at(depth);
    const over: PoseIn = { ...at(0), shoulderFlexDeg: 172, shoulderAbdDeg: 14, elbowDeg: 4 };
    out.frames = [F(0, 0.4, rack), F(0.3, 0.9, bottom), F(0.36, 0.95, bottom), F(0.55, 0.9, { ...at(0.15), shoulderFlexDeg: 115, elbowDeg: 70 }), F(0.7, 0.75, over), F(0.78, 0.7, over), F(0.92, 0.5, { ...rack, shoulderFlexDeg: 110, elbowDeg: 90 })];
    out.primary = ['quads', 'glutes', 'delt_front'];
    out.secondary = ['triceps', 'delt_side', 'abs', 'erectors'];
    out.cues = CUE_REP(
      'Front-rack squat: elbows high, sit straight down.',
      'Bottom of the squat, torso upright.',
      'Drive out of the hole and use the momentum to press overhead in one motion.',
      'Lock out overhead, biceps by the ears, then return to the rack.',
    );
    return out;
  }
  const top = at(0);
  const bottom = at(depth);
  out.frames = [F(0, 0.3, top), F(0.22, 0.6, at(depth * 0.55)), F(0.46, 0.9, bottom), F(0.56, 1, bottom), F(0.78, 0.7, at(depth * 0.5))];
  return out;
};

// ---------------------------------------------------------------------------
// 2. Hip hinge
// ---------------------------------------------------------------------------

const hinge = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'rdl';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'rep',
    primary: ['glutes', 'hamstrings', 'erectors'],
    secondary: ['quads', 'lats', 'traps', 'forearms', 'abs'],
    barAnchor: 'wrists',
    armsFollowGravity: true,
    cues: CUE_REP(
      'Push the hips back, bar or hands sliding down the thighs. Neutral spine.',
      'Feel the hamstring stretch; back flat, shoulders over the bar.',
      'Drive the hips forward to stand; the bar stays close.',
      'Stand tall with the glutes. Do not lean back.',
    ),
  };
  const stand: PoseIn = { trunkDeg: 3, femurDeg: 1, tibiaDeg: 1, shoulderFlexDeg: 0, shoulderAbdDeg: 4, elbowDeg: 3 };
  if (v === 'deadlift' || v === 'sumo') {
    const sumo = v === 'sumo';
    const yaw = sumo ? 38 : 0;
    const legsTop = { legYawDegL: -yaw, legYawDegR: yaw };
    // Sumo: in the yawed leg plane the ankle must keep the same offset from the
    // hip or the wide feet would slide — so the legs come from IK, hips going
    // (almost) straight down between the feet.
    const sumoLegs = (h: number): PoseIn => {
      const k = legIK(RIG.ankleHeight - h, 0.06);
      return { femurDeg: k.femur, tibiaDeg: k.tibia, ...legsTop };
    };
    const standH = (() => {
      const k = legIK(-(RIG.thigh + RIG.shank) * 0.995, 0.06);
      return { femurDeg: k.femur, tibiaDeg: k.tibia };
    })();
    const bottom: PoseIn = sumo
      ? { trunkDeg: 64, ...sumoLegs(0.7) }
      : { trunkDeg: 70, femurDeg: 66, tibiaDeg: -24, ...legsTop };
    const midP: PoseIn = sumo ? { trunkDeg: 45, ...sumoLegs(0.82) } : { trunkDeg: 55, femurDeg: 30, tibiaDeg: -10, ...legsTop };
    if (sumo) Object.assign(stand, standH);
    out.frames = [F(0, 0.85, bottom), F(0.25, 1, midP), F(0.5, 0.7, { ...stand, ...legsTop }), F(0.6, 0.65, { ...stand, ...legsTop }), F(0.8, 0.8, midP)];
    out.phases = 'floorFirst';
    out.cues = {
      concentric: 'Push the floor away, then snap the hips through. Bar against the legs.',
      lockout: 'Stand tall with the glutes. No lean back, no shrug.',
      eccentric: 'Hips back first, bar past the knees, then bend the knees.',
      isometric: 'Reset on the floor. Take the slack out before the next pull.',
    };
    if (sumo) out.primary = ['glutes', 'quads', 'hamstrings'];
    return out;
  }
  if (v === 'swing') {
    out.armsFollowGravity = false;
    out.primary = ['glutes', 'hamstrings'];
    out.secondary = ['erectors', 'delt_front', 'forearms', 'abs', 'quads'];
    const legs = { legYawDegL: 0, legYawDegR: 0 };
    const top: PoseIn = { trunkDeg: -2, femurDeg: 0, tibiaDeg: 2, shoulderFlexDeg: 88, shoulderAbdDeg: 2, elbowDeg: 4, ...legs };
    const bottom: PoseIn = { trunkDeg: 58, femurDeg: 32, tibiaDeg: -8, shoulderFlexDeg: 28, shoulderAbdDeg: 4, elbowDeg: 4, ...legs };
    out.frames = [F(0, 0.5, top), F(0.25, 0.5, { ...bottom, trunkDeg: 35, femurDeg: 18, shoulderFlexDeg: 40 }), F(0.45, 0.9, bottom), F(0.7, 1, { ...top, shoulderFlexDeg: 50 })];
    out.cues = CUE_REP(
      'Hike the bell back between the thighs — hinge, do not squat.',
      'Forearms touch the inner thighs, back flat.',
      'Snap the hips forward; the bell floats up to chest height.',
      'Plank at the top: glutes and abs tight, arms just guiding.',
    );
    return out;
  }
  const bottoms: Record<string, PoseIn> = {
    rdl: { trunkDeg: 72, femurDeg: 24, tibiaDeg: -2 },
    sldl: { trunkDeg: 84, femurDeg: 6, tibiaDeg: 2 },
    goodmorning: { trunkDeg: 70, femurDeg: 18, tibiaDeg: 0, shoulderFlexDeg: 20, elbowDeg: 140 },
  };
  const bottom = { ...stand, ...(bottoms[v] ?? bottoms.rdl) };
  if (v === 'goodmorning') {
    out.armsFollowGravity = false;
    out.frames = [F(0, 0.3, { ...stand, shoulderFlexDeg: 20, elbowDeg: 140 }), F(0.46, 0.9, bottom), F(0.56, 1, bottom)];
  } else {
    out.frames = [F(0, 0.3, stand), F(0.25, 0.7, { ...stand, trunkDeg: 40, femurDeg: bottom.femurDeg! * 0.6 }), F(0.46, 0.9, bottom), F(0.56, 1, bottom)];
  }
  return out;
};

// ---------------------------------------------------------------------------
// 3. Lunge / split stance
// ---------------------------------------------------------------------------

interface SplitSpec {
  /** Pelvis height above the floor (m) and forward offset (m). */
  h: number;
  pz: number;
  /** Front ankle (z, y above floor) and foot pitch. */
  front: { z: number; y?: number; pitch?: number };
  /** Rear: planted toe z (+ floorY for an elevated foot) and pitch, or a free leg angle. */
  rear: { toeZ: number; pitch: number; floorY?: number } | { femur: number; tibia: number; pitch?: number };
}

/** Build a split-stance pose (front leg = right) from world targets with analytic leg IK. */
const splitPose = ({ h, pz, front, rear }: SplitSpec, extra: PoseIn = {}): PoseIn => {
  const fy = front.y ?? RIG.ankleHeight;
  const fr = legIK(fy - h, front.z - pz);
  const out: PoseIn = { femurDegR: fr.femur, tibiaDegR: fr.tibia, footPitchDegR: front.pitch ?? 0, ...extra };
  if ('toeZ' in rear) {
    const a = ankleFromToe(rear.toeZ, rear.pitch, rear.floorY ?? 0);
    const rl = legIK(a.y - h, a.z - pz);
    out.femurDegL = rl.femur;
    out.tibiaDegL = rl.tibia;
    out.footPitchDegL = rear.pitch;
  } else {
    out.femurDegL = rear.femur;
    out.tibiaDegL = rear.tibia;
    out.footPitchDegL = rear.pitch ?? 0;
  }
  return out;
};

const lunge = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'lunge';
  const depth = num(p.depth, 1);
  const out: FamilyOut = {
    posture: 'floor',
    solve: { contacts: ['feet', 'knees'], anchor: 'footR' },
    frames: [],
    phases: 'rep',
    primary: ['quads', 'glutes'],
    secondary: ['hamstrings', 'calves', 'abs'],
    barAnchor: 'wrists',
    cues: CUE_REP(
      'Drop the back knee straight down; front shin stays near vertical.',
      'Back knee hovers just above the floor, torso upright.',
      'Drive through the front heel to stand.',
      'Tall, hips square, weight across both feet.',
    ),
  };
  const armsHang: PoseIn = { shoulderFlexDeg: 0, shoulderAbdDeg: 10, elbowDeg: 8 };
  const sp = (h: number, pz: number, rearPitch: number, extra: PoseIn = {}) =>
    splitPose({ h, pz, front: { z: 0.4 }, rear: { toeZ: -0.4, pitch: rearPitch } }, { trunkDeg: 3, ...armsHang, ...extra });
  if (v === 'lunge' || v === 'walking') {
    // IK at several heights: interpolating joint angles between only two
    // solved poses lets the rear toe drift, so solve the path densely.
    const at = (u: number) => sp(0.84 - 0.32 * depth * u, 0, 30 + 32 * u);
    out.frames = [
      F(0, 0.3, at(0)), F(0.12, 0.5, at(0.25)), F(0.24, 0.7, at(0.5)), F(0.35, 0.85, at(0.75)), F(0.46, 0.9, at(1)),
      F(0.56, 1, at(1)), F(0.66, 0.85, at(0.75)), F(0.76, 0.7, at(0.5)), F(0.86, 0.5, at(0.25)),
    ];
    return out;
  }
  if (v === 'bulgarian') {
    const benchTop = 0.45;
    const r = (h: number, pz: number, pitch: number) =>
      splitPose({ h, pz, front: { z: 0.3 }, rear: { toeZ: -0.62, pitch, floorY: benchTop - TOE_CONTACT + 0.0 } }, { trunkDeg: 10, ...armsHang });
    const top = r(0.86, -0.04, 120);
    const bottom = r(0.86 - 0.36 * depth, -0.06, 130);
    out.solve = { contacts: ['feet'], anchor: 'footR' };
    out.frames = [F(0, 0.3, top), F(0.46, 0.9, bottom), F(0.56, 1, bottom)];
    // Bench under the rear foot: place it from the solved top pose.
    const s = S(top, optsOf(out));
    out.props = [{ kind: 'box', x: s.toeL.x, y: benchTop / 2, z: Math.min(s.toeL.z, s.ankleL.z) - 0.02, sx: 0.4, sy: benchTop, sz: 0.36 }];
    // The lowest contact must be the front foot: the rear foot is on the bench.
    out.solve = { contacts: ['feet'], anchor: 'footR' };
    out.frames = out.frames.map((f) => ({ ...f, pose: f.pose }));
    return out;
  }
  if (v === 'stepup') {
    const box = 0.4;
    // Front (right) foot on the box; rear foot on the floor, then driven up.
    const start = splitPose({ h: 0.93, pz: -0.2, front: { z: 0.12, y: box + RIG.ankleHeight }, rear: { toeZ: -0.18, pitch: 8 } }, { trunkDeg: 12, ...armsHang });
    const midP = splitPose({ h: 1.14, pz: -0.02, front: { z: 0.12, y: box + RIG.ankleHeight }, rear: { toeZ: -0.2, pitch: 40, floorY: 0.06 } }, { trunkDeg: 10, ...armsHang });
    const top = splitPose({ h: box + 0.95, pz: 0.08, front: { z: 0.12, y: box + RIG.ankleHeight }, rear: { femur: 70, tibia: -10 } }, { trunkDeg: 2, ...armsHang });
    out.solve = { contacts: ['feet'], anchor: 'footR' };
    out.frames = [F(0, 0.4, start), F(0.3, 0.9, midP), F(0.5, 1, top), F(0.6, 0.8, top), F(0.8, 0.6, midP)];
    // Floor grounding puts the lowest foot on y = 0; lift every frame so the right foot sits on the box.
    const o = optsOf(out);
    out.frames = out.frames.map((f) => {
      const s = S(f.pose, o);
      const rightBottom = Math.min(s.toeR.y - TOE_CONTACT, s.ankleR.y - RIG.ankleHeight);
      return { ...f, pose: { ...f.pose, liftY: box - rightBottom } };
    });
    const s0 = S(out.frames[0].pose, o);
    out.props = [{ kind: 'box', x: 0.05, y: box / 2, z: s0.ankleR.z + 0.05, sx: 0.6, sy: box, sz: 0.45 }];
    out.primary = ['quads', 'glutes'];
    out.cues = CUE_REP('Step down under control, rear foot first.', 'Whole front foot on the box, knee over the toes.', 'Drive through the front heel; do not push off the back foot.', 'Stand tall on the box, rear knee up.');
    return out;
  }
  // Static split-stance holds.
  out.phases = 'hold';
  let hold: PoseIn;
  if (v === 'hipflexor' || v === 'couch') {
    const couch = v === 'couch';
    const front = { z: 0.36 };
    const h = 0.62;
    const fr = legIK(RIG.ankleHeight - h, front.z - 0.02);
    hold = couch
      ? { trunkDeg: -4, femurDegR: fr.femur, tibiaDegR: fr.tibia, footPitchDegR: 0, femurDegL: -24, tibiaDegL: -178, footPitchDegL: 40, shoulderFlexDeg: 0, shoulderAbdDeg: 12, elbowDeg: 10 }
      : { trunkDeg: -3, femurDegR: fr.femur, tibiaDegR: fr.tibia, footPitchDegR: 0, femurDegL: -22, tibiaDegL: -110, footPitchDegL: 60, shoulderFlexDeg: 0, shoulderAbdDeg: 12, elbowDeg: 10 };
    out.solve = { contacts: ['feet', 'knees'], anchor: 'footR' };
    out.primary = ['quads'];
    out.secondary = ['glutes', 'abs'];
    out.cues = CUE_HOLD(couch ? 'Rear shin up the wall, squeeze the glute of that leg, ribs down.' : 'Tuck the pelvis and squeeze the rear glute; feel the front of that hip open.');
    if (couch) {
      const s = S(hold, optsOf(out));
      out.props = [{ kind: 'box', x: 0, y: 1.0, z: Math.min(s.ankleL.z, s.kneeL.z) - 0.1, sx: 1.4, sy: 2, sz: 0.08 }];
    }
  } else {
    // warrior 1: deep front knee, straight back leg with heel down, arms overhead.
    const fr = legIK(RIG.ankleHeight - 0.72, 0.5 - 0.0);
    hold = { trunkDeg: 0, femurDegR: fr.femur, tibiaDegR: fr.tibia, footPitchDegR: 0, femurDegL: -30, tibiaDegL: -30, footPitchDegL: 0, shoulderFlexDeg: 172, shoulderAbdDeg: 8, elbowDeg: 4 };
    out.solve = { contacts: ['feet'], anchor: 'footR' };
    out.secondary = ['delt_front', 'abs', 'calves'];
    out.cues = CUE_HOLD('Front knee over the ankle, back leg long, arms reaching up.');
  }
  out.frames = [F(0, 0.5, hold), F(0.5, 0.55, { ...hold, trunkDeg: (hold.trunkDeg ?? 0) - 1.5 })];
  return out;
};

// ---------------------------------------------------------------------------
// 4. Push-up (hands planted)
// ---------------------------------------------------------------------------

const pushup = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'standard';
  const out: FamilyOut = {
    posture: 'floor',
    solve: { contacts: ['feet', 'hands'], anchor: 'feet' },
    frames: [],
    phases: 'rep',
    primary: ['pecs', 'triceps', 'delt_front'],
    secondary: ['abs', 'glutes', 'quads'],
    barAnchor: 'wrists',
    cues: CUE_REP(
      'Lower as one piece; elbows about 45 degrees from the body.',
      'Chest a fist from the floor; body line straight from head to heels.',
      'Push the floor away, keeping hips in line.',
      'Arms long, shoulder blades spread, glutes tight.',
    ),
  };
  const pike = v === 'pike';
  const decline = v === 'decline';
  const boxH = 0.42;
  // Build-time IK grounds on the feet only (or hands only for the decline);
  // runtime grounds on both, which is the same thing once the IK has converged.
  const ikOpts = optsOf({ ...out, solve: { contacts: decline ? ['hands'] : ['feet'], anchor: 'feet' } });
  const body: PoseIn = pike
    ? { trunkDeg: 0, femurDeg: 100, tibiaDeg: 100, footPitchDegL: -80, footPitchDegR: -80 }
    : { trunkDeg: 0, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 0, footPitchDegR: 0 };
  const abdAt = (_u: number) => 12;
  // Top: straight arms, solved pitch so the hands just reach the floor (or the toes the box).
  const armsStraight = (P: number): PoseIn => ({ ...body, rootPitchDeg: P, shoulderFlexDeg: pike ? 168 : P - 2, shoulderAbdDeg: abdAt(0), elbowDeg: 3 });
  let Ptop: number;
  if (decline) {
    Ptop = bisect((P) => toeBottom(S(armsStraight(P), ikOpts)) - boxH, 50, 100);
  } else if (pike) {
    Ptop = bisect((P) => handBottom(S(armsStraight(P), ikOpts), 'both'), 40, 120);
  } else {
    Ptop = bisect((P) => handBottom(S(armsStraight(P), ikOpts), 'both'), 45, 95);
  }
  const topPose = armsStraight(Ptop);
  const topS = S(topPose, ikOpts);
  const HR = topS.wristR;
  const F0 = { y: toeBottom(topS) };
  const frames: Frame[] = [];
  // Unknowns per elbow angle: body pitch, shoulder flexion and abduction; the
  // hands must stay exactly where they were planted (x, y, z), so the elbow
  // flare falls out of the geometry instead of being authored.
  let guess = [Ptop, topPose.shoulderFlexDeg!, abdAt(0)];
  const steps = 5;
  const solved: PoseIn[] = [topPose];
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const e = lerpN(3, pike ? 105 : 118, u);
    const sol = solveN(guess, ([Px, fx, ax]) => {
      const s = S({ ...body, rootPitchDeg: Px, shoulderFlexDeg: fx, shoulderAbdDeg: ax, elbowDeg: e }, ikOpts);
      const w = s.wristR;
      const second = decline ? toeBottom(s) - F0.y : w.y - HR.y;
      return [w.z - HR.z, second, w.x - HR.x];
    });
    guess = sol;
    solved.push({ ...body, rootPitchDeg: sol[0], shoulderFlexDeg: sol[1], shoulderAbdDeg: sol[2], elbowDeg: e });
  }
  frames.push(F(0, 0.4, solved[0]));
  for (let i = 1; i <= steps; i++) frames.push(F(0.46 * (i / steps), 0.4 + 0.5 * (i / steps), solved[i]));
  frames.push(F(0.56, 1, solved[steps]));
  for (let i = steps - 1; i >= 1; i--) frames.push(F(0.56 + 0.38 * ((steps - i) / steps), 0.4 + 0.6 * (i / steps), solved[i]));
  out.frames = frames;
  if (decline) {
    out.solve = { contacts: ['hands'], anchor: 'feet' };
    const s = S(solved[0], optsOf(out));
    out.props = [{ kind: 'box', x: 0, y: boxH / 2, z: (s.toeL.z + s.ankleL.z) / 2, sx: 0.6, sy: boxH, sz: 0.4 }];
    out.secondary = ['delt_front', 'abs', 'glutes'];
  }
  if (pike) {
    out.primary = ['delt_front', 'triceps', 'delt_side'];
    out.secondary = ['pecs', 'traps', 'abs'];
    out.cues = CUE_REP('Hips high; lower the crown of the head toward the floor between the hands.', 'Head just above the floor, elbows tracking back.', 'Press back up to the inverted V.', 'Arms locked, ears between the biceps.');
  }
  return out;
};

// ---------------------------------------------------------------------------
// 5. Bench press (supine) and forward presses (standing)
// ---------------------------------------------------------------------------

const benchPress = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'barbell';
  const out: FamilyOut = {
    posture: 'supine',
    supinePelvisY: 0.55,
    solve: {},
    frames: [],
    phases: 'rep',
    primary: ['pecs', 'triceps'],
    secondary: ['delt_front', 'lats', 'abs'],
    barAnchor: 'wrists',
    cues: CUE_REP(
      'Lower under control to the lower chest; elbows about 45 degrees.',
      'Touch, do not bounce. Upper back tight on the bench.',
      'Press up and slightly back over the shoulders.',
      'Elbows locked, shoulder blades still pinned.',
    ),
  };
  if (v === 'svend' || v === 'pallof') {
    out.posture = 'floor';
    out.solve = STAND;
    const chest: PoseIn = { trunkDeg: 2, femurDeg: 6, tibiaDeg: -4, legYawDegL: -12, legYawDegR: 12, shoulderFlexDeg: 30, shoulderAbdDeg: -12, elbowDeg: 135 };
    const outP: PoseIn = { ...chest, shoulderFlexDeg: 88, shoulderAbdDeg: -18, elbowDeg: 4 };
    out.frames = [F(0, 0.4, chest), F(0.42, 1, outP), F(0.56, 1, outP)];
    out.phases = 'pull';
    if (v === 'pallof') {
      out.cableAnchor = { x: 1.3, y: 1.25, z: 0.35 };
      out.primary = ['obliques', 'abs'];
      out.secondary = ['delt_front', 'glutes', 'pecs'];
      out.cues = { concentric: 'Press the handle straight out from the sternum; do not let it pull you round.', isometric: 'Hold the arms long and resist the rotation for a beat.', eccentric: 'Bring the handle back to the chest under control.', lockout: 'Square hips and shoulders to the front.' };
    } else {
      out.primary = ['pecs'];
      out.secondary = ['delt_front', 'triceps'];
      out.cues = { concentric: 'Squeeze the plate between the palms and press it straight out.', isometric: 'Keep squeezing hard at full reach.', eccentric: 'Bring it back to the chest, still squeezing.', lockout: 'Plate at the sternum, elbows bent.' };
    }
    return out;
  }
  const incline = v === 'incline' || v === 'inclinedb';
  const db = v === 'db' || v === 'inclinedb';
  const close = v === 'closegrip';
  const trunk = incline ? -52 : -86;
  // Arm vertical-up in the trunk frame: 90 on a flat bench, ~128 on the incline.
  const vertical = incline ? 124 : 92;
  const legs: PoseIn = incline ? { femurDeg: 60, tibiaDeg: -10 } : { femurDeg: 52, tibiaDeg: -40 };
  const top: PoseIn = { trunkDeg: trunk, ...legs, shoulderFlexDeg: vertical, shoulderAbdDeg: close ? 8 : db ? 22 : 18, elbowDeg: 4 };
  const bottom: PoseIn = {
    trunkDeg: trunk,
    ...legs,
    shoulderFlexDeg: incline ? 10 : -22,
    shoulderAbdDeg: close ? 18 : db ? 52 : 44,
    elbowDeg: close ? 118 : db ? 100 : 109,
  };
  const midP: PoseIn = { trunkDeg: trunk, ...legs, shoulderFlexDeg: (top.shoulderFlexDeg! + bottom.shoulderFlexDeg!) / 2 + 12, shoulderAbdDeg: (top.shoulderAbdDeg! + bottom.shoulderAbdDeg!) / 2, elbowDeg: 60 };
  out.frames = [F(0, 0.5, top), F(0.22, 0.7, midP), F(0.46, 0.95, bottom), F(0.55, 1, bottom), F(0.74, 0.9, midP)];
  if (incline) {
    out.props = [
      { kind: 'box', x: 0, y: 0.38, z: 0.02, sx: 0.33, sy: 0.085, sz: 0.4 },
      { kind: 'box', x: 0, y: 0.72, z: -0.24, sx: 0.33, sy: 0.085, sz: 0.75, pitchDeg: -38 },
      { kind: 'box', x: 0, y: 0.17, z: -0.05, sx: 0.3, sy: 0.34, sz: 0.3 },
    ];
    out.primary = ['pecs', 'delt_front'];
    out.secondary = ['triceps', 'abs'];
  }
  if (close) {
    out.primary = ['triceps', 'pecs'];
    out.cues.eccentric = 'Hands shoulder-width, elbows tucked close to the ribs.';
  }
  return out;
};

// ---------------------------------------------------------------------------
// 6. Overhead press
// ---------------------------------------------------------------------------

const overheadPress = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'barbell';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'pull',
    primary: ['delt_front', 'delt_side', 'triceps'],
    secondary: ['traps', 'abs', 'erectors', 'glutes'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Press straight up; move the head back, then through under the weight.',
      lockout: 'Arms locked overhead, biceps by the ears, ribs down.',
      eccentric: 'Lower under control to the shoulders, elbows under the wrists.',
      isometric: 'Rack position: forearms vertical, glutes and abs braced.',
    },
  };
  const legs: PoseIn = { trunkDeg: 1, femurDeg: 1, tibiaDeg: 1, legYawDegL: -8, legYawDegR: 8 };
  const rack: PoseIn = { ...legs, shoulderFlexDeg: v === 'db' ? 20 : 40, shoulderAbdDeg: v === 'db' ? 70 : 30, elbowDeg: v === 'db' ? 110 : 132 };
  const over: PoseIn = { ...legs, shoulderFlexDeg: 174, shoulderAbdDeg: v === 'db' ? 22 : 15, elbowDeg: 4 };
  if (v === 'arnold') {
    const start: PoseIn = { ...legs, shoulderFlexDeg: 75, shoulderAbdDeg: 8, elbowDeg: 145 };
    out.frames = [F(0, 0.4, start), F(0.18, 0.7, { ...legs, shoulderFlexDeg: 60, shoulderAbdDeg: 60, elbowDeg: 120 }), F(0.34, 0.9, { ...legs, shoulderFlexDeg: 120, shoulderAbdDeg: 40, elbowDeg: 60 }), F(0.46, 1, over), F(0.56, 0.9, over), F(0.76, 0.6, { ...legs, shoulderFlexDeg: 60, shoulderAbdDeg: 60, elbowDeg: 120 })];
    out.cues.isometric = 'Start with palms facing you, dumbbells in front of the face.';
    out.cues.concentric = 'Open the elbows out to the sides while pressing, palms turning forward.';
    return out;
  }
  if (v === 'kbcleanpress') {
    out.barAnchor = 'wristR';
    const legsW = { legYawDegL: 0, legYawDegR: 0 };
    const bottom: PoseIn = { trunkDeg: 55, femurDeg: 45, tibiaDeg: -16, ...legsW, shoulderFlexDegR: 55, shoulderAbdDegR: 4, elbowDegR: 4, shoulderFlexDegL: 40, shoulderAbdDegL: 25, elbowDegL: 10 };
    const rackR: PoseIn = { trunkDeg: 2, femurDeg: 2, tibiaDeg: 1, ...legsW, shoulderFlexDegR: 30, shoulderAbdDegR: 12, elbowDegR: 140, shoulderFlexDegL: 0, shoulderAbdDegL: 30, elbowDegL: 10 };
    const overR: PoseIn = { ...rackR, shoulderFlexDegR: 172, shoulderAbdDegR: 14, elbowDegR: 4 };
    out.frames = [F(0, 0.6, bottom), F(0.25, 0.9, rackR), F(0.35, 0.6, rackR), F(0.55, 1, overR), F(0.65, 0.8, overR), F(0.8, 0.5, rackR)];
    out.primary = ['delt_front', 'glutes', 'hamstrings'];
    out.secondary = ['triceps', 'delt_side', 'erectors', 'abs', 'forearms'];
    out.cues = { concentric: 'Hike, then clean the bell to the rack with a hip snap; press from the rack.', lockout: 'Lock out overhead, bicep by the ear.', eccentric: 'Lower to the rack, then let it swing back between the legs.', isometric: 'Rack: bell on the forearm, wrist straight, elbow tucked.' };
    return out;
  }
  out.frames = [F(0, 0.4, rack), F(0.2, 0.8, { ...legs, shoulderFlexDeg: 95, shoulderAbdDeg: (rack.shoulderAbdDeg! + over.shoulderAbdDeg!) / 2, elbowDeg: 85 }), F(0.46, 1, over), F(0.56, 0.9, over), F(0.76, 0.6, { ...legs, shoulderFlexDeg: 110, shoulderAbdDeg: (rack.shoulderAbdDeg! + over.shoulderAbdDeg!) / 2, elbowDeg: 70 })];
  return out;
};

// ---------------------------------------------------------------------------
// 7. Rows (horizontal pull)
// ---------------------------------------------------------------------------

const row = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'barbell';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'pull',
    primary: ['lats', 'traps', 'delt_rear'],
    secondary: ['biceps', 'forearms', 'erectors'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Lead with the elbows; pull to the lower ribs.',
      isometric: 'Squeeze the shoulder blades together for a beat.',
      eccentric: 'Let the weight travel out under control; torso stays still.',
      lockout: 'Arms long, lats still loaded.',
    },
  };
  if (v === 'barbell' || v === 'db') {
    const T = 45;
    const legs: PoseIn = { trunkDeg: T, femurDeg: 22, tibiaDeg: -8, legYawDegL: -8, legYawDegR: 8 };
    const down: PoseIn = { ...legs, shoulderFlexDeg: T, shoulderAbdDeg: v === 'db' ? 8 : 20, elbowDeg: 3 };
    const up: PoseIn = { ...legs, shoulderFlexDeg: -62, shoulderAbdDeg: v === 'db' ? 14 : 28, elbowDeg: 122 };
    out.frames = [F(0, 0.45, down), F(0.22, 0.75, { ...legs, shoulderFlexDeg: -8, shoulderAbdDeg: 24, elbowDeg: 80 }), F(0.46, 1, up), F(0.56, 1, up), F(0.78, 0.7, { ...legs, shoulderFlexDeg: -8, shoulderAbdDeg: 24, elbowDeg: 80 })];
    out.secondary.push('hamstrings', 'glutes');
    return out;
  }
  if (v === 'single') {
    out.barAnchor = 'wristR';
    const T = 72;
    const base: PoseIn = { trunkDeg: T, femurDegR: 10, tibiaDegR: 0, femurDegL: 35, tibiaDegL: -10, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDegL: T + 2, shoulderAbdDegL: 6, elbowDegL: 4 };
    const down: PoseIn = { ...base, shoulderFlexDegR: T, shoulderAbdDegR: 8, elbowDegR: 3 };
    const up: PoseIn = { ...base, shoulderFlexDegR: -45, shoulderAbdDegR: 12, elbowDegR: 110 };
    out.frames = [F(0, 0.45, down), F(0.46, 1, up), F(0.56, 1, up)];
    const s = S(down, optsOf(out));
    const top = Math.min(s.handL.y - 0.025, s.wristL.y - 0.035);
    out.props = [{ kind: 'box', x: s.handL.x, y: top / 2, z: s.handL.z, sx: 0.36, sy: top, sz: 0.6 }];
    return out;
  }
  if (v === 'seated' || v === 'rowmachine') {
    out.solve = { contacts: ['pelvis', 'feet'], anchor: v === 'rowmachine' ? 'feet' : 'pelvis' };
    const legsLong: PoseIn = { femurDeg: 82, tibiaDeg: 70, footPitchDegL: -55, footPitchDegR: -55 };
    if (v === 'seated') {
      const reach: PoseIn = { trunkDeg: 8, ...legsLong, shoulderFlexDeg: 82, shoulderAbdDeg: 10, elbowDeg: 3 };
      const pull: PoseIn = { trunkDeg: -6, ...legsLong, shoulderFlexDeg: -30, shoulderAbdDeg: 12, elbowDeg: 110 };
      out.frames = [F(0, 0.45, reach), F(0.46, 1, pull), F(0.56, 1, pull)];
      out.cableAnchor = { x: 0, y: 0.4, z: 1.5 };
      return out;
    }
    // Ergometer stroke: catch -> legs drive -> body swing -> arms; reverse to recover.
    const catchP: PoseIn = { trunkDeg: 22, femurDeg: 122, tibiaDeg: 10, footPitchDegL: -40, footPitchDegR: -40, shoulderFlexDeg: 70, shoulderAbdDeg: 8, elbowDeg: 3 };
    const legsDone: PoseIn = { trunkDeg: 22, ...legsLong, shoulderFlexDeg: 75, shoulderAbdDeg: 8, elbowDeg: 3 };
    const finish: PoseIn = { trunkDeg: -20, ...legsLong, shoulderFlexDeg: -40, shoulderAbdDeg: 18, elbowDeg: 115 };
    out.frames = [F(0, 0.6, catchP), F(0.2, 1, legsDone), F(0.38, 0.9, finish), F(0.5, 0.5, finish), F(0.68, 0.4, legsDone)];
    out.phases = 'cycle';
    out.primary = ['quads', 'lats', 'glutes'];
    out.secondary = ['hamstrings', 'biceps', 'erectors', 'delt_rear'];
    out.cues = CUE_CYCLE('Drive: legs, then body swing back, then arms to the lower ribs.', 'Recover: arms away, body forward, then bend the knees.');
    return out;
  }
  if (v === 'facepull' || v === 'upright') {
    const legs: PoseIn = { trunkDeg: v === 'facepull' ? -6 : 1, femurDeg: 4, tibiaDeg: 0, legYawDegL: -10, legYawDegR: 10 };
    if (v === 'facepull') {
      const reach: PoseIn = { ...legs, shoulderFlexDeg: 88, shoulderAbdDeg: 8, elbowDeg: 4 };
      const pull: PoseIn = { ...legs, shoulderFlexDeg: 40, shoulderAbdDeg: 80, elbowDeg: 110 };
      out.frames = [F(0, 0.45, reach), F(0.46, 1, pull), F(0.56, 1, pull)];
      out.cableAnchor = { x: 0, y: 1.7, z: 1.4 };
      out.primary = ['delt_rear', 'traps'];
      out.secondary = ['delt_side', 'biceps', 'lats'];
      out.cues.concentric = 'Pull the rope to the face, hands splitting apart past the ears.';
      return out;
    }
    const down: PoseIn = { ...legs, shoulderFlexDeg: 6, shoulderAbdDeg: 6, elbowDeg: 8 };
    const up: PoseIn = { ...legs, shoulderFlexDeg: 22, shoulderAbdDeg: 78, elbowDeg: 140 };
    out.frames = [F(0, 0.45, down), F(0.46, 1, up), F(0.56, 1, up)];
    out.primary = ['delt_side', 'traps'];
    out.secondary = ['delt_front', 'biceps', 'forearms'];
    out.cues.concentric = 'Lead with the elbows up and out; hands stay close to the body.';
    out.cues.isometric = 'Elbows at shoulder height, no higher.';
    return out;
  }
  if (v === 'shrug') {
    const base: PoseIn = { trunkDeg: 1, femurDeg: 1, tibiaDeg: 1, shoulderFlexDeg: 0, shoulderAbdDeg: 8, elbowDeg: 3 };
    out.frames = [F(0, 0.5, base), F(0.45, 1, { ...base, neckDeg: -4, shoulderAbdDeg: 12 }), F(0.55, 1, { ...base, neckDeg: -4, shoulderAbdDeg: 12 })];
    out.armsFollowGravity = true;
    out.primary = ['traps'];
    out.secondary = ['forearms'];
    out.cues = { concentric: 'Lift the shoulders straight up toward the ears.', isometric: 'Hold at the top for a second.', eccentric: 'Lower fully to a long neck.', lockout: 'Arms hang straight; no elbow bend.' };
    return out;
  }
  // Inverted row: rigid body pivoting on the heels, hands on a bar.
  const barY = 1.0;
  out.solve = { contacts: ['feet'], anchor: 'feet' };
  const ik = optsOf(out);
  const body: PoseIn = { trunkDeg: 0, femurDeg: 0, tibiaDeg: 0, footPitchDegL: -40, footPitchDegR: -40, shoulderAbdDeg: 20 };
  // Bottom: straight arms vertical up from the chest to the bar.
  const bottomFor = (P: number): PoseIn => ({ ...body, rootPitchDeg: P, shoulderFlexDeg: 90 + (-90 - P), elbowDeg: 3 });
  const Pb = bisect((P) => mid(S(bottomFor(P), ik).wristL, S(bottomFor(P), ik).wristR).y - barY, -40, -88);
  const bottom = bottomFor(Pb);
  const sb = S(bottom, ik);
  const H = mid(sb.wristL, sb.wristR);
  const steps = 4;
  const sols: PoseIn[] = [bottom];
  let guess: [number, number] = [Pb, bottom.shoulderFlexDeg!];
  for (let i = 1; i <= steps; i++) {
    const e = lerpN(3, 115, i / steps);
    const [P, f] = solveN(guess, ([Px, fx]) => {
      const s = S({ ...body, rootPitchDeg: Px, shoulderFlexDeg: fx, elbowDeg: e }, ik);
      const w = mid(s.wristL, s.wristR);
      return [w.y - H.y, w.z - H.z];
    });
    guess = [P, f];
    sols.push({ ...body, rootPitchDeg: P, shoulderFlexDeg: f, elbowDeg: e });
  }
  out.frames = [F(0, 0.45, sols[0])];
  for (let i = 1; i <= steps; i++) out.frames.push(F(0.46 * (i / steps), 0.45 + 0.55 * (i / steps), sols[i]));
  out.frames.push(F(0.56, 1, sols[steps]));
  for (let i = steps - 1; i >= 1; i--) out.frames.push(F(0.56 + 0.38 * ((steps - i) / steps), 0.5, sols[i]));
  out.props = [{ kind: 'bar', x: 0, y: H.y + 0.01, z: H.z, sx: 1.2, sy: 0.03, sz: 0.03 }];
  return out;
};

// ---------------------------------------------------------------------------
// 8. Vertical pull
// ---------------------------------------------------------------------------

const verticalPull = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'pullup';
  const out: FamilyOut = {
    posture: 'hanging',
    solve: { anchor: 'hands', barY: 2.3 },
    frames: [],
    phases: 'pull',
    primary: ['lats', 'biceps'],
    secondary: ['traps', 'delt_rear', 'forearms', 'abs'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Drive the elbows down to the ribs; chest to the bar.',
      isometric: 'Chin over the bar, shoulder blades down and back.',
      eccentric: 'Lower all the way under control.',
      lockout: 'Dead hang: arms straight, shoulders engaged.',
    },
  };
  const legs: PoseIn = { femurDeg: 12, tibiaDeg: -30, footPitchDegL: 20, footPitchDegR: 20 };
  if (v === 'pullup' || v === 'chinup') {
    const abd = v === 'pullup' ? 28 : 12;
    const hang: PoseIn = { trunkDeg: -4, ...legs, shoulderFlexDeg: 172, shoulderAbdDeg: abd, elbowDeg: 4 };
    const top: PoseIn = { trunkDeg: -12, ...legs, shoulderFlexDeg: 8, shoulderAbdDeg: abd + 10, elbowDeg: 132 };
    out.frames = [F(0, 0.5, hang), F(0.22, 0.85, { ...hang, shoulderFlexDeg: 95, elbowDeg: 75, trunkDeg: -8 }), F(0.46, 1, top), F(0.56, 1, top), F(0.78, 0.7, { ...hang, shoulderFlexDeg: 95, elbowDeg: 75, trunkDeg: -8 })];
    out.props = [{ kind: 'bar', x: 0, y: 2.3, z: 0, sx: 1.3, sy: 0.035, sz: 0.035 }];
    if (v === 'chinup') out.primary = ['biceps', 'lats'];
    return out;
  }
  if (v === 'pulldown') {
    out.posture = 'supine';
    out.supinePelvisY = 0.55;
    out.solve = {};
    const seat: PoseIn = { trunkDeg: -10, femurDeg: 88, tibiaDeg: -10 };
    const top: PoseIn = { ...seat, shoulderFlexDeg: 170, shoulderAbdDeg: 25, elbowDeg: 4 };
    const bottom: PoseIn = { ...seat, shoulderFlexDeg: 2, shoulderAbdDeg: 35, elbowDeg: 140 };
    out.frames = [F(0, 0.45, top), F(0.46, 1, bottom), F(0.56, 1, bottom)];
    out.cableAnchor = { x: 0, y: 2.4, z: 0.15 };
    out.cues.concentric = 'Pull the bar to the upper chest, elbows down and back.';
    out.cues.isometric = 'Bar at the collarbones, chest up.';
    return out;
  }
  // Straight-arm pulldown: standing, hinge slightly, arms stay long.
  out.posture = 'floor';
  out.solve = STAND;
  const legs2: PoseIn = { trunkDeg: 25, femurDeg: 18, tibiaDeg: -6, legYawDegL: -8, legYawDegR: 8 };
  const up: PoseIn = { ...legs2, shoulderFlexDeg: 140, shoulderAbdDeg: 10, elbowDeg: 10 };
  // Finish with the bar at the front of the thighs. Flex is measured from the
  // leaning trunk, so -8 put the hands BEHIND the hips and ran the cable
  // through the torso.
  const down: PoseIn = { ...legs2, shoulderFlexDeg: 20, shoulderAbdDeg: 10, elbowDeg: 8 };
  out.frames = [F(0, 0.45, up), F(0.46, 1, down), F(0.56, 1, down)];
  out.cableAnchor = { x: 0, y: 2.0, z: 1.1 };
  out.primary = ['lats'];
  out.secondary = ['triceps', 'abs', 'delt_rear'];
  out.cues.concentric = 'Sweep the bar down in an arc to the thighs; elbows stay soft but fixed.';
  return out;
};

// ---------------------------------------------------------------------------
// 9. Curl
// ---------------------------------------------------------------------------

const curl = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'standard';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'pull',
    primary: ['biceps'],
    secondary: ['forearms', 'delt_front'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Curl up; elbows pinned to the sides, upper arm still.',
      isometric: 'Squeeze at the top without letting the elbows drift forward.',
      eccentric: 'Lower slowly to a full stretch.',
      lockout: 'Arms nearly straight, tension kept.',
    },
  };
  const legs: PoseIn = { trunkDeg: 1, femurDeg: 1, tibiaDeg: 1, legYawDegL: -8, legYawDegR: 8 };
  if (v === 'preacher') {
    out.posture = 'supine';
    out.supinePelvisY = 0.55;
    out.solve = {};
    const seat: PoseIn = { trunkDeg: 14, femurDeg: 88, tibiaDeg: -8 };
    const down: PoseIn = { ...seat, shoulderFlexDeg: 55, shoulderAbdDeg: 12, elbowDeg: 12 };
    const up: PoseIn = { ...down, elbowDeg: 128 };
    out.frames = [F(0, 0.4, down), F(0.46, 1, up), F(0.56, 1, up)];
    const s = S(down, optsOf(out));
    out.props = [{ kind: 'box', x: 0, y: s.elbowR.y - 0.12, z: (s.shoulderR.z + s.elbowR.z) / 2 + 0.02, sx: 0.5, sy: 0.08, sz: 0.3, pitchDeg: 55 }];
    return out;
  }
  if (v === 'concentration') {
    out.barAnchor = 'wristR';
    out.posture = 'supine';
    out.supinePelvisY = 0.55;
    out.solve = {};
    const seat: PoseIn = { trunkDeg: 40, femurDeg: 88, tibiaDeg: -8, legYawDegL: -25, legYawDegR: 25, shoulderFlexDegL: 50, shoulderAbdDegL: 10, elbowDegL: 60 };
    const down: PoseIn = { ...seat, shoulderFlexDegR: 40, shoulderAbdDegR: 8, elbowDegR: 10 };
    const up: PoseIn = { ...down, elbowDegR: 140 };
    out.frames = [F(0, 0.4, down), F(0.46, 1, up), F(0.56, 1, up)];
    return out;
  }
  const down: PoseIn = { ...legs, shoulderFlexDeg: 2, shoulderAbdDeg: 8, elbowDeg: 10 };
  const up: PoseIn = { ...legs, shoulderFlexDeg: 8, shoulderAbdDeg: 8, elbowDeg: 140 };
  out.frames = [F(0, 0.4, down), F(0.22, 0.8, { ...down, elbowDeg: 75 }), F(0.46, 1, up), F(0.56, 1, up), F(0.78, 0.7, { ...down, elbowDeg: 75 })];
  if (v === 'hammer') out.primary = ['biceps', 'forearms'];
  if (v === 'band') out.cableAnchor = { x: 0, y: 0.03, z: 0.12 };
  return out;
};

// ---------------------------------------------------------------------------
// 10. Triceps
// ---------------------------------------------------------------------------

const triceps = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'pushdown';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'pull',
    primary: ['triceps'],
    secondary: ['delt_front', 'forearms'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Extend the elbow fully; the upper arm does not move.',
      isometric: 'Squeeze the triceps at lockout.',
      eccentric: 'Bend the elbow under control back to the stretch.',
      lockout: 'Elbow bent, upper arm fixed.',
    },
  };
  const legs: PoseIn = { trunkDeg: 6, femurDeg: 4, tibiaDeg: 0, legYawDegL: -8, legYawDegR: 8 };
  const rep = (bent: PoseIn, straight: PoseIn) => {
    out.frames = [F(0, 0.4, bent), F(0.46, 1, straight), F(0.56, 1, straight)];
  };
  switch (v) {
    case 'overhead':
      rep({ ...legs, trunkDeg: 1, shoulderFlexDeg: 165, shoulderAbdDeg: 10, elbowDeg: 135 }, { ...legs, trunkDeg: 1, shoulderFlexDeg: 170, shoulderAbdDeg: 10, elbowDeg: 6 });
      out.cues.isometric = 'Arms straight overhead, elbows pointing forward.';
      return out;
    case 'pushdown':
      // Elbows pinned a little in front of the ribs, not hanging straight: the
      // cable ends at the midpoint of the hands, and with the arms vertical
      // that point sat inside the pelvis at lockout (cable through the body).
      rep({ ...legs, trunkDeg: 10, shoulderFlexDeg: 18, shoulderAbdDeg: 6, elbowDeg: 100 }, { ...legs, trunkDeg: 10, shoulderFlexDeg: 18, shoulderAbdDeg: 6, elbowDeg: 4 });
      out.cableAnchor = { x: 0, y: 2.0, z: 0.45 };
      return out;
    case 'kickback':
      rep({ ...legs, trunkDeg: 60, femurDeg: 25, tibiaDeg: -8, shoulderFlexDeg: -30, shoulderAbdDeg: 8, elbowDeg: 100 }, { ...legs, trunkDeg: 60, femurDeg: 25, tibiaDeg: -8, shoulderFlexDeg: -32, shoulderAbdDeg: 8, elbowDeg: 4 });
      return out;
    case 'skull': {
      out.posture = 'supine';
      out.supinePelvisY = 0.55;
      out.solve = {};
      const base: PoseIn = { trunkDeg: -86, femurDeg: 52, tibiaDeg: -40, shoulderAbdDeg: 8 };
      rep({ ...base, shoulderFlexDeg: 108, elbowDeg: 120 }, { ...base, shoulderFlexDeg: 100, elbowDeg: 4 });
      out.cues.eccentric = 'Lower the weight toward the forehead, elbows pointing at the ceiling.';
      return out;
    }
    default: {
      // Dips: hands pinned on parallel bars, body lowers.
      out.posture = 'hanging';
      out.solve = { anchor: 'hands', barY: 1.38 };
      const chest = v === 'chestdip';
      const legsD: PoseIn = { femurDeg: 25, tibiaDeg: -70, footPitchDegL: 20, footPitchDegR: 20 };
      const top: PoseIn = { trunkDeg: chest ? 18 : 4, ...legsD, shoulderFlexDeg: chest ? 16 : 4, shoulderAbdDeg: 10, elbowDeg: 4 };
      const bottom: PoseIn = { trunkDeg: chest ? 30 : 8, ...legsD, shoulderFlexDeg: -48, shoulderAbdDeg: chest ? 22 : 12, elbowDeg: 95 };
      out.frames = [F(0, 0.4, top), F(0.46, 1, bottom), F(0.56, 1, bottom)];
      out.phases = 'rep';
      out.primary = chest ? ['pecs', 'triceps'] : ['triceps', 'pecs'];
      out.secondary = ['delt_front', 'abs'];
      const s = S(top, optsOf(out));
      // Two parallel rails under the hands, each on a pair of thin posts.
      const railY = s.handL.y - 0.03;
      out.props = [];
      for (const hx of [s.handL.x - 0.01, s.handR.x + 0.01]) {
        out.props.push({ kind: 'box', x: hx, y: railY, z: s.handL.z, sx: 0.04, sy: 0.04, sz: 0.7 });
        for (const dz of [-0.33, 0.33]) out.props.push({ kind: 'box', x: hx, y: railY / 2, z: s.handL.z + dz, sx: 0.04, sy: railY, sz: 0.04 });
      }
      out.cues = CUE_REP('Lower until the upper arm is about parallel to the floor.', 'Shoulders stay down, away from the ears.', 'Press back up to straight arms.', 'Locked out, chest proud.');
      return out;
    }
  }
};

// ---------------------------------------------------------------------------
// 11. Raises & flyes
// ---------------------------------------------------------------------------

const raise = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'lateral';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'pull',
    primary: ['delt_side'],
    secondary: ['traps', 'delt_front'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Raise with soft elbows to shoulder height — no swinging.',
      isometric: 'Pause at the top, little finger slightly up.',
      eccentric: 'Lower slower than you lifted.',
      lockout: 'Arms just off the sides, tension kept.',
    },
  };
  const legs: PoseIn = { trunkDeg: 2, femurDeg: 2, tibiaDeg: 0, legYawDegL: -8, legYawDegR: 8 };
  const rep = (a: PoseIn, b: PoseIn) => {
    out.frames = [F(0, 0.35, a), F(0.46, 1, b), F(0.56, 1, b)];
  };
  switch (v) {
    case 'front':
      rep({ ...legs, shoulderFlexDeg: 4, shoulderAbdDeg: 6, elbowDeg: 10 }, { ...legs, shoulderFlexDeg: 92, shoulderAbdDeg: 6, elbowDeg: 10 });
      out.primary = ['delt_front'];
      out.secondary = ['delt_side', 'pecs', 'traps'];
      return out;
    case 'rear': {
      const T = 70;
      const bent: PoseIn = { trunkDeg: T, femurDeg: 20, tibiaDeg: -6, legYawDegL: -8, legYawDegR: 8 };
      rep({ ...bent, shoulderFlexDeg: T, shoulderAbdDeg: 6, elbowDeg: 15 }, { ...bent, shoulderFlexDeg: T - 5, shoulderAbdDeg: 82, elbowDeg: 15 });
      out.primary = ['delt_rear'];
      out.secondary = ['traps', 'lats'];
      return out;
    }
    case 'fly': {
      out.posture = 'supine';
      out.supinePelvisY = 0.55;
      out.solve = {};
      const base: PoseIn = { trunkDeg: -86, femurDeg: 52, tibiaDeg: -40 };
      rep({ ...base, shoulderFlexDeg: 92, shoulderAbdDeg: 82, elbowDeg: 20 }, { ...base, shoulderFlexDeg: 92, shoulderAbdDeg: 4, elbowDeg: 15 });
      out.primary = ['pecs'];
      out.secondary = ['delt_front', 'biceps'];
      out.cues.concentric = 'Hug a tree: bring the dumbbells together over the chest.';
      out.cues.lockout = 'Open wide with a slight elbow bend until the chest stretches.';
      return out;
    }
    case 'crossover': {
      const lean: PoseIn = { ...legs, trunkDeg: 15, femurDeg: 10 };
      rep({ ...lean, shoulderFlexDeg: 55, shoulderAbdDeg: 85, elbowDeg: 15 }, { ...lean, shoulderFlexDeg: 60, shoulderAbdDeg: -10, elbowDeg: 12 });
      // One cable line is drawn, so it is the right hand's, from a high pulley
      // out to the right. A single line to the midpoint of two wide-open hands
      // sat inside the chest and ran through the head.
      out.barAnchor = 'wristR';
      out.cableAnchor = { x: 1.15, y: 2.1, z: -0.15 };
      out.primary = ['pecs'];
      out.secondary = ['delt_front'];
      out.cues.concentric = 'Sweep the handles down and together in front of the hips.';
      return out;
    }
    default:
      rep({ ...legs, shoulderFlexDeg: 8, shoulderAbdDeg: 8, elbowDeg: 15 }, { ...legs, shoulderFlexDeg: 12, shoulderAbdDeg: 85, elbowDeg: 15 });
      return out;
  }
};

// ---------------------------------------------------------------------------
// 12. Core (supine / seated / standing trunk work)
// ---------------------------------------------------------------------------

const SUPINE: ClipSolveExtras = { contacts: ['pelvis', 'back', 'head', 'feet'], anchor: 'pelvis' };

const core = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'crunch';
  const out: FamilyOut = {
    posture: 'floor',
    solve: SUPINE,
    frames: [],
    phases: 'pull',
    primary: ['abs'],
    secondary: ['obliques', 'quads'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Exhale and curl the ribs toward the pelvis.',
      isometric: 'Hold the squeeze; lower back stays down.',
      eccentric: 'Lower with control — no flopping.',
      lockout: 'Reset, abs still braced.',
    },
  };
  const lying = -90;
  switch (v) {
    case 'toetouch': {
      const base: PoseIn = { rootPitchDeg: lying, femurDeg: 88, tibiaDeg: 88, footPitchDegL: -30, footPitchDegR: -30 };
      out.frames = [F(0, 0.4, { ...base, trunkDeg: 0, shoulderFlexDeg: 95, elbowDeg: 4 }), F(0.46, 1, { ...base, trunkDeg: 32, shoulderFlexDeg: 95, elbowDeg: 4 }), F(0.56, 1, { ...base, trunkDeg: 32, shoulderFlexDeg: 95, elbowDeg: 4 })];
      out.cues.concentric = 'Legs vertical; reach the fingertips up toward the toes.';
      return out;
    }
    case 'cablecrunch': {
      out.solve = { contacts: ['knees', 'feet'], anchor: 'feet' };
      const kneel: PoseIn = { femurDeg: 5, tibiaDeg: -88, footPitchDegL: 70, footPitchDegR: 70, shoulderFlexDeg: 150, shoulderAbdDeg: 25, elbowDeg: 150 };
      out.frames = [F(0, 0.4, { ...kneel, trunkDeg: 12 }), F(0.46, 1, { ...kneel, trunkDeg: 70, shoulderFlexDeg: 120 }), F(0.56, 1, { ...kneel, trunkDeg: 70, shoulderFlexDeg: 120 })];
      out.cableAnchor = { x: 0, y: 2.1, z: 0.1 };
      out.cues.concentric = 'Crunch the elbows toward the knees; hips stay still.';
      return out;
    }
    case 'russian': {
      out.solve = { contacts: ['pelvis', 'feet'], anchor: 'pelvis' };
      out.phases = 'cycle';
      const base: PoseIn = { trunkDeg: -38, femurDeg: 75, tibiaDeg: -5, footPitchDegL: 10, footPitchDegR: 10, shoulderFlexDeg: 75, shoulderAbdDeg: 5, elbowDeg: 70 };
      out.frames = [F(0, 0.6, base), F(0.25, 1, { ...base, trunkTwistDeg: 40 }), F(0.5, 0.6, base), F(0.75, 1, { ...base, trunkTwistDeg: -40 })];
      out.primary = ['obliques', 'abs'];
      out.secondary = ['quads', 'erectors'];
      out.cues = CUE_CYCLE('Rotate from the ribs, hands travelling to the hip.', 'Return through the middle, chest tall.');
      return out;
    }
    case 'deadbug': {
      out.phases = 'cycle';
      const base: PoseIn = { rootPitchDeg: lying, trunkDeg: 0, femurDeg: 88, tibiaDeg: -2, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 90, shoulderAbdDeg: 8, elbowDeg: 4 };
      const reachA: PoseIn = { ...base, shoulderFlexDegR: 172, femurDegL: 12, tibiaDegL: 10 };
      out.frames = [F(0, 0.5, base), F(0.25, 1, reachA), F(0.5, 0.5, base), F(0.75, 1, mirror(reachA))];
      out.secondary = ['obliques', 'quads', 'delt_front'];
      out.cues = CUE_CYCLE('Opposite arm and leg reach long; lower back pressed down.', 'Return to tabletop and switch sides.');
      return out;
    }
    case 'flutter': {
      out.phases = 'cycle';
      const base: PoseIn = { rootPitchDeg: lying, trunkDeg: 6, footPitchDegL: 30, footPitchDegR: 30, shoulderFlexDeg: -5, shoulderAbdDeg: 12, elbowDeg: 4 };
      const legs = (a: number): PoseIn => ({ femurDegL: 22 + a, tibiaDegL: 22 + a, femurDegR: 22 - a, tibiaDegR: 22 - a });
      out.frames = [F(0, 0.8, { ...base, ...legs(0) }), F(0.25, 1, { ...base, ...legs(12) }), F(0.5, 0.8, { ...base, ...legs(0) }), F(0.75, 1, { ...base, ...legs(-12) })];
      out.cues = CUE_CYCLE('Small, fast kicks from the hips; legs straight.', 'Lower back stays glued to the floor.');
      return out;
    }
    case 'legraise':
    case 'hanginglegraise': {
      const hanging = v === 'hanginglegraise';
      if (hanging) {
        out.posture = 'hanging';
        out.solve = { anchor: 'hands', barY: 2.3 };
        out.props = [{ kind: 'bar', x: 0, y: 2.3, z: 0, sx: 1.3, sy: 0.035, sz: 0.035 }];
      }
      const arms: PoseIn = hanging ? { shoulderFlexDeg: 172, shoulderAbdDeg: 22, elbowDeg: 4 } : { shoulderFlexDeg: -4, shoulderAbdDeg: 14, elbowDeg: 4 };
      const root: PoseIn = hanging ? { trunkDeg: -4 } : { rootPitchDeg: lying, trunkDeg: 0 };
      const down: PoseIn = { ...root, ...arms, femurDeg: hanging ? 4 : 4, tibiaDeg: 4, footPitchDegL: 25, footPitchDegR: 25 };
      const up: PoseIn = { ...root, ...arms, femurDeg: hanging ? 95 : 88, tibiaDeg: hanging ? 90 : 88, footPitchDegL: 25, footPitchDegR: 25 };
      out.frames = [F(0, 0.4, down), F(0.46, 1, up), F(0.56, 1, up)];
      out.secondary = ['quads', 'obliques', 'forearms'];
      out.cues.concentric = hanging ? 'Raise straight legs to hip height without swinging.' : 'Lift straight legs to vertical; lower back stays down.';
      return out;
    }
    case 'vup': {
      const down: PoseIn = { rootPitchDeg: lying, trunkDeg: 0, femurDeg: 4, tibiaDeg: 4, footPitchDegL: 25, footPitchDegR: 25, shoulderFlexDeg: 170, shoulderAbdDeg: 10, elbowDeg: 4 };
      const up: PoseIn = { ...down, trunkDeg: 55, femurDeg: 62, tibiaDeg: 62, shoulderFlexDeg: 92 };
      out.frames = [F(0, 0.4, down), F(0.46, 1, up), F(0.56, 1, up)];
      out.solve = { contacts: ['pelvis', 'back', 'head', 'feet'], anchor: 'pelvis' };
      out.cues.concentric = 'Lift arms and straight legs together; balance on the glutes and touch the shins.';
      return out;
    }
    case 'hollow': {
      out.phases = 'hold';
      const h: PoseIn = { rootPitchDeg: lying, trunkDeg: 20, femurDeg: 22, tibiaDeg: 22, footPitchDegL: 30, footPitchDegR: 30, shoulderFlexDeg: 165, shoulderAbdDeg: 8, elbowDeg: 4 };
      out.frames = [F(0, 0.9, h), F(0.5, 0.95, { ...h, trunkDeg: 21, femurDeg: 21, tibiaDeg: 21 })];
      out.cues = CUE_HOLD('Lower back pressed into the floor, shoulders and legs hovering.');
      return out;
    }
    default: {
      // side bend (standing, one dumbbell in the right hand)
      out.solve = STAND;
      out.phases = 'cycle';
      out.barAnchor = 'wristR';
      const base: PoseIn = { trunkDeg: 1, femurDeg: 1, tibiaDeg: 0, legYawDegL: -10, legYawDegR: 10, shoulderFlexDeg: 0, shoulderAbdDeg: 6, elbowDeg: 6 };
      out.frames = [F(0, 0.5, base), F(0.3, 0.8, { ...base, trunkSideDeg: 24 }), F(0.65, 1, { ...base, trunkSideDeg: -14 })];
      out.primary = ['obliques'];
      out.secondary = ['abs', 'erectors'];
      out.cues = CUE_CYCLE('Bend straight sideways, the dumbbell sliding down the leg.', 'Pull back up past the middle with the opposite obliques.');
      return out;
    }
  }
};

// ---------------------------------------------------------------------------
// 13. Plank family (hands/forearms planted, quadruped)
// ---------------------------------------------------------------------------

/**
 * Kneeling feet: toes tucked under, so the shin rises from the knee until the
 * tucked toes just reach the floor (a flat shin would push the foot through it).
 * Only valid when the knees are the floor contact, not the feet.
 */
const tuckToes = (q: PoseIn, o: SolveOptions): PoseIn => {
  let out = { ...q };
  for (const side of ['L', 'R'] as const) {
    const fk = side === 'L' ? 'femurDegL' : 'femurDegR';
    const tk = side === 'L' ? 'tibiaDegL' : 'tibiaDegR';
    const pk = side === 'L' ? 'footPitchDegL' : 'footPitchDegR';
    const femur = (out[fk] as number | undefined) ?? out.femurDeg ?? 0;
    const at = (t: number): PoseIn => ({ ...out, [tk]: t, [pk]: -t - 25 });
    const toe = (t: number) => {
      const sk = S(at(t), o);
      return (side === 'L' ? sk.toeL.y : sk.toeR.y) - TOE_CONTACT * 0.5;
    };
    const t = bisect(toe, femur - 150, femur - 60);
    out = at(t);
  }
  return out;
};

/** Quadruped base: hands under shoulders and knees under hips, solved pitch. */
const quadruped = (o: SolveOptions, knees = true): PoseIn => {
  const base = (P: number): PoseIn => ({
    trunkDeg: 0,
    femurDeg: knees ? 90 : 75,
    tibiaDeg: knees ? 0 : 0,
    footPitchDegL: knees ? 72 : -30,
    footPitchDegR: knees ? 72 : -30,
    rootPitchDeg: P,
    shoulderFlexDeg: P,
    shoulderAbdDeg: 8,
    elbowDeg: 4,
  });
  const P = bisect((x) => {
    const s = S(base(x), o);
    return handBottom(s, 'both') - (knees ? Math.min(s.kneeL.y, s.kneeR.y) - 0.055 : toeBottom(s));
  }, 60, 110);
  return base(P);
  // (knees: laces-down feet; hovering bear-crawl knees: toes tucked)
};

const plank = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'plank';
  const out: FamilyOut = {
    posture: 'floor',
    solve: { anchor: 'feet' },
    frames: [],
    phases: 'hold',
    primary: ['abs', 'obliques'],
    secondary: ['delt_front', 'glutes', 'quads'],
    barAnchor: 'wrists',
    cues: CUE_HOLD('Straight line from head to heels; squeeze the glutes, brace the abs.'),
  };
  const o = optsOf(out);
  if (v === 'plank' || v === 'side') {
    if (v === 'plank') {
      const forearm = (P: number): PoseIn => ({ trunkDeg: 0, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 0, footPitchDegR: 0, rootPitchDeg: P, shoulderFlexDeg: P - 2, shoulderAbdDeg: 12, elbowDeg: 92 });
      const P = bisect((x) => {
        const s = S(forearm(x), { ...o, contacts: ['feet'] });
        return Math.min(s.elbowL.y, s.elbowR.y) - 0.05;
      }, 60, 90);
      const h = forearm(P);
      out.frames = [F(0, 0.8, h), F(0.5, 0.85, { ...h, rootPitchDeg: P + 0.4, shoulderFlexDeg: P - 1.6 })];
      return out;
    }
    // Side plank on the right forearm: upright body rolled onto its right side.
    const side = (R: number): PoseIn => ({ trunkDeg: 0, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 0, footPitchDegR: 0, rootRollDeg: R, shoulderFlexDegR: 0, shoulderAbdDegR: 90, elbowDegR: 90, shoulderFlexDegL: 0, shoulderAbdDegL: 165, elbowDegL: 4 });
    const R = bisect((x) => {
      const s = S(side(x), { ...o, contacts: ['feet'] });
      return s.elbowR.y - 0.05;
    }, 50, 89);
    const h = side(R);
    out.frames = [F(0, 0.8, h), F(0.5, 0.85, { ...h, rootRollDeg: R - 0.5 })];
    out.primary = ['obliques', 'abs'];
    out.secondary = ['glutes', 'delt_side'];
    out.cues = CUE_HOLD('Hips high in one line from head to feet; elbow under the shoulder.');
    return out;
  }
  if (v === 'birddog' || v === 'catcow' || v === 'thoracic') {
    out.solve = { anchor: 'pelvis', contacts: ['hands', 'knees'] };
    const q = tuckToes(quadruped(optsOf(out)), optsOf(out));
    if (v === 'birddog') {
      const reach: PoseIn = { ...q, shoulderFlexDegR: q.rootPitchDeg! + 80, femurDegL: -12, tibiaDegL: -12, footPitchDegL: 30 };
      // Knee lifts first (shin swings up) so the foot never sweeps through the floor.
      const lift: PoseIn = { ...q, shoulderFlexDegR: q.rootPitchDeg! + 30, femurDegL: 20, tibiaDegL: -70, footPitchDegL: 30 };
      out.frames = [F(0, 0.5, q), F(0.08, 0.7, lift), F(0.25, 1, reach), F(0.42, 0.7, lift), F(0.5, 0.5, q), F(0.58, 0.7, mirror(lift)), F(0.75, 1, mirror(reach)), F(0.92, 0.7, mirror(lift))];
      out.phases = 'cycle';
      out.primary = ['erectors', 'glutes', 'abs'];
      out.secondary = ['delt_front', 'obliques', 'hamstrings'];
      out.cues = CUE_CYCLE('Reach the opposite arm and leg long; hips stay level.', 'Return under control and switch.');
      return out;
    }
    if (v === 'catcow') {
      const qo = optsOf(out);
      out.frames = [F(0, 0.4, pinHands({ ...q, trunkDeg: 8, neckDeg: 40 }, q, qo)), F(0.5, 0.4, pinHands({ ...q, trunkDeg: -8, neckDeg: -35 }, q, qo))];
      out.phases = 'cycle';
      out.primary = ['erectors', 'abs'];
      out.secondary = ['glutes'];
      out.cues = CUE_CYCLE('Cow: drop the belly, lift the gaze.', 'Cat: round the back, chin to chest.');
      return out;
    }
    const qo = optsOf(out);
    const planted = S(q, qo).wristL;
    const pinL = (x: PoseIn) => fitArm(x, qo, 'L', planted, [q.shoulderFlexDeg ?? 80, 5]);
    const twist = pinL({ ...q, trunkTwistDeg: 40, shoulderFlexDegR: q.rootPitchDeg!, shoulderAbdDegR: 95, elbowDegR: 8 });
    out.frames = [F(0, 0.4, pinL({ ...q, trunkTwistDeg: -10, shoulderAbdDegR: 0, shoulderFlexDegR: q.rootPitchDeg! - 30, elbowDegR: 60 })), F(0.5, 0.6, twist)];
    out.phases = 'cycle';
    out.primary = ['obliques', 'erectors'];
    out.secondary = ['delt_rear', 'traps'];
    out.cues = CUE_CYCLE('Open the chest to the ceiling, eyes following the hand.', 'Thread the arm back under, rotating through the upper back.');
    return out;
  }
  if (v === 'bear') {
    const q = quadruped(o, false);
    out.solve = { anchor: 'pelvis', contacts: ['hands', 'feet'] };
    const stepA: PoseIn = { ...q, shoulderFlexDegR: q.rootPitchDeg! + 10, elbowDegR: 35, femurDegL: 98, tibiaDegL: -10 };
    out.frames = [F(0, 0.6, q), F(0.25, 1, stepA), F(0.5, 0.6, q), F(0.75, 1, mirror(stepA))];
    out.phases = 'cycle';
    out.primary = ['abs', 'delt_front', 'quads'];
    out.secondary = ['triceps', 'obliques', 'glutes'];
    out.cues = CUE_CYCLE('Knees hover an inch off the floor; move opposite hand and foot.', 'Back flat as a table; small steps.');
    return out;
  }
  if (v === 'rotation') {
    // From a high plank, rotate onto one hand with the top arm reaching up.
    const pu = pushup({ variant: 'standard' });
    const top = pu.frames[0].pose;
    out.solve = { anchor: 'feet', contacts: ['feet', 'hands'] };
    const ro = optsOf(out);
    const planted = S(top, ro).wristR;
    let open: PoseIn = { ...top, rootRollDeg: 35, shoulderAbdDegL: 100, shoulderFlexDegL: top.rootPitchDeg! - 20, elbowDegL: 4 };
    open = fitArm(open, { ...ro, contacts: ['feet'] }, 'R', planted, [top.shoulderFlexDeg ?? 70, 5]);
    out.frames = [F(0, 0.6, top), F(0.25, 1, open), F(0.5, 0.6, top), F(0.75, 1, mirror(open))];
    out.phases = 'cycle';
    out.primary = ['obliques', 'abs'];
    out.secondary = ['delt_front', 'delt_side', 'triceps'];
    out.cues = CUE_CYCLE('Rotate onto one hand and reach the other to the ceiling.', 'Return to the plank with control and switch.');
    return out;
  }
  // Ab wheel rollout: kneeling, hands on the wheel on the floor.
  out.solve = { contacts: ['knees'], anchor: 'feet' };
  const ik = optsOf(out);
  const at = (theta: number, armWorld: number) => (L: number): PoseIn => ({
    rootPitchDeg: L,
    trunkDeg: 0,
    femurDeg: theta + L,
    tibiaDeg: -90 + L,
    shoulderFlexDeg: armWorld + L,
    shoulderAbdDeg: 12,
    elbowDeg: 4,
  });
  const solveL = (theta: number, armWorld: number) => {
    const f = at(theta, armWorld);
    const L = bisect((x) => handBottom(S(f(x), ik), 'both'), 10, 88);
    return f(L);
  };
  const start = tuckToes(solveL(0, 0), ik);
  const ext = tuckToes(solveL(-35, 95), ik);
  const midp = tuckToes(solveL(-18, 50), ik);
  out.frames = [F(0, 0.4, start), F(0.25, 0.7, midp), F(0.46, 1, ext), F(0.56, 1, ext), F(0.75, 0.8, midp)];
  out.phases = 'rep';
  out.primary = ['abs'];
  out.secondary = ['lats', 'delt_front', 'obliques', 'triceps'];
  out.cues = CUE_REP('Roll out slowly, hips and shoulders moving together.', 'Furthest point you can hold without the lower back sagging.', 'Pull the wheel back with the abs and lats.', 'Kneeling, hips slightly flexed, ribs down.');
  return out;
};

// ---------------------------------------------------------------------------
// 14. Bridge / hip thrust
// ---------------------------------------------------------------------------

const bridge = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'glute';
  const thrust = v === 'hipthrust';
  const out: FamilyOut = {
    posture: 'floor',
    solve: { contacts: ['feet'], anchor: 'feet' },
    frames: [],
    phases: 'pull',
    primary: ['glutes', 'hamstrings'],
    secondary: ['erectors', 'abs', 'quads'],
    barAnchor: thrust ? 'pelvis' : 'wrists',
    cues: {
      concentric: 'Drive through the heels and squeeze the glutes to lift the hips.',
      isometric: 'Straight line from shoulders to knees; ribs down.',
      eccentric: 'Lower the hips under control.',
      lockout: 'Hips low, tension kept.',
    },
  };
  const o = optsOf(out);
  const backTarget = thrust ? 0.42 + 0.11 : 0.11;
  // Hip thrust: hands hold the bar on the hips; glute bridge: arms long on the floor.
  const arms: PoseIn = thrust ? { shoulderFlexDeg: 20, shoulderAbdDeg: 35, elbowDeg: 25 } : { shoulderFlexDeg: -4, shoulderAbdDeg: 18, elbowDeg: 4 };
  // Unknowns per hip angle: whole-body pitch and knee flexion, with the upper
  // back held at the target height and a fixed shoulder-to-foot distance.
  const build = (h: number, P: number, k: number): PoseIn => ({
    rootPitchDeg: P,
    trunkDeg: 0,
    femurDeg: h,
    tibiaDeg: h - k,
    ...arms,
  });
  // Feet flat: world foot pitch = body pitch - P... solved numerically.
  const flat = (q: PoseIn): PoseIn => {
    const pitch = bisect((x) => {
      const s = S({ ...q, footPitchDegL: x, footPitchDegR: x }, o);
      return s.toeL.y - (s.ankleL.y - RIG.ankleHeight + TOE_CONTACT);
    }, -60, 60);
    return { ...q, footPitchDegL: pitch, footPitchDegR: pitch };
  };
  const topH = 0;
  const topK = 88;
  // Glute bridge: the head and upper back rest on the floor; hip thrust: the upper back on the bench.
  const support = (s: Skeleton) => (thrust ? s.chest.y : Math.min(s.chest.y - 0.11, s.head.y - RIG.headRadius) + 0.11);
  const Ptop = bisect((P) => support(S(flat(build(topH, P, topK)), o)) - backTarget, -100, -40);
  const topPose = flat(build(topH, Ptop, topK));
  const st = S(topPose, o);
  const D = st.chest.z;
  // Continuation from the known top pose down to the deepest hip flexion, so
  // the solver always starts next to the right branch.
  const keep = thrust ? [0, 20, 45, 70] : [0, 15, 35, 55];
  const solvedDesc: PoseIn[] = [];
  let guess = [Ptop, topK];
  const hMax = keep[keep.length - 1];
  for (let h = 0; h <= hMax; h += 5) {
    const sol = solveN(guess, ([Px, kx]) => {
      const s = S(flat(build(h, Px, kx)), o);
      const bound = kx < 30 ? 30 - kx : kx > 150 ? kx - 150 : 0;
      return [support(s) - backTarget, s.chest.z - D, bound * 0.05];
    });
    guess = sol;
    if (keep.includes(h)) solvedDesc.push(flat(build(h, sol[0], sol[1])));
  }
  const sols = solvedDesc.reverse();
  out.frames = [F(0, 0.4, sols[0]), F(0.15, 0.6, sols[1]), F(0.3, 0.8, sols[2]), F(0.46, 1, sols[3]), F(0.56, 1, sols[3]), F(0.75, 0.7, sols[1])];
  if (v === 'pose') {
    out.phases = 'hold';
    out.frames = [F(0, 0.7, sols[3]), F(0.5, 0.75, sols[2])].map((f, i) => (i === 1 ? F(0.5, 0.75, sols[3]) : f));
    out.cues = CUE_HOLD('Press into the feet and arms, lift the chest toward the chin.');
  }
  if (thrust) {
    const z = st.chest.z;
    out.props = [{ kind: 'box', x: 0, y: 0.21, z: z - 0.08, sx: 1.2, sy: 0.42, sz: 0.34 }];
    out.cues.isometric = 'Shins vertical at the top, chin tucked, glutes squeezed.';
  }
  return out;
};

// ---------------------------------------------------------------------------
// 15. Jumps & plyometrics
// ---------------------------------------------------------------------------

const jump = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'jack';
  const out: FamilyOut = {
    posture: 'floor',
    solve: { contacts: ['feet', 'hands', 'knees'], anchor: 'pelvis' },
    frames: [],
    phases: 'cycle',
    primary: ['quads', 'calves', 'glutes'],
    secondary: ['delt_side', 'abs', 'hamstrings'],
    barAnchor: 'wrists',
    cues: CUE_CYCLE('Light and springy on the balls of the feet.', 'Land softly, knees slightly bent.'),
  };
  if (v === 'jack') {
    const closed: PoseIn = { femurDeg: 2, tibiaDeg: 1, legYawDegL: -90, legYawDegR: 90, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 0, shoulderAbdDeg: 8, elbowDeg: 6 };
    const open: PoseIn = { ...closed, femurDeg: 14, tibiaDeg: 13, shoulderAbdDeg: 172, elbowDeg: 4 };
    const air = (a: PoseIn, b: PoseIn): PoseIn => ({ ...a, femurDeg: (a.femurDeg! + b.femurDeg!) / 2, tibiaDeg: (a.tibiaDeg! + b.tibiaDeg!) / 2, shoulderAbdDeg: (a.shoulderAbdDeg! + b.shoulderAbdDeg!) / 2, footPitchDegL: 25, footPitchDegR: 25, liftY: 0.07 });
    out.frames = [F(0, 0.5, closed), F(0.25, 0.9, air(closed, open)), F(0.5, 0.6, open), F(0.75, 0.9, air(closed, open))];
    out.primary = ['calves', 'delt_side', 'quads'];
    out.secondary = ['glutes', 'abs', 'traps'];
    out.cues = CUE_CYCLE('Jump the feet wide as the arms sweep overhead.', 'Jump back together, arms to the sides.');
    return out;
  }
  if (v === 'rope') {
    const base: PoseIn = { femurDeg: 6, tibiaDeg: 0, footPitchDegL: 10, footPitchDegR: 10, shoulderFlexDeg: 12, shoulderAbdDeg: 28, elbowDeg: 85 };
    out.frames = [F(0, 0.6, base), F(0.25, 0.9, { ...base, femurDeg: 2, footPitchDegL: 30, footPitchDegR: 30, liftY: 0.05, shoulderFlexDeg: 20 }), F(0.5, 0.6, base), F(0.75, 0.9, { ...base, femurDeg: 2, footPitchDegL: 30, footPitchDegR: 30, liftY: 0.05, shoulderFlexDeg: 20 })];
    out.primary = ['calves', 'quads'];
    out.secondary = ['forearms', 'delt_side', 'abs'];
    out.cues = CUE_CYCLE('Small hops, an inch off the floor; wrists turn the rope.', 'Elbows close to the ribs, land on the balls of the feet.');
    return out;
  }
  if (v === 'box') {
    const box = 0.5;
    const yaw = { legYawDegL: 0, legYawDegR: 0 };
    const stand: PoseIn = { ...yaw, trunkDeg: 2, femurDeg: 2, tibiaDeg: 1, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 0, elbowDeg: 8 };
    const load: PoseIn = { ...yaw, trunkDeg: 40, femurDeg: 60, tibiaDeg: -20, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: -40, elbowDeg: 8 };
    const air: PoseIn = { ...yaw, trunkDeg: 20, femurDeg: 80, tibiaDeg: -20, footPitchDegL: 10, footPitchDegR: 10, shoulderFlexDeg: 100, elbowDeg: 10 };
    out.solve = { contacts: ['feet'], anchor: 'feet' };
    out.frames = [
      F(0, 0.3, stand),
      F(0.18, 0.8, load),
      F(0.32, 1, { ...air, liftY: box + 0.12, shiftZ: 0.3 }),
      F(0.42, 0.8, { ...load, liftY: box, shiftZ: 0.6, shoulderFlexDeg: 60 }),
      F(0.55, 0.4, { ...stand, liftY: box, shiftZ: 0.6 }),
      F(0.68, 0.3, { ...stand, liftY: box, shiftZ: 0.6 }),
      F(0.82, 0.3, { ...stand, femurDegL: 20, tibiaDegL: -10, liftY: box / 2 + 0.05, shiftZ: 0.3 }),
    ];
    out.phases = 'rep';
    const s = S(stand, optsOf(out));
    out.props = [{ kind: 'box', x: 0, y: box / 2, z: s.toeR.z + 0.6 - 0.07, sx: 0.6, sy: box, sz: 0.5 }];
    out.cues = CUE_REP('Swing the arms back and dip into a quarter squat.', 'Load the hips; eyes on the box.', 'Explode up and forward, tuck the knees, land soft on the whole foot.', 'Stand tall on the box, then step down — do not jump down.');
    return out;
  }
  // burpee family
  const pu = pushup({ variant: 'standard' });
  const plankTop = pu.frames[0].pose;
  const ik = optsOf({ posture: 'floor', solve: { contacts: ['feet'], anchor: 'feet' } });
  const plankS = S(plankTop, ik);
  const handsZ = mid(plankS.wristL, plankS.wristR).z;
  const stand: PoseIn = { trunkDeg: 2, femurDeg: 2, tibiaDeg: 1, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 0, shoulderAbdDeg: 10, elbowDeg: 8 };
  // Crouch with hands on the floor in front of the feet.
  let crouch: PoseIn = { trunkDeg: 42, femurDeg: 102, tibiaDeg: -32, footPitchDegL: 0, footPitchDegR: 0, shoulderAbdDeg: 14 };
  {
    const s0 = S(crouch, ik);
    const targetZ = (Math.max(s0.toeL.z, s0.toeR.z) + s0.chest.z) / 2 + 0.1;
    crouch = fitBothArms(crouch, ik, 0.04, targetZ, [70, 20]);
  }
  // Hands must not move between crouch and plank: shift the plank so its hands sit where the crouch put them.
  const crouchS = S(crouch, ik);
  const crouchHandZ = mid(crouchS.wristL, crouchS.wristR).z;
  const shift = crouchHandZ - handsZ;
  const plankT: PoseIn = { ...plankTop, shiftZ: shift };
  const jumpUp: PoseIn = { ...stand, footPitchDegL: 35, footPitchDegR: 35, shoulderFlexDeg: 172, shoulderAbdDeg: 12, elbowDeg: 4, liftY: 0.25 };
  out.solve = { contacts: ['feet', 'hands'], anchor: 'feet' };
  const withPush = v === 'burpeePushup' || v === 'devil';
  // The feet JUMP back and in — a mid-air frame each way, so they never drag along the floor.
  const hop = (a: PoseIn, b: PoseIn): PoseIn => ({ ...blend(a, b, 0.5), liftY: 0.14 });
  const tOut = withPush ? 0.6 : 0.45;
  const frames: Frame[] = [F(0, 0.3, stand), F(0.14, 0.6, crouch), F(0.21, 0.8, hop(crouch, plankT)), F(0.28, 0.8, plankT)];
  if (withPush) {
    // Re-use every solved push-up frame (hands stay planted through the rep).
    for (const f of pu.frames) if (f.t > 0) frames.push(F(0.28 + 0.2 * f.t, f.effort, { ...f.pose, shiftZ: shift }));
    frames.push(F(0.48, 0.8, plankT));
  }
  frames.push(F(tOut - 0.06, 0.8, hop(plankT, crouch)), F(tOut, 0.7, crouch), F(withPush ? 0.78 : 0.68, 1, jumpUp), F(withPush ? 0.9 : 0.84, 0.4, { ...stand, liftY: 0.02 }));
  out.frames = frames;
  out.phases = 'rep';
  out.primary = ['quads', 'pecs', 'glutes'];
  out.secondary = ['triceps', 'delt_front', 'abs', 'calves'];
  out.cues = CUE_REP('Squat down and plant the hands just in front of the feet.', withPush ? 'Jump the feet back to a plank and do a full push-up.' : 'Jump the feet back to a straight plank.', 'Jump the feet in, then explode up.', 'Arms overhead in the air, land softly.');
  return out;
};

// ---------------------------------------------------------------------------
// 16. Cyclic cardio
// ---------------------------------------------------------------------------

const cardio = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'run';
  const out: FamilyOut = {
    posture: 'floor',
    solve: { contacts: ['feet'], anchor: 'pelvis' },
    frames: [],
    phases: 'cycle',
    primary: ['quads', 'hamstrings', 'calves', 'glutes'],
    secondary: ['abs', 'delt_front'],
    barAnchor: 'wrists',
    cues: CUE_CYCLE('Tall posture, quick light steps under the hips.', 'Relaxed shoulders; arms drive front to back.'),
  };
  const stride = (amp: number, kneeSwing: number, lift: number, trunk: number, armAmp: number): Frame[] => {
    // Right leg in front at t=0; the half cycle mirrors it.
    const a: PoseIn = {
      trunkDeg: trunk,
      femurDegR: amp,
      tibiaDegR: amp * 0.25,
      footPitchDegR: 0,
      femurDegL: -amp * 0.7,
      tibiaDegL: -amp * 0.7 - kneeSwing,
      footPitchDegL: 25,
      shoulderFlexDegR: -armAmp,
      shoulderFlexDegL: armAmp,
      shoulderAbdDeg: 10,
      elbowDeg: 90,
    };
    const b: PoseIn = {
      trunkDeg: trunk,
      femurDegR: amp * 0.15,
      tibiaDegR: -amp * 0.15,
      footPitchDegR: 10,
      femurDegL: amp * 0.9,
      tibiaDegL: amp * 0.9 - kneeSwing * 1.2,
      footPitchDegL: 0,
      shoulderFlexDegR: 0,
      shoulderFlexDegL: 0,
      shoulderAbdDeg: 10,
      elbowDeg: 90,
      liftY: lift,
    };
    return [F(0, 0.8, a), F(0.25, 1, b), F(0.5, 0.8, mirror(a)), F(0.75, 1, mirror(b))];
  };
  switch (v) {
    case 'run':
      out.frames = stride(28, 70, 0.04, 8, 35);
      return out;
    case 'sprint':
      out.frames = stride(40, 95, 0.07, 14, 55);
      out.cues = CUE_CYCLE('Drive the knees forward, pump the arms hard.', 'Recover fully between intervals.');
      return out;
    case 'walk':
      out.frames = stride(20, 25, 0, 12, 20);
      out.primary = ['glutes', 'calves', 'hamstrings'];
      out.secondary = ['quads', 'erectors'];
      out.cues = CUE_CYCLE('Long stride up the incline, push from the back foot.', 'Stand tall; do not hold the rails.');
      return out;
    case 'stair':
      out.frames = stride(42, 60, 0.0, 15, 15);
      out.primary = ['glutes', 'quads'];
      out.secondary = ['calves', 'hamstrings'];
      return out;
    case 'highknees': {
      const a: PoseIn = { trunkDeg: 2, femurDegR: 88, tibiaDegR: -2, footPitchDegR: 20, femurDegL: 0, tibiaDegL: 0, footPitchDegL: 25, shoulderFlexDegR: -30, shoulderFlexDegL: 50, shoulderAbdDeg: 10, elbowDeg: 90, liftY: 0.03 };
      const between: PoseIn = { ...a, femurDegR: 20, tibiaDegR: -40, femurDegL: 20, tibiaDegL: -40, shoulderFlexDegR: 10, shoulderFlexDegL: 10, liftY: 0.06 };
      out.frames = [F(0, 1, a), F(0.25, 0.7, between), F(0.5, 1, mirror(a)), F(0.75, 0.7, mirror(between))];
      out.primary = ['quads', 'calves', 'abs'];
      out.secondary = ['glutes', 'delt_front'];
      out.cues = CUE_CYCLE('Knee to hip height, land on the ball of the foot.', 'Quick switch; arms pump opposite to the legs.');
      return out;
    }
    case 'mountain': {
      const pu = pushup({ variant: 'standard' });
      const top = pu.frames[0].pose;
      out.solve = { contacts: ['hands', 'feet'], anchor: 'hands' };
      const drive: PoseIn = { ...top, femurDegR: 60, tibiaDegR: -70 };
      out.frames = [F(0, 1, drive), F(0.25, 0.7, top), F(0.5, 1, mirror(drive)), F(0.75, 0.7, top)];
      out.primary = ['abs', 'quads', 'delt_front'];
      out.secondary = ['obliques', 'triceps', 'glutes'];
      out.cues = CUE_CYCLE('Drive one knee toward the chest, hips level with the shoulders.', 'Switch fast; hands stay planted under the shoulders.');
      return out;
    }
    case 'cycle':
    case 'assault':
    case 'elliptical': {
      // Seated pedalling: ankle follows a crank circle, legs solved with IK.
      const ell = v === 'elliptical';
      const seatY = ell ? 0 : 0.92;
      const hipToCrank = ell ? { y: -0.62, z: 0.15 } : { y: -0.62, z: 0.2 };
      const r = ell ? 0.16 : 0.17;
      const frames: Frame[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const ankle = (ph: number) => ({ y: hipToCrank.y + r * Math.cos(ph), z: hipToCrank.z + r * Math.sin(ph) });
        const ar = ankle(a);
        const al = ankle(a + Math.PI);
        const lr = legIK(ar.y, ar.z);
        const ll = legIK(al.y, al.z);
        const arms: PoseIn = v === 'cycle'
          ? { shoulderFlexDeg: 55, shoulderAbdDeg: 14, elbowDeg: 30 }
          : { shoulderFlexDegR: 50 + 25 * Math.sin(a), shoulderFlexDegL: 50 - 25 * Math.sin(a), elbowDegR: 70 - 30 * Math.sin(a), elbowDegL: 70 + 30 * Math.sin(a), shoulderAbdDeg: 14 };
        frames.push(F(i / 6, 0.8 + 0.2 * Math.abs(Math.sin(a)), { trunkDeg: ell ? 6 : 28, femurDegR: lr.femur, tibiaDegR: lr.tibia, femurDegL: ll.femur, tibiaDegL: ll.tibia, footPitchDegL: 0, footPitchDegR: 0, ...arms }));
      }
      out.frames = frames;
      if (ell) {
        out.solve = { contacts: ['feet'], anchor: 'pelvis' };
      } else {
        out.posture = 'supine';
        out.supinePelvisY = seatY;
        out.solve = { freeLegs: true };
        out.props = [
          { kind: 'box', x: 0, y: seatY - 0.12, z: -0.02, sx: 0.16, sy: 0.05, sz: 0.24 },
          { kind: 'box', x: 0, y: (seatY - 0.14) / 2, z: 0.02, sx: 0.05, sy: seatY - 0.14, sz: 0.05 },
        ];
      }
      out.primary = v === 'assault' ? ['quads', 'glutes', 'delt_front'] : ['quads', 'glutes', 'hamstrings'];
      out.secondary = v === 'assault' ? ['hamstrings', 'lats', 'triceps', 'calves'] : ['calves', 'abs'];
      out.cues = CUE_CYCLE('Push down and forward through the front of the stroke.', 'Pull back and up; keep the pedal stroke round.');
      return out;
    }
    case 'swim': {
      out.solve = { contacts: ['pelvis', 'back'], anchor: 'pelvis' };
      const base: PoseIn = { rootPitchDeg: 90, trunkDeg: 0, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 45, footPitchDegR: 45, liftY: 0.75 };
      const stroke = (ph: number): PoseIn => {
        // Freestyle arm: reach (180) -> pull (0) -> recover out of the water via abduction.
        const arm = (q: number) => {
          const u = ((q % 1) + 1) % 1;
          if (u < 0.5) return { f: 175 - 350 * u, a: 10, e: 30 * Math.sin(u * 2 * Math.PI) };
          const w = (u - 0.5) * 2;
          return { f: 175 * w, a: 10 + 70 * Math.sin(w * Math.PI), e: 80 * Math.sin(w * Math.PI) };
        };
        const R = arm(ph);
        const L = arm(ph + 0.5);
        return { ...base, shoulderFlexDegR: R.f, shoulderAbdDegR: R.a, elbowDegR: R.e, shoulderFlexDegL: L.f, shoulderAbdDegL: L.a, elbowDegL: L.e, femurDegR: 8 * Math.sin(ph * 6 * Math.PI), tibiaDegR: 8 * Math.sin(ph * 6 * Math.PI) - 5, femurDegL: -8 * Math.sin(ph * 6 * Math.PI), tibiaDegL: -8 * Math.sin(ph * 6 * Math.PI) - 5, rootRollDeg: 20 * Math.sin(ph * 2 * Math.PI) };
      };
      out.frames = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((t) => F(t, 0.8, stroke(t)));
      out.primary = ['lats', 'delt_front', 'triceps'];
      out.secondary = ['pecs', 'abs', 'quads', 'glutes'];
      out.cues = CUE_CYCLE('Long reach, pull under the body to the hip.', 'Recover the arm high, small fast kicks.');
      return out;
    }
    case 'battle': {
      const base: PoseIn = { trunkDeg: 22, femurDeg: 45, tibiaDeg: -15, legYawDegL: -15, legYawDegR: 15, shoulderAbdDeg: 14, elbowDeg: 30 };
      out.solve = STAND;
      out.frames = [F(0, 1, { ...base, shoulderFlexDegR: 65, shoulderFlexDegL: 15 }), F(0.5, 1, { ...base, shoulderFlexDegR: 15, shoulderFlexDegL: 65 })];
      out.primary = ['delt_front', 'forearms', 'abs'];
      out.secondary = ['quads', 'glutes', 'biceps', 'triceps'];
      out.cues = CUE_CYCLE('Alternate fast arm waves from a half squat.', 'Brace the core; the waves travel all the way to the anchor.');
      return out;
    }
    case 'sled': {
      const lean = 42;
      out.frames = stride(30, 55, 0, lean, 0).map((f) => ({ ...f, pose: { ...f.pose, shoulderFlexDegR: 78 + lean * 0.2, shoulderFlexDegL: 78 + lean * 0.2, elbowDeg: 25 } }));
      out.primary = ['quads', 'glutes', 'calves'];
      out.secondary = ['hamstrings', 'delt_front', 'triceps', 'abs'];
      out.cues = CUE_CYCLE('Lean in at about 45 degrees, arms locked on the handles.', 'Short, powerful steps; drive through the balls of the feet.');
      return out;
    }
    default:
      out.frames = stride(30, 75, 0.04, 10, 40);
      return out;
  }
};

// ---------------------------------------------------------------------------
// 17. Calf / ankle
// ---------------------------------------------------------------------------

const calf = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'standing';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'pull',
    primary: ['calves'],
    secondary: ['abs'],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Rise as high as possible onto the balls of the feet.',
      isometric: 'Pause at the top.',
      eccentric: 'Lower slowly, heels all the way down.',
      lockout: 'Heels down, knees soft.',
    },
  };
  if (v === 'standing') {
    const base: PoseIn = { trunkDeg: 1, femurDeg: 2, tibiaDeg: 2, shoulderFlexDeg: 0, shoulderAbdDeg: 10, elbowDeg: 8 };
    out.frames = [F(0, 0.3, { ...base, footPitchDegL: 0, footPitchDegR: 0 }), F(0.46, 1, { ...base, footPitchDegL: 34, footPitchDegR: 34 }), F(0.56, 1, { ...base, footPitchDegL: 34, footPitchDegR: 34 })];
    return out;
  }
  if (v === 'seated') {
    out.posture = 'supine';
    out.supinePelvisY = 0.6;
    out.solve = { freeLegs: true };
    const o = optsOf(out);
    const arms: PoseIn = { trunkDeg: 5, shoulderFlexDeg: 40, shoulderAbdDeg: 15, elbowDeg: 70 };
    const base0: PoseIn = { ...arms, femurDeg: 90, tibiaDeg: 0, footPitchDegL: -8, footPitchDegR: -8 };
    const s0 = S(base0, o);
    const toeZ = s0.toeL.z;
    const toeY = s0.toeL.y;
    // The ball of the foot is the pivot: solve thigh and shin so the toe stays put.
    const at = (pitch: number): PoseIn => {
      const [f, t] = solveN([90, 0], ([fx, tx]) => {
        const s = S({ ...arms, femurDeg: fx, tibiaDeg: tx, footPitchDegL: pitch, footPitchDegR: pitch }, o);
        return [s.toeL.y - toeY, s.toeL.z - toeZ];
      });
      return { ...arms, femurDeg: f, tibiaDeg: t, footPitchDegL: pitch, footPitchDegR: pitch };
    };
    const down = at(-8);
    const up = at(28);
    out.frames = [F(0, 0.3, down), F(0.46, 1, up), F(0.56, 1, up)];
    return out;
  }
  if (v === 'ankle') {
    out.solve = { contacts: ['feet'], anchor: 'footR' };
    const at = (fz: number, h: number) => splitPose({ h, pz: fz, front: { z: 0.3 }, rear: { toeZ: -0.34, pitch: 28 } }, { trunkDeg: 2, shoulderFlexDeg: 40, shoulderAbdDeg: 10, elbowDeg: 90 });
    out.frames = [F(0, 0.3, at(-0.02, 0.86)), F(0.5, 0.7, at(0.1, 0.8))];
    out.phases = 'cycle';
    out.cues = CUE_CYCLE('Drive the front knee forward past the toes, heel stays down.', 'Rock back to the start.');
    return out;
  }
  // Wall calf stretch: hands on the wall, rear leg straight and heel down.
  out.phases = 'hold';
  out.solve = { contacts: ['feet'], anchor: 'footR' };
  const fr = legIK(RIG.ankleHeight - 0.9, 0.25);
  const hold: PoseIn = { trunkDeg: 14, femurDegR: fr.femur, tibiaDegR: fr.tibia, footPitchDegR: 0, femurDegL: -26, tibiaDegL: -26, footPitchDegL: 0, shoulderFlexDeg: 85, shoulderAbdDeg: 12, elbowDeg: 25 };
  out.frames = [F(0, 0.5, hold), F(0.5, 0.55, { ...hold, trunkDeg: 15 })];
  const s = S(hold, optsOf(out));
  out.props = [{ kind: 'box', x: 0, y: 1.0, z: Math.max(s.handL.z, s.handR.z) + 0.05, sx: 1.4, sy: 2, sz: 0.08 }];
  out.cues = CUE_HOLD('Rear leg straight, heel pressed down; lean into the wall.');
  return out;
};

// ---------------------------------------------------------------------------
// 18. Leg machines / knee isolation
// ---------------------------------------------------------------------------

const legMachine = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'extension';
  const out: FamilyOut = {
    posture: 'supine',
    supinePelvisY: 0.55,
    solve: { freeLegs: true },
    frames: [],
    phases: 'pull',
    primary: ['quads'],
    secondary: [],
    barAnchor: 'wrists',
    cues: {
      concentric: 'Straighten the knees fully and squeeze the quads.',
      isometric: 'Pause at the top.',
      eccentric: 'Lower slowly.',
      lockout: 'Knees bent, tension kept.',
    },
  };
  if (v === 'extension') {
    const seat: PoseIn = { trunkDeg: -10, femurDeg: 88, footPitchDegL: -10, footPitchDegR: -10, shoulderFlexDeg: 10, shoulderAbdDeg: 25, elbowDeg: 20 };
    out.frames = [F(0, 0.3, { ...seat, tibiaDeg: -2 }), F(0.46, 1, { ...seat, tibiaDeg: 84 }), F(0.56, 1, { ...seat, tibiaDeg: 84 })];
    out.secondary = ['abs'];
    return out;
  }
  if (v === 'curl') {
    // Prone on a bench pad: lying face down, knees flex.
    out.posture = 'floor';
    out.solve = { contacts: ['pelvis', 'back'], anchor: 'pelvis' };
    const lie: PoseIn = { rootPitchDeg: 90, trunkDeg: 0, femurDeg: 0, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 150, shoulderAbdDeg: 30, elbowDeg: 60, liftY: 0.42 };
    out.frames = [F(0, 0.3, { ...lie, tibiaDeg: 2 }), F(0.46, 1, { ...lie, tibiaDeg: -115 }), F(0.56, 1, { ...lie, tibiaDeg: -115 })];
    out.props = [{ kind: 'box', x: 0, y: 0.21, z: 0.3, sx: 0.4, sy: 0.42, sz: 1.2 }];
    out.primary = ['hamstrings'];
    out.secondary = ['calves', 'glutes'];
    out.cues.concentric = 'Curl the heels toward the glutes; hips stay pressed into the pad.';
    return out;
  }
  // Nordic curl: kneeling, ankles anchored, body lowers forward as one piece.
  out.posture = 'floor';
  out.solve = { contacts: ['knees'], anchor: 'feet' };
  // Shins flat on the floor (world -90), feet laces-down behind: body pitch = 90 - knee flexion.
  const at = (k: number, arms: number): PoseIn => ({ rootPitchDeg: 90 - k, trunkDeg: 0, femurDeg: 0, tibiaDeg: -k, footPitchDegL: k + 70, footPitchDegR: k + 70, shoulderFlexDeg: arms, shoulderAbdDeg: 14, elbowDeg: 30 });
  out.frames = [F(0, 0.4, at(90, 10)), F(0.46, 1, at(32, 70)), F(0.56, 1, at(32, 70))];
  out.primary = ['hamstrings'];
  out.secondary = ['glutes', 'calves', 'erectors'];
  out.cues = { eccentric: 'Lower forward as slowly as possible, hips straight.', isometric: 'Catch yourself with the hands at the bottom.', concentric: 'Pull back up with the hamstrings (push off lightly if needed).', lockout: 'Tall kneel, glutes squeezed.' };
  out.phases = 'pull';
  return out;
};

// ---------------------------------------------------------------------------
// 19. Stretches, yoga, mobility & recovery holds
// ---------------------------------------------------------------------------

const stretch = (p: FamilyParams): FamilyOut => {
  const v = p.variant ?? 'hamstring';
  const out: FamilyOut = {
    posture: 'floor',
    solve: STAND,
    frames: [],
    phases: 'hold',
    primary: ['hamstrings'],
    secondary: [],
    barAnchor: 'wrists',
    cues: CUE_HOLD('Ease into the stretch and breathe; no bouncing.'),
  };
  const hold = (h: PoseIn, wobble: PoseIn = {}) => {
    out.frames = [F(0, 0.3, h), F(0.5, 0.35, { ...h, ...wobble })];
  };
  const standing: PoseIn = { trunkDeg: 1, femurDeg: 1, tibiaDeg: 1, shoulderFlexDeg: 0, shoulderAbdDeg: 10, elbowDeg: 8 };
  const o = () => optsOf(out);
  switch (v) {
    case 'hamstring':
      hold({ ...standing, trunkDeg: 95 - 40, femurDeg: 6, tibiaDeg: 4, shoulderFlexDeg: 60, elbowDeg: 4 }, { trunkDeg: 58 });
      out.cues = CUE_HOLD('Hinge from the hips with long legs; reach toward the shins.');
      return out;
    case 'quad': {
      out.solve = { contacts: ['feet'], anchor: 'footL' };
      let h: PoseIn = { ...standing, trunkDeg: 10, femurDegL: 1, tibiaDegL: 1, femurDegR: -12, tibiaDegR: -160, footPitchDegR: 160, footPitchDegL: 0, shoulderFlexDegL: 20, shoulderAbdDegL: 25 };
      const s = S(h, o());
      h = fitArm(h, o(), 'R', { x: s.ankleR.x, y: s.ankleR.y + 0.02, z: s.ankleR.z }, [-45, 20]);
      hold(h);
      out.primary = ['quads'];
      out.secondary = ['glutes'];
      out.cues = CUE_HOLD('Heel to the glute, knees together, hips tucked under.');
      return out;
    }
    case 'shoulder':
      hold({ ...standing, shoulderFlexDegR: 92, shoulderAbdDegR: -22, elbowDegR: 4, shoulderFlexDegL: 50, shoulderAbdDegL: 0, elbowDegL: 110 });
      out.primary = ['delt_rear'];
      out.secondary = ['traps'];
      out.cues = CUE_HOLD('Pull the straight arm across the chest; shoulder stays down.');
      return out;
    case 'chest':
      hold({ ...standing, shoulderFlexDeg: -50, shoulderAbdDeg: 25, elbowDeg: 6, neckDeg: -10 });
      out.primary = ['pecs'];
      out.secondary = ['delt_front'];
      out.cues = CUE_HOLD('Clasp the hands behind, lift the chest, squeeze the shoulder blades.');
      return out;
    case 'doorway': {
      const h: PoseIn = { ...standing, trunkDeg: 6, shoulderFlexDeg: 0, shoulderAbdDeg: 90, elbowDeg: 90, shoulderRotDeg: 90 };
      hold(h, { trunkDeg: 9 });
      const s = S(h, o());
      out.props = [
        { kind: 'box', x: s.handL.x - 0.04, y: 1.0, z: s.elbowL.z + 0.03, sx: 0.08, sy: 2, sz: 0.12 },
        { kind: 'box', x: s.handR.x + 0.04, y: 1.0, z: s.elbowR.z + 0.03, sx: 0.08, sy: 2, sz: 0.12 },
      ];
      out.primary = ['pecs'];
      out.secondary = ['delt_front'];
      out.cues = CUE_HOLD('Forearms on the door frame, step through until the chest opens.');
      return out;
    }
    case 'neck':
      out.phases = 'cycle';
      out.frames = [F(0, 0.2, { ...standing, neckDeg: 35 }), F(0.5, 0.2, { ...standing, neckDeg: -20 })];
      out.primary = ['traps'];
      out.cues = CUE_CYCLE('Slowly lower the chin toward the chest.', 'Lift back up through neutral, shoulders relaxed.');
      return out;
    case 'forwardfold':
    case 'seated9090':
    case 'pigeon': {
      out.solve = { contacts: ['pelvis', 'feet', 'knees'], anchor: 'pelvis' };
      if (v === 'forwardfold') {
        const base: PoseIn = { trunkDeg: 55, femurDeg: 88, tibiaDeg: 88, footPitchDegL: -40, footPitchDegR: -40, shoulderAbdDeg: 8 };
        const s0 = S({ ...base, shoulderFlexDeg: 40, elbowDeg: 4 }, o());
        const h = fitBothArms(base, o(), s0.kneeR.y + 0.1, (s0.kneeR.z + s0.ankleR.z) / 2, [40, 10]);
        hold(h, { trunkDeg: 56.5 });
        out.cues = CUE_HOLD('Legs long, fold from the hips, reach for the feet.');
      } else if (v === 'seated9090') {
        hold({ trunkDeg: 10, femurDegR: 70, tibiaDegR: -8, legYawDegR: 50, footPitchDegR: 0, femurDegL: 50, tibiaDegL: -40, legYawDegL: -60, footPitchDegL: 0, shoulderFlexDeg: 30, shoulderAbdDeg: 20, elbowDeg: 20 });
        out.primary = ['glutes'];
        out.cues = CUE_HOLD('Both knees bent to 90 degrees, sit tall over the front shin.');
      } else {
        hold({ rootPitchDeg: 20, trunkDeg: 25, femurDegR: 95, tibiaDegR: 5, legYawDegR: 30, footPitchDegR: 0, femurDegL: -30, tibiaDegL: -30, footPitchDegL: 60, shoulderFlexDeg: 60, shoulderAbdDeg: 15, elbowDeg: 10 });
        out.primary = ['glutes'];
        out.secondary = ['quads'];
        out.cues = CUE_HOLD('Front shin across the mat, back leg long; fold over the front leg.');
      }
      return out;
    }
    case 'child': {
      out.solve = { contacts: ['knees', 'feet', 'hands'], anchor: 'pelvis' };
      // Body pitched 100 deg: thighs 45 deg forward of vertical, shins flat behind, arms long on the floor.
      hold({ trunkDeg: 0, rootPitchDeg: 100, femurDeg: 145, tibiaDeg: 10, shoulderFlexDeg: 180, shoulderAbdDeg: 15, elbowDeg: 4 });
      out.primary = ['erectors', 'lats'];
      out.secondary = ['glutes'];
      out.cues = CUE_HOLD('Sit the hips back toward the heels, arms long, forehead down.');
      return out;
    }
    case 'downdog': {
      const pu = pushup({ variant: 'pike' });
      out.solve = { contacts: ['feet', 'hands'], anchor: 'feet' };
      const h = pu.frames[0].pose;
      hold(h);
      out.primary = ['hamstrings', 'calves'];
      out.secondary = ['delt_front', 'lats'];
      out.cues = CUE_HOLD('Hips up and back, long spine, heels reaching toward the floor.');
      return out;
    }
    case 'cobra': {
      out.solve = { contacts: ['pelvis', 'feet', 'hands'], anchor: 'pelvis' };
      const base: PoseIn = { rootPitchDeg: 90, trunkDeg: -32, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 60, footPitchDegR: 60, shoulderAbdDeg: 18, neckDeg: -15 };
      const s0 = S({ ...base, shoulderFlexDeg: 30, elbowDeg: 20 }, optsOf({ ...out, solve: { contacts: ['pelvis', 'feet'], anchor: 'pelvis' } }));
      const h = fitBothArms(base, optsOf({ ...out, solve: { contacts: ['pelvis', 'feet'], anchor: 'pelvis' } }), 0.035, (s0.shoulderL.z + s0.chest.z) / 2, [30, 30]);
      hold(h);
      out.primary = ['erectors'];
      out.secondary = ['abs', 'glutes'];
      out.cues = CUE_HOLD('Hips down, press the chest forward and up, shoulders away from the ears.');
      return out;
    }
    case 'sun': {
      // Abbreviated flow: reach up -> fold -> plank -> cobra -> down dog -> fold -> reach up.
      const pu = pushup({ variant: 'standard' });
      const pk = pushup({ variant: 'pike' });
      const reach: PoseIn = { ...standing, shoulderFlexDeg: 172, shoulderAbdDeg: 10, elbowDeg: 4, footPitchDegL: 0, footPitchDegR: 0 };
      const fold: PoseIn = { ...standing, trunkDeg: 100, femurDeg: 30, tibiaDeg: 0, shoulderFlexDeg: 95, elbowDeg: 4, footPitchDegL: 0, footPitchDegR: 0 };
      out.solve = { contacts: ['feet', 'hands', 'pelvis'], anchor: 'feet' };
      out.frames = [F(0, 0.3, reach), F(0.16, 0.5, fold), F(0.34, 0.6, pu.frames[0].pose), F(0.5, 0.6, { ...pu.frames[0].pose, trunkDeg: -25, rootPitchDeg: (pu.frames[0].pose.rootPitchDeg ?? 70) + 10, femurDeg: 0 }), F(0.66, 0.5, pk.frames[0].pose), F(0.84, 0.4, fold)];
      out.phases = 'cycle';
      out.primary = ['hamstrings', 'delt_front', 'erectors'];
      out.secondary = ['pecs', 'triceps', 'calves', 'abs'];
      out.cues = CUE_CYCLE('Move with the breath: inhale to reach, exhale to fold.', 'Flow through plank, upward and downward dog.');
      return out;
    }
    case 'tree':
      out.solve = { contacts: ['feet'], anchor: 'footL' };
      hold({ ...standing, femurDegL: 1, tibiaDegL: 1, footPitchDegL: 0, femurDegR: 62, tibiaDegR: -78, legYawDegR: 52, footPitchDegR: 30, shoulderFlexDeg: 172, shoulderAbdDeg: 0, elbowDeg: 6 });
      out.primary = ['glutes', 'calves'];
      out.secondary = ['abs', 'quads'];
      out.cues = CUE_HOLD('Foot on the inner thigh (not the knee), knee opens out, hands overhead.');
      return out;
    case 'triangle':
      hold({ trunkDeg: 8, trunkSideDeg: 40, femurDeg: 30, tibiaDeg: 30, legYawDegL: -88, legYawDegR: 88, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 0, shoulderAbdDeg: 90, elbowDeg: 4 });
      out.solve = { contacts: ['feet'], anchor: 'feet' };
      out.primary = ['hamstrings', 'obliques'];
      out.secondary = ['glutes', 'delt_side'];
      out.cues = CUE_HOLD('Wide straight legs, hinge sideways over the front leg, arms in one line.');
      return out;
    case 'warrior2':
      hold({ trunkDeg: 0, femurDegR: 52, tibiaDegR: -6, legYawDegR: 88, femurDegL: 32, tibiaDegL: 32, legYawDegL: -88, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 0, shoulderAbdDeg: 90, elbowDeg: 4 });
      out.solve = { contacts: ['feet'], anchor: 'feet' };
      out.primary = ['quads', 'glutes'];
      out.secondary = ['delt_side', 'abs'];
      out.cues = CUE_HOLD('Front knee over the ankle, back leg straight, arms long at shoulder height.');
      return out;
    case 'corpse':
      out.solve = SUPINE;
      hold({ rootPitchDeg: -90, trunkDeg: 0, femurDeg: 2, tibiaDeg: 2, footPitchDegL: 40, footPitchDegR: 40, shoulderFlexDeg: 0, shoulderAbdDeg: 20, elbowDeg: 6 });
      out.primary = ['abs'];
      out.cues = CUE_HOLD('Lie still, palms up, let the body go heavy and breathe.');
      return out;
    case 'foamquads':
    case 'foamback': {
      const quads = v === 'foamquads';
      out.phases = 'cycle';
      if (quads) {
        out.solve = { contacts: ['elbows', 'feet'], anchor: 'pelvis' };
        const h: PoseIn = { rootPitchDeg: 78, trunkDeg: 0, femurDeg: 0, tibiaDeg: 0, footPitchDegL: 60, footPitchDegR: 60, shoulderFlexDeg: 78, shoulderAbdDeg: 14, elbowDeg: 92, liftY: 0.08 };
        out.frames = [F(0, 0.3, { ...h, shiftZ: 0 }), F(0.5, 0.3, { ...h, shiftZ: -0.16 })];
        out.props = [{ kind: 'bar', x: 0, y: 0.075, z: 0.25, sx: 0.5, sy: 0.15, sz: 0.15 }];
        out.primary = ['quads'];
      } else {
        out.solve = { contacts: ['feet', 'pelvis'], anchor: 'feet' };
        const h: PoseIn = { rootPitchDeg: -75, trunkDeg: 0, femurDeg: 75, tibiaDeg: -10, footPitchDegL: 0, footPitchDegR: 0, shoulderFlexDeg: 150, shoulderAbdDeg: 30, elbowDeg: 140, liftY: 0.05 };
        out.frames = [F(0, 0.3, h), F(0.5, 0.3, { ...h, rootPitchDeg: -82, femurDeg: 82 })];
        const s = S(h, o());
        out.props = [{ kind: 'bar', x: 0, y: 0.075, z: s.chest.z, sx: 0.5, sy: 0.15, sz: 0.15 }];
        out.primary = ['erectors', 'traps'];
      }
      out.cues = CUE_CYCLE('Roll slowly along the muscle.', 'Pause on tender spots and breathe.');
      return out;
    }
    default:
      hold(standing);
      return out;
  }
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const GENERATORS: Record<MotionFamily, (p: FamilyParams) => FamilyOut> = {
  squat,
  hinge,
  lunge,
  pushup,
  benchPress,
  overheadPress,
  row,
  verticalPull,
  curl,
  triceps,
  raise,
  core,
  plank,
  bridge,
  jump,
  cardio,
  calf,
  legMachine,
  stretch,
};

const phaseSpans = (kind: PhaseKind): PhaseSpan[] => {
  switch (kind) {
    case 'rep':
      return [
        { phase: 'eccentric', start: 0, end: 0.46 },
        { phase: 'isometric', start: 0.46, end: 0.56 },
        { phase: 'concentric', start: 0.56, end: 0.94 },
        { phase: 'lockout', start: 0.94, end: 1 },
      ];
    case 'pull':
      return [
        { phase: 'concentric', start: 0, end: 0.46 },
        { phase: 'isometric', start: 0.46, end: 0.56 },
        { phase: 'eccentric', start: 0.56, end: 0.94 },
        { phase: 'lockout', start: 0.94, end: 1 },
      ];
    case 'floorFirst':
      return [
        { phase: 'concentric', start: 0, end: 0.5 },
        { phase: 'lockout', start: 0.5, end: 0.6 },
        { phase: 'eccentric', start: 0.6, end: 0.96 },
        { phase: 'isometric', start: 0.96, end: 1 },
      ];
    case 'cycle':
      return [
        { phase: 'concentric', start: 0, end: 0.5 },
        { phase: 'eccentric', start: 0.5, end: 1 },
      ];
    default:
      return [{ phase: 'isometric', start: 0, end: 1 }];
  }
};

const activationFor = (primary: MuscleId[], secondary: MuscleId[], effort: number): ActivationMap => {
  const map: ActivationMap = {};
  const e = Math.max(0, Math.min(1, effort));
  for (const m of secondary) map[m] = Math.round(e * 0.5 * 1000) / 1000;
  for (const m of primary) map[m] = Math.round(e * 1000) / 1000;
  return map;
};

/**
 * Give every keyframe an explicit foot pitch inside the ankle's range. A foot
 * the family authored inside the range is untouched; one outside it (a running
 * back-swing, a kneeling foot) moves to the nearest reachable angle with a
 * small margin, so interpolation between keyframes cannot overshoot either.
 */
const normaliseFeet = (k: PoseKeyframe): PoseKeyframe => {
  const out = { ...k };
  const lo = -75 + 3;
  const hi = 45 - 3;
  for (const side of ['L', 'R'] as const) {
    const tibia = (side === 'L' ? k.tibiaDegL : k.tibiaDegR) ?? k.tibiaDeg;
    const pitch = (side === 'L' ? k.footPitchDegL : k.footPitchDegR) ?? 0;
    const dorsi = -tibia - pitch;
    const fixed = dorsi > hi ? -tibia - hi : dorsi < lo ? -tibia - lo : pitch;
    if (side === 'L') out.footPitchDegL = fixed;
    else out.footPitchDegR = fixed;
  }
  return out;
};

/** Build a renderable, loop-closed clip for one library exercise. */
export const buildFamilyClip = (id: string, name: string, spec: ExerciseMotionSpec): MotionClip => {
  const gen = GENERATORS[spec.family];
  let out = gen(spec.params);
  if (spec.params.left) out = { ...out, frames: out.frames.map((f) => ({ ...f, pose: mirror(f.pose) })) };
  const frames = [...out.frames].sort((a, b) => a.t - b.t);
  const secondary = out.secondary.filter((m) => !out.primary.includes(m));
  const keyframes: PoseKeyframe[] = frames.map((f) => normaliseFeet({ ...pose(f.pose), t: f.t, activation: activationFor(out.primary, secondary, f.effort) }));
  // Loop closure: the rep ends exactly where it began.
  keyframes.push({ ...keyframes[0], t: 1 });
  const equipment = spec.equipment.length > 0 ? [...spec.equipment] : (['bodyweight'] as EquipmentId[]);
  return {
    id: `lib:${id}`,
    name,
    posture: out.posture,
    barAnchor: out.barAnchor ?? 'wrists',
    armsFollowGravity: !!out.armsFollowGravity,
    equipment,
    supinePelvisY: out.supinePelvisY,
    keyframes,
    phases: phaseSpans(out.phases),
    primary: out.primary,
    secondary,
    cues: out.cues,
    family: spec.family,
    simplified: !!spec.simplified,
    simplifiedNote: spec.simplified,
    solve: { carriedElbowAxis: true, noGripBias: true, ...out.solve },
    props: out.props,
    cableAnchor: out.cableAnchor,
  };
};
