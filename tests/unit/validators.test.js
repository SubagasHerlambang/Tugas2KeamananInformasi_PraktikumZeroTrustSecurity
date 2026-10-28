'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { schemas, parse, nimParam, idParam, deviceIdHeader } = require('../../packages/shared');

const ok = (schema, v) => assert.doesNotThrow(() => parse(schema, v));
const bad = (schema, v) => assert.throws(() => parse(schema, v), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');

test('TC-IN-01 skor: hanya angka 0..100', () => {
  for (const s of [0, 50, 85.5, 100]) ok(schemas.updateScore, { score: s });
  for (const s of ['85', -1, 101, NaN, Infinity, null, true, [], {}, undefined]) bad(schemas.updateScore, { score: s });
});
test('body update nilai: field tak dikenal ditolak (strict) -> tidak ada mass assignment', () => {
  bad(schemas.updateScore, { score: 80, status: 'final' });
  bad(schemas.updateScore, { score: 80, student_id: 'x' });
  bad(schemas.updateScore, {});
});
test('login: username/password wajib string, batas panjang, tanpa field tambahan', () => {
  ok(schemas.login, { username: 'mhs.001', password: 'x' });
  bad(schemas.login, { username: '', password: 'x' });
  bad(schemas.login, { username: 'a', password: '' });
  bad(schemas.login, { username: { $ne: null }, password: 'x' });
  bad(schemas.login, { username: 'a'.repeat(65), password: 'x' });
  bad(schemas.login, { username: 'a', password: 'x', role: 'admin' });
});
test('refresh token: string 20..256', () => {
  ok(schemas.refresh, { refresh_token: 'a'.repeat(64) });
  bad(schemas.refresh, { refresh_token: 'short' });
  bad(schemas.refresh, { refresh_token: 1234 });
});
test('NIM, ID, dan header device: whitelist karakter', () => {
  assert.ok(nimParam.safeParse('247006110001').success);
  for (const v of ['abc', '1', "1' OR '1'='1", '24700611000a', '2470061100010000000000000']) assert.ok(!nimParam.safeParse(v).success);
  assert.ok(idParam.safeParse('GRD-501-001').success);
  for (const v of ["x'; DROP TABLE grades;--", '../etc', 'a b', '', 'x'.repeat(65)]) assert.ok(!idParam.safeParse(v).success);
  assert.ok(deviceIdHeader.safeParse('DEV-MHS-001').success);
  assert.ok(!deviceIdHeader.safeParse('dev id;').success);
});
test('payload sync: lengkap, tipe benar, strict', () => {
  const good = { grade_id: 'GRD-501-001', student_nim: '247006110001', class_id: 'CLS-501', score: 85, term: '2026-GANJIL', version: 2 };
  ok(schemas.sync, good);
  bad(schemas.sync, { ...good, version: 0 });
  bad(schemas.sync, { ...good, version: 1.5 });
  bad(schemas.sync, { ...good, score: 101 });
  bad(schemas.sync, { ...good, term: 'ganjil' });
  bad(schemas.sync, { ...good, extra: 1 });
  const { grade_id, ...missing } = good;
  bad(schemas.sync, missing);
});
test('pesan error validasi tidak memantulkan nilai input', () => {
  try { parse(schemas.updateScore, { score: '<script>alert(1)</script>' }); assert.fail(); } catch (e) {
    assert.ok(!JSON.stringify(e.details).includes('script'));
  }
});
