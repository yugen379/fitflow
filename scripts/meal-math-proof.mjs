// Unit tests for the meal pipeline math (src/lib/mealMath.ts).
// Each probe that could pass vacuously has a CONTROL that must FAIL.
import {
  macrosForGrams, lineMacros, sumMacros, totalsOf, sanitizeDecomposition, sanePer100, toConfidence,
  lookupOffline, nameVariants, per100FromServingFood, servingGrams, makeLine, servingLine,
  oilGrams, oilMacros, oilBaseGrams, needsOilChoice, suggestedOil, mealTotals, OIL_MAX_G,
  needsHint, mealConfidence, cleanHint, diaryName, clampGrams, isVagueMeal, pickUsdaHit, mealCacheKey, localDecompose,
  chainServingGrams, typicalPortionG,
} from '../src/lib/mealMath.ts';
import { buildFoodIndex, searchFoodIndex } from '../src/services/foodSearchIndex.ts';
import { INGREDIENTS_100G } from '../src/data/ingredients100g.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const item = (name, grams, extra = {}) => ({ name, grams, confidence: 0.9, method: 'raw', per100Hint: null, ...extra });
const line = (name, grams, extra = {}) => makeLine(item(name, grams, extra), lookupOffline(name));

// --- 1. The formula: (grams / 100) * per_100g ------------------------------------
const rice = { kcal: 130, protein: 2.7, carbs: 28, fats: 0.3 };
const r180 = macrosForGrams(180, rice);
ok('180 g rice = 234 kcal', r180.calories === 234);
ok('macros scale too (C 50.4 g)', r180.carbs === 50.4 && r180.protein === 4.9);
ok('0 g = 0 kcal', macrosForGrams(0, rice).calories === 0);
ok('negative grams clamp to 0', macrosForGrams(-50, rice).calories === 0);
ok('doubling grams doubles kcal', macrosForGrams(360, rice).calories === 468);

// --- 2. Sum only after lookup; AI totals are ignored ------------------------------
const raw = { items: [
  { ingredient_name: 'white rice', estimated_grams: 200, confidence: 0.9, method: 'boiled', calories: 9999 },
  { ingredient_name: 'fried chicken', estimated_grams: 120, confidence: 0.8, method: 'fried', total_kcal: 5000 },
  { ingredient_name: 'sambal', estimated_grams: 20, confidence: 0.7, method: 'saucy' },
], obscured: false, total_calories: 20000 };
const d = sanitizeDecomposition(raw);
const lines = d.items.map((i) => makeLine(i, lookupOffline(i.name)));
const t = totalsOf(lines);
ok('looked up: rice 260 + chicken 312 + sambal 34 = 606', t.calories === 260 + 312 + 34);
ok('total = sum of per-line results', t.calories === lines.map(lineMacros).reduce((a, m) => a + m.calories, 0));
ok('CONTROL: the AI-supplied numbers would have been different', 9999 + 5000 !== t.calories && raw.total_calories !== t.calories);
ok('sanitised items carry no calorie field', d.items.every((i) => !('calories' in i)));
ok('deterministic: same input -> same total', totalsOf(sanitizeDecomposition(raw).items.map((i) => makeLine(i, lookupOffline(i.name)))).calories === t.calories);

// --- 3. Sanitising the model's answer ----------------------------------------------
const s = sanitizeDecomposition([
  { ingredient_name: 'cooking oil', estimated_grams: 15 },
  { ingredient_name: 'plate', estimated_grams: 300 },
  { ingredient_name: 'egg', estimated_grams: 0 },
  { ingredient_name: 'rice', estimated_grams: 5000, confidence: 85 },
  { name: 'cucumber', grams: '40', confidence: 'high', method: 'Deep fried' },
  null, 'junk',
]);
ok('oil, plate, 0 g and junk dropped', s.items.length === 2);
ok('grams clamped to 2000', s.items[0].grams === 2000);
ok('confidence 85 -> 0.85', s.items[0].confidence === 0.85);
ok('"high" -> 0.9, method normalised', s.items[1].confidence === 0.9 && s.items[1].method === 'fried');
ok('string grams parsed', s.items[1].grams === 40);
ok('garbage input -> empty, never throws', sanitizeDecomposition('nope').items.length === 0 && sanitizeDecomposition(undefined).items.length === 0);
ok('missing confidence = 0.5 (unsure)', toConfidence(undefined) === 0.5);
ok('per-100 over 900 kcal rejected', sanePer100({ kcal: 1200 }) === null && sanePer100({ kcal: 250, fat: 10 }).fats === 10);
ok('clampGrams rounds', clampGrams('180.6') === 181 && clampGrams(-3) === 0);

