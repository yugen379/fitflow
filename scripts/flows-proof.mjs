// Flow proof — npm run proof:flows
//
// proof:ui shows that every page renders. This one USES the app: it signs in,
// searches for food and logs it, quick-adds by typing, then posts, likes,
// comments and edits in the community — and after each step reads Firestore
// with the Admin SDK to see what was really written, under the real rules.
//
// These are the flows the security rules and the food search rebuild touched.
// A rule that is one field too strict does not throw on a page load; it shows
// up as a like that silently does nothing. Only doing the thing finds that.
//
// Control: run it against the previous firestore.rules and "the author can edit
// their post" must FAIL (the old rules refused every edit).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${C.g}PASS${C.x} ${n}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const BASE = 'http://127.0.0.1:3000';
const EMAIL = `flows-${Date.now()}@fitflow.test`;
const PASSWORD = 'flows-password-123';

let server;
const shutdown = () => {
  const pid = server?.pid;
  if (!pid) return;
  try {
    // shell:true on Windows makes `pid` the npx.cmd wrapper; /T takes the tree.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
  } catch { /* already gone */ }
};
process.on('exit', shutdown);
const finish = (code) => { shutdown(); process.exit(code); };

// ── Seed ─────────────────────────────────────────────────────────────────────
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
const NAME = 'Flow Tester';
await db.doc(`users/${UID}`).set({
  uid: UID, displayName: NAME, photoURL: '', subscriptionType: 'free', trialStartedAt: now,
  age: 30, weight: 70, height: 175, goal: 'fat_loss', healthConditions: ['None'], dietaryPreferences: ['None'],
  streak: 1, currentStreak: 1, badges: ['pioneer'], points: 100, level: 2,
  createdAt: now, notificationsEnabled: false, activeChallenges: [],
});
const BOB_POST = `bobPost${Date.now()}`;
const BOB_TEXT = `Bob ran five k ${Date.now()}`;
await db.doc(`posts/${BOB_POST}`).set({
  userId: 'bob_uid_flows', username: 'Bob', userPhoto: '', content: BOB_TEXT,
  likesCount: 0, commentsCount: 0, createdAt: now,
});

// A previous run's dev server still holding the port answers this fetch, and
// the run would then drive a server that is being torn down (or wait for ever
// on one that has stopped answering). Refuse to start instead.
if (await fetch(BASE, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false)) {
  console.error(`Something is already serving ${BASE}. A previous run's dev server is still alive: close it and run again.`);
  process.exit(1);
}
server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'server.ts'], {
  env: { ...process.env, VITE_USE_EMULATORS: 'true' }, stdio: 'ignore', shell: process.platform === 'win32',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(BASE, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* not yet */ }
  if (!up) await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { console.error('dev server never came up on', BASE); finish(1); }

// ── Helpers ──────────────────────────────────────────────────────────────────
// Poll Firestore until `read` returns something truthy; the UI write is async.
const until = async (read, ms = 15000) => {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return v;
};
const mealNamed = (prefix) => async () => {
  const snap = await db.collection('meals').where('userId', '==', UID).get();
  const hit = snap.docs.map((d) => d.data()).find((m) => String(m.name).toLowerCase().startsWith(prefix.toLowerCase()));
  return hit || null;
};

const browser = await chromium.launch();
// A small phone (360x640): the size at which a list that opens low on the page is actually hidden.
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
const page = await ctx.newPage();
// The level-up card (v1.6.10) can appear whenever XP crosses a level; tap it
// away like a user would, wherever it interrupts.
await page.addLocatorHandler(page.locator('[role="dialog"][aria-label^="Level"]'), async (d) => {
  await d.locator('button').first().click().catch(() => {});
});
const pageErrors = [];
const denied = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// A run must never talk to the PRODUCTION backend: an emulator token there is
// refused, which looks exactly like a rules bug.
const prodCalls = [];
page.on('request', (r) => { const u = r.url(); if (/^https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com/.test(u)) prodCalls.push(`${page.url()} -> ${u.slice(0, 90)}`); });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && /permission|insufficient/i.test(t)) denied.push(t.slice(0, 700));
});

await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => typeof window.__e2eSignIn === 'function', { timeout: 30000 });
const signedIn = await page.evaluate(async ([e, p]) => {
  try { await window.__e2eSignIn(e, p); return true; } catch (err) { return String(err); }
}, [EMAIL, PASSWORD]);

