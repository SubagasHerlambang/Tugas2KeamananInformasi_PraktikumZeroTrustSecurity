'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { startStack } = require('../helpers/harness');

let s;
test.before(async () => { s = await startStack(); });
test.after(async () => { await s.stop(); });

const loginReq = (username, password, device) => s.api('POST', '/auth/login', { body: { username, password }, device });
const pw = () => s.config.seedPassword;

test('TC-AUTH-01 login valid: access token 10m (600s), refresh 1d (86400s), claim sub+role', async () => {
  for (const u of ['mhs.001', 'dosen.andi', 'admin.demo']) {
    const r = await loginReq(u, pw(), s.DEVICES[u]);
    assert.equal(r.status, 200, u);
    assert.equal(r.body.token_type, 'Bearer');
    assert.equal(r.body.expires_in, 600);
    assert.equal(r.body.refresh_expires_in, 86400);
    const c = jwt.decode(r.body.access_token);
    assert.equal(c.exp - c.iat, 600);
    assert.ok(c.sub && c.role);
    assert.equal(c.role, r.body.user.role);
    assert.equal(r.body.user.sub, c.sub);
  }
  const m = await loginReq('mhs.001', pw(), 'DEV-MHS-001');
  assert.equal(m.body.user.nim, '247006110001');
});

test('AC-05 refresh token tersimpan sebagai HASH (bukan mentah), expiry tepat 1 hari dari waktu clock', async () => {
  const r = await loginReq('mhs.002', pw(), 'DEV-MHS-002');
  const raw = r.body.refresh_token;
  const row = s.db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(crypto.createHash('sha256').update(raw).digest('hex'));
  assert.ok(row, 'hash refresh token harus ada di DB');
  assert.equal(row.revoked_at, null);
  assert.equal(new Date(row.expires_at) - new Date(row.created_at), 86400 * 1000);
  const all = JSON.stringify(s.db.prepare('SELECT * FROM refresh_tokens').all());
  assert.ok(!all.includes(raw), 'token mentah tidak boleh ada di DB');
});

test('TC-AUTH-02 password salah dan user tak dikenal: 401 generik, identik, tanpa token', async () => {
  const wrongPw = await loginReq('mhs.001', 'salah-total', 'DEV-MHS-001');
  const unknown = await loginReq('tidak.ada', 'apa-saja', 'DEV-MHS-001');
  for (const r of [wrongPw, unknown]) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(r.body.access_token, undefined);
  }
  assert.equal(wrongPw.body.error.message, unknown.body.error.message);
  const a = s.audit("reason_code = 'INVALID_CREDENTIALS'");
  assert.ok(a.length >= 2 && a.every((x) => x.result === 'deny' && x.subject_type === 'anonymous'));
});

test('TC-AUTH-03 device tidak terdaftar: login ditolak 403 DEVICE_NOT_REGISTERED, tanpa token', async () => {
  const r = await loginReq('mhs.001', pw(), 'DEV-UNKNOWN');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'DEVICE_NOT_REGISTERED');
  assert.equal(r.body.access_token, undefined);
  const noHeader = await loginReq('mhs.001', pw(), undefined);
  assert.equal(noHeader.status, 403);
});

test('TC-AUTH-04 device milik user lain ditolak saat login', async () => {
  const r = await loginReq('mhs.001', pw(), 'DEV-MHS-002');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'DEVICE_NOT_REGISTERED');
  const row = s.lastAudit();
  assert.equal(row.reason_code, 'DEVICE_NOT_REGISTERED');
  assert.equal(row.subject_sub, 'USR-MHS-001');
  assert.equal(row.device_id, 'DEV-MHS-002');
});

test('login: akun nonaktif dan device nonaktif ditolak', async () => {
  s.db.prepare("UPDATE users SET is_active = 0 WHERE username = 'mhs.003'").run();
  assert.equal((await loginReq('mhs.003', pw(), 'DEV-MHS-003')).status, 401);
  s.db.prepare("UPDATE users SET is_active = 1 WHERE username = 'mhs.003'").run();
  s.db.prepare("UPDATE devices SET is_active = 0 WHERE device_id = 'DEV-MHS-003'").run();
  assert.equal((await loginReq('mhs.003', pw(), 'DEV-MHS-003')).status, 403);
  s.db.prepare("UPDATE devices SET is_active = 1 WHERE device_id = 'DEV-MHS-003'").run();
  assert.equal((await loginReq('mhs.003', pw(), 'DEV-MHS-003')).status, 200);
});

