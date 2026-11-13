// Food search proof — npm run proof:foodsearch
//
// Drives the app's real search (src/services/foodService.ts) with what people
// actually type: Malaysian dishes, other names for the same food, typos,
// plurals, half-typed words, whole sentences.
//
// Control: the same expectations are run through the PREVIOUS search (the
// substring matcher over the ~100 curated foods, copied below as it was). If the
// old search also passed them, these checks would prove nothing; it has to fail
// most of them.

const {
  searchLocalFoods, resolveLocalFood, ensureFoodIndex, localFoodCount, CURATED_FOODS,
} = await import('../src/services/foodService.ts');
const { editDistance, stem, normalizeText } = await import('../src/services/foodSearchIndex.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (n, ok, d = '') => {
  if (ok) { pass++; console.log(`  ${C.g}PASS${C.x} ${n}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${n}${d ? `  ${C.d}— ${d}${C.x}` : ''}`); }
};
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

// --- the previous search, verbatim -------------------------------------------
const OLD_FILLER = /\b(a|an|the|some|of|with|and|my|small|medium|large|big|bowl|cup|glass|plate|piece|slice|serving|portion|grams?|cups?)\b/gi;
const oldNormalize = (q) => q.toLowerCase().replace(OLD_FILLER, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const oldSearch = (query) => {
  const q = oldNormalize(query);
  if (!q) return [];
  const tokens = q.split(' ').filter((t) => t.length >= 2);
  if (!tokens.length) return [];
  return CURATED_FOODS.map((f) => {
    const hay = (f.name + ' ' + f.aliases.join(' ')).toLowerCase();
    let score = 0, exact = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score++;
      if (f.aliases.some((a) => a === t || a.split(' ').includes(t))) exact++;
    }
    return { f, score, exact };
  }).filter((s) => s.score > 0)
    .sort((a, b) => (b.exact - a.exact) || (b.score - a.score))
    .slice(0, 5).map((s) => ({ name: `${s.f.name} (${s.f.serving})` }));
};

