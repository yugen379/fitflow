// Regression proof for the bugs reported from the device on 2026-08-29.
//
// One check per defect, written so it FAILS on the old behaviour:
//
//   1. A barbell back-squat model rendered for Swimming, Cardio and Cycling,
//      labelled "Muscle activation · LIVE".
//   2. 701,754 steps for an 11,000-step day, which dragged 511 km and
//      36,090 kcal along with it.
//
// Only pure modules are exercised. `lib/pedometer.ts` needs IndexedDB and
// cannot load here, so the adoption guard itself is covered by inspection, not
// by this harness — the formula clamp it depends on IS covered.

const C = { g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.g}PASS${C.x} ${name}${detail ? ` ${C.y}(${detail})${C.x}` : ''}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${name}${detail ? ` ${C.y}(${detail})${C.x}` : ''}`); }
};

const { hasClipFor, getClip, EXERCISE_TO_CLIP } = await import('../src/biomechanics/motions.ts');
const {
  MAX_PLAUSIBLE_DAILY_STEPS, isPlausibleDailySteps, caloriesFor, distanceKmFor,
} = await import('../src/lib/stepFormulas.ts');

// ── 1. No 3D model for an exercise that has no 3D model ──────────────────────
console.log(`\n${C.b}${C.c}Bug 1 — barbell model shown for non-barbell exercises${C.x}\n`);

// The exact three from the screenshots. The workout builder creates these from
// WORKOUT_TYPES in Workout.tsx, so the ids are lower-cased type names.
for (const id of ['swimming', 'cardio', 'cycling']) {
  check(`"${id}" reports NO 3D clip`, hasClipFor(id) === false, `hasClipFor -> ${hasClipFor(id)}`);
  check(`"${id}" resolves to no clip at all (never the back squat)`,
    getClip(EXERCISE_TO_CLIP[id] ?? id) === undefined);
}

check('an unmapped id never silently becomes a barbell lift',
  ['rowing_machine', 'yoga', 'stretching', 'walk', ''].every((id) => !hasClipFor(id)));
check('null / undefined ids are handled without throwing',
  hasClipFor(null) === false && hasClipFor(undefined) === false);

// The mapped ones must still work — the fix must not blank the real lifts.
for (const id of ['squats', 'bench_press', 'deadlift', 'shoulder_press', 'cable_row', 'pullups']) {
  check(`"${id}" still HAS its 3D clip`, hasClipFor(id) === true);
}
check('every entry in EXERCISE_TO_CLIP points at a clip that exists',
  Object.values(EXERCISE_TO_CLIP).every((clipId) => getClip(clipId) !== undefined));

// ── 2. Step counts that are not physically possible ──────────────────────────
console.log(`\n${C.b}${C.c}Bug 2 — implausible step counts poisoning every derived number${C.x}\n`);

// The exact number from the screenshot.
const REPORTED = 701754;
check('the reported 701,754-step day is rejected as implausible',
  isPlausibleDailySteps(REPORTED) === false, `ceiling ${MAX_PLAUSIBLE_DAILY_STEPS.toLocaleString()}`);
check('a real 11,000-step day is accepted', isPlausibleDailySteps(11000) === true);
check('a hard but real 40,000-step day is still accepted', isPlausibleDailySteps(40000) === true);
check('the ceiling itself is accepted (boundary is inclusive)',
  isPlausibleDailySteps(MAX_PLAUSIBLE_DAILY_STEPS) === true);
check('one step over the ceiling is rejected',
  isPlausibleDailySteps(MAX_PLAUSIBLE_DAILY_STEPS + 1) === false);
check('zero is plausible (a day with no walking)', isPlausibleDailySteps(0) === true);
check('negative counts are rejected', isPlausibleDailySteps(-5) === false);
check('NaN / Infinity / junk are rejected',
  [NaN, Infinity, -Infinity, 'lots', null, undefined, {}].every((v) => !isPlausibleDailySteps(v)));

// The derived numbers are what the user actually saw, so clamp them too.
const kcalAtReported = caloriesFor(REPORTED, 90);
const kmAtReported = distanceKmFor(REPORTED, 170);
const kcalAtCeiling = caloriesFor(MAX_PLAUSIBLE_DAILY_STEPS, 90);
const kmAtCeiling = distanceKmFor(MAX_PLAUSIBLE_DAILY_STEPS, 170);
check('calories from a corrupt count are clamped, not 36,090',
  kcalAtReported === kcalAtCeiling && kcalAtReported < 36090,
  `${Math.round(kcalAtReported)} kcal`);
check('distance from a corrupt count is clamped, not 511 km',
  kmAtReported === kmAtCeiling && kmAtReported < 511,
  `${kmAtReported.toFixed(1)} km`);
check('a normal day is completely unaffected by the clamp',
  Math.round(caloriesFor(11000, 90)) === Math.round(11000 * 0.04 * (90 / 70)),
  `${Math.round(caloriesFor(11000, 90))} kcal for 11,000 steps`);
check('derived numbers stay finite for hostile input',
  [NaN, Infinity, -1, 1e18].every((v) =>
    Number.isFinite(caloriesFor(v, 70)) && Number.isFinite(distanceKmFor(v, 170))));

// ── Summary ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${pass}/${total} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`); process.exit(1); }
