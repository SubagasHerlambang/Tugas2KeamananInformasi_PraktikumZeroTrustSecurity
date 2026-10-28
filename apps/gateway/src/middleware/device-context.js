'use strict';
const { E, deviceIdHeader } = require('../../../../packages/shared');

/** Normalisasi untuk audit: hanya karakter aman dan panjang dibatasi. */
function sanitizeDeviceId(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.slice(0, 64).replace(/[^A-Za-z0-9._-]/g, '?');
}

/**
 * Device harus: dikirim, berformat valid, dikenal, aktif, dan TERIKAT pada pengguna dari token.
 * Semua kegagalan -> 403 DEVICE_NOT_REGISTERED (tidak membedakan 'tidak ada' vs 'milik user lain').
 */
function verifyDevice(rawHeader, userId, data) {
  if (!deviceIdHeader.safeParse(rawHeader).success) throw E.deviceNotRegistered();
  const device = data.getDevice(rawHeader);
  if (!device || !device.is_active || device.user_id !== userId) throw E.deviceNotRegistered();
  return device;
}

module.exports = { sanitizeDeviceId, verifyDevice };