// [what is typed, what the FIRST result's name must start with]
const TOP1 = [
  // Malaysian — the food the first testers eat
  ['nasi lemak', 'Nasi Lemak'], ['roti canai', 'Roti Canai'], ['teh tarik', 'Teh Tarik'],
  ['char kway teow', 'Char Kway Teow'], ['char kuey teow', 'Char Kway Teow'], ['nasi goreng', 'Nasi Goreng'],
  ['chicken rice', 'Chicken Rice'], ['nasi ayam', 'Chicken Rice'], ['asam laksa', 'Asam Laksa'],
  ['mee goreng', 'Mee Goreng Mamak'], ['satay', 'Satay Ayam'], ['rendang', 'Rendang Daging'],
  ['cendol', 'Cendol'], ['abc', 'Ais Kacang'], ['milo ais', 'Milo Ais'], ['kopi o', 'Kopi O'],
  ['thosai', 'Thosai'], ['tosai', 'Thosai'], ['capati', 'Capati'], ['chapati', 'Roti'],
  ['nasi kandar', 'Nasi Kandar'], ['economy rice', 'Economy Rice'], ['prawn mee', 'Penang Prawn Mee'],
  ['telur mata', 'Fried Egg'], ['ayam goreng', 'Fried Chicken'], ['kangkung', 'Kangkung Belacan'],
  ['taugeh', 'Bean Sprouts'], ['santan', 'Coconut Milk'], ['karipap', 'Curry Puff'],
  ['burger ramly', 'Ramly Burger'], ['roti john', 'Roti John'], ['air tebu', 'Sugarcane Juice'],
  ['bubur ayam', 'Chicken Congee'], ['ikan bakar', 'Ikan Bakar'], ['maggi goreng', 'Maggi Goreng'],
  ['asam pedas', 'Ikan Masak Asam Pedas'], ['teh o ais kosong', 'Teh O Ais Kosong'], ['nasi bujang', 'Nasi Bujang'],
  ['putu piring', 'Kuih Putu Piring'], ['cekodok', 'Cekodok Pisang'], ['kolo mee', 'Mee Kolok'], ['kopi kenangan', 'Kopi Kenangan Latte'],
  ['roti telur bawang', 'Roti Canai Telur Bawang'], ['ayam gunting', 'Ayam Gunting'], ['milo kosong', 'Milo Kosong'], ['nasi ambeng', 'Nasi Ambeng'],
  ['texas chicken', 'Texas Chicken Original'], ['zus coffee', 'ZUS Spanish Latte'], ['bubur lambuk', 'Bubur Lambuk'], ['pasembur', 'Pasembur'],
  // Wider Asian and brands
  ['pad thai', 'Pad thai'], ['pho', 'Pho'], ['bibimbap', 'Bibimbap'], ['butter chicken', 'Butter Chicken'],
  ['masala dosa', 'Masala Dosa'], ['gyudon', 'Gyudon'], ['kimbap', 'Kimbap'], ['boba', 'Bubble Tea'],
  ['big mac', 'Big Mac'], ['zinger', 'Zinger Burger'], ['mcnuggets', 'Chicken McNuggets'],
  ['starbucks latte', 'Caffe Latte'], ['coke zero', 'Coca-Cola Zero'], ['whopper', 'Whopper'],
  ['frappuccino', 'Caramel Frappuccino'], ['indomie', 'Indomie Mi Goreng'], ['100 plus', '100Plus'],
  // The plain word must find the plain food
  ['rice', 'White rice'], ['banana', 'Banana'], ['milk', 'Milk'], ['coffee', 'Coffee'],
  ['chicken', 'Chicken breast'], ['bread', 'Bread'], ['oatmeal', 'Oatmeal'], ['apple', 'Apple'],
  ['tofu', 'Tofu'], ['salmon', 'Salmon'], ['yogurt', 'Yogurt'], ['pasta', 'Pasta'],
  // Typos
  ['chiken breast', 'Chicken breast'], ['nasi lemka', 'Nasi Lemak'], ['bananna', 'Banana'],
  ['brocoli', 'Broccoli'], ['omlette', 'Omelette'], ['avacado', 'Avocado'], ['spagetti', 'Pasta'],
  ['roti cani', 'Roti Canai'], ['sandwhich', 'Sandwich'], ['buritto', 'Burrito'],
  // Plurals and sentences
  ['apples', 'Apple'], ['bananas', 'Banana'], ['a bowl of oatmeal', 'Oatmeal'],
  ['2 slices of pizza', 'Pizza slice'], ['a glass of milk', 'Milk'], ['some grilled chicken', 'Chicken breast'],
  // Half-typed
  ['roti ca', 'Roti Canai'], ['teh ta', 'Teh Tarik'], ['brocc', 'Broccoli'], ['nasi lem', 'Nasi Lemak'],
];

// [what is typed, a name that must appear somewhere in the first 5]
const TOP5 = [
  ['nasi', 'Nasi Lemak'], ['roti', 'Roti Canai'], ['mee', 'Mee '], ['egg', 'Egg (1 large)'], ['chicken 65', 'Chicken 65'],
  ['laksa', 'Asam Laksa'], ['curry', 'Curry with rice'], ['burger', 'Cheeseburger'], ['kfc', 'Zinger Burger'],
  ['mcd', 'McD '], ['subway', 'Tuna Sub'], ['tea', 'Black Tea'], ['maggi', 'Instant Noodles'],
  ['fried rice', 'Nasi Goreng'], ['ayam', 'Ayam '], ['sushi', 'Sushi'],
];

const NOTHING = ['xyzzyq', 'qqqq wwww', 'a', '   ', '1'];

await ensureFoodIndex();

console.log(`\n${C.b}── Food search proof ──${C.x}  ${C.d}(${localFoodCount()} foods indexed, ${CURATED_FOODS.length} before)${C.x}`);

section('The index holds every bundled food');
check(`search sees at least 880 foods (was ${CURATED_FOODS.length})`, localFoodCount() >= 880, String(localFoodCount()));

const starts = (name, want) => !!name && name.toLowerCase().startsWith(want.toLowerCase());
const top1Ok = (search, [q, want]) => starts(search(q)[0]?.name, want);
const top5Ok = (search, [q, want]) => search(q).slice(0, 5).some((r) => starts(r.name, want));
const newSearch = (q) => searchLocalFoods(q, 5);

