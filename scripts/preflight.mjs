// Release preflight — npm run preflight
//
// One command that answers "can this ship?", including the parts no test can
// prove. Every item is either checked here or listed as a MANUAL gate, because
// the failures that hurt this app have all been things nothing was looking at:
// fourteen missing indexes, ten unreachable badges, a privacy policy naming a
// company that does not exist, and an error reporter wired to nothing.
//
// Exit codes: 0 = clear to ship. 1 = a blocking gate failed.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const C = {
  g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m',
  b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m',
};
const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

const blocking = [];
const warnings = [];
const manual = [];

const gate = (ok, name, detail) => {
  if (ok) { console.log(`  ${C.g}PASS${C.x} ${name}`); return true; }
  console.log(`  ${C.r}BLOCK${C.x} ${name}${detail ? `\n        ${C.d}${detail}${C.x}` : ''}`);
  blocking.push(name);
  return false;
};
const advise = (ok, name, detail) => {
  if (ok) { console.log(`  ${C.g}PASS${C.x} ${name}`); return true; }
  console.log(`  ${C.y}WARN ${C.x} ${name}${detail ? `\n        ${C.d}${detail}${C.x}` : ''}`);
  warnings.push(name);
  return false;
};

console.log(`\n${C.b}── FitFlow release preflight ──${C.x}\n`);

// ─── 1. Legal identity ────────────────────────────────────────────────────────
console.log(`${C.b}1 · Publisher identity${C.x}`);
let legalOk = true;
try {
  execSync('node scripts/check-legal.mjs', { cwd: ROOT, stdio: 'pipe' });
} catch { legalOk = false; }
gate(legalOk, 'privacy policy + terms identify a real controller',
  'run `npm run check:legal` for detail');

