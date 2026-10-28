'use strict';
const { E, SERVICE_NILAI_SUB } = require('../shared');
const { safeEqual } = require('./secrets');
const { extractBearer } = require('./tokens');

/**
 * Pemeriksaan X-Gateway-Secret di sisi service (PRD FR-AUTH-06/07). WAJIB menjadi middleware pertama,
 * sehingga request langsung ke port service (tanpa/dengan secret salah) ditolak untuk SEMUA path.
 */
function requireGatewaySecret(expectedSecret) {
  return (req, _res, next) => {
    const provided = req.get('x-gateway-secret');
    if (!provided || !safeEqual(provided, expectedSecret)) return next(E.forbidden('GATEWAY_SECRET_INVALID', 'Akses langsung ke service tidak diizinkan.'));
    next();
  };
}

/** Verifikasi ulang tanda tangan + expiry token. Secret gateway yang valid TIDAK menggantikan token valid. */
function authenticate(tokenService) {
  return (req, _res, next) => {
    try { req.auth = tokenService.verify(extractBearer(req)); next(); } catch (e) { next(e); }
  };
}

/** Endpoint untuk pengguna: token service ditolak. */
function requireUserToken(req, _res, next) {
  if (!req.auth || req.auth.kind !== 'user') return next(E.forbidden('SERVICE_TOKEN_NOT_ALLOWED', 'Token service tidak berlaku untuk endpoint ini.'));
  next();
}

/** Endpoint khusus service: token user mana pun (admin/dosen/mahasiswa) ditolak walau valid. */
function requireServiceToken(req, _res, next) {
  if (!req.auth || req.auth.kind !== 'service' || req.auth.claims.sub !== SERVICE_NILAI_SUB) return next(E.serviceTokenRequired());
  next();
}

/** Muat user dari DB (bukan hanya klaim token): harus ada, aktif, dan role di DB sama dengan klaim. */
function loadActiveUser(db) {
  const stmt = db.prepare('SELECT id, username, role, nim, full_name, is_active FROM users WHERE id = ?');
  return (req, _res, next) => {
    const user = stmt.get(req.auth.claims.sub);
    if (!user) return next(E.invalidToken('UNKNOWN_SUBJECT'));
    if (!user.is_active) return next(E.forbidden('ACCOUNT_INACTIVE', 'Akun tidak aktif.'));
    if (user.role !== req.auth.claims.role) return next(E.invalidToken('ROLE_MISMATCH'));
    req.user = user;
    next();
  };
}

function requireRole(...roles) {
  return (req, _res, next) => (req.user && roles.includes(req.user.role) ? next() : next(E.forbidden('ROLE_NOT_ALLOWED')));
}

module.exports = { requireGatewaySecret, authenticate, requireUserToken, requireServiceToken, loadActiveUser, requireRole };
