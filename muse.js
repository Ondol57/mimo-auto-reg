#!/usr/bin/env node
import { chromium } from 'playwright';
const EMAIL = process.env.FB_EMAIL || '';
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);

const b = await chromium.launch({ args:['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport:{width:1280,height:900}, locale:'en-US', timezoneId:'America/Los_Angeles',
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
const page = await ctx.newPage();
await page.goto('https://muse.ai/', { waitUntil:'domcontentloaded', timeout:60000 });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const el = document.querySelector('input[placeholder*="Mobile"]');
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return {
    rect: {x:r.x, y:r.y, w:r.width, h:r.height},
    readOnly: el.readOnly, disabled: el.disabled,
    tag: el.tagName, cls: (el.className||'').slice(0,60),
    parentTag: el.parentElement ? el.parentElement.tagName : null,
    topEl: top ? top.tagName + '.' + (top.className||'').toString().slice(0,40) : null,
    topIsInput: top === el,
    iframes: document.querySelectorAll('iframe').length,
  };
});
log('INFO', JSON.stringify(info));

// A: click by coordinates then keyboard.type
const cx = info.rect.x + info.rect.w/2, cy = info.rect.y + info.rect.h/2;
await page.mouse.click(cx, cy);
await page.waitForTimeout(400);
log('ACTIVE_A', await page.evaluate(() => document.activeElement ? document.activeElement.tagName + '|' + (document.activeElement.placeholder||'') : 'none'));
await page.keyboard.type(EMAIL, { delay: 70 });
await page.waitForTimeout(1000);
log('VAL_A', JSON.stringify(await page.evaluate(() => document.querySelector('input[placeholder*="Mobile"]').value)));

// B: CDP insertText
await page.evaluate(() => { const el=document.querySelector('input[placeholder*="Mobile"]'); el.focus(); });
await page.keyboard.insertText(EMAIL);
await page.waitForTimeout(1000);
log('VAL_B', JSON.stringify(await page.evaluate(() => document.querySelector('input[placeholder*="Mobile"]').value)));

await page.screenshot({ path:'x1.png' });
const btns = await page.$$eval('button', els => els.map(e => ({t:(e.innerText||'').trim().slice(0,20), id:e.id, aria:e.getAttribute('aria-label')})));
log('BTNS', JSON.stringify(btns.slice(0,8)));

await b.close();