// --- 4. Lookup ----------------------------------------------------------------------
ok('"grilled boneless chicken thigh" -> Chicken thigh', lookupOffline('grilled boneless chicken thigh')?.matched === 'Chicken thigh');
ok('"steamed jasmine rice" -> White rice', lookupOffline('steamed jasmine rice')?.matched === 'White rice');
ok('"kangkung" -> Leafy greens (alias)', lookupOffline('kangkung')?.matched === 'Leafy greens');
ok('phone miss: "peas" -> Green peas at 81 kcal, not a 585 kcal peanut snack', lookupOffline('peas')?.matched === 'Green peas' && lookupOffline('peas')?.per100.kcal === 81);
ok('"chickpeas" stays Chickpeas', lookupOffline('chickpeas')?.matched === 'Chickpeas');
const H = (name, calories) => ({ name, calories });
const pom = [H('Pomegranate juice, bottled', 54), H('Pomegranates, raw', 83)];
ok('USDA: "pomegranate" takes "Pomegranates, raw" (plural) over bottled juice', pickUsdaHit('pomegranate', pom)?.calories === 83);
ok('USDA: "pomegranate juice" keeps the juice', pickUsdaHit('pomegranate juice', pom)?.calories === 54);
ok('USDA: "peas" never matches "Chickpeas"', pickUsdaHit('peas', [H('Chickpeas, mature seeds, cooked', 164)]) === null);
ok('USDA: "boiled edamame" keys on edamame, not "boiled"', pickUsdaHit('boiled edamame', [H('Potatoes, boiled', 87), H('Edamame, frozen, prepared', 121)])?.calories === 121);
ok('USDA: zero-kcal hits skipped', pickUsdaHit('tea', [H('Tea, brewed', 0)]) === null);
ok('"chili sauce" is NOT guessed', lookupOffline('chili sauce') === null);
// control: a loose top-hit on the word "sauce" would have returned some sauce
const tableIdx = buildFoodIndex(INGREDIENTS_100G);
// (the "sauce" tail of "chili sauce" passes the loose floor and lands on Ketchup)
const looseTop = searchFoodIndex(tableIdx, 'sauce', 1)[0];
ok('CONTROL: a loose match on the tail "sauce" would have guessed a food', !!looseTop && looseTop.score >= 30);
ok('unknown food -> null', lookupOffline('mystery dumpling') === null);
ok('"chicken curry" is chicken curry, not curry gravy (seen live)', lookupOffline('chicken curry')?.matched === 'Chicken curry');
ok('"lamb curry" never drops the lamb to become gravy alone', lookupOffline('lamb curry') === null);
ok('"spicy curry gravy" may drop "spicy"', lookupOffline('spicy curry gravy')?.matched === 'Curry gravy');
ok('shortened tails are exact-only', nameVariants('extra spicy curry gravy').filter((v) => v.exact).map((v) => v.q).join() === 'curry gravy');
ok('serving grams parsed', servingGrams('100g cooked') === 100 && servingGrams('(325ml can)') === 325 && servingGrams('1 bowl') === null);
ok('bundled per-serving -> per 100 g', per100FromServingFood({ name: '100Plus (325ml can)', calories: 88, protein: 0, carbs: 21, fats: 0 }).kcal.toFixed(1) === '27.1');
ok('bundled food without grams is not converted', per100FromServingFood({ name: 'Bagel', calories: 420, protein: 12, carbs: 60, fats: 14, serving: '1 medium' }) === null);
const bundledIdx = buildFoodIndex([{ name: 'Kuih lapis (50g piece)', calories: 120, protein: 1, carbs: 22, fats: 3 }]);
ok('bundled index used when the table lacks it', lookupOffline('kuih lapis', bundledIdx)?.per100.kcal === 240);
const hinted = makeLine(item('mystery dumpling', 80, { per100Hint: { kcal: 220, protein: 8, carbs: 30, fats: 7 } }), null);
ok('AI density only as last resort, labelled estimate', hinted.source === 'ai_density' && lineMacros(hinted).calories === 176);
const missing = makeLine(item('mystery dumpling', 80), null);
ok('nothing found -> 0 kcal, source none (user types it)', missing.source === 'none' && lineMacros(missing).calories === 0);
ok('table wins over the AI density', makeLine(item('white rice', 100, { per100Hint: { kcal: 400, protein: 0, carbs: 0, fats: 0 } }), lookupOffline('white rice')).per100.kcal === 130);

