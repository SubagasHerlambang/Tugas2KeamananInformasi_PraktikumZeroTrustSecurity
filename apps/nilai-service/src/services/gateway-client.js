'use strict';

/**
 * Klien HTTP Service Nilai -> GATEWAY (bukan langsung ke port 3002).
 * 1) POST /auth/service dengan client_id/secret dari environment -> token service (5 menit, role=service)
 * 2) POST /transkrip/sinkron dengan Authorization: Bearer <token service> (+ Idempotency-Key)
 */
function createGatewayClient({ baseUrl, clientId, clientSecret, timeoutMs = 10000, fetchImpl = fetch, logger }) {
  let cached = null;
  const send = (path, init) => fetchImpl(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const fail = (message, extra = {}) => Object.assign(new Error(message), extra);

  function expiryOf(token) {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000; } catch { return 0; }
  }

  async function getServiceToken(force = false) {
    if (!force && cached && cached.expMs - Date.now() > 30_000) return cached.token;
    const res = await send('/auth/service', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) throw fail('Gagal memperoleh token service', { status: res.status });
    const body = await res.json();
    cached = { token: body.access_token, expMs: expiryOf(body.access_token) };
    return cached.token;
  }

  async function syncGrade(payload) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getServiceToken(attempt > 0);
      const res = await send('/transkrip/sinkron', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'idempotency-key': `grade:${payload.grade_id}:v${payload.version}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 && attempt === 0) { cached = null; continue; } // token kedaluwarsa di tengah proses -> minta ulang sekali
      if (!res.ok) {
        logger?.warn('sync_rejected', { grade_id: payload.grade_id, status: res.status, gateway_request_id: res.headers.get('x-request-id') });
        throw fail('Sinkronisasi ditolak', { status: res.status });
      }
      return res.json();
    }
    throw fail('Sinkronisasi gagal');
  }

  return { getServiceToken, syncGrade, clearCache: () => { cached = null; } };
}

module.exports = { createGatewayClient };
