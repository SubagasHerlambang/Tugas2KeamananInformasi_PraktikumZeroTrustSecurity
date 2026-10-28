'use strict';
const { E, TRANSCRIPT_STATUS } = require('../../../../packages/shared');

function createTranscriptRepo(db) {
  const q = {
    student: db.prepare("SELECT id, nim, full_name FROM users WHERE nim = ? AND role = 'mahasiswa' AND is_active = 1"),
    entries: db.prepare(`SELECT t.grade_id, t.class_id, c.course_code, c.course_name, t.term, t.score, t.synced_at
      FROM transcript_entries t JOIN classes c ON c.id = t.class_id
      WHERE t.student_id = ? AND t.sync_status = 'published' ORDER BY t.term, c.course_code`),
    directory: db.prepare(`SELECT u.nim, u.full_name,
        COUNT(CASE WHEN t.sync_status = 'published' THEN 1 END) AS published_entries
      FROM users u LEFT JOIN transcript_entries t ON t.student_id = u.id
      WHERE u.role = 'mahasiswa' AND u.is_active = 1 GROUP BY u.id ORDER BY u.nim`),
    gradeForSync: db.prepare(`SELECT g.id, g.class_id, g.student_id, g.score, g.version, u.nim, c.term
      FROM grades g JOIN users u ON u.id = g.student_id JOIN classes c ON c.id = g.class_id WHERE g.id = ?`),
    entryByGrade: db.prepare('SELECT * FROM transcript_entries WHERE grade_id = ?'),
    insert: db.prepare(`INSERT INTO transcript_entries(id, class_id, student_id, grade_id, score, term, version, sync_status, synced_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,'pending',NULL,?,?)`),
    updatePending: db.prepare(`UPDATE transcript_entries SET score = ?, term = ?, version = ?, updated_at = ?
      WHERE grade_id = ? AND sync_status = 'pending'`),
  };

  return {
    findStudentByNim: (nim) => q.student.get(nim),
    // HANYA entri published yang terlihat; pending tidak pernah muncul pada pembacaan transkrip.
    listPublished: (studentId) => q.entries.all(studentId),
    directory: () => q.directory.all(),

    /** Upsert idempoten berbasis (grade_id, version). Payload diverifikasi terhadap data nilai di DB (sumber kebenaran). */
    syncEntry(p, nowIso) {
      return db.transaction(() => {
        const g = q.gradeForSync.get(p.grade_id);
        if (!g) throw E.notFound('GRADE_NOT_FOUND');
        if (g.class_id !== p.class_id || g.nim !== p.student_nim || g.term !== p.term) {
          throw E.business('SYNC_PAYLOAD_MISMATCH', 'Payload sinkronisasi tidak cocok dengan data nilai.');
        }
        if (g.score !== p.score || g.version !== p.version) throw E.conflict('SYNC_VERSION_STALE', 'Versi/skor payload tidak sesuai nilai saat ini.');
        const existing = q.entryByGrade.get(p.grade_id);
        if (!existing) {
          q.insert.run(`TRX-${p.grade_id}`, g.class_id, g.student_id, g.id, p.score, p.term, p.version, nowIso, nowIso);
          return { created: true, idempotent: false, sync_status: TRANSCRIPT_STATUS.PENDING };
        }
        if (existing.version === p.version) return { created: false, idempotent: true, sync_status: existing.sync_status };
        if (existing.sync_status === TRANSCRIPT_STATUS.PUBLISHED) throw E.conflict('TRANSCRIPT_PUBLISHED_IMMUTABLE', 'Entri transkrip yang sudah published tidak dapat diubah.');
        q.updatePending.run(p.score, p.term, p.version, nowIso, p.grade_id);
        return { created: false, idempotent: false, sync_status: TRANSCRIPT_STATUS.PENDING };
      }).immediate();
    },
  };
}

module.exports = { createTranscriptRepo };
