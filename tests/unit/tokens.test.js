'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createTokenService, extractBearer } = require('../../packages/security');

const cfg = { secret: 'unit-test-secret-0123456789-abcdefghijklmnop', issuer: 'iss', audience: 'aud', accessTtlSec: 600, serviceTtlSec: 300 };
const svc = createTokenService(cfg);
const raw = (payload, opts = {}) => jwt.sign(payload, opts.secret || cfg.secret, { algorithm: 'HS256', issuer: 'iss', audience: 'aud', ...opts.sign });

test('AC-04 access token: claim sub+role, exp tepat 600 detik setelah iat', () => {
  const { token, expiresIn } = svc.signAccess({ sub: 'u1', role: 'mahasiswa' });
  const c = jwt.decode(token);
  assert.equal(expiresIn, 600);
  assert.equal(c.exp - c.iat, 600);
  assert.equal(c.sub, 'u1'); assert.equal(c.role, 'mahasiswa');
  const v = svc.verify(token);
  assert.equal(v.kind, 'user');
});
test('AC-06 token service: role=service, exp tepat 300 detik', () => {
  const { token } = svc.signService({ sub: 'service-nilai' });
  const c = jwt.decode(token);
  assert.equal(c.exp - c.iat, 300);
  assert.equal(c.role, 'service');
  assert.equal(svc.verify(token).kind, 'service');
});
test('signAccess menolak role di luar admin/dosen/mahasiswa (termasuk service)', () => {
  assert.throws(() => svc.signAccess({ sub: 'x', role: 'service' }));
  assert.throws(() => svc.signAccess({ sub: 'x', role: 'root' }));
});
test('verify menolak: kosong, malformed, bukan string', () => {
  for (const bad of ['', 'abc', 'a.b.c', null, undefined, 123, 'x'.repeat(5000)]) {
    assert.throws(() => svc.verify(bad), (e) => e.status === 401 && e.code === 'INVALID_TOKEN');
  }
});
test('verify menolak tanda tangan salah', () => {
  const forged = raw({ sub: 'u1', role: 'admin' }, { secret: 'attacker-secret-0123456789-abcdefghijklmnopqrstu', sign: { expiresIn: 600 } });
  assert.throws(() => svc.verify(forged), (e) => e.code === 'INVALID_TOKEN');
});
test('verify menolak token expired dengan kode TOKEN_EXPIRED', () => {
  const expired = raw({ sub: 'u1', role: 'dosen' }, { sign: { expiresIn: -10 } });
  assert.throws(() => svc.verify(expired), (e) => e.status === 401 && e.code === 'TOKEN_EXPIRED');
});
test('verify menolak alg=none dan algoritma lain', () => {
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'u1', role: 'admin', iss: 'iss', aud: 'aud', iat: 1, exp: 9999999999 })).toString('base64url')}.`;
  assert.throws(() => svc.verify(none), (e) => e.code === 'INVALID_TOKEN');
  const hs512 = jwt.sign({ sub: 'u1', role: 'admin' }, cfg.secret, { algorithm: 'HS512', issuer: 'iss', audience: 'aud', expiresIn: 600 });
  assert.throws(() => svc.verify(hs512), (e) => e.code === 'INVALID_TOKEN');
});
test('verify menolak claim wajib hilang (tanpa sub / tanpa role) dan role tak dikenal', () => {
  assert.throws(() => svc.verify(raw({ role: 'admin' }, { sign: { expiresIn: 600 } })), (e) => e.code === 'INVALID_TOKEN');
  assert.throws(() => svc.verify(raw({ sub: 'u1' }, { sign: { expiresIn: 600 } })), (e) => e.code === 'INVALID_TOKEN');
  assert.throws(() => svc.verify(raw({ sub: 'u1', role: 'superuser' }, { sign: { expiresIn: 600 } })), (e) => e.code === 'INVALID_TOKEN');
});
test('verify menolak issuer/audience salah dan token tanpa exp', () => {
  const wrongIss = jwt.sign({ sub: 'u', role: 'admin' }, cfg.secret, { algorithm: 'HS256', issuer: 'evil', audience: 'aud', expiresIn: 600 });
  const wrongAud = jwt.sign({ sub: 'u', role: 'admin' }, cfg.secret, { algorithm: 'HS256', issuer: 'iss', audience: 'evil', expiresIn: 600 });
  const noExp = jwt.sign({ sub: 'u', role: 'admin' }, cfg.secret, { algorithm: 'HS256', issuer: 'iss', audience: 'aud' });
  for (const t of [wrongIss, wrongAud, noExp]) assert.throws(() => svc.verify(t), (e) => e.status === 401);
});
test('extractBearer: AUTH_REQUIRED bila header tidak ada, INVALID_TOKEN bila format salah', () => {
  const mk = (h) => ({ get: () => h });
  assert.throws(() => extractBearer(mk(undefined)), (e) => e.code === 'AUTH_REQUIRED');
  assert.throws(() => extractBearer(mk('Basic abc')), (e) => e.code === 'INVALID_TOKEN');
  assert.throws(() => extractBearer(mk('Bearer')), (e) => e.code === 'INVALID_TOKEN');
  assert.equal(extractBearer(mk('Bearer abc.def.ghi')), 'abc.def.ghi');
});
test('secret terlalu pendek ditolak saat membuat token service', () => {
  assert.throws(() => createTokenService({ ...cfg, secret: 'short' }));
});
