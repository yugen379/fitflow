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

server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'server.ts'], {
  env: { ...process.env, VITE_USE_EMULATORS: 'true' }, stdio: 'ignore', shell: process.platform === 'win32',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(BASE)).ok; } catch { /* not yet */ }
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
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();
const pageErrors = [];
const denied = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && /permission|insufficient/i.test(t)) denied.push(t.slice(0, 140));
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

// Every row must be reachable inside the viewport, and the list must not push
// the page sideways.
const lastRow = rows.last();
await lastRow.scrollIntoViewIfNeeded().catch(() => {});
const box = await lastRow.boundingBox().catch(() => null);
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the last result can be brought on screen', !!box && box.y >= 0 && box.y + box.height <= 915, JSON.stringify(box));
check('the results do not cause sideways scrolling', sideways <= 1, `${sideways}px wider than the screen`);

await rows.first().scrollIntoViewIfNeeded().catch(() => {});
await rows.first().click();
const lemak = await until(mealNamed('Nasi Lemak'));
check('tapping it writes the meal, with the catalog numbers', !!lemak && lemak.calories === 644 && lemak.protein === 17,
  lemak ? `${lemak.name}: ${lemak.calories} kcal, P${lemak.protein}` : 'no meal written');

// ── Quick-add ────────────────────────────────────────────────────────────────
section('Track: quick-add by typing');
const quickAdd = async (text) => {
  await page.locator('button[aria-label="Add meal"]').click();
  const box2 = page.locator('textarea[placeholder^="e.g. a bowl"]');
  await box2.waitFor({ timeout: 10000 });
  await box2.fill(text);
  await page.locator('button.btn-3d', { hasText: 'Log' }).click();
  // The sheet closes itself when the log lands (or falls through to manual).
  await box2.waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
};
await quickAdd('telur mata');
const egg = await until(mealNamed('Fried Egg'));
check('"telur mata" logs Fried Egg from the bundled list', !!egg && egg.calories === 90, egg ? `${egg.name}: ${egg.calories}` : 'no meal written');

await quickAdd('3 eggs');
const three = await until(mealNamed('3 eggs'), 45000);
const wrongEggs = await mealNamed('Eggs (2 large')();
check('"3 eggs" is logged as three eggs (234 kcal), not the listed two', !!three && three.calories === 234 && !wrongEggs,
  three ? `${three.name}: ${three.calories}` : wrongEggs ? `logged ${wrongEggs.name}: ${wrongEggs.calories}` : 'no meal written');

// ── Branded products ─────────────────────────────────────────────────────────
// The answer is seeded into the server's search memory, so the real callable
// runs end to end without this gate depending on Open Food Facts being up.
section('Track: a packaged product from Open Food Facts');
await db.doc('food_search_cache/zzbrand-spread').set({
  q: 'zzbrand-spread', at: Date.now(),
  foods: [{ name: 'ZZBrand Hazelnut Spread (100g)', calories: 540, protein: 6, carbs: 58, fats: 31, brand: 'ZZBrand', source: 'OFF' }],
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
await amount.fill('30');
check('changing the amount to 30 g rescales the calories to 162', (await kcalField.inputValue().catch(() => '')) === '162', await kcalField.inputValue().catch(() => '?'));
await page.locator('button.btn-3d', { hasText: 'Log meal' }).click().catch(() => {});
const spread = await until(mealNamed('ZZBrand Hazelnut Spread (30g)'));
check('logging writes 30 g of it: 162 kcal, P2 C17 F9',
  !!spread && spread.calories === 162 && spread.protein === 2 && spread.carbs === 17 && spread.fats === 9,
  spread ? `${spread.name}: ${spread.calories} kcal P${spread.protein} C${spread.carbs} F${spread.fats}` : 'no meal written');

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

section('Nothing was refused or thrown along the way');
// In the control run the refused edit is the point, so it is reported, not hidden.
check('no write was refused by the rules', denied.length === 0, denied[0] || '');
check('no page error was thrown', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) || '');

await browser.close();
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
finish(fail === 0 ? 0 : 1);
