// Form Check proof — the measured half.
//
// Everything asserted here is pure geometry on pose landmarks: no camera, no
// model download, no network. That is exactly the part that has to be right,
// because it drives the skeleton colour and the "good / fix / danger" verdict
// the user sees, and it now outranks the Gemini sample in the session summary.
//
// Deliberately firebase-free and DOM-free so it runs under plain tsx.

const C = { g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.g}PASS${C.x} ${name}${detail ? ` ${C.y}(${detail})${C.x}` : ''}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${name}${detail ? ` ${C.y}(${detail})${C.x}` : ''}`); }
};

const { angleAt, leanFromVertical, classifyMovement, evaluateForm } =
  await import('../src/lib/formRules.ts');
const { LM, bodyFullyVisible } = await import('../src/lib/poseDetector.ts');

/** Build a full 33-landmark array; unspecified joints sit at centre, visible. */
const pose = (overrides) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  for (const [k, v] of Object.entries(overrides)) {
    lm[LM[k]] = { x: v[0], y: v[1], z: 0, visibility: v[2] ?? 0.95 };
  }
  return lm;
};

/** A symmetric standing body. Deltas shift the joints that matter per case. */
const standing = (o = {}) => pose({
  nose: [0.50, 0.16],
  shoulderL: [0.44, 0.30], shoulderR: [0.56, 0.30],
  elbowL: [0.42, 0.44], elbowR: [0.58, 0.44],
  wristL: [0.42, 0.57], wristR: [0.58, 0.57],
  hipL: [0.45, 0.52], hipR: [0.55, 0.52],
  kneeL: [0.45, 0.72], kneeR: [0.55, 0.72],
  ankleL: [0.45, 0.92], ankleR: [0.55, 0.92],
  footL: [0.47, 0.96], footR: [0.57, 0.96],
  ...o,
});

// ── Part A — angle primitives ────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part A — angle primitives${C.x}\n`);

const A = { x: 0, y: 1 }, B = { x: 0, y: 0 }, D = { x: 1, y: 0 };
check('a right angle measures 90 degrees', Math.abs(angleAt(A, B, D) - 90) < 1e-9,
  `${angleAt(A, B, D).toFixed(6)}`);
check('a straight limb measures 180 degrees',
  Math.abs(angleAt({ x: -1, y: 0 }, B, D) - 180) < 1e-9);
check('a degenerate (zero-length) segment yields NaN, never a fake angle',
  Number.isNaN(angleAt(B, B, D)));
check('angle is symmetric in its outer points',
  Math.abs(angleAt(A, B, D) - angleAt(D, B, A)) < 1e-12);

check('vertical trunk leans 0 degrees', Math.abs(leanFromVertical({ x: 0, y: 0 }, { x: 0, y: 1 })) < 1e-9);
check('a 45-degree lean reads 45', Math.abs(leanFromVertical({ x: 1, y: 0 }, { x: 0, y: 1 }) - 45) < 1e-9);
check('lean is unsigned — left and right read the same',
  Math.abs(leanFromVertical({ x: 1, y: 0 }, { x: 0, y: 1 }) - leanFromVertical({ x: -1, y: 0 }, { x: 0, y: 1 })) < 1e-12);

// ── Part B — movement classification ─────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part B — movement classification${C.x}\n`);

const cases = [
  ['Back Squat', 'squat'], ['Goblet squat', 'squat'],
  ['Romanian Deadlift', 'deadlift'], ['RDL', 'deadlift'], ['Good Morning', 'deadlift'],
  ['Barbell Bench Press', 'press_horizontal'], ['Push-up', 'press_horizontal'], ['Push up', 'press_horizontal'],
  ['Overhead Press', 'press_vertical'], ['Military press', 'press_vertical'],
  ['Bent Over Row', 'row'], ['Pull-up', 'row'],
  ['Bicep Curl', 'curl'], ['Lateral Raise', 'curl'],
  ['Front Plank', 'plank'],
  ['Bulgarian Split Squat', 'lunge'], ['Walking Lunge', 'lunge'],
  ['Farmer Carry', 'generic'],
];
for (const [name, want] of cases) {
  check(`"${name}" -> ${want}`, classifyMovement(name) === want, classifyMovement(name));
}
check('classification is case-insensitive', classifyMovement('BACK SQUAT') === 'squat');
check('lunge beats squat in "split squat" (more specific wins)',
  classifyMovement('Split Squat') === 'lunge');

// ── Part C — verdicts on constructed bodies ──────────────────────────────────
console.log(`\n${C.b}${C.c}Part C — verdicts on constructed bodies${C.x}\n`);

