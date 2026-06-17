// Retention analytics proof harness — npm run proof:retention
//
// Pure retentionUtils: streaks, rolling active counts, and D1/D7/D30 cohort
// retention must be exact for known inputs and coherent for random ones. No
// Firestore here, so this is a fully deterministic 100% proof.

const { dayKey, computeRetention, streakWithFreezes } = await import('../src/services/retentionUtils.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ${PASS} ${n}`); } else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); } };

const TODAY = '2026-06-12';
// Shift a YYYY-MM-DD key by whole days (UTC arithmetic).
const shift = (key, delta) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const back = (n) => shift(TODAY, -n);     // n days ago

console.log(`\n${C.b}── Retention proof ──${C.x}  ${C.d}(today=${TODAY})${C.x}\n`);

console.log(`${C.b}dayKey${C.x}`);
check('dayKey formats local YYYY-MM-DD', dayKey(new Date(2026, 5, 12)) === '2026-06-12', dayKey(new Date(2026, 5, 12)));
check('dayKey pads single digits', dayKey(new Date(2026, 0, 3)) === '2026-01-03');

console.log(`\n${C.b}Streaks & windows${C.x}`);
let s = computeRetention(TODAY, [back(0)], TODAY);
check('single day today → streak 1, total 1', s.currentStreak === 1 && s.longestStreak === 1 && s.totalActiveDays === 1 && s.activeLast7 === 1);

s = computeRetention(back(4), [back(4), back(3), back(2), back(1), back(0)], TODAY);
check('5 consecutive ending today → streak 5', s.currentStreak === 5 && s.longestStreak === 5 && s.activeLast7 === 5);

s = computeRetention(back(10), [back(10), back(9), back(1), back(0)], TODAY);
check('gap then 2 ending today → current 2, longest 2', s.currentStreak === 2 && s.longestStreak === 2 && s.totalActiveDays === 4);

s = computeRetention(back(5), [back(5), back(4), back(3)], TODAY);
check('longest run is historical (3) not current (0)', s.longestStreak === 3 && s.currentStreak === 0);

s = computeRetention(back(3), [back(3), back(2), back(1)], TODAY);
check('active yesterday not today → grace streak counts (3)', s.currentStreak === 3);

s = computeRetention(back(3), [back(3), back(2)], TODAY);
check('missed today AND yesterday → current streak 0', s.currentStreak === 0);

s = computeRetention(back(40), [back(40), back(20), back(0)], TODAY);
check('activeLast7 only counts recent (1)', s.activeLast7 === 1);
check('activeLast30 window (2)', s.activeLast30 === 2);

console.log(`\n${C.b}D1 / D7 / D30 cohort retention${C.x}`);
s = computeRetention(back(0), [back(0)], TODAY);
check('signup today, only today → d1/d7/d30 all false', s.d1 === false && s.d7 === false && s.d30 === false);

s = computeRetention(back(10), [back(10), back(9)], TODAY);  // returned 1 day after signup
check('returned 1 day after signup → d1 true, d7/d30 false', s.d1 === true && s.d7 === false && s.d30 === false);

s = computeRetention(back(10), [back(10), back(3)], TODAY);  // offset 7
check('returned 7 days after signup → d1 & d7 true, d30 false', s.d1 && s.d7 && !s.d30);

s = computeRetention(back(40), [back(40), back(5)], TODAY);  // offset 35
check('returned 30+ days after signup → d1/d7/d30 all true', s.d1 && s.d7 && s.d30);
check('daysSinceSignup computed', s.daysSinceSignup === 40);

console.log(`\n${C.b}Robustness${C.x}`);
s = computeRetention(TODAY, ['garbage', '2026-13-99', '2026-02-31', back(0), back(0), back(1)], TODAY);
check('ignores malformed + dedupes (2 valid days)', s.totalActiveDays === 2 && s.currentStreak === 2);
s = computeRetention(TODAY, [], TODAY);
check('empty active days → all zero', s.totalActiveDays === 0 && s.currentStreak === 0 && s.longestStreak === 0 && s.activeLast7 === 0);
s = computeRetention('not-a-date', [back(0)], 'also-bad');
check('bad signup/today strings → no throw, valid', typeof s.currentStreak === 'number' && s.totalActiveDays === 1);

// Fuzz: random day sets must stay coherent and never throw.
let fuzzBad = 0, fuzzThrew = 0;
for (let i = 0; i < 1000; i++) {
  const n = Math.floor(Math.random() * 40);
  const days = Array.from({ length: n }, () => back(Math.floor(Math.random() * 60)));
  try {
    const st = computeRetention(back(50), days, TODAY);
    const coherent =
      st.currentStreak <= st.longestStreak &&
      st.longestStreak <= st.totalActiveDays &&
      st.activeLast7 <= 7 && st.activeLast7 <= st.activeLast30 &&
      st.activeLast30 <= 30 && st.activeLast30 <= st.totalActiveDays &&
      st.totalActiveDays <= new Set(days).size;
    if (!coherent) fuzzBad++;
  } catch { fuzzThrew++; }
}
check('fuzz · 1,000 random sets never throw', fuzzThrew === 0, `${fuzzThrew} threw`);
check('fuzz · 1,000 stats coherent', fuzzBad === 0, `${fuzzBad} incoherent`);

// --- Streak freeze (Feature 5) — bridges gaps without inflating the count ---
console.log(`\n${C.b}Streak freeze${C.x}`);
// No freezes → must EXACTLY equal computeRetention().currentStreak (safe drop-in).
let mismatch = 0;
for (let i = 0; i < 500; i++) {
  const n = Math.floor(Math.random() * 20);
  const days = Array.from({ length: n }, () => back(Math.floor(Math.random() * 30)));
  const a = computeRetention(back(40), days, TODAY).currentStreak;
  const b = streakWithFreezes(days, [], TODAY);
  if (a !== b) mismatch++;
}
check('no-freeze parity with computeRetention (500 random)', mismatch === 0, `${mismatch} mismatched`);

check('freeze bridges a missed day: active D-2,today + freeze D-1 → streak 2',
  streakWithFreezes([back(2), back(0)], [back(1)], TODAY) === 2);
check('freeze day itself does NOT inflate the count',
  streakWithFreezes([back(2), back(1), back(0)], [back(3)], TODAY) === 3);
check('freeze today preserves yesterday-anchored streak',
  streakWithFreezes([back(2), back(1)], [back(0)], TODAY) === 2);
check('freeze cannot resurrect an already-dead streak (gap of 2, no freeze)',
  streakWithFreezes([back(3), back(2)], [], TODAY) === 0);
check('two freezes bridge two separate gaps',
  streakWithFreezes([back(4), back(2), back(0)], [back(3), back(1)], TODAY) === 3);
check('freeze math never throws on garbage',
  (() => { try { streakWithFreezes('x', null, 'y'); return true; } catch { return false; } })());

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Assertions: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}`);
const green = fail === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — retention analytics verified' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
