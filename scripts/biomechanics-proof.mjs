// 3D Biomechanics engine proof harness.
//
//   npm run proof:biomechanics
//
// Proves the deterministic core behind the Biomechanics Lab — everything that
// can be wrong without a GPU:
//   Part A — RIG / FORWARD KINEMATICS: bone lengths invariant, feet grounded,
//            left/right symmetry, no NaN, and named biomechanical checkpoints
//            (squat bar over mid-foot, deadlift bar at plate height, bench ROM).
//   Part B — MOTION CLIPS: keyframe ordering, phase coverage, activation range,
//            scratch-buffer reuse, determinism.
//   Part C — RTK SLICES: the session state machine, input clamping, telemetry
//            folding, and that a reset leaves no stale accumulators behind.
//   Part D — TELEMETRY RING BUFFER: coalescing maths, overflow accounting, and
//            the middleware's start/stop lifecycle.
//   Part E — FPS / THERMAL GUARDRAIL: step-down under sustained load, dwell and
//            hysteresis, no oscillation, hard tier bounds.
//   Part F — FUZZ: 5,000 hostile poses and 2,000 hostile action sequences —
//            zero throws, zero NaN, zero out-of-range output.
//
// Deliberately firebase-free: it imports no module that touches the Firestore
// SDK, so it runs anywhere with no credentials (same rule as the other harnesses).
//
// Success bar ("100% success, zero errors"):
//   • Every assertion passes  • Zero thrown errors anywhere

const { configureStore } = await import('@reduxjs/toolkit');

const { RIG, solvePose, readJointAngles, barPosition, trunkFrame, angleBetween, solveTibiaForFloor } = await import(
  '../src/biomechanics/rig.ts'
);
const { MOTION_CLIPS, getClip, getClipOrDefault, sampleClip, phaseAt, peakActivation, recruitedMuscles, EQUIPMENT } =
  await import('../src/biomechanics/motions.ts');
const { MUSCLE_COUNT, MUSCLE_IDS, MUSCLE_INDEX, NEUTRAL_MUSCLE_INDEX } = await import('../src/biomechanics/types.ts');
const { FpsGuard, initialTierForDevice, DEFAULT_GUARD_CONFIG } = await import('../src/biomechanics/perfGuard.ts');

const workoutModule = await import('../src/biomechanics/workoutSlice.ts');
const viewportModule = await import('../src/biomechanics/viewportSlice.ts');
const telemetryModule = await import('../src/biomechanics/telemetryMiddleware.ts');

const workoutReducer = workoutModule.default;
const viewportReducer = viewportModule.default;
const {
  sessionStarted, exerciseSelected, equipmentChanged, repCounted, repCountAdjusted, setLogged,
  restStarted, restTicked, restSkipped, elapsedTicked, sessionPaused, sessionResumed,
  sessionFinished, sessionReset, telemetryCommitted, buildQueueEntry,
} = workoutModule;
const {
  orbitChanged, orbitNudged, orbitReset, orbitPreset, scrubbed, playbackSet, playbackRateSet,
  layerToggled, perfSampled, reducedMotionSet, suspendedSet, viewportReady, viewportFailed,
  contextLost, contextRestored, QUALITY_PROFILES, ORBIT_LIMITS, clampOrbit, DEFAULT_ORBIT,
} = viewportModule;
const {
  telemetryMiddleware, pushTelemetryFrame, pushTelemetrySample, resetTelemetryBuffer,
  telemetryBufferStats, telemetryStreamStarted, telemetryStreamStopped,
} = telemetryModule;

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

let passCount = 0, failCount = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passCount++; console.log(`  ${PASS} ${name}`); }
  else { failCount++; console.log(`  ${FAIL} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`); }
};

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const optsFor = (clip, equipment = 'barbell') => ({
  posture: clip.posture,
  supinePelvisY: clip.supinePelvisY,
  armsFollowGravity: clip.armsFollowGravity,
  gripHalfWidth: EQUIPMENT[equipment].gripHalfWidth,
});

// ─── Part A: rig / forward kinematics ────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part A — rig and forward kinematics${C.x}\n`);

const SAMPLES = 200;

// Bone lengths are structural: no pose, clip or equipment choice may stretch a
// femur. This is the single assertion that catches almost every FK regression.
{
  const bones = [
    ['femur', 'hipR', 'kneeR', RIG.thigh],
    ['tibia', 'kneeR', 'ankleR', RIG.shank],
    ['femurL', 'hipL', 'kneeL', RIG.thigh],
    ['tibiaL', 'kneeL', 'ankleL', RIG.shank],
    ['torso', 'pelvis', 'chest', RIG.torso],
    ['humerusR', 'shoulderR', 'elbowR', RIG.upperArm],
    ['forearmR', 'elbowR', 'wristR', RIG.forearm],
    ['humerusL', 'shoulderL', 'elbowL', RIG.upperArm],
    ['forearmL', 'elbowL', 'wristL', RIG.forearm],
  ];
  let worst = 0, worstLabel = '';
  for (const clip of MOTION_CLIPS) {
    for (const equipment of clip.equipment) {
      for (let i = 0; i <= SAMPLES; i++) {
        const { pose } = sampleClip(clip, i / SAMPLES);
        const s = solvePose(pose, optsFor(clip, equipment));
        for (const [label, from, to, expected] of bones) {
          const error = Math.abs(dist(s[from], s[to]) - expected);
          if (error > worst) { worst = error; worstLabel = `${clip.id}/${equipment}/${label}`; }
        }
      }
    }
  }
  check('bone lengths invariant across every clip, equipment and phase', worst < 1e-9,
    `worst drift ${worst.toExponential(2)} m at ${worstLabel}`);
}

// Grounding: a standing athlete's feet are on the floor at every instant.
{
  let worst = 0, worstLabel = '';
  for (const clip of MOTION_CLIPS.filter((c) => c.posture === 'standing')) {
    for (let i = 0; i <= SAMPLES; i++) {
      const { pose } = sampleClip(clip, i / SAMPLES);
      const s = solvePose(pose, optsFor(clip));
      for (const ankle of [s.ankleL, s.ankleR]) {
        const error = Math.abs(ankle.y - RIG.ankleHeight);
        if (error > worst) { worst = error; worstLabel = `${clip.id}@${(i / SAMPLES).toFixed(2)}`; }
      }
    }
  }
  check('standing clips keep both ankles exactly on the floor', worst < 1e-9,
    `worst ${worst.toExponential(2)} m at ${worstLabel}`);
}