const upright = evaluateForm(standing(), 'Back Squat');
check('a tall, locked-out stance is "good"', upright.status === 'good',
  `${upright.status}, score ${upright.score}`);
check('a clean frame scores 100', upright.score === 100, `${upright.score}`);
check('a clean frame highlights no joints', upright.badJoints.size === 0);

// Knees collapsing inward with the knees bent under load.
const valgus = evaluateForm(standing({
  hipL: [0.45, 0.62], hipR: [0.55, 0.62],
  kneeL: [0.485, 0.75], kneeR: [0.515, 0.75],
  ankleL: [0.40, 0.92], ankleR: [0.60, 0.92],
}), 'Back Squat');
check('knees caving inward is DANGER', valgus.status === 'danger',
  `${valgus.status}: ${valgus.issues.map(i => i.cue).join(' / ')}`);
check('knee valgus highlights the knees', valgus.badJoints.has(LM.kneeL) && valgus.badJoints.has(LM.kneeR));
check('knee tracking is reported as a real measurement',
  typeof valgus.metrics.kneeTracking === 'number' && valgus.metrics.kneeTracking < 0.6,
  `ratio ${valgus.metrics.kneeTracking}`);

// A narrow-hip / wide-stance lifter standing locked out. The knees sit well
// inside the ankles, so the raw ratio alone would scream valgus — but the legs
// are dead straight (knees exactly on the hip-ankle line), so there is no load
// on a bent knee and the rule must stay quiet.
const valgusStanding = evaluateForm(standing({
  hipL: [0.48, 0.52], hipR: [0.52, 0.52],
  kneeL: [0.44, 0.72], kneeR: [0.56, 0.72],
  ankleL: [0.40, 0.92], ankleR: [0.60, 0.92],
}), 'Back Squat');
check('a locked-out leg reads as straight (the guard\'s precondition)',
  valgusStanding.metrics.kneeAngle >= 150, `${valgusStanding.metrics.kneeAngle} deg`);
check('knee tracking ratio alone would have flagged this stance',
  valgusStanding.metrics.kneeTracking === undefined || valgusStanding.metrics.kneeTracking < 0.78,
  `ratio ${valgusStanding.metrics.kneeTracking ?? 'not measured'}`);
check('knee tracking is NOT judged with the legs straight (no false alarm at lockout)',
  !valgusStanding.issues.some(i => /knees out/i.test(i.cue)),
  valgusStanding.issues.map(i => i.cue).join(' / ') || 'no issues');

// Folding forward at the hips.
const folded = evaluateForm(standing({
  shoulderL: [0.24, 0.46], shoulderR: [0.32, 0.46],
  hipL: [0.52, 0.60], hipR: [0.60, 0.60],
}), 'Back Squat');
check('folding the chest forward is flagged', folded.status !== 'good',
  `lean ${folded.metrics.trunkLean} deg -> ${folded.status}`);

// Plank with the hips on the floor.
const sagPlank = evaluateForm(standing({
  shoulderL: [0.20, 0.50], shoulderR: [0.20, 0.52],
  hipL: [0.50, 0.72], hipR: [0.50, 0.74],
  ankleL: [0.82, 0.56], ankleR: [0.82, 0.58],
}), 'Front Plank');
check('a sagging plank is DANGER', sagPlank.status === 'danger',
  `body line ${sagPlank.metrics.bodyLine} deg`);
check('a sagging plank highlights the hips', sagPlank.badJoints.has(LM.hipL));

const goodPlank = evaluateForm(standing({
  shoulderL: [0.20, 0.60], shoulderR: [0.20, 0.60],
  hipL: [0.50, 0.60], hipR: [0.50, 0.60],
  ankleL: [0.82, 0.60], ankleR: [0.82, 0.60],
}), 'Front Plank');
check('a straight plank is "good"', goodPlank.status === 'good',
  `body line ${goodPlank.metrics.bodyLine} deg`);

// Curl with the elbow drifting off the ribs.
const drift = evaluateForm(standing({
  elbowL: [0.22, 0.44], elbowR: [0.78, 0.44],
}), 'Bicep Curl');
check('an elbow drifting off the ribs is flagged on a curl',
  drift.issues.some(i => /elbow/i.test(i.cue)),
  `drift ${drift.metrics.elbowDrift}`);
check('elbow drift is a FIX, not a DANGER (it is sloppy, not dangerous)',
  drift.status === 'fix', drift.status);

