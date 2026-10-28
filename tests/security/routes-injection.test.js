'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { startStack } = require('../helpers/harness');

let s; let andi; let m1; let admin;
test.before(async () => {
  s = await startStack();
  [andi, m1, admin] = await Promise.all(['dosen.andi', 'mhs.001', 'admin.demo'].map((u) => s.login(u)));
});
test.after(async () => { await s.stop(); });

const snapshot = () => JSON.stringify({
  grades: s.db.prepare('SELECT id, score, status, version FROM grades ORDER BY id').all(),
  tr: s.db.prepare('SELECT grade_id, sync_status, version FROM transcript_entries ORDER BY grade_id').all(),
  users: s.db.prepare('SELECT COUNT(*) n FROM users').get(),
});

const rawRequest = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
  const { port } = new URL(s.urls.gateway);
  const sock = net.connect(Number(port), '127.0.0.1', () => {
    const h = Object.entries({ Host: '127.0.0.1', Connection: 'close', ...headers }).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    sock.write(`${method} ${path} HTTP/1.1\r\n${h}\r\n\r\n`);
  });
  let data = '';
  sock.on('data', (d) => { data += d; });
  sock.on('end', () => resolve(data));
  sock.on('error', reject);
});

test('TC-GW-03 route tidak dikenal -> 404, tidak diproxy, diaudit sebagai deny ROUTE_NOT_ALLOWED', async () => {
  for (const p of ['/admin', '/internal/debug', '/nilai/GRD-501-001/hapus', '/auth', '/api/nilai', '/.env', '/transkrip/1/2', '/kelas/CLS-501']) {
    const r = await s.api('GET', p, { token: admin.token, device: admin.device });
    assert.equal(r.status, 404, p); assert.equal(r.body.error.code, 'RESOURCE_NOT_FOUND');
    assert.equal(s.lastAudit().reason_code, 'ROUTE_NOT_ALLOWED');
  }
});

test('method yang tidak diizinkan -> 405 + audit (DELETE/PATCH/POST pada endpoint GET, dll.)', async () => {
  for (const [m, p] of [['DELETE', '/nilai/GRD-501-001'], ['PATCH', '/nilai/GRD-501-001'], ['POST', '/nilai'], ['GET', '/kelas/CLS-501/finalisasi'], ['PUT', '/transkrip/247006110001'], ['GET', '/auth/login'], ['DELETE', '/transkrip/sinkron']]) {
    const r = await s.api(m, p, { token: admin.token, device: admin.device, body: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 405, `${m} ${p}`);
    assert.equal(s.lastAudit().reason_code, 'METHOD_NOT_ALLOWED');
  }
});

test('path traversal / encoding / double slash / trailing slash / huruf besar tidak lolos allowlist', async () => {
  const before = snapshot();
  for (const p of ['/nilai/..%2ftranskrip', '/nilai/%2e%2e/transkrip/247006110001', '/nilai/..', '//nilai', '/nilai/', '/NILAI', '/Nilai/GRD-501-001', '/nilai/GRD-501-001%00', '/nilai/GRD%2D501%2D001', '/transkrip/247006110001/', '/auth/login/', '/nilai;x=1', '/nilai%0d%0aX-Injected:1']) {
    const raw = await rawRequest(p, 'GET', { Authorization: `Bearer ${admin.token}`, 'X-Device-ID': admin.device });
    const status = Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1]);
    assert.ok([400, 404, 405].includes(status), `${p} -> ${status}`);
    assert.ok(!/X-Injected/i.test(raw.split('\r\n\r\n')[0]), 'tidak boleh ada header injection');
  }
  assert.equal(snapshot(), before);
});

test('TC-IN-02 SQL injection pada ID/NIM/username/body: tidak ada bypass, tidak ada perubahan data, tabel utuh', async () => {
  const before = snapshot();
  const payloads = ["' OR '1'='1", "1; DROP TABLE grades;--", "GRD-501-001' OR 1=1--", '" OR ""="', "'; UPDATE grades SET score=100;--", '1 UNION SELECT password_hash FROM users', '%27%20OR%201%3D1'];
  for (const p of payloads) {
    const enc = encodeURIComponent(p);
    const rs = await Promise.all([
      s.api('PUT', `/nilai/${enc}`, { token: andi.token, device: andi.device, body: { score: 99 } }),
      s.api('GET', `/transkrip/${enc}`, { token: admin.token, device: admin.device }),
      s.api('POST', `/kelas/${enc}/finalisasi`, { token: andi.token, device: andi.device }),
      s.api('GET', `/nilai?id=${enc}&nim=${enc}`, { token: m1.token, device: m1.device }),
    ]);
    for (const r of rs.slice(0, 3)) assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.equal(rs[3].status, 200);
    assert.ok(rs[3].body.data.every((g) => g.student_nim === '247006110001'));
    const login = await s.api('POST', '/auth/login', { body: { username: p, password: p }, device: 'DEV-MHS-001' });
    assert.equal(login.status, 401);
    const login2 = await s.api('POST', '/auth/login', { body: { username: 'mhs.001', password: p }, device: 'DEV-MHS-001' });
    assert.equal(login2.status, 401);
    const devInj = await s.api('GET', '/nilai', { token: m1.token, device: p });
    assert.equal(devInj.status, 403);
    const bodyInj = await s.api('PUT', '/nilai/GRD-501-001', { token: andi.token, device: andi.device, body: { score: p } });
    assert.equal(bodyInj.status, 400);
  }
  assert.equal(snapshot(), before);
  for (const t of ['users', 'devices', 'classes', 'enrollments', 'grades', 'transcript_entries', 'audit_logs', 'refresh_tokens', 'service_clients']) {
    assert.ok(s.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n >= 1, `tabel ${t} harus tetap ada`);
  }
});

test('payload NoSQL/objek bersarang pada login ditolak; payload terlalu besar ditolak', async () => {
  assert.equal((await s.api('POST', '/auth/login', { body: { username: { $gt: '' }, password: { $gt: '' } }, device: 'DEV-MHS-001' })).status, 400);
  const big = await s.api('POST', '/auth/login', { body: { username: 'a', password: 'x'.repeat(100_000) }, device: 'DEV-MHS-001' });
  assert.ok([400, 413].includes(big.status));
  const bigPut = await s.api('PUT', '/nilai/GRD-501-001', { token: andi.token, device: andi.device, body: { score: 50, pad: 'x'.repeat(200_000) } });
  assert.equal(bigPut.status, 400);
  assert.equal(s.grade('GRD-501-001').score, 82);
});

test('mass assignment: field status/student_id/class_id/version pada PUT /nilai diabaikan atau ditolak, tidak mengubah kolom lain', async () => {
  const r = await s.api('PUT', '/nilai/GRD-501-001', { token: andi.token, device: andi.device, body: { score: 70, status: 'final', version: 99, class_id: 'CLS-502' } });
  assert.equal(r.status, 400);
  const g = s.grade('GRD-501-001');
  assert.equal(g.status, 'draft'); assert.equal(g.class_id, 'CLS-501'); assert.equal(g.score, 82);
});

test('respons keamanan: header helmet ada dan X-Powered-By tidak ada', async () => {
  const r = await s.api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('x-request-id'));
});

test('CORS: hanya origin yang dikonfigurasi yang mendapat izin', async () => {
  const good = await fetch(`${s.urls.gateway}/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const evil = await fetch(`${s.urls.gateway}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${s.urls.gateway}/nilai`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-device-id' } });
  assert.ok(pre.status < 300);
  assert.match(pre.headers.get('access-control-allow-headers') || '', /X-Device-ID/i);
});
