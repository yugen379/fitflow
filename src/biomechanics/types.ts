/**
 * Biomechanics engine — shared type surface.
 *
 * Everything the 3D viewport, the RTK slices and the RTK Query endpoints agree
 * on lives here so there is exactly one definition of a joint, a phase and a
 * muscle id. Angles are stored in DEGREES at rest (authoring units) and
 * converted to radians only inside the FK solver.
 */

// ---------------------------------------------------------------------------
// Muscles
// ---------------------------------------------------------------------------

/**
 * The 16 muscle regions the avatar can shade. The order is load-bearing: it is
 * the row index into the activation lookup texture uploaded to the GPU, so
 * never reorder without bumping ACTIVATION_TEXTURE_VERSION.
 */
export const MUSCLE_IDS = [
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'erectors',
  'lats',
  'traps',
  'pecs',
  'delt_front',
  'delt_side',
  'delt_rear',
  'triceps',
  'biceps',
  'forearms',
  'abs',
  'obliques',
] as const;

export type MuscleId = (typeof MUSCLE_IDS)[number];

export const MUSCLE_COUNT = MUSCLE_IDS.length;

/** Index of a muscle in the activation texture. -1 means "no muscle". */
export const MUSCLE_INDEX: Readonly<Record<MuscleId, number>> = MUSCLE_IDS.reduce(
  (acc, id, i) => {
    acc[id] = i;
    return acc;
  },
  {} as Record<MuscleId, number>,
);

export const MUSCLE_LABELS: Readonly<Record<MuscleId, string>> = {
  quads: 'Quadriceps',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  erectors: 'Spinal erectors',
  lats: 'Lats',
  traps: 'Traps',
  pecs: 'Pectorals',
  delt_front: 'Front delts',
  delt_side: 'Side delts',
  delt_rear: 'Rear delts',
  triceps: 'Triceps',
  biceps: 'Biceps',
  forearms: 'Forearms',
  abs: 'Abdominals',
  obliques: 'Obliques',
};

/** Sparse activation map, 0..1 per muscle. An absent key means zero. */
export type ActivationMap = Partial<Record<MuscleId, number>>;

/**
 * Index reserved for geometry that belongs to no muscle (head, hands, feet).
 * The activation lookup texture is MUSCLE_COUNT + 1 wide and this last row is
 * pinned to zero, so neutral geometry never picks up heat.
 */
export const NEUTRAL_MUSCLE_INDEX = MUSCLE_COUNT;

/** One row of the activation legend. */
export interface MuscleActivationRow {
  id: MuscleId;
  label: string;
  /** 0..1 */
  value: number;
  primary: boolean;
}

// ---------------------------------------------------------------------------
// Movement phases
// ---------------------------------------------------------------------------

export type MovementPhase = 'eccentric' | 'isometric' | 'concentric' | 'lockout';

export interface PhaseSpan {
  phase: MovementPhase;
  /** Normalised start on the 0..1 rep timeline (inclusive). */
  start: number;
  /** Normalised end on the 0..1 rep timeline (exclusive, except the last span). */
  end: number;
}

export const PHASE_LABELS: Readonly<Record<MovementPhase, string>> = {
  eccentric: 'Eccentric',
  isometric: 'Isometric',
  concentric: 'Concentric',
  lockout: 'Lockout',
};

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

/** Named nodes the FK solver produces world-space positions for. */
export const JOINT_IDS = [
  'pelvis',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'wristL',
  'wristR',
  'handL',
  'handR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'ankleL',
  'ankleR',
  'toeL',
  'toeR',
] as const;

export type JointId = (typeof JOINT_IDS)[number];

/** World-space position, metres, Y-up, +Z is the direction the athlete faces. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A fully solved skeleton for one instant in the movement. */
export type Skeleton = Record<JointId, Vec3>;

/**
 * A single authored pose. Leg angles are absolute (world frame, because gravity
 * and the floor define them); arm angles are relative to the trunk axis, which
 * is how shoulder flexion and abduction are actually defined anatomically.
 */
export interface PoseKeyframe {
  /** Normalised time on the rep timeline, 0..1. Must be ascending. */
  t: number;
  /** Trunk inclination from vertical-up, positive = leaning forward. */
  trunkDeg: number;
  /** Femur direction (hip to knee) from straight-down, positive = knee forward. */
  femurDeg: number;
  /** Tibia direction (knee to ankle) from straight-down, positive = ankle forward. */
  tibiaDeg: number;
  /** Shoulder flexion in the trunk frame. 0 = arm along body, 90 = out front, 180 = overhead. */
  shoulderFlexDeg: number;
  /** Shoulder abduction in the trunk frame. 0 = at the side, 90 = straight out. */
  shoulderAbdDeg: number;
  /** Elbow flexion. 0 = fully extended. */
  elbowDeg: number;
  /**
   * Internal/external rotation of the humerus, which swings the elbow-flexion
   * plane around the upper-arm axis. Positive is external rotation. Optional
   * because most poses leave it at zero.
   */
  shoulderRotDeg?: number;

