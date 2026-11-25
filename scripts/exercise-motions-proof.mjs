// Exercise-motion proof harness.
//
//   npm run proof:motions
//
// Every exercise in src/data/exerciseLibrary.json must open a 3D demo that
// moves like the real exercise. This proves, deterministically and without a
// GPU:
//   Part A — COVERAGE: every library id is mapped explicitly, no unknown ids,
//            every spec names a real family, every clip builds.
//   Part B — PLAUSIBILITY on the sampled, interpolated motion (241 samples per
//            clip): finite joints, bone lengths invariant, every authored pose
//            inside the ROM limits, knees never bend backwards, nothing
//            through the floor, no hand/elbow through the torso, loop
//            continuity, planted feet/hands do not slide.
//   Part C — BIOMECHANICS per family (squat depth, push-up body line, hinge
//            ratio, curl isolation, jumping-jack abduction, plank stillness…).
//   Part D — CONTROLS: deliberately broken motions that every check above
//            must reject, so a passing check is known to be able to fail.
//
// Firebase-free and three.js-free.

import { readFileSync } from 'node:fs';

const { RIG, solvePose, romViolations, clampPoseToRom, signedKneeFlex, angleBetween } = await import('../src/biomechanics/rig.ts');
const motions = await import('../src/biomechanics/motions.ts');
const { getExerciseClip, sampleClip, solveOptionsFor, EXERCISE_TO_CLIP, hasClipFor, getClip } = motions;
const { EXERCISE_MOTIONS } = await import('../src/biomechanics/exerciseMotions.ts');
const { MOTION_FAMILIES, buildFamilyClip } = await import('../src/biomechanics/families.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.g}PASS${C.x} ${name}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`); }
};
const quiet = process.argv.includes('--quiet');
const section = (t) => console.log(`\n${C.b}${C.c}${t}${C.x}\n`);

const library = JSON.parse(readFileSync(new URL('../src/data/exerciseLibrary.json', import.meta.url), 'utf8'));
const libIds = library.map((e) => e.id);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const deg = (r) => (r * 180) / Math.PI;
const dirAngle = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))));
const segDist = (p, a, b) => {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t });
};

const N = 240;
/** Sample a clip into skeletons + raw poses. */
const sampleAll = (clip, n = N, extra = {}) => {
  const opts = { ...solveOptionsFor(clip, clip.equipment[0]), ...extra };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const { pose } = sampleClip(clip, t);
    out.push({ t, pose, s: solvePose(pose, opts), opts });
  }
  return out;
};

// ─── Part A ──────────────────────────────────────────────────────────────────
section('Part A — coverage of the exercise library');

/** Pure mapping validator so the control can run it on a doctored library. */
const mappingProblems = (ids, table) => {
  const problems = [];
  for (const id of ids) if (!Object.prototype.hasOwnProperty.call(table, id)) problems.push(`unmapped: ${id}`);
  for (const id of Object.keys(table)) if (!ids.includes(id)) problems.push(`unknown id: ${id}`);
  for (const [id, spec] of Object.entries(table)) {
    if (!MOTION_FAMILIES.includes(spec.family)) problems.push(`bad family ${spec.family} for ${id}`);
    if (!Array.isArray(spec.equipment) || spec.equipment.length === 0) problems.push(`no equipment for ${id}`);
  }
  return problems;
};

const problems = mappingProblems(libIds, EXERCISE_MOTIONS);
check(`all ${libIds.length} library exercises mapped explicitly, no unknown ids`, problems.length === 0, problems.slice(0, 6).join('; '));
check('library ids are unique', new Set(libIds).size === libIds.length);
const clips = new Map();
const buildErrors = [];
for (const id of libIds) {
  try {
    const clip = getExerciseClip(id);
    if (!clip) buildErrors.push(`${id}: no clip`);
    else clips.set(id, clip);
  } catch (e) {
    buildErrors.push(`${id}: ${e.message}`);
  }
}
check(`every mapped exercise builds a clip (${clips.size}/${libIds.length})`, buildErrors.length === 0, buildErrors.slice(0, 5).join('; '));
check('every library id resolves through EXERCISE_TO_CLIP / hasClipFor / getClip',
  libIds.every((id) => hasClipFor(id) && getClip(EXERCISE_TO_CLIP[id])?.id === `lib:${id}`));