// Overhead press with a big backward lean.
const layback = evaluateForm(standing({
  shoulderL: [0.34, 0.30], shoulderR: [0.46, 0.30],
  hipL: [0.52, 0.52], hipR: [0.62, 0.52],
}), 'Overhead Press');
check('leaning back under an overhead press is DANGER', layback.status === 'danger',
  `lean ${layback.metrics.trunkLean} deg`);

// The same lean is fine on a row, where hinging over is the point.
const rowLean = evaluateForm(standing({
  shoulderL: [0.34, 0.30], shoulderR: [0.46, 0.30],
  hipL: [0.52, 0.52], hipR: [0.62, 0.52],
}), 'Bent Over Row');
check('the same trunk angle is NOT a fault on a row (rules are per-movement)',
  rowLean.status !== 'danger', rowLean.status);

// ── Part D — invariants ──────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part D — invariants${C.x}\n`);

const sampleVerdicts = [upright, valgus, folded, sagPlank, goodPlank, drift, layback, rowLean];
check('status "good" implies zero issues, and vice versa',
  sampleVerdicts.every(v => (v.status === 'good') === (v.issues.length === 0)));
check('score is 100 exactly when the status is "good"',
  sampleVerdicts.every(v => (v.score === 100) === (v.status === 'good')));
check('any DANGER issue forces DANGER status',
  sampleVerdicts.every(v => (v.issues.some(i => i.severity === 'danger') ? v.status === 'danger' : true)));
check('badJoints is exactly the union of the issues\' joints',
  sampleVerdicts.every(v => {
    const want = new Set(v.issues.flatMap(i => i.joints));
    return want.size === v.badJoints.size && [...want].every(j => v.badJoints.has(j));
  }));
check('score never leaves 0..100',
  sampleVerdicts.every(v => v.score >= 0 && v.score <= 100));

// ── Part E — visibility gate ─────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part E — visibility gate${C.x}\n`);

check('a fully visible body passes the gate', bodyFullyVisible(standing()));
check('null landmarks fail the gate', !bodyFullyVisible(null));
check('an occluded knee fails the gate',
  !bodyFullyVisible(standing({ kneeR: [0.55, 0.72, 0.2] })));
check('a body extrapolated off-frame fails the gate',
  !bodyFullyVisible(standing({ ankleR: [0.55, 1.4] })));

// ── Part F — fuzz (hostile input, zero tolerance) ────────────────────────────
console.log(`\n${C.b}${C.c}Part F — fuzz (hostile input, zero tolerance)${C.x}\n`);

const names = ['Back Squat', 'RDL', 'Bench Press', 'Overhead Press', 'Row', 'Curl', 'Plank', 'Lunge', 'Sled Push', ''];
const hostile = [0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1e9, -1e9, 1e-12];
let threw = 0, badScore = 0, badStatus = 0, badMetric = 0;
for (let i = 0; i < 6000; i++) {
  const lm = Array.from({ length: 33 }, () => ({
    x: Math.random() < 0.25 ? hostile[(Math.random() * hostile.length) | 0] : Math.random(),
    y: Math.random() < 0.25 ? hostile[(Math.random() * hostile.length) | 0] : Math.random(),
    z: 0,
    visibility: Math.random(),
  }));
  try {
    const v = evaluateForm(lm, names[i % names.length]);
    if (!Number.isFinite(v.score) || v.score < 0 || v.score > 100) badScore++;
    if (!['good', 'fix', 'danger'].includes(v.status)) badStatus++;
    for (const val of Object.values(v.metrics)) if (!Number.isFinite(val)) badMetric++;
  } catch { threw++; }
}
check('6,000 hostile poses: zero throws', threw === 0, `${threw} throws`);
check('6,000 hostile poses: score stays a finite 0..100', badScore === 0, `${badScore} bad`);
check('6,000 hostile poses: status is always one of the three', badStatus === 0, `${badStatus} bad`);
check('6,000 hostile poses: no metric is ever NaN or Infinity', badMetric === 0, `${badMetric} bad`);

let gateThrew = 0;
for (let i = 0; i < 2000; i++) {
  const lm = Math.random() < 0.1 ? null : Array.from({ length: (Math.random() * 34) | 0 }, () => ({
    x: Math.random(), y: Math.random(), visibility: Math.random(),
  }));
  try { bodyFullyVisible(lm); } catch { gateThrew++; }
}
check('2,000 malformed landmark arrays: the visibility gate never throws', gateThrew === 0, `${gateThrew} throws`);

// ── Summary ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${pass}/${total} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`); process.exit(1); }
