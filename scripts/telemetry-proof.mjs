// Observability proof harness — npm run proof:telemetry
//
// The app is built to recover from failure rather than crash, which is right.
// What it did NOT do was count the recoveries: `handleFirestoreError` stopped
// at console.warn, Sentry was initialised and never called from it, and 54
// catch blocks discarded their error. So a missing index, an unreachable badge
// and a fake-workout write all sat in production for months, invisible.
//
// Part A proves the send-budget behaves: repeats are grouped and throttled, but
// never silenced entirely, and the suppressed count rides along.
// Part B is a source assertion: the paths that must report, do — and the two
// PII/placeholder regressions that were just fixed cannot come back.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);

console.log(`\n${C.b}── Telemetry proof ──${C.x}\n`);

// ─── Part A · the send budget ─────────────────────────────────────────────────
// Reimplemented from the source constants so the harness tests the POLICY, and
// fails loudly if the policy in telemetry.ts is changed without thought.
const telSrc = readFileSync(join(ROOT, 'src/lib/telemetry.ts'), 'utf8');
const BURST = Number((telSrc.match(/const BURST = (\d+)/) || [])[1]);
const COOLDOWN_MS = (() => {
  const m = telSrc.match(/const COOLDOWN_MS = ([\d\s*]+);/);
  return m ? eval(m[1]) : NaN; // eslint-disable-line no-eval
})();

console.log(`${C.b}Part A · send budget${C.x}`);
check('BURST parsed from source', Number.isFinite(BURST) && BURST >= 1, String(BURST));
check('COOLDOWN_MS parsed from source', Number.isFinite(COOLDOWN_MS) && COOLDOWN_MS > 0, String(COOLDOWN_MS));

// Mirror of the budget() logic, with an injectable clock.
const makeBudget = () => {
  const seen = new Map();
  return (signature, now) => {
    let e = seen.get(signature);
    if (!e) { e = { sent: 0, suppressed: 0, last: 0 }; seen.set(signature, e); }
    if (e.sent < BURST || now - e.last >= COOLDOWN_MS) {
      const suppressed = e.suppressed;
      e.sent++; e.suppressed = 0; e.last = now;
      return { send: true, suppressed };
    }
    e.suppressed++;
    return { send: false, suppressed: e.suppressed };
  };
};

let b = makeBudget();
let t = 1_000_000;
const first = [];
for (let i = 0; i < BURST; i++) first.push(b('sig', t + i).send);
check(`first ${BURST} of a signature all send`, first.every(Boolean));
check('the next one is throttled', b('sig', t + BURST).send === false);

b = makeBudget(); t = 1_000_000;
for (let i = 0; i < BURST; i++) b('sig', t);
for (let i = 0; i < 50; i++) b('sig', t + 1 + i);
const afterCooldown = b('sig', t + COOLDOWN_MS + 1);
check('a repeat sends again after the cooldown', afterCooldown.send === true);
check('and reports how many were suppressed meanwhile',
  afterCooldown.suppressed === 50, String(afterCooldown.suppressed));

b = makeBudget(); t = 1_000_000;
for (let i = 0; i < BURST + 10; i++) b('noisy', t + i);
check('a different signature is unaffected by a noisy one', b('quiet', t).send === true);

b = makeBudget(); t = 1_000_000;
let sends = 0;
for (let i = 0; i < 100_000; i++) { if (b('flood', t + i).send) sends++; }
check('a 100k-event flood cannot exceed the budget', sends <= BURST + 1, `${sends} sent`);
check('but is never silenced completely', sends >= 1);

check('signature map is bounded', /MAX_SIGNATURES/.test(telSrc));
check('reportSwallowed exists', /export const reportSwallowed/.test(telSrc));
check('un-configured builds still surface to console',
  /if \(!sentry\)[\s\S]{0,400}console/.test(telSrc));
check('capture never throws out of telemetry',
  /catch \{ \/\* telemetry must never be the thing that breaks the app \*\/ \}/.test(telSrc));