check('an unmapped id has no clip (no silent default)', !hasClipFor('definitely_not_an_exercise') && getExerciseClip('definitely_not_an_exercise') === undefined);
const famCount = new Set(Object.values(EXERCISE_MOTIONS).map((s) => s.family)).size;
const simplified = libIds.filter((id) => EXERCISE_MOTIONS[id]?.simplified);
check(`families in use: ${famCount} of ${MOTION_FAMILIES.length}`, famCount === MOTION_FAMILIES.length);
check(`simplified demos are flagged with a note (${simplified.length})`, simplified.every((id) => clips.get(id)?.simplified && clips.get(id)?.simplifiedNote));
check('every clip has phases covering 0..1 and a cue per phase', [...clips.values()].every((c) =>
  c.phases[0].start === 0 && c.phases[c.phases.length - 1].end === 1 && c.phases.every((p) => typeof c.cues[p.phase] === 'string' && c.cues[p.phase].length > 5)));
check('every clip declares primary muscles and keyframes ascend', [...clips.values()].every((c) =>
  c.primary.length > 0 && c.keyframes.every((k, i) => i === 0 || k.t >= c.keyframes[i - 1].t)));

// ─── Part B ──────────────────────────────────────────────────────────────────
section('Part B — plausibility of every clip over a full cycle');

const BONES = [
  ['hipR', 'kneeR', RIG.thigh], ['kneeR', 'ankleR', RIG.shank], ['hipL', 'kneeL', RIG.thigh], ['kneeL', 'ankleL', RIG.shank],
  ['pelvis', 'chest', RIG.torso], ['shoulderR', 'elbowR', RIG.upperArm], ['elbowR', 'wristR', RIG.forearm],
  ['shoulderL', 'elbowL', RIG.upperArm], ['elbowL', 'wristL', RIG.forearm],
];

/** Every plausibility rule for one clip. Returns a list of failures (empty = pass). */
const plausibility = (clip, extra = {}) => {
  const errs = [];
  const samples = sampleAll(clip, N, extra);
  const add = (m) => { if (errs.length < 4) errs.push(m); };
  for (const { t, pose, s } of samples) {
    for (const [k, v] of Object.entries(s)) {
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) { add(`NaN ${k}@${t.toFixed(2)}`); break; }
    }
    for (const [a, b, L] of BONES) if (Math.abs(dist(s[a], s[b]) - L) > 1e-6) add(`bone ${a}-${b}@${t.toFixed(2)}`);
    const rom = romViolations(pose, 0.75);
    if (rom.length) add(`ROM@${t.toFixed(2)} ${rom[0]}`);
    for (const side of ['L', 'R']) {
      const k = signedKneeFlex(s, side);
      if (k < -6) add(`knee${side} bends backwards ${k.toFixed(1)}@${t.toFixed(2)}`);
    }
    // Nothing below the floor (joint centres; a contact surface sits at >= 0).
    for (const [k, v] of Object.entries(s)) if (v.y < -0.015) { add(`${k} through floor y=${v.y.toFixed(3)}@${t.toFixed(2)}`); break; }
    // Elbows / wrists never pass through the torso core.
    for (const j of ['elbowL', 'elbowR', 'wristL', 'wristR']) {
      const d = segDist(s[j], s.pelvis, s.chest);
      if (d < 0.07) add(`${j} inside torso (${d.toFixed(3)} m)@${t.toFixed(2)}`);
    }
    // Knees never through the torso either.
    for (const j of ['kneeL', 'kneeR']) {
      const d = segDist(s[j], { x: s.pelvis.x, y: s.pelvis.y, z: s.pelvis.z }, s.chest);
      const fromPelvis = dist(s[j], s.pelvis);
      if (d < 0.08 && fromPelvis > 0.25) add(`${j} inside torso@${t.toFixed(2)}`);
    }
  }
  // Loop continuity: the solved pose at t=0 and t=1 coincide.
  const first = samples[0].s;
  const last = samples[samples.length - 1].s;
  let gap = 0;
  for (const k of Object.keys(first)) gap = Math.max(gap, dist(first[k], last[k]));
  if (gap > 1e-6) add(`loop gap ${gap.toFixed(4)} m`);
  // Smoothness: no teleports between adjacent samples (1/240 of a rep).
  let jumpMax = 0;
  for (let i = 1; i < samples.length; i++) {
    for (const k of Object.keys(first)) jumpMax = Math.max(jumpMax, dist(samples[i].s[k], samples[i - 1].s[k]));
  }
  if (jumpMax > 0.12) add(`discontinuity ${jumpMax.toFixed(3)} m between samples`);
  // Planted contacts must not slide: a foot (toe) or hand that stays on the
  // floor for a run of samples must not move horizontally during that run.
  const contactRuns = (getP, getY, limit, label) => {
    let runStart = -1;
    for (let i = 0; i <= samples.length; i++) {
      const on = i < samples.length && getY(samples[i].s) < 0.006 && !(samples[i].pose.liftY > 0.005);
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        if (i - runStart >= 12) {
          const a = getP(samples[runStart].s);
          let worst = 0;
          for (let j = runStart; j < i; j++) { const p = getP(samples[j].s); worst = Math.max(worst, Math.hypot(p.x - a.x, p.z - a.z)); }
          if (worst > limit) add(`${label} slides ${(worst * 100).toFixed(1)} cm while planted`);
        }
        runStart = -1;
      }
    }
  };
  const toeY = (side) => (s) => s[`toe${side}`].y - RIG.ankleHeight * 0.6;
  const handY = (side) => (s) => Math.min(s[`hand${side}`].y - 0.025, s[`wrist${side}`].y - 0.035);
  const treadmill = clip.solve?.anchor === 'pelvis' && clip.family === 'cardio';
  if (!treadmill) {
    contactRuns((s) => s.toeL, toeY('L'), 0.03, 'left foot');
    contactRuns((s) => s.toeR, toeY('R'), 0.03, 'right foot');
  }
  // Hands that legitimately travel while loaded: the ab wheel rolls, the sun
  // salutation flows between hand positions.
  if (!['lib:sun_salutation', 'lib:ab_wheel'].includes(clip.id)) {
    contactRuns((s) => s.wristL, handY('L'), 0.04, 'left hand');
    contactRuns((s) => s.wristR, handY('R'), 0.04, 'right hand');
  }
  return { errs, samples };
};

