#!/usr/bin/env node
'use strict';
// Menghasilkan koleksi + environment Postman. Jalankan: node tests/postman/generate.js
const fs = require('fs');
const path = require('path');

const hdr = (token, device) => [
  ...(token ? [{ key: 'Authorization', value: `Bearer {{${token}}}` }] : []),
  ...(device ? [{ key: 'X-Device-ID', value: device }] : []),
  { key: 'Content-Type', value: 'application/json' },
];
const T = (lines) => ({ listen: 'test', script: { type: 'text/javascript', exec: lines } });
const status = (code, extra = []) => T([`pm.test('HTTP ${code}', () => pm.response.to.have.status(${code}));`, ...extra]);
const errCode = (c) => `pm.test('error.code = ${c}', () => pm.expect(pm.response.json().error.code).to.eql('${c}'));`;
const req = (name, method, p, { token, device, body, tests, id, desc } = {}) => ({
  name: `${id ? `[${id}] ` : ''}${name}`,
  request: {
    method, header: hdr(token, device), description: desc,
    url: { raw: `{{baseUrl}}${p}`, host: ['{{baseUrl}}'], path: p.split('/').filter(Boolean) },
    ...(body !== undefined ? { body: { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2) } } : {}),
  },
  event: [tests],
});
const loginReq = (name, user, device, tokenVar, refreshVar) => req(name, 'POST', '/auth/login', {
  device, id: 'TC-AUTH-01', body: { username: user, password: '{{demoPassword}}' },
  tests: T([
    "pm.test('HTTP 200', () => pm.response.to.have.status(200));",
    'const j = pm.response.json();',
    "pm.test('expires_in = 600 dan refresh_expires_in = 86400', () => { pm.expect(j.expires_in).to.eql(600); pm.expect(j.refresh_expires_in).to.eql(86400); });",
    `pm.collectionVariables.set('${tokenVar}', j.access_token);`,
    ...(refreshVar ? [`pm.collectionVariables.set('${refreshVar}', j.refresh_token);`] : []),
  ]),
});