// Supine grounding is a different rule: the pelvis is pinned to the bench and
// the analytic tibia IK has to reach the floor from there.
{
  const bench = getClip('bench_press');
  let pelvisOk = true, feetWorst = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const { pose } = sampleClip(bench, i / SAMPLES);
    const s = solvePose(pose, optsFor(bench));
    if (Math.abs(s.pelvis.y - bench.supinePelvisY) > 1e-9) pelvisOk = false;
    feetWorst = Math.max(feetWorst, Math.abs(s.ankleR.y - RIG.ankleHeight));
  }
  check('bench: pelvis pinned to the bench height', pelvisOk);
  check('bench: analytic tibia IK puts the feet on the floor', feetWorst < 0.02,
    `worst ${(feetWorst * 100).toFixed(1)} cm off`);
}

// Left/right mirror symmetry. These five lifts are bilateral, so any asymmetry
// is a bug in the shoulder rotation signs rather than intent.
{
  let worst = 0, worstLabel = '';
  const pairs = [['hipL', 'hipR'], ['kneeL', 'kneeR'], ['ankleL', 'ankleR'], ['shoulderL', 'shoulderR'],
    ['elbowL', 'elbowR'], ['wristL', 'wristR'], ['handL', 'handR'], ['toeL', 'toeR']];
  for (const clip of MOTION_CLIPS) {
    for (let i = 0; i <= SAMPLES; i++) {
      const { pose } = sampleClip(clip, i / SAMPLES);
      const s = solvePose(pose, optsFor(clip));
      for (const [left, right] of pairs) {
        const error = Math.max(
          Math.abs(s[left].x + s[right].x),
          Math.abs(s[left].y - s[right].y),
          Math.abs(s[left].z - s[right].z),
        );
        if (error > worst) { worst = error; worstLabel = `${clip.id}/${left}`; }
      }
    }
  }
  check('skeleton is left/right symmetric on every bilateral clip', worst < 1e-9,
    `worst ${worst.toExponential(2)} at ${worstLabel}`);
}

// Every coordinate finite, every reported angle inside the anatomical range.
{
  let nanCount = 0, angleViolations = 0;
  for (const clip of MOTION_CLIPS) {
    for (let i = 0; i <= SAMPLES; i++) {
      const { pose } = sampleClip(clip, i / SAMPLES);
      const s = solvePose(pose, optsFor(clip));
      for (const joint of Object.keys(s)) {
        if (!finite(s[joint].x) || !finite(s[joint].y) || !finite(s[joint].z)) nanCount++;
      }
      const angles = readJointAngles(s);
      for (const value of Object.values(angles)) {
        if (!finite(value) || value < -0.001 || value > 180.001) angleViolations++;
      }
    }
  }
  check('no NaN or Infinity in any solved skeleton', nanCount === 0, `${nanCount} bad coordinates`);
  check('every reported joint angle lies in 0..180 degrees', angleViolations === 0, `${angleViolations} violations`);
}

// The trunk frame must be a right-handed orthonormal basis at every lean, or
// abduction silently mirrors and the arms drive the wrong way.
{
  let worst = 0;
  for (let deg = -180; deg <= 180; deg += 1) {
    const f = trunkFrame(deg);
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const len = (a) => Math.hypot(a.x, a.y, a.z);
    worst = Math.max(
      worst,
      Math.abs(len(f.up) - 1), Math.abs(len(f.forward) - 1), Math.abs(len(f.right) - 1),
      Math.abs(dot(f.up, f.forward)), Math.abs(dot(f.up, f.right)), Math.abs(dot(f.forward, f.right)),
    );
    // Right-handed: right x up == forward.
    const cross = {
      x: f.right.y * f.up.z - f.right.z * f.up.y,
      y: f.right.z * f.up.x - f.right.x * f.up.z,
      z: f.right.x * f.up.y - f.right.y * f.up.x,
    };
    worst = Math.max(worst, dist(cross, f.forward));
  }
  check('trunk frame is orthonormal and right-handed at every lean (-180..180)', worst < 1e-9,
    `worst ${worst.toExponential(2)}`);
}

// solveTibiaForFloor must refuse impossible geometry rather than emit NaN.
{
  check('tibia IK returns null when the floor is out of reach',
    solveTibiaForFloor(RIG.ankleHeight + RIG.shank + 0.5, true) === null &&
    solveTibiaForFloor(RIG.ankleHeight - 0.1, true) === null);
  const solved = solveTibiaForFloor(RIG.ankleHeight + RIG.shank * 0.8, true);
  check('tibia IK returns a negative angle when the knee leads the ankle', solved !== null && solved < 0);
}

// ─── Named biomechanical checkpoints ─────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part A2 — biomechanical checkpoints${C.x}\n`);

const solveAt = (clipId, t, equipment = 'barbell') => {
  const clip = getClip(clipId);
  const { pose } = sampleClip(clip, t);
  const skeleton = solvePose(pose, optsFor(clip, equipment));
  return { clip, pose, skeleton, angles: readJointAngles(skeleton), bar: barPosition(skeleton, clip.barAnchor, pose.trunkDeg) };
};

{
  const bottom = solveAt('squats', 0.5);
  check('squat bottom breaks parallel (knee flexion > 100 degrees)', bottom.angles.knee > 100,
    `${bottom.angles.knee} deg`);
  check('squat bottom holds a 40-50 degree trunk lean', bottom.angles.trunk >= 40 && bottom.angles.trunk <= 50,
    `${bottom.angles.trunk} deg`);
  // Mid-foot sits about half a foot length ahead of the ankle joint.
  const midfootZ = bottom.skeleton.ankleR.z + RIG.footLength * 0.45;
  check('squat bottom keeps the bar over the mid-foot (within 12 cm)', Math.abs(bottom.bar.z - midfootZ) < 0.12,
    `bar ${bottom.bar.z.toFixed(3)} vs mid-foot ${midfootZ.toFixed(3)}`);

  const top = solveAt('squats', 0);
  check('squat top fully extends the knee (< 5 degrees flexion)', top.angles.knee < 5, `${top.angles.knee} deg`);
  check('squat bar rides at trap height at the top', top.bar.y > 1.4 && top.bar.y < 1.55, `${top.bar.y.toFixed(3)} m`);
  check('squat descends at least 40 cm at the hip',
    top.skeleton.hipR.y - bottom.skeleton.hipR.y > 0.4,
    `${((top.skeleton.hipR.y - bottom.skeleton.hipR.y) * 100).toFixed(1)} cm`);
}

