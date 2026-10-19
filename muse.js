#!/usr/bin/env node
/**
 * Muse (muse.ai) login harness — runs on GitHub Actions (US IP).
 * Meta SSO: mobile/email + password. Screenshots every stage for offline diagnosis.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const EMAIL = process.env.FB_EMAIL || '';
const PASS = process.env.FB_PASS || '';
const CODE = (process.env.INVITE_CODE || '').trim();
mkdirSync('shots', { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function snap(page, tag) {
  let txt = '';
  try { txt = await page.innerText('body'); } catch (e) { txt = '(no body)'; }
  log(`[${tag}] url=${page.url}`);
  log(`[${tag}] text=${txt.slice(0, 700).replace(/\s+/g, ' ')}`);
  try { await page.screenshot({ path: `shots/${tag}.png`, fullPage: true }); } catch (e) {}
  return txt;
}

async function typeInto(page, sels, value, label) {
  for (const s of sels) {
    const loc = page.locator(s).first();
    try {
      if (await loc.count()) {
        await loc.click({ timeout: 5000 });
        await loc.fill(value);
        log(`filled ${label} via ${s}`);
        return true;
      }
    } catch (e) {}
  }
  log(`NO_FIELD ${label}`);
  return false;
}

async function clickAny(page, sels, label) {
  for (const s of sels) {
    const loc = page.locator(s).first();
    try {
      if (await loc.count() && await loc.isVisible()) {
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
await page.waitForTimeout(6000);
await snap(page, '01_landing');

await typeInto(page, ['input[name="email"]', 'input[type="email"]', 'input[placeholder*="Mobile"]', '#email'], EMAIL, 'email');
await page.waitForTimeout(800);

const hasPw = await page.locator('input[type="password"]').count();
if (hasPw) {
  await typeInto(page, ['input[type="password"]'], PASS, 'password');
  await clickAny(page, ['button[name="login"]', 'button[type="submit"]', 'button:has-text("Log in")'], 'login');
} else {
  await clickAny(page, ['button[type="submit"]', 'button:has-text("Continue")', 'button:has-text("Next")'], 'continue');
  await page.waitForTimeout(6000);
  await snap(page, '02_after_email');
  await typeInto(page, ['input[type="password"]'], PASS, 'password2');
  await clickAny(page, ['button[name="login"]', 'button[type="submit"]', 'button:has-text("Log in")', 'button:has-text("Continue")'], 'login2');
}

await page.waitForTimeout(15000);
await snap(page, '03_after_login');

const state = await ctx.storageState();
writeFileSync('state.json', JSON.stringify(state));
log('STATE_SAVED cookies=' + state.cookies.length);

if (CODE) {
  await page.goto('https://muse.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await snap(page, '04_app');
  await page.goto('https://muse.ai/settings', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await snap(page, '05_settings');
  await clickAny(page, ['text=Usage', 'a:has-text("Usage")', 'button:has-text("Usage")'], 'usage-tab');
  await page.waitForTimeout(3000);
  await snap(page, '06_usage');
  await typeInto(page, ['input[placeholder*="code" i]', 'input[name*="code" i]'], CODE, 'invite_code');
  await clickAny(page, ['button:has-text("Redeem")', 'button:has-text("Apply")', 'button:has-text("Submit")'], 'redeem');
  await page.waitForTimeout(8000);
  await snap(page, '07_after_redeem');
}

await browser.close();
log('DONE');