const folders = [
  { name: '0. Setup — login semua role', item: [
    loginReq('Login mhs.001', 'mhs.001', 'DEV-MHS-001', 'tokMhs1', 'refMhs1'),
    loginReq('Login mhs.002', 'mhs.002', 'DEV-MHS-002', 'tokMhs2'),
    loginReq('Login dosen.andi', 'dosen.andi', 'DEV-DOSEN-001', 'tokAndi'),
    loginReq('Login dosen.bunga', 'dosen.bunga', 'DEV-DOSEN-002', 'tokBunga'),
    loginReq('Login admin.demo', 'admin.demo', 'DEV-ADMIN-001', 'tokAdmin'),
    req('Token service (POST /auth/service)', 'POST', '/auth/service', {
      id: 'TC-SVC-01', body: { client_id: 'service-nilai', client_secret: '{{serviceClientSecret}}' },
      tests: T(["pm.test('HTTP 200', () => pm.response.to.have.status(200));", 'const j = pm.response.json();',
        "pm.test('expires_in = 300', () => pm.expect(j.expires_in).to.eql(300));",
        "const c = JSON.parse(atob(j.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));",
        "pm.test('role = service, exp-iat = 300', () => { pm.expect(c.role).to.eql('service'); pm.expect(c.exp - c.iat).to.eql(300); });",
        "pm.collectionVariables.set('tokService', j.access_token);"]),
    }),
  ] },
  { name: '1. Autentikasi & token', item: [
    req('Password salah', 'POST', '/auth/login', { id: 'TC-AUTH-02', device: 'DEV-MHS-001', body: { username: 'mhs.001', password: 'salah' }, tests: status(401, [errCode('INVALID_CREDENTIALS')]) }),
    req('Device tidak terdaftar', 'POST', '/auth/login', { id: 'TC-AUTH-03', device: 'DEV-UNKNOWN', body: { username: 'mhs.001', password: '{{demoPassword}}' }, tests: status(403, [errCode('DEVICE_NOT_REGISTERED')]) }),
    req('Device milik user lain', 'POST', '/auth/login', { id: 'TC-AUTH-04', device: 'DEV-MHS-002', body: { username: 'mhs.001', password: '{{demoPassword}}' }, tests: status(403, [errCode('DEVICE_NOT_REGISTERED')]) }),
    req('Tanpa token', 'GET', '/nilai', { id: 'TC-AUTH-05', device: 'DEV-MHS-001', tests: status(401, [errCode('AUTH_REQUIRED')]) }),
    req('Token rusak', 'GET', '/nilai', { id: 'TC-AUTH-05', device: 'DEV-MHS-001', token: 'tokInvalid', tests: status(401, [errCode('INVALID_TOKEN')]), desc: 'Variabel tokInvalid sengaja kosong/rusak.' }),
    req('Device tidak ada pada request bisnis', 'GET', '/nilai', { id: 'AC-07', token: 'tokMhs1', tests: status(403, [errCode('DEVICE_NOT_REGISTERED')]) }),
    req('Device milik user lain pada request bisnis', 'GET', '/nilai', { id: 'AC-07', token: 'tokMhs1', device: 'DEV-MHS-002', tests: status(403, [errCode('DEVICE_NOT_REGISTERED')]) }),
    req('Refresh (rotasi token)', 'POST', '/auth/refresh', { id: 'AC-05', device: 'DEV-MHS-001', body: { refresh_token: '{{refMhs1}}' },
      tests: T(["pm.test('HTTP 200', () => pm.response.to.have.status(200));", 'const j = pm.response.json();',
        "pm.collectionVariables.set('refMhs1Old', pm.collectionVariables.get('refMhs1'));",
        "pm.collectionVariables.set('refMhs1', j.refresh_token); pm.collectionVariables.set('tokMhs1', j.access_token);"]) }),
    req('Refresh token lama (sudah dirotasi) ditolak', 'POST', '/auth/refresh', { id: 'AC-05', body: { refresh_token: '{{refMhs1Old}}' }, tests: status(401) }),
    req('Logout (cabut refresh token)', 'POST', '/auth/logout', { id: 'TC-AUTH-06', body: { refresh_token: '{{refMhs1}}' }, tests: status(204) }),
    req('Refresh setelah logout ditolak', 'POST', '/auth/refresh', { id: 'TC-AUTH-06', body: { refresh_token: '{{refMhs1}}' }, tests: status(401) }),
    req('Token service: secret salah', 'POST', '/auth/service', { id: 'TC-SVC-02', body: { client_id: 'service-nilai', client_secret: 'salah' }, tests: status(401) }),
  ] },
  { name: '2. Nilai (policy role + kepemilikan)', item: [
    req('Mahasiswa baca nilai sendiri', 'GET', '/nilai', { id: 'TC-VAL-01', token: 'tokMhs1', device: 'DEV-MHS-001', tests: status(200, ["pm.test('hanya NIM sendiri', () => pm.response.json().data.every(g => g.student_nim === '247006110001'));"]) }),
    req('Dosen baca kelas sendiri', 'GET', '/nilai', { id: 'TC-VAL-03', token: 'tokAndi', device: 'DEV-DOSEN-001', tests: status(200, ["pm.test('hanya CLS-501', () => pm.response.json().data.every(g => g.class_id === 'CLS-501'));"]) }),
    req('Admin GET /nilai ditolak', 'GET', '/nilai', { token: 'tokAdmin', device: 'DEV-ADMIN-001', tests: status(403) }),
    req('Dosen edit nilai valid (butuh jam akses terbuka)', 'PUT', '/nilai/GRD-501-001', { id: 'TC-VAL-05', token: 'tokAndi', device: 'DEV-DOSEN-001', body: { score: 85 },
      tests: T(["const inWin = pm.environment.get('expectInAccessWindow') !== 'false';",
        "pm.test('200 bila dalam jam akses, 403 OUT_OF_ACCESS_HOURS bila di luar', () => { if (inWin) pm.response.to.have.status(200); else { pm.response.to.have.status(403); pm.expect(pm.response.json().error.code).to.eql('OUT_OF_ACCESS_HOURS'); } });"]) }),
    req('Dosen edit nilai kelas lain', 'PUT', '/nilai/GRD-502-001', { id: 'TC-VAL-04', token: 'tokAndi', device: 'DEV-DOSEN-001', body: { score: 85 },
      tests: T(["pm.test('403 (CLASS_NOT_OWNED)', () => { pm.response.to.have.status(403); pm.expect(pm.response.json().error.code).to.eql('CLASS_NOT_OWNED'); });"]) }),
    req('Edit nilai final', 'PUT', '/nilai/GRD-501-003', { id: 'TC-VAL-06', token: 'tokAndi', device: 'DEV-DOSEN-001', body: { score: 10 },
      tests: T(["const inWin = pm.environment.get('expectInAccessWindow') !== 'false';", "pm.test('409 GRADE_FINAL (dalam jam) / 403 (di luar jam)', () => pm.expect(pm.response.code).to.eql(inWin ? 409 : 403));"]) }),
    req('Admin edit nilai ditolak', 'PUT', '/nilai/GRD-501-001', { token: 'tokAdmin', device: 'DEV-ADMIN-001', body: { score: 100 }, tests: status(403) }),
    req('Mahasiswa edit nilai ditolak', 'PUT', '/nilai/GRD-501-001', { token: 'tokMhs2', device: 'DEV-MHS-002', body: { score: 100 }, tests: status(403) }),
    req('Skor invalid (string)', 'PUT', '/nilai/GRD-501-001', { id: 'TC-IN-01', token: 'tokAndi', device: 'DEV-DOSEN-001', body: { score: '85' }, tests: status(400, [errCode('VALIDATION_ERROR')]) }),
    req('Skor invalid (>100)', 'PUT', '/nilai/GRD-501-001', { id: 'TC-IN-01', token: 'tokAndi', device: 'DEV-DOSEN-001', body: { score: 101 }, tests: status(400) }),
    req('SQL injection pada ID', 'PUT', "/nilai/GRD-501-001'%20OR%201=1--", { id: 'TC-IN-02', token: 'tokAndi', device: 'DEV-DOSEN-001', body: { score: 99 }, tests: T(["pm.test('tidak ada bypass (400/404)', () => pm.expect([400, 404]).to.include(pm.response.code));"]) }),
  ] },
  { name: '3. Transkrip', item: [
    req('Mahasiswa baca transkrip sendiri', 'GET', '/transkrip/247006110001', { id: 'TC-TR-01', token: 'tokMhs1', device: 'DEV-MHS-001', tests: status(200) }),
    req('Mahasiswa baca transkrip orang lain (IDOR)', 'GET', '/transkrip/247006110002', { id: 'TC-TR-02', token: 'tokMhs1', device: 'DEV-MHS-001', tests: status(403, ["pm.test('tanpa isi transkrip', () => pm.expect(pm.response.json().data).to.be.undefined);"]) }),
    req('Admin baca transkrip NIM 1', 'GET', '/transkrip/247006110001', { id: 'TC-TR-03', token: 'tokAdmin', device: 'DEV-ADMIN-001', tests: status(200) }),
    req('Admin baca transkrip NIM 3', 'GET', '/transkrip/247006110003', { id: 'TC-TR-03', token: 'tokAdmin', device: 'DEV-ADMIN-001', tests: status(200) }),
    req('Dosen baca transkrip ditolak', 'GET', '/transkrip/247006110001', { token: 'tokAndi', device: 'DEV-DOSEN-001', tests: status(403) }),
    req('Token user ke /transkrip/sinkron', 'POST', '/transkrip/sinkron', { id: 'TC-TR-04', token: 'tokMhs1', device: 'DEV-MHS-001', body: { grade_id: 'GRD-501-001' }, tests: status(403, [errCode('SERVICE_TOKEN_REQUIRED')]) }),
    req('Token dosen ke /transkrip/sinkron', 'POST', '/transkrip/sinkron', { id: 'TC-TR-04', token: 'tokAndi', body: { grade_id: 'GRD-501-001' }, tests: status(403, [errCode('SERVICE_TOKEN_REQUIRED')]) }),
    req('Token admin ke /transkrip/sinkron', 'POST', '/transkrip/sinkron', { id: 'TC-TR-04', token: 'tokAdmin', body: { grade_id: 'GRD-501-001' }, tests: status(403, [errCode('SERVICE_TOKEN_REQUIRED')]) }),
    req('Token service ke endpoint user', 'GET', '/nilai', { token: 'tokService', device: 'DEV-DOSEN-001', tests: status(403) }),
  ] },
  { name: '4. Gateway & route', item: [
    req('Route tidak dikenal', 'GET', '/admin', { id: 'TC-GW-03', token: 'tokAdmin', device: 'DEV-ADMIN-001', tests: status(404) }),
    req('Method tidak diizinkan', 'DELETE', '/nilai/GRD-501-001', { token: 'tokAndi', device: 'DEV-DOSEN-001', tests: status(405) }),
    req('Health gateway', 'GET', '/health', { tests: status(200) }),
  ] },
  { name: '5. Finalisasi (jalankan TERAKHIR; mengubah data)', item: [
    req('Dosen finalisasi kelas bukan miliknya', 'POST', '/kelas/CLS-502/finalisasi', { id: 'TC-FIN-02', token: 'tokAndi', device: 'DEV-DOSEN-001', tests: status(403, [errCode('CLASS_NOT_OWNED')]) }),
    req('Admin finalisasi ditolak', 'POST', '/kelas/CLS-501/finalisasi', { token: 'tokAdmin', device: 'DEV-ADMIN-001', tests: status(403) }),
    req('Dosen finalisasi kelas sendiri (CLS-501)', 'POST', '/kelas/CLS-501/finalisasi', { id: 'TC-FIN-01', token: 'tokAndi', device: 'DEV-DOSEN-001',
      tests: T(["const inWin = pm.environment.get('expectInAccessWindow') !== 'false';",
        "pm.test('200 (dalam jam) atau 403 (di luar jam)', () => pm.expect(pm.response.code).to.eql(inWin ? 200 : 403));",
        "if (inWin) pm.test('transcript_sync = success', () => pm.expect(pm.response.json().data.transcript_sync).to.eql('success'));"]) }),
    req('Transkrip mhs.001 setelah finalisasi', 'GET', '/transkrip/247006110001', { token: 'tokMhs1', device: 'DEV-MHS-001', tests: status(200) }),
    req('Finalisasi ulang -> 409', 'POST', '/kelas/CLS-501/finalisasi', { id: 'TC-FIN-04', token: 'tokAndi', device: 'DEV-DOSEN-001',
      tests: T(["const inWin = pm.environment.get('expectInAccessWindow') !== 'false';", "pm.test('409 GRADE_FINAL (dalam jam) / 403 (di luar jam)', () => pm.expect(pm.response.code).to.eql(inWin ? 409 : 403));"]) }),
  ] },
];

