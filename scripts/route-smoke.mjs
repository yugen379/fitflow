import { chromium } from 'playwright';
const BASE = process.argv[2] || 'https://gen-lang-client-0893216108.web.app';
const routes = ['/', '/home', '/track', '/workout', '/community', '/profile', '/explore', '/library', '/analytics', '/challenges', '/wellness', '/mealplan'];
const browser = await chromium.launch();
let bad = 0;
for (const r of routes) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try { await page.goto(BASE + r, { waitUntil: 'load', timeout: 25000 }); } catch {}
  await page.waitForTimeout(1500);
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  const crashed = /Something broke/i.test(body) || errs.length > 0;
  if (crashed) bad++;
  console.log(`${crashed ? 'X ' : 'OK'}  ${r.padEnd(12)} ${errs.length ? 'ERR: ' + errs[0] : (crashed ? 'ErrorBoundary shown' : 'rendered ' + body.length + ' chars')}`);
  await page.close();
}
console.log(`\n${bad === 0 ? 'ALL ROUTES CLEAN' : bad + ' ROUTE(S) CRASHED'}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
