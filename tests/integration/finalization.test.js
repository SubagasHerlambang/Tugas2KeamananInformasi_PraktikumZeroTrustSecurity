'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

let s; let andi; let bunga; let m1; let m3; let admin;
test.beforeEach(async () => {
  s = await startStack();
  [andi, bunga, m1, m3, admin] = await Promise.all(['dosen.andi', 'dosen.bunga', 'mhs.001', 'mhs.003', 'admin.demo'].map((u) => s.login(u)));
});
test.afterEach(async () => { await s.stop(); });

const fin = (who, cls) => s.api('POST', `/kelas/${cls}/finalisasi`, { token: who.token, device: who.device });
const transcript = (who, nim) => s.api('GET', `/transkrip/${nim}`, { token: who.token, device: who.device });
const entries = (nim) => s.db.prepare(`SELECT t.* FROM transcript_entries t JOIN users u ON u.id=t.student_id WHERE u.nim=? ORDER BY grade_id`).all(nim);

test('TC-FIN-01 finalisasi valid: sinkron via gateway + token service, nilai final, transkrip published & terbaca', async () => {
  const before = await transcript(m1, '247006110001');
  assert.equal(before.body.data.entries.length, 0);
  const up = await s.api('PUT', '/nilai/GRD-501-001', { token: andi.token, device: andi.device, body: { score: 91 } });
  assert.equal(up.status, 200);

  const r = await fin(andi, 'CLS-501');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.class_id, 'CLS-501'); assert.equal(r.body.data.status, 'final'); assert.equal(r.body.data.transcript_sync, 'success');
  assert.deepEqual(r.body.data.finalized.map((f) => f.grade_id).sort(), ['GRD-501-001', 'GRD-501-002']); // 501-003 sudah final sebelumnya

  for (const id of ['GRD-501-001', 'GRD-501-002', 'GRD-501-003']) {
    const g = s.grade(id); assert.equal(g.status, 'final'); assert.ok(g.finalized_at);
  }
  const t = await transcript(m1, '247006110001');
  assert.equal(t.status, 200);
  assert.equal(t.body.data.entries.length, 1);
  assert.equal(t.body.data.entries[0].score, 91); assert.equal(t.body.data.entries[0].course_code, 'IF-501');
  assert.equal(entries('247006110001')[0].sync_status, 'published');

  // bukti: sinkronisasi MELEWATI GATEWAY dengan token service (AC-13) -> ada audit allow subject_type=service
  const svc = s.audit("subject_type = 'service'");
  assert.ok(svc.some((a) => a.endpoint === '/auth/service' && a.result === 'allow'));
  const syncs = svc.filter((a) => a.endpoint === '/transkrip/sinkron');
  assert.equal(syncs.length, 2);
  assert.ok(syncs.every((a) => a.result === 'allow' && a.subject_sub === 'service-nilai' && a.reason_code === 'POLICY_ALLOW'));
});

test('setelah finalisasi, edit nilai ditolak (final immutable) dan finalisasi ulang -> 409', async () => {
  assert.equal((await fin(andi, 'CLS-501')).status, 200);
  const edit = await s.api('PUT', '/nilai/GRD-501-001', { token: andi.token, device: andi.device, body: { score: 1 } });
  assert.equal(edit.status, 409); assert.equal(edit.body.error.code, 'GRADE_FINAL');
  const again = await fin(andi, 'CLS-501');
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'GRADE_FINAL');
  assert.equal(entries('247006110001').length, 1, 'tidak ada duplikasi entri');
});

test('TC-FIN-02 finalisasi kelas bukan miliknya -> 403 CLASS_NOT_OWNED, tidak ada transkrip dibuat', async () => {
  const r = await fin(andi, 'CLS-502');
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'CLASS_NOT_OWNED');
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502'").get().n, 0);
  assert.equal(s.grade('GRD-502-001').status, 'draft');
});

