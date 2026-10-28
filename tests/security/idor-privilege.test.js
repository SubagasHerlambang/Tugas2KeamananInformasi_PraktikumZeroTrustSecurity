'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

let s; let who;
test.before(async () => {
  s = await startStack();
  const names = ['admin.demo', 'dosen.andi', 'dosen.bunga', 'mhs.001', 'mhs.002', 'mhs.003'];
  const all = await Promise.all(names.map((u) => s.login(u)));
  who = Object.fromEntries(names.map((n, i) => [n, all[i]]));
});
test.after(async () => { await s.stop(); });

test('device spoofing: token mhs.001 + device milik mhs.002 / dosen / admin -> 403 pada semua endpoint bisnis', async () => {
  const eps = [['GET', '/nilai'], ['GET', '/transkrip/247006110001'], ['PUT', '/nilai/GRD-501-001'], ['POST', '/kelas/CLS-501/finalisasi']];
  for (const device of ['DEV-MHS-002', 'DEV-DOSEN-001', 'DEV-ADMIN-001']) {
    for (const [m, p] of eps) {
      const r = await s.api(m, p, { token: who['mhs.001'].token, device, body: m === 'PUT' ? { score: 1 } : undefined });
      assert.equal(r.status, 403, `${device} ${m} ${p}`); assert.equal(r.body.error.code, 'DEVICE_NOT_REGISTERED');
    }
  }
});

test('eskalasi role: admin tidak dapat edit/finalisasi/baca nilai; mahasiswa tidak dapat edit/finalisasi/baca direktori; dosen tidak dapat baca transkrip', async () => {
  const a = who['admin.demo']; const m = who['mhs.001']; const d = who['dosen.andi'];
  const t = (u, method, p, body) => s.api(method, p, { token: u.token, device: u.device, body });
  assert.equal((await t(a, 'PUT', '/nilai/GRD-501-001', { score: 100 })).status, 403);
  assert.equal((await t(a, 'POST', '/kelas/CLS-501/finalisasi')).status, 403);
  assert.equal((await t(a, 'GET', '/nilai')).status, 403);
  assert.equal((await t(m, 'PUT', '/nilai/GRD-501-001', { score: 100 })).status, 403);
  assert.equal((await t(m, 'POST', '/kelas/CLS-501/finalisasi')).status, 403);
  assert.equal((await t(m, 'GET', '/transkrip')).status, 403);
  assert.equal((await t(d, 'GET', '/transkrip/247006110001')).status, 403);
  assert.equal(s.grade('GRD-501-001').score, 82);
});

test('token yang dipalsukan dengan role admin (secret salah) ditolak; role di klaim tidak dipercaya tanpa DB', async () => {
  const sub = s.db.prepare("SELECT id FROM users WHERE username='mhs.001'").get().id;
  const forged = s.signRaw({ sub, role: 'admin' }, { secret: 'attacker-secret-0123456789-abcdefghijklmnopqrstuvwxyz', expiresIn: 600 });
  assert.equal((await s.api('GET', '/transkrip/247006110002', { token: forged, device: 'DEV-MHS-001' })).status, 401);
  // token sah secara tanda tangan tetapi role di klaim tidak sama dengan DB -> ditolak (ROLE_MISMATCH)
  const escalated = s.signRaw({ sub, role: 'admin' }, { expiresIn: 600 });
  const r = await s.api('GET', '/transkrip/247006110002', { token: escalated, device: 'DEV-MHS-001' });
  assert.equal(r.status, 401);
  assert.equal(s.lastAudit().reason_code, 'ROLE_MISMATCH');
});

test('IDOR nilai/transkrip: semua kombinasi mahasiswa-lain dan dosen-lain ditolak tanpa kebocoran', async () => {
  for (const [u, nim] of [['mhs.001', '247006110002'], ['mhs.001', '247006110003'], ['mhs.002', '247006110001'], ['mhs.003', '247006110001']]) {
    const r = await s.api('GET', `/transkrip/${nim}`, { token: who[u].token, device: who[u].device });
    assert.equal(r.status, 403, `${u} -> ${nim}`);
    assert.ok(!r.text.includes(nim) || r.text.includes('request_id'));
    assert.equal(r.body.data, undefined);
  }
  for (const [u, id] of [['dosen.andi', 'GRD-502-001'], ['dosen.andi', 'GRD-502-003'], ['dosen.bunga', 'GRD-501-001']]) {
    const r = await s.api('PUT', `/nilai/${id}`, { token: who[u].token, device: who[u].device, body: { score: 1 } });
    assert.equal(r.status, 403, `${u} -> ${id}`); assert.equal(r.body.error.code, 'CLASS_NOT_OWNED');
  }
  for (const [u, cls] of [['dosen.andi', 'CLS-502'], ['dosen.bunga', 'CLS-501']]) {
    const r = await s.api('POST', `/kelas/${cls}/finalisasi`, { token: who[u].token, device: who[u].device });
    assert.equal(r.status, 403, `${u} -> ${cls}`);
  }
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM grades WHERE status='final'").get().n, 1);
});

test('dosen hanya melihat kelas sendiri: tidak ada mahasiswa/nilai dari kelas lain pada GET /nilai', async () => {
  const a = await s.api('GET', '/nilai', { token: who['dosen.andi'].token, device: who['dosen.andi'].device });
  assert.ok(a.body.data.every((g) => g.class_id === 'CLS-501'));
  assert.ok(!a.text.includes('CLS-502'));
});

test('device dinonaktifkan setelah login -> semua request berikutnya 403; refresh juga ditolak', async () => {
  const fresh = await s.login('mhs.003');
  s.db.prepare("UPDATE devices SET is_active=0 WHERE device_id='DEV-MHS-003'").run();
  assert.equal((await s.api('GET', '/nilai', { token: fresh.token, device: fresh.device })).status, 403);
  assert.equal((await s.api('POST', '/auth/refresh', { body: { refresh_token: fresh.refresh } })).status, 403);
  s.db.prepare("UPDATE devices SET is_active=1 WHERE device_id='DEV-MHS-003'").run();
});

test('replay token user yang sudah logout: access token tetap valid sampai exp (batas diketahui), tetapi refresh mati', async () => {
  const fresh = await s.login('mhs.001');
  await s.api('POST', '/auth/logout', { body: { refresh_token: fresh.refresh } });
  assert.equal((await s.api('POST', '/auth/refresh', { body: { refresh_token: fresh.refresh } })).status, 401);
  // Keterbatasan terdokumentasi (PRD 13.2): access JWT yang sudah terbit berlaku hingga 10 menit.
  assert.equal((await s.api('GET', '/nilai', { token: fresh.token, device: fresh.device })).status, 200);
});
