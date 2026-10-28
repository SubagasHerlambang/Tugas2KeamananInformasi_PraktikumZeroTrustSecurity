'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { loadConfig } = require('../../packages/shared');

const script = path.resolve(__dirname, '../../scripts/setup-env.js');
const run = (...args) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-env-'));
  const out = path.join(dir, '.env');
  const r = spawnSync(process.execPath, [script, '--out', out, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { out, stdout: r.stdout, parsed: dotenv.parse(fs.readFileSync(out)), dir };
};

test('setup-env: .env hasil generate terbaca dotenv utuh (tidak terpotong oleh "#") dan lolos loadConfig', () => {
  const { parsed, stdout } = run();
  assert.equal(parsed.SEED_DEMO_PASSWORD, 'SecureCampus-Demo-2026'); // sama persis dengan yang tertulis di README
  assert.equal(parsed.SERVICE_NILAI_CLIENT_SECRET, 'service-nilai-demo-secret-local');
  assert.ok(stdout.includes(parsed.SEED_DEMO_PASSWORD));
  assert.ok(parsed.JWT_SIGNING_SECRET.length >= 32 && parsed.GATEWAY_SECRET.length >= 24);
  assert.ok(!/<.*>/.test(Object.values(parsed).join('\n')), 'tidak boleh ada placeholder <...> tersisa');
  const cfg = loadConfig(parsed);
  assert.equal(cfg.seedPassword, parsed.SEED_DEMO_PASSWORD);
  assert.deepEqual([cfg.ports.gateway, cfg.ports.nilai, cfg.ports.transkrip], [3000, 3001, 3002]);
  assert.deepEqual([cfg.jwt.accessTtlSec, cfg.jwt.refreshTtlSec, cfg.jwt.serviceTtlSec], [600, 86400, 300]);
  assert.deepEqual(cfg.accessWindow, { start: '07:00', end: '21:00', timezone: 'Asia/Jakarta' });
});

test('setup-env: secret sistem acak per instalasi, tidak menimpa .env tanpa --force, --random-demo mengacak kredensial demo', () => {
  const a = run(); const b = run();
  assert.notEqual(a.parsed.JWT_SIGNING_SECRET, b.parsed.JWT_SIGNING_SECRET);
  assert.notEqual(a.parsed.GATEWAY_SECRET, b.parsed.GATEWAY_SECRET);
  const before = fs.readFileSync(a.out, 'utf8');
  const again = spawnSync(process.execPath, [script, '--out', a.out], { encoding: 'utf8' });
  assert.match(again.stdout, /tidak ditimpa/);
  assert.equal(fs.readFileSync(a.out, 'utf8'), before);
  const rnd = run('--random-demo');
  assert.notEqual(rnd.parsed.SEED_DEMO_PASSWORD, 'SecureCampus-Demo-2026');
  assert.doesNotThrow(() => loadConfig(rnd.parsed));
});

test('loadConfig menolak secret placeholder / terlalu pendek', () => {
  const base = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../.env.example')));
  assert.throws(() => loadConfig(base), /belum diisi/);
  assert.throws(() => loadConfig({ ...base, JWT_SIGNING_SECRET: 'pendek', GATEWAY_SECRET: 'x'.repeat(30), SERVICE_NILAI_CLIENT_SECRET: 'y'.repeat(20) }), /JWT_SIGNING_SECRET/);
});
