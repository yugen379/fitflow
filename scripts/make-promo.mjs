// Promo footage generator — npm run promo
//
// Screen-records the REAL app (not a mockup) as vertical 9:16 video for
// TikTok / Reels / Shorts, then muxes it to mp4 with ffmpeg.
//
// It reuses the proof:ui rig: Auth + Firestore emulators, a seeded account, a
// genuine sign-in. So what lands in the video is the actual product rendering
// actual data — nothing staged, nothing faked.
//
// Captions are injected as a DOM overlay in the brand palette (volt on ink)
// rather than burned in afterwards, so they scale with the recording and stay
// editable here in code.
//
// Run: npm run promo   (needs the Firebase emulator — JDK 21+)

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'promo');
const RAW = join(OUT, 'raw');
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const BASE = 'http://127.0.0.1:3000';
const EMAIL = 'promo@fitflow.test';
const PASSWORD = 'promo-password-123';

// Brand: volt green on dark ink (see src/index.css / chartTooltipStyle).
const ACCENT = '#C6FF3D';
const INK = '#0E1014';

rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

let server;
process.on('exit', () => { try { server?.kill(); } catch { /* gone */ } });

// ── Seed ─────────────────────────────────────────────────────────────────────
const signUp = await fetch(
  `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) },
).then((r) => r.json());
const UID = signUp.localId;
if (!UID) { console.error('emulator signup failed:', JSON.stringify(signUp)); process.exit(1); }

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: cfg.projectId });
const db = getFirestore(admin.app(), cfg.firestoreDatabaseId);
const daysAgo = (n) => Timestamp.fromMillis(Date.now() - n * 86400000);
await db.doc(`users/${UID}`).set({
  uid: UID, displayName: 'Athlete', photoURL: '', email: EMAIL,
  subscriptionType: 'free', trialStartedAt: Timestamp.now(),
  age: 28, weight: 72, height: 176, goal: 'muscle_gain',
  healthConditions: ['None'], dietaryPreferences: ['None'],
  streak: 12, currentStreak: 12, badges: ['pioneer'], points: 2480, level: 8,
  createdAt: daysAgo(30), notificationsEnabled: false, activeChallenges: [],
});
// Today's meals, so the macro matrix fills in. Without these the Track screen
// records as 0/2800 across every macro, under a caption about tracking macros.
const MEALS = [
  { name: 'Nasi lemak with egg', calories: 644, protein: 17, carbs: 82, fat: 26, mealType: 'breakfast', h: 9 },
  { name: 'Chicken rice', calories: 607, protein: 34, carbs: 74, fat: 19, mealType: 'lunch', h: 13 },
  { name: 'Greek yoghurt + berries', calories: 212, protein: 18, carbs: 24, fat: 5, mealType: 'snack', h: 16 },
];
for (const m of MEALS) {
  const t = new Date(); t.setHours(m.h, 0, 0, 0);
  await db.collection('meals').add({
    userId: UID, name: m.name, calories: m.calories, protein: m.protein,
    carbs: m.carbs, fat: m.fat, mealType: m.mealType, timestamp: Timestamp.fromDate(t),
  });
}
await db.collection('water_logs').add({ userId: UID, amount: 1400, timestamp: Timestamp.now() });

for (let i = 0; i < 6; i++) {
  await db.collection('workouts').add({
    userId: UID, name: `Session ${i + 1}`, type: i % 2 ? 'Strength' : 'Cardio',
    duration: 45 + i * 5, caloriesBurned: 320 + i * 20, timestamp: daysAgo(i + 1), exercises: [],
  });
}

// ── Dev server ───────────────────────────────────────────────────────────────
server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'server.ts'], {
  env: { ...process.env, VITE_USE_EMULATORS: 'true' }, stdio: 'ignore',
  shell: process.platform === 'win32', cwd: ROOT,
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* waiting */ }
  await new Promise((r) => setTimeout(r, 1000));
}

// ── Record ───────────────────────────────────────────────────────────────────
// 540x960 is exactly 9:16 and still inside Tailwind's `sm` breakpoint, so the
// app renders in its mobile layout. Upscaled to 1080x1920 by ffmpeg after.
// Headless Chromium has no GPU, so the Biomechanics Lab canvas records as a
// blank white rectangle without an explicit software GL backend. These are the
// same flags scripts/viewport-proof.mjs uses to render the rig on CI.
const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  // The brand is volt-green on dark ink, and the app honours the OS theme.
  // Playwright defaults to light, which recorded the whole thing white — the
  // opposite of the identity every other asset uses.
  colorScheme: 'dark',
  recordVideo: { dir: RAW, size: { width: 540, height: 960 } },
});
// Suppress the first-run permission prompts BEFORE any app code runs.
//
// Home opens a full-screen "Unlock the full FitFlow" sheet for a new account,
// and App.tsx asks for notifications 1.5s after login. In the first cut that
// modal covered roughly eleven of the thirteen seconds — the contact sheet was
// almost entirely a permissions dialog. These are the app's own suppression
// flags, so nothing is being faked or patched out: it records as it would for
// a user who has already answered them.
await ctx.addInitScript((uid) => {
  try {
    localStorage.setItem(`ff_perms_prompted_${uid}`, '1');
    sessionStorage.setItem(`ff_asked_notif_${uid}`, '1');
  } catch { /* storage blocked; the dismiss fallback below still applies */ }
}, UID);

const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => typeof window.__e2eSignIn === 'function', { timeout: 30000 });
await page.evaluate(async ([e, p]) => window.__e2eSignIn(e, p), [EMAIL, PASSWORD]);
await page.waitForTimeout(1200);

// Caption overlay, brand palette, bottom third (clear of TikTok's UI chrome).
//
// Injected AFTER each navigation, not before: a goto() replaces the document,
// which silently took the overlay with it the first time.
const CAP_CSS = `
  #promo-cap {
    position: fixed; left: 0; right: 0; bottom: 132px; z-index: 99999;
    display: flex; justify-content: center; pointer-events: none;
    font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  }
  #promo-cap span {
    background: ${INK}; color: #fff; border: 1px solid ${ACCENT}55;
    border-left: 3px solid ${ACCENT};
    padding: 12px 18px; margin: 0 20px; border-radius: 14px;
    font-size: 21px; font-weight: 700; line-height: 1.25; text-align: center;
    letter-spacing: -0.01em; box-shadow: 0 18px 50px rgba(0,0,0,.7);
    opacity: 0; transition: opacity .35s ease, transform .35s ease;
    transform: translateY(10px);
  }
  #promo-cap.on span { opacity: 1; transform: none; }
