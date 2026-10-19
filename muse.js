#!/usr/bin/env node
import { chromium } from 'playwright';
const EMAIL = process.env.FB_EMAIL || '';
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);

const b = await chromium.launch({ args:['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport:{width:1280,height:900}, locale:'en-US', timezoneId:'America/Los_Angeles',
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
const page = await ctx.newPage();

page.on('request', r => { if (['xhr','fetch','document'].includes(r.resourceType())) log('REQ', r.method(), r.url().slice(0,120)); });
page.on('response', r => { if (r.url().includes('login') || r.url().includes('auth')) log('RES', r.status(), r.url().slice(0,120)); });
page.on('framenavigated', f => { if (f === page.mainFrame()) log('NAV', f.url().slice(0,120)); });

await page.goto('https://muse.ai/', { waitUntil:'domcontentloaded', timeout:60000 });
await page.waitForTimeout(8000);

const inputs = await page.$$eval('input', els => els.map(e => ({type:e.type, name:e.name, ph:e.placeholder, vis:!!(e.offsetWidth||e.offsetHeight)})));
log('INPUTS', JSON.stringify(inputs));

const loc = page.locator('input[placeholder*="Mobile"]').first();
await loc.click();
await loc.pressSequentially(EMAIL, { delay: 60 });
await page.waitForTimeout(1500);
log('VALUE_AFTER_TYPE', JSON.stringify(await loc.inputValue()));

const btns = await page.$$eval('button', els => els.map(e => ({t:(e.innerText||'').trim().slice(0,30), disabled:e.disabled, vis:!!(e.offsetWidth||e.offsetHeight)})));
log('BUTTONS', JSON.stringify(btns));

await page.screenshot({ path:'d1_typed.png' });
await loc.press('Enter');
await page.waitForTimeout(10000);
log('URL_AFTER_ENTER', page.url());
log('VALUE_AFTER_ENTER', JSON.stringify(await loc.inputValue().catch(()=> '(gone)')));
const txt = await page.innerText('body');
log('TEXT', txt.slice(0,700).replace(/\s+/g,' '));
await page.screenshot({ path:'d2_after_enter.png' });

const pw = await page.locator('input[type="password"]').count();
log('PW_COUNT', pw);
await b.close();
