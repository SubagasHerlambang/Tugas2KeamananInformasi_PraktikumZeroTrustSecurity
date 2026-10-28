'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

let s; let andi; let bunga; let m1; let m2; let admin;
test.before(async () => {
  s = await startStack();
  [andi, bunga, m1, m2, admin] = await Promise.all(['dosen.andi', 'dosen.bunga', 'mhs.001', 'mhs.002', 'admin.demo'].map((u) => s.login(u)));
});
test.after(async () => { await s.stop(); });

const put = (who, id, body) => s.api('PUT', `/nilai/${id}`, { token: who.token, device: who.device, body });
const get = (who) => s.api('GET', '/nilai', { token: who.token, device: who.device });

test('TC-VAL-01 mahasiswa melihat HANYA nilai miliknya', async () => {
  const r = await get(m1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map((g) => g.id).sort(), ['GRD-501-001', 'GRD-502-001']);
  assert.ok(r.body.data.every((g) => g.student_nim === '247006110001'));
  assert.ok(!r.text.includes('247006110002'), 'tidak boleh ada data mhs.002');
  const r2 = await get(m2);
  assert.ok(r2.body.data.every((g) => g.student_nim === '247006110002'));
});

test('TC-VAL-02 mahasiswa tidak dapat memakai query/parameter untuk membaca data mahasiswa lain', async () => {
  const r = await s.api('GET', '/nilai?student_id=USR-MHS-002&nim=247006110002', { token: m1.token, device: m1.device });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.every((g) => g.student_nim === '247006110001'));
});

test('GET /nilai: draft internal (finalizing/sync_failed) tidak terlihat sebagai status internal oleh mahasiswa', async () => {
  s.db.prepare("UPDATE grades SET status='sync_failed' WHERE id='GRD-502-001'").run();
  const r = await get(m1);
  assert.equal(r.body.data.find((g) => g.id === 'GRD-502-001').status, 'draft');
  const d = await get(bunga);
  assert.equal(d.body.data.find((g) => g.id === 'GRD-502-001').status, 'sync_failed');
  s.db.prepare("UPDATE grades SET status='draft' WHERE id='GRD-502-001'").run();
});

test('TC-VAL-03 dosen melihat HANYA kelas yang diampu (+ metadata jam akses)', async () => {
  const a = await get(andi);
  assert.equal(a.status, 200);
  assert.ok(a.body.data.length === 3 && a.body.data.every((g) => g.class_id === 'CLS-501'));
  const b = await get(bunga);
  assert.ok(b.body.data.length === 3 && b.body.data.every((g) => g.class_id === 'CLS-502'));
  assert.equal(a.body.meta.access_window.open, true);
  assert.equal(a.body.meta.access_window.timezone, 'Asia/Jakarta');
});

test('admin tidak diizinkan GET /nilai (sesuai matriks endpoint tugas)', async () => {
  const r = await get(admin);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FORBIDDEN');
  assert.equal(s.lastAudit().reason_code, 'ROLE_NOT_ALLOWED');
});

test('TC-VAL-05 edit nilai valid: dosen pengampu, draft, dalam jam akses -> 200, versi naik, DB berubah', async () => {
  const before = s.grade('GRD-501-001');
  const r = await put(andi, 'GRD-501-001', { score: 85 });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.score, 85); assert.equal(r.body.data.status, 'draft'); assert.equal(r.body.data.id, 'GRD-501-001');
  const after = s.grade('GRD-501-001');
  assert.equal(after.score, 85); assert.equal(after.version, before.version + 1); assert.equal(after.updated_by, 'USR-DOSEN-01');
  const a = s.lastAudit();
  assert.equal(a.result, 'allow'); assert.equal(a.endpoint, '/nilai/GRD-501-001'); assert.equal(a.device_id, 'DEV-DOSEN-001'); assert.equal(a.status_code, 200);
});

test('TC-VAL-04 dosen mengakses nilai di kelas lain: 403 CLASS_NOT_OWNED, data tidak berubah', async () => {
  const before = s.grade('GRD-502-001').score;
  const r = await put(andi, 'GRD-502-001', { score: 10 });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'CLASS_NOT_OWNED');
  assert.equal(s.grade('GRD-502-001').score, before);
  assert.equal(s.lastAudit().reason_code, 'CLASS_NOT_OWNED');
});

test('PUT nilai oleh mahasiswa / admin ditolak; admin tidak punya hak edit implisit', async () => {
  for (const who of [m1, admin]) {
    const r = await put(who, 'GRD-501-001', { score: 100 });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FORBIDDEN');
  }
  assert.notEqual(s.grade('GRD-501-001').score, 100);
});

