// WebGL viewport proof harness.
//
//   npm run proof:viewport
//
// The biomechanics proof covers everything that can be decided without a GPU.
// This covers the rest, in a real browser with a real GL context:
//   • the custom muscle-heatmap shader actually compiles and links
//   • the avatar renders visible pixels (a broken shader still "renders" — it
//     just draws nothing, which no amount of unit testing will catch)
//   • every clip renders at every quality tier, including the geometry rebuild
//     the LOD guardrail performs
//   • dispose() releases every geometry and texture and drops the GL context
//   • ten mount/dispose cycles do not exhaust the browser's context budget
//
// Bundles scripts/viewport-harness.ts with esbuild, loads it in headless
// Chromium via Playwright, and reports the assertions the page made.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

const workDir = mkdtempSync(join(tmpdir(), 'ff-viewport-'));
const bundlePath = join(workDir, 'harness.js');
const pagePath = join(workDir, 'harness.html');

let exitCode = 0;
let browser;

try {
  console.log(`\n${C.b}${C.c}Bundling the viewport harness${C.x}\n`);
  // The JS API rather than the CLI: spawning a .cmd shim fails with EINVAL on
  // Node 24 for Windows, and this avoids the shell entirely.
  await build({
    entryPoints: ['scripts/viewport-harness.ts'],
    bundle: true,
    // IIFE, not ESM: Chromium refuses to load module scripts over file:// (CORS),
    // and inlining a classic script keeps the harness dependency-free.
    format: 'iife',
    target: 'es2020',
    outfile: bundlePath,
    logLevel: 'warning',
  });
  console.log(`  ${PASS} harness bundled`);

  const bundleSource = readFileSync(bundlePath, 'utf8');
  writeFileSync(
    pagePath,
    `<!doctype html><html><head><meta charset="utf-8"><title>viewport harness</title>
     <style>html,body{margin:0;background:#06070A}</style></head>
     <body><script>${bundleSource}<\/script></body></html>`,
  );

  browser = await chromium.launch({
    args: [
      // Headless Chromium needs an explicit software GL backend on CI machines
      // and on Windows runners without a real GPU.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(pathToFileURL(pagePath).href, { waitUntil: 'load', timeout: 60000 });
  try {
    await page.waitForFunction('typeof window.__runHarness === "function"', null, { timeout: 30000 });
  } catch (error) {
    // A module-level throw never reaches `pageerror` handlers registered later,
    // so surface whatever the page did report before giving up.
    if (pageErrors.length > 0) throw new Error(`harness failed to load: ${pageErrors[0]}`);
    if (consoleErrors.length > 0) throw new Error(`harness failed to load: ${consoleErrors[0]}`);
    throw error;
  }

  const result = await page.evaluate(() => window.__runHarness());

  console.log(`\n${C.b}${C.c}WebGL assertions${C.x}\n`);
  let passCount = 0;
  let failCount = 0;
  for (const item of result.steps) {
    if (item.ok) {
      passCount++;
      console.log(`  ${PASS} ${item.name}${item.detail ? ` ${C.d}— ${item.detail}${C.x}` : ''}`);
    } else {
      failCount++;
      console.log(`  ${FAIL} ${item.name}${item.detail ? ` ${C.d}— ${item.detail}${C.x}` : ''}`);
    }
  }

  // A shader that fails to compile shows up as a console error, not a throw, so
  // an otherwise-green run with GL errors in the console is still a failure.
  const shaderErrors = consoleErrors.filter((text) =>
    /shader|program|glsl|webgl/i.test(text),
  );
  if (pageErrors.length === 0) {
    passCount++;
    console.log(`  ${PASS} no uncaught page errors`);
  } else {
    failCount++;
    console.log(`  ${FAIL} no uncaught page errors ${C.d}— ${pageErrors[0]}${C.x}`);
  }
  if (shaderErrors.length === 0) {
    passCount++;
    console.log(`  ${PASS} no shader or WebGL errors on the console`);
  } else {
    failCount++;
    console.log(`  ${FAIL} no shader or WebGL errors on the console ${C.d}— ${shaderErrors[0]}${C.x}`);
  }

  const total = passCount + failCount;
  console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
  if (failCount > 0) {
    console.log(`${C.r}${C.b}PROOF FAILED${C.x}`);
    exitCode = 1;
  } else {
    console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
  }
} catch (error) {
  console.log(`\n${C.r}${C.b}PROOF FAILED${C.x} — ${error.message}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  rmSync(workDir, { recursive: true, force: true });
}

process.exit(exitCode);
