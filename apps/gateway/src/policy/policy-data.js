'use strict';
// Atribut kebijakan dibaca dari DATABASE (bukan hanya klaim token): kepemilikan kelas, NIM, status nilai, device.
function createPolicyData(db) {
  const q = {
    userById: db.prepare('SELECT id, username, role, nim, is_active FROM users WHERE id = ?'),
    deviceByDeviceId: db.prepare('SELECT id, user_id, device_id, is_active FROM devices WHERE device_id = ?'),
    touchDevice: db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?'),
    gradeWithClass: db.prepare(`SELECT g.id, g.class_id, g.status, c.lecturer_id
      FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?`),
    classById: db.prepare('SELECT id, lecturer_id FROM classes WHERE id = ?'),
    classSummary: db.prepare(`SELECT
        (SELECT COUNT(*) FROM enrollments WHERE class_id = @c) AS enrolled,
        (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = @c
           AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.class_id = e.class_id AND g.student_id = e.student_id)) AS missing_grades,
        (SELECT COUNT(*) FROM grades WHERE class_id = @c AND status IN ('draft','sync_failed')) AS finalizable,
        (SELECT COUNT(*) FROM grades WHERE class_id = @c AND status = 'finalizing') AS finalizing`),
    studentByNim: db.prepare("SELECT id, nim FROM users WHERE nim = ? AND role = 'mahasiswa' AND is_active = 1"),
    serviceClient: db.prepare('SELECT client_id, is_active FROM service_clients WHERE client_id = ?'),
  };
  return {
    getUser: (id) => q.userById.get(id),
    getDevice: (deviceId) => q.deviceByDeviceId.get(deviceId),
    touchDevice: (id, iso) => q.touchDevice.run(iso, id),
    getGradeWithClass: (id) => q.gradeWithClass.get(id),
    getClass: (id) => q.classById.get(id),
    getClassSummary: (classId) => q.classSummary.get({ c: classId }),
    getStudentByNim: (nim) => q.studentByNim.get(nim),
    getServiceClient: (id) => q.serviceClient.get(id),
  };
}
module.exports = { createPolicyData };
