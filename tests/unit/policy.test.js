'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, migrate, seed } = require('../../packages/database');
const { createFixedClock, loadConfig } = require('../../packages/shared');
const { createPolicyData } = require('../../apps/gateway/src/policy/policy-data');
const { createPolicyEngine } = require('../../apps/gateway/src/policy/policy');
const { matchRoute, ROUTES } = require('../../apps/gateway/src/policy/route-table');
const { TEST_ENV } = require('../helpers/harness');

const config = loadConfig({ ...TEST_ENV });
const db = openDatabase(':memory:');
migrate(db);
seed(db, { demoPassword: 'Demo-pass-1', serviceClientId: 'service-nilai', serviceClientSecret: 'secretsecretsecret1', bcryptCost: 4 });
const clock = createFixedClock('2026-10-23T05:00:00Z'); // 12:00 WIB
const data = createPolicyData(db);
const policy = createPolicyEngine({ data, clock, config });
const user = (username) => db.prepare('SELECT id, username, role, nim, is_active FROM users WHERE username = ?').get(username);
const route = (name) => ROUTES.find((r) => r.name === name);
const ev = (name, username, params = {}, identity) => policy.evaluate({ route: route(name), user: username ? user(username) : null, params, identity });
const reason = (d) => `${d.decision}:${d.reasonCode}`;

test('nilai.list: mahasiswa & dosen diizinkan, admin ditolak', () => {
  assert.equal(reason(ev('nilai.list', 'mhs.001')), 'allow:POLICY_ALLOW');
  assert.equal(reason(ev('nilai.list', 'dosen.andi')), 'allow:POLICY_ALLOW');
  assert.equal(reason(ev('nilai.list', 'admin.demo')), 'deny:ROLE_NOT_ALLOWED');
});
test('nilai.update: dosen pengampu + draft + jam akses -> allow', () => {
  assert.equal(reason(ev('nilai.update', 'dosen.andi', { id: 'GRD-501-001' })), 'allow:POLICY_ALLOW');
});
test('nilai.update: kelas dosen lain -> CLASS_NOT_OWNED; role salah -> ROLE_NOT_ALLOWED; tidak ada -> 404', () => {
  assert.equal(reason(ev('nilai.update', 'dosen.andi', { id: 'GRD-502-001' })), 'deny:CLASS_NOT_OWNED');
  assert.equal(reason(ev('nilai.update', 'admin.demo', { id: 'GRD-501-001' })), 'deny:ROLE_NOT_ALLOWED');
  assert.equal(reason(ev('nilai.update', 'mhs.001', { id: 'GRD-501-001' })), 'deny:ROLE_NOT_ALLOWED');
  const d = ev('nilai.update', 'dosen.andi', { id: 'GRD-NOPE' });
  assert.equal(d.error.status, 404);
});
test('nilai.update: nilai final -> 409 GRADE_FINAL', () => {
  const d = ev('nilai.update', 'dosen.andi', { id: 'GRD-501-003' });
  assert.equal(reason(d), 'deny:GRADE_FINAL');
  assert.equal(d.error.status, 409);
});
test('nilai.update & finalisasi: di luar jam akses -> OUT_OF_ACCESS_HOURS (403)', () => {
  const late = createFixedClock('2026-10-23T14:00:00Z'); // 21:00 WIB
  const p = createPolicyEngine({ data, clock: late, config });
  const d1 = p.evaluate({ route: route('nilai.update'), user: user('dosen.andi'), params: { id: 'GRD-501-001' } });
  const d2 = p.evaluate({ route: route('kelas.finalisasi'), user: user('dosen.andi'), params: { id: 'CLS-501' } });
  for (const d of [d1, d2]) { assert.equal(reason(d), 'deny:OUT_OF_ACCESS_HOURS'); assert.equal(d.error.status, 403); }
});
test('kelas.finalisasi: pengampu allow; kelas lain / role lain / tidak ada ditolak', () => {
  assert.equal(reason(ev('kelas.finalisasi', 'dosen.andi', { id: 'CLS-501' })), 'allow:POLICY_ALLOW');
  assert.equal(reason(ev('kelas.finalisasi', 'dosen.andi', { id: 'CLS-502' })), 'deny:CLASS_NOT_OWNED');
  assert.equal(reason(ev('kelas.finalisasi', 'admin.demo', { id: 'CLS-501' })), 'deny:ROLE_NOT_ALLOWED');
  assert.equal(ev('kelas.finalisasi', 'dosen.andi', { id: 'CLS-NOPE' }).error.status, 404);
});
test('transkrip.get: mahasiswa hanya NIM sendiri (dari DB), admin semua NIM, dosen ditolak', () => {
  assert.equal(reason(ev('transkrip.get', 'mhs.001', { nim: '247006110001' })), 'allow:POLICY_ALLOW');
  assert.equal(reason(ev('transkrip.get', 'mhs.001', { nim: '247006110002' })), 'deny:NIM_NOT_OWNED');
  assert.equal(reason(ev('transkrip.get', 'admin.demo', { nim: '247006110003' })), 'allow:POLICY_ALLOW');
  assert.equal(reason(ev('transkrip.get', 'dosen.andi', { nim: '247006110001' })), 'deny:ROLE_NOT_ALLOWED');
  assert.equal(ev('transkrip.get', 'admin.demo', { nim: '999999999999' }).error.status, 404);
  assert.equal(ev('transkrip.get', 'mhs.001', { nim: 'abc' }).error.status, 400);
});
test('transkrip.list: hanya admin', () => {
  assert.equal(reason(ev('transkrip.list', 'admin.demo')), 'allow:POLICY_ALLOW');
  assert.equal(reason(ev('transkrip.list', 'mhs.001')), 'deny:ROLE_NOT_ALLOWED');
});
test('transkrip.sinkron: hanya token service; token user (apa pun) ditolak SERVICE_TOKEN_REQUIRED', () => {
  const svc = { kind: 'service', claims: { sub: 'service-nilai', role: 'service' } };
  assert.equal(reason(ev('transkrip.sinkron', null, {}, svc)), 'allow:POLICY_ALLOW');
  for (const [u, role] of [['admin.demo', 'admin'], ['dosen.andi', 'dosen'], ['mhs.001', 'mahasiswa']]) {
    const d = ev('transkrip.sinkron', null, {}, { kind: 'user', claims: { sub: user(u).id, role } });
    assert.equal(reason(d), 'deny:SERVICE_TOKEN_REQUIRED'); assert.equal(d.error.status, 403);
  }
  assert.equal(reason(ev('transkrip.sinkron', null, {}, { kind: 'service', claims: { sub: 'service-lain', role: 'service' } })), 'deny:SERVICE_CLIENT_INACTIVE');
});
test('service client nonaktif ditolak policy', () => {
  db.prepare("UPDATE service_clients SET is_active = 0 WHERE client_id = 'service-nilai'").run();
  assert.equal(reason(ev('transkrip.sinkron', null, {}, { kind: 'service', claims: { sub: 'service-nilai', role: 'service' } })), 'deny:SERVICE_CLIENT_INACTIVE');
  db.prepare("UPDATE service_clients SET is_active = 1 WHERE client_id = 'service-nilai'").run();
});
test('default deny: route tanpa aturan eksplisit ditolak', () => {
  const d = policy.evaluate({ route: { name: 'rahasia.baru' }, user: user('admin.demo'), params: {} });
  assert.equal(reason(d), 'deny:NO_EXPLICIT_POLICY');
});
test('kelas tidak lengkap (mahasiswa terdaftar tanpa nilai) -> 422 CLASS_INCOMPLETE', () => {
  db.exec("INSERT INTO users(id,username,password_hash,full_name,role,nim) VALUES ('USR-X','mhs.x','h','X','mahasiswa','247006119999')");
  db.exec("INSERT INTO enrollments(class_id,student_id) VALUES ('CLS-502','USR-X')");
  const d = ev('kelas.finalisasi', 'dosen.bunga', { id: 'CLS-502' });
  assert.equal(reason(d), 'deny:CLASS_INCOMPLETE'); assert.equal(d.error.status, 422);
});

