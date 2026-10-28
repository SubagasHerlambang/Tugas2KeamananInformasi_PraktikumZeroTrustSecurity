// Klien API SecureCampus. SEMUA request melalui API Gateway (default http://127.0.0.1:3000).
// Keamanan sesungguhnya ada di gateway & service; klien ini hanya mengirim token + X-Device-ID dan menampilkan hasilnya.
// Token disimpan HANYA di memori (hilang saat tab dimuat ulang) -> tidak ada token di localStorage/sessionStorage/URL.

export class ApiError extends Error {
  constructor(status, code, message, requestId, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export function createApiClient({ baseUrl, fetchImpl, onSessionExpired } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let session = null; // { accessToken, refreshToken, deviceId, user }
  let refreshing = null;

  async function raw(method, path, { body, token, deviceId } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (deviceId) headers['X-Device-ID'] = deviceId;
    let res;
    try {
      res = await doFetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Tidak dapat menghubungi server. Pastikan gateway berjalan.', null);
    }
    const requestId = res.headers.get('x-request-id');
    if (res.status === 204) return { status: 204, data: null, requestId };
    let json = null;
    try { json = await res.json(); } catch { /* respons non-JSON */ }
    if (!res.ok) {
      const e = json && json.error;
      throw new ApiError(res.status, e?.code || 'ERROR', e?.message || `Permintaan gagal (${res.status})`, e?.request_id || requestId, e?.details);
    }
    return { status: res.status, data: json, requestId };
  }

  async function refreshSession() {
    if (!session?.refreshToken) throw new ApiError(401, 'AUTH_REQUIRED', 'Sesi berakhir.');
    refreshing ||= raw('POST', '/auth/refresh', { body: { refresh_token: session.refreshToken }, deviceId: session.deviceId })
      .then(({ data }) => { session = { ...session, accessToken: data.access_token, refreshToken: data.refresh_token ?? session.refreshToken }; })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  // Request terautentikasi; bila access token kedaluwarsa (10 menit) coba refresh SATU kali lalu ulangi.
  async function authed(method, path, body) {
    if (!session) throw new ApiError(401, 'AUTH_REQUIRED', 'Silakan login.');
    const call = () => raw(method, path, { body, token: session.accessToken, deviceId: session.deviceId });
    try {
      return await call();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.code === 'TOKEN_EXPIRED') {
        try { await refreshSession(); } catch (e2) { session = null; onSessionExpired?.(); throw e2; }
        return call();
      }
      if (err instanceof ApiError && err.status === 401) { session = null; onSessionExpired?.(); }
      throw err;
    }
  }

  return {
    get session() { return session; },
    get user() { return session?.user ?? null; },

    async login(username, password, deviceId) {
      const { data } = await raw('POST', '/auth/login', { body: { username, password }, deviceId });
      session = { accessToken: data.access_token, refreshToken: data.refresh_token, deviceId, user: data.user };
      return data.user;
    },
    async logout() {
      const rt = session?.refreshToken;
      session = null;
      if (rt) { try { await raw('POST', '/auth/logout', { body: { refresh_token: rt } }); } catch { /* sesi lokal tetap dihapus */ } }
    },

    getGrades: async () => (await authed('GET', '/nilai')).data,
    updateScore: async (gradeId, score) => (await authed('PUT', `/nilai/${encodeURIComponent(gradeId)}`, { score })).data.data,
    finalizeClass: async (classId) => (await authed('POST', `/kelas/${encodeURIComponent(classId)}/finalisasi`, {})).data.data,
    getTranscript: async (nim) => (await authed('GET', `/transkrip/${encodeURIComponent(nim)}`)).data.data,
    listTranscripts: async () => (await authed('GET', '/transkrip')).data.data,
  };
}
