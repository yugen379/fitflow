// Food catalog proof harness — npm run proof:catalog
//
// Pure foodCatalogUtils: the document key must be deterministic, ASCII-only, and
// always match the Firestore id rule (^[a-zA-Z0-9_\-]+$); validation must reject
// garbage so the shared DB can't be poisoned. No Firestore I/O here (that layer
// just calls these), so this is a fully deterministic 100% proof.

const { catalogKey, isValidCatalogFood, normalizeCatalogFood } = await import('../src/services/foodCatalogUtils.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ${PASS} ${n}`); } else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); } };

const ID_RE = /^[a-zA-Z0-9_\-]+$/;   // Firestore document-id rule used in firestore.rules

console.log(`\n${C.b}── Food catalog proof ──${C.x}\n`);
console.log(`${C.b}Key generation${C.x}`);
check('"Oatmeal (1 bowl)" → "oatmeal"', catalogKey('Oatmeal (1 bowl)') === 'oatmeal', `got "${catalogKey('Oatmeal (1 bowl)')}"`);
check('"Chicken Breast" → "chicken-breast"', catalogKey('Chicken Breast') === 'chicken-breast');
check('strips accents ("Café au lait" → "cafe-au-lait")', catalogKey('Café au lait') === 'cafe-au-lait', `got "${catalogKey('Café au lait')}"`);
check('collapses junk ("!!!@@@" → "")', catalogKey('!!!@@@') === '');
check('empty/garbage names → ""', catalogKey('') === '' && catalogKey(null) === '' && catalogKey(undefined) === '');
check('deterministic (same in → same out)', catalogKey('Greek Yogurt 0%') === catalogKey('Greek Yogurt 0%'));
check('length capped ≤120', catalogKey('a'.repeat(500)).length <= 120);

// Every non-empty key must satisfy the Firestore id rule.
const names = ['Nutella', 'Coca-Cola', 'Ben & Jerry\'s', 'Protein Shake (500ml)', 'Crème Brûlée', '高蛋白', 'PB&J', '  spaced  ', '100% Whey'];
let keyBad = 0;
for (const nm of names) { const k = catalogKey(nm); if (k !== '' && !ID_RE.test(k)) { keyBad++; console.log(`     ${C.r}"${nm}" → "${k}" violates id rule${C.x}`); } }
check('all sample keys satisfy Firestore id rule', keyBad === 0);

console.log(`\n${C.b}Validation${C.x}`);
const good = { name: 'Oatmeal', calories: 158, protein: 6, carbs: 27, fats: 3 };
check('accepts a valid food', isValidCatalogFood(good) === true);
check('rejects calories <= 0', isValidCatalogFood({ ...good, calories: 0 }) === false);
check('rejects negative macro', isValidCatalogFood({ ...good, protein: -1 }) === false);
check('rejects NaN calories', isValidCatalogFood({ ...good, calories: NaN }) === false);
check('rejects missing name', isValidCatalogFood({ ...good, name: '' }) === false);
check('rejects name with no key chars', isValidCatalogFood({ ...good, name: '!!!' }) === false);

console.log(`\n${C.b}Normalization${C.x}`);
const norm = normalizeCatalogFood({ name: '  Greek Yogurt  ', calories: 99.6, protein: 17.2, carbs: 6, fats: 0, brand: 'Fage' });
check('normalizes + rounds valid food', !!norm && norm.name === 'Greek Yogurt' && norm.calories === 100 && norm.protein === 17 && norm.brand === 'Fage');
check('returns null for invalid', normalizeCatalogFood({ name: 'x', calories: 0 }) === null && normalizeCatalogFood(null) === null);
check('drops empty brand', !('brand' in (normalizeCatalogFood({ name: 'Apple', calories: 95, protein: 0, carbs: 25, fats: 0, brand: '   ' }) || {})));

// Fuzz: random names never throw and always yield a valid key or ''.
let fuzzBad = 0, fuzzThrew = 0;
const chars = 'abcĀÉ012 (),-&%/\'!@#高蛋白';
for (let i = 0; i < 1000; i++) {
  const len = Math.floor(Math.random() * 30);
  let s = '';
  for (let j = 0; j < len; j++) s += chars[Math.floor(Math.random() * chars.length)];
  try { const k = catalogKey(s); if (k !== '' && (!ID_RE.test(k) || k.length > 120)) fuzzBad++; } catch { fuzzThrew++; }
}
check('fuzz · 1,000 names never throw', fuzzThrew === 0, `${fuzzThrew} threw`);
check('fuzz · 1,000 keys valid-or-empty', fuzzBad === 0, `${fuzzBad} invalid`);

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Assertions: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}`);
const green = fail === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — food catalog verified' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
