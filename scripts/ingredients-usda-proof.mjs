// Offline proof for the USDA-built ingredient table (src/data/ingredientsUsda.ts).
// Loaded with tsx, the same way scripts/meal-math-proof.mjs loads mealMath.
//   npm run proof:ingredients
import { INGREDIENTS_USDA, USDA_ATWATER_EXEMPT } from '../src/data/ingredientsUsda.ts';
import { INGREDIENTS_HAND, INGREDIENTS_100G } from '../src/data/ingredients100g.ts';
import { lookupOffline } from '../src/lib/mealMath.ts';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const norm = (s) => s.toLowerCase().trim();

// --- 1. Size and wiring ------------------------------------------------------------
ok(`>= 800 USDA entries`, INGREDIENTS_USDA.length >= 800, `${INGREDIENTS_USDA.length}`);
ok('lookup table = hand entries then USDA entries', INGREDIENTS_100G.length === INGREDIENTS_HAND.length + INGREDIENTS_USDA.length
  && INGREDIENTS_100G[0] === INGREDIENTS_HAND[0] && INGREDIENTS_100G[INGREDIENTS_HAND.length] === INGREDIENTS_USDA[0]);

// --- 2. No duplicate names/aliases: a USDA key must not collide with any other key --
const keyCount = (rows) => {
  const owner = new Map(); const dups = [];
  for (const r of rows) for (const k of new Set([r.name, ...(r.aliases || [])].map(norm))) {
    if (owner.has(k) && owner.get(k) !== r.name) dups.push(`${k} (${owner.get(k)} / ${r.name})`); else owner.set(k, r.name);
  }
  return dups;
};
// The hand table has a few pre-existing internal overlaps (e.g. "spinach"); only
// collisions that involve a USDA entry are this table's responsibility.
const handDups = new Set(keyCount(INGREDIENTS_HAND));
const allDups = keyCount([...INGREDIENTS_HAND, ...INGREDIENTS_USDA]).filter((d) => !handDups.has(d));
ok('no USDA name/alias collides across both tables', allDups.length === 0, allDups.slice(0, 5).join('; '));
if (handDups.size) console.log(`note: pre-existing hand-table overlaps (not USDA): ${[...handDups].join('; ')}`);
// CONTROL: the check must catch an injected collision.
ok('CONTROL: an injected alias collision is caught', keyCount([...INGREDIENTS_HAND, ...INGREDIENTS_USDA, { name: 'Bogus', aliases: ['white rice'] }]).filter((d) => !handDups.has(d)).length === 1);

// --- 3. Ranges and Atwater --------------------------------------------------------
const bad = INGREDIENTS_USDA.filter((r) => !(r.calories >= 0 && r.calories <= 900) || [r.protein, r.carbs, r.fats].some((x) => !(x >= 0 && x <= 100)));
ok('every kcal 0-900, macros 0-100 g', bad.length === 0, bad.map((r) => r.name).join(', '));
const atw = (r) => 4 * r.protein + 4 * r.carbs + 9 * r.fats;
const exempt = new Set(USDA_ATWATER_EXEMPT);
const off = INGREDIENTS_USDA.filter((r) => !exempt.has(r.name) && Math.abs(atw(r) - r.calories) > 0.25 * r.calories);
ok('Atwater within 25% except the flagged list', off.length === 0, off.map((r) => `${r.name} ${r.calories}/${Math.round(atw(r))}`).join(', '));
ok('flagged list is small (<= 20) and names real entries', exempt.size <= 20 && [...exempt].every((n) => INGREDIENTS_USDA.some((r) => r.name === n)), `${exempt.size}: ${[...exempt].join(', ')}`);
ok('CONTROL: Atwater check catches kJ-as-kcal (x4.184)', Math.abs(atw(INGREDIENTS_USDA[0]) - INGREDIENTS_USDA[0].calories * 4.184) > 0.25 * INGREDIENTS_USDA[0].calories * 4.184);

