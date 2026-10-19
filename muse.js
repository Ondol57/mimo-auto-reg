#!/usr/bin/env node
import { chromium } from 'playwright';
const EMAIL = process.env.FB_EMAIL || '';
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);

const b = await chromium.launch({
  headless: true,
  args: ['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled',
         '--disable-features=IsolateOrigins,site-per-process'],
});
const ctx = await b.newContext({ viewport:{width:1280,height:900}, locale:'en-US', timezoneId:'America/Los_Angeles',
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type()==='error') log('CONSOLE_ERR', m.text().slice(0,160)); });
await page.goto('https://muse.ai/', { waitUntil:'domcontentloaded', timeout:60000 });
await page.waitForTimeout(9000);
log('WEBDRIVER', await page.evaluate(() => String(navigator.webdriver)));

const cx = 640, cy = 553;
await page.mouse.click(cx, cy);
await page.waitForTimeout(500);
log('ACTIVE', await page.evaluate(() => document.activeElement?.placeholder || document.activeElement?.tagName));
await page.keyboard.type(EMAIL, { delay: 80 });
await page.waitForTimeout(1500);
log('VAL', JSON.stringify(await page.evaluate(() => document.querySelector('input[placeholder*="Mobile"]').value)));
await page.screenshot({ path:'y1.png' });

const v = await page.evaluate(() => document.querySelector('input[placeholder*="Mobile"]').value);
if (v) {
  await page.locator('button:has-text("Continue")').first().click();
  await page.waitForTimeout(12000);
  log('AFTER_CONTINUE_URL', page.url());
  log('PW_FIELDS', await page.locator('input[type="password"]').count());
  log('TEXT', (await page.innerText('body')).slice(0,400).replace(/\s+/g,' '));
  await page.screenshot({ path:'y2.png' });
}
await b.close();
