'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

let s; let m1; let m2; let andi; let admin; let svc;
test.before(async () => {
  s = await startStack();
  [m1, m2, andi, admin] = await Promise.all(['mhs.001', 'mhs.002', 'dosen.andi', 'admin.demo'].map((u) => s.login(u)));
  svc = await s.serviceToken();
});
test.after(async () => { await s.stop(); });

const tr = (who, nim) => s.api('GET', `/transkrip/${nim}`, { token: who.token, device: who.device });
const sync = (payload, token = svc, headers = {}) => s.api('POST', '/transkrip/sinkron', { token, body: payload, headers });
const payload = (over = {}) => ({ grade_id: 'GRD-501-001', student_nim: '247006110001', class_id: 'CLS-501', score: 82, term: '2026-GANJIL', version: 1, ...over });
const count = (gradeId) => s.db.prepare('SELECT COUNT(*) n FROM transcript_entries WHERE grade_id = ?').get(gradeId).n;

test('TC-TR-01 mahasiswa membaca transkrip sendiri: 200, hanya entri published miliknya', async () => {
  const r = await tr(m1, '247006110001');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.nim, '247006110001');
  assert.deepEqual(r.body.data.entries, []); // mhs.001 belum punya nilai final
  const r3 = await tr(await s.login('mhs.003'), '247006110003');
  assert.equal(r3.body.data.entries.length, 1);
  assert.equal(r3.body.data.entries[0].score, 90);
});

test('TC-TR-02 mahasiswa membaca transkrip orang lain: 403 tanpa isi transkrip (IDOR)', async () => {
  const r = await tr(m1, '247006110003');
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FORBIDDEN');
  assert.ok(!r.text.includes('90') && !r.text.includes('entries'));
  assert.equal(s.lastAudit().reason_code, 'NIM_NOT_OWNED');
});

test('TC-TR-03 admin membaca transkrip semua NIM; NIM tidak ada -> 404; format salah -> 400', async () => {
  for (const nim of ['247006110001', '247006110002', '247006110003']) {
    const r = await tr(admin, nim);
    assert.equal(r.status, 200, nim); assert.equal(r.body.data.nim, nim);
  }
  assert.equal((await tr(admin, '999999999999')).status, 404);
  assert.equal((await tr(admin, 'abc')).status, 400);
  assert.equal((await tr(admin, 'sinkron')).status, 400);
});

test('dosen tidak berhak membaca transkrip (tidak dinyatakan di tugas -> default deny)', async () => {
  const r = await tr(andi, '247006110001');
  assert.equal(r.status, 403);
  assert.equal(s.lastAudit().reason_code, 'ROLE_NOT_ALLOWED');
});

test('direktori transkrip (GET /transkrip) hanya admin', async () => {
  const ok = await s.api('GET', '/transkrip', { token: admin.token, device: admin.device });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.map((x) => x.nim), ['247006110001', '247006110002', '247006110003']);
  for (const who of [m1, andi]) assert.equal((await s.api('GET', '/transkrip', { token: who.token, device: who.device })).status, 403);
});

test('TC-TR-04 token user (mahasiswa/dosen/admin) ke /transkrip/sinkron -> 403 SERVICE_TOKEN_REQUIRED, tidak ada insert', async () => {
  for (const who of [m1, andi, admin]) {
    const r = await sync(payload(), who.token);
    assert.equal(r.status, 403, who.device); assert.equal(r.body.error.code, 'SERVICE_TOKEN_REQUIRED');
  }
  assert.equal(count('GRD-501-001'), 0);
  assert.equal(s.lastAudit().reason_code, 'SERVICE_TOKEN_REQUIRED');
});

test('sinkron tanpa token -> 401; token rusak -> 401', async () => {
  assert.equal((await s.api('POST', '/transkrip/sinkron', { body: payload() })).status, 401);
  assert.equal((await sync(payload(), 'rusak.rusak.rusak')).status, 401);
});

