#!/usr/bin/env node
/**
 * Chain loop: register → redeem invite → ambil ref code → create API key →
 * fill Ultraspeed form. Tiap iterasi kode invite-nya pake ref code akun
 * sebelumnya (chained). Iterasi pertama pake --seed atau config.xiaomi.inviteCode.
 *
 * Cara pakai:
 *   node chain-loop.js --count 5
 *   node chain-loop.js --count 3 --seed HWPMXZ
 *   node chain-loop.js --count 10 --output chain.txt
 *
 * Output (chain.txt) format:
 *   email:password:refCode:apiKey:invitedBy
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

// Output dir bisa di-override via env var (dipake oleh wrapper bot-mimo
// supaya output file masuk ke folder bot-mimo, bukan parent).
const outputDir = process.env.HERMES_BOT_MIMO_CWD || __dirname;

// Config path juga bisa di-override
const configPath = process.env.HERMES_BOT_MIMO_CONFIG || join(__dirname, 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// ---- CLI args ---------------------------------------------------------

const args = process.argv.slice(2);

const countIdx = args.indexOf('--count');
const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 1;

const seedIdx = args.indexOf('--seed');
const seedRef = seedIdx !== -1 ? args[seedIdx + 1] : config.xiaomi.inviteCode;

const outputIdx = args.indexOf('--output');
const outputFile = outputIdx !== -1
  ? join(outputDir, args[outputIdx + 1])
  : join(outputDir, 'chain-result.txt');

const failLog = join(outputDir, 'chain-fail.log');

// ---- File helpers -----------------------------------------------------

function saveResult(row) {
  if (!existsSync(outputFile)) {
    appendFileSync(
      outputFile,
      '# Chain loop results. Format: email:password:refCode:apiKey:invitedBy\n',
      'utf8'
    );
  }
  const line = [
    row.email,
    row.password,
    row.refCode || '',
    row.apiKey || '',
    row.invitedBy || '',
  ].join(':') + '\n';
  appendFileSync(outputFile, line, 'utf8');
}

function logFail(email, error) {
  const line = `[${new Date().toISOString()}] ${email || 'unknown'}  | ${error}\n`;
  appendFileSync(failLog, line, 'utf8');
}

export { config, saveResult, logFail, count, seedRef, outputFile, failLog, __dirname };
