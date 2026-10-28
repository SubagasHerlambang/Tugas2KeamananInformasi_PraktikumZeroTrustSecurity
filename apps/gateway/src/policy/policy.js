'use strict';
const { E, isWithinAccessWindow, SERVICE_NILAI_SUB, GRADE_STATUS, idParam, nimParam } = require('../../../../packages/shared');

/**
 * Policy Engine (PE). Mengembalikan keputusan TERSTRUKTUR, bukan boolean:
 *   { decision: 'allow' | 'deny', reasonCode, error? }
 * Default deny: route yang tidak punya aturan eksplisit ditolak.
 */
const allow = (reasonCode = 'POLICY_ALLOW') => ({ decision: 'allow', reasonCode });
const deny = (error) => ({ decision: 'deny', reasonCode: error.reasonCode, error });

function createPolicyEngine({ data, clock, config }) {
  const inWindow = () => isWithinAccessWindow(clock.now(), config.accessWindow);

  const rules = {
    'nilai.list': ({ user }) => (['mahasiswa', 'dosen'].includes(user.role) ? allow() : deny(E.forbidden('ROLE_NOT_ALLOWED'))),

    'nilai.update': ({ user, params }) => {
      if (user.role !== 'dosen') return deny(E.forbidden('ROLE_NOT_ALLOWED'));
      if (!idParam.safeParse(params.id).success) return deny(E.validation('ID nilai tidak valid.'));
      const grade = data.getGradeWithClass(params.id);
      if (!grade) return deny(E.notFound('GRADE_NOT_FOUND'));
      if (grade.lecturer_id !== user.id) return deny(E.classNotOwned());
      if (!inWindow()) return deny(E.outOfAccessHours());
      if (grade.status === GRADE_STATUS.FINAL) return deny(E.gradeFinal());
      if (grade.status === GRADE_STATUS.FINALIZING) return deny(E.conflict('FINALIZATION_IN_PROGRESS', 'Kelas sedang difinalisasi.'));
      return allow();
    },

    'kelas.finalisasi': ({ user, params }) => {
      if (user.role !== 'dosen') return deny(E.forbidden('ROLE_NOT_ALLOWED'));
      if (!idParam.safeParse(params.id).success) return deny(E.validation('ID kelas tidak valid.'));
      const cls = data.getClass(params.id);
      if (!cls) return deny(E.notFound('CLASS_NOT_FOUND'));
      if (cls.lecturer_id !== user.id) return deny(E.classNotOwned());
      if (!inWindow()) return deny(E.outOfAccessHours());
      const s = data.getClassSummary(cls.id);
      if (s.enrolled === 0 || s.missing_grades > 0) {
        return deny(E.business('CLASS_INCOMPLETE', 'Nilai kelas belum lengkap: ada mahasiswa terdaftar tanpa nilai.'));
      }
      if (s.finalizable === 0 && s.finalizing === 0) return deny(E.gradeFinal());
      return allow(); // kasus 'finalizing' ditangani atomik (kunci) oleh Service Nilai
    },

    'transkrip.list': ({ user }) => (user.role === 'admin' ? allow() : deny(E.forbidden('ROLE_NOT_ALLOWED'))),

    'transkrip.get': ({ user, params }) => {
      if (!nimParam.safeParse(params.nim).success) return deny(E.validation('Format NIM tidak valid.'));
      if (user.role === 'mahasiswa') {
        // kepemilikan diputuskan dari DB (users.nim milik subjek token), bukan dari klaim/ID kiriman client
        return user.nim && user.nim === params.nim ? allow() : deny(E.forbidden('NIM_NOT_OWNED'));
      }
      if (user.role === 'admin') {
        return data.getStudentByNim(params.nim) ? allow() : deny(E.notFound('STUDENT_NOT_FOUND'));
      }
      return deny(E.forbidden('ROLE_NOT_ALLOWED'));
    },

    'transkrip.sinkron': ({ identity }) => {
      if (identity.kind !== 'service') return deny(E.serviceTokenRequired());
      const client = data.getServiceClient(identity.claims.sub);
      if (identity.claims.sub !== SERVICE_NILAI_SUB || !client || !client.is_active) return deny(E.forbidden('SERVICE_CLIENT_INACTIVE'));
      return allow();
    },
  };

  return {
    evaluate(ctx) {
      const rule = rules[ctx.route.name];
      if (!rule) return deny(E.forbidden('NO_EXPLICIT_POLICY')); // default deny
      return rule(ctx);
    },
  };
}

module.exports = { createPolicyEngine };