const SAMPLED = new Map();
const plausFailures = [];
for (const [id, clip] of clips) {
  const { errs, samples } = plausibility(clip);
  SAMPLED.set(id, samples);
  if (errs.length) plausFailures.push(`${id}: ${errs.join(' | ')}`);
  else if (!quiet) console.log(`  ${C.d}ok ${id}${C.x}`);
}
for (const f of plausFailures) console.log(`  ${C.r}x${C.x} ${f}`);
check(`every clip finite, bone-true, in ROM, no backward knees, above floor, no limbs through torso, loops, no sliding (${clips.size - plausFailures.length}/${clips.size})`, plausFailures.length === 0);
check('ROM clamp is total: hostile poses come back finite and in range', (() => {
  for (let i = 0; i < 500; i++) {
    const r = () => (Math.random() - 0.5) * 2000;
    const p = clampPoseToRom({ t: 0, trunkDeg: r(), femurDeg: r(), tibiaDeg: r(), shoulderFlexDeg: r(), shoulderAbdDeg: r(), elbowDeg: r(), femurDegL: NaN, legYawDegR: r(), footPitchDegL: r(), trunkTwistDeg: r(), activation: {} });
    if (romViolations(p, 0.01).length) return false;
  }
  return true;
})());

// ─── Part C ──────────────────────────────────────────────────────────────────
section('Part C — per-family biomechanics');

const S = (id) => SAMPLED.get(id) ?? sampleAll(clips.get(id));
const range = (arr) => Math.max(...arr) - Math.min(...arr);
const elbowFlex = (s, side) => 180 - angleBetween(s[`shoulder${side}`], s[`elbow${side}`], s[`wrist${side}`]);
const hipFlex = (s) => 180 - angleBetween(s.chest, s.hipR, s.kneeR);