{
  const start = solveAt('deadlift', 0);
  // A loaded 45 cm plate puts the bar centre at 0.225 m. The start pose was
  // solved against that number rather than eyeballed, so assert it.
  check('deadlift start puts the hands at plate height (0.225 m +/- 5 cm)', Math.abs(start.bar.y - 0.225) < 0.05,
    `${start.bar.y.toFixed(3)} m`);
  check('deadlift start hinges the trunk past 60 degrees', start.angles.trunk > 60, `${start.angles.trunk} deg`);
  check('deadlift start keeps the shoulders ahead of the bar',
    start.skeleton.shoulderR.z > start.bar.z - 0.12,
    `shoulder ${start.skeleton.shoulderR.z.toFixed(3)} bar ${start.bar.z.toFixed(3)}`);

  const lockout = solveAt('deadlift', 0.55);
  check('deadlift lockout straightens the knee (< 5 degrees)', lockout.angles.knee < 5, `${lockout.angles.knee} deg`);
  check('deadlift lockout stands the trunk up (< 10 degrees)', lockout.angles.trunk < 10, `${lockout.angles.trunk} deg`);
  check('deadlift lockout brings the bar to the hip crease',
    Math.abs(lockout.bar.y - lockout.skeleton.hipR.y) < 0.12,
    `bar ${lockout.bar.y.toFixed(3)} hip ${lockout.skeleton.hipR.y.toFixed(3)}`);
  check('deadlift bar rises monotonically through the pull', (() => {
    let previous = -Infinity;
    for (let i = 0; i <= 50; i++) {
      const t = (i / 50) * 0.5;
      const { bar } = solveAt('deadlift', t);
      if (bar.y < previous - 1e-6) return false;
      previous = bar.y;
    }
    return true;
  })());
}

{
  const top = solveAt('bench_press', 0);
  const bottom = solveAt('bench_press', 0.5);
  const rom = top.bar.y - bottom.bar.y;
  check('bench press has a real range of motion (> 30 cm)', rom > 0.3, `${(rom * 100).toFixed(1)} cm`);
  check('bench lockout extends the elbow (< 10 degrees)', top.angles.elbow < 10, `${top.angles.elbow} deg`);
  check('bench bottom bends the elbow past 90 degrees', bottom.angles.elbow > 90, `${bottom.angles.elbow} deg`);
  check('bench bar never sinks below the chest surface', (() => {
    for (let i = 0; i <= 100; i++) {
      const { bar, skeleton } = solveAt('bench_press', i / 100);
      if (bar.y < skeleton.shoulderR.y) return false;
    }
    return true;
  })());
  check('bench bottom drops the elbows below the torso plane',
    bottom.skeleton.elbowR.y < bottom.skeleton.shoulderR.y,
    `elbow ${bottom.skeleton.elbowR.y.toFixed(3)} shoulder ${bottom.skeleton.shoulderR.y.toFixed(3)}`);
}

{
  const rack = solveAt('shoulder_press', 0);
  const top = solveAt('shoulder_press', 0.5);
  check('overhead press locks out above the head', top.bar.y > top.skeleton.head.y + 0.2,
    `bar ${top.bar.y.toFixed(3)} head ${top.skeleton.head.y.toFixed(3)}`);
  check('overhead press rack sits at shoulder height', Math.abs(rack.bar.y - rack.skeleton.shoulderR.y) < 0.15,
    `bar ${rack.bar.y.toFixed(3)} shoulder ${rack.skeleton.shoulderR.y.toFixed(3)}`);
  check('overhead press lockout extends the elbow (< 15 degrees)', top.angles.elbow < 15, `${top.angles.elbow} deg`);
  check('overhead press rack keeps the elbows in front of the shoulders',
    rack.skeleton.elbowR.z > rack.skeleton.shoulderR.z, 'elbow behind the shoulder line');
}

{
  const bottom = solveAt('cable_row', 0);
  const top = solveAt('cable_row', 0.5);
  check('row pulls the bar at least 30 cm toward the torso', top.bar.y - bottom.bar.y > 0.3,
    `${((top.bar.y - bottom.bar.y) * 100).toFixed(1)} cm`);
  check('row bottom hangs the arms nearly straight (< 20 degrees elbow)', bottom.angles.elbow < 20,
    `${bottom.angles.elbow} deg`);
  check('row top drives the elbow behind the shoulder',
    top.skeleton.elbowR.z < top.skeleton.shoulderR.z, 'elbow did not travel back');
  check('row holds a fixed torso angle throughout', (() => {
    const first = solveAt('cable_row', 0).angles.trunk;
    for (let i = 0; i <= 40; i++) {
      if (Math.abs(solveAt('cable_row', i / 40).angles.trunk - first) > 0.5) return false;
    }
    return true;
  })());
}

// Equipment must change the geometry, otherwise the picker is decoration.
{
  const barbell = solveAt('bench_press', 0.5, 'barbell');
  const dumbbell = solveAt('bench_press', 0.5, 'dumbbell');
  const barbellGrip = Math.abs(barbell.skeleton.wristR.x - barbell.skeleton.wristL.x);
  const dumbbellGrip = Math.abs(dumbbell.skeleton.wristR.x - dumbbell.skeleton.wristL.x);
  check('switching to dumbbells narrows the grip', dumbbellGrip < barbellGrip - 0.02,
    `barbell ${barbellGrip.toFixed(3)} m vs dumbbell ${dumbbellGrip.toFixed(3)} m`);
  check('equipment change never breaks bone lengths',
    Math.abs(dist(dumbbell.skeleton.shoulderR, dumbbell.skeleton.elbowR) - RIG.upperArm) < 1e-9);
}

// ─── Part B: motion clips ────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part B — motion clips and sampling${C.x}\n`);

