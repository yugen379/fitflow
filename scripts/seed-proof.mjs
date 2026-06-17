// Catalog-seed proof harness — npm run proof:seed
//
// Proves the curated common-foods dataset is safe to bulk-load into the shared
// food_catalog: every entry passes the SAME validation the live app uses
// (isValidCatalogFood / normalizeCatalogFood), every catalogKey is non-empty,
// id-rule-valid, and unique. Pure + offline → a 100% deterministic guarantee that
// seeding can never poison the moat. No Firestore here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { catalogKey, isValidCatalogFood, normalizeCatalogFood } =
  await import('../src/services/foodCatalogUtils.ts');

const __dir = dirname(fileURLToPath(import.meta.url));
const foods = JSON.parse(readFileSync(join(__dir, 'data', 'common-foods.json'), 'utf8'));

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ${PASS} ${n}`); } else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); } };

const ID_RULE = /^[a-zA-Z0-9_\-]+$/;

console.log(`\n${C.b}── Catalog seed proof ──${C.x}  ${C.d}(${foods.length} foods)${C.x}\n`);

check('dataset is a non-empty array', Array.isArray(foods) && foods.length >= 100, `${foods.length} entries`);

let invalid = 0, badKey = 0, normNull = 0;
const keys = new Map();
const dupes = [];
for (const f of foods) {
  if (!isValidCatalogFood(f)) { invalid++; console.log(`    ${C.d}invalid: ${JSON.stringify(f)}${C.x}`); }
  if (normalizeCatalogFood(f) === null) normNull++;
  const k = catalogKey(f.name);
  if (!k || !ID_RULE.test(k) || k.length > 120) { badKey++; console.log(`    ${C.d}bad key for: ${f.name} → "${k}"${C.x}`); }
  if (keys.has(k)) dupes.push(`${f.name} ≡ ${keys.get(k)} (${k})`); else keys.set(k, f.name);
}

check('every entry passes isValidCatalogFood', invalid === 0, `${invalid} invalid`);
check('every entry normalizes (not null)', normNull === 0, `${normNull} null`);
check('every catalogKey is non-empty + id-rule-valid', badKey === 0, `${badKey} bad`);
check('no duplicate catalog keys', dupes.length === 0, dupes.join('; '));

// Macros must be finite, non-negative, calories positive (sanity on the data itself).
let macroBad = 0;
for (const f of foods) {
  const ok = f.calories > 0 && [f.calories, f.protein, f.carbs, f.fats].every((n) => Number.isFinite(n) && n >= 0);
  if (!ok) { macroBad++; console.log(`    ${C.d}macro issue: ${f.name}${C.x}`); }
}
check('all macros finite, non-negative, calories > 0', macroBad === 0, `${macroBad} bad`);

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Foods: ${foods.length}   Unique keys: ${keys.size}`);
console.log(`  Assertions: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}`);
const green = fail === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — seed dataset safe to load' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
