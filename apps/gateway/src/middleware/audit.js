'use strict';
const { sanitizeDeviceId } = require('./device-context');

/**
 * Audit log keputusan akses (PRD 14). Ditulis ke tabel audit_logs oleh gateway.
 * Tidak pernah menerima header Authorization / token / password / secret: hanya field yang dipilih secara eksplisit.
 */
function createAuditLogger(db, clock, logger) {
  const insert = db.prepare(`INSERT INTO audit_logs
    (timestamp, subject_sub, subject_type, endpoint, device_id, result, reason_code, request_id, method, status_code, ip)
    VALUES (@timestamp, @subject_sub, @subject_type, @endpoint, @device_id, @result, @reason_code, @request_id, @method, @status_code, @ip)`);
  const setStatus = db.prepare('UPDATE audit_logs SET status_code = ? WHERE id = ? AND status_code IS NULL');

  function toRow(e) {
    return {
      timestamp: clock.now().toISOString(),
      subject_sub: e.subject?.sub || 'unknown',
      subject_type: e.subject?.type || 'anonymous',
      endpoint: String(e.endpoint || '').split('?')[0].slice(0, 200),
      device_id: sanitizeDeviceId(e.deviceId),
      result: e.result,
      reason_code: e.reasonCode,
      request_id: e.requestId || null,
      method: e.method || null,
      status_code: e.statusCode ?? null,
      ip: e.ip || null,
    };
  }

  return {
    /** Tulis event; melempar bila gagal (dipakai fail-closed untuk keputusan ALLOW). Mengembalikan id baris. */
    recordStrict(event) { return Number(insert.run(toRow(event)).lastInsertRowid); },
    /** Untuk keputusan DENY: kegagalan audit tidak boleh mengubah deny menjadi allow; cukup dicatat ke log runtime. */
    recordBestEffort(event) {
      try { return Number(insert.run(toRow(event)).lastInsertRowid); } catch (err) {
        logger.error('audit_write_failed', { request_id: event.requestId, error: err.message });
        return null;
      }
    },
    setStatusCode(id, status) {
      if (!id) return;
      try { setStatus.run(status, id); } catch (err) { logger.error('audit_status_update_failed', { error: err.message }); }
    },
  };
}

module.exports = { createAuditLogger };