// --- 5. Per-serving rows ------------------------------------------------------------
const sv = servingLine({ name: 'Nasi lemak', calories: 400, protein: 10, carbs: 50, fats: 18 });
ok('serving row = base', lineMacros(sv).calories === 400);
ok('serving row x1.5', lineMacros({ ...sv, servings: 1.5 }).calories === 600);
ok('serving row has no grams (no oil base)', sv.grams === null && oilBaseGrams([sv]) === 0);

// --- 6. Cooking oil (stage 2) -------------------------------------------------------
const veg = line('mixed vegetables', 200, { method: 'stir_fried' });
ok('light, 200 g stir-fried = 5 g oil', oilGrams('light', oilBaseGrams([veg])) === 5);
ok('5 g oil = 44 kcal, 5 g fat', oilMacros('light', 200).calories === 44 && oilMacros('light', 200).fats === 5);
ok('heavy, 200 g = 15 g oil = 133 kcal', oilGrams('heavy', 200) === 15 && oilMacros('heavy', 200).calories === 133);
ok('none = 0', oilGrams('none', 500) === 0);
ok('minimums: light 3 g, heavy 8 g', oilGrams('light', 40) === 3 && oilGrams('heavy', 40) === 8);
ok('cap at 60 g', oilGrams('heavy', 5000) === OIL_MAX_G);
const fc = line('fried chicken', 150, { method: 'fried' });
ok('fried chicken already includes its oil -> no base', fc.oilIncluded && oilBaseGrams([fc]) === 0);
// control: without the oilIncluded rule the fat would be counted twice
ok('CONTROL: ignoring oilIncluded would add oil', oilBaseGrams([{ ...fc, oilIncluded: false }]) === 150);
const boiled = line('white rice', 200, { method: 'boiled' });
ok('boiled rice is not an oil base', oilBaseGrams([boiled]) === 0 && !needsOilChoice([boiled]));
ok('selector shown for stir-fried veg', needsOilChoice([boiled, veg]));
ok('suggested: stir-fried -> light', suggestedOil([boiled, veg]) === 'light');
ok('suggested: deep-fried (not pre-oiled) -> heavy', suggestedOil([line('tofu', 150, { method: 'fried' })]) === 'heavy');
ok('suggested: nothing cooked -> none', suggestedOil([boiled]) === 'none');
ok('suggested: a 50 g fried egg -> light, not heavy (seen live)', suggestedOil([line('egg', 50, { method: 'fried' }), veg]) === 'light');
const mt = mealTotals([boiled, veg], 'light');
ok('meal total = lines + oil', mt.calories === totalsOf([boiled, veg]).calories + 44);
ok('switching oil none->heavy adds exactly 133', mealTotals([boiled, veg], 'heavy').calories - mealTotals([boiled, veg], 'none').calories === 133);

