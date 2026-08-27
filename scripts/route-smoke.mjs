import { chromium } from 'playwright';
const BASE = process.argv[2] || 'https://gen-lang-client-0893216108.web.app';
// Every route in src/App.tsx. Two of the old entries did not exist — '/home'
// and '/mealplan' (the real path is '/meal-plan') — and the catch-all Route
// redirects an unknown path to '/', so both silently re-tested the Home page
// and reported OK. MealPlan was never covered at all. Ten routes were missing.
const routes = ['/', '/track', '/workout', '/community', '/profile', '/onboarding',
  '/wellness', '/explore', '/library', '/analytics', '/meal-plan', '/challenges',
  '/settings', '/privacy', '/delete-account', '/terms', '/pro', '/coach',
  '/nutrition-goals', '/lab', '/steps', '/achievements'];
const browser = await chromium.launch();
let bad = 0;
for (const r of routes) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try { await page.goto(BASE + r, { waitUntil: 'load', timeout: 25000 }); } catch {}
  await page.waitForTimeout(1500);
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  // A route that redirected is a route that was not tested. '/mealplan' passing
  // for months was exactly this, so treat an unexpected redirect as a failure.
  const landed = new URL(page.url()).pathname;
  const redirected = landed !== r && !(r === '/' && landed === '/');
  const crashed = /Something broke/i.test(body) || errs.length > 0 || redirected;
  if (crashed) bad++;
  const why = errs.length ? 'ERR: ' + errs[0]
    : redirected ? `REDIRECTED to ${landed} — route does not exist`
    : /Something broke/i.test(body) ? 'ErrorBoundary shown'
    : 'rendered ' + body.length + ' chars';
  console.log(`${crashed ? 'X ' : 'OK'}  ${r.padEnd(18)} ${why}`);
  await page.close();
}
console.log(`\n${bad === 0 ? 'ALL ROUTES CLEAN' : bad + ' ROUTE(S) CRASHED'}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
