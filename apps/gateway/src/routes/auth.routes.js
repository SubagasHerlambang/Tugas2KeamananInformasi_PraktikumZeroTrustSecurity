'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { E, schemas, parse, deviceIdHeader } = require('../../../../packages/shared');

/** Endpoint /auth/* (Policy Administrator): login, refresh, logout, token service. Setiap hasil diaudit. */
function createAuthRouter({ auth, audit, config, logger }) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  // Hanya percobaan GAGAL yang dihitung (status >= 400) -> brute force dibatasi, login sah tidak terhambat.
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    validate: { creationStack: false }, // limiter dibuat sekali saat startup; validasi stack tidak diperlukan
    handler: (_req, _res, next) => next(E.tooManyRequests()),
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const deviceHeader = (req) => {
    const raw = req.get('x-device-id');
    return raw !== undefined && deviceIdHeader.safeParse(raw).success ? raw : undefined;
  };

  /** Audit ALLOW bersifat fail-closed: bila audit gagal ditulis, request tidak dianggap sukses. */
  function respond(req, res, result, status = 200) {
    try {
      req.auditId = audit.recordStrict({
        subject: result.subject, endpoint: req.path, deviceId: req.get('x-device-id'), result: 'allow',
        reasonCode: result.reasonCode, requestId: req.id, method: req.method, statusCode: status, ip: req.ip,
      });
      req.auditDone = true;
    } catch (err) {
      req.auditDone = true;
      logger.error('audit_write_failed', { request_id: req.id, error: err.message });
      throw Object.assign(E.internal(), { reasonCode: 'AUDIT_UNAVAILABLE' });
    }
    if (status === 204) return res.status(204).end();
    return res.status(status).json(result.body);
  }

  router.post('/auth/login', limiter, wrap(async (req, res) => {
    const body = parse(schemas.login, req.body, 'Body');
    const result = await auth.login({ username: body.username, password: body.password, deviceId: deviceHeader(req) });
    respond(req, res, result);
  }));

  router.post('/auth/refresh', limiter, wrap(async (req, res) => {
    const body = parse(schemas.refresh, req.body, 'Body');
    respond(req, res, auth.refresh({ refreshToken: body.refresh_token, deviceId: req.get('x-device-id') === undefined ? undefined : (deviceHeader(req) ?? '\u0000invalid') }));
  }));

  router.post('/auth/logout', limiter, wrap(async (req, res) => {
    const body = parse(schemas.refresh, req.body, 'Body');
    respond(req, res, auth.logout({ refreshToken: body.refresh_token }), 204);
  }));

  router.post('/auth/service', limiter, wrap(async (req, res) => {
    const body = parse(schemas.serviceToken, req.body, 'Body');
    respond(req, res, await auth.issueServiceToken({ clientId: body.client_id, clientSecret: body.client_secret }));
  }));

  return router;
}

module.exports = { createAuthRouter };