// --- 7. Low confidence -> hint (stage 3) --------------------------------------------
const sure = [line('white rice', 200), line('fried chicken', 120)];
ok('confident plate: no hint', !needsHint(sure, false, false));
ok('obscured: hint', needsHint(sure, true, false));
ok('nothing found: hint', needsHint([], false, false));
const unsureBig = [line('white rice', 200), { ...line('curry gravy', 150), confidence: 0.2 }];
ok('unsure 150 g item: hint', needsHint(unsureBig, false, false));
const unsureGarnish = [line('white rice', 300), { ...line('onion', 10), confidence: 0.2 }];
ok('unsure 10 g garnish: no hint', !needsHint(unsureGarnish, false, false));
ok('meal confidence is grams-weighted', Math.abs(mealConfidence([{ ...line('rice', 300), confidence: 1 }, { ...line('egg', 100), confidence: 0 }]) - 0.75) < 1e-9);
ok('low plate confidence: hint', needsHint([{ ...line('rice', 200), confidence: 0.4 }], false, false));
ok('only once: hint already used -> never again', !needsHint([], true, true));
for (const v of ['a plate of leftovers', 'Leftovers', 'my usual lunch', 'some food', 'dinner at the stall', 'had a big meal']) ok(`vague "${v}": asks`, isVagueMeal(v));
for (const f of ['leftover rice', 'nasi lemak', 'a plate of chicken rice', 'egg', 'mixed rice with curry', 'leftover pizza']) ok(`names a food "${f}": no ask`, !isVagueMeal(f));
ok('empty text is not "vague"', !isVagueMeal(''));
ok('cache key: case, punctuation and spaces ignored', mealCacheKey('Nasi Lemak!') === mealCacheKey('nasi   lemak'));
ok('cache key: different meals differ', mealCacheKey('nasi lemak') !== mealCacheKey('nasi goreng'));
ok('cache key: the hint is part of the key', mealCacheKey('leftovers', 'fried rice') !== mealCacheKey('leftovers') && mealCacheKey('leftovers', 'fried rice') !== mealCacheKey('leftovers', 'curry'));
ok('cache key: too short -> no caching', mealCacheKey('a') === '' && mealCacheKey('!!') === '');
// AI unavailable: the meal is split locally and nothing is dropped.
const ld = localDecompose('quinoa with black beans and grilled salmon');
ok('local split: three parts, quinoa kept', ld.length === 3 && ld[0].name === 'quinoa' && ld[1].name === 'black beans' && ld[2].name === 'grilled salmon');
ok('local split: typical portions (grain 180, legumes 150, fish 120)', ld[0].grams === 180 && ld[1].grams === 150 && ld[2].grams === 120);
ok('local split: grilled salmon is marked grilled', ld[2].method === 'grilled');
const ld2 = localDecompose('2 eggs, 200g white rice + teh tarik');
ok('local split: "2 eggs" = 100 g, "200g white rice" = 200 g, drink 250', ld2.length === 3 && ld2[0].grams === 100 && ld2[1].grams === 200 && ld2[1].name === 'white rice' && ld2[2].grams === 250);
ok('local split: every part found in the table', ld2.every((i) => lookupOffline(i.name)) && ld.every((i) => lookupOffline(i.name)));
const ld3 = localDecompose('zorblax pie and rice');
ok('local split: an unknown food still gets a row', ld3.length === 2 && ld3[0].name === 'zorblax pie' && !lookupOffline('zorblax pie'));
ok('local split: fried / curry methods read', localDecompose('fried chicken')[0].method === 'fried' && localDecompose('chicken curry')[0].method === 'saucy');
ok('local split: empty and junk -> nothing', localDecompose('').length === 0 && localDecompose(', , and').length === 0);
ok('local split: at most 12 parts', localDecompose(Array(30).fill('rice').join(', ')).length === 12);
// Restaurant-chain items carry the USDA weight of one item: "2 big macs" is 2 x 219 g, not 2 x a guess.
ok('chain serving: "big mac" -> 219 g (USDA portion)', chainServingGrams('big mac') === 219);
ok('chain serving: a generic "burger" has no fixed size -> null', chainServingGrams('burger') === null && chainServingGrams('white rice') === null);
ok('chain serving: unknown food -> null', chainServingGrams('zorblax pie') === null);
const ldc = localDecompose('2 big macs and a medium coke');
ok('local split: "2 big macs" = 438 g from the chain serving', ldc[0].grams === 438);
// CONTROL: without the chain serving the same line would have been a 2 x 100 g guess.
ok('CONTROL: the typical-portion guess for "big macs" differs', typicalPortionG('big macs') * 2 !== ldc[0].grams);
ok('local split: non-chain foods keep the typical portion', localDecompose('2 eggs')[0].grams === 100);
ok('cleanHint trims and caps', cleanHint('  chicken   curry!! with rice ') === 'chicken curry with rice' && cleanHint('a b c d e f g h') === 'a b c d e f');
ok('empty hint -> null', cleanHint('   ') === null && cleanHint(5) === null);

// --- 8. Diary names and fuzz --------------------------------------------------------
ok('diary name carries grams', diaryName(line('white rice', 180)) === 'white rice (180 g)');
ok('serving diary name carries multiplier', diaryName({ ...sv, servings: 2 }) === 'Nasi lemak ×2');
let bad = 0;
const names = ['rice', 'fried chicken', 'sambal', 'egg', 'x', 'teh tarik', 'peanuts', '', 'oil', 'kangkung'];
for (let i = 0; i < 3000; i++) {
  const rawF = { items: Array.from({ length: 1 + (i % 6) }, () => ({
    ingredient_name: names[Math.floor(Math.random() * names.length)],
    estimated_grams: Math.random() < 0.1 ? 'abc' : Math.random() * 3000 - 100,
    confidence: Math.random() * 120 - 10,
    method: ['fried', 'raw', 'saucy', 42][Math.floor(Math.random() * 4)],
    per_100g: Math.random() < 0.5 ? { kcal: Math.random() * 1500 } : undefined,
  })) };
  const ls = sanitizeDecomposition(rawF).items.map((it) => makeLine(it, lookupOffline(it.name)));
  for (const lvl of ['none', 'light', 'heavy']) {
    const tt = mealTotals(ls, lvl);
    if (!Number.isFinite(tt.calories) || tt.calories < 0 || !Number.isInteger(tt.calories) || tt.fats < 0) bad++;
  }
}
ok('fuzz 3000 random AI answers: totals finite, >= 0, integer kcal', bad === 0);
ok('sumMacros of nothing is zero', sumMacros([]).calories === 0);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
