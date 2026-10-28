'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

test('rate limit login: percobaan GAGAL melebihi batas -> 429 + audit RATE_LIMITED; login sukses tidak dihitung', async () => {
  const s = await startStack({ env: { LOGIN_RATE_LIMIT_MAX: '3', LOGIN_RATE_LIMIT_WINDOW_MS: '60000' } });
  try {
    for (let i = 0; i < 5; i += 1) await s.login('mhs.001'); // sukses tidak mengurangi kuota
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await s.api('POST', '/auth/login', { body: { username: 'mhs.001', password: 'salah' }, device: 'DEV-MHS-001' })).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    const blocked = await s.api('POST', '/auth/login', { body: { username: 'mhs.001', password: s.config.seedPassword }, device: 'DEV-MHS-001' });
    assert.equal(blocked.status, 429); assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');
    assert.ok(s.audit("reason_code='RATE_LIMITED'").length >= 1);
    // endpoint bisnis tidak terkena limiter login
    assert.equal((await s.api('GET', '/health')).status, 200);
  } finally { await s.stop(); }
});
