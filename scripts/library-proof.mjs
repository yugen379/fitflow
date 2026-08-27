// Content proof harness — npm run proof:library
//
// The exercise library and the food seed are DATA, and data rots differently
// from code: nothing type-checks it, nothing throws, and a broken entry simply
// fails to appear. That is exactly how the library shipped with:
//
//   • Squats invisible under the "Legs" filter, because it was tagged
//     ['Quads','Glutes','Hamstrings'] and the filter vocabulary lived in a
//     separate hardcoded array. Seven exercises were unreachable that way.
//   • Eleven more unreachable by equipment (Yoga Mat, Bench, Pull-up Bar, Jump
//     Rope, Wall, Box were not in the filter list at all).
//   • A "Resistance Band" chip that matched nothing.
//   • Seven duplicated names — "Mountain Climbers" listed three times.
//
// Every assertion below is one of those failures, turned into a gate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const exercises = JSON.parse(read('src/data/exerciseLibrary.json'));
const foods = JSON.parse(read('scripts/data/common-foods.json'));
const taxSrc = read('src/data/taxonomy.ts');
const librarySrc = read('src/pages/Library.tsx');

// Parse the vocabulary out of taxonomy.ts — the harness must read the same
// source the app does, not a copy that can drift.
const listOf = (name) => {
  const start = taxSrc.indexOf(`export const ${name} = [`);
  const end = taxSrc.indexOf('] as const', start);
  return [...taxSrc.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const CATEGORIES = listOf('CATEGORIES');
const MUSCLE_GROUPS = listOf('MUSCLE_GROUPS');
const EQUIPMENT = listOf('EQUIPMENT');
const DIFFICULTIES = listOf('DIFFICULTIES');

console.log(`\n${C.b}── Library content proof ──${C.x}\n`);

// ─── Vocabulary is shared, not duplicated ─────────────────────────────────────
console.log(`${C.b}Vocabulary${C.x}`);
check(`taxonomy parsed (${CATEGORIES.length} categories, ${MUSCLE_GROUPS.length} regions, ${EQUIPMENT.length} equipment)`,
  CATEGORIES.length >= 5 && MUSCLE_GROUPS.length >= 6 && EQUIPMENT.length >= 6);
check('Library.tsx imports the shared taxonomy', /from '\.\.\/data\/taxonomy'/.test(librarySrc));
check('Library.tsx no longer hardcodes its own muscle list',
  !/const MUSCLE_GROUPS = \[/.test(librarySrc));
check('Library.tsx no longer hardcodes its own equipment list',
  !/const EQUIPMENT = \[/.test(librarySrc));

// ─── Every exercise is reachable ──────────────────────────────────────────────
console.log(`\n${C.b}Reachability${C.x}`);
const unreachableMuscle = exercises.filter(
  (e) => !(e.muscleGroups || []).some((m) => MUSCLE_GROUPS.includes(m)));
check('every exercise matches at least one muscle filter',
  unreachableMuscle.length === 0,
  unreachableMuscle.slice(0, 5).map((e) => e.name).join(', '));

const unreachableEquip = exercises.filter(
  (e) => !(e.equipment || []).some((q) => EQUIPMENT.includes(q)));
check('every exercise matches at least one equipment filter',
  unreachableEquip.length === 0,
  unreachableEquip.slice(0, 5).map((e) => e.name).join(', '));

const badCategory = exercises.filter((e) => !CATEGORIES.includes(e.category));
check('every exercise has a known category', badCategory.length === 0,
  badCategory.slice(0, 5).map((e) => `${e.name}:${e.category}`).join(', '));

const badDifficulty = exercises.filter((e) => !DIFFICULTIES.includes(e.difficulty));
check('every exercise has a known difficulty', badDifficulty.length === 0,
  badDifficulty.slice(0, 5).map((e) => `${e.name}:${e.difficulty}`).join(', '));

// ─── No dead filter chips ─────────────────────────────────────────────────────
//
// The inverse of the above: a chip that matches nothing is a promise the UI
// cannot keep. "Resistance Band" was one for the whole life of the app.
console.log(`\n${C.b}No dead filter chips${C.x}`);
const deadMuscle = MUSCLE_GROUPS.filter(
  (m) => !exercises.some((e) => (e.muscleGroups || []).includes(m)));
check('every muscle chip matches at least one exercise', deadMuscle.length === 0, deadMuscle.join(', '));
const deadEquip = EQUIPMENT.filter(
  (q) => !exercises.some((e) => (e.equipment || []).includes(q)));
check('every equipment chip matches at least one exercise', deadEquip.length === 0, deadEquip.join(', '));
const deadCategory = CATEGORIES.filter((c) => !exercises.some((e) => e.category === c));
check('every category chip matches at least one exercise', deadCategory.length === 0, deadCategory.join(', '));

// ─── Integrity ────────────────────────────────────────────────────────────────
console.log(`\n${C.b}Integrity${C.x}`);
const ids = exercises.map((e) => e.id);
const names = exercises.map((e) => e.name.trim().toLowerCase());
const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
const dupNames = names.filter((v, i) => names.indexOf(v) !== i);
check('no duplicate ids', dupIds.length === 0, [...new Set(dupIds)].join(', '));
check('no duplicate names', dupNames.length === 0, [...new Set(dupNames)].join(', '));

const REQUIRED = ['id', 'name', 'category', 'muscleGroups', 'difficulty', 'duration',
  'calories_per_minute', 'description', 'instructions', 'equipment'];
const incomplete = exercises.filter((e) => REQUIRED.some((k) => e[k] === undefined || e[k] === ''));
check('every exercise has all required fields', incomplete.length === 0,
  incomplete.slice(0, 5).map((e) => e.name).join(', '));

const thinInstructions = exercises.filter((e) => (e.instructions || []).length < 3);
check('every exercise has at least 3 instruction steps', thinInstructions.length === 0,
  thinInstructions.slice(0, 5).map((e) => e.name).join(', '));

const badNumbers = exercises.filter(
  (e) => !(e.duration > 0) || !(e.calories_per_minute > 0));
check('duration and calories/min are positive', badNumbers.length === 0,
  badNumbers.slice(0, 5).map((e) => e.name).join(', '));

// ─── Coverage — the reason someone stays past week one ────────────────────────
console.log(`\n${C.b}Coverage${C.x}`);
check(`library has at least 120 exercises (${exercises.length})`, exercises.length >= 120);
for (const m of MUSCLE_GROUPS) {
  const n = exercises.filter((e) => (e.muscleGroups || []).includes(m)).length;
  check(`${m} has at least 8 exercises (${n})`, n >= 8);
}
for (const c of CATEGORIES) {
  const n = exercises.filter((e) => e.category === c).length;
  check(`${c} has at least 4 exercises (${n})`, n >= 4);
}

// ─── Food seed ────────────────────────────────────────────────────────────────
console.log(`\n${C.b}Food seed${C.x}`);
check(`at least 250 foods (${foods.length})`, foods.length >= 250);
const foodNames = foods.map((f) => String(f.name).trim().toLowerCase());
const dupFoods = foodNames.filter((v, i) => foodNames.indexOf(v) !== i);
check('no duplicate foods', dupFoods.length === 0, [...new Set(dupFoods)].slice(0, 5).join(', '));

const badFood = foods.filter((f) =>
  typeof f.name !== 'string' || !f.name.trim() ||
  [f.calories, f.protein, f.carbs, f.fats].some((v) => typeof v !== 'number' || v < 0));
check('every food has a name and non-negative macros', badFood.length === 0,
  badFood.slice(0, 5).map((f) => f.name).join(', '));

// A calorie figure that disagrees with its own macros becomes a wrong daily
// target for a real person. 4/4/9 kcal per gram, with margin for fibre and
// rounding.
const mismatched = foods.filter((f) => {
  const derived = f.protein * 4 + f.carbs * 4 + f.fats * 9;
  return Math.abs(derived - f.calories) > Math.max(120, f.calories * 0.30);
});
check('calories agree with macros for every food', mismatched.length === 0,
  mismatched.slice(0, 5).map((f) => f.name).join(', '));

// The specific gap that would have lost the Penang closed test.
const LOCAL = ['nasi lemak', 'char kway teow', 'roti canai', 'teh tarik', 'satay',
  'laksa', 'nasi goreng', 'chicken rice', 'mee goreng', 'rendang'];
const missingLocal = LOCAL.filter((d) => !foodNames.some((n) => n.includes(d)));
check('local staples are in the seed', missingLocal.length === 0, missingLocal.join(', '));

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) {
  console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
} else {
  console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`);
  process.exit(1);
}
