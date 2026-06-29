#!/usr/bin/env node
/**
 * Chain loop. Lihat chain-loop-config.js untuk dokumentasi.
 *
 * Per iterasi:
 *   1. Bikin tempmail
 *   2. Override config.xiaomi.referralLink + .inviteCode dengan ref akun sebelumnya
 *   3. Launch browser dengan random fingerprint
 *   4. registerOnly()  — sign up + verify email
 *   5. redeemInviteCode() — pakai ref code dari akun sebelumnya (sudah otomatis
 *      lewat config override + flow di MimoRegistration)
 *   6. getReferralCode() — ambil ref code akun ini buat iterasi berikutnya
 *   7. createApiKey()
 *   8. fillUltraspeedForm()
 */

import { chromium } from 'playwright';
import { join } from 'path';

import { MimoRegistration } from './index.js';
import './extras.js'; // attach getReferralCode
import { generateFingerprint, buildInitScript, buildExtraHeaders } from './fingerprint.js';

import {
  config, saveResult, logFail, count, seedRef, outputFile, failLog, __dirname,
} from './chain-loop-config.js';

// ---- One-iteration runner --------------------------------------------

async function runIteration(idx, total, currentRef) {
  console.log('\n' + '═'.repeat(70));
  console.log(`   [${idx + 1}/${total}] Chain Iteration  (using ref: ${currentRef})`);
  console.log('═'.repeat(70));

  // Per-iter: clone config + override invite code & referral link
  const iterConfig = JSON.parse(JSON.stringify(config));
  iterConfig.xiaomi.inviteCode = currentRef;
  iterConfig.xiaomi.referralLink =
    `https://platform.xiaomimimo.com/?ref=${encodeURIComponent(currentRef)}`;

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
    console.log('[1/8] Creating temporary email...');
    email = await reg.tempmail.createInbox();
    console.log(`✓ Email: ${email}`);

    // 2. Browser
    console.log('[2/8] Launching browser...');
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

    // Skip screenshot dump
    const origScreenshot = reg.page.screenshot.bind(reg.page);
    reg.page.screenshot = async (opts = {}) => {
      const isError = opts.path && opts.path.includes('error');
      if (isError || iterConfig.browser.screenshots === true) return origScreenshot(opts);
      return Buffer.alloc(0);
    };

    // 3. Open referral link (refCode chained)
    console.log('[3/8] Opening referral page...');
    await reg.page.goto(iterConfig.xiaomi.referralLink, {
      waitUntil: 'networkidle',
      timeout: iterConfig.browser.timeout,
    });

    // 4. Sign up form
    console.log('[4/8] Filling Sign up form...');
    await reg.fillRegistrationForm(email);
    await reg.submitRegistration();

    // 5. Captcha
    console.log('[5/8] Handling captcha...');
    await reg.handleXiaomiCaptcha();
    await reg.handleImageCaptcha();

    // 6. Verify email
    console.log('[6/8] Verifying email...');
    await reg.verifyEmail(email);

    // 7. Redeem invite + create API key (idempotent — gpp meskipun udah)
    //    flow di MimoRegistration: clickConsoleMenu → balance → handleTerms →
    //    cek "Enter invite code" → kalau ada redeem, kalau tidak skip.
    let redeemRestricted = false;
    try {
      await reg.redeemInviteCode();
    } catch (e) {
      if (e.code === 'ACCOUNT_RESTRICTED' || e.code === 'BALANCE_NOT_CREDITED') {
        // Akun kena risk control / balance gak nambah — STOP propagate
        // ke caller biar chain-loop berhenti.
        const tag = e.code === 'ACCOUNT_RESTRICTED' ? 'restricted' : 'balance not credited';
        console.log(`  ❌ Stopping iteration — ${tag}: ${e.message}`);
        redeemRestricted = true;
        throw e;
      }
      console.log(`  ! redeem error (lanjut): ${e.message}`);
    }

    // 8. Create API key (atau ambil existing)
    console.log('[7/8] Creating API key...');
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
    //     side-effect step redeem/apikey/ultraspeed sebelumnya.
    console.log('[8/8] Fetching referral code for next iteration...');
    try {
      const captured = await reg.getReferralCode();
      if (captured && captured.toUpperCase() === currentRef.toUpperCase()) {
        // Bug guard: kalau refCode == seed yg baru di-redeem, artinya
        // getReferralCode tertipu (clipboard leak / modal salah / dst).
        console.log(`  ! refCode "${captured}" == seed "${currentRef}" — invalid, treating as null`);
        try {
          await reg.page.screenshot({
            path: join(__dirname, `chain-refcode-leak-${Date.now()}.png`),
            fullPage: true,
          });
        } catch (e) {}
        refCode = null;
      } else {
        refCode = captured;
        console.log(`✓ My ref code: ${refCode || '(not found)'}`);
      }
    } catch (e) {
      console.log(`  ! getReferralCode error: ${e.message}`);
    }

    saveResult({
      email,
      password: iterConfig.xiaomi.password,
      refCode,
      apiKey,
      invitedBy: currentRef,
    });

    console.log('═'.repeat(70));
    console.log(`✅ ITERATION ${idx + 1} DONE`);
    console.log(`   Email   : ${email}`);
    console.log(`   RefCode : ${refCode || '(not found)'}`);
    console.log(`   ApiKey  : ${apiKey || '(none)'}`);
    console.log('═'.repeat(70));

    return { ok: true, email, refCode, apiKey };
  } catch (err) {
    console.error(`\n❌ Iteration ${idx + 1} failed: ${err.message}`);
    if (reg.page) {
      try {
        await reg.page.screenshot({
          path: join(__dirname, `chain-error-${Date.now()}.png`),
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
  console.log(`\nChain loop config:`);
  console.log(`  Count       : ${count}`);
  console.log(`  Seed ref    : ${seedRef}`);
  console.log(`  Output file : ${outputFile}`);
  console.log(`  Fail log    : ${failLog}\n`);

  let currentRef = seedRef;
  let okCount = 0, failCount = 0;

  for (let i = 0; i < count; i++) {
    const result = await runIteration(i, count, currentRef);

    if (result.ok) {
      okCount++;
      // Chain: kalau berhasil dapet refCode, pake itu untuk iterasi berikut
      if (result.refCode) {
        console.log(`\n→ Next iteration will use ref: ${result.refCode}`);
        currentRef = result.refCode;
      } else {
        // refCode gak ke-capture — chain rusak. STOP biar gak bikin
        // beberapa akun pakai invite code yang sama (bisa dianggap fraud
        // sama Xiaomi).
        console.error(`\n❌ Iteration ${i + 1} succeeded but didn't capture refCode.`);
        console.error(`   STOPPING chain to prevent reusing seed ${currentRef}.`);
        console.error(`   Run lagi dengan --seed ${currentRef} kalau mau lanjut manual.`);
        break;
      }
    } else {
      failCount++;
      if (result.restricted) {
        // Akun kena risk control / balance gak nambah — STOP loop, jangan retry
        const reason = result.stopReason || 'unknown';
        console.error(`\n❌ Chain stopped: ${reason}`);
        console.error(`   Email: ${result.email}`);
        console.error(`   Detail: ${result.error}`);
        console.error(`   Last seed used: ${currentRef}`);
        break;
      }
      // Iter total fail (non-restriction) — currentRef gak di-update, retry pakai seed yang sama
      console.log(`\n! Iteration failed, retrying with same seed ${currentRef}`);
    }

    if (i < count - 1) {
      const wait = 8000 + Math.floor(Math.random() * 6000);
      console.log(`  Waiting ${(wait / 1000).toFixed(1)}s before next...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('   CHAIN LOOP SUMMARY');
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
