// Tap-latency proof — npm run proof:latency
//
// Target: every tap gets a visible response within 200 ms on a mid-range phone.
//
// What is measured, per tap, inside the page (one clock: performance.now()):
//   • response — Chrome's Event Timing duration for the tap: input -> the next
//                frame painted. This is the Interaction to Next Paint (INP)
//                metric Google uses; "good" is <= 200 ms.
//   • ready    — pointerdown -> the first frame in which the content the tap
//                was FOR is on screen (the new page's heading, the opened
//                sheet, the updated number). A tab that repaints its pill in
//                30 ms but shows the page 900 ms later is lag; this catches it.
//
// Conditions: the PRODUCTION build (minified, code-split exactly as shipped),
// pointed at the emulators, CPU throttled 4x (Lighthouse's mid-range-phone
// setting), 412x915 touch viewport, signed in with seeded data.
//
// Run with: firebase emulators:exec --only auth,firestore,functions "node scripts/latency-proof.mjs"
// (`npm run proof:latency` does the build and the emulators for you.)

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const BUDGET_MS = 200;
const CPU_SLOWDOWN = Number(process.env.LATENCY_CPU || 4);
const ROOT = new URL('../dist-e2e/', import.meta.url);
const ROOT_DIR = decodeURIComponent(ROOT.pathname).replace(/^\/([A-Za-z]:)/, '$1');
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

if (!existsSync(join(ROOT_DIR, 'index.html'))) {
  console.error('dist-e2e/ is missing — run `npm run proof:latency`, which builds it.');
  process.exit(1);
}

