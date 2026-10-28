'use strict';
const { randomId, generateOpaqueToken, hashToken, createTokenService } = require('../../../../packages/security');

/** Penerbitan access/service JWT + refresh token (hash disimpan di DB, token mentah hanya dikirim ke client). */
function createGatewayTokens({ db, config, clock }) {
  const jwtService = createTokenService({
    secret: config.jwt.secret, issuer: config.jwt.issuer, audience: config.jwt.audience,
    accessTtlSec: config.jwt.accessTtlSec, serviceTtlSec: config.jwt.serviceTtlSec,
  });
  const ins = db.prepare(`INSERT INTO refresh_tokens(id, user_id, token_hash, expires_at, revoked_at, created_at, device_id)
    VALUES (?,?,?,?,NULL,?,?)`);

  function issueRefresh({ userId, deviceRowId, expiresAtIso }) {
    const raw = generateOpaqueToken();
    const now = clock.now();
    const expiresAt = expiresAtIso || new Date(now.getTime() + config.jwt.refreshTtlSec * 1000).toISOString();
    ins.run(randomId('rt-'), userId, hashToken(raw), expiresAt, now.toISOString(), deviceRowId ?? null);
    return { token: raw, expiresAt, expiresIn: Math.max(0, Math.round((new Date(expiresAt) - now) / 1000)) };
  }

  return { jwt: jwtService, issueRefresh };
}

module.exports = { createGatewayTokens };
