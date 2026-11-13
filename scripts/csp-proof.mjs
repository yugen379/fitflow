// CSP proof — npm run proof:csp
//
// Serves the PRODUCTION build with the full Content-Security-Policy ENFORCED
// (in firebase.json it is Report-Only), signs in, opens every route, searches
// for a food and opens the community, and fails on any resource the policy
// blocks. A policy that is one origin short does not throw: it shows up as a
// font that never loads or a button that does nothing. This is how it is seen
// before a user sees it.
//
// What it cannot reach: the real Google / Apple / Facebook sign-in popups,
// reCAPTCHA and Stripe on the live domain. That is why production only
// REPORTS violations (to Sentry) until it has run clean.
//
// Control: CSP_CONTROL=1 removes the fonts origin and the inline-script hashes
// from the policy and passes only if violations ARE reported.

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ROOT, directives, render, inlineScriptHashes, policyInFirebaseJson, reportUriFor } from './csp-policy.mjs';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${C.g}PASS${C.x} ${n}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);
const CONTROL = process.env.CSP_CONTROL === '1';

const DIST = ROOT + 'dist-e2e';
if (!existsSync(DIST + '/index.html')) { console.error('dist-e2e is missing: run the e2e build first (npm run proof:csp does).'); process.exit(1); }
const cfg = JSON.parse(readFileSync(ROOT + 'firebase-applet-config.json', 'utf8'));
const PORT = 4311;
const BASE = `http://127.0.0.1:${PORT}`;

// ── The policy under test ────────────────────────────────────────────────────
const shipped = policyInFirebaseJson();
const builtHtml = readFileSync(DIST + '/index.html', 'utf8');
const d = directives({ scriptHashes: inlineScriptHashes(builtHtml) });
// The emulators live on 127.0.0.1; production has no such entries.
d['connect-src'].push('http://127.0.0.1:*', 'ws://127.0.0.1:*');
d['frame-src'].push('http://127.0.0.1:*');
if (CONTROL) {
  d['script-src'] = d['script-src'].filter((s) => !s.startsWith("'sha256-"));
  d['style-src'] = d['style-src'].filter((s) => s !== 'https://fonts.googleapis.com');
}
const POLICY = render(d);

console.log(`\n${C.b}── CSP proof ${CONTROL ? '(CONTROL: a deliberately broken policy)' : '(policy enforced)'} ──${C.x}`);

if (!CONTROL) {
  section('The policy in firebase.json');
  check('firebase.json carries the Report-Only policy', !!shipped);
  const strip = (p) => String(p).replace(/; report-uri \S+$/, '');
  check('it is exactly the policy scripts/csp-policy.mjs produces (no hand edits, no drift)',
    strip(shipped) === render(directives()), 'run: node scripts/csp-policy.mjs --write');
  check('the inline theme script in the BUILT page is covered by a listed hash',
    inlineScriptHashes(builtHtml).every((h) => String(shipped).includes(h)), 'index.html changed: re-run csp-policy --write');
  check('violations are reported somewhere (Sentry)', /; report-uri https:\/\/\S+sentry\.io\/api\/\d+\/security\/\?sentry_key=[0-9a-f]{32}$/.test(String(shipped)));
  check('no unsafe-eval, and scripts are not allowed inline wholesale',
    !/unsafe-eval'/.test(String(shipped).replace(/'wasm-unsafe-eval'/g, '')) && !/script-src[^;]*'unsafe-inline'/.test(String(shipped)));
  check('reportUriFor only accepts a real DSN', reportUriFor('nonsense') === null && reportUriFor('https://' + 'a'.repeat(32) + '@o1.ingest.sentry.io/42') === 'https://o1.ingest.sentry.io/api/42/security/?sentry_key=' + 'a'.repeat(32));
}

// ── Serve the build with the policy enforced ─────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = normalize(join(DIST, url));
  if (!file.startsWith(normalize(DIST)) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': POLICY,
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ── Seed a signed-in user with something on every page ───────────────────────
const EMAIL = `csp-${Date.now()}@fitflow.test`;
const PASSWORD = 'csp-password-123';
const signUp = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const UID = signUp.localId;
if (!UID) { console.error('Could not create the emulator test user:', JSON.stringify(signUp)); process.exit(1); }
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: cfg.projectId });
const db = getFirestore(admin.app(), cfg.firestoreDatabaseId);
const now = Timestamp.now();
await db.doc(`users/${UID}`).set({
  uid: UID, displayName: 'CSP Tester', photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=csp', subscriptionType: 'free',
  trialStartedAt: now, age: 30, weight: 70, height: 175, goal: 'fat_loss', healthConditions: ['None'], dietaryPreferences: ['None'],
  streak: 1, currentStreak: 1, badges: ['pioneer'], points: 100, level: 2, createdAt: now, notificationsEnabled: false, activeChallenges: [],
});
await db.collection('posts').add({ userId: 'someone', username: 'Bob', userPhoto: 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob',
  content: 'A post with a remote avatar', likesCount: 0, commentsCount: 0, createdAt: now });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