// ---- route table ----
test('matchRoute: route valid dengan parameter', () => {
  assert.equal(matchRoute('PUT', '/nilai/GRD-501-001').route.name, 'nilai.update');
  assert.deepEqual(matchRoute('PUT', '/nilai/GRD-501-001').params, { id: 'GRD-501-001' });
  assert.equal(matchRoute('POST', '/kelas/CLS-501/finalisasi').route.name, 'kelas.finalisasi');
  assert.equal(matchRoute('POST', '/transkrip/sinkron').route.name, 'transkrip.sinkron');
  assert.equal(matchRoute('GET', '/transkrip/247006110001').route.name, 'transkrip.get');
});
test('TC-GW-03 matchRoute: path tidak dikenal / traversal / encoding / trailing slash -> tidak cocok', () => {
  for (const p of ['/admin', '/nilai/../transkrip/1', '/nilai/%2e%2e', '/nilai/..', '//nilai', '/nilai/', '/nilai/a/b', '/NILAI', '/kelas/CLS-501', '/auth/login/', '/nilai/a%2Fb', '/nilai/a\\b', '', 'nilai']) {
    assert.equal(matchRoute('GET', p).route, undefined, `seharusnya tidak cocok: ${p}`);
    assert.equal(matchRoute('PUT', p).route, undefined, `seharusnya tidak cocok: ${p}`);
  }
});
test('matchRoute: method tidak diizinkan dilaporkan sebagai allowedMethods (bukan route)', () => {
  const r = matchRoute('DELETE', '/nilai/GRD-501-001');
  assert.equal(r.route, undefined); assert.deepEqual(r.allowedMethods, ['PUT']);
  assert.equal(matchRoute('GET', '/auth/login').route, undefined);
});
