'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

let s;
test.before(async () => { s = await startStack(); });
test.after(async () => { await s.stop(); });

test('TC-LOG-01 / AC-15 audit allow & deny memuat waktu, subjek, endpoint, device, hasil, alasan (+ request id, method, status, ip)', async () => {
  const m = await s.login('mhs.001');
  await s.api('GET', '/nilai', { token: m.token, device: m.device }); // allow
  const allow = s.lastAudit();
  await s.api('GET', '/transkrip/247006110002', { token: m.token, device: m.device }); // deny
  const deny = s.lastAudit();
  for (const row of [allow, deny]) {
    assert.ok(!Number.isNaN(Date.parse(row.timestamp)));
    assert.equal(row.subject_sub, 'USR-MHS-001'); assert.equal(row.subject_type, 'user');
    assert.ok(row.endpoint.startsWith('/')); assert.equal(row.device_id, 'DEV-MHS-001');
    assert.ok(['allow', 'deny'].includes(row.result)); assert.ok(row.reason_code);
    assert.match(row.request_id, /^req-/); assert.ok(row.method); assert.ok(row.status_code); assert.ok(row.ip);
  }
  assert.equal(allow.result, 'allow'); assert.equal(allow.reason_code, 'POLICY_ALLOW'); assert.equal(allow.status_code, 200);
  assert.equal(deny.result, 'deny'); assert.equal(deny.reason_code, 'NIM_NOT_OWNED'); assert.equal(deny.status_code, 403);
});

test('audit mencatat subjek service, login sukses/gagal, logout, refresh, dan route tak dikenal', async () => {
  await s.serviceToken();
  assert.ok(s.audit("subject_type='service' AND reason_code='SERVICE_TOKEN_ISSUED'").length >= 1);
  const a = await s.login('dosen.andi');
  assert.ok(s.audit("reason_code='LOGIN_SUCCESS' AND subject_sub='USR-DOSEN-01'").length >= 1);
  await s.api('POST', '/auth/login', { body: { username: 'dosen.andi', password: 'salah' }, device: 'DEV-DOSEN-001' });
  assert.equal(s.lastAudit().reason_code, 'INVALID_CREDENTIALS');
  await s.api('POST', '/auth/refresh', { body: { refresh_token: a.refresh } });
  assert.equal(s.lastAudit().reason_code, 'REFRESH_SUCCESS');
  await s.api('POST', '/auth/logout', { body: { refresh_token: a.refresh } });
  await s.api('GET', '/rahasia/admin', { token: a.token, device: a.device });
  const last = s.lastAudit();
  assert.equal(last.result, 'deny'); assert.equal(last.reason_code, 'ROUTE_NOT_ALLOWED'); assert.equal(last.status_code, 404);
});

test('request tanpa identitas tetap menghasilkan audit event dengan subject unknown/anonymous (PRD 14.2)', async () => {
  await s.api('GET', '/nilai');
  const r = s.lastAudit();
  assert.equal(r.subject_sub, 'unknown'); assert.equal(r.subject_type, 'anonymous'); assert.equal(r.reason_code, 'AUTH_REQUIRED'); assert.equal(r.result, 'deny');
});

test('TC-LOG-02 / AC-16 tidak ada password, token, refresh token, client secret, atau gateway secret di audit log maupun respons error', async () => {
  const m = await s.login('mhs.002');
  const svc = await s.serviceToken();
  await s.api('GET', '/nilai', { token: m.token, device: m.device });
  await s.api('GET', '/nilai', { token: 'token-salah-123', device: m.device });
  await s.api('POST', '/auth/login', { body: { username: 'mhs.002', password: 'sandi-rahasia-uji' }, device: 'DEV-X' });
  const dump = JSON.stringify(s.db.prepare('SELECT * FROM audit_logs').all());
  const secrets = [m.token, m.refresh, svc, s.config.seedPassword, 'sandi-rahasia-uji', s.config.gatewaySecret, s.config.serviceClient.secret, s.config.jwt.secret, 'token-salah-123', 'Bearer'];
  for (const secret of secrets) assert.ok(!dump.includes(secret), `bocor di audit log: ${secret.slice(0, 12)}...`);
  const resp = await s.api('POST', '/auth/login', { body: { username: 'mhs.002', password: 'x' }, device: 'DEV-MHS-002' });
  for (const secret of [s.config.gatewaySecret, s.config.jwt.secret, 'password_hash', '$2a$', '$2b$']) assert.ok(!resp.text.includes(secret));
});

test('audit endpoint tidak menyimpan query string; device_id disanitasi', async () => {
  const m = await s.login('mhs.001');
  await s.api('GET', '/nilai?token=rahasia123&x=1', { token: m.token, device: m.device });
  assert.equal(s.lastAudit().endpoint, '/nilai');
  const bad = await s.api('GET', '/nilai', { token: m.token, device: "DEV';DROP TABLE users;--" });
  assert.equal(bad.status, 403);
  assert.equal(s.lastAudit().device_id, 'DEV??DROP?TABLE?users?--');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM users').get().n, 6);
});

test('audit log append-only dari sisi aplikasi: baris tidak dapat dihapus/diubah', async () => {
  const id = s.lastAudit().id;
  assert.throws(() => s.db.prepare('DELETE FROM audit_logs WHERE id = ?').run(id), /append-only/);
  assert.throws(() => s.db.prepare("UPDATE audit_logs SET result='allow' WHERE id = ?").run(id), /append-only/);
});

test('fail-closed: bila audit tidak dapat ditulis, request ALLOW tidak diteruskan (500), deny tetap deny', async () => {
  const m = await s.login('dosen.andi');
  const before = s.grade('GRD-501-001').score;
  s.db.exec('ALTER TABLE audit_logs RENAME TO audit_logs_bak');
  try {
    const r = await s.api('PUT', '/nilai/GRD-501-001', { token: m.token, device: m.device, body: { score: 11 } });
    assert.equal(r.status, 500); assert.equal(r.body.error.code, 'INTERNAL_ERROR');
    assert.equal(s.grade('GRD-501-001').score, before, 'request tidak boleh diproses tanpa audit');
    const d = await s.api('PUT', '/nilai/GRD-502-001', { token: m.token, device: m.device, body: { score: 11 } });
    assert.equal(d.status, 403, 'deny tetap deny walau audit gagal');
  } finally { s.db.exec('ALTER TABLE audit_logs_bak RENAME TO audit_logs'); }
  const ok = await s.api('PUT', '/nilai/GRD-501-001', { token: m.token, device: m.device, body: { score: 12 } });
  assert.equal(ok.status, 200);
});

test('NFR-SEC-04 error 404/405/400/500 berformat konsisten tanpa stack trace', async () => {
  const m = await s.login('mhs.001');
  const cases = [
    s.api('GET', '/tidak-ada', { token: m.token }),
    s.api('DELETE', '/nilai/GRD-501-001', { token: m.token, device: m.device }),
    s.api('POST', '/auth/login', { rawBody: 'bukan json', device: 'DEV-MHS-001' }),
    s.api('GET', '/nilai'),
  ];
  for (const r of await Promise.all(cases)) {
    assert.ok(r.body && r.body.error && r.body.error.code && r.body.error.message && r.body.error.request_id, r.text);
    assert.ok(!/node_modules|\n\s+at |SQLITE|Error:/.test(r.text), r.text);
  }
});
