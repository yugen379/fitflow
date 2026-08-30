// Measured form rules for Form Check.
//
// Everything here is geometry on MediaPipe landmarks — no model, no network.
// That is the point: joint angles are computed every frame, so the skeleton can
// go red the instant a knee caves rather than up to 3 s later when Gemini
// answers.
//
// HONESTY BOUNDARY: a single 2D camera gives joint centres, not spines.
// MediaPipe has no mid-back landmark, so true lumbar rounding is NOT
// measurable here and nothing below claims to detect it. What is measurable —
// joint angles, trunk lean, knee tracking, bar-path proxies, symmetry — is
// measured, and everything else is left to the Gemini cue.

import { LM, type Landmarks } from './poseDetector';

export type FormStatus = 'good' | 'fix' | 'danger';

export interface FormIssue {
  /** Short imperative coaching cue, shown over the video. */
  cue: string;
  /** 'danger' issues mean load on a joint in a bad position — stop the set. */
  severity: 'fix' | 'danger';
  /** Landmark indices at fault; the overlay draws these limbs in the alert colour. */
  joints: number[];
}

export interface FormVerdict {
  status: FormStatus;
  /** 0-100, derived from what actually went wrong — not a model's guess. */
  score: number;
  issues: FormIssue[];
  /** Fast lookup for the renderer. */
  badJoints: Set<number>;
  /** Human-readable measurements, for the debug/telemetry line. */
  metrics: Record<string, number>;
}

type P = { x: number; y: number; visibility?: number };

/** Interior angle at `b`, in degrees, in image space. */
export const angleAt = (a: P, b: P, c: P): number => {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magA = Math.hypot(abx, aby);
  const magC = Math.hypot(cbx, cby);
  if (magA < 1e-6 || magC < 1e-6) return NaN;
  // Clamp: floating point can push |cos| a hair past 1 and make acos NaN.
  const cos = Math.max(-1, Math.min(1, dot / (magA * magC)));
  return (Math.acos(cos) * 180) / Math.PI;
};

/**
 * Lean of the vector b->a away from vertical, in degrees. 0 = upright.
 * Image y grows downward, so "up" is negative y — hence the sign flip.
 */
export const leanFromVertical = (a: P, b: P): number => {
  const dx = a.x - b.x;
  const dy = -(a.y - b.y);
  if (Math.hypot(dx, dy) < 1e-6) return NaN;
  return Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
};

const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const ok = (n: number) => Number.isFinite(n);

/** Which side faces the camera more squarely — that side's angles are the reliable ones. */
const betterSide = (lm: Landmarks): 'L' | 'R' => {
  const l = (lm[LM.hipL]?.visibility ?? 0) + (lm[LM.kneeL]?.visibility ?? 0) + (lm[LM.shoulderL]?.visibility ?? 0);
  const r = (lm[LM.hipR]?.visibility ?? 0) + (lm[LM.kneeR]?.visibility ?? 0) + (lm[LM.shoulderR]?.visibility ?? 0);
  return r > l ? 'R' : 'L';
};

/** Normalise the free-text exercise name onto a rule set. */
export type Movement = 'squat' | 'deadlift' | 'press_horizontal' | 'press_vertical' | 'row' | 'curl' | 'plank' | 'lunge' | 'generic';

export const classifyMovement = (name: string): Movement => {
  const n = name.toLowerCase();
  if (/plank/.test(n)) return 'plank';
  if (/lunge|split squat|bulgarian/.test(n)) return 'lunge';
  if (/squat|leg press/.test(n)) return 'squat';
  if (/deadlift|rdl|romanian|hip hinge|good morning/.test(n)) return 'deadlift';
  if (/bench|push[- ]?up|chest press|dip/.test(n)) return 'press_horizontal';
  if (/overhead|shoulder press|ohp|military/.test(n)) return 'press_vertical';
  if (/row|pull[- ]?up|chin[- ]?up|lat pull/.test(n)) return 'row';
  if (/curl|extension|raise|fly/.test(n)) return 'curl';
  return 'generic';
};

