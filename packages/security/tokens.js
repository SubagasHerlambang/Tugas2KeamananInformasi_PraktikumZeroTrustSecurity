'use strict';
const jwt = require('jsonwebtoken');
const { E, USER_ROLES, SERVICE_ROLE } = require('../shared');

const ALGORITHM = 'HS256'; // satu-satunya algoritma yang diizinkan (cegah alg=none / confusion)

/**
 * Pembuat & verifier JWT. Dipakai gateway (menerbitkan + verifikasi) dan kedua service (verifikasi ulang mandiri).
 * Claim minimum: sub, role, iat, exp (+ iss/aud sebagai hardening).
 */
function createTokenService({ secret, issuer, audience, accessTtlSec, serviceTtlSec }) {
  if (!secret || secret.length < 32) throw new Error('JWT secret terlalu pendek');

  function sign(payload, ttlSec) {
    const token = jwt.sign(payload, secret, { algorithm: ALGORITHM, expiresIn: ttlSec, issuer, audience });
    return { token, expiresIn: ttlSec };
  }

  return {
    signAccess: ({ sub, role }) => {
      if (!USER_ROLES.includes(role)) throw new Error('Role user tidak valid');
      return sign({ sub, role }, accessTtlSec);
    },
    signService: ({ sub }) => sign({ sub, role: SERVICE_ROLE }, serviceTtlSec),

    /** Verifikasi tanda tangan, expiry, issuer, audience, dan claim wajib. Mengembalikan {kind, claims}. */
    verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > 4096) throw E.invalidToken();
      let claims;
      try {
        claims = jwt.verify(token, secret, { algorithms: [ALGORITHM], issuer, audience, clockTolerance: 0 });
      } catch (err) {
        if (err && err.name === 'TokenExpiredError') throw E.tokenExpired();
        throw E.invalidToken();
      }
      if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.role !== 'string'
        || !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat)) {
        throw E.invalidToken('INVALID_TOKEN_CLAIMS');
      }
      if (USER_ROLES.includes(claims.role)) return { kind: 'user', claims };
      if (claims.role === SERVICE_ROLE) return { kind: 'service', claims };
      throw E.invalidToken('INVALID_TOKEN_CLAIMS');
    },
  };
}

function extractBearer(req) {
  const header = req.get ? req.get('authorization') : req.headers.authorization;
  if (!header) throw E.authRequired();
  const m = /^Bearer\s+([A-Za-z0-9\-_=.]+)$/.exec(header.trim());
  if (!m) throw E.invalidToken('MALFORMED_AUTHORIZATION');
  return m[1];
}

module.exports = { createTokenService, extractBearer, ALGORITHM };
