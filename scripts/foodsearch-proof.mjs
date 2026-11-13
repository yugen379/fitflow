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
  ['nasi', 'Nasi Lemak'], ['roti', 'Roti Canai'], ['mee', 'Mee Goreng Mamak'], ['egg', 'Egg (1 large)'], ['chicken 65', 'Chicken 65'],
  ['laksa', 'Curry Laksa'], ['curry', 'Curry with rice'], ['burger', 'Cheeseburger'], ['kfc', 'Zinger Burger'],
  ['mcd', 'Bubur Ayam McD'], ['subway', 'Tuna Sub'], ['tea', 'Black Tea'], ['maggi', 'Instant Noodles'],
  ['fried rice', 'Nasi Goreng'], ['ayam', 'Ayam Kicap'], ['sushi', 'Sushi'],
];

const NOTHING = ['xyzzyq', 'qqqq wwww', 'a', '   ', '1'];

await ensureFoodIndex();

console.log(`\n${C.b}── Food search proof ──${C.x}  ${C.d}(${localFoodCount()} foods indexed, ${CURATED_FOODS.length} before)${C.x}`);

section('The index holds every bundled food');
check(`search sees at least 640 foods (was ${CURATED_FOODS.length})`, localFoodCount() >= 640, String(localFoodCount()));

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
check('a sentence about several foods is NOT taken as one food',
  (await named('chicken rice with extra chilli and a fried egg')) === null, String(await named('chicken rice with extra chilli and a fried egg')));
check('a food we do not have is not guessed at', (await named('grandma special casserole')) === null, String(await named('grandma special casserole')));
check('sharing one word with a food is not naming it ("rice pudding")', (await named('rice pudding')) === null, String(await named('rice pudding')));

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
