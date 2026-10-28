'use strict';
const { E, SERVICE_NILAI_SUB } = require('../../../../packages/shared');
const { verifyPassword, DUMMY_HASH, hashToken } = require('../../../../packages/security');

/** Logika login / refresh / logout / token service (Policy Administrator di dalam gateway). */
function createAuthService({ db, config, clock, tokens }) {
  const q = {
    userByName: db.prepare('SELECT id, username, password_hash, role, nim, is_active FROM users WHERE username = ?'),
    device: db.prepare('SELECT id, user_id, is_active FROM devices WHERE device_id = ?'),
    deviceRow: db.prepare('SELECT id, user_id, device_id, is_active FROM devices WHERE id = ?'),
    touch: db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?'),
    refreshByHash: db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
    revoke: db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
    user: db.prepare('SELECT id, role, nim, is_active FROM users WHERE id = ?'),
    client: db.prepare('SELECT client_id, secret_hash, is_active FROM service_clients WHERE client_id = ?'),
  };

  const accessBody = (token, expiresIn) => ({ access_token: token, token_type: 'Bearer', expires_in: expiresIn });

  return {
    async login({ username, password, deviceId }) {
      const user = q.userByName.get(username.trim().toLowerCase());
      const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
      // pesan generik: tidak membedakan username tak dikenal / password salah / akun nonaktif
      if (!user || !passwordOk || !user.is_active) throw E.invalidCredentials();
      const device = typeof deviceId === 'string' ? q.device.get(deviceId) : undefined;
      if (!device || !device.is_active || device.user_id !== user.id) {
        const err = E.deviceNotRegistered();
        err.subject = { sub: user.id, type: 'user' }; // identitas sudah terverifikasi lewat password
        throw err;
      }
      const subject = { sub: user.id, type: 'user' };
      const access = tokens.jwt.signAccess({ sub: user.id, role: user.role });
      const refresh = tokens.issueRefresh({ userId: user.id, deviceRowId: device.id });
      q.touch.run(clock.now().toISOString(), device.id);
      return {
        subject, reasonCode: 'LOGIN_SUCCESS',
        body: {
          ...accessBody(access.token, access.expiresIn),
          refresh_token: refresh.token, refresh_expires_in: refresh.expiresIn,
          user: { sub: user.id, role: user.role, nim: user.nim || null },
        },
      };
    },

    refresh({ refreshToken, deviceId }) {
      const row = q.refreshByHash.get(hashToken(refreshToken));
      if (!row) throw E.invalidToken('REFRESH_TOKEN_UNKNOWN');
      const subject = { sub: row.user_id, type: 'user' };
      const fail = (err) => { err.subject = subject; return err; };
      if (row.revoked_at) throw fail(E.invalidToken('REFRESH_TOKEN_REVOKED'));
      const now = clock.now();
      if (row.expires_at <= now.toISOString()) throw fail(E.tokenExpired('REFRESH_TOKEN_EXPIRED'));
      const user = q.user.get(row.user_id);
      if (!user || !user.is_active) throw fail(E.forbidden('ACCOUNT_INACTIVE', 'Akun tidak aktif.'));
      const bound = row.device_id ? q.deviceRow.get(row.device_id) : null;
      if (bound && !bound.is_active) throw fail(E.deviceNotRegistered());
      // jika client mengirim X-Device-ID, harus cocok dengan device yang terikat pada sesi
      if (deviceId !== undefined && bound && deviceId !== bound.device_id) throw fail(E.deviceNotRegistered());

      // Rotasi atomik: cabut token lama lalu terbitkan pengganti dengan expiry mutlak yang sama (maks 1 hari sejak login).
      const result = db.transaction(() => {
        if (q.revoke.run(now.toISOString(), row.id).changes !== 1) throw fail(E.invalidToken('REFRESH_TOKEN_REVOKED'));
        return tokens.issueRefresh({ userId: row.user_id, deviceRowId: row.device_id, expiresAtIso: row.expires_at });
      }).immediate();
      const access = tokens.jwt.signAccess({ sub: user.id, role: user.role });
      return {
        subject, reasonCode: 'REFRESH_SUCCESS',
        body: { ...accessBody(access.token, access.expiresIn), refresh_token: result.token, refresh_expires_in: result.expiresIn },
      };
    },

    logout({ refreshToken }) {
      const row = q.refreshByHash.get(hashToken(refreshToken));
      if (!row) return { subject: { sub: 'unknown', type: 'anonymous' }, reasonCode: 'LOGOUT_NOOP' }; // idempoten, tanpa oracle
      q.revoke.run(clock.now().toISOString(), row.id);
      return { subject: { sub: row.user_id, type: 'user' }, reasonCode: 'LOGOUT' };
    },

    async issueServiceToken({ clientId, clientSecret }) {
      const client = q.client.get(clientId);
      const ok = await verifyPassword(clientSecret, client ? client.secret_hash : DUMMY_HASH);
      if (!client || !ok || !client.is_active || client.client_id !== SERVICE_NILAI_SUB) throw E.invalidCredentials();
      const t = tokens.jwt.signService({ sub: client.client_id });
      return { subject: { sub: client.client_id, type: 'service' }, reasonCode: 'SERVICE_TOKEN_ISSUED', body: accessBody(t.token, t.expiresIn) };
    },
  };
}

module.exports = { createAuthService };
