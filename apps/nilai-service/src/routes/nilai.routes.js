'use strict';
const express = require('express');
const {
  E, schemas, parse, idParam, isWithinAccessWindow, accessWindowInfo, GRADE_STATUS,
} = require('../../../../packages/shared');
const {
  requireUserToken, loadActiveUser, requireRole, asyncRoute,
} = require('../../../../packages/security');

// Mahasiswa hanya perlu tahu draft/final; status internal (finalizing/sync_failed) tidak ditampilkan kepadanya.
const publicStatus = (row, role) => (role === 'mahasiswa' && row.status !== GRADE_STATUS.FINAL ? GRADE_STATUS.DRAFT : row.status);
const present = (row, role) => ({
  id: row.id, class_id: row.class_id, course_code: row.course_code, course_name: row.course_name, term: row.term,
  student_nim: row.student_nim, student_name: row.student_name, score: row.score, status: publicStatus(row, role),
  version: row.version, finalized_at: row.finalized_at,
});

function createNilaiRoutes({ authenticate, db, repo, finalization, clock, config }) {
  const router = express.Router();
  const userChain = [authenticate, requireUserToken, loadActiveUser(db)];

  // GET /nilai: filter di level query DB (student_id / lecturer_id berasal dari token + DB), bukan dari input client.
  router.get('/nilai', userChain, requireRole('mahasiswa', 'dosen'), (req, res) => {
    const rows = req.user.role === 'mahasiswa' ? repo.listForStudent(req.user.id) : repo.listForLecturer(req.user.id);
    res.json({ data: rows.map((r) => present(r, req.user.role)), meta: { access_window: accessWindowInfo(clock.now(), config.accessWindow) } });
  });

  router.put('/nilai/:id', userChain, requireRole('dosen'), asyncRoute(async (req, res) => {
    const id = parse(idParam, req.params.id, 'ID nilai');
    const body = parse(schemas.updateScore, req.body, 'Body');
    const grade = repo.getGrade(id);
    if (!grade) throw E.notFound('GRADE_NOT_FOUND');
    if (grade.lecturer_id !== req.user.id) throw E.classNotOwned();
    if (!isWithinAccessWindow(clock.now(), config.accessWindow)) throw E.outOfAccessHours();
    const updated = repo.updateScore({ id, score: body.score, userId: req.user.id, nowIso: clock.now().toISOString() });
    res.json({ data: present(updated, 'dosen') });
  }));

  router.post('/kelas/:id/finalisasi', userChain, requireRole('dosen'), asyncRoute(async (req, res) => {
    const classId = parse(idParam, req.params.id, 'ID kelas');
    parse(schemas.finalizeBody, req.body, 'Body');
    const result = await finalization.finalizeClass({ classId, user: req.user, requestId: req.id });
    res.json({ data: result });
  }));

  return router;
}

module.exports = { createNilaiRoutes };