  // --- Extended degrees of freedom (generated exercise clips) -------------
  // Every field below is optional and falls back to the symmetric value above,
  // so the five hand-authored clips are untouched. Per-side values let the
  // rig show lunges, running, single-arm rows and alternating curls.
  femurDegL?: number;
  femurDegR?: number;
  tibiaDegL?: number;
  tibiaDegR?: number;
  /**
   * Yaw of a leg's swing plane about the vertical, degrees. 0 = the femur
   * swings forward/back; +90 on the right leg (or -90 on the left) swings it
   * straight out to the side, which is how hip abduction is expressed.
   */
  legYawDegL?: number;
  legYawDegR?: number;
  /** Foot pitch, degrees. 0 = flat on the floor, positive = toes point down (plantarflexion). */
  footPitchDegL?: number;
  footPitchDegR?: number;
  shoulderFlexDegL?: number;
  shoulderFlexDegR?: number;
  shoulderAbdDegL?: number;
  shoulderAbdDegR?: number;
  elbowDegL?: number;
  elbowDegR?: number;
  /** Axial trunk rotation (twist) about the spine, degrees. Positive turns the chest to the athlete's right. */
  trunkTwistDeg?: number;
  /** Lateral trunk flexion, degrees. Positive bends toward the athlete's right. */
  trunkSideDeg?: number;
  /** Head pitch relative to the trunk, degrees. Positive = chin to chest. */
  neckDeg?: number;
  /**
   * Whole-body pitch about the pelvis, applied after the limbs are solved.
   * +90 lays an upright body face-down (push-up), -90 face-up (crunch).
   */
  rootPitchDeg?: number;
  /** Whole-body roll about the forward axis, applied after pitch. Positive rolls onto the right side. */
  rootRollDeg?: number;
  /** Vertical offset added after grounding — flight phase of a jump, metres. */
  liftY?: number;
  /** Forward offset added after anchoring — travel of a box jump, metres. */
  shiftZ?: number;

  /** Muscle activation at this instant, 0..1. */
  activation: ActivationMap;
}

/**
 * standing — legacy: ankles grounded at RIG.ankleHeight.
 * supine   — legacy: pelvis pinned to the bench, feet IK'd to the floor.
 * floor    — the lowest contact point (feet, hands, knees, pelvis, back, head) rests on the floor.
 * hanging  — the hands are pinned to an overhead bar.
 */
export type Posture = 'standing' | 'supine' | 'floor' | 'hanging';

/** Where the implement rides on the body — drives the bar-path trace. */
/** wristR = single implement in the right hand; pelvis = bar across the hips (hip thrust). */
export type BarAnchor = 'wrists' | 'traps' | 'wristR' | 'pelvis';

export type EquipmentId = 'barbell' | 'dumbbell' | 'cable' | 'bodyweight' | 'kettlebell' | 'band' | 'machine';

export interface EquipmentOption {
  id: EquipmentId;
  label: string;
  /** Half-distance between the hands, metres. */
  gripHalfWidth: number;
  /** Whether plates render on the implement. */
  showPlates: boolean;
}

/** A complete, renderable movement definition. */
export interface MotionClip {
  /** Stable id; matches src/data/exerciseLibrary.json where an entry exists. */
  id: string;
  name: string;
  posture: Posture;
  barAnchor: BarAnchor;
  /**
   * When true the humerus hangs vertically in world space regardless of trunk
   * lean (deadlift, row bottom) — gravity wins over the trunk frame.
   */
  armsFollowGravity: boolean;
  /** Equipment this clip can be shown with; the first entry is the default. */
  equipment: EquipmentId[];
  /** Pelvis height above the floor for supine clips (bench pad + torso). */
  supinePelvisY?: number;
  keyframes: PoseKeyframe[];
  phases: PhaseSpan[];
  primary: MuscleId[];
  secondary: MuscleId[];
  /** Short coaching cue shown next to the scrubber for each phase. */
  cues: Record<MovementPhase, string>;

  // --- Generated (per-library-exercise) clips only ----------------------
  /** Motion family this clip was generated from. Absent on hand-authored clips. */
  family?: string;
  /** True when the demo is an honest approximation rather than the real movement. */
  simplified?: boolean;
  /** Why the demo is simplified — shown in the UI next to the badge. */
  simplifiedNote?: string;
  /** Solver extras for generated clips; see SolveOptions in rig.ts. */
  solve?: ClipSolveExtras;
  /** Scenery the movement needs (bench, plyo box, pull-up bar). Replaces the legacy supine bench. */
  props?: ClipProp[];
  /** Where a cable or band is anchored, world metres. */
  cableAnchor?: Vec3;
}