// ── Static server for the production build (SPA fallback) ─────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = normalize(join(ROOT_DIR, url));
  if (!file.startsWith(normalize(ROOT_DIR)) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(ROOT_DIR, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4310, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:4310';

// ── Seed a signed-in user with real data ──────────────────────────────────────
const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const EMAIL = `latency-${Date.now()}@fitflow.test`;
const PASSWORD = 'latency-password-123';
const signUp = await fetch(
  `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) },
).then((r) => r.json());
const UID = signUp.localId;
if (!UID) { console.error('emulator sign-up failed', signUp); process.exit(1); }

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
admin.initializeApp({ projectId: cfg.projectId });
const db = getFirestore(admin.app(), cfg.firestoreDatabaseId);
const daysAgo = (n) => Timestamp.fromMillis(Date.now() - n * 86400000);
await db.doc(`users/${UID}`).set({
  uid: UID, displayName: 'Latency Tester', photoURL: '', email: EMAIL, subscriptionType: 'free',
  trialStartedAt: Timestamp.now(), age: 30, weight: 70, height: 175, goal: 'fat_loss',
  healthConditions: ['None'], dietaryPreferences: ['None'], streak: 3, currentStreak: 3,
  badges: ['pioneer'], points: 420, level: 3, createdAt: daysAgo(10), notificationsEnabled: false,
  activeChallenges: [], tzOffsetHours: 8,
});
for (let i = 0; i < 6; i++) {
  await db.collection('workouts').add({ userId: UID, name: `Session ${i + 1}`, type: 'Strength',
    duration: 45, caloriesBurned: 300, timestamp: daysAgo(i + 1), exercises: [] });
  await db.collection('meals').add({ userId: UID, name: `Meal ${i + 1}`, calories: 500, protein: 30,
    carbs: 50, fats: 15, mealType: 'lunch', timestamp: daysAgo(i % 2) });
}

// ── Browser: phone-sized, throttled, signed in ────────────────────────────────
const browser = await chromium.launch();
// Diagnosis: LATENCY_VARIANT=dark,noparticles,nocanvas,noanim switches one suspect off at a time.
const VARIANT = new Set((process.env.LATENCY_VARIANT || '').split(',').filter(Boolean));
const ctx = await browser.newContext({ colorScheme: VARIANT.has('dark') ? 'dark' : 'light', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
  deviceScaleFactor: 2.625 });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// Event Timing + a capture-phase pointerdown clock, installed before any app code.
await page.addInitScript(() => {
  const w = window;
  w.__lat = { events: [], downAt: 0 };
  document.addEventListener('pointerdown', (e) => { w.__lat.downAt = e.timeStamp; }, { capture: true });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.interactionId) w.__lat.events.push({ id: e.interactionId, name: e.name, start: e.startTime, dur: e.duration });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch { /* Event Timing unsupported */ }
});

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => typeof window.__e2eSignIn === 'function', null, { timeout: 30000 });
const signed = await page.evaluate(async ([e, p]) => {
  try { await window.__e2eSignIn(e, p); return true; } catch (err) { return String(err); }
}, [EMAIL, PASSWORD]);
if (signed !== true) { console.error('sign-in failed:', signed); process.exit(1); }
await page.waitForFunction(() => document.body.innerText.includes('MISSION'), null, { timeout: 30000 });
await page.waitForTimeout(2500); // let the first screen settle before measuring
// First sign-in shows the one-time permissions sheet; a real user dismisses it once.
const later = page.getByText('Maybe later', { exact: true });
if (await later.isVisible().catch(() => false)) {
  await later.click();
  await page.waitForTimeout(1200);
}
if (process.env.LATENCY_SHOT) await page.screenshot({ path: process.env.LATENCY_SHOT });

const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl');
  const ext = c && c.getExtension('WEBGL_debug_renderer_info');
  return c ? (ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl (renderer hidden)') : 'NO WEBGL';
});
console.log(`${C.d}WebGL renderer: ${gl}${C.x}`);

const css = [];
if (VARIANT.has('noparticles')) css.push('.ff-drift{animation:none!important;display:none!important}');
if (VARIANT.has('nocanvas')) css.push('canvas{display:none!important}');
if (VARIANT.has('noblur')) css.push('*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}');
if (VARIANT.has('noanim')) css.push('*,*::before,*::after{animation:none!important;transition:none!important}');
if (css.length) await page.addStyleTag({ content: css.join(' ') });
if (VARIANT.size) console.log('variant:', [...VARIANT].join(','));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

/**
 * Tap `target`, then wait for `readyFn` (run in the page every frame) to be
 * true. Returns { response, ready } in ms, both measured from pointerdown.
 */
const measure = async (label, target, readyFn, readyArg) => {
  await page.evaluate(() => { window.__lat.events = []; window.__lat.downAt = 0; });
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.click({ timeout: 15000 });
  const ready = await page.evaluate(([src, arg]) => new Promise((resolve) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function('arg', `return (${src})(arg);`);
    const deadline = performance.now() + 8000;
    const tick = () => {
      let ok = false;
      try { ok = !!fn(arg); } catch { ok = false; }
      if (ok) {
        // The frame that shows it is the NEXT paint after the DOM is ready.
        requestAnimationFrame(() => resolve(performance.now() - window.__lat.downAt));
      } else if (performance.now() > deadline) resolve(-1);
      else requestAnimationFrame(tick);
    };
    tick();
  }), [readyFn.toString(), readyArg]);
  await page.waitForTimeout(400); // let Event Timing entries for this tap land
  const response = await page.evaluate(() => {
    const ev = window.__lat.events;
    return ev.length ? Math.max(...ev.map((e) => e.dur)) : 0;
  });
  const seen = ready < 0
    ? await page.evaluate(() => `on ${location.pathname}: ` + document.body.innerText.replace(/\s+/g, ' ').slice(0, 110))
    : undefined;
  return { label, response: Math.round(response), ready: Math.round(ready), ...(seen ? { error: seen } : {}) };
};

const textVisible = (t) => document.body.innerText.includes(t);
const results = [];

// Diagnosis mode: LATENCY_PROFILE=<substring of a label> CPU-profiles the taps
// whose label matches and prints where the time went (use an unminified build
// — `vite build --mode e2e --outDir dist-e2e --minify false` — for real names).
const PROFILE = process.env.LATENCY_PROFILE || '';
const summarize = (profile, label) => {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = nodes.get(profile.samples[i]);
    const f = n.callFrame;
    const file = (f.url || '').split('/').pop() || '(native)';
    const key = `${f.functionName || '(anon)'}  ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
  }
  const byFile = new Map();
  for (const [k, v] of self) {
    const file = k.split('  ')[1].split(':')[0];
    byFile.set(file, (byFile.get(file) || 0) + v);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log(`\n${C.b}profile: ${label}${C.x}`);
  for (const [k, v] of top(byFile, 8)) console.log(`  ${v.toFixed(0).padStart(5)} ms  ${k}`);
  console.log(`  ${C.d}-- top functions (self time) --${C.x}`);
  for (const [k, v] of top(self, 18)) console.log(`  ${v.toFixed(0).padStart(5)} ms  ${k}`);
};

const run = async (label, target, readyFn, arg) => {
  const profiling = PROFILE && label.includes(PROFILE);
  try {
    const tracing = process.env.LATENCY_TRACE && label.includes(process.env.LATENCY_TRACE);
    if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    if (tracing) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'gpu'] });
    const r = await measure(label, target, readyFn, arg);
    if (profiling) { const { profile } = await cdp.send('Profiler.stop'); summarize(profile, `${label} (ready ${r.ready} ms)`); }
    if (tracing) {
      const buf = await browser.stopTracing();
      const events = JSON.parse(buf.toString()).traceEvents || [];
      const main = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number');
      const byName = new Map();
      for (const e of main) byName.set(e.name, (byName.get(e.name) || 0) + e.dur / 1000);
      const keep = ['FunctionCall', 'EvaluateScript', 'v8.compile', 'UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint',
        'Layerize', 'Commit', 'RasterTask', 'GPUTask', 'CompositeLayers', 'ParseHTML', 'HitTest', 'RunMicrotasks',
        'FireAnimationFrame', 'TimerFire', 'ScheduleStyleRecalculation', 'PaintImage', 'Decode Image', 'IntersectionObserverController::computeIntersections'];
      console.log(`\n${C.b}trace: ${label} (ready ${r.ready} ms)${C.x}`);
      for (const n of keep) if (byName.get(n) > 1) console.log(`  ${byName.get(n).toFixed(0).padStart(6)} ms  ${n}`);
      const longest = main.filter((e) => e.name === 'RunTask').sort((a, b) => b.dur - a.dur).slice(0, 5);
      console.log(`  ${C.d}longest tasks:${C.x} ${longest.map((e) => (e.dur / 1000).toFixed(0) + ' ms').join(', ')}`);
    }
    results.push(r);
  } catch (e) {
    const lines = String(e.message || e).split('\n');
    const why = lines.find((l) => /intercepts pointer|not visible|not stable|outside of the viewport/.test(l)) || lines[0];
    results.push({ label, response: -1, ready: -1, error: why.trim().slice(0, 160) });
  }
  await page.waitForTimeout(600);
};

