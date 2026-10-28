'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinAccessWindow, createFixedClock, parseHHMM, accessWindowInfo, parseDurationSeconds } = require('../../packages/shared');

const W = { start: '07:00', end: '21:00', timezone: 'Asia/Jakarta' };
// WIB = UTC+7 -> 07:00 WIB = 00:00Z, 21:00 WIB = 14:00Z
const at = (iso) => isWithinAccessWindow(new Date(iso), W);

test('TC-VAL-07 batas jam akses: 06:59:59 ditolak, 07:00:00 diizinkan (awal inklusif)', () => {
  assert.equal(at('2026-10-22T23:59:59Z'), false); // 06:59:59 WIB
  assert.equal(at('2026-10-23T00:00:00Z'), true); // 07:00:00 WIB
});
test('batas akhir eksklusif: 20:59:59 diizinkan, 21:00:00 dan 21:01 ditolak', () => {
  assert.equal(at('2026-10-23T13:59:59Z'), true); // 20:59:59 WIB
  assert.equal(at('2026-10-23T14:00:00Z'), false); // 21:00:00 WIB
  assert.equal(at('2026-10-23T14:01:00Z'), false);
});
test('zona waktu eksplisit: jam server UTC tidak dipakai (12:00 UTC = 19:00 WIB diizinkan; 15:00 UTC = 22:00 WIB ditolak)', () => {
  assert.equal(at('2026-10-23T12:00:00Z'), true);
  assert.equal(at('2026-10-23T15:00:00Z'), false);
});
test('jam akses dapat dikonfigurasi (mudah didemokan) dan mendukung timezone lain', () => {
  const narrow = { start: '09:00', end: '10:00', timezone: 'UTC' };
  assert.equal(isWithinAccessWindow(new Date('2026-10-23T09:30:00Z'), narrow), true);
  assert.equal(isWithinAccessWindow(new Date('2026-10-23T10:00:00Z'), narrow), false);
  const overnight = { start: '22:00', end: '06:00', timezone: 'UTC' };
  assert.equal(isWithinAccessWindow(new Date('2026-10-23T23:00:00Z'), overnight), true);
  assert.equal(isWithinAccessWindow(new Date('2026-10-23T12:00:00Z'), overnight), false);
});
test('parseHHMM menolak format salah', () => {
  assert.equal(parseHHMM('07:00'), 420);
  assert.throws(() => parseHHMM('7pm'));
  assert.throws(() => parseHHMM('25:00'));
});
test('fixed clock dapat dimajukan (deterministik tanpa menunggu jam)', () => {
  const c = createFixedClock('2026-10-23T13:59:00Z');
  assert.equal(isWithinAccessWindow(c.now(), W), true);
  c.advance(60_000);
  assert.equal(isWithinAccessWindow(c.now(), W), false);
  c.set('2026-10-24T00:00:00Z');
  assert.equal(accessWindowInfo(c.now(), W).open, true);
});
test('parseDurationSeconds: 10m=600, 1d=86400, 5m=300', () => {
  assert.equal(parseDurationSeconds('10m', 'x'), 600);
  assert.equal(parseDurationSeconds('1d', 'x'), 86400);
  assert.equal(parseDurationSeconds('5m', 'x'), 300);
  assert.throws(() => parseDurationSeconds('abc', 'x'));
});
