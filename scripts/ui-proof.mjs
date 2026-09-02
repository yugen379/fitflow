// UI proof harness — npm run proof:ui
//
// The gap this closes: all 22 routes sit behind ProtectedRoute, so every
// existing gate tested pure logic and NOTHING ever rendered a signed-in page.
// route-smoke walked the routes but only ever saw the sign-in screen — it was
// asserting that a login wall renders, 22 times. Ten real bugs shipped through
// that blind spot, including a privacy hole and duplicate offline writes.
//
// This signs in for real (email/password against the Auth emulator, so useAuth
// and ProtectedRoute run exactly as they do in production) and asserts that
// each page renders its OWN content, throws nothing, and does not silently
// redirect — the three ways a page fails that a human notices immediately and
// a logic test never sees.
//
// Run: npm run proof:ui   (boots the emulators and the dev server itself)

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const PROJECT = cfg.projectId;
const DB_ID = cfg.firestoreDatabaseId;
const BASE = 'http://127.0.0.1:3000';
const EMAIL = 'e2e@fitflow.test';
const PASSWORD = 'e2e-password-123';

let server;
const shutdown = () => {
  const pid = server?.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      // The spawn below uses `shell: true` on Windows, so `pid` is the npx.cmd
      // wrapper — NOT the node process actually listening on port 3000. A plain
      // .kill() reaps the wrapper and orphans the grandchild: the emulators stop,
      // this process exits 0, and the dev server keeps holding the port, so the
      // NEXT run of this gate cannot bind it and dies on startup. /T kills the
      // whole tree, which is the only thing that actually frees the port.
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill();
    }
  } catch { /* already gone */ }
};
process.on('exit', shutdown);