const dock = (path) => `nav[aria-label="Primary"] a[href="${path}"]`;

// Two laps of the dock: lap 1 includes any cold route-chunk load, lap 2 is warm.
for (const lap of [1, 2]) {
  await run(`Dock → Fuel (lap ${lap})`, dock('/track'), textVisible, 'DAILY FUEL');
  await run(`Dock → Train (lap ${lap})`, dock('/workout'), textVisible, 'TRAIN');
  await run(`Dock → Coach (lap ${lap})`, dock('/coach'), textVisible, 'AI COACH');
  await run(`Dock → You (lap ${lap})`, dock('/profile'), textVisible, 'Weight over the last');
  await run(`Dock → Home (lap ${lap})`, dock('/'), textVisible, 'MISSION');
}

// In-page actions on Home.
await run('Home: open water picker', page.getByText('Tap to add').first(),
  () => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Cancel'));
const waterBefore = await page.evaluate(() => document.body.innerText.match(/(\d[\d,]*)\s*ml/)?.[1] || '');
await run('Home: add 250 ml water', page.locator('button', { hasText: /^250\s*ml$/ }).first(),
  (before) => {
    const m = document.body.innerText.match(/(\d[\d,]*)\s*ml/);
    return m && m[1] !== before;
  }, waterBefore);

await page.locator('button', { hasText: /^Cancel$/ }).first().click().catch(() => {});
await page.waitForTimeout(500);

// Track: open the add-meal sheet.
await run('Dock → Fuel (for sheet)', dock('/track'), textVisible, 'DAILY FUEL');
await run('Fuel: open add-meal sheet', 'button[aria-label="Add meal"]',
  () => document.querySelectorAll('button[aria-label="Close"]').length > 0);

// Profile menu → secondary pages.
await page.locator('button[aria-label="Close"]').first().click().catch(() => {});
await page.waitForTimeout(500);
await run('Dock → You (for menu)', dock('/profile'), textVisible, 'Weight over the last');
await run('You: open Settings', page.getByRole('button', { name: 'Settings', exact: true }).last(), textVisible, 'SETTINGS');
await run('Dock → You (back)', dock('/profile'), textVisible, 'Weight over the last');
await run('You: open Achievements', page.getByRole('button', { name: 'Achievements', exact: true }).last(), textVisible, 'ACHIEVEMENTS');

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\n${C.b}Tap latency — production build, CPU ${CPU_SLOWDOWN}x slower, budget ${BUDGET_MS} ms${C.x}`);
console.log(`${C.d}  response = input -> next paint (INP)   ready = input -> the content is on screen${C.x}\n`);
let fail = 0;
for (const r of results) {
  const worst = Math.max(r.response, r.ready);
  const ok = r.response >= 0 && r.ready >= 0 && worst <= BUDGET_MS;
  if (!ok) fail++;
  const tag = ok ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`;
  const fmt = (v) => (v < 0 ? 'timeout' : `${v} ms`).padStart(8);
  console.log(`  ${tag} ${r.label.padEnd(30)} response ${fmt(r.response)}   ready ${fmt(r.ready)}${r.error ? `  ${C.d}${r.error}${C.x}` : ''}`);
}
if (pageErrors.length) console.log(`\n${C.y}page errors:${C.x} ${[...new Set(pageErrors)].slice(0, 5).join(' | ')}`);
if (process.env.LATENCY_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.LATENCY_JSON, JSON.stringify(results, null, 2));
}
console.log(`\n${C.b}Result: ${fail ? C.r : C.g}${results.length - fail}/${results.length}${C.x}${C.b} taps within ${BUDGET_MS} ms${C.x}`);

await browser.close();
server.close();
process.exit(fail ? 1 : 0);