console.log(`\n${C.b}── Flow proof (signed in, real rules) ──${C.x}`);
section('Sign-in');
check('the harness signs in against the Auth emulator', signedIn === true, String(signedIn));
if (signedIn !== true) { await browser.close(); finish(1); }
await page.waitForTimeout(3000);

// ── Food search ──────────────────────────────────────────────────────────────
section('Track: search for a food and log it');
await page.goto(BASE + '/track', { waitUntil: 'load', timeout: 45000 });
const search = page.locator('input[placeholder^="Search foods"]');
await search.waitFor({ timeout: 20000 });
await search.fill('nasi lemka'); // typo on purpose
const rows = page.locator('text=Tap to log instantly').locator('xpath=..').locator('button');
await rows.first().waitFor({ timeout: 15000 }).catch(() => {});
const rowNames = await rows.locator('p.text-sm').allInnerTexts().catch(() => []);
check('a misspelt "nasi lemka" offers Nasi Lemak first', (rowNames[0] || '').startsWith('Nasi Lemak'), rowNames.slice(0, 3).join(' | ') || '(no results)');
check('the list offers several matches', rowNames.length >= 3, `${rowNames.length} rows`);

// The results open under a field that sits low on the page. Without help they
// are behind the dock (and the keyboard, on a phone): the page must bring the
// field up so the first results are on screen without the user scrolling.
await page.waitForTimeout(900); // the smooth scroll
const firstBox = await rows.first().boundingBox().catch(() => null);
const dockTop = await page.evaluate(() => document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect().top ?? window.innerHeight);
check('the first result is on screen and above the dock, with no scrolling by the user',
  !!firstBox && firstBox.y >= 0 && firstBox.y + firstBox.height <= dockTop, `row ${JSON.stringify(firstBox)} dock top ${Math.round(dockTop)}`);

// Every row must be reachable inside the viewport, and the list must not push
// the page sideways.
const lastRow = rows.last();
await lastRow.scrollIntoViewIfNeeded().catch(() => {});
const box = await lastRow.boundingBox().catch(() => null);
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the last result can be brought on screen', !!box && box.y >= 0 && box.y + box.height <= 640, JSON.stringify(box));
check('the results do not cause sideways scrolling', sideways <= 1, `${sideways}px wider than the screen`);

await rows.first().scrollIntoViewIfNeeded().catch(() => {});
await rows.first().click();
const lemak = await until(mealNamed('Nasi Lemak'));
check('tapping it writes the meal, with the catalog numbers', !!lemak && lemak.calories === 644 && lemak.protein === 17,
  lemak ? `${lemak.name}: ${lemak.calories} kcal, P${lemak.protein}` : 'no meal written');

// ── Quick-add ────────────────────────────────────────────────────────────────
section('Track: quick-add by typing');
// v1.6.10 celebrates a level-up with a card; a user taps it away.
const dismissLevelUp = async () => {
  const go = page.locator('[role="dialog"][aria-label^="Level"] button');
  if (await go.count()) { await go.first().click().catch(() => {}); await page.waitForTimeout(300); }
};
const quickAdd = async (text) => {
  await dismissLevelUp();
  await page.locator('button[aria-label="Add meal"]').click();
  const box2 = page.locator('textarea[placeholder^="e.g. a bowl"]');
  await box2.waitFor({ timeout: 10000 });
  await box2.fill(text);
  // v1.6.10: Analyse shows a review list first; nothing is written until the
  // user confirms "Log N kcal" (an AI misread used to go straight into the diary).
  await page.locator('button.btn-3d', { hasText: 'Analyse' }).click();
  const confirm = page.locator('button.btn-3d', { hasText: /^Log \d+ kcal$/ });
  await confirm.waitFor({ timeout: 60000 }).catch(() => {});
  if (await confirm.count()) await confirm.click();
  // The sheet closes itself when the log lands (or falls through to manual).
  await box2.waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
};

// The review step must not write anything before confirmation.
section('Track: AI review writes nothing until confirmed');
{
  await dismissLevelUp();
  await page.locator('button[aria-label="Add meal"]').click();
  const box3 = page.locator('textarea[placeholder^="e.g. a bowl"]');
  await box3.waitFor({ timeout: 10000 });
  await box3.fill('telur mata');
  await page.locator('button.btn-3d', { hasText: 'Analyse' }).click();
  const confirm = page.locator('button.btn-3d', { hasText: /^Log \d+ kcal$/ });
  await confirm.waitFor({ timeout: 60000 });
  const early = await mealNamed('Fried Egg')();
  check('nothing is written while the review is open', !early, early ? `${early.name} written early` : '');
  await page.locator('button[aria-label="Close"]').first().click();
  await box3.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
}
await quickAdd('telur mata');
const egg = await until(mealNamed('Fried Egg'));
check('"telur mata" logs Fried Egg from the bundled list', !!egg && egg.calories === 90, egg ? `${egg.name}: ${egg.calories}` : 'no meal written');