test('login: body tidak valid -> 400 VALIDATION_ERROR (tipe salah, field kosong, JSON rusak, field ekstra)', async () => {
  for (const body of [{}, { username: 'a' }, { username: 1, password: 2 }, { username: 'a', password: 'b', role: 'admin' }, { username: { $ne: 1 }, password: 'x' }]) {
    const r = await s.api('POST', '/auth/login', { body, device: 'DEV-MHS-001' });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  }
  const broken = await s.api('POST', '/auth/login', { rawBody: '{"username": ', device: 'DEV-MHS-001' });
  assert.equal(broken.status, 400);
  assert.ok(!broken.text.includes('SyntaxError') && !broken.text.includes('at '), 'tidak boleh membocorkan stack');
});

test('TC-AUTH-05 request bisnis: tanpa token 401 AUTH_REQUIRED; token rusak/expired/tanda tangan salah 401', async () => {
  const none = await s.api('GET', '/nilai', { device: 'DEV-MHS-001' });
  assert.equal(none.status, 401); assert.equal(none.body.error.code, 'AUTH_REQUIRED');
  const garbage = await s.api('GET', '/nilai', { token: 'bukan.jwt.valid', device: 'DEV-MHS-001' });
  assert.equal(garbage.status, 401); assert.equal(garbage.body.error.code, 'INVALID_TOKEN');
  const u = s.db.prepare("SELECT id FROM users WHERE username='mhs.001'").get().id;
  const expired = s.signRaw({ sub: u, role: 'mahasiswa' }, { expiresIn: -5 });
  const e = await s.api('GET', '/nilai', { token: expired, device: 'DEV-MHS-001' });
  assert.equal(e.status, 401); assert.equal(e.body.error.code, 'TOKEN_EXPIRED');
  const forged = s.signRaw({ sub: u, role: 'admin' }, { secret: 'secret-penyerang-0123456789-abcdefghijklmnop', expiresIn: 600 });
  assert.equal((await s.api('GET', '/nilai', { token: forged, device: 'DEV-MHS-001' })).status, 401);
  const noRole = s.signRaw({ sub: u }, { expiresIn: 600 });
  assert.equal((await s.api('GET', '/nilai', { token: noRole, device: 'DEV-MHS-001' })).status, 401);
  const rows = s.audit("reason_code IN ('AUTH_REQUIRED','INVALID_TOKEN','TOKEN_EXPIRED','INVALID_TOKEN_CLAIMS')");
  assert.ok(rows.length >= 5 && rows.every((r) => r.result === 'deny' && r.subject_sub === 'unknown'));
});

test('AC-07 device: tanpa header / device milik user lain / device tak dikenal -> 403 sebelum resource diproses', async () => {
  const a = await s.login('mhs.001');
  for (const device of [undefined, 'DEV-MHS-002', 'DEV-UNKNOWN', 'DEV-DOSEN-001', "bad id;'"]) {
    const r = await s.api('GET', '/nilai', { token: a.token, device });
    assert.equal(r.status, 403, String(device));
    assert.equal(r.body.error.code, 'DEVICE_NOT_REGISTERED');
  }
  assert.equal((await s.api('GET', '/nilai', { token: a.token, device: 'DEV-MHS-001' })).status, 200);
});

test('refresh: sukses menerbitkan access token baru, rotasi mencabut token lama, expiry mutlak tidak diperpanjang', async () => {
  const a = await s.login('dosen.andi');
  const r = await s.api('POST', '/auth/refresh', { body: { refresh_token: a.refresh }, device: a.device });
  assert.equal(r.status, 200);
  assert.equal(r.body.expires_in, 600);
  assert.notEqual(r.body.refresh_token, a.refresh);
  assert.ok(r.body.refresh_expires_in <= 86400);
  assert.equal((await s.api('GET', '/nilai', { token: r.body.access_token, device: a.device })).status, 200);
  const reuse = await s.api('POST', '/auth/refresh', { body: { refresh_token: a.refresh } });
  assert.equal(reuse.status, 401);
  assert.equal(s.lastAudit().reason_code, 'REFRESH_TOKEN_REVOKED');
  const again = await s.api('POST', '/auth/refresh', { body: { refresh_token: r.body.refresh_token } });
  assert.equal(again.status, 200);
});

