// Privacy boundary proof — npm run proof:privacy
//
// Guards the fix for a blanket `allow get, list: if isSignedIn()` on
// /users/{userId}. Firestore rules cannot restrict which FIELDS a read returns,
// so permitting the read permits the WHOLE document: every signed-in account
// could read every other user's age, weight, healthConditions (special-category
// health data), email, fcmToken and Stripe customer id — to power leaderboards
// that need a name and a score.
//
// The shape of that bug is a one-line rules edit, so it is worth a gate. These
// checks are static: they read the rules and the app source, no emulator.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const fns = readFileSync(join(ROOT, 'functions/src/index.ts'), 'utf8');

const walk = (dir) => {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const src = new Map(walk(join(ROOT, 'src')).map((f) => [f, readFileSync(f, 'utf8')]));
const app = [...src.values()].join('\n');

// Slice out the `match /users/{userId} { ... }` block's own allow lines (not
// its subcollections, which have their own match blocks).
const usersBlock = (() => {
  const i = rules.indexOf('match /users/{userId} {');
  const sub = rules.indexOf('match /', i + 10);
  return rules.slice(i, sub === -1 ? rules.length : sub);
})();

console.log(`\n${C.b}── Privacy boundary proof ──${C.x}\n`);

console.log(`${C.b}/users is owner-only${C.x}`);
check('a signed-in stranger cannot read another user document',
  !/allow\s+get\s*,\s*list\s*:\s*if\s+isSignedIn\(\)/.test(usersBlock) &&
  !/allow\s+read\s*:\s*if\s+isSignedIn\(\)/.test(usersBlock),
  'rules cannot filter fields — permitting the read permits age, weight, healthConditions, fcmToken and Stripe ids');
check('get is restricted to the owner', /allow\s+get\s*:\s*if\s+isOwner\(userId\)/.test(usersBlock));
check('the user collection cannot be enumerated', /allow\s+list\s*:\s*if\s+false/.test(usersBlock));

console.log(`\n${C.b}The public mirror${C.x}`);
const pubBlock = (() => {
  const i = rules.indexOf('match /public_profiles/{userId} {');
  if (i === -1) return '';
  return rules.slice(i, rules.indexOf('}', rules.indexOf('allow create', i)) + 1);
})();
check('public_profiles exists and is readable by signed-in users',
  /allow\s+get\s*,\s*list\s*:\s*if\s+isSignedIn\(\)/.test(pubBlock));
check('no client can write the mirror',
  /allow\s+create\s*,\s*update\s*,\s*delete\s*:\s*if\s+false/.test(pubBlock),
  'a client-writable mirror lets anyone forge a leaderboard entry');

console.log(`\n${C.b}The whitelist is an allow-list${C.x}`);
const wl = (() => {
  const i = fns.indexOf('const PUBLIC_PROFILE_FIELDS');
  return fns.slice(i, fns.indexOf('] as const', i));
})();
const fields = [...wl.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
check(`the mirror publishes a fixed field list (${fields.join(', ')})`, fields.length > 0);
// The whole point: a new sensitive field on the user doc must be private by
// DEFAULT. A deny-list would leak it the day someone forgets to add it.
const SENSITIVE = [
  'age', 'weight', 'height', 'healthConditions', 'dietaryPreferences', 'email',
  'fcmToken', 'stripeCustomerId', 'stripeSubscriptionId', 'subscriptionType',
  'subscriptionStatus', 'plan', 'currentPeriodEnd', 'graceUntil', 'latestBodyFat',
  'latestMuscleMass', 'goalWeight', 'macroTargets', 'trialStartedAt', 'tzId',
];
const leaked = fields.filter((f) => SENSITIVE.includes(f));
check('no sensitive field is mirrored', leaked.length === 0, 'leaked: ' + leaked.join(', '));
check('the mirror is maintained server-side only',
  /onDocumentWritten\(/.test(fns) && /document:\s*"users\/\{uid\}"/.test(fns));
check('the mirror trigger targets the NAMED database',
  /document:\s*"users\/\{uid\}",\s*database:\s*DATABASE_ID/.test(fns),
  'a trigger on (default) would never fire for this app');
check('a deleted user loses their mirror',
  /if \(!after\?\.exists\)[\s\S]{0,120}ref\.delete\(\)/.test(fns));

console.log(`\n${C.b}The app reads the mirror, not /users${C.x}`);
check('no screen queries the users collection across accounts',
  !/collection\(db,\s*'users'\)/.test(app),
  'found a cross-user read of /users — use public_profiles');
check('leaderboards read public_profiles',
  (app.match(/collection\(db,\s*'public_profiles'\)/g) || []).length >= 3);

console.log(`\n${C.b}Backfill${C.x}`);
const bf = readFileSync(join(ROOT, 'scripts/backfill-public-profiles.mjs'), 'utf8');
const bfFields = [...bf.slice(bf.indexOf('const PUBLIC_PROFILE_FIELDS')).matchAll(/'([a-zA-Z]+)'/g)]
  .map((m) => m[1]).slice(0, fields.length);
check('the backfill mirrors exactly the same fields as the trigger',
  bfFields.join(',') === fields.join(','),
  `trigger: ${fields.join(',')} | backfill: ${bfFields.join(',')}`);
check('the backfill uses the modular getFirestore(app, id)',
  /getFirestore\(admin\.app\(\),/.test(bf) && !/admin\.firestore\(admin\.app\(\)/.test(bf));

const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`); process.exit(1); }
