'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../../scripts/check-node');

test('check-node: Node < 20 ditolak dengan pesan yang jelas; 20-24 diterima tanpa peringatan', () => {
  for (const v of ['v18.19.0', 'v16.20.2', '14.0.0']) { const r = check(v); assert.equal(r.ok, false, v); assert.match(r.message, /Node\.js 20/); }
  for (const v of ['v20.11.1', 'v22.22.2', 'v24.13.0']) assert.deepEqual(check(v), { ok: true, message: '' }, v);
});
test('check-node: Node di atas 24 hanya memberi peringatan (tidak memblokir)', () => {
  const r = check('v26.0.0'); assert.equal(r.ok, true); assert.match(r.message, /Visual Studio|Node.js 22/);
});
test('check-node: versi tidak terbaca ditolak', () => { assert.equal(check('abc').ok, false); });
