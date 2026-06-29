/**
 * Method tambahan untuk MimoRegistration yang dipakai bersama oleh
 * register-only.js dan chain-loop.js. Di-attach via prototype biar gak
 * perlu modifikasi index.js.
 */

import { humanDelay } from './human.js';
import { MimoRegistration } from './index.js';

// Common English words yg sering ke-match regex code uppercase.
const REF_BLACKLIST = new Set([
  'YOUR', 'CODE', 'INVITE', 'REFERRAL', 'ENTER', 'COPY', 'SHARE',
  'EARN', 'NULL', 'NONE', 'TRUE', 'FALSE', 'EMPTY',
]);

/**
 * Validate ref code — Xiaomi MiMo invite codes are always EXACTLY 6 chars
 * alphanumeric uppercase. Sample valid: T9K59J, 4G7RWD, K3M2P8, HWPMXZ,
 * AXQZ3F, TQB65X, P9LHUK — semua 6 char.
 *
 * Pattern lebih dari 6 char (mis. "DIMASSARI59" = 11 char username email)
 * harus ditolak.
 */
function isValidRefCode(s) {
  if (!s) return false;
  const up = String(s).toUpperCase().trim();
  if (up.length !== 6) return false;
  if (REF_BLACKLIST.has(up)) return false;
  return /^[A-Z0-9]{6}$/.test(up);
}

/**
 * Ambil kode referal milik akun yang sedang login.
 * Strategi:
 *   1. Scan semua link/href yang ada `?ref=XXXXXX`
 *   2. Cari teks "Invite code: XXXXXX" di body
 *   3. Klik tombol "Refer & earn" / "Invite friends" → modal → scan + clipboard
 */