// ── 1. Seed the Auth emulator ────────────────────────────────────────────────
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`;
const signUp = await fetch(authUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const UID = signUp.localId;
if (!UID) {
  console.error('Could not create the emulator test user:', JSON.stringify(signUp));
  process.exit(1);
}

// ── 2. Seed Firestore so the pages have something real to render ─────────────
// An empty account renders empty states everywhere, which would make this
// harness pass while proving almost nothing.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: PROJECT });
const db = getFirestore(admin.app(), DB_ID);
const now = Timestamp.now();
const daysAgo = (n) => Timestamp.fromMillis(Date.now() - n * 86400000);

await db.doc(`users/${UID}`).set({
  uid: UID, displayName: 'E2E Tester', photoURL: '', email: EMAIL,
  subscriptionType: 'free',
  trialStartedAt: now, // inside the trial -> Pro-gated pages render unlocked
  age: 30, weight: 70, height: 175, goal: 'fat_loss',
  healthConditions: ['None'], dietaryPreferences: ['None'],
  streak: 3, currentStreak: 3, badges: ['pioneer'], points: 420, level: 3,
  createdAt: daysAgo(10), notificationsEnabled: false, activeChallenges: [],
});
await db.doc(`public_profiles/${UID}`).set({
  displayName: 'E2E Tester', photoURL: '', points: 420, streak: 3, level: 3, goal: 'fat_loss',
});
for (let i = 0; i < 3; i++) {
  await db.collection('workouts').add({
    userId: UID, name: `Session ${i + 1}`, type: 'Strength',
    duration: 45, caloriesBurned: 300, timestamp: daysAgo(i + 1), exercises: [],
  });
  await db.collection('meals').add({
    userId: UID, name: `Meal ${i + 1}`, calories: 500, protein: 30, carbs: 50, fat: 15,
    mealType: 'lunch', timestamp: daysAgo(i),
  });
}
await db.collection('posts').add({
  userId: UID, userName: 'E2E Tester', userAvatar: '',
  content: 'First post from the harness.', likes: [], commentCount: 0, createdAt: now,
});

// ── 3. Boot the dev server with emulator wiring on ───────────────────────────
server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'server.ts'], {
  env: { ...process.env, VITE_USE_EMULATORS: 'true' },
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};
if (!(await waitForServer())) {
  console.error('dev server never came up on', BASE);
  process.exit(1);
}

// ── 4. Sign in, then walk every route ────────────────────────────────────────
// [path, a string ONLY that page renders, isPublic]
//
// Markers are taken from what the page ACTUALLY renders, verified by dumping
// each body once. Note the uppercase: `.text-eyebrow` is CSS-uppercased, so the
// JSX reads "Nutrition" and the DOM reads "NUTRITION". Asserting the JSX
// spelling fails on every page — which is exactly what the first run did.
const ROUTES = [
  ['/', 'MISSION', false],
  ['/track', 'DAILY FUEL', false],
  ['/workout', 'TRAIN', false],
  ['/community', 'COMMUNITY', false],
  ['/profile', 'E2E', false],
  ['/wellness', 'RECOVERY', false],
  ['/explore', 'OUTDOOR', false],
  ['/library', 'LIBRARY', false],
  ['/analytics', 'ANALYTICS', false],
  ['/meal-plan', 'MEAL PLANS', false],
  ['/challenges', 'COMPETE', false],
  ['/settings', 'SETTINGS', false],
  ['/pro', 'Monthly', false],
  ['/coach', 'AI COACH', false],
  // "NUTRITION" would also match /track; MACRO SPLIT is unique to this page.
  ['/nutrition-goals', 'MACRO SPLIT', false],
  ['/lab', 'BIOMECHANICS LAB', false],
  ['/steps', 'STEP ANALYTICS', false],
  ['/achievements', 'ACHIEVEMENTS', false],
  ['/onboarding', 'ABOUT YOU', false],
  ['/privacy', 'Privacy Policy', true],
  ['/terms', 'Terms of Service', true],
  ['/delete-account', 'Delete your account', true],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => typeof window.__e2eSignIn === 'function', { timeout: 30000 });
const signedIn = await page.evaluate(
  async ([e, p]) => {
    try { await window.__e2eSignIn(e, p); return true; } catch (err) { return String(err); }
  },
  [EMAIL, PASSWORD],
);

console.log(`\n${C.b}── UI proof (${ROUTES.length} routes, signed in) ──${C.x}\n`);
console.log(`${C.b}Authentication${C.x}`);
check('the harness signs in against the Auth emulator', signedIn === true, String(signedIn));
if (signedIn !== true) {
  // Everything below would be measuring the login wall again. Fail loudly.
  console.log(`\n${C.r}${C.b}Cannot proceed without a session.${C.x}\n`);
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(3500);
const landed = new URL(page.url()).pathname;
check('a signed-in user lands on the app, not the sign-in wall', landed === '/', `landed on ${landed}`);

console.log(`\n${C.b}Every route renders its own content${C.x}`);
for (const [route, marker, isPublic] of ROUTES) {
  errors.length = 0;
  let body = '', url = route;
  try {
    await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 });
    // Wait for the CONTENT, not a fixed delay. Home does several Firestore
    // reads and builds the mission before it renders anything identifying, and
    // a flat 2.2s caught it mid-flight — a slow page and a broken page are not
    // the same failure, and a timeout cannot tell them apart. Pages that render
    // fast no longer pay for the slowest one either.
    await page
      .waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 15000 })
      .catch(() => { /* fall through: the assertion below reports what is missing */ });
    body = (await page.locator('body').innerText().catch(() => '')) || '';
    url = new URL(page.url()).pathname;
  } catch (e) {
    errors.push('NAV: ' + e.message);
  }
  const broke = /Something broke/i.test(body);
  // A route that redirects is a route that was not tested — '/mealplan' passed
  // for months on exactly that blindness.
  const redirected = url !== route;
  const hasMarker = body.includes(marker);
  const ok = !broke && !redirected && hasMarker && errors.length === 0;
  const why = errors.length ? 'threw: ' + errors[0].slice(0, 90)
    : broke ? 'ErrorBoundary shown'
    : redirected ? `redirected to ${url}`
    : !hasMarker ? `no "${marker}" in ${body.length} chars`
    : '';
  check(`${route.padEnd(18)}${isPublic ? ' (public)' : ''}`, ok, why);
}

await browser.close();

const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`);

// Exit EXPLICITLY, on BOTH paths. The dev server spawned above is a live child
// process, so the event loop never drains on its own — falling off the end of
// the module does not end the run, it hangs it. `shutdown` is bound to
// process.on('exit'), which cannot rescue that: 'exit' only fires once the
// process is already terminating, and the child is the very thing preventing it
// from terminating. The handler waits for an event that is waiting for it.
//
// The previous code exited explicitly on the FAILURE branch only, so the gate
// hung exactly when it PASSED: a green run left the dev server and both
// emulators alive and never returned control to `emulators:exec`. Run by hand
// it looked like a 20-minute stall after printing "100% success"; in CI it
// would burn the whole job timeout and report a green suite as a red build.
shutdown();
process.exit(fail === 0 ? 0 : 1);