// Pure checkers — reused by the controls in Part D.
const squatCheck = (samples) => {
  const pelvisDrop = samples[0].s.pelvis.y - Math.min(...samples.map((x) => x.s.pelvis.y));
  const bottom = samples.reduce((a, b) => (b.s.pelvis.y < a.s.pelvis.y ? b : a));
  const knee = Math.min(signedKneeFlex(bottom.s, 'L'), signedKneeFlex(bottom.s, 'R'));
  const heels = Math.max(...samples.map((x) => Math.max(Math.abs(x.s.ankleL.y - RIG.ankleHeight), Math.abs(x.s.ankleR.y - RIG.ankleHeight))));
  return { ok: pelvisDrop > 0.25 && knee >= 70 && heels < 0.015, detail: `drop ${pelvisDrop.toFixed(2)} m, knee ${knee.toFixed(0)}°, heel lift ${(heels * 100).toFixed(1)} cm` };
};
const pushupCheck = (samples) => {
  const elbowMax = Math.max(...samples.map((x) => elbowFlex(x.s, 'R')));
  let worstLine = 0;
  for (const { s } of samples) worstLine = Math.max(worstLine, dirAngle(sub(s.pelvis, s.chest), sub(s.ankleR, s.hipR)));
  const chestDrop = range(samples.map((x) => x.s.chest.y));
  return { ok: elbowMax >= 75 && worstLine <= 12 && chestDrop > 0.15, detail: `elbow ${elbowMax.toFixed(0)}°, body-line ${worstLine.toFixed(1)}°, chest travel ${chestDrop.toFixed(2)} m` };
};
const hingeCheck = (samples) => {
  const hip = range(samples.map((x) => hipFlex(x.s)));
  const knee = range(samples.map((x) => signedKneeFlex(x.s, 'R')));
  return { ok: hip > knee + 15 && hip > 45, detail: `hip Δ ${hip.toFixed(0)}° vs knee Δ ${knee.toFixed(0)}°` };
};
const curlCheck = (samples) => {
  const e = range(samples.map((x) => elbowFlex(x.s, 'R')));
  const hum = samples.map((x) => sub(x.s.elbowR, x.s.shoulderR));
  let drift = 0;
  for (const h of hum) drift = Math.max(drift, dirAngle(h, hum[0]));
  return { ok: e >= 100 && drift <= 15, detail: `elbow Δ ${e.toFixed(0)}°, upper-arm drift ${drift.toFixed(1)}°` };
};
const jackCheck = (samples) => {
  const handAbove = samples.some((x) => x.s.handL.y > x.s.head.y && x.s.handR.y > x.s.head.y);
  const width = samples.map((x) => Math.abs(x.s.ankleR.x - x.s.ankleL.x));
  const widen = Math.max(...width) - width[0];
  return { ok: handAbove && widen > 0.25, detail: `hands overhead ${handAbove}, feet widen ${widen.toFixed(2)} m` };
};
const staticCheck = (samples) => {
  let worst = 0;
  for (const { s } of samples) for (const k of Object.keys(s)) worst = Math.max(worst, dist(s[k], samples[0].s[k]));
  return { ok: worst < 0.03, detail: `max joint travel ${(worst * 100).toFixed(1)} cm` };
};

const each = (ids, fn, label) => {
  for (const id of ids) {
    const r = fn(S(id), id);
    check(`${label}: ${id}`, r.ok, r.detail);
  }
};

each(['squats', 'front_squat', 'goblet_squat', 'tabata_squats', 'thruster'], squatCheck, 'squat — hips descend, knees ≥70° at bottom, heels planted');
each(['pushups', 'decline_pushup'], pushupCheck, 'push-up — elbows flex, body line straight');
each(['deadlift_straight', 'romanian_deadlift', 'deadlift_stiff', 'kb_swings', 'back_extension'], hingeCheck, 'hinge — hip angle change dominates knee change');
{
  // Sumo is a hybrid pull: honest check is a big hip AND knee excursion with a leaning trunk.
  const sm = S('sumo_deadlift');
  const hip = range(sm.map((x) => hipFlex(x.s)));
  const lean = Math.max(...sm.map((x) => deg(Math.acos(norm(sub(x.s.chest, x.s.pelvis)).y))));
  check('sumo deadlift — hips flex ≥60° with the trunk leaning ≥40°', hip >= 60 && lean >= 40, `hip Δ ${hip.toFixed(0)}°, lean ${lean.toFixed(0)}°`);
}
each(['bicep_curls', 'bb_curl', 'hammer_curl', 'band_curl', 'preacher_curl'], curlCheck, 'curl — elbow flexes, upper arm still');
each(['jump_jacks_v2'], jackCheck, 'jumping jack — arms overhead, feet widen');
each(['plank', 'side_plank', 'hollow_hold', 'wall_sit', 'corpse_pose', 'tree_pose', 'warrior_2', 'child_pose_v2', 'downward_dog'], staticCheck, 'static hold — near-static');

