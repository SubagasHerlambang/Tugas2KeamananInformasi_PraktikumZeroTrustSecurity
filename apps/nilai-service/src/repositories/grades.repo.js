'use strict';
const { E, GRADE_STATUS } = require('../../../../packages/shared');

const BASE = `SELECT g.id, g.class_id, g.student_id, g.score, g.status, g.version, g.finalized_at, g.updated_at,
    c.course_code, c.course_name, c.term, c.lecturer_id, u.nim AS student_nim, u.full_name AS student_name
  FROM grades g JOIN classes c ON c.id = g.class_id JOIN users u ON u.id = g.student_id`;

/** Seluruh query memakai prepared statement + parameter terikat (tidak ada interpolasi string dari input). */
function createGradesRepo(db) {
  const q = {
    forStudent: db.prepare(`${BASE} WHERE g.student_id = ? ORDER BY c.course_code`),
    forLecturer: db.prepare(`${BASE} WHERE c.lecturer_id = ? ORDER BY c.course_code, u.nim`),
    byId: db.prepare(`${BASE} WHERE g.id = ?`),
    byClass: db.prepare(`${BASE} WHERE g.class_id = ? ORDER BY u.nim`),
    cls: db.prepare('SELECT id, course_code, course_name, lecturer_id, term FROM classes WHERE id = ?'),
    summary: db.prepare(`SELECT
        (SELECT COUNT(*) FROM enrollments WHERE class_id = @c) AS enrolled,
        (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = @c
           AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.class_id = e.class_id AND g.student_id = e.student_id)) AS missing_grades`),
    update: db.prepare(`UPDATE grades SET score = ?, version = version + 1, status = 'draft', updated_by = ?, updated_at = ?
      WHERE id = ? AND status IN ('draft','sync_failed')`),
    releaseStale: db.prepare(`UPDATE grades SET status = 'sync_failed', updated_at = ?
      WHERE class_id = ? AND status = 'finalizing' AND updated_at < ?`),
    markFinalizing: db.prepare(`UPDATE grades SET status = 'finalizing', updated_at = ? WHERE id = ? AND status IN ('draft','sync_failed')`),
    markFailed: db.prepare(`UPDATE grades SET status = 'sync_failed', updated_at = ? WHERE id = ? AND status = 'finalizing'`),
    markFinal: db.prepare(`UPDATE grades SET status = 'final', finalized_at = ?, updated_at = ?
      WHERE id = ? AND status = 'finalizing' AND version = ?`),
    publish: db.prepare(`UPDATE transcript_entries SET sync_status = 'published', synced_at = ?, updated_at = ?
      WHERE grade_id = ? AND version = ? AND sync_status = 'pending'`),
    publishedAlready: db.prepare(`SELECT 1 FROM transcript_entries WHERE grade_id = ? AND version = ? AND sync_status = 'published'`),
  };

  return {
    listForStudent: (id) => q.forStudent.all(id),
    listForLecturer: (id) => q.forLecturer.all(id),
    getGrade: (id) => q.byId.get(id),
    gradesOfClass: (id) => q.byClass.all(id),
    getClass: (id) => q.cls.get(id),
    classSummary: (id) => q.summary.get({ c: id }),

    /** Edit atomik: status dibaca & diubah dalam satu transaksi IMMEDIATE; nilai final/finalizing tidak pernah berubah. */
    updateScore({ id, score, userId, nowIso }) {
      return db.transaction(() => {
        const g = q.byId.get(id);
        if (!g) throw E.notFound('GRADE_NOT_FOUND');
        if (g.status === GRADE_STATUS.FINAL) throw E.gradeFinal();
        if (g.status === GRADE_STATUS.FINALIZING) throw E.conflict('FINALIZATION_IN_PROGRESS', 'Kelas sedang difinalisasi.');
        if (q.update.run(score, userId, nowIso, id).changes !== 1) throw E.conflict();
        return q.byId.get(id);
      }).immediate();
    },

    /** Transaksi A finalisasi: kunci nilai yang akan disinkronkan (status -> finalizing). */
    lockForFinalization({ classId, nowIso, cutoffIso }) {
      return db.transaction(() => {
        q.releaseStale.run(nowIso, classId, cutoffIso); // kunci basi (mis. proses mati) dilepas -> sync_failed (dapat dicoba ulang)
        const s = q.summary.get({ c: classId });
        if (s.enrolled === 0 || s.missing_grades > 0) throw E.business('CLASS_INCOMPLETE', 'Nilai kelas belum lengkap: ada mahasiswa terdaftar tanpa nilai.');
        const rows = q.byClass.all(classId);
        if (rows.some((r) => r.status === GRADE_STATUS.FINALIZING)) throw E.conflict('FINALIZATION_IN_PROGRESS', 'Finalisasi kelas ini sedang berjalan.');
        const targets = rows.filter((r) => r.status === GRADE_STATUS.DRAFT || r.status === GRADE_STATUS.SYNC_FAILED);
        if (targets.length === 0) throw E.gradeFinal();
        for (const t of targets) {
          if (q.markFinalizing.run(nowIso, t.id).changes !== 1) throw E.conflict();
        }
        return targets.map((t) => ({ ...t, status: GRADE_STATUS.FINALIZING }));
      }).immediate();
    },

    markSyncFailed(ids, nowIso) {
      db.transaction(() => { for (const id of ids) q.markFailed.run(nowIso, id); }).immediate();
    },

    /** Transaksi B: semua sinkronisasi sukses -> nilai final + entri transkrip published secara konsisten (atau tidak sama sekali). */
    commitFinalization(targets, nowIso) {
      db.transaction(() => {
        for (const t of targets) {
          if (q.markFinal.run(nowIso, nowIso, t.id, t.version).changes !== 1) throw E.conflict('FINALIZE_COMMIT_CONFLICT', 'Status nilai berubah saat finalisasi.');
          if (q.publish.run(nowIso, nowIso, t.id, t.version).changes !== 1 && !q.publishedAlready.get(t.id, t.version)) {
            throw E.conflict('FINALIZE_COMMIT_CONFLICT', 'Entri transkrip tidak ditemukan untuk versi nilai ini.');
          }
        }
      }).immediate();
    },
  };
}

module.exports = { createGradesRepo };