// ─── Part B · the paths that must report ──────────────────────────────────────
console.log(`\n${C.b}Part B · the paths that must report${C.x}`);

const fb = readFileSync(join(ROOT, 'src/lib/firebase.ts'), 'utf8');
check('handleFirestoreError reports, not just console.warn',
  /handleFirestoreError[\s\S]*?captureError\(/.test(fb));
check('failed-precondition (missing index) is escalated',
  /failed-precondition/.test(fb) && /MISSING INDEX/.test(fb));
check('errors are grouped by query shape, not by user',
  /signature: `firestore:\$\{code\}/.test(fb));

// The PII regression: the user's email address was attached to
// permission-denied logs. `emailVerified` is a boolean, not PII, and is
// legitimately useful on a permission failure — so the pattern must not match
// it, which the first version of this check did.
const handler = fb.slice(fb.indexOf('export const handleFirestoreError'));
check('NO user email address in the diagnostic payload',
  !/user\?\.email(?!Verified)\b/.test(handler), 'user?.email is back in handleFirestoreError');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const sources = new Map(walk(join(ROOT, 'src')).map((f) => [f, readFileSync(f, 'utf8')]));
const read = (suffix) => sources.get([...sources.keys()].find((f) => f.endsWith(suffix)));

// Data loss is the one failure that must never be swallowed silently.
const data = read('dataService.ts');
const queueCatches = (data.match(/addToOfflineQueue\([\s\S]{0,200}?catch \(queueErr\)/g) || []).length;
check('all 4 offline-queue failure paths report (data loss)', queueCatches === 4, `${queueCatches} of 4`);
check('none of them are bare swallows any more', !/catch \{ \/\* swallow \*\/ \}/.test(data));

check('badge checker failures are counted', /reportSwallowed\('badgeService\./.test(read('badgeService.ts')));
check('XP failures are counted', /reportSwallowed\('xpService\./.test(read('xpService.ts')));
const analytics = read('analyticsService.ts');
check('streak marker loss is counted', /reportSwallowed\('analytics\.recordActiveDay\.marker/.test(analytics));
check('streak denormalisation failure is counted',
  /reportSwallowed\('analytics\.recordActiveDay\.denormalize/.test(analytics));
check('the retention fallback admits it fabricated a value',
  /reportSwallowed\('analytics\.getRetentionStats\.fallback/.test(analytics));

// ─── Part B · legal identity gate ─────────────────────────────────────────────
console.log(`\n${C.b}Part B · legal identity cannot ship unset${C.x}`);
const legal = readFileSync(join(ROOT, 'src/lib/legal.ts'), 'utf8');
const privacy = read('Privacy.tsx');
const terms = read('Terms.tsx');

check('there is one source of truth for publisher identity', /export const LEGAL/.test(legal));
check('Privacy reads it', /from '\.\.\/lib\/legal'/.test(privacy));
check('Terms reads it', /from '\.\.\/lib\/legal'/.test(terms));
check('no hardcoded "FitFlow, Inc." in Privacy', !/FitFlow,\s*Inc\./.test(privacy));
check('no hardcoded "FitFlow, Inc." in Terms', !/FitFlow,\s*Inc\./.test(terms));
check('no [REPLACE ...] placeholder in Privacy', !/\[REPLACE/.test(privacy));
check('no [REPLACE ...] placeholder in Terms', !/\[REPLACE/.test(terms));
check('the US arbitration/class-action template is gone',
  !/ARBITRATION_VENUE/.test(terms) && !/waive class-action/.test(terms));
check('consumer rights are preserved explicitly',
  /mandatory consumer-protection rules/.test(terms));
check('corporate wording is conditional on actually being a company',
  /LEGAL\.kind === 'company'/.test(terms));

const gate = readFileSync(join(ROOT, 'scripts/check-legal.mjs'), 'utf8');
check('a release build is gated on it', /process\.env\.CI/.test(gate) && /process\.exit\(1\)/.test(gate));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
check('the gate runs as part of `npm run build`', /check-legal/.test(pkg.scripts.build));

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) {
  console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
} else {
  console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`);
  process.exit(1);
}