// A broader set of named checkpoints.
const at = (id, pick) => S(id).reduce(pick);
{
  const top = at('pullups', (a, b) => (b.s.head.y > a.s.head.y ? b : a));
  check('pull-up — chin reaches the bar', top.s.head.y > 2.3 - 0.12, `head ${top.s.head.y.toFixed(2)} vs bar 2.30`);
  const lunge = at('lunges_db', (a, b) => (b.s.kneeL.y < a.s.kneeL.y ? b : a));
  check('lunge — rear knee drops near the floor, front knee ≥80°', lunge.s.kneeL.y < 0.2 && signedKneeFlex(lunge.s, 'R') >= 80, `rear knee ${lunge.s.kneeL.y.toFixed(2)} m, front ${signedKneeFlex(lunge.s, 'R').toFixed(0)}°`);
  const calf = S('calf_raises');
  check('calf raise — ankles rise ≥5 cm with toes down', range(calf.map((x) => x.s.ankleR.y)) > 0.05, `${(range(calf.map((x) => x.s.ankleR.y)) * 100).toFixed(1)} cm`);
  for (const id of ['bb_overhead_press', 'shoulder_press_db']) {
    const top2 = at(id, (a, b) => (b.s.wristR.y > a.s.wristR.y ? b : a));
    check(`overhead press — wrists finish above the head: ${id}`, top2.s.wristR.y > top2.s.head.y + 0.15);
  }
  for (const id of ['barbell_row', 'dumbbell_row', 'seated_cable_row', 'lat_pulldown']) {
    const rows = S(id);
    const e = range(rows.map((x) => elbowFlex(x.s, 'R')));
    const trunk = range(rows.map((x) => deg(Math.acos(norm(sub(x.s.chest, x.s.pelvis)).y))));
    check(`pull — elbows flex ≥90° with a steady torso: ${id}`, e >= 90 && trunk < 20, `elbow Δ ${e.toFixed(0)}°, trunk Δ ${trunk.toFixed(0)}°`);
  }
  for (const id of ['glute_bridges_v2', 'hip_thrust']) {
    const b = S(id);
    check(`bridge — hips rise ≥10 cm: ${id}`, range(b.map((x) => x.s.pelvis.y)) > 0.1, `${(range(b.map((x) => x.s.pelvis.y)) * 100).toFixed(0)} cm`);
  }
  for (const id of ['outdoor_run', 'high_knees_v2', 'mountain_climbers']) {
    const r = S(id);
    const alt = r.some((x) => x.s.kneeR.z - x.s.kneeL.z > 0.1) && r.some((x) => x.s.kneeL.z - x.s.kneeR.z > 0.1)
      || r.some((x) => x.s.kneeR.y - x.s.kneeL.y > 0.1) && r.some((x) => x.s.kneeL.y - x.s.kneeR.y > 0.1);
    check(`cyclic — legs alternate: ${id}`, alt);
  }
  const tri = S('overhead_tricep_ext');
  const lowest = tri.reduce((a, b) => (b.s.wristR.y < a.s.wristR.y ? b : a));
  check('overhead triceps — hands drop BEHIND the head (elbow bends the right way)', lowest.s.wristR.z < lowest.s.head.z, `wrist z ${lowest.s.wristR.z.toFixed(2)} vs head z ${lowest.s.head.z.toFixed(2)}`);
  const lat = S('lateral_raise');
  check('lateral raise — hands reach shoulder height, out to the side', lat.some((x) => x.s.wristR.y > x.s.shoulderR.y - 0.08 && x.s.wristR.x > x.s.shoulderR.x + 0.4));
}

// ─── Part D ──────────────────────────────────────────────────────────────────
section('Part D — controls (each must be REJECTED)');