/**
 * Knee valgus — knees tracking inside the ankles under load, the single most
 * common way people hurt themselves squatting. Measured as knee separation
 * relative to ankle separation, so it is scale- and distance-invariant.
 * Returns a ratio: 1.0 = knees track the ankles, < 1 = caving in.
 */
const valgusRatio = (lm: Landmarks): number => {
  const kneeGap = Math.abs(lm[LM.kneeL].x - lm[LM.kneeR].x);
  const ankleGap = Math.abs(lm[LM.ankleL].x - lm[LM.ankleR].x);
  if (ankleGap < 1e-4) return NaN;
  return kneeGap / ankleGap;
};

export const evaluateForm = (lm: Landmarks, exerciseName: string): FormVerdict => {
  const move = classifyMovement(exerciseName);
  const s = betterSide(lm);
  const shoulder = lm[s === 'L' ? LM.shoulderL : LM.shoulderR];
  const hip = lm[s === 'L' ? LM.hipL : LM.hipR];
  const knee = lm[s === 'L' ? LM.kneeL : LM.kneeR];
  const ankle = lm[s === 'L' ? LM.ankleL : LM.ankleR];
  const elbow = lm[s === 'L' ? LM.elbowL : LM.elbowR];
  const wrist = lm[s === 'L' ? LM.wristL : LM.wristR];

  const issues: FormIssue[] = [];
  const metrics: Record<string, number> = {};

  const kneeAngle = angleAt(hip, knee, ankle);
  const hipAngle = angleAt(shoulder, hip, knee);
  const elbowAngle = angleAt(shoulder, elbow, wrist);
  const trunkLean = leanFromVertical(shoulder, hip);
  if (ok(kneeAngle)) metrics.kneeAngle = Math.round(kneeAngle);
  if (ok(hipAngle)) metrics.hipAngle = Math.round(hipAngle);
  if (ok(elbowAngle)) metrics.elbowAngle = Math.round(elbowAngle);
  if (ok(trunkLean)) metrics.trunkLean = Math.round(trunkLean);

  const push = (cue: string, severity: 'fix' | 'danger', joints: number[]) =>
    issues.push({ cue, severity, joints });

  /**
   * Record a measurement only when it is a real number. Landmarks can arrive as
   * Infinity or NaN (a dropped frame, a body half out of shot), and a metric
   * that is not finite would surface in telemetry as a fake reading.
   */
  const put = (key: string, value: number, round = 1) => {
    if (Number.isFinite(value)) metrics[key] = Math.round(value * round) / round;
  };

  // --- Shared: knees caving under load. Applies to anything on two legs. ---
  if (move === 'squat' || move === 'lunge' || move === 'deadlift') {
    const vr = valgusRatio(lm);
    if (ok(vr)) {
      metrics.kneeTracking = Math.round(vr * 100) / 100;
      // Only judge tracking once the knees are actually bent and loaded.
      if (ok(kneeAngle) && kneeAngle < 150) {
        if (vr < 0.6) push('Push your knees out.', 'danger', [LM.kneeL, LM.kneeR, LM.ankleL, LM.ankleR]);
        else if (vr < 0.78) push('Knees out, track over your toes.', 'fix', [LM.kneeL, LM.kneeR]);
      }
    }
  }

  switch (move) {
    case 'squat': {
      if (ok(kneeAngle)) {
        // Depth is only judged at the bottom of a rep, which we take as "knees
        // meaningfully bent" — otherwise every rep is flagged shallow on the
        // way down.
        if (kneeAngle < 145 && kneeAngle > 115) push('Sit deeper — hips to parallel.', 'fix', [LM.hipL, LM.hipR, LM.kneeL, LM.kneeR]);
      }
      if (ok(trunkLean) && trunkLean > 55) push('Chest up — you are folding forward.', 'danger', [LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR]);
      else if (ok(trunkLean) && trunkLean > 42) push('Keep your chest tall.', 'fix', [LM.shoulderL, LM.shoulderR]);
      break;
    }
    case 'deadlift': {
      // A hinge is hips-back with a fairly quiet knee. A deep knee bend means
      // it has turned into a squat and the bar will drift forward.
      if (ok(kneeAngle) && ok(hipAngle) && kneeAngle < 110 && hipAngle < 100) {
        push('Hips back, not down — this is a hinge.', 'fix', [LM.hipL, LM.hipR, LM.kneeL, LM.kneeR]);
      }
      // Shoulders must stay ahead of (or over) the bar; wrists far in front of
      // the shoulder line means the load is swinging away from the body.
      const wristAhead = Math.abs(wrist.x - shoulder.x);
      put('barDrift', wristAhead, 100);
      if (ok(wristAhead) && wristAhead > 0.12) push('Keep the bar against your legs.', 'danger', [LM.wristL, LM.wristR, LM.shoulderL, LM.shoulderR]);
      break;
    }
    case 'press_horizontal': {
      // Elbow flare: upper arm perpendicular to the torso wrecks shoulders.
      const torso = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
      const upper = { x: elbow.x - shoulder.x, y: elbow.y - shoulder.y };
      const flare = angleAt(
        { x: shoulder.x + torso.x, y: shoulder.y + torso.y },
        shoulder,
        { x: shoulder.x + upper.x, y: shoulder.y + upper.y },
      );
      if (ok(flare)) {
        metrics.elbowFlare = Math.round(flare);
        if (flare > 105) push('Tuck your elbows — about 45 degrees.', 'danger', [LM.elbowL, LM.elbowR, LM.shoulderL, LM.shoulderR]);
        else if (flare > 85) push('Elbows in a little.', 'fix', [LM.elbowL, LM.elbowR]);
      }
      break;
    }
    case 'press_vertical': {
      if (ok(trunkLean) && trunkLean > 20) push('Stop leaning back — brace your ribs down.', 'danger', [LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR]);
      // At lockout the wrist should stack over the shoulder, not out in front.
      if (ok(elbowAngle) && elbowAngle > 155) {
        const stack = Math.abs(wrist.x - shoulder.x);
        put('lockoutStack', stack, 100);
        if (ok(stack) && stack > 0.09) push('Finish with the bar over your shoulders.', 'fix', [LM.wristL, LM.wristR]);
      }
      break;
    }
    case 'row': {
      if (ok(trunkLean) && trunkLean > 60) push('Stop rocking — keep your torso still.', 'fix', [LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR]);
      break;
    }
    case 'curl': {
      // Elbow drifting forward off the ribs turns a curl into a front raise.
      const drift = Math.abs(elbow.x - hip.x);
      put('elbowDrift', drift, 100);
      if (ok(drift) && drift > 0.14) push('Pin your elbow to your side.', 'fix', [LM.elbowL, LM.elbowR]);
      if (ok(trunkLean) && trunkLean > 18) push('Stop swinging — no body english.', 'fix', [LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR]);
      break;
    }
    case 'plank': {
      const line = angleAt(shoulder, hip, ankle);
      if (ok(line)) {
        metrics.bodyLine = Math.round(line);
        if (line < 160) push('Hips are sagging — squeeze your glutes.', 'danger', [LM.hipL, LM.hipR]);
        else if (line > 195) push('Drop your hips — you are piking up.', 'fix', [LM.hipL, LM.hipR]);
      }
      break;
    }
    case 'lunge': {
      // Front shin should stay near vertical; knee far past the toe loads it hard.
      const shin = leanFromVertical(knee, ankle);
      if (ok(shin)) {
        metrics.shinAngle = Math.round(shin);
        if (shin > 40) push('Knee is past your toes — shorten the step.', 'fix', [LM.kneeL, LM.kneeR, LM.ankleL, LM.ankleR]);
      }
      break;
    }
    default: {
      // Generic: only flag things true of essentially every standing lift.
      if (ok(trunkLean) && trunkLean > 45) push('Keep your torso steadier.', 'fix', [LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR]);
    }
  }

  const worst: FormStatus = issues.some(i => i.severity === 'danger') ? 'danger'
    : issues.length ? 'fix' : 'good';
  // Score is a deduction from perfect, so a clean frame really is 100.
  const score = Math.max(
    0,
    100 - issues.reduce((acc, i) => acc + (i.severity === 'danger' ? 30 : 12), 0),
  );

  const badJoints = new Set<number>();
  for (const i of issues) for (const j of i.joints) badJoints.add(j);

  return { status: worst, score, issues, badJoints, metrics };
};