// --- 4. Spot checks through the real lookup --------------------------------------
const spot = [
  // [query, expected matched name or null, kcal lo, kcal hi]
  ['cooked quinoa', 'Quinoa', 110, 130],
  ['chapati', 'Chapati', 280, 320],          // hand entry wins
  ['salmon', 'Salmon', 180, 220],            // hand entry (cooked)
  ['tortilla', 'Tortilla', 290, 330],        // hand flour tortilla
  ['corn tortilla', 'Corn tortilla', 200, 230],
  ['cheddar cheese', 'Cheddar cheese', 390, 420],
  ['mango', 'Mango', 55, 70],
  ['durian', 'Durian', 140, 155],
  ['cola', 'Soft drink', 35, 45],
  ['white rice', 'White rice', 130, 130],    // hand entry must still win
  ['black beans', 'Black beans', 120, 145],
  ['bagel', 'Bagel', 250, 280],
  ['lean ground beef', 'Lean ground beef', 210, 250],
  ['mozzarella', 'Mozzarella', 280, 310],
  ['lychee', 'Lychee', 60, 72],
  ['jackfruit', 'Jackfruit', 90, 100],
  ['almonds', 'Almonds', 570, 590],
  ['cheese pizza', 'Cheese pizza', 250, 280],
  ['pad thai', 'Pad thai', 140, 170],
  ['red wine', 'Red wine', 80, 90],
  ['oyster sauce', 'Oyster sauce', 45, 60],
  ['beef jerky', 'Beef jerky', 380, 430],
  // Regional dishes (USDA FNDDS / SR Legacy restaurant foods), as eaten.
  ['sambar', 'Sambar', 80, 95],                          // India
  ['veg biryani', 'Vegetable biryani', 100, 120],
  ['masala chai', 'Masala chai', 45, 60],
  ['pulao', 'Rice pilaf', 125, 150],
  ['dal rice', 'Lentil curry with rice', 110, 125],
  ['arroz con pollo', 'Arroz con pollo', 160, 190],      // Latin America
  ['pupusa de queso', 'Cheese pupusa', 240, 270],
  ['pozole', 'Pozole', 35, 55],
  ['feijoada', 'Black beans with meat', 165, 190],
  ['dolma', 'Stuffed grape leaves', 155, 180],           // Middle East / Mediterranean
  ['lamb kebab', 'Lamb kebab', 150, 175],
  ['falafel wrap', 'Falafel sandwich', 250, 280],
  ['pain au chocolat', 'Chocolate croissant', 400, 440], // Europe
  ['spaghetti bolognese', 'Spaghetti bolognese', 110, 135],
  ['latkes', 'Potato pancake', 185, 210],
  ['risotto', 'Creamy cheese rice', 155, 180],
  ['tonkotsu ramen', 'Tonkotsu ramen', 115, 140],        // East / Southeast Asia
  ['vegetarian pho', 'Vegetarian pho', 30, 45],
  ['tteokbokki', 'Tteokbokki', 120, 145],
  ['chicken adobo', 'Adobo with rice', 170, 195],
  // US restaurant chains (SR Legacy branded rows).
  ['big mac', "McDonald's Big Mac", 245, 270],
  ['whopper', 'Burger King Whopper', 220, 245],
  ['mcnuggets', "McDonald's Chicken McNuggets", 290, 315],
  ['kfc drumstick', 'KFC Original Recipe drumstick', 225, 255],
  ['subway tuna sub', 'Subway Tuna sub', 210, 235],
];
const spotOk = (q, name, lo, hi) => { const hit = lookupOffline(q); const kcal = hit?.per100?.kcal; return hit?.matched === name && kcal >= lo && kcal <= hi; };
for (const [q, name, lo, hi] of spot) {
  const hit = lookupOffline(q);
  ok(`"${q}" -> ${name} ${lo}-${hi} kcal`, spotOk(q, name, lo, hi), `${hit?.matched ?? 'null'} ${hit?.per100?.kcal ?? ''}`);
}
// CONTROL: the spot check must fail on a wrong name and on a wrong kcal band.
ok('CONTROL: spot check fails on the wrong dish', !spotOk('sambar', 'Upma', 80, 95));
ok('CONTROL: spot check fails on a wrong kcal band (kJ-sized)', !spotOk('big mac', "McDonald's Big Mac", 1000, 1100));
// CONTROL: "beef" must not silently become jerky; "milk" not milk powder.
ok('CONTROL: "beef" is not beef jerky', lookupOffline('beef')?.matched !== 'Beef jerky', lookupOffline('beef')?.matched);
ok('CONTROL: "milk" is not milk powder', lookupOffline('milk')?.per100?.kcal < 100, `${lookupOffline('milk')?.matched}`);
// Generic words must not land on a chain item or an unrelated dish through a new alias.
const notTo = [
  ['chicken chop', /lo mein/i], ['chicken teriyaki', /subway/i], ['cold cuts', /subway/i],
  ['meatballs', /sandwich|sub$/i], ['sundae', /mcdonald/i], ['fried chicken breast', /popeyes|kfc/i],
];
for (const [q, bad] of notTo) ok(`"${q}" does not land on ${bad}`, !bad.test(lookupOffline(q)?.matched ?? ''), lookupOffline(q)?.matched ?? 'null');
ok('CONTROL: that check catches a real chain hit ("big mac" IS McDonald\'s)', /mcdonald/i.test(lookupOffline('big mac')?.matched ?? ''));