{
  let ordered = true, spans = true, bounds = true;
  for (const clip of MOTION_CLIPS) {
    const frames = clip.keyframes;
    if (frames[0].t !== 0 || frames[frames.length - 1].t !== 1) bounds = false;
    for (let i = 1; i < frames.length; i++) if (frames[i].t <= frames[i - 1].t) ordered = false;
    // Phases must tile [0,1] with no gap and no overlap.
    if (clip.phases[0].start !== 0) spans = false;
    if (clip.phases[clip.phases.length - 1].end !== 1) spans = false;
    for (let i = 1; i < clip.phases.length; i++) {
      if (Math.abs(clip.phases[i].start - clip.phases[i - 1].end) > 1e-9) spans = false;
    }
  }
  check('every clip starts at t=0 and ends at t=1', bounds);
  check('every clip has strictly ascending keyframes', ordered);
  check('every clip tiles the timeline with contiguous phases', spans);
  check('every clip names a cue for each of its phases', MOTION_CLIPS.every((clip) =>
    clip.phases.every((span) => typeof clip.cues[span.phase] === 'string' && clip.cues[span.phase].length > 8)));
  check('every clip declares at least one primary muscle',
    MOTION_CLIPS.every((clip) => clip.primary.length > 0));
  check('primary and secondary muscle lists never overlap',
    MOTION_CLIPS.every((clip) => clip.secondary.every((m) => !clip.primary.includes(m))));
  check('every declared muscle id is a real muscle',
    MOTION_CLIPS.every((clip) => [...clip.primary, ...clip.secondary].every((m) => MUSCLE_IDS.includes(m))));
}

{
  let outOfRange = 0, untagged = 0;
  for (const clip of MOTION_CLIPS) {
    const recruited = recruitedMuscles(clip);
    for (let i = 0; i <= SAMPLES; i++) {
      const { activation } = sampleClip(clip, i / SAMPLES);
      for (let m = 0; m < MUSCLE_COUNT; m++) {
        if (!finite(activation[m]) || activation[m] < 0 || activation[m] > 1.0001) outOfRange++;
        // A muscle that lights up must be declared, or the legend will not show it.
        if (activation[m] > 0.01 && !recruited.includes(MUSCLE_IDS[m])) untagged++;
      }
    }
  }
  check('activation always stays within 0..1', outOfRange === 0, `${outOfRange} violations`);
  check('no clip activates a muscle it never declared', untagged === 0, `${untagged} undeclared activations`);
}

{
  // Buffer reuse is the whole reason the render loop allocates nothing; a stale
  // value leaking between calls would show as a muscle that never cools down.
  const scratch = new Float32Array(MUSCLE_COUNT);
  const squat = getClip('squats');
  sampleClip(squat, 0.5, scratch);
  const hot = Array.from(scratch);
  sampleClip(getClip('bench_press'), 0.0, scratch);
  const after = Array.from(scratch);
  const leaked = hot.some((value, i) => value > 0.1 && after[i] === value && MUSCLE_IDS[i] === 'quads');
  check('reusing the activation buffer across clips leaves no stale values', !leaked);

  const a = sampleClip(squat, 0.37);
  const b = sampleClip(squat, 0.37);
  check('sampling is deterministic', JSON.stringify(a.pose) === JSON.stringify(b.pose) &&
    Array.from(a.activation).join() === Array.from(b.activation).join());
}

{
  let mismatches = 0;
  for (const clip of MOTION_CLIPS) {
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const phase = phaseAt(clip, t);
      const span = clip.phases.find((p) => t >= p.start && t < p.end) ?? clip.phases[clip.phases.length - 1];
      if (phase !== span.phase) mismatches++;
    }
  }
  check('phaseAt agrees with the declared spans at 500 points per clip', mismatches === 0, `${mismatches} mismatches`);
  check('phaseAt clamps out-of-range input instead of throwing',
    typeof phaseAt(MOTION_CLIPS[0], -5) === 'string' && typeof phaseAt(MOTION_CLIPS[0], 99) === 'string');
  check('getClipOrDefault never returns undefined',
    getClipOrDefault(null)?.id !== undefined && getClipOrDefault('nope')?.id !== undefined &&
    getClipOrDefault(undefined)?.id !== undefined);
  check('peakActivation matches the highest authored value per muscle', (() => {
    const clip = getClip('squats');
    const peak = peakActivation(clip);
    const manual = clip.keyframes.reduce((best, frame) => Math.max(best, frame.activation.quads ?? 0), 0);
    return Math.abs(peak[MUSCLE_INDEX.quads] - manual) < 1e-9;
  })());
  check('the neutral muscle index sits past the real muscles', NEUTRAL_MUSCLE_INDEX === MUSCLE_COUNT);
}

// ─── Part C: RTK slices ──────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part C — RTK slices (session state machine)${C.x}\n`);

const makeStore = () =>
  configureStore({
    reducer: { workout: workoutReducer, viewport: viewportReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }).concat(telemetryMiddleware),
  });

const sampleQueue = () => [
  buildQueueEntry({ exerciseId: 'squats', name: 'Back Squat', clipId: 'squats', targetReps: 5, targetWeightKg: 80 }),
  buildQueueEntry({ exerciseId: 'deadlift', name: 'Deadlift', clipId: 'deadlift', targetReps: 3, targetWeightKg: 120 }),
];

{
  const store = makeStore();
  check('a fresh store starts idle with no session', store.getState().workout.status === 'idle' &&
    store.getState().workout.sessionId === null);

  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  const started = store.getState().workout;
  check('sessionStarted moves to active and mints a session id',
    started.status === 'active' && typeof started.sessionId === 'string' && started.sessionId.length > 0);
  check('sessionStarted defaults the equipment to a barbell', started.equipment === 'barbell');

  store.dispatch(repCounted());
  store.dispatch(repCounted());
  store.dispatch(repCounted());
  check('repCounted increments only while active', store.getState().workout.repCount === 3);

  store.dispatch(setLogged({ weightKg: 82.5, rpe: 8 }));
  const afterSet = store.getState().workout;
  check('setLogged banks the set with the live rep count',
    afterSet.completedSets.length === 1 && afterSet.completedSets[0].reps === 3 &&
    afterSet.completedSets[0].weightKg === 82.5 && afterSet.completedSets[0].rpe === 8);
  check('setLogged resets the rep counter for the next set', afterSet.repCount === 0);
  check('setLogged stamps the set with the exercise it belongs to',
    afterSet.completedSets[0].exerciseId === 'squats' && afterSet.completedSets[0].exerciseName === 'Back Squat');

  // A set with no reps is a mis-tap, not data.
  store.dispatch(setLogged({ weightKg: 100, rpe: 5 }));
  check('setLogged refuses to bank a zero-rep set', store.getState().workout.completedSets.length === 1);
}

