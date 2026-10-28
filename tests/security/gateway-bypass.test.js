'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('../helpers/harness');

let s; let andi; let m1;
test.before(async () => {
  s = await startStack();
  [andi, m1] = await Promise.all([s.login('dosen.andi'), s.login('mhs.001')]);
});
test.after(async () => { await s.stop(); });

const PATHS = [['GET', '/nilai'], ['PUT', '/nilai/GRD-501-001'], ['POST', '/kelas/CLS-501/finalisasi'], ['GET', '/transkrip/247006110001'], ['GET', '/transkrip'], ['POST', '/transkrip/sinkron'], ['GET', '/health'], ['GET', '/path/tidak/dikenal']];
const svcFor = (p) => (p.startsWith('/transkrip') ? 'transkrip' : 'nilai');

test('TC-GW-01 akses LANGSUNG ke port service TANPA gateway secret ditolak (semua path, termasuk /health & path tak dikenal)', async () => {
  for (const service of ['nilai', 'transkrip']) {
    for (const [m, p] of PATHS) {
      const r = await s.direct(service, m, p, { token: andi.token, device: andi.device, body: m === 'GET' ? undefined : {} });
      assert.equal(r.status, 403, `${service} ${m} ${p}`);
      assert.equal(r.body.error.code, 'FORBIDDEN');
    }
  }
});

test('secret SALAH ditolak 403; secret dengan panjang beda / beda 1 karakter / huruf besar / kosong ditolak', async () => {
  for (const secret of ['salah', s.config.gatewaySecret + 'x', s.config.gatewaySecret.slice(0, -1), s.config.gatewaySecret.replace(/.$/, 'X'), s.config.gatewaySecret.toUpperCase(), 'a'.repeat(500)]) {
    const r = await s.direct('nilai', 'GET', '/nilai', { token: andi.token, secret });
    assert.equal(r.status, 403, secret.slice(0, 10));
  }
  const empty = await s.request(s.urls.nilai, 'GET', '/nilai', { token: andi.token, headers: { 'x-gateway-secret': '' } });
  assert.equal(empty.status, 403);
});

test('TC-GW-02 secret BENAR tetapi tanpa token / token tidak valid -> 401 (secret tidak menggantikan token)', async () => {
  const svc = await s.serviceToken();
  const cases = [undefined, 'bukan-jwt', s.signRaw({ sub: 'x', role: 'admin' }, { secret: 'secret-penyerang-0123456789-abcdefghijklmnopqrs', expiresIn: 600 }),
    s.signRaw({ sub: 'x', role: 'admin' }, { expiresIn: -60 })];
  for (const service of ['nilai', 'transkrip']) {
    for (const token of cases) {
      const path = service === 'nilai' ? '/nilai' : '/transkrip/247006110001';
      const r = await s.direct(service, 'GET', path, { token, secret: s.config.gatewaySecret });
      assert.equal(r.status, 401, `${service} ${String(token).slice(0, 12)}`);
    }
  }
  const sync = await s.direct('transkrip', 'POST', '/transkrip/sinkron', { token: 'x.y.z', secret: s.config.gatewaySecret, body: {} });
  assert.equal(sync.status, 401);
  assert.ok(svc);
});

