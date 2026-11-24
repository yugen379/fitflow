// Proof for the fixes from the 2026-11-24 on-device customer review.
// Each probe has a CONTROL that re-creates the old behaviour and must FAIL,
// so a probe that can never fail is caught.
import { computeDailyTargets, applySafetyBounds } from '../src/lib/nutritionTargets.ts';
import { parseExercise, prettyLabel } from '../src/lib/exerciseParse.ts';
import { formatCoachContext } from '../src/lib/coachContext.ts';
import { registerBackHandler, setBackFallback, resolveBack } from '../src/lib/backButton.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// --- 1. Macro safety --------------------------------------------------------
// The live account: fat-loss, 90 kg, 1,850 kcal, split ~90/5/5.
const live = { goal: 'fat_loss', weight: 90, macroTargets: { mode: 'percent', calorieTarget: 1850, proteinPct: 90, carbsPct: 5, fatsPct: 5 } };
const t = computeDailyTargets(live);
ok('fat >= 20% of kcal (was 10 g)', t.fatsG * 9 >= 1850 * 0.2 - 9);
ok('protein <= 2.5 g/kg (was 416 g)', t.proteinG <= 225);
ok('calories held at 1850', Math.abs(t.proteinG * 4 + t.carbsG * 4 + t.fatsG * 9 - 1850) <= 12);
// control: without bounds the old numbers come back
const raw = { proteinG: 416, carbsG: 23, fatsG: 10 };
ok('CONTROL old split is unsafe', raw.fatsG * 9 < 1850 * 0.2);
const fixed = applySafetyBounds(raw, 1850, 90);
ok('bounds change the old split', fixed.fatsG !== raw.fatsG && fixed.proteinG !== raw.proteinG);
// keto stays possible: low carbs is NOT raised
const keto = computeDailyTargets({ goal: 'fat_loss', weight: 80, macroTargets: { mode: 'percent', calorieTarget: 1800, proteinPct: 25, carbsPct: 5, fatsPct: 70 } });
ok('keto split untouched (carbs ~22 g)', keto.carbsG <= 25 && keto.fatsG >= 130);
// heavy user, low target: never negative carbs
const heavy = computeDailyTargets({ weight: 160, macroTargets: { mode: 'grams', proteinG: 400, carbsG: 0, fatsG: 5 } });
ok('heavy user: carbs >= 0', heavy.carbsG >= 0);
// a normal default split is not altered
const d = computeDailyTargets({ goal: 'maintain', weight: 70 });
ok('default split unchanged', d.fatsG === Math.round(2200 * 0.30 / 9) && d.proteinG === Math.round(2200 * 0.25 / 4));
// fuzz
let fuzzBad = 0;
for (let i = 0; i < 5000; i++) {
  const p = Math.random() * 100, c = Math.random() * 100, f = Math.random() * 100;
  const cal = 1000 + Math.random() * 3500, w = 40 + Math.random() * 140;
  const r = computeDailyTargets({ weight: w, macroTargets: { mode: 'percent', calorieTarget: cal, proteinPct: p, carbsPct: c, fatsPct: f } });
  if (r.fatsG * 9 < r.calories * 0.2 - 9 || r.proteinG > w * 2.5 + 1 || r.carbsG < 0) fuzzBad++;
}
ok('fuzz 5000 random splits all safe', fuzzBad === 0);

// --- 2. Exercise parsing ----------------------------------------------------
const sq = parseExercise({ name: 'Bodyweight Squats (3 sets of 10-12 repetitions)' });
ok('name cleaned', sq.name === 'Bodyweight Squats');
ok('sets/reps parsed', sq.sets === 3 && sq.reps === 10);
ok('bodyweight → 0 kg', sq.bodyweight && sq.weight === 0);
ok('CONTROL raw string kept the prescription', 'Bodyweight Squats (3 sets of 10-12 repetitions)' !== sq.name);
const pu = parseExercise('Push-ups (on knees or incline against a wall/bench) (3 sets of 8-10 repetitions)');
ok('string input + push-up bodyweight', pu.name === 'Push-ups' && pu.weight === 0 && pu.sets === 3 && pu.reps === 8);
const row = parseExercise({ name: 'Dumbbell Rows (3 sets of 10-12 repetitions each arm)', weight: 12 });
ok('loaded move keeps weight', !row.bodyweight && row.weight === 12);
ok('saved plan values win', parseExercise({ name: 'Bench Press', sets: 5, reps: 5, weight: 60, id: 'bench' }).id === 'bench');
ok('jogging in place → 0 kg (missed on device)', parseExercise('Light Jogging/Marching in Place (5 minutes)').weight === 0);
ok('plank → 0 kg', parseExercise('Plank (3 sets, hold for 20-30 seconds)').weight === 0);
ok('dumbbell lunges stay loaded', parseExercise({ name: 'Dumbbell Lunges (3 sets of 10)', weight: 8 }).weight === 8);
ok('FULL_BODY → Full body', prettyLabel('FULL_BODY') === 'Full body');

// --- 3. Coach context -------------------------------------------------------
const meals = [
  { name: 'Teh Tarik (pulled tea with condensed milk)', calories: 150, protein: 3, carbs: 25, fats: 4 },
  { name: 'Fried chicken (drumstick/thigh)', calories: 350, protein: 25, carbs: 10, fats: 20 },
];
const ctx = formatCoachContext(live, meals, new Date(2026, 10, 24, 22, 35));
ok('context lists the meals', ctx.includes('Teh Tarik') && ctx.includes('Fried chicken'));
ok('context has totals', ctx.includes('Totals: 500 kcal'));
ok('context has SAFE targets', !ctx.includes('F 10g') && ctx.includes('Daily targets: 1850 kcal'));
const many = formatCoachContext(live, Array.from({ length: 50 }, (_, i) => ({ name: 'x'.repeat(80) + i, calories: 100 })));
ok('context capped for the 2000-char proxy clip', many.length <= 1400);
ok('empty day says none yet', formatCoachContext(live, []).includes('none yet'));

// --- 4. Back button resolution ----------------------------------------------
setBackFallback(() => false);
ok('nothing open on Home → minimise (not kill)', resolveBack() === 'minimize');
let quitArmed = false;
const off = registerBackHandler(() => { quitArmed = true; return true; });
ok('open workout consumes Back', resolveBack() === 'handler' && quitArmed);
off();
setBackFallback(() => true);
ok('other tab → fallback (go Home)', resolveBack() === 'fallback');
const order = [];
const a = registerBackHandler(() => { order.push('a'); return true; });
const b = registerBackHandler(() => { order.push('b'); return true; });
resolveBack();
ok('newest overlay handles first', order[0] === 'b' && order.length === 1);
a(); b();

// --- 5. Pro: app keys the creator unlock on the VERIFIED auth email (like the server)
const { computeEntitlement } = await import('../src/lib/billing.ts');
const NOW = Date.now();
ok('creator via verified auth email → Pro (profile doc has no email)',
  computeEntitlement({ authEmail: 'yugentiran2011@gmail.com' }, NOW, false).isPro === true);
ok('CONTROL: same profile without the verified email → not Pro',
  computeEntitlement({}, NOW, false).isPro === false);
ok('another verified email → not Pro', computeEntitlement({ authEmail: 'someone@example.com' }, NOW, false).isPro === false);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
