'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeEqual, hashToken, generateOpaqueToken, hashPassword, verifyPassword } = require('../../packages/security');
const { createLogger, sanitize } = require('../../packages/shared');
const { sanitizeDeviceId, verifyDevice } = require('../../apps/gateway/src/middleware/device-context');

test('safeEqual: sama/beda/panjang beda/bukan string', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('abc', undefined), false);
  assert.equal(safeEqual(null, null), false);
});
test('refresh token opaque: unik, panjang >= 64 karakter, hash SHA-256 deterministik & tidak sama dengan token', () => {
  const a = generateOpaqueToken(); const b = generateOpaqueToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 64);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
});
test('password: hash bcrypt (bukan plaintext), verifikasi benar/salah', async () => {
  const h = await hashPassword('Rahasia-123', 4);
  assert.notEqual(h, 'Rahasia-123');
  assert.match(h, /^\$2[aby]\$/);
  assert.equal(await verifyPassword('Rahasia-123', h), true);
  assert.equal(await verifyPassword('salah', h), false);
});
test('logger menyamarkan field sensitif (authorization, password, token, secret)', () => {
  const lines = [];
  const log = createLogger('t', 'info', (l) => lines.push(l));
  log.info('x', { authorization: 'Bearer abc', password: 'p', refresh_token: 'r', client_secret: 's', 'x-gateway-secret': 'g', aman: 'ok', nested: { access_token: 'zzz' } });
  const out = lines.join('');
  for (const leaked of ['Bearer abc', '"p"', '"r"', '"s"', '"g"', 'zzz']) assert.ok(!out.includes(leaked), `bocor: ${leaked}`);
  assert.ok(out.includes('"aman":"ok"'));
  assert.equal(sanitize({ cookie: 'c' }).cookie, '[REDACTED]');
});
test('sanitizeDeviceId untuk audit: batasi panjang dan karakter', () => {
  assert.equal(sanitizeDeviceId('DEV-MHS-001'), 'DEV-MHS-001');
  assert.equal(sanitizeDeviceId("DEV';DROP TABLE users;--"), 'DEV??DROP?TABLE?users?--');
  assert.equal(sanitizeDeviceId('x'.repeat(200)).length, 64);
  assert.equal(sanitizeDeviceId(undefined), null);
});
test('device matching: harus dikenal, aktif, dan terikat ke user yang sama', () => {
  const devices = {
    'DEV-A': { id: 1, user_id: 'u1', device_id: 'DEV-A', is_active: 1 },
    'DEV-OFF': { id: 2, user_id: 'u1', device_id: 'DEV-OFF', is_active: 0 },
  };
  const data = { getDevice: (d) => devices[d] };
  assert.equal(verifyDevice('DEV-A', 'u1', data).id, 1);
  for (const [dev, user] of [['DEV-A', 'u2'], ['DEV-OFF', 'u1'], ['DEV-X', 'u1'], [undefined, 'u1'], ['', 'u1'], ['bad id!', 'u1']]) {
    assert.throws(() => verifyDevice(dev, user, data), (e) => e.status === 403 && e.code === 'DEVICE_NOT_REGISTERED');
  }
});
