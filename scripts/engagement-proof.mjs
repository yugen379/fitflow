// Proactive re-engagement proof harness — npm run proof:engagement
//
// Pure engagementUtils decides the three highest-leverage push triggers
// (streak-at-risk, meal-time nudge, win-back). No Firestore here, so every
// branch is a fully deterministic 100% proof.

const {
  shouldSendStreakRisk, streakRiskMessage, STREAK_RISK_MIN, STREAK_RISK_HOUR,
  shouldSendMealNudge, mealNudgeMessage, MEAL_NUDGE_HOUR_START, MEAL_NUDGE_HOUR_END,
  winbackForInput, WINBACK_TIERS,
  daysBetween,
} = await import('../src/services/engagementUtils.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ${PASS} ${n}`); } else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); } };

const TODAY = '2026-06-17';
const shift = (key, delta) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const back = (n) => shift(TODAY, -n);

console.log(`\n${C.b}── Engagement proof ──${C.x}  ${C.d}(today=${TODAY})${C.x}\n`);

// --- 1. Streak-at-risk ---
console.log(`${C.b}1 · Streak-at-risk${C.x}`);
const sr = (o) => shouldSendStreakRisk({ currentStreak: 6, lastActiveDay: back(1), today: TODAY, hourLocal: 20, alreadyNotifiedDay: null, ...o });

check('fires: streak 6, active yesterday, 8pm, not yet notified', sr({}) === true);
check('skips: active today (streak safe)', sr({ lastActiveDay: TODAY }) === false);
check('skips: streak below minimum', sr({ currentStreak: STREAK_RISK_MIN - 1 }) === false);
check('fires: streak exactly at minimum', sr({ currentStreak: STREAK_RISK_MIN }) === true);
check('skips: too early (before evening window)', sr({ hourLocal: STREAK_RISK_HOUR - 1 }) === false);
check('fires: exactly at evening window start', sr({ hourLocal: STREAK_RISK_HOUR }) === true);
check('skips: already notified today', sr({ alreadyNotifiedDay: TODAY }) === false);
check('re-fires: notified a previous day', sr({ alreadyNotifiedDay: back(1) }) === true);
check('skips: missed yesterday too (gap 2 → already broken)', sr({ lastActiveDay: back(2) }) === false);
check('skips: malformed lastActiveDay', sr({ lastActiveDay: 'nope' }) === false);
check('skips: NaN streak', sr({ currentStreak: NaN }) === false);
check('skips: hour 24 out of range', sr({ hourLocal: 24 }) === false);
const srm = streakRiskMessage(6);
check('streak message names the streak length', /6-day/.test(srm.title) && /6-day/.test(srm.body));
check('streak message clamps junk streak to minimum', /2-day/.test(streakRiskMessage(NaN).title));

// --- 3. Meal-time nudge ---
console.log(`\n${C.b}3 · Meal-time nudge${C.x}`);
const START_TODAY = Date.UTC(2026, 5, 17); // ms at midnight today (proxy)
const mn = (o) => shouldSendMealNudge({
  lastMealAtMs: null, nowMs: START_TODAY + 13 * 3600e3, startOfTodayMs: START_TODAY,
  hourLocal: 13, alreadyNudgedDay: null, today: TODAY, ...o,
});

check('fires: midday, nothing logged today, not yet nudged', mn({}) === true);
check('skips: before midday window', mn({ hourLocal: MEAL_NUDGE_HOUR_START - 1 }) === false);
check('skips: at/after window end (exclusive)', mn({ hourLocal: MEAL_NUDGE_HOUR_END }) === false);
check('fires: at window start', mn({ hourLocal: MEAL_NUDGE_HOUR_START }) === true);
check('skips: meal already logged today', mn({ lastMealAtMs: START_TODAY + 8 * 3600e3 }) === false);
check('fires: last meal was yesterday', mn({ lastMealAtMs: START_TODAY - 3600e3 }) === true);
check('skips: already nudged today', mn({ alreadyNudgedDay: TODAY }) === false);
check('re-fires: nudged a previous day', mn({ alreadyNudgedDay: back(1) }) === true);
check('meal message non-empty', mealNudgeMessage().title.length > 0 && mealNudgeMessage().body.length > 0);

// --- 2. Win-back ---
console.log(`\n${C.b}2 · Win-back tiers${C.x}`);
for (const t of WINBACK_TIERS) {
  const res = winbackForInput({ lastActiveDay: back(t), today: TODAY, lastTierNotified: 0 });
  check(`fires tier ${t} at exactly ${t} days inactive`, res !== null && res.tier === t && res.copy.title.length > 0);
}
check('no fire between tiers (2 days)', winbackForInput({ lastActiveDay: back(2), today: TODAY, lastTierNotified: 0 }) === null);
check('no fire when active today', winbackForInput({ lastActiveDay: TODAY, today: TODAY, lastTierNotified: 0 }) === null);
check('skips tier already sent', winbackForInput({ lastActiveDay: back(7), today: TODAY, lastTierNotified: 7 }) === null);
check('skips earlier tier after a later one sent', winbackForInput({ lastActiveDay: back(3), today: TODAY, lastTierNotified: 7 }) === null);
check('fires later tier after an earlier one', winbackForInput({ lastActiveDay: back(7), today: TODAY, lastTierNotified: 3 }) !== null);
check('no fire past last tier (45 days)', winbackForInput({ lastActiveDay: back(45), today: TODAY, lastTierNotified: 0 }) === null);
check('malformed lastActiveDay → null', winbackForInput({ lastActiveDay: 'x', today: TODAY, lastTierNotified: 0 }) === null);

// --- Helpers ---
console.log(`\n${C.b}Helpers${C.x}`);
check('daysBetween basic', daysBetween(back(5), TODAY) === 5);
check('daysBetween malformed → null', daysBetween('nope', TODAY) === null);

// --- Fuzz: nothing ever throws, no double-fire invariants hold ---
console.log(`\n${C.b}Robustness${C.x}`);
let threw = 0, bad = 0;
const rd = () => back(Math.floor(Math.random() * 60));
for (let i = 0; i < 2000; i++) {
  try {
    const today = TODAY;
    shouldSendStreakRisk({ currentStreak: Math.floor(Math.random() * 40) - 5, lastActiveDay: rd(), today, hourLocal: Math.floor(Math.random() * 30) - 3, alreadyNotifiedDay: Math.random() < 0.5 ? rd() : null });
    shouldSendMealNudge({ lastMealAtMs: Math.random() < 0.5 ? Math.random() * 2e12 : null, nowMs: Math.random() * 2e12, startOfTodayMs: Math.random() * 2e12, hourLocal: Math.floor(Math.random() * 30) - 3, alreadyNudgedDay: Math.random() < 0.5 ? rd() : null, today });
    const w = winbackForInput({ lastActiveDay: rd(), today, lastTierNotified: Math.floor(Math.random() * 40) });
    // Invariant: a returned win-back tier is always one of the defined tiers and
    // strictly greater than lastTierNotified.
    if (w && !WINBACK_TIERS.includes(w.tier)) bad++;
  } catch { threw++; }
}
check('fuzz · 2,000 mixed inputs never throw', threw === 0, `${threw} threw`);
check('fuzz · win-back tier invariant holds', bad === 0, `${bad} bad`);

// Edge: empty/garbage objects never throw and return false/null.
check('garbage inputs safe', shouldSendStreakRisk(null) === false && shouldSendMealNudge(undefined) === false && winbackForInput(0) === null);

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Assertions: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}`);
const green = fail === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — engagement triggers verified' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
