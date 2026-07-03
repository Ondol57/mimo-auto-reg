#!/usr/bin/env node
/**
 * Regis loop: register → create API key → fill Ultraspeed form → get referral code.
 * Skips the "redeem invite code" step (entering code ref in balance page).
 *
 * Cara pakai:
 *   node regis-loop.js --count 5
 *
 * Output (regis-result.txt) format:
 *   email:password:refCode:apiKey
 */

import { chromium } from 'playwright';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { MimoRegistration } from './index.js';
import './extras.js'; // attach getReferralCode
import { generateFingerprint, buildInitScript, buildExtraHeaders } from './fingerprint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Output dir override via env var
const outputDir = process.env.HERMES_BOT_MIMO_CWD || __dirname;

// Config path override
const configPath = process.env.HERMES_BOT_MIMO_CONFIG || join(__dirname, 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// ---- CLI args ---------------------------------------------------------

const args = process.argv.slice(2);

const countIdx = args.indexOf('--count');
const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 1;

const outputIdx = args.indexOf('--output');
const outputFile = outputIdx !== -1
  ? join(outputDir, args[outputIdx + 1])
  : join(outputDir, 'regis-result.txt');

const failLog = join(outputDir, 'regis-fail.log');

// ---- File helpers -----------------------------------------------------

function saveResult(row) {
  if (!existsSync(outputFile)) {
    appendFileSync(
      outputFile,
      '# Regis loop results. Format: email:password:refCode:apiKey\n',
      'utf8'
    );
  }
  const line = [
    row.email,
    row.password,
    row.refCode || '',
    row.apiKey || '',
  ].join(':') + '\n';
  appendFileSync(outputFile, line, 'utf8');
}

function logFail(email, error) {
  const line = `[${new Date().toISOString()}] ${email || 'unknown'}  | ${error}\n`;
  appendFileSync(failLog, line, 'utf8');
}

// ---- One-iteration runner --------------------------------------------

async function runIteration(idx, total) {
  console.log('\n' + '═'.repeat(70));
  console.log(`   [${idx + 1}/${total}] Regis Iteration`);
  console.log('═'.repeat(70));

  // Per-iter: clone config + set referral link to direct URL (no referral parameter)
  const iterConfig = JSON.parse(JSON.stringify(config));
  iterConfig.xiaomi.inviteCode = '';
  iterConfig.xiaomi.referralLink = 'https://platform.xiaomimimo.com/';

  const reg = new MimoRegistration(iterConfig);

  const cleanup = async () => {
    if (reg.browser) {
      console.log('\n  Caught SIGINT, closing browser...');
      try { await reg.browser.close(); } catch (e) {}
    }
    process.exit(130);
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  let email = null, refCode = null, apiKey = null;

  try {
    // 1. Tempmail
    console.log('[1/7] Creating temporary email...');
    email = await reg.tempmail.createInbox();
    console.log(`✓ Email: ${email}`);

    // 2. Browser
    console.log('[2/7] Launching browser...');
    const fp = generateFingerprint();
    reg.fingerprint = fp;
    console.log(`  ↳ Chrome ${fp.chromeMajor}, ${fp.viewport.width}x${fp.viewport.height}, ${fp.locale}/${fp.timezone}`);

    reg.browser = await chromium.launch({
      headless: iterConfig.browser.headless,
      channel: 'chrome',
      args: [
        `--window-size=${fp.viewport.width},${fp.viewport.height}`,
        '--disable-blink-features=AutomationControlled',
      ],
    });
    const ctx = await reg.browser.newContext({
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      deviceScaleFactor: fp.deviceScaleFactor,
      locale: fp.locale,
      timezoneId: fp.timezone,
      screen: { width: fp.screen.width, height: fp.screen.height },
      extraHTTPHeaders: buildExtraHeaders(fp),
    });
    await ctx.addInitScript({ content: buildInitScript(fp) });
    reg.page = await ctx.newPage();

    // Skip screenshot dump unless config.browser.screenshots is true
    const origScreenshot = reg.page.screenshot.bind(reg.page);
    reg.page.screenshot = async (opts = {}) => {
      const isError = opts.path && opts.path.includes('error');
      if (isError || iterConfig.browser.screenshots === true) return origScreenshot(opts);
      return Buffer.alloc(0);
    };

    // 3. Open registration page directly
    console.log('[3/7] Opening registration page...');
    await reg.page.goto(iterConfig.xiaomi.referralLink, {
      waitUntil: 'networkidle',
      timeout: iterConfig.browser.timeout,
    });

    // 4. Sign up form
    console.log('[4/7] Filling Sign up form...');
    await reg.fillRegistrationForm(email);
    await reg.submitRegistration();

    // 5. Captcha
    console.log('[5/7] Handling captcha...');
    await reg.handleXiaomiCaptcha();
    await reg.handleImageCaptcha();

    // 6. Verify email
    console.log('[6/7] Verifying email...');
    await reg.verifyEmail(email);

    // 7. Skip Redeem
    console.log('[Info] Skipping redeem/enter invite code step.');

    // 8. Create API key (atau ambil existing)
    console.log('[7/7] Creating API key...');
    try {
      apiKey = await reg.createApiKey();
      console.log(`✓ API key: ${apiKey || '(none)'}`);
    } catch (e) {
      console.log(`  ! createApiKey error: ${e.message}`);
    }

    // 9. Fill Ultraspeed form (best-effort)
    console.log('[Bonus] Fill Ultraspeed form...');
    try {
      await reg.fillUltraspeedForm(email);
    } catch (e) {
      console.log(`  ! fillUltraspeedForm error: ${e.message}`);
    }

    // 10. Ambil ref code akun ini PALING AKHIR — biar clipboard clean dari
    //     side-effect step apikey/ultraspeed sebelumnya.
    console.log('[Bonus] Fetching referral code...');
    try {
      const captured = await reg.getReferralCode();
      refCode = captured;
      console.log(`✓ My ref code: ${refCode || '(not found)'}`);
    } catch (e) {
      console.log(`  ! getReferralCode error: ${e.message}`);
    }

    saveResult({
      email,
      password: iterConfig.xiaomi.password,
      refCode,
      apiKey,
    });

    console.log('═'.repeat(70));
    console.log(`✅ ITERATION ${idx + 1} DONE`);
    console.log(`   Email   : ${email}`);
    console.log(`   RefCode : ${refCode || '(not found)'}`);
    console.log(`   ApiKey  : ${apiKey || '(none)'}`);
    console.log('═'.repeat(70));

    return { ok: true, email, refCode, apiKey };
  } catch (err) {
    console.error(`\n❌ Regis Iteration ${idx + 1} failed: ${err.message}`);
    if (reg.page) {
      try {
        await reg.page.screenshot({
          path: join(__dirname, `regis-error-${Date.now()}.png`),
          fullPage: true,
        });
      } catch (e) {}
    }
    logFail(email, err.message);
    return {
      ok: false,
      email,
      error: err.message,
      restricted: err.code === 'ACCOUNT_RESTRICTED' || err.code === 'BALANCE_NOT_CREDITED',
      stopReason: err.code,
    };
  } finally {
    if (reg.browser) {
      await reg.browser.close().catch(() => {});
    }
  }
}

// ---- Main loop -------------------------------------------------------

async function main() {
  console.log(`\nRegis loop config:`);
  console.log(`  Count       : ${count}`);
  console.log(`  Output file : ${outputFile}`);
  console.log(`  Fail log    : ${failLog}\n`);

  let okCount = 0, failCount = 0;

  for (let i = 0; i < count; i++) {
    const result = await runIteration(i, count);

    if (result.ok) {
      okCount++;
    } else {
      failCount++;
      if (result.restricted) {
        const reason = result.stopReason || 'unknown';
        console.error(`\n❌ Loop stopped: ${reason}`);
        console.error(`   Email: ${result.email}`);
        console.error(`   Detail: ${result.error}`);
        break;
      }
      console.log(`\n! Iteration failed, retrying...`);
    }

    if (i < count - 1) {
      const wait = 120000 + Math.floor(Math.random() * 180000);
      console.log(`  Waiting ${(wait / 1000).toFixed(1)}s before next...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('   REGIS LOOP SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Total      : ${count}`);
  console.log(`   Successful : ${okCount}`);
  console.log(`   Failed     : ${failCount}`);
  console.log(`   Output     : ${outputFile}`);
  console.log('═'.repeat(70) + '\n');

  process.exit(okCount > 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