test('finalisasi oleh admin/mahasiswa ditolak; kelas tidak ada -> 404; ID rusak -> 400', async () => {
  for (const who of [admin, m1]) { const r = await fin(who, 'CLS-501'); assert.equal(r.status, 403); }
  assert.equal((await fin(andi, 'CLS-NOPE')).status, 404);
  assert.equal((await s.api('POST', "/kelas/CLS-501'--/finalisasi", { token: andi.token, device: andi.device })).status, 404);
  assert.equal(s.grade('GRD-501-001').status, 'draft');
});

test('finalisasi di luar jam akses -> 403 OUT_OF_ACCESS_HOURS; di dalam jam -> 200', async () => {
  for (const iso of ['2026-10-22T23:59:00Z', '2026-10-23T14:00:00Z', '2026-10-23T14:01:00Z']) { // 06:59, 21:00 (batas akhir eksklusif), 21:01 WIB
    s.clock.set(iso);
    const r = await fin(andi, 'CLS-501');
    assert.equal(r.status, 403, iso); assert.equal(r.body.error.code, 'OUT_OF_ACCESS_HOURS');
  }
  assert.equal(s.grade('GRD-501-001').status, 'draft');
  s.clock.set('2026-10-23T00:00:00Z'); // 07:00 WIB tepat
  assert.equal((await fin(andi, 'CLS-501')).status, 200);
});

test('kelas tidak lengkap (mahasiswa terdaftar tanpa nilai) -> 422 CLASS_INCOMPLETE dan tidak ada yang berubah', async () => {
  s.db.prepare("DELETE FROM grades WHERE id='GRD-502-003'").run();
  const r = await fin(bunga, 'CLS-502');
  assert.equal(r.status, 422); assert.equal(r.body.error.code, 'BUSINESS_RULE_VIOLATION');
  assert.equal(s.lastAudit().reason_code, 'CLASS_INCOMPLETE');
  assert.equal(s.grade('GRD-502-001').status, 'draft');
});

test('TC-FIN-03 Service Transkrip tidak tersedia -> 502, TIDAK dilaporkan sukses, status sync_failed, pending tidak terlihat, gagal tercatat', async () => {
  await s.transkrip.stop();
  const r = await fin(bunga, 'CLS-502');
  assert.equal(r.status, 502, r.text);
  assert.equal(r.body.error.code, 'UPSTREAM_SERVICE_FAILURE');
  assert.equal(r.body.error.details.retryable, true);
  assert.ok(!/ECONNREFUSED|\bstack\b|\n\s+at \S+ \(|node_modules/.test(r.text));
  for (const id of ['GRD-502-001', 'GRD-502-002', 'GRD-502-003']) { assert.equal(s.grade(id).status, 'sync_failed'); assert.equal(s.grade(id).finalized_at, null); }
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502' AND sync_status='published'").get().n, 0);
  // kegagalan hulu tercatat di audit log gateway
  const fails = s.audit("reason_code = 'UPSTREAM_SERVICE_FAILURE'");
  assert.ok(fails.length >= 1 && fails.every((f) => f.result === 'deny' && f.status_code === 502));
  // dosen dapat melihat status yang dapat dicoba ulang
  const list = await s.api('GET', '/nilai', { token: bunga.token, device: bunga.device });
  assert.ok(list.body.data.every((g) => g.status === 'sync_failed'));
  // setelah service pulih, entri transkrip kelas ini tetap tidak terlihat (tidak ada yang published)
  await s.transkrip.start();
  const t = await transcript(m1, '247006110001');
  assert.equal(t.status, 200);
  assert.equal(t.body.data.entries.filter((e) => e.course_code === 'IF-502').length, 0);
});

test('TC-FIN-04 retry setelah pemulihan: sukses, tidak ada entri duplikat, pending menjadi published', async () => {
  await s.transkrip.stop();
  assert.equal((await fin(bunga, 'CLS-502')).status, 502);
  await s.transkrip.start();
  const r = await fin(bunga, 'CLS-502');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.finalized.length, 3);
  const rows = s.db.prepare("SELECT grade_id, sync_status FROM transcript_entries WHERE class_id='CLS-502'").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((x) => x.sync_status === 'published'));
  assert.equal(new Set(rows.map((x) => x.grade_id)).size, 3);
  const t = await transcript(m1, '247006110001');
  assert.equal(t.body.data.entries.filter((e) => e.course_code === 'IF-502').length, 1);
});

