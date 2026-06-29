# MiMo Chain Bot

Bot otomatis untuk Xiaomi MiMo Open Platform (`platform.xiaomimimo.com`).
Chain-loop: register akun → redeem invite code → create API key → apply
Ultraspeed beta → ambil ref code → ulangi dengan ref code akun sebelumnya.

## Install

```bash
npm install
npx playwright install chrome
```

## Configuration

Edit `config.json`:

```json
{
  "tempmail": {
    "apiUrl": "https://tempmail.adrnode.com/api"
  },
  "captcha": {
    "provider": "2captcha",
    "apiKey": "YOUR_2CAPTCHA_API_KEY"
  },
  "xiaomi": {
    "referralLink": "https://platform.xiaomimimo.com/?ref=XXXXXX",
    "inviteCode": "XXXXXX",
    "password": "MimoAuto2024!",
    "betaApplication": "MiMo-V2.5-Pro-UltraSpeed"
  },
  "browser": {
    "headless": false,
    "timeout": 60000,
    "screenshots": false
  }
}
```

Yang **wajib** diisi:
- `captcha.apiKey` — API key dari [2captcha.com](https://2captcha.com), butuh balance
- `xiaomi.inviteCode` — kode referral untuk seed iterasi pertama (6 karakter)
- `xiaomi.referralLink` — URL referral, format `?ref=XXXXXX` (sama dengan inviteCode)

Yang opsional:
- `xiaomi.password` — password untuk semua akun baru (default OK)
- `browser.headless` — `true` tanpa UI, `false` (default) buat lihat browser

## Run

```bash
node chain-loop.js --count 5
```

| Flag | Default | Keterangan |
|---|---|---|
| `--count N` | 1 | jumlah akun yang dibuat |
| `--seed XXXXXX` | `config.xiaomi.inviteCode` | invite code untuk akun pertama |
| `--output file.txt` | `chain-result.txt` | file output |

```bash
# 5 akun, seed dari config
node chain-loop.js --count 5

# 10 akun, seed manual
node chain-loop.js --count 10 --seed P9LHUK

# Output ke file lain
node chain-loop.js --count 3 --output batch1.txt
```

## Per-akun flow

```
[1]  Bikin temp email
[2]  Launch browser dengan random fingerprint (UA, viewport, locale, GPU, dst)
[3]  Buka referral link (?ref=<currentSeed>)
[4]  Sign up form (email + password + confirm + terms checkbox)
[5]  Solve captcha (reCAPTCHA via 2Captcha + image captcha)
[6]  Verify email (kode 6 digit dari tempmail)
[7]  Klik Console → Balance → "Enter invite code" → isi 6-box → Redeem
     → cek restriction (kalau kena, STOP)
     → reload halaman, verify balance bertambah ~$2
[8]  Create API key (atau ambil existing kalau sudah ada)
[9]  Fill Ultraspeed beta application form
[10] Klik "Refer & earn" → ambil ref code akun ini → seed untuk akun berikut
```

## Output

```bash
# chain-result.txt (auto-create, append)
# Format: email:password:refCode:apiKey:invitedBy
foo@adrnode.com:MimoAuto2024!:K3M2P8:sk-aaa...bbb:T9K59J
bar@adrnode.com:MimoAuto2024!:LX8N2A:sk-ccc...ddd:K3M2P8
baz@adrnode.com:MimoAuto2024!:Q9R3FZ:sk-eee...fff:LX8N2A
```

Tiap baris dichain — `invitedBy` baris N+1 = `refCode` baris N.

## Features

**Random fingerprint per akun** — User-Agent, viewport, locale, timezone, hardwareConcurrency,
deviceMemory, WebGL vendor/renderer, canvas noise seed, navigator.plugins. Sehingga Xiaomi
tidak mengenali fingerprint yang sama antar akun.

**Human-like typing** — Form signup, captcha code, email verification code, dan OTP
redeem diketik per-karakter dengan delay acak 60-180ms + thinking pause.
Form Ultraspeed pakai `.fill()` langsung (mode cepat, cukup untuk form internal).

**Idempotent** — Akun yang sudah redeem invite code / sudah punya API key
akan di-skip otomatis, aman untuk re-run.

**Verifikasi balance** — Setelah redeem invite code, halaman di-reload dan balance
dibaca ulang. Harus bertambah ~$2.00. Kalau tidak, iterasi dianggap gagal.

**Restriction detection** — Kalau setelah redeem muncul notif "risk control restrictions",
loop berhenti total (akun kena cap, gak bisa lanjut).

## Stop conditions

Loop berhenti kalau:

| Condition | Action |
|---|---|
| Akun restricted (risk control) | STOP, gak retry |
| Balance tidak bertambah ~$2 | STOP, gak retry |
| Ref code tidak tertangkap | STOP, mencegah duplikasi seed |
| Ref code = seed lama (clipboard leak) | STOP |
| Iter total fail (captcha timeout, dll) | Retry pakai seed yang sama |

## Fingerprint

Tiap akun randomize:

- **User-Agent**: Chrome 122-131 di Windows NT 10.0
- **Viewport**: 8 ukuran (1280x720 → 1920x1080)
- **Locale**: en-US, en-GB, id-ID, en-AU, en-CA, en-SG
- **Timezone**: Jakarta, Singapore, Bangkok, KL, Manila, Ho_Chi_Minh
- **Hardware**: 4-16 cores, 4-16 GB memory
- **WebGL**: pasangan vendor + renderer NVIDIA/Intel/AMD realistis
- **Canvas**: seed unik, noise 1 pixel pada toDataURL & getImageData
- **navigator.webdriver** di-undefine, plugins palsu

## Troubleshooting

**Captcha solve lama (>2 menit)**
- 2Captcha workers sibuk, coba lagi nanti. Balance 2Captcha cek di dashboard.

**"Account restricted" muncul**
- IP mungkin sudah ke-flag Xiaomi. Coba jeda beberapa jam atau pakai VPN.
- Screenshot `error-restriction-*.png` ke-dump otomatis untuk referensi.

**Balance tidak bertambah**
- Screenshot `error-balance-*.png` ke-dump otomatis.
- Kemungkinan saldo ter-delay (Xiaomi bilang "Balance updates in near-real time, ≤5 min delay").
- Atau invite code expired / invalid.

**Ref code tidak tertangkap**
- Screenshot `error-refcode-*.png` dan `chain-refcode-leak-*.png` ke-dump otomatis.
- Cek format modal "Refer & Earn" di Xiaomi — kalau label berubah, pattern di `extras.js`
  perlu ditambah.

**Browser zombie (chrome.exe nyangkut)**
- Ctrl+C di terminal akan auto-close browser (SIGINT handler aktif).
- Kalau masih ada: `taskkill //IM chrome.exe //F` (hati-hati: juga tutup chrome pribadi).

## Estimasi durasi

| Akun | Estimasi |
|---|---|
| 1 | 2-4 menit |
| 5 | 10-20 menit |
| 10 | 20-40 menit |
| 50 | 2-3 jam |

Bottleneck utama: solving captcha (60-120s per akun via 2Captcha).

## Files

```
├── chain-loop.js         entry point (node chain-loop.js)
├── chain-loop-config.js  CLI args + save/log helpers
├── index.js              MimoRegistration core class
├── extras.js             getReferralCode method
├── fingerprint.js        random browser fingerprint
├── human.js              human-like typing helpers
├── package.json
├── config.json           ← edit ini
└── README.md
```

Runtime output (gak masuk git):
- `chain-result.txt` — akun sukses
- `chain-fail.log` — error log
- `*.png` — screenshot debug

## License

MIT
