'use strict';
// Harness test: menjalankan gateway + service nilai + service transkrip sebagai TIGA server HTTP NYATA
// (port acak) di atas SATU file SQLite sementara (satu koneksi per "proses", seperti produksi). Bukan mock.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const { loadConfig, createFixedClock } = require('../../packages/shared');
const { openDatabase, migrate, seed } = require('../../packages/database');
const { createGatewayApp } = require('../../apps/gateway/src/app');
const { createNilaiApp } = require('../../apps/nilai-service/src/app');
const { createTranskripApp } = require('../../apps/transkrip-service/src/app');

const TEST_ENV = {
  NODE_ENV: 'test',
  JWT_SIGNING_SECRET: 'test-jwt-signing-secret-0123456789-abcdefghij',
  GATEWAY_SECRET: 'test-gateway-secret-0123456789',
  SERVICE_NILAI_CLIENT_SECRET: 'test-service-client-secret-xyz',
  SEED_DEMO_PASSWORD: 'Demo-Test-Pass-1',
  BCRYPT_COST: '4',
  LOG_LEVEL: 'silent',
  LOGIN_RATE_LIMIT_MAX: '1000',
};
const DEVICES = {
  'admin.demo': 'DEV-ADMIN-001', 'dosen.andi': 'DEV-DOSEN-001', 'dosen.bunga': 'DEV-DOSEN-002',
  'mhs.001': 'DEV-MHS-001', 'mhs.002': 'DEV-MHS-002', 'mhs.003': 'DEV-MHS-003',
};
const NIM = { 'mhs.001': '247006110001', 'mhs.002': '247006110002', 'mhs.003': '247006110003' };
// 05:00Z = 12:00 WIB (di dalam jam akses)
const NOON_WIB = '2026-10-23T05:00:00Z';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});
const listen = (app, port) => new Promise((resolve, reject) => {
  const server = http.createServer(app);
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });

async function startStack(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'securecampus-test-'));
  const file = path.join(dir, 'test.sqlite');
  const pg = await freePort(); const pn = await freePort(); const pt = await freePort();
  const env = {
    ...TEST_ENV, DATABASE_PATH: file, PORT_GATEWAY: String(pg), PORT_NILAI: String(pn), PORT_TRANSKRIP: String(pt),
    GATEWAY_BASE_URL: `http://127.0.0.1:${pg}`, NILAI_URL: `http://127.0.0.1:${pn}`, TRANSKRIP_URL: `http://127.0.0.1:${pt}`,
    ...(opts.env || {}),
  };
  const config = loadConfig(env);
  const adminDb = openDatabase(file); // koneksi test untuk inspeksi/manipulasi data
  migrate(adminDb);
  seed(adminDb, {
    demoPassword: config.seedPassword, serviceClientId: config.serviceClient.id,
    serviceClientSecret: config.serviceClient.secret, bcryptCost: config.bcryptCost,
  });
  const clock = opts.clock || createFixedClock(NOON_WIB);
  const dbs = { gateway: openDatabase(file), nilai: openDatabase(file), transkrip: openDatabase(file) };
  const apps = {
    gateway: createGatewayApp({ db: dbs.gateway, config, clock }),
    nilai: createNilaiApp({ db: dbs.nilai, config, clock, fetchImpl: opts.nilaiFetch }),
    transkrip: createTranskripApp({ db: dbs.transkrip, config, clock }),
  };
  const servers = { gateway: await listen(apps.gateway, pg), nilai: await listen(apps.nilai, pn), transkrip: await listen(apps.transkrip, pt) };
  const urls = { gateway: env.GATEWAY_BASE_URL, nilai: env.NILAI_URL, transkrip: env.TRANSKRIP_URL };

  async function request(base, method, p, { token, device, body, headers = {}, rawBody, secret } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (device) h['x-device-id'] = device;
    if (secret) h['x-gateway-secret'] = secret;
    let payload;
    if (rawBody !== undefined) { payload = rawBody; h['content-type'] ??= 'application/json'; } else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(base + p, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  const api = (method, p, o) => request(urls.gateway, method, p, o);
  const direct = (service, method, p, o) => request(urls[service], method, p, o);

  async function login(username, overrides = {}) {
    const res = await api('POST', '/auth/login', {
      body: { username, password: overrides.password ?? config.seedPassword }, device: overrides.device ?? DEVICES[username],
    });
    if (res.status !== 200) throw new Error(`login ${username} gagal: ${res.status} ${res.text}`);
    return { token: res.body.access_token, refresh: res.body.refresh_token, device: DEVICES[username], body: res.body };
  }
  async function serviceToken() {
    const res = await api('POST', '/auth/service', { body: { client_id: config.serviceClient.id, client_secret: config.serviceClient.secret } });
    if (res.status !== 200) throw new Error(`service token gagal: ${res.status}`);
    return res.body.access_token;
  }
  // token user yang ditandatangani dengan secret test (untuk skenario expired / claim hilang / dsb.)
  const signRaw = (payload, { secret = config.jwt.secret, ...o } = {}) =>
    jwt.sign(payload, secret, { algorithm: 'HS256', issuer: config.jwt.issuer, audience: config.jwt.audience, ...o });

  let transkripServer = servers.transkrip;
  const transkripCtl = {
    stop: async () => { await close(transkripServer); },
    start: async () => { transkripServer = await listen(apps.transkrip, pt); },
  };

  async function stop() {
    await Promise.all([close(servers.gateway), close(servers.nilai), close(transkripServer).catch(() => {})]);
    for (const d of [...Object.values(dbs), adminDb]) { try { d.close(); } catch { /* sudah tertutup */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const audit = (where = '1=1', ...params) => adminDb.prepare(`SELECT * FROM audit_logs WHERE ${where} ORDER BY id`).all(...params);
  const lastAudit = () => adminDb.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').get();
  const grade = (id) => adminDb.prepare('SELECT * FROM grades WHERE id = ?').get(id);

  return { config, clock, db: adminDb, urls, api, direct, login, serviceToken, signRaw, stop, transkrip: transkripCtl, audit, lastAudit, grade, request, DEVICES, NIM };
}

module.exports = { startStack, TEST_ENV, DEVICES, NIM, NOON_WIB };
