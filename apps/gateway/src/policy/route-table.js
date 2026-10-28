'use strict';
// ALLOWLIST route gateway. Apa pun yang tidak ada di sini ditolak (default deny) dan TIDAK PERNAH diproxy.
// kind: 'auth' (ditangani gateway) | 'user' (token user + device) | 'service' (token service saja)
const ROUTES = [
  { name: 'auth.login', method: 'POST', path: '/auth/login', kind: 'auth' },
  { name: 'auth.refresh', method: 'POST', path: '/auth/refresh', kind: 'auth' },
  { name: 'auth.logout', method: 'POST', path: '/auth/logout', kind: 'auth' },
  { name: 'auth.service', method: 'POST', path: '/auth/service', kind: 'auth' },
  { name: 'nilai.list', method: 'GET', path: '/nilai', kind: 'user', upstream: 'nilai' },
  { name: 'nilai.update', method: 'PUT', path: '/nilai/:id', kind: 'user', upstream: 'nilai', params: ['id'] },
  { name: 'kelas.finalisasi', method: 'POST', path: '/kelas/:id/finalisasi', kind: 'user', upstream: 'nilai', params: ['id'] },
  { name: 'transkrip.list', method: 'GET', path: '/transkrip', kind: 'user', upstream: 'transkrip' },
  { name: 'transkrip.get', method: 'GET', path: '/transkrip/:nim', kind: 'user', upstream: 'transkrip', params: ['nim'] },
  { name: 'transkrip.sinkron', method: 'POST', path: '/transkrip/sinkron', kind: 'service', upstream: 'transkrip' },
];

// Segmen parameter hanya boleh karakter aman: tidak ada '%', '.', '/', '\' => path traversal / encoding trick tidak akan cocok.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const compiled = ROUTES.map((r) => ({ ...r, segments: r.path.split('/').slice(1) }));

/**
 * @returns {{route?: object, params?: object, allowedMethods?: string[]}}
 * route ada => cocok. route kosong + allowedMethods => path dikenal tapi method tidak diizinkan. Keduanya kosong => path tak dikenal.
 */
function matchRoute(method, rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return {};
  const parts = rawPath.split('/').slice(1);
  const methodsForPath = new Set();
  for (const r of compiled) {
    if (r.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length && ok; i += 1) {
      const seg = r.segments[i];
      if (seg.startsWith(':')) {
        if (SAFE_SEGMENT.test(parts[i])) params[seg.slice(1)] = parts[i]; else ok = false;
      } else if (seg !== parts[i]) ok = false;
    }
    if (!ok) continue;
    methodsForPath.add(r.method);
    if (r.method === method) return { route: r, params };
  }
  return methodsForPath.size ? { allowedMethods: [...methodsForPath] } : {};
}

module.exports = { ROUTES, matchRoute };
