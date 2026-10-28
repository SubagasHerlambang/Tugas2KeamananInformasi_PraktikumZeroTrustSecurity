'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, migrate, seed, summary, MIGRATIONS } = require('../../packages/database');

function fresh() {
  const db = openDatabase(':memory:');
  migrate(db);
  seed(db, { demoPassword: 'Demo-pass-1', serviceClientId: 'service-nilai', serviceClientSecret: 'secretsecretsecret1', bcryptCost: 4 });
  return db;
}
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));

test('AC-02 seed minimum: 1 admin, 2 dosen, 3 mahasiswa, 2 kelas beda dosen, 1 device aktif per user', () => {
  const db = fresh();
  const s = summary(db);
  assert.equal(s.admins, 1); assert.equal(s.dosen, 2); assert.equal(s.mahasiswa, 3);
  assert.equal(s.classes, 2); assert.equal(s.distinct_lecturers, 2); assert.equal(s.devices, 6);
  const perUser = db.prepare('SELECT COUNT(*) n FROM (SELECT user_id FROM devices WHERE is_active=1 GROUP BY user_id HAVING COUNT(*)=1)').get().n;
  assert.equal(perUser, 6);
  assert.equal(s.service_clients, 1);
});
test('seed idempoten: dijalankan dua kali tidak menggandakan data', () => {
  const db = fresh();
  const before = summary(db);
  seed(db, { demoPassword: 'Demo-pass-1', serviceClientId: 'service-nilai', serviceClientSecret: 'secretsecretsecret1', bcryptCost: 4 });
  assert.deepEqual(summary(db), before);
});
test('seed data sesuai PRD: nilai draft/final dan entri transkrip published untuk nilai final', () => {
  const db = fresh();
  const g = (id) => db.prepare('SELECT score, status FROM grades WHERE id=?').get(id);
  assert.deepEqual(g('GRD-501-001'), { score: 82, status: 'draft' });
  assert.deepEqual(g('GRD-501-002'), { score: 76, status: 'draft' });
  assert.deepEqual(g('GRD-501-003'), { score: 90, status: 'final' });
  assert.deepEqual(g('GRD-502-003'), { score: 85, status: 'draft' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transcript_entries WHERE grade_id='GRD-501-003' AND sync_status='published'").get().n, 1);
});
test('NFR-SEC-02 password & client secret tersimpan sebagai hash bcrypt, bukan plaintext', () => {
  const db = fresh();
  for (const h of db.prepare('SELECT password_hash h FROM users').all().map((r) => r.h)) assert.match(h, /^\$2[aby]\$/);
  assert.match(db.prepare('SELECT secret_hash h FROM service_clients').get().h, /^\$2[aby]\$/);
  const dump = JSON.stringify(db.prepare('SELECT * FROM users').all());
  assert.ok(!dump.includes('Demo-pass-1'));
});
test('foreign key ditegakkan', () => {
  const db = fresh();
  throwsMsg(() => db.prepare("INSERT INTO devices(user_id, device_id) VALUES ('TIDAK-ADA','DEV-X')").run(), /FOREIGN KEY/);
});
test('constraint unik: username, device_id, (class_id, student_id) pada enrollments & grades, NIM', () => {
  const db = fresh();
  throwsMsg(() => db.prepare("INSERT INTO users(id,username,password_hash,full_name,role) VALUES ('U9','admin.demo','h','x','admin')").run(), /UNIQUE/);
  throwsMsg(() => db.prepare("INSERT INTO devices(user_id,device_id) VALUES ('USR-ADMIN-01','DEV-MHS-001')").run(), /UNIQUE/);
  throwsMsg(() => db.prepare("INSERT INTO enrollments(class_id,student_id) VALUES ('CLS-501','USR-MHS-001')").run(), /UNIQUE/);
  throwsMsg(() => db.prepare("INSERT INTO grades(id,class_id,student_id,score) VALUES ('DUP','CLS-501','USR-MHS-001',50)").run(), /UNIQUE/);
  throwsMsg(() => db.prepare("INSERT INTO users(id,username,password_hash,full_name,role,nim) VALUES ('U9','m9','h','x','mahasiswa','247006110001')").run(), /UNIQUE/);
});
test('integritas: mahasiswa wajib NIM; skor 0..100; status dibatasi; kelas harus diampu dosen; peserta harus mahasiswa', () => {
  const db = fresh();
  throwsMsg(() => db.prepare("INSERT INTO users(id,username,password_hash,full_name,role) VALUES ('U9','m9','h','x','mahasiswa')").run(), /CHECK/);
  throwsMsg(() => db.prepare("UPDATE grades SET score = 101 WHERE id='GRD-501-001'").run(), /CHECK/);
  throwsMsg(() => db.prepare("UPDATE grades SET score = -1 WHERE id='GRD-501-001'").run(), /CHECK/);
  throwsMsg(() => db.prepare("UPDATE grades SET status = 'lain' WHERE id='GRD-501-001'").run(), /CHECK/);
  throwsMsg(() => db.prepare("INSERT INTO classes(id,course_code,course_name,lecturer_id,term) VALUES ('C9','X','Y','USR-MHS-001','T')").run(), /dosen/);
  throwsMsg(() => db.prepare("INSERT INTO enrollments(class_id,student_id) VALUES ('CLS-501','USR-DOSEN-02')").run(), /mahasiswa/);
  throwsMsg(() => db.prepare("UPDATE users SET role='superuser' WHERE id='USR-MHS-001'").run(), /CHECK/);
});
test('nilai hanya untuk mahasiswa yang terdaftar pada kelas', () => {
  const db = fresh();
  db.exec("INSERT INTO users(id,username,password_hash,full_name,role,nim) VALUES ('USR-N','mhs.n','h','N','mahasiswa','247006118888')");
  throwsMsg(() => db.prepare("INSERT INTO grades(id,class_id,student_id,score) VALUES ('G9','CLS-501','USR-N',50)").run(), /terdaftar/);
});
test('grade final wajib punya finalized_at (dan sebaliknya); transcript published wajib synced_at', () => {
  const db = fresh();
  throwsMsg(() => db.prepare("UPDATE grades SET status='final' WHERE id='GRD-501-001'").run(), /CHECK/);
  throwsMsg(() => db.prepare("UPDATE transcript_entries SET sync_status='pending' WHERE grade_id='GRD-501-003'").run(), /CHECK/);
});
test('transcript_entries.grade_id unik (satu entri per nilai -> retry tidak menggandakan)', () => {
  const db = fresh();
  throwsMsg(() => db.prepare(`INSERT INTO transcript_entries(id,class_id,student_id,grade_id,score,term,version,sync_status,created_at,updated_at)
    VALUES ('T9','CLS-501','USR-MHS-003','GRD-501-003',90,'2026-GANJIL',1,'pending','x','x')`).run(), /UNIQUE/);
});
test('audit_logs append-only: DELETE ditolak; UPDATE kolom selain status_code ditolak; status_code hanya bisa diisi sekali', () => {
  const db = fresh();
  const id = db.prepare(`INSERT INTO audit_logs(timestamp,subject_sub,subject_type,endpoint,result,reason_code) VALUES ('t','s','user','/x','allow','R')`).run().lastInsertRowid;
  throwsMsg(() => db.prepare('DELETE FROM audit_logs WHERE id=?').run(id), /append-only/);
  throwsMsg(() => db.prepare("UPDATE audit_logs SET result='deny' WHERE id=?").run(id), /append-only/);
  throwsMsg(() => db.prepare("UPDATE audit_logs SET reason_code='X', status_code=200 WHERE id=?").run(id), /append-only/);
  db.prepare('UPDATE audit_logs SET status_code=200 WHERE id=?').run(id);
  throwsMsg(() => db.prepare('UPDATE audit_logs SET status_code=500 WHERE id=?').run(id), /append-only/);
  assert.equal(db.prepare('SELECT status_code s FROM audit_logs WHERE id=?').get(id).s, 200);
});
test('audit_logs: result dibatasi allow/deny dan subject_type user/service/anonymous', () => {
  const db = fresh();
  throwsMsg(() => db.prepare(`INSERT INTO audit_logs(timestamp,subject_sub,subject_type,endpoint,result,reason_code) VALUES ('t','s','user','/x','maybe','R')`).run(), /CHECK/);
  throwsMsg(() => db.prepare(`INSERT INTO audit_logs(timestamp,subject_sub,subject_type,endpoint,result,reason_code) VALUES ('t','s','alien','/x','allow','R')`).run(), /CHECK/);
});
test('migrasi: schema_migrations tercatat dan migrate() idempoten', () => {
  const db = fresh();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, MIGRATIONS.length);
  assert.deepEqual(migrate(db), []);
});
test('indeks wajib PRD tersedia', () => {
  const db = fresh();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name).join(' ');
  for (const n of ['idx_users_nim', 'idx_classes_lecturer', 'idx_enrollments_class_student', 'idx_grades_class_student', 'idx_audit_ts_sub_result']) assert.ok(names.includes(n), n);
});
