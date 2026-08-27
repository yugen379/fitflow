// Paywall proof harness — npm run proof:features
//
// A paywall fails in two directions and only one of them is visible. Locking a
// paying customer out generates a support email; leaving a feature open to
// everyone generates nothing at all — it just quietly never earns. This proves
// the whole matrix in both directions.
//
// It also guards the failure this codebase already had: an entitlement engine
// that computed `isPro` correctly for months while NOTHING asked it, so every
// feature was free to everyone regardless of what the billing screens claimed.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { computeEntitlement, TRIAL_DAYS } = await import('../src/lib/billing.ts');
const {
  PRO_FEATURES, ALL_PRO_FEATURES, isFeatureUnlocked, historyDaysFor,
  streakFreezeAllowanceFor, FREE_HISTORY_DAYS, FREE_STREAK_FREEZES_PER_MONTH,
} = await import('../src/lib/features.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const ts = (ms) => ({ toMillis: () => ms });

const ent = (profile, freeForAll = false) => computeEntitlement(profile, NOW, freeForAll);

console.log(`\n${C.b}── Paywall proof ──${C.x}  ${C.d}(trial = ${TRIAL_DAYS} days)${C.x}\n`);

// ─── The trial ────────────────────────────────────────────────────────────────
console.log(`${C.b}The trial${C.x}`);
check(`trial is ${TRIAL_DAYS} days`, TRIAL_DAYS === 7, String(TRIAL_DAYS));

const dayOfTrial = (n) => ent({ trialStartedAt: ts(NOW - n * DAY) });
check('day 0 — everything unlocked', dayOfTrial(0).isPro === true);
check('day 6 — still unlocked (last full day)', dayOfTrial(6).isPro === true);
check(`day ${TRIAL_DAYS} — trial has ended`, dayOfTrial(TRIAL_DAYS).isPro === false);
check('day 30 — still ended, not resurrected', dayOfTrial(30).isPro === false);
check('trial source is reported as trial', dayOfTrial(1).source === 'trial');
check('days-left counts down', dayOfTrial(0).trialDaysLeft >= dayOfTrial(5).trialDaysLeft);
check('days-left is 0 once ended', dayOfTrial(TRIAL_DAYS).trialDaysLeft === 0);

// ─── Every feature, every account state ───────────────────────────────────────
console.log(`\n${C.b}The matrix${C.x}`);
const STATES = {
  'brand new (trial day 0)':   ent({ trialStartedAt: ts(NOW) }),
  'mid-trial (day 3)':         ent({ trialStartedAt: ts(NOW - 3 * DAY) }),
  'trial expired':             ent({ trialStartedAt: ts(NOW - 30 * DAY) }),
  'no profile at all':         ent(null),
  'empty profile':             ent({}),
  'paid, active':              ent({ subscriptionType: 'premium', subscriptionStatus: 'active', trialStartedAt: ts(NOW - 90 * DAY) }),
  'paid, cancelled in period': ent({ subscriptionType: 'premium', subscriptionStatus: 'canceled', currentPeriodEnd: ts(NOW + 5 * DAY), trialStartedAt: ts(NOW - 90 * DAY) }),
  'lapsed, past grace':        ent({ subscriptionType: 'premium', subscriptionStatus: 'expired', currentPeriodEnd: ts(NOW - 30 * DAY), graceUntil: ts(NOW - 20 * DAY), trialStartedAt: ts(NOW - 90 * DAY) }),
};
const SHOULD_UNLOCK = {
  'brand new (trial day 0)': true, 'mid-trial (day 3)': true,
  'trial expired': false, 'no profile at all': false, 'empty profile': false,
  'paid, active': true, 'paid, cancelled in period': true, 'lapsed, past grace': false,
};

for (const [label, e] of Object.entries(STATES)) {
  const want = SHOULD_UNLOCK[label];
  const got = ALL_PRO_FEATURES.map((f) => isFeatureUnlocked(f, e));
  check(`${label.padEnd(27)} → ${want ? 'all unlocked' : 'all locked'}`,
    got.every((g) => g === want),
    ALL_PRO_FEATURES.filter((f, i) => got[i] !== want).join(', '));
}

// ─── Fail-closed ──────────────────────────────────────────────────────────────
console.log(`\n${C.b}Fails closed, never open${C.x}`);
const expired = STATES['trial expired'];
check('an unknown feature id is LOCKED, not unlocked',
  isFeatureUnlocked('not-a-real-feature', expired) === false);
check('an unknown id stays locked even for a paid account',
  isFeatureUnlocked('not-a-real-feature', STATES['paid, active']) === false);
check('undefined feature id is locked', isFeatureUnlocked(undefined, STATES['paid, active']) === false);
for (const bad of [null, undefined, {}, { isPro: 'yes' }, { isPro: 1 }]) {
  check(`entitlement ${JSON.stringify(bad)} → locked`,
    (() => { try { return isFeatureUnlocked('coach-chat', bad ?? {}) === false; } catch { return true; } })());
}

// ─── Launch giveaway mode ─────────────────────────────────────────────────────
console.log(`\n${C.b}Launch giveaway mode (VITE_ALL_FEATURES_FREE)${C.x}`);
const giveaway = ent({ trialStartedAt: ts(NOW - 90 * DAY) }, true);
check('freeForAll unlocks a long-expired account', giveaway.isPro === true);
check('every feature unlocked under giveaway',
  ALL_PRO_FEATURES.every((f) => isFeatureUnlocked(f, giveaway)));

// ─── Allowances ───────────────────────────────────────────────────────────────
console.log(`\n${C.b}Allowances${C.x}`);
check(`free history is ${FREE_HISTORY_DAYS} days`, historyDaysFor(expired) === FREE_HISTORY_DAYS);
check('pro history is unbounded', historyDaysFor(STATES['paid, active']) === Infinity);
check('trial history is unbounded', historyDaysFor(STATES['mid-trial (day 3)']) === Infinity);
check(`free streak freezes = ${FREE_STREAK_FREEZES_PER_MONTH}/month`,
  streakFreezeAllowanceFor(expired) === FREE_STREAK_FREEZES_PER_MONTH);
check('pro streak freezes unlimited', streakFreezeAllowanceFor(STATES['paid, active']) === Infinity);

// ─── Registry integrity ───────────────────────────────────────────────────────
console.log(`\n${C.b}Registry${C.x}`);
check('every feature has a title and a pitch',
  ALL_PRO_FEATURES.every((f) => PRO_FEATURES[f]?.title && PRO_FEATURES[f]?.pitch),
  ALL_PRO_FEATURES.filter((f) => !PRO_FEATURES[f]?.pitch).join(', '));
check('no duplicate titles',
  new Set(ALL_PRO_FEATURES.map((f) => PRO_FEATURES[f].title)).size === ALL_PRO_FEATURES.length);

// ─── The gates are actually wired ─────────────────────────────────────────────
//
// The engine answering correctly is worth nothing if no screen asks it. That is
// precisely the state this codebase was in: isPro was computed for months and
// used only to render a badge.
console.log(`\n${C.b}Gates are wired into the app${C.x}`);
const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const src = new Map(walk(join(ROOT, 'src')).map((f) => [f, readFileSync(f, 'utf8')]));
const all = [...src.values()].join('\n');
const fileWith = (needle) => [...src.entries()].find(([, t]) => t.includes(needle));

check('coach chat is gated', /feature="coach-chat"/.test(all));
check('biomechanics lab is gated', /feature="biomechanics-lab"/.test(all));
check('analytics applies a history window', /historyDaysFor\(/.test(all));
check('coach send() refuses when not entitled', /canUse\('coach-chat'/.test(all));

// ENFORCED, not merely mentioned. A feature that appears only in the registry
// is advertised on the paywall and given away in the app — the same shape of
// bug as a badge nobody can earn.
const appCode = [...src.entries()]
  .filter(([f]) => !f.endsWith('features.ts'))
  .map(([, t]) => t).join(String.fromCharCode(10));
const enforced = ALL_PRO_FEATURES.filter((f) =>
  appCode.includes(`feature="${f}"`) ||
  appCode.includes(`canUse('${f}'`) ||
  (f === 'analytics-history' && appCode.includes('historyDaysFor(')) ||
  (f === 'unlimited-streak-freeze' &&
    /streakFreezeAllowanceFor|FREE_FREEZES_PER_MONTH/.test(appCode)));
check(`every registered feature is ENFORCED in app code (${enforced.length}/${ALL_PRO_FEATURES.length})`,
  enforced.length === ALL_PRO_FEATURES.length,
  'not enforced: ' + ALL_PRO_FEATURES.filter((f) => !enforced.includes(f)).join(', '));

// The server must not take the client's word for an expensive call.
const fns = readFileSync(join(ROOT, 'functions/src/index.ts'), 'utf8');
check('the server enforces coach entitlement independently',
  /action === "askCoach"/.test(fns) && /isProUid/.test(fns));
check('server entitlement helper fails closed',
  /catch \{[\s\S]{0,80}return false;/.test(fns));
check('the gated action name matches one the proxy actually handles',
  /case "askCoach":/.test(fns));

// Copy must not sell what is already free.
const gate = readFileSync(join(ROOT, 'src/components/PremiumGate.tsx'), 'utf8');
check('perks do not advertise the free AI meal plan', !/meal plans/i.test(gate.slice(gate.indexOf('const PERKS'), gate.indexOf('];', gate.indexOf('const PERKS')))));
check('perks do not advertise data export that does not exist',
  !/data export/i.test(gate.slice(gate.indexOf('const PERKS'), gate.indexOf('];', gate.indexOf('const PERKS')))));
check('trial length in copy comes from the constant', /\{TRIAL_DAYS\}/.test(gate));

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`); process.exit(1); }
