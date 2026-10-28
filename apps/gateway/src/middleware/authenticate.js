'use strict';
const { E } = require('../../../../packages/shared');
const { extractBearer } = require('../../../../packages/security');

/** Langkah 1 pipeline: verifikasi tanda tangan + expiry token. Melempar AppError 401 bila gagal. */
function authenticateRequest(req, tokenService) {
  return tokenService.verify(extractBearer(req));
}

/** Konteks identitas dari DB: akun harus ada, aktif, dan role di DB sama dengan klaim token. */
function resolveUser(identity, data) {
  const user = data.getUser(identity.claims.sub);
  if (!user) throw E.invalidToken('UNKNOWN_SUBJECT');
  if (!user.is_active) throw E.forbidden('ACCOUNT_INACTIVE', 'Akun tidak aktif.');
  if (user.role !== identity.claims.role) throw E.invalidToken('ROLE_MISMATCH');
  return user;
}

module.exports = { authenticateRequest, resolveUser };