await quickAdd('3 eggs');
const three = await until(mealNamed('3 eggs'), 45000);
const wrongEggs = await mealNamed('Eggs (2 large')();
check('"3 eggs" is logged as three eggs (234 kcal), not the listed two', !!three && three.calories === 234 && !wrongEggs,
  three ? `${three.name}: ${three.calories}` : wrongEggs ? `logged ${wrongEggs.name}: ${wrongEggs.calories}` : 'no meal written');

// ── Meal pipeline: AI names ingredients + grams, the app does the math ────────
// The proxy's decomposeMeal answer is fixed here (the model is not under test);
// what is tested is that every number on screen and in Firestore is the app's
// own (grams / 100) * per-100 g, the oil choice, gram edits and the hint retry.
section('Track: itemised meal (grams x per-100 g, oil, hint)');
{
  const seen = [];
  await page.route('**/geminiProxy', async (route) => {
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch { /* not JSON */ }
    if (body.action !== 'decomposeMeal') return route.fallback();
    const p = body.payload || {};
    seen.push({ text: p.text, hint: p.hint || '' });
    const reply = /mystery stew/.test(p.text || '')
      ? (p.hint
        ? { ok: true, obscured: false, items: [{ ingredient_name: 'beef rendang', estimated_grams: 150, confidence: 0.8, method: 'saucy', calories: 9999 }] }
        : { ok: true, obscured: true, items: [] })
      : { ok: true, obscured: false, items: [
          // calories: 9999 is ignored on purpose: the app must never use a model total.
          { ingredient_name: 'white rice', estimated_grams: 200, confidence: 0.9, method: 'boiled', calories: 9999 },
          { ingredient_name: 'mixed vegetables', estimated_grams: 150, confidence: 0.9, method: 'stir_fried' },
        ] };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });

  const open = async (text) => {
    await dismissLevelUp();
    await page.locator('button[aria-label="Add meal"]').click();
    const box = page.locator('textarea[placeholder^="e.g. a bowl"]');
    await box.waitFor({ timeout: 10000 });
    await box.fill(text);
    await page.locator('button.btn-3d', { hasText: 'Analyse' }).click();
  };
  const logBtn = page.locator('button.btn-3d', { hasText: /^Log \d+ kcal$/ });
  const logLabel = async () => (await logBtn.innerText().catch(() => '')).trim();

  await open('rice and stir fried veg');
  await logBtn.waitFor({ timeout: 30000 }).catch(() => {});
  const kcals = await page.locator('[data-testid="line-kcal"]').allInnerTexts().catch(() => []);
  check('rows are grams x per-100 g: rice 200 g = 260, veg 150 g = 98', kcals.join(',') === '260,98', kcals.join(','));
  const oilLight = page.locator('[role="radio"][aria-checked="true"]', { hasText: 'light' });
  check('stir-fried food pre-selects light cooking oil', (await oilLight.count()) === 1);
  check('total = 260 + 98 + 4 g oil (35) = 393, not the model\'s 9999', (await logLabel()) === 'Log 393 kcal', await logLabel());
  await page.locator('button[aria-label="More white rice"]').click();
  check('+ on rice: 225 g -> 293 kcal, total 426', (await logLabel()) === 'Log 426 kcal', await logLabel());
  await page.locator('[role="radio"]', { hasText: 'none' }).click();
  check('oil "none" removes exactly 35 kcal', (await logLabel()) === 'Log 391 kcal', await logLabel());
  const early = await mealNamed('white rice')();
  check('nothing is written before Log', !early);
  await logBtn.click();
  const riceRow = await until(mealNamed('white rice (225 g)'));
  const vegRow = await until(mealNamed('mixed vegetables (150 g)'));
  const oilRow = await mealNamed('Cooking oil')();
  check('Firestore gets the app\'s numbers: rice 293, veg 98, no oil row',
    riceRow?.calories === 293 && vegRow?.calories === 98 && !oilRow,
    `${riceRow?.calories} / ${vegRow?.calories} / oil ${oilRow ? oilRow.calories : 'none'}`);

  // Low confidence: the model says it can't see what is in it -> ask once.
  await open('mystery stew');
  const hintBox = page.locator('input[aria-label="What is in the meal"]');
  await hintBox.waitFor({ timeout: 30000 }).catch(() => {});
  check('an obscured meal asks for a short hint', (await hintBox.count()) === 1);
  await hintBox.fill('beef rendang');
  await page.locator('button.btn-3d', { hasText: 'Check again' }).click();
  await logBtn.waitFor({ timeout: 30000 }).catch(() => {});
  check('the hint is sent and decomposition re-runs', seen.some((s) => s.hint === 'beef rendang'), JSON.stringify(seen.slice(-2)));
  check('rendang 150 g = 300 kcal; it already has its fat, so no oil choice',
    (await logLabel()) === 'Log 300 kcal' && (await page.locator('[role="radiogroup"][aria-label="Cooking oil"]').count()) === 0, await logLabel());
  await logBtn.click();
  const rendang = await until(mealNamed('beef rendang (150 g)'));
  check('logged as beef rendang (150 g), 300 kcal', rendang?.calories === 300, rendang ? `${rendang.name}: ${rendang.calories}` : 'none');
  await page.unroute('**/geminiProxy');
}