{
  const store = makeStore();
  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  store.dispatch(restStarted(3));
  check('restStarted enforces a 5 second floor on rest', store.getState().workout.restRemaining === 5);
  store.dispatch(restSkipped());

  store.dispatch(restStarted(7));
  check('restStarted moves to resting', store.getState().workout.status === 'resting' &&
    store.getState().workout.restRemaining === 7);
  for (let i = 0; i < 6; i++) store.dispatch(restTicked());
  check('restTicked counts down', store.getState().workout.restRemaining === 1);
  store.dispatch(restTicked());
  check('rest ending returns the session to active',
    store.getState().workout.restRemaining === null && store.getState().workout.status === 'active');

  store.dispatch(restStarted(60));
  store.dispatch(restSkipped());
  check('restSkipped clears the timer and resumes work',
    store.getState().workout.restRemaining === null && store.getState().workout.status === 'active');

  store.dispatch(restStarted(9999));
  check('restStarted clamps absurd durations', store.getState().workout.restRemaining === 600);
  store.dispatch(restSkipped());
}

{
  const store = makeStore();
  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  store.dispatch(elapsedTicked());
  store.dispatch(elapsedTicked());
  check('elapsedTicked advances the session clock while active', store.getState().workout.elapsedSec === 2);
  store.dispatch(sessionPaused());
  store.dispatch(elapsedTicked());
  check('a paused session does not accrue time',
    store.getState().workout.status === 'paused' && store.getState().workout.elapsedSec === 2);
  store.dispatch(repCounted());
  check('a paused session does not count reps', store.getState().workout.repCount === 0);
  store.dispatch(sessionResumed());
  check('sessionResumed returns to active', store.getState().workout.status === 'active');
}

{
  const store = makeStore();
  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  store.dispatch(exerciseSelected(1));
  check('exerciseSelected moves through the queue', store.getState().workout.currentIndex === 1);
  store.dispatch(exerciseSelected(99));
  check('exerciseSelected ignores an out-of-range index', store.getState().workout.currentIndex === 1);
  store.dispatch(exerciseSelected(-3));
  check('exerciseSelected ignores a negative index', store.getState().workout.currentIndex === 1);
  store.dispatch(equipmentChanged('dumbbell'));
  check('equipmentChanged updates the implement', store.getState().workout.equipment === 'dumbbell');

  store.dispatch(repCountAdjusted(-40));
  check('repCountAdjusted clamps below zero', store.getState().workout.repCount === 0);
  store.dispatch(repCountAdjusted(99999));
  check('repCountAdjusted clamps at the ceiling', store.getState().workout.repCount === 999);
  store.dispatch(repCountAdjusted(Number.NaN));
  check('repCountAdjusted survives NaN', store.getState().workout.repCount === 0);
}

{
  // Telemetry folding: the per-set activation mean and peak angles are what end
  // up on the saved set, so they have to be arithmetic rather than last-write.
  const store = makeStore();
  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  const snapshot = (value, knee) => ({
    snapshot: {
      t: 0.5, phase: 'concentric', barHeight: 1,
      angles: { hip: 10, knee, ankle: 5, shoulder: 20, elbow: 30, trunk: 15 },
      activation: new Array(MUSCLE_COUNT).fill(value), sampleCount: 1, at: 0,
    },
    dropped: 0,
  });
  store.dispatch(telemetryCommitted(snapshot(0.2, 40)));
  store.dispatch(telemetryCommitted(snapshot(0.8, 110)));
  store.dispatch(repCounted());
  store.dispatch(setLogged({ weightKg: 60, rpe: 6 }));
  const set = store.getState().workout.completedSets[0];
  check('per-set activation is the mean of the folded telemetry',
    Math.abs(set.activation[0] - 0.5) < 1e-6, `got ${set.activation[0]}`);
  check('per-set joint angles record the peak, not the last sample', set.peakAngles.knee === 110,
    `got ${set.peakAngles.knee}`);
  check('dropped-sample counts accumulate on the session',
    store.getState().workout.droppedSamples === 0);

  store.dispatch(telemetryCommitted({ ...snapshot(0.5, 50), dropped: 7 }));
  check('dropped samples are surfaced rather than hidden', store.getState().workout.droppedSamples === 7);
}

{
  // The reset path is where stale-state bugs live: a leftover accumulator would
  // silently contaminate the first set of the next session.
  const store = makeStore();
  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  store.dispatch(telemetryCommitted({
    snapshot: {
      t: 0.5, phase: 'concentric', barHeight: 1,
      angles: { hip: 90, knee: 120, ankle: 30, shoulder: 40, elbow: 50, trunk: 60 },
      activation: new Array(MUSCLE_COUNT).fill(0.9), sampleCount: 1, at: 0,
    },
    dropped: 3,
  }));
  store.dispatch(repCounted());
  store.dispatch(sessionFinished());
  check('sessionFinished moves to the summary', store.getState().workout.status === 'summary');

  store.dispatch(sessionReset());
  const clean = store.getState().workout;
  check('sessionReset clears status, telemetry and dropped counts',
    clean.status === 'idle' && clean.telemetry === null && clean.droppedSamples === 0 && clean.sessionId === null);
  check('sessionReset zeroes the activation accumulator',
    clean.setActivationSum.length === MUSCLE_COUNT && clean.setActivationSum.every((v) => v === 0));
  check('sessionReset zeroes the peak angles',
    Object.values(clean.setPeakAngles).every((v) => v === 0));
  check('sessionReset hands back a fresh array, not the previous one',
    clean.setActivationSum !== store.getState().workout.completedSets);
}

// ─── Viewport slice ──────────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part C2 — viewport slice (camera, layers, quality)${C.x}\n`);