MimoRegistration.prototype.getReferralCode = async function () {
  // Navigate ke balance page (kalau belum di sana)
  const currentUrl = this.page.url();
  if (!currentUrl.includes('/console/balance')) {
    try { await this.clickConsoleMenu(); } catch (e) {}

    if (!this.page.url().includes('/console/balance')) {
      await this.page.goto('https://platform.xiaomimimo.com/console/balance', {
        waitUntil: 'networkidle',
        timeout: this.config.browser.timeout,
      });
    }
    await this.handleOAuthRedirect();
    await humanDelay(1500, 2500);
    await this.handleTermsModal();
    await this.waitForOverlaysGone();
  }

  // Strategi 1: scan ?ref= di link/anchor/data-clipboard
  console.log('  Scanning for ?ref= links...');
  let refCode = await this.page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a, [data-href], [data-clipboard-text]'));
    for (const a of anchors) {
      const href = a.href || a.getAttribute('data-href') || a.getAttribute('data-clipboard-text') || '';
      const m = href.match(/[?&]ref=([A-Z0-9]{6})\b/i);
      if (m) return m[1].toUpperCase();
    }
    const inputs = Array.from(document.querySelectorAll('input[readonly], textarea[readonly]'));
    for (const inp of inputs) {
      const v = inp.value || '';
      const m = v.match(/[?&]ref=([A-Z0-9]{6})\b/i);
      if (m) return m[1].toUpperCase();
    }
    return null;
  });
  if (isValidRefCode(refCode)) return refCode;
  if (refCode) console.log(`  ! Strategi 1 hasil "${refCode}" ditolak (blacklist/invalid)`);
  refCode = null;

  // Strategi 2: regex teks plain — 3 pattern, hasil divalidasi
  console.log('  Scanning page text for ref code patterns...');
  refCode = await this.page.evaluate(() => {
    const text = document.body.innerText;
    // a) URL share di plain text: "...?ref=XXXXXX"
    const m1 = text.match(/[?&]ref=([A-Z0-9]{6})\b/i);
    if (m1) return m1[1].toUpperCase();
    // b) "Invite code\nXXX" (modal Xiaomi nampilin label terus code di bawah,
    //    tanpa colon. Pakai [\s:\n]+ supaya match newline juga)
    const m2 = text.match(/(?:invite\s+code|referral\s+code|your\s+code)[\s:\n]+([A-Z0-9]{6})\b/i);
    if (m2) return m2[1].toUpperCase();
    // c) "Code: XXX" generic dengan colon
    const m3 = text.match(/\bcode\s*:\s*([A-Z0-9]{6})\b/i);
    if (m3) return m3[1].toUpperCase();
    return null;
  });
  if (isValidRefCode(refCode)) return refCode;
  if (refCode) console.log(`  ! Strategi 2 hasil "${refCode}" ditolak (blacklist/invalid)`);
  refCode = null;

  // Strategi 3: klik Refer & earn / Invite → modal → scan + clipboard
  console.log('  Trying to click Refer & earn / Invite button...');
  const opened = await this.page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const target = all.find(el => {
      const txt = (el.textContent || '').trim();
      return /^(Refer\s*&\s*earn|Refer\s*and\s*earn|Invite( friends)?|Share|Refer( friends)?)$/i.test(txt) && el.offsetHeight > 0;
    });
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    }
    return false;
  });

  if (opened) {
    console.log('  ✓ Clicked Refer & earn / Invite button, waiting for modal...');
    // Tunggu modal Refer & Earn beneran muncul (cari teks "Invite code" /
    // "Invite builders" di salah satu modal yg visible)
    await this.page.waitForFunction(() => {
      const modals = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-wrap, [role="dialog"]'));
      return modals.some(m => {
        if (m.offsetHeight === 0 || m.style.display === 'none') return false;
        const t = (m.innerText || '').toLowerCase();
        return t.includes('invite code') || t.includes('invite builder') || t.includes('refer & earn');
      });
    }, { timeout: 8000 }).catch(() => {});
    await humanDelay(800, 1400);

    // Clear clipboard biar gak baca residue dari step sebelumnya
    try {
      await this.page.evaluate(async () => {
        try { await navigator.clipboard.writeText(''); } catch (e) {}
      });
    } catch (e) {}

    // Re-scan modal — coba beberapa kali kalau pertama belum ke-render
    for (let attempt = 1; attempt <= 3 && !refCode; attempt++) {
      const candidate = await this.page.evaluate(() => {
        const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-wrap, [role="dialog"]'))
          .find(m => m.offsetHeight > 0 && (m.style.display !== 'none'));
        const scope = modal || document.body;

        // 1. Link share di anchor / data-clipboard / readonly input / value
        const els = Array.from(scope.querySelectorAll('a, [data-clipboard-text], [data-href], input, textarea, span, div'));
        for (const el of els) {
          const sources = [
            el.href, el.value, el.getAttribute('data-clipboard-text'),
            el.getAttribute('data-href'), el.getAttribute('data-link'),
            el.textContent,
          ];
          for (const s of sources) {
            if (!s) continue;
            const m = s.match(/[?&]ref=([A-Z0-9]{6})\b/i);
            if (m) return m[1].toUpperCase();
          }
        }
        // 2. Plain text di modal — coba 4 pattern (modal Xiaomi nampilin code
        //    sebagai standalone text dengan label "Invite code" di atasnya)
        const text = scope.innerText || '';
        // a) URL ?ref=XXX (paling reliable)
        const m1 = text.match(/[?&]ref=([A-Z0-9]{6})\b/i);
        if (m1) return m1[1].toUpperCase();
        // b) "Invite code" label + code di baris berikut (format modal aktual)
        const m2 = text.match(/(?:invite\s+code|referral\s+code|your\s+code)[\s:\n]+([A-Z0-9]{6})\b/i);
        if (m2) return m2[1].toUpperCase();
        // c) "Code: XXX" generic dengan colon
        const m3 = text.match(/\bcode\s*:\s*([A-Z0-9]{6})\b/i);
        if (m3) return m3[1].toUpperCase();
        return null;
      });
      if (isValidRefCode(candidate)) {
        refCode = candidate;
        break;
      }
      if (candidate) {
        console.log(`  ! Modal attempt ${attempt} hasil "${candidate}" ditolak (blacklist)`);
      }
      if (attempt < 3) {
        console.log(`  Modal scan attempt ${attempt} empty, retry in 1.5s...`);
        await humanDelay(1200, 1800);
      }
    }

    if (!refCode) {
      console.log('  ! Ref code not in modal text, trying Copy button + clipboard...');
      try {
        const ctx = this.page.context();
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

        // Strategi 3a: baca attribute langsung dari button Copy di modal
        //              REFER & EARN (bukan modal lain). Filter modal scope dulu
        //              dengan teks "Invite code" / "Invite builder".
        const copyBtnText = await this.page.evaluate(() => {
          const modals = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, [role="dialog"]'))
            .filter(m => m.offsetHeight > 0);
          // Cari modal yg teksnya mengandung "Invite code" / "Invite builder"
          const referModal = modals.find(m => {
            const t = (m.innerText || '').toLowerCase();
            return t.includes('invite code') || t.includes('invite builder') || t.includes('refer & earn');
          }) || modals[modals.length - 1]; // fallback ke modal terakhir
          if (!referModal) return null;

          const btns = Array.from(referModal.querySelectorAll('button, a, [role="button"], [data-clipboard-text]'));
          const copy = btns.find(b => /^(copy|copy link|salin)/i.test((b.textContent || '').trim()));
          if (!copy) return null;
          return {
            clipText: copy.getAttribute('data-clipboard-text'),
            link: copy.getAttribute('data-link') || copy.getAttribute('data-href'),
            value: copy.value,
          };
        });

        if (copyBtnText) {
          console.log(`  Copy button attrs: ${JSON.stringify(copyBtnText)}`);
          for (const v of Object.values(copyBtnText)) {
            if (!v) continue;
            const s = String(v);
            // a) URL share dengan ?ref=XXX
            const m = s.match(/[?&]ref=([A-Z0-9]{6})\b/i);
            if (m && isValidRefCode(m[1])) { refCode = m[1].toUpperCase(); break; }
            // b) Bare code (TQB65X / P9LHUK)
            const trimmed = s.trim().toUpperCase();
            if (isValidRefCode(trimmed)) { refCode = trimmed; break; }
          }
        }

        // Strategi 3b: kalau attribute kosong, klik Copy + bringToFront + readText
        if (!refCode) {
          await this.page.bringToFront().catch(() => {});
          await this.page.evaluate(() => {
            const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-wrap, [role="dialog"]'))
              .find(m => m.offsetHeight > 0);
            if (!modal) return false;
            const btns = Array.from(modal.querySelectorAll('button, a, [role="button"]'));
            const copy = btns.find(b => /^(copy|copy link|salin)/i.test((b.textContent || '').trim()));
            if (copy) { copy.click(); return true; }
            return false;
          });
          await humanDelay(900, 1400);

          const clipboardText = await this.page.evaluate(async () => {
            // Pastikan window punya focus dulu
            try { window.focus(); } catch (e) {}
            try {
              return await navigator.clipboard.readText();
            } catch (e) {
              return '';
            }
          });
          if (clipboardText) {
            console.log(`  Clipboard: ${clipboardText.substring(0, 100)}`);
            // Coba ekstrak ref code dari clipboard:
            //  a) URL share dengan ?ref=XXX
            //  b) Bare code (TQB65X / P9LHUK / dst) — modal Xiaomi cuma copy code
            const m1 = clipboardText.match(/[?&]ref=([A-Z0-9]{6})\b/i);
            if (m1 && isValidRefCode(m1[1])) {
              refCode = m1[1].toUpperCase();
            } else {
              // Bare code: trim, uppercase, validasi
              const trimmed = clipboardText.trim().toUpperCase();
              if (isValidRefCode(trimmed)) {
                refCode = trimmed;
              } else {
                // Cari token alphanumeric 4-12 char di mana pun di clipboard
                const m2 = clipboardText.match(/\b([A-Z0-9]{6})\b/i);
                if (m2 && isValidRefCode(m2[1])) refCode = m2[1].toUpperCase();
              }
            }
          } else {
            console.log('  ! Clipboard empty (page may have lost focus)');
          }
        }
      } catch (clipErr) {
        console.log(`  ! Clipboard read error: ${clipErr.message}`);
      }
    }

    // Kalau masih null, dump screenshot + html modal untuk debug
    if (!refCode) {
      console.log('  ! All strategies failed — dumping debug artifacts');
      try {
        const ts = Date.now();
        await this.page.screenshot({
          path: `error-refcode-${ts}.png`,
          fullPage: false,
        });
        const modalHtml = await this.page.evaluate(() => {
          const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, [role="dialog"]'))
            .find(m => m.offsetHeight > 0);
          return modal ? modal.outerHTML.substring(0, 2000) : 'NO_MODAL';
        });
        console.log(`  Modal HTML (preview): ${modalHtml.substring(0, 500)}`);
      } catch (e) {}
    }

    await this.page.keyboard.press('Escape').catch(() => {});
  }

  return refCode;
};