test('sinkron dengan token service valid: 201 pending; pending TIDAK tampil pada transkrip', async () => {
  const r = await sync(payload());
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.sync_status, 'pending'); assert.equal(r.body.data.created, true);
  assert.equal(count('GRD-501-001'), 1);
  const t = await tr(m1, '247006110001');
  assert.equal(t.body.data.entries.length, 0);
  assert.equal((await tr(admin, '247006110001')).body.data.entries.length, 0);
});

test('TC-FIN-04 sinkron identik berulang: idempoten (200), tetap 1 entri', async () => {
  for (let i = 0; i < 3; i += 1) {
    const r = await sync(payload(), svc, { 'idempotency-key': 'grade:GRD-501-001:v1' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.data.idempotent, true);
  }
  assert.equal(count('GRD-501-001'), 1);
});

test('sinkron: Idempotency-Key yang tidak cocok dengan payload -> 400', async () => {
  assert.equal((await sync(payload(), svc, { 'idempotency-key': 'grade:LAIN:v9' })).status, 400);
});

test('sinkron memverifikasi payload terhadap DB: skor/versi tidak cocok -> 409; kelas/NIM tidak cocok -> 422; nilai tak ada -> 404', async () => {
  assert.equal((await sync(payload({ score: 100 }))).status, 409);
  assert.equal((await sync(payload({ version: 7 }))).status, 409);
  assert.equal((await sync(payload({ student_nim: '247006110002' }))).status, 422);
  assert.equal((await sync(payload({ class_id: 'CLS-502' }))).status, 422);
  assert.equal((await sync(payload({ grade_id: 'GRD-NOPE-001' }))).status, 404);
  assert.equal(count('GRD-501-001'), 1);
});

test('sinkron: payload invalid / field ekstra / body kosong -> 400 tanpa perubahan', async () => {
  for (const bad of [{}, payload({ score: 'x' }), payload({ version: 0 }), { ...payload(), extra: true }, payload({ term: 'x' })]) {
    assert.equal((await sync(bad)).status, 400, JSON.stringify(bad));
  }
});

test('entri published tidak dapat diubah lewat sinkron versi lain -> 409', async () => {
  s.db.prepare("UPDATE grades SET score=95, version=2 WHERE id='GRD-501-003'").run(); // simulasi anomali data
  const r = await sync(payload({ grade_id: 'GRD-501-003', student_nim: '247006110003', score: 95, version: 2 }));
  assert.equal(r.status, 409);
  assert.equal(s.db.prepare("SELECT score FROM transcript_entries WHERE grade_id='GRD-501-003'").get().score, 90);
});

test('pembaruan entri pending dengan versi lebih baru memperbarui entri yang sama (tanpa duplikasi)', async () => {
  s.db.prepare("UPDATE grades SET score=84, version=2 WHERE id='GRD-501-001'").run();
  const r = await sync(payload({ score: 84, version: 2 }));
  assert.equal(r.status, 200); assert.equal(r.body.data.idempotent, false);
  assert.equal(count('GRD-501-001'), 1);
  assert.equal(s.db.prepare("SELECT score, version FROM transcript_entries WHERE grade_id='GRD-501-001'").get().version, 2);
});

test('token service TIDAK berlaku untuk endpoint user (nilai/transkrip/finalisasi)', async () => {
  for (const [m, p] of [['GET', '/nilai'], ['GET', '/transkrip/247006110001'], ['POST', '/kelas/CLS-501/finalisasi'], ['PUT', '/nilai/GRD-501-001']]) {
    const r = await s.api(m, p, { token: svc, device: 'DEV-DOSEN-001', body: m === 'PUT' ? { score: 1 } : undefined });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal(s.lastAudit().subject_type, 'service');
});

test('token service kedaluwarsa ditolak 401 di endpoint sinkron', async () => {
  const expired = s.signRaw({ sub: 'service-nilai', role: 'service' }, { expiresIn: -1 });
  const r = await sync(payload(), expired);
  assert.equal(r.status, 401); assert.equal(r.body.error.code, 'TOKEN_EXPIRED');
});

test('token service dengan sub bukan service-nilai ditolak', async () => {
  const other = s.signRaw({ sub: 'service-lain', role: 'service' }, { expiresIn: 300 });
  assert.equal((await sync(payload(), other)).status, 403);
});