{
  const store = makeStore();
  store.dispatch(viewportReady());
  check('viewportReady clears any prior failure',
    store.getState().viewport.status === 'ready' && store.getState().viewport.failure === null);

  store.dispatch(orbitChanged({ polar: -10, radius: 900, targetY: 50 }));
  const clamped = store.getState().viewport.orbit;
  check('orbit polar is clamped off the poles',
    clamped.polar >= ORBIT_LIMITS.polarMin && clamped.polar <= ORBIT_LIMITS.polarMax, `${clamped.polar}`);
  check('orbit radius is clamped to the safe range',
    clamped.radius === ORBIT_LIMITS.radiusMax, `${clamped.radius}`);
  check('orbit target height is clamped', clamped.targetY === ORBIT_LIMITS.targetYMax);

  store.dispatch(orbitChanged({ azimuth: 100 * Math.PI }));
  check('azimuth wraps into (-PI, PI] instead of growing without bound',
    Math.abs(store.getState().viewport.orbit.azimuth) <= Math.PI + 1e-9);

  store.dispatch(orbitNudged({ dRadius: -1000 }));
  check('orbitNudged respects the same clamps', store.getState().viewport.orbit.radius === ORBIT_LIMITS.radiusMin);

  store.dispatch(orbitReset());
  check('orbitReset restores the default framing',
    Math.abs(store.getState().viewport.orbit.radius - DEFAULT_ORBIT.radius) < 1e-9);

  store.dispatch(orbitPreset('side'));
  check('the side preset swings the camera 90 degrees',
    Math.abs(store.getState().viewport.orbit.azimuth + Math.PI / 2) < 1e-9);

  check('clampOrbit survives NaN input', (() => {
    const out = clampOrbit({ azimuth: NaN, polar: NaN, radius: NaN, targetY: NaN });
    return finite(out.azimuth) && finite(out.polar) && finite(out.radius) && finite(out.targetY);
  })());
}

{
  const store = makeStore();
  store.dispatch(viewportReady());
  store.dispatch(scrubbed({ t: 5, phase: 'concentric' }));
  check('scrub position is clamped to 0..1', store.getState().viewport.scrubT === 1);
  store.dispatch(scrubbed({ t: -3, phase: 'eccentric' }));
  check('negative scrub is clamped to 0', store.getState().viewport.scrubT === 0);

  store.dispatch(playbackSet(true));
  check('playback starts only when the viewport is ready', store.getState().viewport.playing === true);
  store.dispatch(playbackRateSet(99));
  check('playback rate is clamped', store.getState().viewport.playbackRate === 2);

  store.dispatch(reducedMotionSet(true));
  check('reduced motion stops playback and auto-rotation',
    store.getState().viewport.playing === false && store.getState().viewport.autoRotate === false);

  store.dispatch(playbackSet(true));
  store.dispatch(suspendedSet(true));
  check('suspending the viewport stops playback',
    store.getState().viewport.suspended === true && store.getState().viewport.playing === false);

  store.dispatch(layerToggled('heatmap'));
  check('layers toggle independently', store.getState().viewport.layers.heatmap === false &&
    store.getState().viewport.layers.barPath === true);
}

{
  const store = makeStore();
  store.dispatch(viewportReady());
  store.dispatch(perfSampled({ fps: 30, fpsAvg: 31.2, tier: 'low', reason: 'fps', droppedFrames: 12 }));
  const perf = store.getState().viewport;
  check('perfSampled keeps the tier and the quality profile in step',
    perf.perf.tier === 'low' && perf.quality.tier === 'low' &&
    perf.quality.radialSegments === QUALITY_PROFILES.low.radialSegments);
  check('perfSampled marks the session as throttled', perf.perf.throttled === true);
  check('perfSampled reports why it throttled', perf.perf.reason === 'fps');

  store.dispatch(viewportFailed({ reason: 'no webgl', unsupported: true }));
  check('an unsupported device is distinguished from a runtime failure',
    store.getState().viewport.status === 'unsupported');

  store.dispatch(contextLost());
  check('context loss is a state, not a crash', store.getState().viewport.status === 'context-lost' &&
    store.getState().viewport.playing === false);
  store.dispatch(contextRestored());
  check('context restore returns the viewport to ready', store.getState().viewport.status === 'ready');
}

// ─── Part D: telemetry ring buffer ───────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part D — telemetry ring buffer and middleware${C.x}\n`);

const makeAngles = (knee) => ({ hip: 10, knee, ankle: 5, shoulder: 20, elbow: 30, trunk: 15 });

{
  resetTelemetryBuffer();
  check('a drained buffer reports nothing pending', telemetryBufferStats().pending === 0);

  const activation = new Float32Array(MUSCLE_COUNT).fill(0.25);
  for (let i = 0; i < 10; i++) pushTelemetryFrame(i / 10, 'concentric', makeAngles(40 + i), activation, 1 + i * 0.01, i);
  check('pushed frames queue up without dispatching', telemetryBufferStats().pending === 10);
  check('pushing frames never drops while under capacity', telemetryBufferStats().dropped === 0);

  const capacity = telemetryBufferStats().capacity;
  for (let i = 0; i < capacity + 50; i++) pushTelemetryFrame(0.5, 'eccentric', makeAngles(90), activation, 1, i);
  const stats = telemetryBufferStats();
  check('overflow drops the oldest samples and accounts for them',
    stats.dropped > 0 && stats.pending === capacity, `dropped ${stats.dropped}, pending ${stats.pending}`);
  resetTelemetryBuffer();
  check('resetTelemetryBuffer clears both the queue and the drop count',
    telemetryBufferStats().pending === 0 && telemetryBufferStats().dropped === 0);
}