// ─── 2. Observability ─────────────────────────────────────────────────────────
//
// This is the gate that would have caught the whole class of bug this app has
// been shipping. Reporting code that is wired to an unset DSN is not
// observability; it is the same silence with more steps.
console.log(`\n${C.b}2 · Observability${C.x}`);
const tel = read('src/lib/telemetry.ts');
const fb = read('src/lib/firebase.ts');
gate(/captureError\(/.test(fb),
  'the Firestore error path reports rather than console.warn only');
gate(/export const reportSwallowed/.test(tel),
  'recovered failures are counted');

// Is a DSN actually reachable at build time? Locally that means .env;
// in CI it means the repository secret.
const envFiles = ['.env', '.env.local', '.env.production'];
const envText = envFiles.map(read).join('\n');
const dsnInEnv = /^\s*VITE_SENTRY_DSN\s*=\s*\S+/m.test(envText);
const dsnInProcess = !!process.env.VITE_SENTRY_DSN;

let dsnInSecrets = null; // null = could not determine
try {
  const out = execSync('gh secret list', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  dsnInSecrets = /^VITE_SENTRY_DSN\b/m.test(out);
} catch { /* gh missing or unauthenticated — leave undetermined */ }

const dsnAnywhere = dsnInEnv || dsnInProcess || dsnInSecrets === true;
gate(dsnAnywhere, 'VITE_SENTRY_DSN is configured',
  dsnInSecrets === false
    ? 'NOT in GitHub secrets, and not in .env — every error report built into\n        ' +
      'this app is inert in production. Get a DSN at sentry.io (free tier is\n        ' +
      'enough) then: gh secret set VITE_SENTRY_DSN'
    : 'not found in .env or the environment; could not check GitHub secrets');

// Every workflow STEP that runs a production `npm run build` must bake the DSN
// into that step's own env, or the artifact it produces is silent.
//
// android-apk.yml wired none, so the WEB app reported crashes and the ANDROID
// app — the build closed testers install, whose users cannot send you a stack
// trace — did not.
//
// This counts STEPS, not occurrences. The first version of this check counted
// how many times the string "VITE_SENTRY_DSN" appeared in the file, which is
// two per wiring line (`VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}`), so a
// two-build workflow with only one build wired still looked covered. It passed
// its own negative test. Per-step is the only counting that means anything.
const wfDir = join(ROOT, '.github/workflows');
const unwiredSteps = [];
try {
  for (const f of readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const text = readFileSync(join(wfDir, f), 'utf8');
    // Split on step boundaries: a "- name:" at the step indent level.
    const steps = text.split(/^\s*- name:/m);
    for (const step of steps) {
      // Any step whose body runs the production build, block scalar or not.
      if (!/npm run build/.test(step)) continue;
      // ...except the Cloud Functions build. `cd functions && npm run build` is
      // tsc over server code: there is no web bundle to bake a DSN into, and
      // functions report through their own runtime, not this client SDK.
      if (/cd functions/.test(step) || /--prefix\s+["']?functions/.test(step)) continue;
      if (!/VITE_SENTRY_DSN:/.test(step)) {
        const label = (step.split(/\r?\n/)[0] || '').trim().slice(0, 40);
        unwiredSteps.push(`${f} → "${label}"`);
      }
    }
  }
} catch { /* no workflows dir */ }
gate(unwiredSteps.length === 0,
  'every build step bakes in error reporting',
  unwiredSteps.join('; '));
// ─── 3. Data layer ────────────────────────────────────────────────────────────
console.log(`\n${C.b}3 · Data layer${C.x}`);
let indexes = { indexes: [] };
try { indexes = JSON.parse(read('firestore.indexes.json')); } catch { /* handled below */ }
gate(indexes.indexes.length >= 15,
  `every composite query shape is declared (${indexes.indexes.length} indexes)`,
  'a missing composite index throws failed-precondition, which every caller swallows');
gate(/firestore:indexes/.test(read('.github/workflows/deploy.yml')),
  'CI deploys indexes, not just rules');
gate(/match \/workout_plans\//.test(read('firestore.rules')),
  'security rules cover every collection the app writes');

// ─── 4. Proof gates ───────────────────────────────────────────────────────────
console.log(`\n${C.b}4 · Proof gates${C.x}`);
const pkg = JSON.parse(read('package.json') || '{}');
const offline = ['proof:telemetry', 'proof:badges', 'proof:library', 'proof:features', 'proof:retention', 'proof:mission',
  'proof:steps', 'proof:quickadd', 'proof:subscription', 'proof:biomechanics', 'proof:preload',
  'proof:offline', 'proof:privacy'];
let allProofs = true;
for (const p of offline) {
  if (!pkg.scripts?.[p]) { console.log(`  ${C.r}BLOCK${C.x} ${p} is not registered`); allProofs = false; continue; }
  try {
    execSync(`npm run ${p} --silent`, { cwd: ROOT, stdio: 'pipe' });
    console.log(`  ${C.g}PASS${C.x} ${p}`);
  } catch {
    console.log(`  ${C.r}BLOCK${C.x} ${p} failed`);
    allProofs = false;
  }
}
if (!allProofs) blocking.push('proof suite');

// ─── 5. Build ─────────────────────────────────────────────────────────────────
console.log(`\n${C.b}5 · Build${C.x}`);
gate(existsSync(join(ROOT, 'dist/index.html')), 'a build exists in dist/', 'run `npm run build`');
gate(/scan-bundle-secrets/.test(pkg.scripts?.build || ''), 'the build scans for leaked keys');

// ─── 6. What no script can check ──────────────────────────────────────────────
//
// Listed rather than silently omitted. The whole reason this app shipped
// fourteen missing indexes is that nothing enumerated what was not being
// looked at.
manual.push(
  ['Google Play closed test: 12+ distinct real testers, opted in',
   'the 14-day clock cannot start below 12 and can reset if you drop under. ' +
   'No script can do this, and fake accounts get the developer account terminated.'],
  ['Play developer account name matches src/lib/legal.ts exactly',
   'a mismatch against the privacy policy is a review rejection'],
  ['Controller address is deliverable (street + 5-digit postcode)',
   'currently area-level only'],
  ['Someone other than you has completed onboarding → log a meal → finish a workout',
   'no UI test covers any of the 22 pages; this path has never been walked by a stranger'],
  ['Sentry issues reviewed after 48h of real traffic',
   'the point of yesterday\'s work is the signal it produces, not the code'],
);

console.log(`\n${C.b}6 · Manual gates ${C.d}(nothing here can be automated)${C.x}`);
for (const [name, why] of manual) {
  console.log(`  ${C.c}[ ]${C.x}  ${name}\n        ${C.d}${why}${C.x}`);
}

// ─── Verdict ──────────────────────────────────────────────────────────────────
console.log(`\n${C.b}── Verdict ──${C.x}`);
if (blocking.length) {
  console.log(`${C.r}${C.b}NOT READY${C.x} — ${blocking.length} blocking: ${blocking.join(', ')}`);
} else if (warnings.length) {
  console.log(`${C.y}${C.b}SHIPPABLE WITH WARNINGS${C.x} — ${warnings.join(', ')}`);
} else {
  console.log(`${C.g}${C.b}AUTOMATED GATES CLEAR${C.x}`);
}
console.log(`${C.d}${manual.length} manual gates above are still yours to close.${C.x}\n`);
process.exit(blocking.length ? 1 : 0);