section(`First result is the right food (${TOP1.length} queries)`);
const miss1 = TOP1.filter((c) => !top1Ok(newSearch, c));
for (const [q, want] of miss1) console.log(`    ${C.d}"${q}" → ${newSearch(q)[0]?.name ?? '(nothing)'}   wanted ${want}${C.x}`);
check('every query puts the right food first', miss1.length === 0, `${miss1.length} wrong`);

section(`A broad word still surfaces the staple (${TOP5.length} queries)`);
const miss5 = TOP5.filter((c) => !top5Ok(newSearch, c));
for (const [q, want] of miss5) console.log(`    ${C.d}"${q}" → ${newSearch(q).map((r) => r.name).join(' | ') || '(nothing)'}   wanted ${want}${C.x}`);
check('every broad query shows the staple in the first five', miss5.length === 0, `${miss5.length} missing`);

section('Nonsense finds nothing');
const junk = NOTHING.filter((q) => newSearch(q).length > 0);
check('no results for nonsense or a single character', junk.length === 0, junk.map((q) => `"${q}"→${newSearch(q)[0]?.name}`).join(', '));

section('Naming a food outright (the instant quick-add path)');
const named = async (q) => (await resolveLocalFood(q))?.name ?? null;
check('"nasi lemak" is Nasi Lemak', starts(await named('nasi lemak'), 'Nasi Lemak'), String(await named('nasi lemak')));
check('a typo still names it ("nasi lemka")', starts(await named('nasi lemka'), 'Nasi Lemak'), String(await named('nasi lemka')));
check('another name for it works ("telur mata")', starts(await named('telur mata'), 'Fried Egg'), String(await named('telur mata')));
check('an amount is left to the parser ("3 eggs" is not one serving of eggs)', (await named('3 eggs')) === null, String(await named('3 eggs')));
check('so is a worded amount ("two bananas", "half a pizza")',
  (await named('two bananas')) === null && (await named('half a pizza')) === null, `${await named('two bananas')} / ${await named('half a pizza')}`);
check('a list is not one food ("eggs and toast")', (await named('eggs and toast')) === null, String(await named('eggs and toast')));
check('a near-miss is not guessed across a phrase ("egg toast" is not Egg Tart)', (await named('egg toast')) === null, String(await named('egg toast')));
check('but a food whose NAME has "and" in it still resolves ("fish and chips")',
  starts(await named('fish and chips'), 'Fish and Chips'), String(await named('fish and chips')));
check('a sentence about several foods is NOT taken as one food',
  (await named('chicken rice with extra chilli and a fried egg')) === null, String(await named('chicken rice with extra chilli and a fried egg')));
check('a food we do not have is not guessed at', (await named('grandma special casserole')) === null, String(await named('grandma special casserole')));
check('sharing one word with a food is not naming it ("rice pudding")', (await named('rice pudding')) === null, String(await named('rice pudding')));

section('Amounts scale the listed serving (the offline quick-add fallback)');
const { quantityFactor, scaleToPhrase } = await import('../src/services/foodSearchIndex.ts');
const near = (a, b) => Math.abs(a - b) < 0.011;
const QTY = [
  ['3 eggs', 'Eggs (2 large eggs)', 1.5],
  ['an egg', 'Eggs (2 large eggs)', 1],            // "a" is not an amount
  ['200g chicken breast', 'Chicken breast (100g cooked)', 2],
  ['2 chicken breast', 'Chicken breast (100g cooked)', 2],
  ['6 nuggets', 'Chicken McNuggets (6 pieces)', 1],
  ['12 nuggets', 'Chicken McNuggets (6 pieces)', 2],
  ['2 sushi rolls', 'Sushi roll (8 pieces)', 2],
  ['4 pieces of sushi', 'Sushi roll (8 pieces)', 0.5],
  ['2 cups of rice', 'White rice (1 cup cooked)', 2],
  ['two bananas', 'Banana (1 medium)', 2],
  ['10 satay', 'Satay Ayam (5 sticks)', 2],
  ['2 big mac', 'Big Mac', 2],
  ['500ml milk', 'Milk (240ml)', 2.08],
  ['1 kg rice', 'Basmati Rice (100g)', 10],
  ['banana', 'Banana (1 medium)', 1],
  ['nasi lemak', 'Nasi Lemak', 1],
  ['100g rice', 'White rice (1 cup cooked)', 1],     // weight vs cup: cannot convert
  ['999 eggs', 'Eggs (2 large eggs)', 20],           // capped
];
const wrongQty = QTY.filter(([p, n, want]) => !near(quantityFactor(p, n), want));
for (const [p, n, want] of wrongQty) console.log(`    ${C.d}"${p}" vs ${n} → ${quantityFactor(p, n)}   wanted ${want}${C.x}`);
check(`${QTY.length} phrases scale to the right number of servings`, wrongQty.length === 0, `${wrongQty.length} wrong`);
const eggs = scaleToPhrase('3 eggs', { name: 'Eggs (2 large eggs)', calories: 156, protein: 13, carbs: 1, fats: 11 });
check('"3 eggs" logs 234 kcal, named as typed', eggs.calories === 234 && eggs.protein === 20 && eggs.name === '3 eggs', JSON.stringify(eggs));
const same = { name: 'Banana (1 medium)', calories: 105, protein: 1, carbs: 27, fats: 0 };
check('no amount typed: the result is returned untouched', scaleToPhrase('banana', same) === same);
// Control: without scaling, every phrase that states an amount is one serving.
const unscaledWrong = QTY.filter(([, , want]) => !near(1, want)).length;
check('control: "always one serving" (the old behaviour) gets these wrong', unscaledWrong >= 10, `${unscaledWrong} of ${QTY.length}`);

