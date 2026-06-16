// Subscription / entitlement proof harness — npm run proof:subscription
//
// Pure logic only (no Firebase, no Stripe network): the cardless-trial +
// paid-subscription entitlement state machine (computeEntitlement) and the
// nutrition-targets engine (computeDailyTargets), both exercised deterministically
// against a fixed clock. This is the gate that guarantees "Pro access" can never
// be granted or revoked incorrectly.

const { computeEntitlement, toMillis, TRIAL_DAYS } = await import('../src/lib/billing.ts');
const { computeDailyTargets, baseCaloriesFor } = await import('../src/lib/nutritionTargets.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15); // 2026-06-15
const ent = (p) => computeEntitlement(p, NOW, false);

console.log(`\n${C.b}── Subscription / entitlement proof ──${C.x}  ${C.d}(trial=${TRIAL_DAYS}d)${C.x}\n`);

console.log(`${C.b}Launch mode & empty${C.x}`);
let e = computeEntitlement(null, NOW, true);
check('freeForAll → isPro, source launch', e.isPro && e.source === 'launch' && e.status === 'active');
e = computeEntitlement({ subscriptionType: 'free' }, NOW, true);
check('freeForAll overrides everything', e.isPro && e.source === 'launch');
e = ent(null);
check('null profile (paywall on) → not Pro', e.isPro === false && e.status === 'free' && e.source === 'none');
e = ent({ subscriptionType: 'free' });
check('free, no trial → not Pro', e.isPro === false && e.status === 'free');

console.log(`\n${C.b}Cardless trial window${C.x}`);
e = ent({ trialStartedAt: NOW, subscriptionType: 'free' });
check('fresh trial → Pro, 6 days left, source trial', e.isPro && e.trialDaysLeft === 6 && e.source === 'trial' && e.status === 'trialing');
e = ent({ trialStartedAt: NOW - 3 * DAY });
check('trial day 3 → Pro, 3 days left', e.isPro && e.trialDaysLeft === 3);
e = ent({ trialStartedAt: NOW - 5 * DAY });
check('trial last day → Pro, 1 day left', e.isPro && e.trialDaysLeft === 1);
e = ent({ trialStartedAt: NOW - 6 * DAY });
check('trial exactly expired (6d) → not Pro, status expired', e.isPro === false && e.status === 'expired' && e.trialDaysLeft === 0);
e = ent({ trialStartedAt: NOW - 30 * DAY });
check('trial long expired → not Pro, expired', e.isPro === false && e.status === 'expired');

console.log(`\n${C.b}Paid subscription${C.x}`);
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'active', plan: 'yearly', currentPeriodEnd: NOW + 20 * DAY });
check('active paid → Pro, source paid, renews set', e.isPro && e.source === 'paid' && e.status === 'active' && e.renewsAt === NOW + 20 * DAY && e.plan === 'yearly');
e = ent({ subscriptionType: 'premium' });
check('legacy premium (no status) → Pro', e.isPro && e.source === 'paid');
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'active', trialStartedAt: NOW - 30 * DAY });
check('paid overrides expired trial → Pro via paid', e.isPro && e.source === 'paid');

console.log(`\n${C.b}Cancellation${C.x}`);
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: NOW + 5 * DAY });
check('canceled but within paid period → still Pro', e.isPro && e.cancelAtPeriodEnd === true);
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'canceled', currentPeriodEnd: NOW - DAY });
check('canceled & period ended → not Pro, status canceled', e.isPro === false && e.status === 'canceled');

console.log(`\n${C.b}Past-due grace window${C.x}`);
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'past_due', graceUntil: NOW + DAY });
check('past_due within grace → Pro, source grace', e.isPro && e.source === 'grace');
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'past_due', graceUntil: NOW - DAY });
check('past_due after grace → not Pro', e.isPro === false && e.status === 'past_due');
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'past_due' });
check('past_due with no grace timestamp → not Pro (defensive)', e.isPro === false);
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'expired' });
check('explicit expired premium → not Pro', e.isPro === false);

console.log(`\n${C.b}Trial vs paid precedence${C.x}`);
e = ent({ subscriptionType: 'premium', subscriptionStatus: 'past_due', graceUntil: NOW - DAY, trialStartedAt: NOW - 2 * DAY });
check('grace expired but trial active → Pro via trial', e.isPro && e.source === 'trial' && e.status === 'trialing');

console.log(`\n${C.b}toMillis coercion${C.x}`);
check('number passthrough', toMillis(NOW) === NOW);
check('Firestore Timestamp {seconds}', toMillis({ seconds: 1000, nanoseconds: 0 }) === 1_000_000);
check('admin Timestamp {_seconds}', toMillis({ _seconds: 1000, _nanoseconds: 0 }) === 1_000_000);
check('Date instance', toMillis(new Date(NOW)) === NOW);
check('ISO string', toMillis('2026-06-15T00:00:00.000Z') === NOW);
check('null → null', toMillis(null) === null);
check('garbage → null', toMillis('not-a-date') === null && toMillis({}) === null);