test('TC-AUTH-06 logout mencabut refresh token di DB; refresh sesudah logout ditolak; logout idempoten', async () => {
  const a = await s.login('mhs.002');
  const out = await s.api('POST', '/auth/logout', { body: { refresh_token: a.refresh } });
  assert.equal(out.status, 204);
  const row = s.db.prepare('SELECT revoked_at FROM refresh_tokens WHERE token_hash = ?').get(crypto.createHash('sha256').update(a.refresh).digest('hex'));
  assert.ok(row.revoked_at, 'revoked_at harus terisi');
  const r = await s.api('POST', '/auth/refresh', { body: { refresh_token: a.refresh } });
  assert.equal(r.status, 401);
  assert.equal((await s.api('POST', '/auth/logout', { body: { refresh_token: a.refresh } })).status, 204);
  assert.equal((await s.api('POST', '/auth/logout', { body: { refresh_token: 'x'.repeat(64) } })).status, 204);
});

test('refresh kedaluwarsa (clock +1 hari) ditolak TOKEN_EXPIRED; refresh tidak dikenal / body salah ditolak', async () => {
  const a = await s.login('mhs.003');
  assert.equal((await s.api('POST', '/auth/refresh', { body: { refresh_token: 'z'.repeat(64) } })).status, 401);
  assert.equal((await s.api('POST', '/auth/refresh', { body: {} })).status, 400);
  s.clock.advance(86400 * 1000 + 1000);
  const r = await s.api('POST', '/auth/refresh', { body: { refresh_token: a.refresh } });
  assert.equal(r.status, 401); assert.equal(r.body.error.code, 'TOKEN_EXPIRED');
  s.clock.advance(-(86400 * 1000 + 1000));
});

test('refresh: X-Device-ID yang tidak cocok dengan sesi ditolak 403', async () => {
  const a = await s.login('mhs.001');
  const r = await s.api('POST', '/auth/refresh', { body: { refresh_token: a.refresh }, device: 'DEV-MHS-002' });
  assert.equal(r.status, 403);
});

test('TC-SVC-01 token service: role=service, exp 5 menit (300s)', async () => {
  const r = await s.api('POST', '/auth/service', { body: { client_id: s.config.serviceClient.id, client_secret: s.config.serviceClient.secret } });
  assert.equal(r.status, 200);
  assert.equal(r.body.expires_in, 300);
  const c = jwt.decode(r.body.access_token);
  assert.equal(c.role, 'service'); assert.equal(c.sub, 'service-nilai'); assert.equal(c.exp - c.iat, 300);
  assert.equal(s.lastAudit().subject_type, 'service');
});

test('TC-SVC-02 token service: secret salah / client salah / body salah -> tidak ada token', async () => {
  for (const body of [{ client_id: 'service-nilai', client_secret: 'salah' }, { client_id: 'service-x', client_secret: s.config.serviceClient.secret }]) {
    const r = await s.api('POST', '/auth/service', { body });
    assert.equal(r.status, 401); assert.equal(r.body.access_token, undefined);
  }
  assert.equal((await s.api('POST', '/auth/service', { body: { client_id: 'service-nilai' } })).status, 400);
  s.db.prepare("UPDATE service_clients SET is_active=0 WHERE client_id='service-nilai'").run();
  assert.equal((await s.api('POST', '/auth/service', { body: { client_id: s.config.serviceClient.id, client_secret: s.config.serviceClient.secret } })).status, 401);
  s.db.prepare("UPDATE service_clients SET is_active=1 WHERE client_id='service-nilai'").run();
});

test('user login tidak dapat memakai /auth/service dan sebaliknya (kredensial terpisah)', async () => {
  const r = await s.api('POST', '/auth/service', { body: { client_id: 'mhs.001', client_secret: pw() } });
  assert.equal(r.status, 401);
});
