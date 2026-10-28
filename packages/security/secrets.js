'use strict';
const crypto = require('crypto');

/** Perbandingan waktu-konstan; kedua sisi di-hash dulu agar panjang sama dan tidak bocor lewat panjang. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Refresh token opaque 384-bit; hanya hash SHA-256-nya yang disimpan di DB. */
function generateOpaqueToken() { return crypto.randomBytes(48).toString('base64url'); }
function hashToken(raw) { return crypto.createHash('sha256').update(String(raw)).digest('hex'); }
function randomId(prefix = '') { return prefix + crypto.randomUUID(); }

module.exports = { safeEqual, generateOpaqueToken, hashToken, randomId };