// Runs before any page script, on every navigation; CSP does not apply to it.
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(`${e.effectiveDirective}  ${e.blockedURI || '(inline)'}`);
  });
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const violations = new Map(); // "directive  uri" -> first route seen on
const collect = async (where) => {
  const found = await page.evaluate(() => window.__csp || []).catch(() => []);
  for (const v of found) if (!violations.has(v)) violations.set(v, where);
};

await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => typeof window.__e2eSignIn === 'function', null, { timeout: 30000 }).catch(() => {});
const signed = await page.evaluate(async ([e, p]) => {
  try { await window.__e2eSignIn(e, p); return true; } catch (err) { return String(err); }
}, [EMAIL, PASSWORD]).catch((e) => String(e));

section('Every screen, with the policy enforced');
if (CONTROL && signed !== true) {
  // Expected: with the script hash removed the app may not even boot.
  await collect('boot');
} else {
  check('the app boots and signs in under the policy', signed === true, String(signed));
  if (signed !== true) { await collect('boot'); for (const [v, w] of violations) console.log(`    ${C.d}${w}: ${v}${C.x}`); await browser.close(); server.close(); process.exit(1); }
  await page.waitForFunction(() => document.body.innerText.includes('MISSION'), null, { timeout: 30000 }).catch(() => {});
  await collect('/');

  const ROUTES = [
    ['/', 'MISSION'], ['/track', 'DAILY FUEL'], ['/workout', 'TRAIN'], ['/community', 'COMMUNITY'], ['/profile', 'CSP'],
    ['/wellness', 'RECOVERY'], ['/explore', 'OUTDOOR'], ['/library', 'LIBRARY'], ['/analytics', 'ANALYTICS'],
    ['/meal-plan', 'MEAL PLANS'], ['/challenges', 'COMPETE'], ['/settings', 'SETTINGS'], ['/pro', 'Monthly'],
    ['/coach', 'AI COACH'], ['/nutrition-goals', 'MACRO SPLIT'], ['/lab', 'BIOMECHANICS LAB'], ['/steps', 'STEP ANALYTICS'],
    ['/achievements', 'ACHIEVEMENTS'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service'],
    ['/delete-account.html', 'Delete your FitFlow account'],
  ];
  const blank = [];
  for (const [route, marker] of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    const ok = await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!ok) blank.push(route);
    await page.waitForTimeout(700); // late loads: fonts, images, lazy chunks, workers
    await collect(route);
  }
  check(`all ${ROUTES.length} routes render their own content`, blank.length === 0, `did not render: ${blank.join(', ')}`);

  // Things that only load when used.
  await page.goto(BASE + '/track', { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  const search = page.locator('input[placeholder^="Search foods"]');
  await search.waitFor({ timeout: 20000 }).catch(() => {});
  await search.fill('nasi lemak').catch(() => {});
  const searched = await page.locator('text=Tap to log instantly').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(2500); // the branded lookup (callable) and USDA
  await collect('/track search');
  check('food search works under the policy', searched);

  // The web fonts load as a print stylesheet and are switched on by script.
  // If that switch is blocked the app still renders, in the wrong typeface.
  const fontsOn = await page.evaluate(() => document.getElementById('ff-fonts')?.media).catch(() => null);
  if (CONTROL) check('control: with the script hash removed the fonts are never switched on', fontsOn !== 'all', String(fontsOn));
  else check('the web fonts stylesheet is switched on (media=all)', fontsOn === 'all', String(fontsOn));
}

await browser.close();
server.close();

section(CONTROL ? 'Violations (expected here)' : 'Nothing was blocked');
for (const [v, w] of violations) console.log(`    ${C.d}${w.padEnd(20)} ${v}${C.x}`);
if (CONTROL) {
  check('the broken policy is caught: violations are reported', violations.size > 0, 'no violation seen, so this proof would miss a real one');
  const kinds = [...violations.keys()].join(' ');
  check('both removed entries show up (inline script and the fonts stylesheet)',
    /script-src/.test(kinds) && /style-src[^ ]*\s+https:\/\/fonts\.googleapis\.com/.test(kinds), kinds.slice(0, 200));
} else {
  check('the policy blocked nothing on any screen', violations.size === 0, `${violations.size} distinct violation(s)`);
  check('no page error was thrown', pageErrors.length === 0, pageErrors[0]?.slice(0, 140) || '');
}

console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
process.exit(fail === 0 ? 0 : 1);