// --- 5. Restaurant-chain serving weights (USDA portion, grams in one item) ---------
const CHAIN = /^(McDonald's|Burger King|KFC|Taco Bell|Subway|Pizza Hut|Domino's|Little Caesars|Papa John's|Wendy's|Chick-fil-A|Popeyes|Arby's) /;
const chains = INGREDIENTS_USDA.filter((r) => CHAIN.test(r.name));
const withServing = INGREDIENTS_USDA.filter((r) => r.servingG != null);
ok('>= 80 chain items, chain name in the food name', chains.length >= 80, `${chains.length}`);
ok('servingG only on chain rows', withServing.every((r) => CHAIN.test(r.name)), withServing.filter((r) => !CHAIN.test(r.name)).map((r) => r.name).join(', '));
ok('every chain row but popcorn chicken has a servingG', chains.filter((r) => r.servingG == null).map((r) => r.name).join() === 'KFC Popcorn Chicken', chains.filter((r) => r.servingG == null).map((r) => r.name).join(', '));
ok('every servingG is 10-1500 g', withServing.every((r) => r.servingG >= 10 && r.servingG <= 1500));
const serving = (n) => INGREDIENTS_USDA.find((r) => r.name === n)?.servingG;
const servingSpot = [
  ["McDonald's Big Mac", 219, 219], ['Burger King Whopper', 291, 291],
  ["McDonald's Chicken McNuggets", 14, 18],       // one piece: "6 mcnuggets" counts pieces
  ['Subway Tuna sub', 200, 260],                  // a 6-inch sub, not one inch of it
  ['KFC Original Recipe drumstick', 70, 80],      // with skin and breading, as the row is
  ["Pizza Hut pepperoni pizza, pan", 100, 125],   // one slice
  ["McDonald's french fries", 117, 117],          // medium
];
for (const [n, lo, hi] of servingSpot) ok(`servingG ${n} = ${lo === hi ? lo : `${lo}-${hi}`} g`, serving(n) >= lo && serving(n) <= hi, `${serving(n)}`);
// CONTROLS: the per-inch Subway weight (34 g) and the skinless KFC drumstick (57 g) would fail these bands.
ok('CONTROL: a per-inch sub weight fails the 6-inch band', !(34 >= 200 && 34 <= 260));
ok('CONTROL: a skinless drumstick weight fails the with-skin band', !(57 >= 70 && 57 <= 80));
ok('CONTROL: a generic dish has no servingG', serving('Hamburger') == null && serving('Cheese pizza') == null);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
