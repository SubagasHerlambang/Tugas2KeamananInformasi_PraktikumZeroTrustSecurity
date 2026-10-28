'use strict';
// Kode error standar (PRD 11.4). Satu-satunya tempat definisi status HTTP <-> code.
class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code kode publik yang dikirim ke client
   * @param {string} message pesan aman (tanpa rahasia / detail internal)
   * @param {{reasonCode?: string, details?: any, subject?: object}} [opts] reasonCode dipakai audit log
   */
  constructor(status, code, message, opts = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.reasonCode = opts.reasonCode || code;
    this.details = opts.details;
    this.subject = opts.subject; // {sub, type} untuk audit
  }
}

const E = {
  validation: (message = 'Input tidak valid.', details, reasonCode = 'VALIDATION_ERROR') =>
    new AppError(400, 'VALIDATION_ERROR', message, { details, reasonCode }),
  authRequired: () => new AppError(401, 'AUTH_REQUIRED', 'Autentikasi diperlukan.'),
  invalidToken: (reasonCode = 'INVALID_TOKEN') => new AppError(401, 'INVALID_TOKEN', 'Token tidak valid.', { reasonCode }),
  tokenExpired: (reasonCode = 'TOKEN_EXPIRED') => new AppError(401, 'TOKEN_EXPIRED', 'Token sudah kedaluwarsa.', { reasonCode }),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Kredensial tidak valid.'),
  forbidden: (reasonCode = 'FORBIDDEN', message = 'Anda tidak berhak melakukan tindakan ini.') =>
    new AppError(403, 'FORBIDDEN', message, { reasonCode }),
  deviceNotRegistered: () => new AppError(403, 'DEVICE_NOT_REGISTERED', 'Perangkat tidak terdaftar untuk akun ini.'),
  classNotOwned: () => new AppError(403, 'CLASS_NOT_OWNED', 'Kelas ini bukan kelas yang Anda ampu.'),
  serviceTokenRequired: () => new AppError(403, 'SERVICE_TOKEN_REQUIRED', 'Endpoint ini hanya menerima token service.'),
  outOfAccessHours: () => new AppError(403, 'OUT_OF_ACCESS_HOURS', 'Di luar jam akses perubahan/finalisasi nilai.'),
  notFound: (reasonCode = 'RESOURCE_NOT_FOUND', message = 'Sumber daya tidak ditemukan.') =>
    new AppError(404, 'RESOURCE_NOT_FOUND', message, { reasonCode }),
  gradeFinal: () => new AppError(409, 'GRADE_FINAL', 'Nilai sudah final dan tidak dapat diubah.'),
  conflict: (reasonCode = 'DUPLICATE_OR_CONFLICT', message = 'Terjadi konflik status data.') =>
    new AppError(409, 'DUPLICATE_OR_CONFLICT', message, { reasonCode }),
  business: (reasonCode, message) => new AppError(422, 'BUSINESS_RULE_VIOLATION', message, { reasonCode }),
  tooManyRequests: () => new AppError(429, 'TOO_MANY_REQUESTS', 'Terlalu banyak percobaan. Coba lagi nanti.', { reasonCode: 'RATE_LIMITED' }),
  upstream: (message = 'Layanan hulu gagal merespons.', details) =>
    new AppError(502, 'UPSTREAM_SERVICE_FAILURE', message, { details }),
  internal: () => new AppError(500, 'INTERNAL_ERROR', 'Terjadi kesalahan internal.'),
};

function toErrorBody(err, requestId) {
  const body = { error: { code: err.code, message: err.message, request_id: requestId } };
  if (err.details !== undefined) body.error.details = err.details;
  return body;
}

module.exports = { AppError, E, toErrorBody };