section('Serving sizes of packaged products');
const { toServing } = await import('../src/services/remoteFoodSearch.ts');
const sv = (p) => JSON.stringify(toServing(p));
check('a stated serving is used as the pack words it', sv({ serving_quantity: 20, serving_size: '1 portion (20 g)' }) === '{"grams":20,"label":"1 portion (20 g)"}', sv({ serving_quantity: 20, serving_size: '1 portion (20 g)' }));
check('a serving given as text ("330") still counts, with a label made for it', sv({ serving_quantity: '330' }) === '{"grams":330,"label":"330 g"}', sv({ serving_quantity: '330' }));
check('no serving, a pinch, a whole tub or nonsense: no serving offered',
  [undefined, null, {}, { serving_quantity: 2 }, { serving_quantity: 5000 }, { serving_quantity: 'abc' }, { serving_quantity: -30 }].every((p) => toServing(p) === null));
check('markup in a serving label is stripped', !toServing({ serving_quantity: 30, serving_size: '<b>30g</b>' }).label.includes('<'));

section('The pieces');
check('editDistance: one transposition is 1', editDistance('lemka', 'lemak', 2) === 1);
check('editDistance: one missing letter is 1', editDistance('chiken', 'chicken', 2) === 1);
check('editDistance: gives up past the budget', editDistance('banana', 'broccoli', 2) === 3);
check('stem: eggs → egg, berries → berry, glass stays', stem('eggs') === 'egg' && stem('berries') === 'berry' && stem('glass') === 'glass');
check('normalizeText strips accents and punctuation', normalizeText('Café Latté (Grande)!') === 'cafe latte grande');

section('Speed');
const qs = [...TOP1, ...TOP5].map(([q]) => q);
const t0 = performance.now();
for (let i = 0; i < 10; i++) for (const q of qs) newSearch(q);
const perQuery = (performance.now() - t0) / (10 * qs.length);
check(`a search takes under 5 ms (measured ${perQuery.toFixed(2)} ms)`, perQuery < 5);

section('Control: the previous search on the same queries');
const oldMiss1 = TOP1.filter((c) => !top1Ok(oldSearch, c)).length;
const oldMiss5 = TOP5.filter((c) => !top5Ok(oldSearch, c)).length;
console.log(`  ${C.d}previous search: ${TOP1.length - oldMiss1}/${TOP1.length} first-result, ${TOP5.length - oldMiss5}/${TOP5.length} first-five${C.x}`);
check('the previous search fails most first-result queries (so these checks can fail)', oldMiss1 > TOP1.length / 2, `${oldMiss1}/${TOP1.length} failed`);
check('the previous search fails most broad queries too', oldMiss5 > TOP5.length / 2, `${oldMiss5}/${TOP5.length} failed`);

console.log(`\n${C.b}Result: ${fail ? C.r : C.g}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
if (!fail) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
process.exit(fail ? 1 : 0);