const doctor = (clip, fn) => ({ ...clip, keyframes: clip.keyframes.map((k) => fn({ ...k })) });
{
  const broken = doctor(clips.get('squats'), (k) => ({ ...k, femurDeg: 2, tibiaDeg: 1, trunkDeg: 2 }));
  check('control: a squat with no knee flexion fails the squat check', !squatCheck(sampleAll(broken)).ok);
  const heels = doctor(clips.get('squats'), (k) => ({ ...k, footPitchDegL: 25, footPitchDegR: 25 }));
  check('control: a squat on the toes (heels up) fails the squat check', !squatCheck(sampleAll(heels)).ok);
  const stiffArms = doctor(clips.get('pushups'), (k) => ({ ...k, elbowDeg: 3 }));
  check('control: a push-up with locked elbows fails the push-up check', !pushupCheck(sampleAll(stiffArms)).ok);
  const sag = doctor(clips.get('pushups'), (k) => ({ ...k, femurDeg: -30, tibiaDeg: -30 }));
  check('control: a sagging push-up (hips bent) fails the body-line check', !pushupCheck(sampleAll(sag)).ok);
  const squatty = doctor(clips.get('romanian_deadlift'), (k) => ({ ...k, femurDeg: k.trunkDeg * 1.3, tibiaDeg: -k.trunkDeg * 0.4, trunkDeg: k.trunkDeg * 0.3 }));
  check('control: a "deadlift" driven by the knees fails the hinge check', !hingeCheck(sampleAll(squatty)).ok);
  const swing = doctor(clips.get('bicep_curls'), (k) => ({ ...k, shoulderFlexDeg: k.elbowDeg * 0.6 }));
  check('control: a curl that swings the upper arm fails the curl check', !curlCheck(sampleAll(swing)).ok);
  const noJack = doctor(clips.get('jump_jacks_v2'), (k) => ({ ...k, shoulderAbdDeg: 10 }));
  check('control: a jumping jack without arm abduction fails', !jackCheck(sampleAll(noJack)).ok);
  const moving = doctor(clips.get('plank'), (k) => (k.t === 0.5 ? { ...k, rootPitchDeg: (k.rootPitchDeg ?? 0) - 15 } : k));
  check('control: a plank that moves fails the static check', !staticCheck(sampleAll(moving)).ok);
  const hyper = doctor(clips.get('squats'), (k) => ({ ...k, tibiaDeg: k.femurDeg + 25 }));
  check('control: a hyperextending knee fails plausibility', plausibility(hyper).errs.length > 0);
  const gap = { ...clips.get('squats'), keyframes: clips.get('squats').keyframes.map((k, i, all) => (i === all.length - 1 ? { ...k, femurDeg: 60 } : k)) };
  check('control: an open loop (last frame ≠ first) fails plausibility', plausibility(gap).errs.some((e) => e.includes('loop gap') || e.includes('discontinuity')));
  // Upper arm driven 40 degrees across the midline (ROM clamp switched off so
  // the geometry really goes there): the elbow ends up inside the torso.
  const through = doctor(clips.get('bicep_curls'), (k) => ({ ...k, shoulderAbdDeg: -40, shoulderFlexDeg: 0, elbowDeg: 150 }));
  check('control: an arm driven through the torso fails plausibility', plausibility(through, { enforceRom: false }).errs.some((e) => e.includes('inside torso')));
  // A push-up whose body pitch is not re-solved slides the hands.
  // The whole push-up drifts 8 cm forward as it descends: hands and feet skate on the floor.
  const slide = doctor(clips.get('pushups'), (k) => ({ ...k, shiftZ: 0.08 * ((k.elbowDeg ?? 3) - 3) / 115 }));
  check('control: hands that slide while planted fail plausibility', plausibility(slide).errs.some((e) => e.includes('slides') || e.includes('floor')));
  check('control: an extra unknown id fails the mapping check', mappingProblems(libIds, { ...EXERCISE_MOTIONS, made_up: { family: 'squat', params: {}, equipment: ['bodyweight'] } }).length === 1);
  const missing = { ...EXERCISE_MOTIONS };
  delete missing.swimming;
  check('control: a library id missing from the table fails the mapping check', mappingProblems(libIds, missing).some((p) => p === 'unmapped: swimming'));
  check('control: a bogus family fails the mapping check', mappingProblems(['x'], { x: { family: 'teleport', params: {}, equipment: ['bodyweight'] } }).length === 1);
  check('control: buildFamilyClip is deterministic', JSON.stringify(buildFamilyClip('squats', 'Squats', EXERCISE_MOTIONS.squats)) === JSON.stringify(buildFamilyClip('squats', 'Squats', EXERCISE_MOTIONS.squats)));
}

console.log(`\n${C.b}${fail === 0 ? C.g : C.r}${pass}/${pass + fail} checks passed${C.x}  ${C.d}(${clips.size} exercises, ${famCount} families, ${simplified.length} flagged simplified)${C.x}\n`);
process.exit(fail === 0 ? 0 : 1);
