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
ok(`>= 350 USDA entries`, INGREDIENTS_USDA.length >= 350, `${INGREDIENTS_USDA.length}`);
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
];
for (const [q, name, lo, hi] of spot) {
  const hit = lookupOffline(q);
  const kcal = hit?.per100?.kcal;
  ok(`"${q}" -> ${name} ${lo}-${hi} kcal`, hit?.matched === name && kcal >= lo && kcal <= hi, `${hit?.matched ?? 'null'} ${kcal ?? ''}`);
}
// CONTROL: "beef" must not silently become jerky; "milk" not milk powder.
ok('CONTROL: "beef" is not beef jerky', lookupOffline('beef')?.matched !== 'Beef jerky', lookupOffline('beef')?.matched);
ok('CONTROL: "milk" is not milk powder', lookupOffline('milk')?.per100?.kcal < 100, `${lookupOffline('milk')?.matched}`);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
