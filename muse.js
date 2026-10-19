#!/usr/bin/env node
/**
 * Muse (muse.ai) login harness — GitHub Actions (US IP).
 * Meta SSO: mobile/email + password. Screenshots saved to CWD (workflow uploads *.png).
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
  log(`[${tag}] text=${txt.slice(0, 900).replace(/\s+/g, ' ')}`);
  try { await page.screenshot({ path: `${tag}.png`, fullPage: true }); } catch (e) {}
  return txt;
}

async function humanType(loc, value) {
  await loc.click({ timeout: 8000 });
  await loc.fill('');
  await loc.pressSequentially(value, { delay: 45 });
}

async function findField(page, sels) {
  for (const s of sels) {
    const loc = page.locator(s).first();
    try { if (await loc.count() && await loc.isVisible()) return loc; } catch (e) {}
  }
  return null;
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
await page.waitForTimeout(7000);
await snap(page, '01_landing');

const emailSel = ['input[placeholder*="Mobile"]', 'input[name="email"]', 'input[type="email"]', '#email'];
let emailLoc = await findField(page, emailSel);
if (!emailLoc) {
  log('NO_EMAIL_FIELD');
} else {
  await humanType(emailLoc, EMAIL);
  await page.waitForTimeout(1500);
  await snap(page, '02_email_typed');
  await clickAny(page, ['button[type="submit"]', 'button:has-text("Continue")', 'div[role="button"]:has-text("Continue")'], 'continue');
  await page.waitForTimeout(9000);
  await snap(page, '03_after_continue');
}

const pwLoc = await findField(page, ['input[type="password"]', 'input[name="pass"]']);
if (pwLoc) {
  log('PASSWORD_FIELD_PRESENT');
  await humanType(pwLoc, PASS);
  await page.waitForTimeout(1200);
  await clickAny(page, ['button[name="login"]', 'button[type="submit"]', 'button:has-text("Log in")', 'div[role="button"]:has-text("Log in")'], 'login');
  await page.waitForTimeout(18000);
  await snap(page, '04_after_login');
} else {
  log('NO_PASSWORD_FIELD');
}

const state = await ctx.storageState();
writeFileSync('state.json', JSON.stringify(state));
log('STATE_SAVED cookies=' + state.cookies.length);

if (CODE) {
  for (const u of ['https://muse.ai/settings', 'https://muse.ai/settings/usage']) {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(6000);
    await snap(page, '05_' + u.split('/').pop());
  }
  const codeLoc = await findField(page, ['input[placeholder*="code" i]', 'input[name*="code" i]', 'input[placeholder*="invite" i]']);
  if (codeLoc) {
    await humanType(codeLoc, CODE);
    await clickAny(page, ['button:has-text("Redeem")', 'button:has-text("Apply")', 'button:has-text("Submit")'], 'redeem');
    await page.waitForTimeout(9000);
    await snap(page, '06_after_redeem');
  } else {
    log('NO_CODE_FIELD');
  }
}

await browser.close();
log('DONE');
