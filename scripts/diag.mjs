import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://gen-lang-client-0893216108.web.app';
const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
const consoleMsgs = [];
const failed = [];

page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));
page.on('requestfailed', (r) => failed.push(`FAILED ${r.url()} — ${r.failure()?.errorText}`));

console.log(`\nLoading ${URL} ...\n`);
try {
  // 'load' not 'networkidle': Firestore keeps a long-poll open, so the network
  // never truly idles and 'networkidle' always times out (a false positive).
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
} catch (e) {
  console.log('goto error:', e.message);
}
await page.waitForTimeout(2500);

const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
const rootHtml = (await page.locator('#root').innerHTML().catch(() => 'NO #root')) || '';

console.log('=== PAGE ERRORS ===');
console.log(errors.length ? errors.join('\n---\n') : '(none)');
console.log('\n=== CONSOLE (errors/warnings) ===');
console.log(consoleMsgs.filter((m) => /error|warn|uncaught|fail/i.test(m)).join('\n') || '(none)');
console.log('\n=== FAILED REQUESTS ===');
console.log(failed.join('\n') || '(none)');
console.log('\n=== #root non-empty? ===', rootHtml.trim().length, 'chars');
console.log('=== visible body text (first 300) ===');
console.log(JSON.stringify(bodyText.slice(0, 300)));

await browser.close();