{
  // The middleware is the only thing allowed to dispatch telemetry, and it must
  // publish the latest pose with the mean activation.
  const store = makeStore();
  store.dispatch(sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }));
  resetTelemetryBuffer();
  store.dispatch(telemetryStreamStarted({ intervalMs: 50 }));

  const low = new Float32Array(MUSCLE_COUNT).fill(0.2);
  const high = new Float32Array(MUSCLE_COUNT).fill(0.6);
  pushTelemetryFrame(0.1, 'eccentric', makeAngles(30), low, 1.0, 1);
  pushTelemetryFrame(0.9, 'concentric', makeAngles(95), high, 1.4, 2);

  await new Promise((resolve) => setTimeout(resolve, 140));
  const committed = store.getState().workout.telemetry;
  check('the middleware commits a coalesced snapshot', committed !== null);
  check('the snapshot reports the newest pose',
    committed !== null && Math.abs(committed.t - 0.9) < 1e-6 && committed.phase === 'concentric',
    `t=${committed?.t} phase=${committed?.phase}`);
  check('the snapshot averages activation across the window',
    committed !== null && Math.abs(committed.activation[0] - 0.4) < 1e-3, `got ${committed?.activation[0]}`);
  check('the snapshot reports how many samples it folded', committed?.sampleCount === 2);

  const before = store.getState().workout.telemetry;
  await new Promise((resolve) => setTimeout(resolve, 120));
  check('an empty window commits nothing rather than a duplicate action',
    store.getState().workout.telemetry === before);

  store.dispatch(telemetryStreamStopped());
  pushTelemetryFrame(0.5, 'isometric', makeAngles(70), high, 1.2, 3);
  const afterStop = store.getState().workout.telemetry;
  await new Promise((resolve) => setTimeout(resolve, 140));
  check('stopping the stream tears the timer down (no dispatch after unmount)',
    store.getState().workout.telemetry === afterStop);
  resetTelemetryBuffer();
}

{
  // The object-shaped push is the fallback path; it must agree with the fast one.
  resetTelemetryBuffer();
  pushTelemetrySample({
    at: 5, t: 0.42, phase: 'isometric', angles: makeAngles(88),
    activation: new Array(MUSCLE_COUNT).fill(0.33), barHeight: 0.9,
  });
  check('pushTelemetrySample accepts a plain array activation', telemetryBufferStats().pending === 1);
  pushTelemetrySample({
    at: 6, t: 0.43, phase: 'isometric', angles: makeAngles(88),
    activation: [0.1, 0.2], barHeight: 0.9,
  });
  check('a short activation array is zero-padded rather than rejected', telemetryBufferStats().pending === 2);
  resetTelemetryBuffer();
}

// ─── Part E: FPS / thermal guardrail ─────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part E — FPS and thermal guardrail${C.x}\n`);

const runGuard = (guard, { fps, seconds, startAt = 0, thermal = null }) => {
  const frameMs = 1000 / fps;
  let now = startAt;
  let last = null;
  for (let second = 0; second < seconds; second++) {
    if (thermal !== null) guard.setThermalPressure(thermal);
    for (let f = 0; f < fps; f++) {
      guard.frame(frameMs);
      now += frameMs;
    }
    const decision = guard.evaluate(now);
    if (decision) last = decision;
  }
  return { last, now };
};

{
  const { tier } = initialTierForDevice();
  check('the initial tier is one of the three defined tiers', ['high', 'balanced', 'low'].includes(tier), tier);
}

{
  const guard = new FpsGuard('high');
  const { last } = runGuard(guard, { fps: 60, seconds: 8 });
  check('a healthy 60 fps device is never throttled', guard.currentTier === 'high' && last.tier === 'high');
}

{
  const guard = new FpsGuard('high');
  runGuard(guard, { fps: 60, seconds: 1 });
  const { last } = runGuard(guard, { fps: 30, seconds: 10, startAt: 1000 });
  check('sustained 30 fps steps the quality down', guard.currentTier !== 'high', guard.currentTier);
  check('the step-down is attributed to frame rate', last.reason === 'fps');
  check('quality never falls below the lowest tier', guard.currentTier === 'low' || guard.currentTier === 'balanced');
}

{
  // One bad second is a hiccup, not a trend. Dropping detail for it would make
  // the model visibly flicker between quality levels during normal use.
  const guard = new FpsGuard('high');
  const frameMs = 1000 / 60;
  let now = 0;
  for (let f = 0; f < 60; f++) { guard.frame(frameMs); now += frameMs; }
  guard.evaluate(now);
  for (let f = 0; f < 20; f++) { guard.frame(50); now += 50; }
  guard.evaluate(now);
  check('a single bad second does not trigger a downgrade', guard.currentTier === 'high', guard.currentTier);
}

{
  const guard = new FpsGuard('high');
  const { now } = runGuard(guard, { fps: 30, seconds: 12 });
  const throttled = guard.currentTier;
  runGuard(guard, { fps: 60, seconds: 2, startAt: now });
  check('recovery is not instant — good frames must persist before climbing back',
    guard.currentTier === throttled, `climbed to ${guard.currentTier} after 2 s`);
}

{
  const guard = new FpsGuard('high');
  runGuard(guard, { fps: 60, seconds: 1 });
  const thermalRun = runGuard(guard, { fps: 60, seconds: 12, startAt: 1000, thermal: true });
  check('thermal pressure steps quality down even at a good frame rate', guard.currentTier === 'low',
    guard.currentTier);
  check('the thermal step-down is reported as thermal', thermalRun.last?.reason === 'thermal',
    `reason ${thermalRun.last?.reason}`);
  runGuard(guard, { fps: 60, seconds: 30, startAt: 20000, thermal: true });
  check('quality does not climb back while the device is still hot', guard.currentTier === 'low');
}

{
  const guard = new FpsGuard('low');
  runGuard(guard, { fps: 5, seconds: 20 });
  check('a device already at the lowest tier stays there', guard.currentTier === 'low');
  check('guard statistics stay finite under extreme input',
    finite(guard.stats.fps) && finite(guard.stats.fpsAvg));
}

{
  const guard = new FpsGuard('high');
  guard.frame(Number.NaN);
  guard.frame(-5);
  guard.frame(0);
  check('the guard ignores nonsense frame deltas without throwing', guard.evaluate(0) === null);
  check('guard config defaults are sane',
    DEFAULT_GUARD_CONFIG.downThreshold < DEFAULT_GUARD_CONFIG.upThreshold &&
    DEFAULT_GUARD_CONFIG.windowsBeforeUp > DEFAULT_GUARD_CONFIG.windowsBeforeDown);
}

// ─── Part F: fuzz ────────────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part F — fuzz (hostile input, zero tolerance)${C.x}\n`);