export interface ClipSolveExtras {
  /** Elbow flexion axis carried with the humerus (continuous through 90 deg of flexion). */
  carriedElbowAxis?: boolean;
  /** Ignore equipment grip width; the clip authors its own abduction. */
  noGripBias?: boolean;
  /** Keep the pelvis/heel IK of a supine (bench) clip from re-solving the tibia. */
  freeLegs?: boolean;
  /** Which landmark is held fixed horizontally so feet or hands never slide. */
  anchor?: 'pelvis' | 'feet' | 'hands' | 'footL' | 'footR';
  /** Bar height for hanging clips, metres. */
  barY?: number;
  /** Joints allowed to carry body weight for `floor` grounding; default is every contact. */
  contacts?: ContactId[];
}

export type ContactId = 'feet' | 'knees' | 'hands' | 'elbows' | 'pelvis' | 'back' | 'head';

/** A static piece of scenery: a box (bench, plyo box, wall, seat) or a bar along X. */
export interface ClipProp {
  kind: 'box' | 'bar';
  /** Centre, world metres. */
  x: number;
  y: number;
  z: number;
  /** Full size, metres (a bar uses sx as its length and sy as its diameter). */
  sx: number;
  sy: number;
  sz: number;
  /** Pitch about X, degrees (an incline bench pad). */
  pitchDeg?: number;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/** Anatomical joint angles derived from the solved skeleton, in degrees. */
export interface JointAngles {
  hip: number;
  knee: number;
  ankle: number;
  shoulder: number;
  elbow: number;
  trunk: number;
}

/**
 * One high-frequency sample produced by the render loop. Samples are written to
 * a ring buffer and never dispatched one-by-one — see telemetryMiddleware.
 */
export interface TelemetrySample {
  /** performance.now() at capture. */
  at: number;
  /** Normalised rep timeline position, 0..1. */
  t: number;
  phase: MovementPhase;
  angles: JointAngles;
  /** Dense activation vector, copied (never aliased) into the sample. */
  activation: number[];
  /** Bar height above the floor, metres. */
  barHeight: number;
}

/** The coalesced snapshot the middleware commits to the store. */
export interface TelemetrySnapshot {
  t: number;
  phase: MovementPhase;
  angles: JointAngles;
  activation: number[];
  barHeight: number;
  /** Samples folded into this snapshot since the previous commit. */
  sampleCount: number;
  /** Wall-clock of the newest folded sample. */
  at: number;
}

// ---------------------------------------------------------------------------
// Render quality
// ---------------------------------------------------------------------------

export type QualityTier = 'high' | 'balanced' | 'low';

export interface QualityProfile {
  tier: QualityTier;
  /** Cap applied on top of devicePixelRatio. */
  maxPixelRatio: number;
  /** Radial segment count for limb geometry. */
  radialSegments: number;
  /** Whether the ground contact shadow renders. */
  shadow: boolean;
  antialias: boolean;
  /** Bar-path trace resolution. */
  barPathSamples: number;
}

export type ThrottleReason = 'none' | 'fps' | 'thermal' | 'battery' | 'device';

export interface PerfSnapshot {
  fps: number;
  /** Exponential moving average — the value the guardrail reacts to. */
  fpsAvg: number;
  tier: QualityTier;
  /** True once the guardrail has stepped quality down at least once. */
  throttled: boolean;
  /** Why the last downgrade happened, for the debug HUD. */
  reason: ThrottleReason;
  droppedFrames: number;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** Spherical orbit coordinates around the avatar. Angles in radians. */
export interface OrbitState {
  /** Horizontal angle. */
  azimuth: number;
  /** Vertical angle, clamped to (0, PI) so the camera never flips. */
  polar: number;
  /** Distance from the target, as a multiple of the scene's auto-fit distance. */
  radius: number;
  /** Look-at offset from the framing centre, metres. */
  targetY: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type SessionStatus = 'idle' | 'active' | 'resting' | 'paused' | 'summary' | 'saving';

export interface SetEntry {
  /** Client-generated so optimistic writes have a stable identity. */
  id: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  weightKg: number;
  /** Rate of perceived exertion, 1..10. */
  rpe: number;
  equipment: EquipmentId;
  completedAt: number;
  /** Mean activation vector observed while the set was performed. */
  activation: number[];
  /** Peak joint angles observed during the set. */
  peakAngles: JointAngles;
}
