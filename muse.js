#!/usr/bin/env node
/**
 * Muse (muse.ai) login harness — GitHub Actions (US IP).
 * Meta SSO. Meta's form is React-controlled: plain typing/fill does NOT register,
 * so we set the value through the native input setter + dispatch input event.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const EMAIL = process.env.FB_EMAIL || '';
const PASS = process.env.FB_PASS || '';
const CODE = (process.env.INVITE_CODE || '').trim();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function snap(page, tag) {
  let txt = '';
  try { txt = await page.innerText('body'); } catch (e) { txt = '(no body)'; }
  log(`[${tag}] url=${page.url()}`);
  log(`[${tag}] text=${txt.slice(0, 800).replace(/\s+/g, ' ')}`);
  try { await page.screenshot({ path: `${tag}.png`, fullPage: true }); } catch (e) {}
  return txt;
}

// React-safe value set. Returns the value the DOM actually holds afterwards.
async function setValue(page, selector, value) {
  return page.evaluate(([sel, val]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }, [selector, value]);
}

async function clickAny(page, sels, label) {
  for (const s of sels) {
    const loc = page.locator(s).first();
    try {
      if (await loc.count() && await loc.isVisible() && await loc.isEnabled()) {
        await loc.click({ timeout: 8000 });
        log(`clicked ${label} via ${s}`);
        return true;
      }
    } catch (e) {}
  }
  log(`NO_BUTTON ${label}`);
  return false;
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US', timezoneId: 'America/Los_Angeles',
});
const page = await ctx.newPage();

await page.goto('https://muse.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await snap(page, '01_landing');

const got = await setValue(page, 'input[placeholder*="Mobile"]', EMAIL);
log('EMAIL_SET', JSON.stringify(got));
if (got !== EMAIL) { log('EMAIL_SET_FAILED'); }
await page.waitForTimeout(1200);
await snap(page, '02_email_typed');

await clickAny(page, ['button:has-text("Continue")', 'button[type="submit"]'], 'continue');
await page.waitForTimeout(10000);
await snap(page, '03_after_continue');

const pwSet = await setValue(page, 'input[type="password"]', PASS);
log('PASS_SET', pwSet === null ? 'NO_PASSWORD_FIELD' : 'len=' + String(pwSet).length);
if (pwSet !== null) {
  await page.waitForTimeout(1000);
  await clickAny(page, ['button:has-text("Log in")', 'button[name="login"]', 'button[type="submit"]'], 'login');
  await page.waitForTimeout(20000);
  await snap(page, '04_after_login');
}

const state = await ctx.storageState();
writeFileSync('state.json', JSON.stringify(state));
log('STATE_SAVED cookies=' + state.cookies.length + ' names=' + state.cookies.map(c => c.name).slice(0, 12).join(','));

if (CODE) {
  await page.goto('https://muse.ai/settings/usage', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(7000);
  await snap(page, '05_usage');
  const codeSet = await setValue(page, 'input[placeholder*="code" i], input[name*="code" i], input[placeholder*="invite" i]', CODE);
  log('CODE_SET', codeSet === null ? 'NO_CODE_FIELD' : codeSet);
  if (codeSet) {
    await clickAny(page, ['button:has-text("Redeem")', 'button:has-text("Apply")', 'button:has-text("Submit")'], 'redeem');
    await page.waitForTimeout(9000);
    await snap(page, '06_after_redeem');
  }
}

await browser.close();
log('DONE');
