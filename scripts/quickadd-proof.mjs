// Quick-add proof harness — npm run proof:quickadd
//
// Part A: pure quickAddUtils (splitPhrases / normalizeItem / computeTotals /
//         buildResult) — deterministic assertions + structural validity.
// Part B: live parseQuickAdd (geminiService) — never throws, always a valid
//         result, totals == sum of items; reports AI vs deterministic fallback.

import fs from 'node:fs';
try {
  const envFile = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i === -1) continue;
    const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* fallback-only */ }
const hasKey = !!process.env.GEMINI_API_KEY;

const { splitPhrases, normalizeItem, computeTotals, buildResult } = await import('../src/services/quickAddUtils.ts');
const { parseQuickAdd } = await import('../src/services/geminiService.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ${PASS} ${n}`); } else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); } };

function validResult(r) {
  if (!r || typeof r !== 'object') return 'not object';
  if (!Array.isArray(r.items)) return 'items not array';
  if (!['AI', 'local', 'mixed', 'empty'].includes(r.source)) return `bad source ${r.source}`;
  if (!r.totals || typeof r.totals !== 'object') return 'no totals';
  for (const f of ['calories', 'protein', 'carbs', 'fats']) {
    if (typeof r.totals[f] !== 'number' || !Number.isFinite(r.totals[f]) || r.totals[f] < 0) return `bad total ${f}`;
  }
  for (const it of r.items) {
    if (typeof it.name !== 'string' || !it.name.trim()) return 'bad item name';
    for (const f of ['calories', 'protein', 'carbs', 'fats']) {
      if (typeof it[f] !== 'number' || !Number.isFinite(it[f]) || it[f] < 0) return `bad item ${f}`;
    }
    if (it.calories <= 0) return 'zero-cal item leaked';
  }
  if (r.items.length === 0 && r.source !== 'empty') return 'empty mismatch';
  const sum = r.items.reduce((a, i) => a + i.calories, 0);
  if (r.totals.calories !== sum) return `totals(${r.totals.calories})!=sum(${sum})`;
  return null;
}

console.log(`\n${C.b}── Quick-add proof ──${C.x}`);
console.log(`${C.d}Gemini key: ${hasKey ? C.g + 'present' : C.y + 'absent'}${C.x}`);
console.log(`\n${C.b}Part A · Pure helpers${C.x}`);

check('split "2 eggs, toast and a banana" → 3', splitPhrases('2 eggs, toast and a banana').length === 3);
check('split "" → 0', splitPhrases('').length === 0);
check('split "   " → 0', splitPhrases('   ').length === 0);
check('split "chicken; rice + broccoli" → 3', splitPhrases('chicken; rice + broccoli').length === 3);
check('does NOT split on "with" ("oatmeal with banana" → 1)', splitPhrases('oatmeal with banana').length === 1);
check('dedupes ("eggs and eggs" → 1)', splitPhrases('eggs and eggs').length === 1);
check('caps at 12 phrases', splitPhrases(Array.from({ length: 30 }, (_, i) => `food${i}`).join(' and ')).length === 12);

const ni1 = normalizeItem({ name: 'X', calories: -5, protein: 'bad', carbs: NaN, fats: Infinity });
check('normalizeItem clamps junk to 0', ni1.calories === 0 && ni1.protein === 0 && ni1.carbs === 0 && ni1.fats === 0);
check('normalizeItem defaults missing name', normalizeItem({}).name === 'Food');
check('normalizeItem rounds (12.6→13)', normalizeItem({ name: 'a', calories: 12.6 }).calories === 13);

check('computeTotals sums', (() => { const t = computeTotals([{ calories: 10, protein: 1, carbs: 2, fats: 3 }, { calories: 20, protein: 4, carbs: 5, fats: 6 }]); return t.calories === 30 && t.protein === 5 && t.carbs === 7 && t.fats === 9; })());
check('buildResult([]) → empty', (() => { const r = buildResult([]); return r.source === 'empty' && r.items.length === 0 && validResult(r) === null; })());
check('buildResult drops zero-cal items → empty', (() => { const r = buildResult([{ name: 'a', calories: 0 }]); return r.source === 'empty' && validResult(r) === null; })());
check('buildResult valid AI item', (() => { const r = buildResult([{ name: 'Eggs', calories: 156, protein: 13, carbs: 1, fats: 11, source: 'AI' }], 'AI'); return r.source === 'AI' && r.items.length === 1 && validResult(r) === null; })());

// fuzz buildResult with random junk → always valid
let fuzzBad = 0, fuzzThrew = 0;
for (let i = 0; i < 500; i++) {
  const n = Math.floor(Math.random() * 6);
  const items = Array.from({ length: n }, () => ({
    name: Math.random() < 0.2 ? 123 : 'food ' + Math.random().toString(36).slice(2, 6),
    calories: Math.random() < 0.3 ? (Math.random() < 0.5 ? -10 : NaN) : Math.floor(Math.random() * 800),
    protein: Math.random() * 50, carbs: Math.random() * 80, fats: Math.random() * 40,
  }));
  try { if (validResult(buildResult(items)) !== null) fuzzBad++; } catch { fuzzThrew++; }
}
check('fuzz · 500 buildResult never throw', fuzzThrew === 0, `${fuzzThrew} threw`);
check('fuzz · 500 buildResult always valid', fuzzBad === 0, `${fuzzBad} invalid`);

console.log(`\n${C.b}Part B · Live parseQuickAdd${C.x}`);
console.log(`  ${'INPUT'.padEnd(42)}${'VALID'.padEnd(7)}${'ITEMS'.padEnd(7)}${'SRC'.padEnd(8)}TIME`);
console.log('  ' + '─'.repeat(78));

const inputs = [
  ['2 eggs and white rice and broccoli', true],
  ['chicken breast, sweet potato, salad', true],
  ['banana', true],
  ['a bowl of oatmeal with banana', true],
  ['protein shake and a protein bar', true],
  ['asdfghjkl qwerty zxcvb', false],     // unknown — may resolve to nothing, still valid
  ['', false],
  ['   ', false],
];

let liveErr = 0, aiN = 0, fbN = 0, emptyN = 0;
for (const [text, expectFood] of inputs) {
  const t0 = Date.now();
  let r, threw = null;
  try { r = await parseQuickAdd(text); } catch (e) { threw = String(e?.message || e); }
  const ms = Date.now() - t0;
  if (threw) { liveErr++; console.log(`  ${JSON.stringify(text).slice(0, 40).padEnd(42)}${FAIL.padEnd(7)}${'-'.padEnd(7)}${(C.r + 'THREW' + C.x)}  ${ms}ms`); continue; }
  const v = validResult(r);
  if (v) liveErr++;
  // For known-food inputs we expect at least one item (local DB guarantees it even if AI is quota'd).
  const itemsOk = expectFood ? r.items.length >= 1 : true;
  if (!itemsOk) liveErr++;
  if (text.trim() === '') { if (r.source !== 'empty') liveErr++; emptyN++; }
  else if (r.source === 'AI') aiN++; else if (r.source !== 'empty') fbN++; else emptyN++;
  const validTag = v ? FAIL : (itemsOk ? PASS : FAIL);
  const srcCol = r.source === 'AI' ? `${C.c}AI${C.x}    ` : r.source === 'empty' ? `${C.d}empty${C.x} ` : `${C.d}${r.source}${C.x}`.padEnd(8 + 8);
  console.log(`  ${JSON.stringify(text).slice(0, 40).padEnd(42)}${validTag.padEnd(7)}${String(r.items.length).padEnd(7)}${srcCol.padEnd(8)}${ms}ms`);
  if (v) console.log(`       ${C.r}invalid: ${v}${C.x}`);
}

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Part A assertions : ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}`);
console.log(`  Part B live errors: ${liveErr === 0 ? C.g : C.r}${liveErr}${C.x}`);
console.log(`  Part B source     : ${C.c}${aiN} AI${C.x} / ${C.d}${fbN} fallback / ${emptyN} empty${C.x}`);
const green = fail === 0 && liveErr === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — quick-add verified' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