const collection = {
  info: { name: 'SecureCampus — Zero Trust (pengujian allow/deny)', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: 'Jalankan folder 0 lebih dulu (login), lalu folder 1-4, terakhir folder 5 (mengubah data). Isi demoPassword & serviceClientSecret pada environment dari hasil `npm run setup` / file .env. Setelah folder 5 jalankan `npm run db:reset` untuk mengulang.' },
  variable: ['tokMhs1', 'tokMhs2', 'tokAndi', 'tokBunga', 'tokAdmin', 'tokService', 'refMhs1', 'refMhs1Old', 'tokInvalid'].map((key) => ({ key, value: key === 'tokInvalid' ? 'bukan.jwt.valid' : '' })),
  item: folders,
};
const environment = {
  name: 'SecureCampus Lokal', _postman_variable_scope: 'environment',
  values: [
    { key: 'baseUrl', value: 'http://127.0.0.1:3000', enabled: true },
    { key: 'demoPassword', value: '', enabled: true, type: 'secret' },
    { key: 'serviceClientSecret', value: '', enabled: true, type: 'secret' },
    { key: 'expectInAccessWindow', value: 'true', enabled: true },
  ],
};
fs.writeFileSync(path.join(__dirname, 'SecureCampus.postman_collection.json'), `${JSON.stringify(collection, null, 2)}\n`);
fs.writeFileSync(path.join(__dirname, 'SecureCampus.postman_environment.json'), `${JSON.stringify(environment, null, 2)}\n`);
console.log('Koleksi & environment Postman dibuat:', folders.reduce((n, f) => n + f.item.length, 0), 'request');