// ── Edit / delete a logged meal (v1.6.10) ───────────────────────────────────
section('Track: delete a logged meal');
{
  await dismissLevelUp();
  const row = page.locator('[aria-label^="Edit Fried Egg"]').first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click();
  const del = page.locator('button', { hasText: /(Delete|Tap to confirm)/ });
  await del.first().click();   // arms
  await del.first().click();   // confirms
  let gone = false;
  for (let i = 0; i < 30 && !gone; i++) { gone = !(await mealNamed('Fried Egg')()); if (!gone) await page.waitForTimeout(500); }
  check('two taps on Delete remove the meal from Firestore', gone);
}

// ── Branded products ─────────────────────────────────────────────────────────
// The answer is seeded into the server's search memory, so the real callable
// runs end to end without this gate depending on Open Food Facts being up.
section('Track: a packaged product from Open Food Facts');
await db.doc('food_search_cache/zzbrand-spread').set({
  q: 'zzbrand-spread', at: Date.now(),
  foods: [{ name: 'ZZBrand Hazelnut Spread (100g)', calories: 540, protein: 6, carbs: 58, fats: 31, brand: 'ZZBrand', code: '1234567890123', source: 'OFF' }],
});
// The serving size comes from Open Food Facts' product record, read by the app
// itself. Answered here, so the gate does not depend on their service.
let servingLookups = 0;
await page.route('**/world.openfoodfacts.org/api/v2/product/**', (route) => {
  servingLookups++;
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ product: { serving_size: '1 portion (15 g)', serving_quantity: 15 } }) });
});
await search.fill('zzbrand spread');
const brandedRow = rows.filter({ hasText: 'ZZBrand Hazelnut Spread' });
await brandedRow.first().waitFor({ timeout: 25000 }).catch(() => {});
check('the branded product appears in the results', (await brandedRow.count()) === 1, `${await brandedRow.count()} matching rows`);
check('Open Food Facts is credited beside it', await page.locator('text=Open Food Facts (ODbL)').isVisible().catch(() => false));
await brandedRow.first().click().catch(() => {});
const amount = page.locator('input[aria-label="Amount in grams"]');
await amount.waitFor({ timeout: 10000 }).catch(() => {});
const kcalField = page.locator('label', { hasText: 'Calories (kcal)' }).locator('xpath=following-sibling::input');
check('tapping it opens the entry sheet at 100 g / 540 kcal instead of logging',
  (await amount.inputValue().catch(() => '')) === '100' && (await kcalField.inputValue().catch(() => '')) === '540'
  && !(await mealNamed('ZZBrand')()), `amount ${await amount.inputValue().catch(() => '?')}, kcal ${await kcalField.inputValue().catch(() => '?')}`);
// With the keyboard up a phone has about 420 px of height left. A bottom sheet
// with no height limit grows upward off the screen there, taking its name field
// and close button with it. It must stay inside the screen and scroll instead.
await page.setViewportSize({ width: 360, height: 420 });
await page.waitForTimeout(400);
const sheetBox = await amount.locator('xpath=ancestor::div[contains(@class,"rounded-t-3xl")][1]').boundingBox().catch(() => null);
check('with the keyboard up (420 px tall) the entry sheet stays on screen and scrolls',
  !!sheetBox && sheetBox.y >= 0 && sheetBox.height <= 420, JSON.stringify(sheetBox));