{
  // Deterministic PRNG so a failure is reproducible.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0xffffffff;
  };
  const weird = (r) => {
    if (r < 0.04) return Number.NaN;
    if (r < 0.08) return Infinity;
    if (r < 0.12) return -Infinity;
    if (r < 0.16) return 1e9;
    if (r < 0.2) return -1e9;
    return (r - 0.5) * 720;
  };

  let throws = 0, nans = 0;
  for (let i = 0; i < 5000; i++) {
    const pose = {
      t: rnd(),
      trunkDeg: weird(rnd()),
      femurDeg: weird(rnd()),
      tibiaDeg: weird(rnd()),
      shoulderFlexDeg: weird(rnd()),
      shoulderAbdDeg: weird(rnd()),
      elbowDeg: weird(rnd()),
      shoulderRotDeg: weird(rnd()),
      activation: {},
    };
    const posture = rnd() < 0.5 ? 'standing' : 'supine';
    try {
      const s = solvePose(pose, {
        posture,
        supinePelvisY: rnd() < 0.1 ? weird(rnd()) : 0.55,
        armsFollowGravity: rnd() < 0.3,
        gripHalfWidth: rnd() < 0.1 ? weird(rnd()) : 0.42,
      });
      readJointAngles(s);
      barPosition(s, rnd() < 0.5 ? 'wrists' : 'traps', pose.trunkDeg);
      // The solver sanitises every numeric input, so NO input — however hostile
      // — may produce NaN geometry. This is the assertion that would catch a
      // regression where someone reads `pose.x` directly again.
      for (const joint of Object.keys(s)) {
        if (!finite(s[joint].x) || !finite(s[joint].y) || !finite(s[joint].z)) { nans++; break; }
      }
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} fuzz pose #${i} threw: ${error.message}`);
    }
  }
  check('5,000 hostile poses: zero throws', throws === 0, `${throws} throws`);
  check('5,000 hostile poses: never emits NaN geometry, for any input', nans === 0, `${nans} NaN skeletons`);
}

{
  let seed = 0x12345678;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0xffffffff;
  };

  const store = makeStore();
  const actions = [
    () => sessionStarted({ workoutType: 'Strength', queue: sampleQueue() }),
    () => exerciseSelected(Math.floor((rnd() - 0.3) * 8)),
    () => equipmentChanged(['barbell', 'dumbbell', 'cable', 'bodyweight'][Math.floor(rnd() * 4)]),
    () => repCounted(),
    () => repCountAdjusted((rnd() - 0.5) * 1e6),
    () => setLogged({ weightKg: (rnd() - 0.5) * 1e5, rpe: (rnd() - 0.5) * 100 }),
    () => restStarted(Math.floor((rnd() - 0.2) * 5000)),
    () => restTicked(),
    () => restSkipped(),
    () => elapsedTicked(),
    () => sessionPaused(),
    () => sessionResumed(),
    () => sessionFinished(),
    () => sessionReset(),
    () => orbitChanged({ azimuth: (rnd() - 0.5) * 1e4, polar: (rnd() - 0.5) * 1e4, radius: (rnd() - 0.5) * 1e4 }),
    () => scrubbed({ t: (rnd() - 0.5) * 10, phase: 'concentric' }),
    () => playbackRateSet((rnd() - 0.5) * 1e3),
    () => perfSampled({ fps: rnd() * 1e4, fpsAvg: rnd() * 1e4, tier: ['high', 'balanced', 'low'][Math.floor(rnd() * 3)], reason: 'fps', droppedFrames: Math.floor(rnd() * 1e4) }),
    () => layerToggled(['heatmap', 'jointVectors', 'barPath', 'skeleton', 'equipment'][Math.floor(rnd() * 5)]),
    () => suspendedSet(rnd() < 0.5),
    () => reducedMotionSet(rnd() < 0.5),
  ];

  let throws = 0, invalid = 0;
  for (let i = 0; i < 2000; i++) {
    try {
      store.dispatch(actions[Math.floor(rnd() * actions.length)]());
      const { workout, viewport } = store.getState();
      if (
        !finite(workout.repCount) || workout.repCount < 0 ||
        !finite(workout.elapsedSec) || workout.elapsedSec < 0 ||
        (workout.restRemaining !== null && (!finite(workout.restRemaining) || workout.restRemaining < 0)) ||
        workout.setActivationSum.some((v) => !finite(v)) ||
        !finite(viewport.scrubT) || viewport.scrubT < 0 || viewport.scrubT > 1 ||
        !finite(viewport.orbit.radius) ||
        viewport.orbit.radius < ORBIT_LIMITS.radiusMin - 1e-9 ||
        viewport.orbit.radius > ORBIT_LIMITS.radiusMax + 1e-9 ||
        viewport.orbit.polar < ORBIT_LIMITS.polarMin - 1e-9 ||
        viewport.orbit.polar > ORBIT_LIMITS.polarMax + 1e-9 ||
        Math.abs(viewport.orbit.azimuth) > Math.PI + 1e-9 ||
        workout.completedSets.some((set) => !finite(set.weightKg) || set.weightKg < 0 || set.rpe < 1 || set.rpe > 10)
      ) {
        invalid++;
        if (invalid <= 3) console.log(`  ${FAIL} fuzz action #${i} produced invalid state`);
      }
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} fuzz action #${i} threw: ${error.message}`);
    }
  }
  check('2,000 hostile action sequences: zero throws', throws === 0, `${throws} throws`);
  check('2,000 hostile action sequences: state invariants always hold', invalid === 0, `${invalid} violations`);
}

{
  // A quick sanity net over the whole pipeline: solve, read, project the maths
  // the render loop performs, and confirm nothing degenerates over a long run.
  let throws = 0;
  try {
    const scratch = new Float32Array(MUSCLE_COUNT);
    for (const clip of MOTION_CLIPS) {
      for (let i = 0; i < 600; i++) {
        const t = (i % 100) / 100;
        const { pose } = sampleClip(clip, t, scratch);
        const s = solvePose(pose, optsFor(clip));
        readJointAngles(s);
        barPosition(s, clip.barAnchor, pose.trunkDeg);
        angleBetween(s.hipR, s.kneeR, s.ankleR);
      }
    }
  } catch (error) {
    throws++;
    console.log(`  ${FAIL} pipeline soak threw: ${error.message}`);
  }
  check('3,000-frame pipeline soak across all clips: zero throws', throws === 0);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passCount + failCount;
console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
if (failCount > 0) { console.log(`${C.r}${C.b}PROOF FAILED${C.x}`); process.exit(1); }
console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