console.log(`\n${C.b}Nutrition targets — base & macro split${C.x}`);
let t = computeDailyTargets({});
check('default goal → 2200 kcal, percent mode, base day', t.calories === 2200 && t.macroMode === 'percent' && t.dayType === 'base');
check('default macros (25/45/30 of 2200)', t.proteinG === 138 && t.carbsG === 248 && t.fatsG === 73, JSON.stringify(t));
check('fat_loss base 1800', computeDailyTargets({ goal: 'fat_loss' }).calories === 1800);
check('muscle_gain base 2800', computeDailyTargets({ goal: 'muscle_gain' }).calories === 2800);
check('baseCaloriesFor matches', baseCaloriesFor('muscle_gain') === 2800);

t = computeDailyTargets({ macroTargets: { mode: 'percent', proteinPct: 40, carbsPct: 40, fatsPct: 20 } });
check('custom percent split (40/40/20 of 2200)', t.proteinG === 220 && t.carbsG === 220 && t.fatsG === 49, JSON.stringify(t));

t = computeDailyTargets({ macroTargets: { mode: 'grams', proteinG: 200, carbsG: 150, fatsG: 60 } });
check('grams mode → grams kept, calories derived (1940)', t.proteinG === 200 && t.carbsG === 150 && t.fatsG === 60 && t.calories === 1940 && t.macroMode === 'grams');

t = computeDailyTargets({ macroTargets: { mode: 'percent', proteinPct: 0, carbsPct: 0, fatsPct: 0 } });
check('zero percent split → no NaN', Number.isFinite(t.proteinG) && Number.isFinite(t.calories));

console.log(`\n${C.b}Nutrition targets — goal-by-day${C.x}`);
const d = new Date(2026, 5, 15);
const wd = String(d.getDay());
const dayCfg = (type) => ({
  dayTargets: {
    enabled: true,
    workout: { calories: 3000, carbsG: 400, proteinG: 220 },
    rest: { calories: 1600, carbsG: 100 },
    schedule: { [wd]: type },
  },
});
t = computeDailyTargets(dayCfg('workout'), d);
check('workout day override applied', t.calories === 3000 && t.carbsG === 400 && t.proteinG === 220 && t.dayType === 'workout');
t = computeDailyTargets(dayCfg('rest'), d);
check('rest day override (carbs+cals, protein falls back)', t.calories === 1600 && t.carbsG === 100 && t.dayType === 'rest');
t = computeDailyTargets({ dayTargets: { enabled: false, workout: {}, rest: {}, schedule: { [wd]: 'workout' } } }, d);
check('scheduling disabled → base day', t.dayType === 'base' && t.calories === 2200);
t = computeDailyTargets({ dayTargets: { enabled: true, workout: {}, rest: {}, schedule: {} } }, d);
check('enabled but day unscheduled → base', t.dayType === 'base');
// grams + day override combine
t = computeDailyTargets({ macroTargets: { mode: 'grams', proteinG: 180, carbsG: 120, fatsG: 50 }, ...dayCfg('workout') }, d);
check('grams + workout override → override wins for cals/carbs', t.calories === 3000 && t.carbsG === 400 && t.macroMode === 'grams');

console.log(`\n${C.b}Robustness / fuzz${C.x}`);
let threw = 0, bad = 0;
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
for (let i = 0; i < 2000; i++) {
  const p = {
    subscriptionType: rnd(['free', 'premium', undefined]),
    subscriptionStatus: rnd(['trialing', 'active', 'past_due', 'canceled', 'expired', 'free', undefined]),
    trialStartedAt: rnd([NOW, NOW - 3 * DAY, NOW - 10 * DAY, undefined, null, 'bad', { seconds: 100 }]),
    currentPeriodEnd: rnd([NOW + 5 * DAY, NOW - 5 * DAY, undefined, null]),
    graceUntil: rnd([NOW + DAY, NOW - DAY, undefined]),
    cancelAtPeriodEnd: rnd([true, false, undefined]),
    plan: rnd(['monthly', 'yearly', undefined]),
    goal: rnd(['fat_loss', 'muscle_gain', 'maintenance', undefined]),
    macroTargets: rnd([undefined, { mode: 'grams', proteinG: 100, carbsG: 100, fatsG: 30 }, { mode: 'percent', proteinPct: 30, carbsPct: 40, fatsPct: 30 }]),
  };
  try {
    const en = computeEntitlement(p, NOW, false);
    if (typeof en.isPro !== 'boolean' || typeof en.trialDaysLeft !== 'number' || en.trialDaysLeft < 0) bad++;
    const tt = computeDailyTargets(p);
    if (!Number.isFinite(tt.calories) || !Number.isFinite(tt.proteinG) || tt.calories < 0) bad++;
  } catch { threw++; }
}
check('fuzz · 2,000 random profiles never throw', threw === 0, `${threw} threw`);
check('fuzz · 2,000 outputs valid', bad === 0, `${bad} invalid`);

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Assertions: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}`);
const green = fail === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — subscription + nutrition targets verified' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
