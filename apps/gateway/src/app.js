'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const {
  AppError, E, toErrorBody, systemClock, createLogger,
} = require('../../../packages/shared');
const { requestContext } = require('./middleware/request-context');
const { authenticateRequest, resolveUser } = require('./middleware/authenticate');
const { verifyDevice } = require('./middleware/device-context');
const { createAuditLogger } = require('./middleware/audit');
const { matchRoute } = require('./policy/route-table');
const { createPolicyData } = require('./policy/policy-data');
const { createPolicyEngine } = require('./policy/policy');
const { createGatewayTokens } = require('./services/token.service');
const { createAuthService } = require('./services/auth.service');
const { createAuthRouter } = require('./routes/auth.routes');
const { createServiceProxies } = require('./proxy/service-proxy');

const MAX_BODY_BYTES = 64 * 1024;

/**
 * API Gateway = Policy Enforcement Point (port 3000). Pipeline request bisnis:
 *   route allowlist -> verifikasi token -> konteks device -> Policy Engine (DB) -> audit -> proxy (+X-Gateway-Secret)
 */
function createGatewayApp({ db, config, clock = systemClock, logger = createLogger('gateway', config.logLevel) }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  const audit = createAuditLogger(db, clock, logger);
  const data = createPolicyData(db);
  const policy = createPolicyEngine({ data, clock, config });
  const tokens = createGatewayTokens({ db, config, clock });
  const auth = createAuthService({ db, config, clock, tokens });
  const proxies = createServiceProxies({ config, audit, logger });
  const authRouter = createAuthRouter({ auth, audit, config, logger });

  app.use(requestContext);
  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  }));

  // Health check: tanpa data rahasia, sengaja tidak diaudit agar polling tidak membanjiri audit log.
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

  // ---- Pintu masuk tunggal: allowlist route, default deny ----
  app.use((req, res, next) => {
    const rawPath = req.originalUrl.split('?')[0];
    const { route, params, allowedMethods } = matchRoute(req.method, rawPath);
    if (!route) {
      if (allowedMethods) {
        res.set('Allow', allowedMethods.join(', '));
        return next(new AppError(405, 'METHOD_NOT_ALLOWED', 'Metode HTTP tidak diizinkan untuk route ini.', { reasonCode: 'METHOD_NOT_ALLOWED' }));
      }
      return next(E.notFound('ROUTE_NOT_ALLOWED', 'Route tidak dikenal.'));
    }
    req.gwRoute = route;
    req.gwParams = params;
    req.auditSubject = { sub: 'unknown', type: 'anonymous' };
    req.auditDeviceId = req.get('x-device-id');
    if (route.kind === 'auth') return authRouter(req, res, next);
    return businessPipeline(req, res, next);
  });

  function businessPipeline(req, res, next) {
    try {
      const route = req.gwRoute;
      if (Number(req.get('content-length') || 0) > MAX_BODY_BYTES) throw E.validation('Payload terlalu besar.', undefined, 'PAYLOAD_TOO_LARGE');

      // 1) verifikasi tanda tangan + expiry (401 bila gagal)
      const identity = authenticateRequest(req, tokens.jwt);
      req.auditSubject = { sub: identity.claims.sub, type: identity.kind };

      // 2) konteks: akun dari DB + device terdaftar (hanya untuk request user)
      let user = null;
      if (route.kind === 'user') {
        if (identity.kind !== 'user') throw E.forbidden('SERVICE_TOKEN_NOT_ALLOWED', 'Token service tidak berlaku untuk endpoint ini.');
        user = resolveUser(identity, data);
        verifyDevice(req.get('x-device-id'), user.id, data);
      }

      // 3) Policy Engine: role + kepemilikan (DB) + status data + jam akses
      const decision = policy.evaluate({ route, identity, user, params: req.gwParams });
      if (decision.decision === 'deny') throw decision.error;

      // 4) audit ALLOW sebelum meneruskan (fail-closed)
      try {
        req.auditId = audit.recordStrict({
          subject: req.auditSubject, endpoint: req.path, deviceId: req.auditDeviceId, result: 'allow',
          reasonCode: decision.reasonCode, requestId: req.id, method: req.method, ip: req.ip,
        });
        req.auditDone = true;
      } catch (err) {
        req.auditDone = true;
        logger.error('audit_write_failed', { request_id: req.id, error: err.message });
        throw Object.assign(E.internal(), { reasonCode: 'AUDIT_UNAVAILABLE' });
      }

      // 5) teruskan ke service dengan X-Gateway-Secret yang ditambahkan SERVER
      return proxies[route.upstream](req, res, next);
    } catch (err) {
      return next(err);
    }
  }

  // ---- Penanganan error terpusat: format konsisten, tanpa stack trace ke client ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let appErr = err;
    if (!(err instanceof AppError)) {
      if (err && err.type === 'entity.parse.failed') appErr = E.validation('Body JSON tidak valid.');
      else if (err && err.type === 'entity.too.large') appErr = E.validation('Payload terlalu besar.', undefined, 'PAYLOAD_TOO_LARGE');
      else {
        logger.error('unhandled_error', { request_id: req.id, error: err && err.message, stack: err && err.stack });
        appErr = E.internal();
      }
    }
    if (!req.auditDone) {
      req.auditDone = true;
      audit.recordBestEffort({
        subject: appErr.subject || req.auditSubject, endpoint: req.path, deviceId: req.auditDeviceId, result: 'deny',
        reasonCode: appErr.reasonCode, requestId: req.id, method: req.method, statusCode: appErr.status, ip: req.ip,
      });
    } else if (req.auditId) {
      audit.setStatusCode(req.auditId, appErr.status);
    }
    if (res.headersSent) return;
    res.status(appErr.status).json(toErrorBody(appErr, req.id));
  });

  return app;
}

module.exports = { createGatewayApp };
