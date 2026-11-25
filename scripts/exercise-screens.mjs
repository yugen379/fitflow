// Render key frames of generated exercise demos to PNGs for eyeballing.
//
//   node scripts/exercise-screens.mjs <outDir> [id@t@azimuth ...]
//
// Defaults to the five key frames called out in the motion spec (squat bottom,
// push-up bottom, deadlift hinge, curl top, jumping-jack open). Uses the same
// solver path as the app viewport via scripts/exercise-screens-harness.ts.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright';

const outDir = resolve(process.argv[2] ?? 'exercise-screens');
const specs = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['squats@0.5@-0.9', 'pushups@0.5@-1.4', 'romanian_deadlift@0.5@-1.4', 'bicep_curls@0.5@-1.2', 'jump_jacks_v2@0.5@0'];

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ff-screens-'));
const bundle = join(work, 'h.js');
await build({ entryPoints: ['scripts/exercise-screens-harness.ts'], bundle: true, format: 'iife', target: 'es2020', outfile: bundle, logLevel: 'warning' });
const page$ = join(work, 'h.html');
writeFileSync(page$, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#06070A}</style></head><body><script>${readFileSync(bundle, 'utf8')}<\/script></body></html>`);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 520, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(page$).href);
  await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 30000 });
  for (const spec of specs) {
    const [id, t = '0.5', az = '-0.9'] = spec.split('@');
    const r = await page.evaluate(([a, b, c]) => window.renderExercise(a, Number(b), Number(c)), [id, t, az]);
    const file = join(outDir, `${id}_t${t}_az${az}.png`);
    await page.locator('canvas').screenshot({ path: file });
    console.log(`${r === 'ok' ? 'saved' : r} ${file}`);
  }
  if (errors.length) console.log('page errors:', errors);
  // Contact sheet of everything rendered, labelled, for a one-glance review.
  const files = specs.map((spec) => {
    const [id, t = '0.5', az = '-0.9'] = spec.split('@');
    return { label: `${id} t=${t}`, src: pathToFileURL(join(outDir, `${id}_t${t}_az${az}.png`)).href };
  });
  const cols = 4;
  const sheet = join(work, 'sheet.html');
  writeFileSync(sheet, `<!doctype html><html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},260px);gap:2px">${files
    .map((f) => `<div style="position:relative"><img src="${f.src}" width="260" height="320"><div style="position:absolute;top:4px;left:6px;color:#ccc;font:12px sans-serif">${f.label}</div></div>`)
    .join('')}</body></html>`);
  const sp = await browser.newPage({ viewport: { width: cols * 262, height: Math.ceil(files.length / cols) * 322 } });
  await sp.goto(pathToFileURL(sheet).href);
  await sp.waitForLoadState('load');
  await sp.screenshot({ path: join(outDir, 'contact-sheet.png'), fullPage: true });
  console.log(`saved ${join(outDir, 'contact-sheet.png')}`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
