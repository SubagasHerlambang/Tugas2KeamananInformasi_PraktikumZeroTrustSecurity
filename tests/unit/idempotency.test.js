'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, migrate, seed } = require('../../packages/database');
const { createTranscriptRepo } = require('../../apps/transkrip-service/src/repositories/transcript.repo');
const { createGradesRepo } = require('../../apps/nilai-service/src/repositories/grades.repo');

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  seed(db, { demoPassword: 'Demo-pass-1', serviceClientId: 'service-nilai', serviceClientSecret: 'secretsecretsecret1', bcryptCost: 4 });
  return { db, tr: createTranscriptRepo(db), gr: createGradesRepo(db) };
}
const P = (o = {}) => ({ grade_id: 'GRD-501-001', student_nim: '247006110001', class_id: 'CLS-501', score: 82, term: '2026-GANJIL', version: 1, ...o });
const NOW = '2026-10-23T05:00:00.000Z';

test('syncEntry: pertama membuat entri pending; ulang dengan payload sama idempoten (satu baris)', () => {
  const { db, tr } = setup();
  const a = tr.syncEntry(P(), NOW);
  assert.deepEqual([a.created, a.idempotent, a.sync_status], [true, false, 'pending']);
  for (let i = 0; i < 5; i += 1) { const r = tr.syncEntry(P(), NOW); assert.deepEqual([r.created, r.idempotent], [false, true]); }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE grade_id='GRD-501-001'").get().n, 1);
});
test('syncEntry: versi baru memperbarui entri pending yang sama (bukan menambah baris)', () => {
  const { db, tr } = setup();
  tr.syncEntry(P(), NOW);
  db.prepare("UPDATE grades SET score=90, version=2 WHERE id='GRD-501-001'").run();
  const r = tr.syncEntry(P({ score: 90, version: 2 }), NOW);
  assert.equal(r.idempotent, false);
  const row = db.prepare("SELECT score, version FROM transcript_entries WHERE grade_id='GRD-501-001'").get();
  assert.deepEqual(row, { score: 90, version: 2 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transcript_entries').get().n, 2); // 1 seed published + 1 pending
});
test('syncEntry: pending tidak masuk listPublished; published tidak dapat ditimpa versi lain', () => {
  const { db, tr } = setup();
  tr.syncEntry(P(), NOW);
  assert.equal(tr.listPublished('USR-MHS-001').length, 0);
  db.prepare("UPDATE grades SET score=95, version=2 WHERE id='GRD-501-003'").run();
  assert.throws(() => tr.syncEntry(P({ grade_id: 'GRD-501-003', student_nim: '247006110003', score: 95, version: 2 }), NOW), (e) => e.status === 409);
});
test('commitFinalization atomik: bila satu entri tidak cocok versi, TIDAK ADA nilai yang menjadi final (rollback)', () => {
  const { db, tr, gr } = setup();
  const t1 = { id: 'GRD-501-001', version: 1 }; const t2 = { id: 'GRD-501-002', version: 1 };
  tr.syncEntry(P(), NOW); // hanya entri 001 yang tersinkron; 002 tidak
  db.prepare("UPDATE grades SET status='finalizing' WHERE id IN ('GRD-501-001','GRD-501-002')").run();
  assert.throws(() => gr.commitFinalization([t1, t2], NOW), (e) => e.status === 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM grades WHERE status='final'").get().n, 1); // hanya seed 501-003
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE sync_status='published'").get().n, 1);
});
test('commitFinalization sukses: nilai final + entri published bersama-sama', () => {
  const { db, tr, gr } = setup();
  tr.syncEntry(P(), NOW);
  db.prepare("UPDATE grades SET status='finalizing' WHERE id='GRD-501-001'").run();
  gr.commitFinalization([{ id: 'GRD-501-001', version: 1 }], NOW);
  assert.equal(db.prepare("SELECT status FROM grades WHERE id='GRD-501-001'").get().status, 'final');
  assert.equal(db.prepare("SELECT sync_status FROM transcript_entries WHERE grade_id='GRD-501-001'").get().sync_status, 'published');
});
test('updateScore tidak dapat mengubah nilai final / finalizing (guard atomik di repository)', () => {
  const { db, gr } = setup();
  assert.throws(() => gr.updateScore({ id: 'GRD-501-003', score: 1, userId: 'USR-DOSEN-01', nowIso: NOW }), (e) => e.code === 'GRADE_FINAL');
  db.prepare("UPDATE grades SET status='finalizing' WHERE id='GRD-501-001'").run();
  assert.throws(() => gr.updateScore({ id: 'GRD-501-001', score: 1, userId: 'USR-DOSEN-01', nowIso: NOW }), (e) => e.status === 409);
  assert.equal(db.prepare("SELECT score FROM grades WHERE id='GRD-501-003'").get().score, 90);
});
