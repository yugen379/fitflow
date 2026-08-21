// Cold-start budget proof.
//
//   npm run proof:perf     (requires a fresh `npm run build`)
//
// Every regression this guards against was a real bug in this repo, and every
// one of them was invisible: the app worked perfectly, it was just slow, and
// nothing in a normal review would have caught any of them.
//
//   • The whole Sentry SDK rode into the critical path because a manualChunks
//     rule matched on the substring 'react/' and '@sentry/react/' contains it.
//   • `clsx` (500 bytes, unassigned) got filed inside the recharts chunk, so the
//     entry statically imported 377 kB of charting in order to call cn().
//   • A boot-time getDocFromServer() kept Firestore permanently eager.
//
// So this asserts the *shape* of the build, not just its behaviour:
//   Part A — nothing heavy is statically reachable from the entry chunk.
//   Part B — the HTML still paints without JavaScript, and fonts do not block.
//   Part C — code-splitting produced exactly one chunk per route.
//   Part D — a signed-out boot really does skip Firestore, and a returning one
//            really does warm it (measured in a browser, not inferred).

import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

import { chromium } from 'playwright';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

let passCount = 0;
let failCount = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    passCount++;
    console.log(`  ${PASS} ${name}`);
  } else {
    failCount++;
    console.log(`  ${FAIL} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`);
  }
};

const DIST = 'dist';
if (!existsSync(join(DIST, 'index.html'))) {
  console.log(`${C.r}No dist/ — run npm run build first.${C.x}`);
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const assets = readdirSync(join(DIST, 'assets'));

// ─── Part A: what the entry chunk statically pulls in ────────────────────────
console.log(`\n${C.b}${C.c}Part A — critical-path budget${C.x}\n`);

const entryName = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
const entrySource = entryName ? readFileSync(join(DIST, 'assets', entryName), 'utf8') : '';
const staticImports = [...entrySource.matchAll(/from"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]);

/**
 * Chunks that must never be statically reachable from the entry. Each one is
 * either genuinely optional, or needed only after a decision the boot path has
 * not made yet.
 */
const BANNED = [
  ['firebase-firestore', 'only needed once there is a signed-in user'],
  ['sentry', 'dynamically imported, and only when a DSN is configured'],
  ['posthog', 'dynamically imported, and only when a key is configured'],
  ['charts', 'recharts is used by two lazy routes'],
  ['redux', 'only the Lab route mounts a Provider'],
  ['three', '~120 kB, Lab route only'],
  ['motion', 'the boot screens use CSS keyframes'],
  ['gemini', 'AI features are not on the boot path'],
  ['qrcode', 'the scanner is a lazy route'],
];

for (const [chunk, why] of BANNED) {
  const offender = staticImports.find((f) => f.startsWith(`${chunk}-`));
  check(`entry does not statically import "${chunk}" ${C.d}(${why})${C.x}`, !offender, offender || '');
}

check('entry chunk was found', Boolean(entryName), 'no index-*.js referenced from index.html');

// A ceiling, not a target: this is what has to arrive before anything can run.
const criticalBytes = staticImports
  .map((f) => (existsSync(join(DIST, 'assets', f)) ? statSync(join(DIST, 'assets', f)).size : 0))
  .reduce((a, b) => a + b, 0);
const CRITICAL_BUDGET = 900 * 1024;
check(
  `critical-path JS stays under ${(CRITICAL_BUDGET / 1024).toFixed(0)} kB uncompressed`,
  criticalBytes < CRITICAL_BUDGET,
  `${(criticalBytes / 1024).toFixed(1)} kB across ${staticImports.length} chunks`,
);

// ─── Part B: the document paints without JavaScript ──────────────────────────
console.log(`\n${C.b}${C.c}Part B — first paint does not wait for JS${C.x}\n`);

check('index.html ships an inline splash', html.includes('id="ff-splash"'));
check('the splash is styled inline (no external stylesheet dependency)', /<style>[\s\S]*#ff-splash/.test(html));
check(
  'the Google Fonts stylesheet is non-blocking',
  /fonts\.googleapis\.com[^>]*media="print"/.test(html),
  'a plain <link rel="stylesheet"> to a third party blocks first paint',
);
check('a <noscript> font fallback is present', /<noscript>[\s\S]*fonts\.googleapis\.com/.test(html));
check(
  'Google Identity is not a boot-time script tag',
  !/<script[^>]+accounts\.google\.com\/gsi\/client/.test(html),
  'it is injected on demand by lib/gsi.ts',
);

// ─── Part C: code splitting ──────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part C — route chunks${C.x}\n`);

for (const page of ['Home', 'Track', 'Workout', 'Library', 'Profile', 'Lab', 'Onboarding']) {
  const matches = assets.filter((f) => new RegExp(`^${page}-[A-Za-z0-9_-]+\\.js$`).test(f));
  check(`exactly one chunk for ${page} ${C.d}(prefetch must reuse, not duplicate)${C.x}`, matches.length === 1, `found ${matches.length}`);
}

// ─── Part D: measured boot behaviour ─────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part D — measured boot behaviour${C.x}\n`);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = join(DIST, normalize(url));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(5603, resolve));

/**
 * Console noise from Google's sign-in and reCAPTCHA iframes.
 *
 * These are artefacts of running the production bundle from localhost with the
 * real third-party widgets loaded: storage-access probes, 403s from an
 * unauthorised origin, and — intermittently, roughly one boot in six — a
 * report-only CSP framing warning. None originate in our code, and missing that
 * last one is what made this gate flake at 29/30.
 *
 * Deliberately specific: anything thrown by OUR bundle still fails the check.
 */
const THIRD_PARTY_NOISE =
  /403|storage ?access|requestStorageAccess|GSI_LOGGER|net::ERR|Failed to load resource|Content Security Policy|accounts\.google\.com|gstatic\.com|recaptcha/i;

const boot = async (seedSession) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();

  if (seedSession) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'firebase:authUser:PROOFKEY:[DEFAULT]',
          JSON.stringify({ uid: 'perf-proof-uid', stsTokenManager: { accessToken: 'x', expirationTime: 0 } }),
        );
      } catch {
        /* storage blocked */
      }
    });
  }

  const chunks = [];
  const errors = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/assets/')) chunks.push(u.split('/assets/')[1]);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !THIRD_PARTY_NOISE.test(m.text())) errors.push(m.text().slice(0, 140));
  });

  await page.goto('http://localhost:5603/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(8000);

  const state = await page.evaluate(() => ({
    splashGone: !document.getElementById('ff-splash'),
    text: document.body.innerText.replace(/\s+/g, ' ').trim(),
  }));

  await browser.close();
  return { chunks, errors, state };
};

const signedOut = await boot(false);
check('signed-out boot never downloads Firestore', !signedOut.chunks.some((c) => c.startsWith('firebase-firestore')));
check('signed-out boot renders the sign-in screen', signedOut.state.text.includes('Train smarter'));
check('signed-out boot removes the splash', signedOut.state.splashGone);
check('signed-out boot throws nothing', signedOut.errors.length === 0, signedOut.errors[0] || '');

const returning = await boot(true);
check(
  'a persisted session warms Firestore from the first frame',
  returning.chunks.some((c) => c.startsWith('firebase-firestore')),
  'lib/prefetch.ts warmDataLayer',
);
check('returning boot removes the splash', returning.state.splashGone);
check('returning boot throws nothing', returning.errors.length === 0, returning.errors[0] || '');

server.close();

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passCount + failCount;
console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
if (failCount > 0) {
  console.log(`${C.r}${C.b}PROOF FAILED${C.x}`);
  process.exit(1);
}
console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
