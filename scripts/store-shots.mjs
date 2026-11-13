// Store screenshots from the REAL app — npm run shots:store
//
// Signs in to the app running against the emulators, with a believable
// account, and saves 1080x1920 phone screenshots (Play's required shape) of
// the screens a store listing sells: home, food search, a packaged product,
// training, coach, community.
//
// These are the app itself, not mock-ups, so they cannot show a feature that
// does not exist. Output: STORE_SHOTS_DIR, default Desktop/fitflow-store-assets/v<version>.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const OUT = process.env.STORE_SHOTS_DIR || join(homedir(), 'Desktop', 'fitflow-store-assets', `v${pkg.version}`);
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3000';
const EMAIL = `shots-${Date.now()}@fitflow.test`;
const PASSWORD = 'shots-password-123';

let server;
const shutdown = () => {
  const pid = server?.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
  } catch { /* already gone */ }
};
process.on('exit', shutdown);
const finish = (code) => { shutdown(); process.exit(code); };

const signUp = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const UID = signUp.localId;
if (!UID) { console.error('Could not create the emulator user:', JSON.stringify(signUp)); process.exit(1); }

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: cfg.projectId });
const db = getFirestore(admin.app(), cfg.firestoreDatabaseId);
const ago = (hours) => Timestamp.fromMillis(Date.now() - hours * 3_600_000);

// A believable account: a few weeks in, eating local food, training regularly.
await db.doc(`users/${UID}`).set({
  uid: UID, displayName: 'Aiman', photoURL: '', subscriptionType: 'free', trialStartedAt: ago(24),
  age: 27, weight: 72, height: 174, goal: 'fat_loss', goalWeight: 68,
  healthConditions: ['None'], dietaryPreferences: ['Halal'],
  streak: 12, currentStreak: 12, badges: ['pioneer', 'nutrition_master'], points: 2450, level: 8,
  createdAt: ago(24 * 30), notificationsEnabled: false, activeChallenges: [],
});
await db.doc(`public_profiles/${UID}`).set({ displayName: 'Aiman', photoURL: '', points: 2450, streak: 12, level: 8, goal: 'fat_loss' });
const meals = [
  ['Nasi Lemak', 644, 17, 82, 27, 'breakfast', 0.6], ['Teh Tarik Kurang Manis (1 glass)', 90, 3, 12, 4, 'snack', 0.5],
  ['Chicken Rice', 607, 28, 73, 22, 'lunch', 0.3],
];
for (const [name, calories, protein, carbs, fats, mealType, h] of meals) {
  await db.collection('meals').add({ userId: UID, name, calories, protein, carbs, fats, mealType, timestamp: ago(h) });
}
for (let i = 1; i <= 5; i++) {
  await db.collection('workouts').add({
    userId: UID, name: ['Push day', 'Leg day', '5 km run', 'Pull day', 'Core + mobility'][i - 1],
    type: i === 3 ? 'Cardio' : 'Strength', duration: 40 + i * 5, caloriesBurned: 260 + i * 30, timestamp: ago(24 * i), exercises: [],
  });
}
for (let i = 0; i < 6; i++) {
  await db.collection('weight_history').add({ userId: UID, weight: 74.2 - i * 0.4, timestamp: ago(24 * (25 - i * 5)) });
}
for (const [who, text, likes] of [['Mei Ling', 'First 10 km done before work. Legs are gone but worth it.', 14], ['Hafiz', 'Down 3 kg this month just logging what I already eat. Nasi lemak stays.', 22]]) {
  await db.collection('posts').add({ userId: 'someone_else', username: who, userPhoto: '', content: text, likesCount: likes, commentsCount: 3, createdAt: ago(5) });
}
// A real product, as Open Food Facts returned it on 2026-11-13.
await db.doc('food_search_cache/milo').set({ q: 'milo', at: Date.now(), foods: [
  { name: 'Nestle Milo (100g)', calories: 430, protein: 6, carbs: 69, fats: 13, brand: 'Milo', code: '9300605126527', source: 'OFF' },
  { name: 'Milo nuggets (100g)', calories: 486, protein: 9, carbs: 60, fats: 22, brand: 'Milo', source: 'OFF' },
] });

server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'server.ts'], {
  env: { ...process.env, VITE_USE_EMULATORS: 'true' }, stdio: 'ignore', shell: process.platform === 'win32',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(BASE)).ok; } catch { /* not yet */ }
  if (!up) await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { console.error('dev server never came up'); finish(1); }

const browser = await chromium.launch();
// 360x640 CSS pixels at 3x = 1080x1920 output.
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, colorScheme: 'dark' });
await ctx.addInitScript(() => { try { localStorage.setItem('ff-theme', 'dark'); } catch { /* ignore */ } });
const page = await ctx.newPage();
await page.route('**/world.openfoodfacts.org/api/v2/product/**', (route) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ product: { serving_size: '1 portion (20 g)', serving_quantity: 20 } }) }));

await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => typeof window.__e2eSignIn === 'function', { timeout: 30000 });
const ok = await page.evaluate(async ([e, p]) => { try { await window.__e2eSignIn(e, p); return true; } catch (err) { return String(err); } }, [EMAIL, PASSWORD]);
if (ok !== true) { console.error('sign-in failed:', ok); await browser.close(); finish(1); }
// Let the signed-in app load its profile before navigating anywhere.
await page.waitForFunction(() => document.body.innerText.includes('MISSION'), null, { timeout: 30000 })
  .catch(async () => { console.error('home never rendered after sign-in:', (await page.locator('body').innerText()).slice(0, 200)); });

const made = [];
const shot = async (name) => {
  await page.waitForTimeout(1800); // let numbers count up and images land
  await page.screenshot({ path: join(OUT, name) });
  made.push(name);
};
const open = async (route, marker) => {
  await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 20000 }).catch(() => {});
};

await open('/', 'MISSION');
// A new account is offered the permissions sheet over Home; the listing shows Home.
await page.locator('button', { hasText: 'Maybe later' }).click({ timeout: 4000 }).catch(() => {});
await shot('1-home.png');

await open('/track', 'DAILY FUEL');
await shot('2-fuel.png');
const search = page.locator('input[placeholder^="Search foods"]');
await search.fill('nasi');
await page.locator('text=Tap to log instantly').waitFor({ timeout: 15000 }).catch(() => {});
await shot('3-food-search.png');

await search.fill('milo');
const milo = page.locator('text=Tap to log instantly').locator('xpath=..').locator('button').filter({ hasText: 'Nestle Milo' });
await milo.first().waitFor({ timeout: 25000 }).catch(() => {});
await shot('4-packaged-search.png');
await milo.first().click().catch(() => {});
await page.locator('button', { hasText: '1 serving' }).waitFor({ timeout: 10000 }).catch(() => {});
await page.locator('button', { hasText: '1 serving' }).click().catch(() => {});
await shot('5-serving-size.png');

await open('/workout', 'TRAIN');
await shot('6-train.png');
await open('/coach', 'AI COACH');
await shot('7-coach.png');
await open('/community', 'COMMUNITY');
await shot('8-community.png');

await browser.close();
console.log(`saved ${made.length} screenshots (1080x1920) to ${OUT}`);
for (const m of made) console.log('  ' + m);
finish(0);
