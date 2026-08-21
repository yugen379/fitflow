// Cold-start performance probe.
//
//   npm run perf            # measure dist/ on a throttled mid-range phone
//   npm run perf -- --fast  # no throttling (for quick A/B on the same machine)
//   npm run perf -- --json  # machine-readable, for before/after comparison
//
// Serves the production build the way a real host does — gzipped — and measures
// the first paint a real user gets: throttled CPU, throttled network, cold HTTP
// cache, no service worker.
//
// Third-party origins (fonts, Google Identity, Firebase) are blocked rather than
// fetched, so the number measures OUR bundle instead of swinging with whatever
// fonts.googleapis.com feels like doing today.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

import { chromium } from 'playwright';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };

const DIST = 'dist';
const PORT = 5599;
const FAST = process.argv.includes('--fast');
const JSON_OUT = process.argv.includes('--json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// Every real host compresses text. Serving it raw inflates every timing by
// roughly 3x and would make this harness measure a deployment that does not exist.
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg']);

if (!existsSync(DIST)) {
  console.log(`${C.r}No dist/ — run npm run build first.${C.x}`);
  process.exit(1);
}

const cache = new Map();

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safe = normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  let filePath = join(DIST, safe);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(DIST, 'index.html');

  const ext = extname(filePath);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // Cold cache on every run: caching would make the second measurement a lie.
    'Cache-Control': 'no-store',
  };

  const wantsGzip = /gzip/.test(req.headers['accept-encoding'] || '');
  const key = `${filePath}:${wantsGzip && COMPRESSIBLE.has(ext)}`;
  let body = cache.get(key);
  if (!body) {
    const raw = readFileSync(filePath);
    body = wantsGzip && COMPRESSIBLE.has(ext) ? gzipSync(raw, { level: 9 }) : raw;
    cache.set(key, body);
  }
  if (wantsGzip && COMPRESSIBLE.has(ext)) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;

  res.writeHead(200, headers);
  res.end(body);
});

await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  serviceWorkers: 'block',
});

await context.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());

const page = await context.newPage();

// LCP is only reliably readable through an observer registered before the
// document starts painting; getEntriesByType alone comes back empty.
await page.addInitScript(() => {
  window.__lcp = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* older engine: LCP simply stays 0 */
  }
});

const requests = [];
page.on('response', (response) => {
  const url = response.url();
  if (!url.includes(`localhost:${PORT}`)) return;
  // Wire size — what the connection actually carries, not the decoded size.
  const header = response.headers()['content-length'];
  requests.push({
    url: url.replace(`http://localhost:${PORT}/`, ''),
    size: header ? Number(header) : 0,
  });
});

const client = await context.newCDPSession(page);
if (!FAST) {
  // Mid-range Android: roughly a 4x CPU handicap against this machine, on a
  // good-but-not-great mobile connection.
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

const start = Date.now();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(2500);

const metrics = await page.evaluate(() => {
  const paints = performance.getEntriesByType('paint');
  const fcp = paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null;
  const lcp = window.__lcp || null;
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    fcp,
    lcp,
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
    load: nav ? nav.loadEventEnd : null,
  };
});

const wall = Date.now() - start;

const total = requests.reduce((sum, r) => sum + r.size, 0);
const js = requests.filter((r) => r.url.endsWith('.js')).reduce((sum, r) => sum + r.size, 0);
const css = requests.filter((r) => r.url.endsWith('.css')).reduce((sum, r) => sum + r.size, 0);

const result = {
  fcp: metrics.fcp,
  lcp: metrics.lcp,
  domContentLoaded: metrics.domContentLoaded,
  load: metrics.load,
  wall,
  requests: requests.length,
  jsBytes: js,
  cssBytes: css,
  totalBytes: total,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result));
} else {
  const fmt = (value) => (value === null ? '—' : `${Math.round(value)} ms`);
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

  console.log(`\n${C.b}${C.c}Cold start — ${FAST ? 'unthrottled' : '4x CPU throttle, ~1.6 Mbps, cold cache, gzip'}${C.x}\n`);
  console.log(`  First Contentful Paint   ${C.b}${fmt(metrics.fcp)}${C.x}`);
  console.log(`  Largest Contentful Paint ${C.b}${fmt(metrics.lcp)}${C.x}`);
  console.log(`  DOMContentLoaded         ${fmt(metrics.domContentLoaded)}`);
  console.log(`  load event               ${fmt(metrics.load)}`);
  console.log(`  wall clock to load       ${wall} ms`);
  console.log(`\n  requests ${requests.length}   JS ${kb(js)}   CSS ${kb(css)}   total ${kb(total)}   ${C.d}(gzipped wire size)${C.x}`);

  console.log(`\n${C.b}Largest resources${C.x}`);
  for (const item of [...requests].sort((a, b) => b.size - a.size).slice(0, 12)) {
    console.log(`  ${String(kb(item.size)).padStart(10)}  ${item.url}`);
  }
}

await browser.close();
server.close();