await page.setViewportSize({ width: 360, height: 640 });
await page.waitForTimeout(300);

const servingBtn = page.locator('button', { hasText: '1 serving · 1 portion (15 g)' });
await servingBtn.waitFor({ timeout: 10000 }).catch(() => {});
check('the pack\'s own serving is offered ("1 portion (15 g)"), looked up once by barcode',
  (await servingBtn.count()) === 1 && servingLookups === 1, `${await servingBtn.count()} button(s), ${servingLookups} lookup(s)`);
await servingBtn.click().catch(() => {});
check('one tap on it sets 15 g and 81 kcal',
  (await amount.inputValue().catch(() => '')) === '15' && (await kcalField.inputValue().catch(() => '')) === '81',
  `amount ${await amount.inputValue().catch(() => '?')}, kcal ${await kcalField.inputValue().catch(() => '?')}`);
await amount.fill('30');
check('changing the amount to 30 g rescales the calories to 162', (await kcalField.inputValue().catch(() => '')) === '162', await kcalField.inputValue().catch(() => '?'));
await page.locator('button.btn-3d', { hasText: 'Log meal' }).click().catch(() => {});
const spread = await until(mealNamed('ZZBrand Hazelnut Spread (30g)'));
check('logging writes 30 g of it: 162 kcal, P2 C17 F9',
  !!spread && spread.calories === 162 && spread.protein === 2 && spread.carbs === 17 && spread.fats === 9,
  spread ? `${spread.name}: ${spread.calories} kcal P${spread.protein} C${spread.carbs} F${spread.fats}` : 'no meal written');



