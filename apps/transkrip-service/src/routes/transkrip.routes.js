'use strict';
const express = require('express');
const { E, schemas, parse, nimParam } = require('../../../../packages/shared');
const {
  requireUserToken, requireServiceToken, loadActiveUser, requireRole,
} = require('../../../../packages/security');

function createTranskripRoutes({ authenticate, db, repo, clock }) {
  const router = express.Router();
  const userChain = [authenticate, requireUserToken, loadActiveUser(db)];

  // Direktori NIM untuk admin (read-only; admin memang berhak membaca transkrip semua mahasiswa).
  router.get('/transkrip', userChain, requireRole('admin'), (_req, res) => res.json({ data: repo.directory() }));

  router.get('/transkrip/:nim', userChain, (req, res) => {
    const nim = parse(nimParam, req.params.nim, 'NIM');
    const { user } = req;
    // Pemeriksaan kepemilikan diulang di service: mahasiswa hanya NIM miliknya (dari DB), admin semua NIM, role lain ditolak.
    if (user.role === 'mahasiswa') { if (user.nim !== nim) throw E.forbidden('NIM_NOT_OWNED'); } else if (user.role !== 'admin') throw E.forbidden('ROLE_NOT_ALLOWED');
    const student = repo.findStudentByNim(nim);
    if (!student) throw E.notFound('STUDENT_NOT_FOUND');
    res.json({ data: { nim: student.nim, student_name: student.full_name, entries: repo.listPublished(student.id) } });
  });

  // Hanya token service (role=service, sub=service-nilai). Token user valid sekalipun ditolak 403.
  router.post('/transkrip/sinkron', authenticate, requireServiceToken, (req, res) => {
    const body = parse(schemas.sync, req.body, 'Body');
    const key = req.get('idempotency-key');
    if (key !== undefined && key !== `grade:${body.grade_id}:v${body.version}`) throw E.validation('Idempotency-Key tidak sesuai payload.');
    const result = repo.syncEntry(body, clock.now().toISOString());
    res.status(result.created ? 201 : 200).json({ data: { grade_id: body.grade_id, version: body.version, ...result } });
  });

  return router;
}

module.exports = { createTranskripRoutes };