test('kegagalan parsial: sinkron sebagian sukses lalu gagal -> tidak ada yang final, entri pending tersembunyi, retry menyelesaikan tanpa duplikasi', async () => {
  let calls = 0;
  const flaky = async (url, init) => {
    if (String(url).endsWith('/transkrip/sinkron')) { calls += 1; if (calls === 2) throw new Error('jaringan putus'); }
    return fetch(url, init);
  };
  await s.stop();
  s = await startStack({ nilaiFetch: flaky });
  [andi, bunga, m1] = await Promise.all(['dosen.andi', 'dosen.bunga', 'mhs.001'].map((u) => s.login(u)));

  const r = await fin(bunga, 'CLS-502');
  assert.equal(r.status, 502);
  assert.equal(r.body.error.details.synced_before_failure, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM grades WHERE class_id='CLS-502' AND status='final'").get().n, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502' AND sync_status='pending'").get().n, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502' AND sync_status='published'").get().n, 0);
  const t = await transcript(m1, '247006110001');
  assert.equal(t.body.data.entries.filter((e) => e.course_code === 'IF-502').length, 0, 'pending tidak boleh terlihat');

  const retry = await fin(bunga, 'CLS-502');
  assert.equal(retry.status, 200, retry.text);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502'").get().n, 3);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502' AND sync_status='published'").get().n, 3);
});

test('edit nilai setelah sync_failed diizinkan (belum final) dan versi baru tersinkron pada retry', async () => {
  await s.transkrip.stop();
  assert.equal((await fin(bunga, 'CLS-502')).status, 502);
  const e = await s.api('PUT', '/nilai/GRD-502-001', { token: bunga.token, device: bunga.device, body: { score: 99 } });
  assert.equal(e.status, 200); assert.equal(e.body.data.status, 'draft'); assert.equal(e.body.data.version, 2);
  await s.transkrip.start();
  assert.equal((await fin(bunga, 'CLS-502')).status, 200);
  const t = await transcript(m1, '247006110001');
  assert.equal(t.body.data.entries.find((x) => x.course_code === 'IF-502').score, 99);
});

test('finalisasi serentak (dua request paralel): tepat satu sukses, tidak ada duplikasi transkrip', async () => {
  const [a, b] = await Promise.all([fin(bunga, 'CLS-502'), fin(bunga, 'CLS-502')]);
  const codes = [a.status, b.status].sort();
  assert.equal(codes[0], 200);
  assert.equal(codes[1], 409);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE class_id='CLS-502'").get().n, 3);
});

test('kunci finalizing yang basi (proses mati) dilepas dan dapat dicoba ulang', async () => {
  s.db.prepare("UPDATE grades SET status='finalizing', updated_at='2026-10-23T04:00:00.000Z' WHERE class_id='CLS-502'").run(); // 1 jam sebelum clock
  const r = await fin(bunga, 'CLS-502');
  assert.equal(r.status, 200, r.text);
});

test('kunci finalizing yang masih baru -> 409 FINALIZATION_IN_PROGRESS', async () => {
  s.db.prepare("UPDATE grades SET status='finalizing', updated_at='2026-10-23T04:59:50.000Z' WHERE class_id='CLS-502'").run();
  const r = await fin(bunga, 'CLS-502');
  assert.equal(r.status, 409);
});

test('finalisasi menolak body tidak dikenal; body kosong/{} diterima', async () => {
  const bad = await s.api('POST', '/kelas/CLS-502/finalisasi', { token: bunga.token, device: bunga.device, body: { status: 'final' } });
  assert.equal(bad.status, 400);
  assert.equal(s.grade('GRD-502-001').status, 'draft');
  const ok = await s.api('POST', '/kelas/CLS-502/finalisasi', { token: bunga.token, device: bunga.device, body: {} });
  assert.equal(ok.status, 200);
});
