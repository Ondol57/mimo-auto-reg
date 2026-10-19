#!/usr/bin/env node
/**
 * Muse (muse.ai) login harness — GitHub Actions.
 *
 * STATUS: BLOCKED. Meta rate-limits datacenter IPs (HTTP 429 on the auth
 * attestation call), so the login form renders but stays inert: the input
 * accepts focus and trusted keystrokes, then React resets value to "".
 * Confirmed: webdriver hidden, keyboard.type + CDP insertText + native
 * setter all end with value === "". Do not burn more Actions minutes on it
 * from a cloud IP. Run this from a residential IP (local browser) instead.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const EMAIL = process.env.FB_EMAIL || '';
const PASS = process.env.FB_PASS || '';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function snap(page, tag) {
  let txt = '';
  try { txt = await page.innerText('body'); } catch (e) {}
  log(`[${tag}] url=${page.url()}`);
  log(`[${tag}] text=${txt.slice(0, 500).replace(/\s+/g, ' ')}`);
  try { await page.screenshot({ path: `${tag}.png`, fullPage: true }); } catch (e) {}
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US', timezoneId: 'America/Los_Angeles',
});
const page = await ctx.newPage();
page.on('response', r => { if (r.status() === 429) log('RATE_LIMITED', r.url().slice(0, 100)); });

await page.goto('https://muse.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await snap(page, '01_landing');

const box = await page.locator('input[placeholder*="Mobile"]').first().boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type(EMAIL, { delay: 80 });
  await page.waitForTimeout(1500);
  const val = await page.evaluate(() => document.querySelector('input[placeholder*="Mobile"]')?.value || '');
  log('EMAIL_VALUE', JSON.stringify(val), val ? 'OK' : 'BLOCKED_BY_META');
  await snap(page, '02_email_typed');
}

writeFileSync('state.json', JSON.stringify(await ctx.storageState()));
log('DONE');