test('PUT nilai tidak ada -> 404 RESOURCE_NOT_FOUND', async () => {
  const r = await put(andi, 'GRD-999-999', { score: 50 });
  assert.equal(r.status, 404); assert.equal(r.body.error.code, 'RESOURCE_NOT_FOUND');
});

test('TC-VAL-06 edit nilai final -> 409 GRADE_FINAL dan skor tidak berubah', async () => {
  const r = await put(andi, 'GRD-501-003', { score: 50 });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'GRADE_FINAL');
  assert.equal(s.grade('GRD-501-003').score, 90);
  assert.equal(s.lastAudit().reason_code, 'GRADE_FINAL');
});

test('PUT nilai saat finalisasi berjalan (status finalizing) -> 409 konflik', async () => {
  s.db.prepare("UPDATE grades SET status='finalizing' WHERE id='GRD-501-002'").run();
  const r = await put(andi, 'GRD-501-002', { score: 77 });
  assert.equal(r.status, 409);
  assert.equal(s.grade('GRD-501-002').score, 76);
  s.db.prepare("UPDATE grades SET status='draft' WHERE id='GRD-501-002'").run();
});

test('TC-VAL-07 batas jam akses 07:00-21:00 WIB: 06:59, 07:00, 20:59, 21:00, 21:01', async () => {
  const cases = [
    ['2026-10-22T23:59:00Z', 403], // 06:59 WIB
    ['2026-10-23T00:00:00Z', 200], // 07:00 WIB
    ['2026-10-23T13:59:00Z', 200], // 20:59 WIB
    ['2026-10-23T14:00:00Z', 403], // 21:00 WIB
    ['2026-10-23T14:01:00Z', 403], // 21:01 WIB
  ];
  let n = 60;
  for (const [iso, expected] of cases) {
    s.clock.set(iso);
    const before = s.grade('GRD-501-002').score;
    n += 1;
    const r = await put(andi, 'GRD-501-002', { score: n });
    assert.equal(r.status, expected, `${iso} -> ${r.status}`);
    if (expected === 403) {
      assert.equal(r.body.error.code, 'OUT_OF_ACCESS_HOURS'); assert.equal(s.lastAudit().reason_code, 'OUT_OF_ACCESS_HOURS');
      assert.equal(s.grade('GRD-501-002').score, before, 'data tidak boleh berubah di luar jam');
    } else assert.equal(s.grade('GRD-501-002').score, n);
  }
  s.clock.set('2026-10-23T05:00:00Z');
});

test('jam akses dapat dikonfigurasi lewat environment (jendela sempit untuk demo)', async () => {
  const narrow = await startStack({ env: { ACCESS_WINDOW_START: '12:00', ACCESS_WINDOW_END: '12:30' } });
  try {
    const d = await narrow.login('dosen.andi');
    assert.equal((await narrow.api('PUT', '/nilai/GRD-501-001', { token: d.token, device: d.device, body: { score: 70 } })).status, 200); // 12:00 WIB
    narrow.clock.set('2026-10-23T05:30:00Z'); // 12:30 WIB -> eksklusif
    assert.equal((await narrow.api('PUT', '/nilai/GRD-501-001', { token: d.token, device: d.device, body: { score: 71 } })).status, 403);
  } finally { await narrow.stop(); }
});

test('TC-IN-01 skor invalid ditolak 400 dan DB tidak berubah (string, negatif, >100, NaN/null, field ekstra, body kosong)', async () => {
  const before = s.grade('GRD-501-001').score;
  for (const body of [{ score: '85' }, { score: -1 }, { score: 101 }, { score: null }, { score: true }, { score: 80, status: 'final' }, {}]) {
    const r = await put(andi, 'GRD-501-001', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  }
  const raw = await s.api('PUT', '/nilai/GRD-501-001', { token: andi.token, device: andi.device, rawBody: '{"score": NaN}' });
  assert.equal(raw.status, 400);
  assert.equal(s.grade('GRD-501-001').score, before);
});

test('batas skor 0 dan 100 diterima; desimal diterima', async () => {
  for (const v of [0, 100, 87.5]) {
    const r = await put(andi, 'GRD-501-001', { score: v });
    assert.equal(r.status, 200); assert.equal(r.body.data.score, v);
  }
});

test('request ID konsisten: header X-Request-ID = request_id di error = request_id di audit', async () => {
  const r = await put(andi, 'GRD-502-001', { score: 10 });
  const rid = r.headers.get('x-request-id');
  assert.ok(rid.startsWith('req-'));
  assert.equal(r.body.error.request_id, rid);
  assert.equal(s.lastAudit().request_id, rid);
});
