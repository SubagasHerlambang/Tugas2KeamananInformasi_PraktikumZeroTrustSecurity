#!/usr/bin/env node
'use strict';
// Dijalankan otomatis sebelum `npm ci` / `npm install` (script "preinstall") agar masalah versi Node
// muncul sebagai pesan yang jelas, bukan log kompilasi native yang panjang.
// better-sqlite3 12.x menyediakan binary prebuilt untuk Node 20-24 (Windows/Linux/macOS x64/arm64).
const MIN_MAJOR = 20;
const MAX_TESTED_MAJOR = 24;

function check(version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(major) || major < MIN_MAJOR) {
    return { ok: false, message: `Node.js ${version} terlalu lama. SecureCampus membutuhkan Node.js ${MIN_MAJOR} atau lebih baru (disarankan LTS 22). Unduh di https://nodejs.org lalu ulangi.` };
  }
  if (major > MAX_TESTED_MAJOR) {
    return { ok: true, message: `Peringatan: Node.js ${version} lebih baru daripada yang dikonfirmasi punya binary prebuilt better-sqlite3 (Node ${MIN_MAJOR}-${MAX_TESTED_MAJOR}). Jika instalasi meminta Visual Studio/kompilator, pakai Node.js 22 LTS.` };
  }
  return { ok: true, message: '' };
}

if (require.main === module) {
  const r = check(process.version);
  if (r.message) (r.ok ? console.warn : console.error)(`[SecureCampus] ${r.message}`);
  process.exit(r.ok ? 0 : 1);
}
module.exports = { check, MIN_MAJOR, MAX_TESTED_MAJOR };
