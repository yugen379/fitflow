import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
for (const target of ['https://gen-lang-client-0893216108.web.app',
                   'https://gen-lang-client-0893216108.firebaseapp.com']) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const fails=[];
  page.on('response', async r=>{
    if(/firebaseappcheck/.test(r.url()) && r.status()>=400){
      let b=''; try{b=(await r.text()).slice(0,140);}catch(e){}
      fails.push(`${r.status()} ${b.replace(/\s+/g,' ')}`);
    }
  });
  await page.goto(target,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(9000);
  const host = target.replace('https://','');
  console.log(`${host.padEnd(46)} ${fails.length? 'APP CHECK 403: '+fails[0] : 'App Check OK — no 403'}`);
  await ctx.close();
}
await browser.close();
