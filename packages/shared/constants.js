'use strict';
// Konstanta tunggal yang dipakai gateway dan kedua service (hindari duplikasi definisi).
const USER_ROLES = Object.freeze(['admin', 'dosen', 'mahasiswa']);
const SERVICE_ROLE = 'service';
const SCORE_MIN = 0; // ASUMSI DESAIN AS-07 / BR-09
const SCORE_MAX = 100;
const GRADE_STATUS = Object.freeze({ DRAFT: 'draft', FINALIZING: 'finalizing', FINAL: 'final', SYNC_FAILED: 'sync_failed' });
const EDITABLE_STATUSES = Object.freeze([GRADE_STATUS.DRAFT, GRADE_STATUS.SYNC_FAILED]);
const TRANSCRIPT_STATUS = Object.freeze({ PENDING: 'pending', PUBLISHED: 'published' });
const SERVICE_NILAI_SUB = 'service-nilai';
module.exports = { USER_ROLES, SERVICE_ROLE, SCORE_MIN, SCORE_MAX, GRADE_STATUS, EDITABLE_STATUSES, TRANSCRIPT_STATUS, SERVICE_NILAI_SUB };
