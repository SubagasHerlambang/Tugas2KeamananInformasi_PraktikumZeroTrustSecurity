'use strict';
const { hashPasswordSync } = require('../security/password');

// SEMUA DATA FIKTIF - hanya untuk demo/praktikum lokal (PRD 10.4, AS-10).
const USERS = [
  { id: 'USR-ADMIN-01', username: 'admin.demo', full_name: 'Admin Demo', role: 'admin', nim: null, device: 'DEV-ADMIN-001' },
  { id: 'USR-DOSEN-01', username: 'dosen.andi', full_name: 'Andi Pratama (Dosen)', role: 'dosen', nim: null, device: 'DEV-DOSEN-001' },
  { id: 'USR-DOSEN-02', username: 'dosen.bunga', full_name: 'Bunga Lestari (Dosen)', role: 'dosen', nim: null, device: 'DEV-DOSEN-002' },
  { id: 'USR-MHS-001', username: 'mhs.001', full_name: 'Mahasiswa Satu', role: 'mahasiswa', nim: '247006110001', device: 'DEV-MHS-001' },
  { id: 'USR-MHS-002', username: 'mhs.002', full_name: 'Mahasiswa Dua', role: 'mahasiswa', nim: '247006110002', device: 'DEV-MHS-002' },
  { id: 'USR-MHS-003', username: 'mhs.003', full_name: 'Mahasiswa Tiga', role: 'mahasiswa', nim: '247006110003', device: 'DEV-MHS-003' },
];
const CLASSES = [
  { id: 'CLS-501', course_code: 'IF-501', course_name: 'Keamanan Informasi', lecturer: 'USR-DOSEN-01', term: '2026-GANJIL' },
  { id: 'CLS-502', course_code: 'IF-502', course_name: 'Rekayasa Perangkat Lunak', lecturer: 'USR-DOSEN-02', term: '2026-GANJIL' },
];
// [grade_id, class, student, score, status]
const GRADES = [
  ['GRD-501-001', 'CLS-501', 'USR-MHS-001', 82, 'draft'],
  ['GRD-501-002', 'CLS-501', 'USR-MHS-002', 76, 'draft'],
  ['GRD-501-003', 'CLS-501', 'USR-MHS-003', 90, 'final'],
  ['GRD-502-001', 'CLS-502', 'USR-MHS-001', 88, 'draft'],
  ['GRD-502-002', 'CLS-502', 'USR-MHS-002', 80, 'draft'],
  ['GRD-502-003', 'CLS-502', 'USR-MHS-003', 85, 'draft'],
];

/**
 * Seed idempoten (INSERT OR IGNORE): aman dijalankan berulang. Untuk mengganti password seed gunakan `npm run db:reset`.
 */
function seed(db, { demoPassword, serviceClientId, serviceClientSecret, bcryptCost = 10, now = new Date() }) {
  if (!demoPassword || demoPassword.length < 8) throw new Error('SEED_DEMO_PASSWORD wajib diisi (minimal 8 karakter)');
  if (!serviceClientSecret) throw new Error('SERVICE_NILAI_CLIENT_SECRET wajib diisi');
  const ts = now.toISOString();
  const pwHash = hashPasswordSync(demoPassword, bcryptCost);
  const clientHash = hashPasswordSync(serviceClientSecret, bcryptCost);

  const tx = db.transaction(() => {
    const insUser = db.prepare('INSERT OR IGNORE INTO users(id, username, password_hash, full_name, role, nim, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)');
    const insDev = db.prepare('INSERT OR IGNORE INTO devices(user_id, device_id, is_active, created_at) VALUES (?,?,1,?)');
    for (const u of USERS) {
      insUser.run(u.id, u.username, pwHash, u.full_name, u.role, u.nim, ts);
      insDev.run(u.id, u.device, ts);
    }
    db.prepare('INSERT OR IGNORE INTO service_clients(client_id, secret_hash, is_active, created_at) VALUES (?,?,1,?)').run(serviceClientId, clientHash, ts);

    const insClass = db.prepare('INSERT OR IGNORE INTO classes(id, course_code, course_name, lecturer_id, term) VALUES (?,?,?,?,?)');
    for (const c of CLASSES) insClass.run(c.id, c.course_code, c.course_name, c.lecturer, c.term);

    const insEnr = db.prepare('INSERT OR IGNORE INTO enrollments(class_id, student_id) VALUES (?,?)');
    for (const c of CLASSES) for (const u of USERS.filter((x) => x.role === 'mahasiswa')) insEnr.run(c.id, u.id);

    const insGrade = db.prepare(`INSERT OR IGNORE INTO grades(id, class_id, student_id, score, status, updated_by, finalized_at, version, updated_at)
      VALUES (?,?,?,?,?,?,?,1,?)`);
    const insTr = db.prepare(`INSERT OR IGNORE INTO transcript_entries(id, class_id, student_id, grade_id, score, term, version, sync_status, synced_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,1,'published',?,?,?)`);
    for (const [id, cls, student, score, status] of GRADES) {
      const lecturer = CLASSES.find((c) => c.id === cls).lecturer;
      insGrade.run(id, cls, student, score, status, lecturer, status === 'final' ? ts : null, ts);
      if (status === 'final') { // nilai final contoh harus punya entri transkrip published agar konsisten
        insTr.run(`TRX-${id}`, cls, student, id, score, CLASSES.find((c) => c.id === cls).term, ts, ts, ts);
      }
    }
  });
  tx();
  return summary(db);
}

function summary(db) {
  const n = (sql) => db.prepare(sql).get().n;
  return {
    admins: n("SELECT COUNT(*) n FROM users WHERE role='admin'"),
    dosen: n("SELECT COUNT(*) n FROM users WHERE role='dosen'"),
    mahasiswa: n("SELECT COUNT(*) n FROM users WHERE role='mahasiswa'"),
    devices: n('SELECT COUNT(*) n FROM devices WHERE is_active=1'),
    classes: n('SELECT COUNT(*) n FROM classes'),
    distinct_lecturers: n('SELECT COUNT(DISTINCT lecturer_id) n FROM classes'),
    enrollments: n('SELECT COUNT(*) n FROM enrollments'),
    grades: n('SELECT COUNT(*) n FROM grades'),
    transcript_published: n("SELECT COUNT(*) n FROM transcript_entries WHERE sync_status='published'"),
    service_clients: n('SELECT COUNT(*) n FROM service_clients'),
  };
}

module.exports = { seed, summary, USERS, CLASSES, GRADES };