`;
const mountCaptions = async () => {
  await page.addStyleTag({ content: CAP_CSS });
  await page.evaluate(() => {
    if (document.getElementById('promo-cap')) return;
    const d = document.createElement('div');
    d.id = 'promo-cap';
    d.innerHTML = '<span></span>';
    document.body.appendChild(d);
  });
};
const caption = async (text) => {
  await page.evaluate((t) => {
    const w = document.getElementById('promo-cap');
    if (!w) return;
    const s = w.querySelector('span');
    w.classList.remove('on');
    setTimeout(() => { s.textContent = t; w.classList.add('on'); }, 180);
  }, text);
};

// ── The cut ──────────────────────────────────────────────────────────────────
// Opens mid-action on purpose: no logo, no intro. The first 1.5s decides
// whether anyone watches the rest.
//
// Navigation is by TAPPING THE BOTTOM NAV, never page.goto(). A goto is a full
// document reload, which replays the boot splash — the first version of this
// cut had "FitFlow · Loading 60%" appear twice in the middle of the video. Tab
// taps are client-side, which is also what a real user actually does.
//
// The Biomechanics Lab was the original hook and is cut: in headless Chromium
// with software GL its viewport mounts NO canvas at all, so it records as an
// empty rectangle. Worth checking on a real device before using it in an ad.

const t0 = Date.now();
const mark = (label) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);

const settle = async (marker, ms = 1200) => {
  await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 3500 })
    .catch(() => {});
  await page.waitForTimeout(ms);
};
// By href, and scrolled back to the top first: FloatingDock hides itself on
// scroll (it has a "Show navigation" toggle), so tapping straight after a
// wheel event found nothing and burned the timeout on every section.
const clearCaption = () => page.evaluate(() => document.getElementById('promo-cap')?.classList.remove('on'));
const dismissOverlay = async () => {
  await page.getByText('Maybe later', { exact: true }).first()
    .click({ timeout: 1200 }).catch(() => { /* not showing, which is the norm */ });
};
const tap = async (href) => {
  await clearCaption();
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(450);
  await page.click(`a[href="${href}"]`, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(250);
};

// 1. Home — already loaded from the sign-in above, so no reload and no splash.
await page.waitForFunction(
  () => !document.body.innerText.includes('Loading your day'),
  { timeout: 4500 },
).catch(() => {});
await dismissOverlay();
mark('HOME');
await settle('MISSION', 900);
await mountCaptions();
await caption('One screen. What to do right now.');
await page.waitForTimeout(1700);
await page.mouse.wheel(0, 340);
await page.waitForTimeout(1200);

// 2. Fuel -> /track. Real macros from the seeded meals.
await tap('/track');
mark('TRACK');
await settle('DAILY FUEL', 900);
await mountCaptions();
await caption('Every macro, tracked as you eat.');
await page.waitForTimeout(1700);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(1200);

// Steps is deliberately NOT in this cut. In a browser the page reads "NOT
// COUNTING YET" and "Background counting: not available on this device" —
// true, since that is the native Android service — so the caption "steps
// counted with the app closed" would contradict the screen behind it. Film
// that one on a handset, where it is true.

// 4. Awards -> the reason people come back on day 7.
await tap('/achievements');
mark('AWARDS');
await settle('ACHIEVEMENTS', 1800);
await mountCaptions();
await caption('FitFlow — train with your eyes open.');
await page.waitForTimeout(2100);

await ctx.close();
await browser.close();
server.kill();

// ── Mux ──────────────────────────────────────────────────────────────────────
const webm = readdirSync(RAW).filter((f) => f.endsWith('.webm')).map((f) => join(RAW, f))[0];
if (!webm) { console.error('no video captured'); process.exit(1); }
const mp4 = join(OUT, 'fitflow-app-9x16.mp4');
execFileSync('ffmpeg', [
  '-y', '-i', webm,
  // Upscale to 1080x1920 with a sharp scaler; pad if the source drifts off-ratio.
  // Cut the sign-in pre-roll; the hook has to be a real screen at 0.0s.
  // Cut the boot: a signed-in reload briefly shows the onboarding step and then
  // "Loading your day…" before Home has data. Neither belongs in the first
  // frame of an ad, and the hook is the loaded Home screen.
  '-ss', '9.0',
  // 2.3x. Page loads and scroll dwell put the raw cut near 34s, which no one
  // finishes on TikTok. Sped up it reads as brisk rather than rushed, and lands
  // in the 12-15s band where completion rate is actually winnable.
  '-vf', 'setpts=PTS/1.7,scale=1080:1920:flags=lanczos,format=yuv420p,fps=30',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-movflags', '+faststart', '-an', mp4,
], { stdio: 'ignore' });

const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', mp4]).toString().trim();
console.log(`\n  wrote ${mp4}`);
console.log(`  ${Number(secs).toFixed(1)}s · 1080x1920 · H.264 · no audio\n`);