// ── Unknown barcode -> photo of its label -> shared with everyone ─────────────
// A real EAN-13 image is drawn in the browser (in-store prefix 200, so it can
// never be a real product). Open Food Facts and USDA are answered "not found"
// and the AI label read is fixed, so this checks the app, not those services.
section('Scanner: unknown barcode -> label photo -> shared catalog');
{
  const ean13 = (twelve) => {
    const d = twelve.split('').map(Number);
    const sum = d.reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
    return twelve + ((10 - (sum % 10)) % 10);
  };
  const drawEan = async (code) => {
    const p = await ctx.newPage();
    await p.setContent('<canvas id="c" width="360" height="200" style="background:#fff"></canvas>');
    await p.evaluate((code) => {
      const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
      const G = L.map((s) => s.split('').map((b) => (b === '0' ? '1' : '0')).reverse().join(''));
      const R = L.map((s) => s.split('').map((b) => (b === '0' ? '1' : '0')).join(''));
      const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
      const n = code.split('').map(Number);
      let bits = '101';
      for (let i = 1; i <= 6; i++) bits += (PAR[n[0]][i - 1] === 'L' ? L : G)[n[i]];
      bits += '01010';
      for (let i = 7; i <= 12; i++) bits += R[n[i]];
      bits += '101';
      const c = document.getElementById('c'); const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
      const w = 3, left = (c.width - bits.length * w) / 2;
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') x.fillRect(left + i * w, 20, w, 160);
    }, code);
    const png = await p.locator('#c').screenshot();
    await p.close();
    return png;
  };

  const CODE = ean13(String(200000000000 + (Date.now() % 1_000_000_000)).slice(0, 12));
  const BAD = ean13(String(200000000000 + ((Date.now() + 7) % 1_000_000_000)).slice(0, 12));
  const good = await drawEan(CODE);
  const bad = await drawEan(BAD);

  let labelCalls = 0;
  const notFound = (route) => route.fulfill({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"status":0}' });
  await page.route('**/world.openfoodfacts.org/**', notFound);
  await page.route('**/*.openfoodfacts.org/**', notFound);
  await page.route('**/api.nal.usda.gov/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"foods":[],"totalHits":0}' }));
  await page.route('**/geminiProxy', async (route) => {
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch { /* not JSON */ }
    if (body.action !== 'analyzeNutritionLabel') return route.fallback();
    labelCalls++;
    // The second barcode's "label" is a misread: per-serving kcal next to per-100 g macros.
    const misread = labelCalls > 1;
    const reply = misread
      ? { name: 'ZZLabel Misread Bar', calories: 60, protein: 7, carbs: 65, fats: 18 }
      : { name: 'ZZLabel Kaya Puff', brand: 'ZZTest', calories: 450, protein: 7, carbs: 65, fats: 18 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });

  const openScan = async () => {
    await page.goto(BASE + '/track', { waitUntil: 'load', timeout: 45000 });
    await dismissLevelUp();
    await page.locator('button', { hasText: /^Scan$/ }).first().click();
    await page.locator('[data-testid^="barcode-file"]').first().waitFor({ state: 'attached', timeout: 15000 });
  };
  const upload = (png) => page.locator('[data-testid^="barcode-file"]').first().setInputFiles({ name: 'barcode.png', mimeType: 'image/png', buffer: png });

  // 1) Unknown barcode: no manual form, a label step instead.
  await openScan();
  await upload(good);
  const step = page.locator('[data-testid="label-step"]');
  await step.waitFor({ timeout: 30000 }).catch(() => {});
  const stepText = (await step.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('an unknown barcode asks for a photo of its label', stepText.includes(CODE), stepText.slice(0, 160) || ('no label step; screen: ' + (await page.locator('.rounded-3xl').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)));
  if (!stepText.includes(CODE)) await page.screenshot({ path: process.env.TEMP + '/label-fail.png' });

  // 2) The label photo is read and shown per 100 g.
  await page.locator('[data-testid="label-file"]').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: good });
  const product = page.locator('p', { hasText: 'ZZLabel Kaya Puff' });
  await product.waitFor({ timeout: 20000 }).catch(() => {});
  check('the label read is shown (Kaya Puff, 450 kcal / 100 g)', await product.count() > 0);

  // 3) Logging 100 g writes 450 kcal AND shares the label under the barcode.
  await page.locator('button.btn-3d', { hasText: /^Log$/ }).click().catch(() => {});
  const puff = await until(mealNamed('ZZLabel Kaya Puff'));
  check('logging 100 g writes 450 kcal', puff?.calories === 450, puff ? `${puff.calories}` : 'no meal');
  const sharedDoc = await until(async () => {
    const d = await db.doc(`food_catalog/barcode-${CODE}`).get();
    return d.exists ? d.data() : null;
  });
  check('the label is saved for everyone under its barcode (per 100 g)', sharedDoc?.calories === 450 && sharedDoc?.name === 'ZZLabel Kaya Puff', JSON.stringify(sharedDoc || {}));

  // 4) The next scan of that barcode is instant: no AI call, tagged as a user label.
  const callsBefore = labelCalls;
  await openScan();
  await upload(good);
  const tag = page.locator('text=From a FitFlow user\'s label');
  await tag.waitFor({ timeout: 20000 }).catch(() => {});
  check('a second scan finds it in the shared catalog', await tag.count() > 0);
  check('...without reading the label again', labelCalls === callsBefore, `label reads ${callsBefore} -> ${labelCalls}`);

  // 5) A misread label is refused and nothing is shared.
  await openScan();
  await upload(bad);
  await step.waitFor({ timeout: 30000 }).catch(() => {});
  await page.locator('[data-testid="label-file"]').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: bad });
  const warn = page.locator('text=/numbers don.t add up/');
  await warn.waitFor({ timeout: 20000 }).catch(() => {});
  check('a label whose numbers do not add up is refused with a reason', await warn.count() > 0);
  const badDoc = await db.doc(`food_catalog/barcode-${BAD}`).get();
  check('...and nothing is shared for it', !badDoc.exists);

  await page.unroute('**/geminiProxy');
  await page.unroute('**/world.openfoodfacts.org/**');
  await page.unroute('**/*.openfoodfacts.org/**');
  await page.unroute('**/api.nal.usda.gov/**');
}
// ── Smart target (adaptive calories) ─────────────────────────────────────────
// Four weeks of history: 1,700 kcal logged every day while the scale falls
// 72.0 -> 70.5 kg (about 0.42 kg a week). Real burn = 1700 + 0.06 x 7700 ≈ 2160.
// The user's target is set to 2,200, so the card must suggest lowering it by
// one step (200) to 2,000, and the button must save exactly that.
section('Smart target: real burn from logs + weigh-ins');
{
  const dayAt = (back, h = 12) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() - back); return Timestamp.fromDate(d); };
  const batch = db.batch();
  for (let back = 25; back >= 1; back--) {
    for (const [h, kcal] of [[8, 500], [13, 700], [19, 500]]) {
      batch.set(db.collection('meals').doc(), { userId: UID, name: 'Seeded meal', calories: kcal, protein: 30, carbs: 50, fats: 15, mealType: 'lunch', timestamp: dayAt(back, h) });
    }
  }
  for (let back = 25; back >= 1; back -= 2) {
    batch.set(db.collection('weight_history').doc(), { userId: UID, weight: Math.round((70.5 + (back / 25) * 1.5) * 10) / 10, timestamp: dayAt(back, 7) });
  }
  await batch.commit();
  await db.doc(`users/${UID}`).update({ macroTargets: { mode: 'percent', calorieTarget: 2200 } });

  await page.goto(BASE + '/nutrition-goals', { waitUntil: 'load', timeout: 45000 });
  const card = page.locator('[data-testid="smart-target"]');
  await card.waitFor({ timeout: 20000 }).catch(() => {});
  const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
  const burn = Number((text.match(/(\d{4}) real burn/i) || [])[1]);
  check('card shows a real burn near 2,160', burn >= 2080 && burn <= 2240, text.slice(0, 160));
  check('card shows the weekly loss (~ -0.4 kg)', /-0\.(3|4|5)\d kg \/ week/i.test(text), text.slice(0, 200));
  const btn = card.locator('button', { hasText: 'Lower target to 2000 kcal' });
  check('suggests lowering one step, to 2,000', await btn.count() === 1, text.slice(0, 200));
  await btn.click().catch(() => {});
  const saved = await until(async () => {
    const t = (await db.doc(`users/${UID}`).get()).data()?.macroTargets?.calorieTarget;
    return t === 2000 ? t : null;
  }, 15000);
  check('the button saves 2,000 as the daily target', saved === 2000, `saved ${saved}`);
  // Applying returns to the previous screen; let that finish before moving on.
  await page.waitForURL((u) => !u.pathname.includes('nutrition-goals'), { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('load').catch(() => {});
}
// ── Community ────────────────────────────────────────────────────────────────
section('Community: post, like, comment, edit');
await page.goto(BASE + '/community', { waitUntil: 'load', timeout: 45000 });
await page.locator('p', { hasText: BOB_TEXT }).waitFor({ timeout: 20000 }).catch(() => {});

const MY_TEXT = `Leg day done ${Date.now()}`;
await page.locator('button[aria-label="New post"]').click();
const composer = page.locator('textarea[placeholder^="What did you crush"]');
await composer.waitFor({ timeout: 10000 });
await composer.fill(MY_TEXT);
await page.locator('button.btn-3d', { hasText: 'Post' }).click();
const myPost = await until(async () => {
  const s = await db.collection('posts').where('userId', '==', UID).get();
  return s.docs.find((d) => d.data().content === MY_TEXT) || null;
});
if (!myPost) {
  // Say what was on screen: "no post written" alone does not tell a refused
  // write from a page that never rendered or a button that was never reached.
  const seen = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
  console.log(`    ${C.d}on screen: ${seen}${C.x}`);
  console.log(`    ${C.d}production calls: ${prodCalls.length} ${prodCalls.slice(0, 3).join(' | ')}${C.x}`);
  console.log(`    ${C.d}url: ${page.url()}  refused: ${denied.slice(0, 2).join(' | ') || 'none'}  page errors: ${pageErrors.slice(0, 2).join(' | ') || 'none'}${C.x}`);
  if (process.env.FLOWS_SHOT_DIR) await page.screenshot({ path: `${process.env.FLOWS_SHOT_DIR}/flows-community-fail.png` }).catch(() => {});
}
check('a new post is written under the author\'s own name, with zero counts',
  !!myPost && myPost.data().username === NAME && myPost.data().likesCount === 0 && myPost.data().commentsCount === 0,
  myPost ? JSON.stringify({ u: myPost.data().username, l: myPost.data().likesCount }) : 'no post written');

const actions = page.locator('p', { hasText: BOB_TEXT }).locator('xpath=following-sibling::div[1]//button');
await actions.nth(0).click();
const liked = await until(async () => (await db.doc(`posts/${BOB_POST}/likes/${UID}`).get()).exists);
const afterLike = (await db.doc(`posts/${BOB_POST}`).get()).data();
check('liking a post writes the like and raises the count to 1', !!liked && afterLike.likesCount === 1, `like doc ${!!liked}, count ${afterLike.likesCount}`);
await actions.nth(0).click();
await page.waitForTimeout(1500);
check('liking it again does not count twice', (await db.doc(`posts/${BOB_POST}`).get()).data().likesCount === 1,
  String((await db.doc(`posts/${BOB_POST}`).get()).data().likesCount));

await actions.nth(1).click();
const commentBox = page.locator('input[placeholder^="Write a comment"]');
await commentBox.waitFor({ timeout: 10000 });
await commentBox.fill('Strong pace');
// Scoped to the comment field's own row: another Send button exists on the page.
await commentBox.locator('xpath=..').locator('button[aria-label="Send"]').click();
const comment = await until(async () => {
  const s = await db.collection(`posts/${BOB_POST}/comments`).get();
  return s.docs.map((d) => d.data()).find((c) => c.content === 'Strong pace') || null;
});
const afterComment = (await db.doc(`posts/${BOB_POST}`).get()).data();
check('a comment is written under the author\'s own name and the count goes to 1',
  !!comment && comment.username === NAME && comment.userId === UID && afterComment.commentsCount === 1,
  comment ? `count ${afterComment.commentsCount}` : 'no comment written');
await page.keyboard.press('Escape').catch(() => {});
await page.locator('button[aria-label="Close"]').first().click({ timeout: 3000 }).catch(() => {});

const EDITED = MY_TEXT + ' (edited)';
const mine = page.locator('p', { hasText: MY_TEXT });
await mine.waitFor({ timeout: 15000 }).catch(() => {});
await mine.locator('xpath=ancestor::div[.//button[@aria-label="More options"]][1]//button[@aria-label="More options"]').click();
const editor = page.locator('textarea[placeholder^="Edit your post"]');
await editor.waitFor({ timeout: 10000 });
await editor.fill(EDITED);
await page.locator('button.btn-3d', { hasText: 'Save' }).click();
const edited = myPost ? await until(async () => (await myPost.ref.get()).data()?.content === EDITED, 10000) : false;
check('the author can edit their post', edited === true, myPost ? `content is "${(await myPost.ref.get()).data()?.content}"` : 'no post to edit');

// ── A reload straight after signing in ───────────────────────────────────────
// The profile listen can go out before Firestore has picked up the restored
// sign-in; the rules then see nobody and refuse it. That used to strand the user
// on "Can't reach your data" until they pressed Try again. Three fresh accounts,
// each reloaded the instant sign-in returns, must all reach Home by themselves.
section('Reloading the instant after sign-in');
const stranded = [];
for (let i = 1; i <= 3; i++) {
  const email = `reload-${i}-${Date.now()}@fitflow.test`;
  const made = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  }).then((r) => r.json());
  await db.doc(`users/${made.localId}`).set({
    uid: made.localId, displayName: `Reload ${i}`, photoURL: '', subscriptionType: 'free', trialStartedAt: now,
    age: 30, weight: 70, height: 175, goal: 'fat_loss', healthConditions: ['None'], dietaryPreferences: ['None'],
    streak: 1, badges: ['pioneer'], points: 100, level: 2, createdAt: now, notificationsEnabled: false, activeChallenges: [],
  });
  const c2 = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const p2 = await c2.newPage();
  await p2.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await p2.waitForFunction(() => typeof window.__e2eSignIn === 'function', { timeout: 30000 });
  await p2.evaluate(async ([e, p]) => { await window.__e2eSignIn(e, p); }, [email, PASSWORD]);
  await p2.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 }); // no settle time, on purpose
  const outcome = await p2.waitForFunction(() => {
    const t = document.body.innerText;
    // The error screen is only "final" if it is still there after the retries could have run.
    return t.includes('MISSION') ? 'home' : null;
  }, null, { timeout: 15000 }).then(() => 'home').catch(async () =>
    (await p2.locator('body').innerText().catch(() => '')).includes("Can't reach your data") ? 'stranded' : 'blank');
  if (outcome !== 'home') stranded.push(`account ${i}: ${outcome}`);
  await c2.close();
}
check('all three reach Home without pressing anything', stranded.length === 0, stranded.join('; '));

section('Nothing was refused or thrown along the way');
// In the control run the refused edit is the point, so it is reported, not hidden.
check('no write was refused by the rules', denied.length === 0, denied[0] || '');
check('no page error was thrown', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) || '');
check('the run never reached the production backend', prodCalls.length === 0, `${prodCalls.length}: ${prodCalls[0] || ''}`);

await browser.close();
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
finish(fail === 0 ? 0 : 1);