test('secret BENAR + token alg=none / HS512 palsu ditolak 401', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'USR-ADMIN-01', role: 'admin', iss: s.config.jwt.issuer, aud: s.config.jwt.audience, iat: 1, exp: 9999999999 })}.`;
  const r1 = await s.direct('transkrip', 'GET', '/transkrip/247006110001', { token: none, secret: s.config.gatewaySecret });
  assert.equal(r1.status, 401);
  const r2 = await s.direct('nilai', 'GET', '/nilai', { token: none, secret: s.config.gatewaySecret });
  assert.equal(r2.status, 401);
});

test('service mem-verifikasi ulang kepemilikan: secret benar + token mahasiswa ke transkrip NIM lain -> 403 (bukan hanya gateway)', async () => {
  const r = await s.direct('transkrip', 'GET', '/transkrip/247006110002', { token: m1.token, secret: s.config.gatewaySecret });
  assert.equal(r.status, 403);
  assert.ok(!r.text.includes('entries'));
});

test('service mem-verifikasi ulang aturan sensitif tanpa gateway: dosen A edit nilai kelas B (secret benar) -> 403; luar jam -> 403; final -> 409', async () => {
  const hdr = { secret: s.config.gatewaySecret };
  let r = await s.direct('nilai', 'PUT', '/nilai/GRD-502-001', { token: andi.token, ...hdr, body: { score: 1 } });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'CLASS_NOT_OWNED');
  r = await s.direct('nilai', 'PUT', '/nilai/GRD-501-003', { token: andi.token, ...hdr, body: { score: 1 } });
  assert.equal(r.status, 409);
  s.clock.set('2026-10-23T15:00:00Z'); // 22:00 WIB
  r = await s.direct('nilai', 'PUT', '/nilai/GRD-501-001', { token: andi.token, ...hdr, body: { score: 1 } });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'OUT_OF_ACCESS_HOURS');
  r = await s.direct('nilai', 'POST', '/kelas/CLS-501/finalisasi', { token: andi.token, ...hdr });
  assert.equal(r.status, 403);
  s.clock.set('2026-10-23T05:00:00Z');
  assert.equal(s.grade('GRD-501-001').score, 82);
});

test('secret + token user ke /transkrip/sinkron langsung ke service -> 403 SERVICE_TOKEN_REQUIRED; token service ke endpoint user -> 403', async () => {
  const hdr = { secret: s.config.gatewaySecret };
  const sync = await s.direct('transkrip', 'POST', '/transkrip/sinkron', { token: m1.token, ...hdr, body: { grade_id: 'GRD-501-001' } });
  assert.equal(sync.status, 403); assert.equal(sync.body.error.code, 'SERVICE_TOKEN_REQUIRED');
  const svc = await s.serviceToken();
  const asUser = await s.direct('nilai', 'GET', '/nilai', { token: svc, ...hdr });
  assert.equal(asUser.status, 403);
});

test('client TIDAK dapat menyuntikkan X-Gateway-Secret lewat gateway: nilai kiriman client dibuang, auth tetap diperlukan', async () => {
  const r = await s.api('GET', '/nilai', { headers: { 'x-gateway-secret': s.config.gatewaySecret } });
  assert.equal(r.status, 401);
  const ok = await s.api('GET', '/nilai', { token: m1.token, device: m1.device, headers: { 'x-gateway-secret': 'palsu', 'x-user-id': 'USR-ADMIN-01', 'x-user-role': 'admin' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.every((g) => g.student_nim === '247006110001'), 'header identitas palsu tidak boleh dipercaya');
});

test('service tidak menjadi jalur bypass: role di header/klaim tidak cukup, identitas dari token + DB', async () => {
  const r = await s.direct('nilai', 'GET', '/nilai', { token: m1.token, secret: s.config.gatewaySecret, headers: { 'x-user-role': 'dosen', 'x-user-id': 'USR-DOSEN-01' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.every((g) => g.student_nim === '247006110001'));
});

test('service menolak token user yang role-nya di DB berubah (klaim token basi) dan akun nonaktif', async () => {
  const fresh = await s.login('mhs.002');
  s.db.prepare("UPDATE users SET role='dosen', nim=NULL WHERE username='mhs.002'").run();
  const a = await s.api('GET', '/nilai', { token: fresh.token, device: fresh.device });
  assert.equal(a.status, 401);
  s.db.prepare("UPDATE users SET role='mahasiswa', nim='247006110002' WHERE username='mhs.002'").run();
  s.db.prepare("UPDATE users SET is_active=0 WHERE username='mhs.002'").run();
  const b = await s.api('GET', '/nilai', { token: fresh.token, device: fresh.device });
  assert.equal(b.status, 403);
  const c = await s.direct('nilai', 'GET', '/nilai', { token: fresh.token, secret: s.config.gatewaySecret });
  assert.equal(c.status, 403);
  s.db.prepare("UPDATE users SET is_active=1 WHERE username='mhs.002'").run();
});

test('gateway merespons 502 (bukan bocor/hang) bila service hulu mati, dan mencatat kegagalan', async () => {
  const local = await startStack();
  try {
    const m = await local.login('mhs.001');
    await local.transkrip.stop();
    const r = await local.api('GET', '/transkrip/247006110001', { token: m.token, device: m.device });
    assert.equal(r.status, 502); assert.equal(r.body.error.code, 'UPSTREAM_SERVICE_FAILURE');
    assert.ok(!/ECONNREFUSED|127\.0\.0\.1/.test(r.text));
    assert.ok(local.audit("reason_code='UPSTREAM_SERVICE_FAILURE'").length >= 1);
  } finally { await local.stop(); }
});
