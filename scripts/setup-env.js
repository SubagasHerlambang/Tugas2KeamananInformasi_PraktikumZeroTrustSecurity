#!/usr/bin/env node
'use strict';
// Membuat .env lokal. Secret SISTEM (JWT_SIGNING_SECRET, GATEWAY_SECRET) selalu acak per instalasi.
// Kredensial DEMO (password akun seed & secret client Service Nilai) memakai nilai tetap yang terdokumentasi di README
// agar demo/penilaian mudah diulang. NILAI DEMO INI HANYA UNTUK LOKAL/PRAKTIKUM - JANGAN dipakai di produksi.
//   node scripts/setup-env.js                 -> .env baru (tidak menimpa .env yang ada)
//   node scripts/setup-env.js --force         -> buat ulang .env
//   node scripts/setup-env.js --random-demo   -> password/secret demo juga diacak (dicetak sekali ke terminal)
//   node scripts/setup-env.js --out <file>    -> tulis ke file lain (untuk pengujian)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out'); // dipakai test; default: <root>/.env
const target = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(root, '.env');
if (fs.existsSync(target) && !args.includes('--force')) {
  console.log('.env sudah ada; tidak ditimpa (gunakan --force untuk membuat ulang).');
  process.exit(0);
}
const rand = (n) => crypto.randomBytes(n).toString('base64url');
const randomDemo = args.includes('--random-demo');
const DEMO_PASSWORD = randomDemo ? `Demo-${rand(6)}` : 'SecureCampus-Demo-2026';
const DEMO_CLIENT_SECRET = randomDemo ? rand(24) : 'service-nilai-demo-secret-local';
const values = {
  JWT_SIGNING_SECRET: rand(48),
  GATEWAY_SECRET: rand(32),
  SERVICE_NILAI_CLIENT_SECRET: DEMO_CLIENT_SECRET,
  SEED_DEMO_PASSWORD: DEMO_PASSWORD,
};
let text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const [k, v] of Object.entries(values)) text = text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
fs.writeFileSync(target, text, { mode: 0o600 });
console.log('.env dibuat. JWT_SIGNING_SECRET & GATEWAY_SECRET = acak lokal (tidak di-commit; .env ada di .gitignore).');
console.log('Kredensial DEMO (LOKAL SAJA, bukan untuk produksi):');
console.log(`  password semua akun seed : ${DEMO_PASSWORD}`);
console.log(`  client Service Nilai     : service-nilai / ${DEMO_CLIENT_SECRET}`);
