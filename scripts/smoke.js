#!/usr/bin/env node
'use strict';
// Smoke test end-to-end dengan TIGA PROSES NODE TERPISAH pada port nyata (default 3000/3001/3002) dan DB sementara.
// Tidak menyentuh data demo di ./data. Jam akses dilonggarkan (00:00-24:00) agar hasil tidak bergantung jam eksekusi;
// batas jam 07:00/21:00 diuji secara deterministik di tests/integration/grades.test.js.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const { loadConfig, loadEnvFile } = require('../packages/shared');
loadEnvFile();
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'securecampus-smoke-'));
const env = {
  ...process.env, NODE_ENV: 'test', DATABASE_PATH: path.join(tmp, 'smoke.sqlite'), LOG_LEVEL: 'warn', BCRYPT_COST: '4',
  JWT_SIGNING_SECRET: rnd(40), GATEWAY_SECRET: rnd(32), SERVICE_NILAI_CLIENT_SECRET: rnd(24), SEED_DEMO_PASSWORD: `Smoke-${rnd(8)}`,
  ACCESS_WINDOW_START: '00:00', ACCESS_WINDOW_END: '24:00', LOGIN_RATE_LIMIT_MAX: '1000',
};
const cfg = loadConfig(env);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };

const children = [];
function start(file) {
  const c = spawn(process.execPath, [path.join(root, file)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  c.stdout.on('data', (d) => { log += d; }); c.stderr.on('data', (d) => { log += d; });
  c.exitedWith = null; c.on('exit', (code) => { c.exitedWith = code; });
  c.getLog = () => log;
  children.push(c);
  return c;
}
async function waitFor(url, headers = {}, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { headers }); if (r.ok) return true; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
async function call(base, method, p, { token, device, body, secret } = {}) {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (device) h['x-device-id'] = device;
  if (secret) h['x-gateway-secret'] = secret;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { status: res.status, json, text };
}

(async () => {
  try {
    for (const args of [['migrate'], ['seed']]) {
      const r = spawnSync(process.execPath, [path.join(root, 'packages/database/cli.js'), ...args], { cwd: root, env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`db ${args[0]} gagal: ${r.stderr || r.stdout}`);
    }
    start('apps/transkrip-service/src/server.js'); start('apps/nilai-service/src/server.js'); start('apps/gateway/src/server.js');
    const G = `http://127.0.0.1:${cfg.ports.gateway}`; const N = `http://127.0.0.1:${cfg.ports.nilai}`; const T = `http://127.0.0.1:${cfg.ports.transkrip}`;
    const sec = { 'x-gateway-secret': cfg.gatewaySecret };
    const up = (await waitFor(`${G}/health`)) && (await waitFor(`${N}/health`, sec)) && (await waitFor(`${T}/health`, sec));
    check(`3 proses terpisah berjalan: gateway :${cfg.ports.gateway}, nilai :${cfg.ports.nilai}, transkrip :${cfg.ports.transkrip}`, up,
      children.map((c) => c.pid).join(','));
    if (!up) { children.forEach((c) => console.log(c.getLog())); throw new Error('service tidak siap (port bentrok?)'); }

    check('AC-12 direct ke :3001 tanpa secret ditolak (403)', (await call(N, 'GET', '/nilai')).status === 403);
    check('AC-12 direct ke :3002 tanpa secret ditolak (403)', (await call(T, 'GET', '/transkrip/247006110001')).status === 403);
    check('AC-12 direct dengan secret salah ditolak (403)', (await call(N, 'GET', '/nilai', { secret: 'salah' })).status === 403);
    check('AC-12 direct dengan secret benar tanpa token ditolak (401)', (await call(N, 'GET', '/nilai', { secret: cfg.gatewaySecret })).status === 401);

    const login = async (u, d) => (await call(G, 'POST', '/auth/login', { body: { username: u, password: env.SEED_DEMO_PASSWORD }, device: d })).json;
    const m1 = await login('mhs.001', 'DEV-MHS-001'); const dosen = await login('dosen.andi', 'DEV-DOSEN-001'); const admin = await login('admin.demo', 'DEV-ADMIN-001');
    check('login 3 role berhasil (access 600s, refresh 86400s)', [m1, dosen, admin].every((x) => x && x.expires_in === 600 && x.refresh_expires_in === 86400));
    check('login device salah ditolak (403)', (await call(G, 'POST', '/auth/login', { body: { username: 'mhs.001', password: env.SEED_DEMO_PASSWORD }, device: 'DEV-MHS-002' })).status === 403);

    const nilai = await call(G, 'GET', '/nilai', { token: m1.access_token, device: 'DEV-MHS-001' });
    check('mahasiswa melihat nilai sendiri (2 baris, NIM sendiri)', nilai.status === 200 && nilai.json.data.length === 2 && nilai.json.data.every((g) => g.student_nim === '247006110001'));
    check('IDOR: mahasiswa membaca transkrip NIM lain -> 403', (await call(G, 'GET', '/transkrip/247006110002', { token: m1.access_token, device: 'DEV-MHS-001' })).status === 403);
    check('device spoof: token mhs.001 + DEV-MHS-002 -> 403', (await call(G, 'GET', '/nilai', { token: m1.access_token, device: 'DEV-MHS-002' })).status === 403);
    check('dosen edit nilai kelas sendiri -> 200', (await call(G, 'PUT', '/nilai/GRD-501-001', { token: dosen.access_token, device: 'DEV-DOSEN-001', body: { score: 88 } })).status === 200);
    check('dosen edit nilai kelas lain -> 403', (await call(G, 'PUT', '/nilai/GRD-502-001', { token: dosen.access_token, device: 'DEV-DOSEN-001', body: { score: 88 } })).status === 403);
    check('edit nilai final -> 409', (await call(G, 'PUT', '/nilai/GRD-501-003', { token: dosen.access_token, device: 'DEV-DOSEN-001', body: { score: 50 } })).status === 409);

    const svc = await call(G, 'POST', '/auth/service', { body: { client_id: cfg.serviceClient.id, client_secret: cfg.serviceClient.secret } });
    const claims = JSON.parse(Buffer.from(svc.json.access_token.split('.')[1], 'base64url'));
    check('token service: role=service, 300 detik', claims.role === 'service' && claims.exp - claims.iat === 300);
    check('token user ke /transkrip/sinkron -> 403 SERVICE_TOKEN_REQUIRED', (await call(G, 'POST', '/transkrip/sinkron', { token: m1.access_token, body: {} })).json?.error?.code === 'SERVICE_TOKEN_REQUIRED');

    const fin = await call(G, 'POST', '/kelas/CLS-501/finalisasi', { token: dosen.access_token, device: 'DEV-DOSEN-001' });
    check('finalisasi CLS-501 -> 200 (sinkron via gateway + token service)', fin.status === 200 && fin.json.data.transcript_sync === 'success', JSON.stringify(fin.json?.data?.finalized?.map((f) => f.grade_id)));
    const tr = await call(G, 'GET', '/transkrip/247006110001', { token: m1.access_token, device: 'DEV-MHS-001' });
    check('transkrip mhs.001 memuat entri published dengan skor 88', tr.status === 200 && tr.json.data.entries.some((e) => e.score === 88 && e.course_code === 'IF-501'));
    check('admin membaca transkrip NIM mana pun', (await call(G, 'GET', '/transkrip/247006110002', { token: admin.access_token, device: 'DEV-ADMIN-001' })).status === 200);
    check('admin tidak boleh edit nilai (403)', (await call(G, 'PUT', '/nilai/GRD-502-001', { token: admin.access_token, device: 'DEV-ADMIN-001', body: { score: 1 } })).status === 403);
    check('route tak dikenal -> 404', (await call(G, 'GET', '/admin', { token: admin.access_token, device: 'DEV-ADMIN-001' })).status === 404);

    const out = await call(G, 'POST', '/auth/logout', { body: { refresh_token: m1.refresh_token } });
    check('logout -> 204 dan refresh sesudahnya ditolak (401)', out.status === 204 && (await call(G, 'POST', '/auth/refresh', { body: { refresh_token: m1.refresh_token } })).status === 401);

    // Frontend (opsional): build statis disajikan `vite preview` dan CORS gateway mengizinkan origin frontend lokal.
    const feDir = path.join(root, 'frontend');
    if (fs.existsSync(path.join(feDir, 'dist', 'index.html')) && fs.existsSync(path.join(feDir, 'node_modules', '.bin', 'vite'))) {
      const fe = spawn(path.join(feDir, 'node_modules', '.bin', 'vite'), ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: feDir, env, stdio: 'ignore' });
      children.push(fe);
      const feUp = await waitFor('http://127.0.0.1:4173/');
      const html = feUp ? await (await fetch('http://127.0.0.1:4173/')).text() : '';
      check('frontend build disajikan di :4173 (index.html memuat root + bundle)', feUp && html.includes('id="root"') && /assets\/index-.*\.js/.test(html));
      const pre = await fetch(`${G}/nilai`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-device-id' } });
      check('CORS: preflight dari origin frontend lokal diizinkan', pre.headers.get('access-control-allow-origin') === 'http://127.0.0.1:4173');
      const evil = await fetch(`${G}/health`, { headers: { Origin: 'https://evil.example' } });
      check('CORS: origin asing tidak mendapat izin', evil.headers.get('access-control-allow-origin') === null);
    } else {
      console.log('SKIP  frontend smoke: jalankan "npm run frontend:install && npm run frontend:build" terlebih dahulu');
    }

    const db = require('../packages/database').openDatabase(cfg.databasePath);
    const a = db.prepare("SELECT COUNT(*) n, SUM(result='allow') allow, SUM(result='deny') deny FROM audit_logs").get();
    const svcRows = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE subject_type='service' AND endpoint='/transkrip/sinkron' AND result='allow'").get().n;
    check('audit log berisi event allow & deny', a.allow > 0 && a.deny > 0, `total=${a.n} allow=${a.allow} deny=${a.deny}`);
    check('audit mencatat 2 panggilan sinkron (2 nilai draft) oleh subject service lewat gateway', svcRows === 2, `rows=${svcRows}`);
    const dump = JSON.stringify(db.prepare('SELECT * FROM audit_logs').all());
    check('audit log tidak memuat token/secret', ![m1.access_token, m1.refresh_token, svc.json.access_token, cfg.gatewaySecret, env.SEED_DEMO_PASSWORD].some((x) => dump.includes(x)));
    db.close();
  } catch (e) {
    check(`skrip smoke tidak error: ${e.message}`, false);
  } finally {
    children.forEach((c) => c.kill('SIGTERM'));
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(tmp, { recursive: true, force: true });
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nRINGKASAN SMOKE: ${results.length - failed}/${results.length} PASS, ${failed} FAIL`);
    process.exit(failed ? 1 : 0);
  }
})();
