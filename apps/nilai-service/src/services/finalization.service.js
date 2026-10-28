'use strict';
const { E, isWithinAccessWindow } = require('../../../../packages/shared');

/**
 * Finalisasi kelas (PRD 5.4, FR-GRADE-03/05). Konsistensi lintas-service yang BENAR-BENAR diimplementasikan:
 *   A. transaksi lokal: kunci nilai (draft/sync_failed -> finalizing)
 *   B. sinkron tiap nilai ke Service Transkrip LEWAT GATEWAY (token service) -> entri 'pending' (idempoten)
 *   C. bila semua sukses: transaksi lokal -> nilai 'final' + entri transkrip 'published'
 *   Bila ada yang gagal: nilai -> 'sync_failed' (dapat dicoba ulang), entri pending tidak terlihat, respons 502.
 * Tidak ada transaksi atomik lintas HTTP; idempotensi (grade_id+version) membuat retry aman.
 */
function createFinalizationService({ repo, gateway, clock, config, logger }) {
  return {
    async finalizeClass({ classId, user, requestId }) {
      const cls = repo.getClass(classId);
      if (!cls) throw E.notFound('CLASS_NOT_FOUND');
      if (cls.lecturer_id !== user.id) throw E.classNotOwned(); // verifikasi ulang kepemilikan di service
      if (!isWithinAccessWindow(clock.now(), config.accessWindow)) throw E.outOfAccessHours();

      const now = clock.now();
      const targets = repo.lockForFinalization({
        classId, nowIso: now.toISOString(), cutoffIso: new Date(now.getTime() - config.finalizeLockTimeoutMs).toISOString(),
      });

      const synced = [];
      try {
        for (const t of targets) {
          await gateway.syncGrade({
            grade_id: t.id, student_nim: t.student_nim, class_id: t.class_id, score: t.score, term: t.term, version: t.version,
          });
          synced.push(t.id);
        }
      } catch (err) {
        repo.markSyncFailed(targets.map((t) => t.id), clock.now().toISOString());
        logger.error('finalization_sync_failed', {
          request_id: requestId, class_id: classId, synced_before_failure: synced.length, total: targets.length,
          upstream_status: err.status, reason: err.message,
        });
        throw E.upstream('Sinkronisasi transkrip gagal; finalisasi belum selesai. Nilai ditandai sync_failed dan dapat dicoba ulang.', {
          class_id: classId, retryable: true, synced_before_failure: synced.length, total: targets.length,
        });
      }

      try {
        repo.commitFinalization(targets, clock.now().toISOString());
      } catch (err) {
        repo.markSyncFailed(targets.map((t) => t.id), clock.now().toISOString());
        logger.error('finalization_commit_failed', { request_id: requestId, class_id: classId, reason: err.message });
        throw err.status ? err : E.internal();
      }

      return {
        class_id: classId,
        status: 'final',
        transcript_sync: 'success',
        finalized: targets.map((t) => ({ grade_id: t.id, student_nim: t.student_nim, score: t.score, version: t.version })),
      };
    },
  };
}

module.exports = { createFinalizationService };
