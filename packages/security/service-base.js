'use strict';
const crypto = require('crypto');
const express = require('express');
const { AppError, E, toErrorBody } = require('../shared');
const { requireGatewaySecret, authenticate } = require('./middleware');
const { createTokenService } = require('./tokens');

/**
 * Kerangka Express bersama untuk Service Nilai & Service Transkrip.
 * Urutan middleware penting: X-Gateway-Secret diperiksa PERTAMA untuk semua path (termasuk /health & path tak dikenal),
 * sehingga request langsung ke port service tanpa kredensial gateway selalu ditolak.
 */
function createServiceBase({ name, config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  const tokenService = createTokenService({
    secret: config.jwt.secret, issuer: config.jwt.issuer, audience: config.jwt.audience,
    accessTtlSec: config.jwt.accessTtlSec, serviceTtlSec: config.jwt.serviceTtlSec,
  });

  app.use((req, res, next) => {
    const inbound = req.get('x-request-id');
    req.id = inbound && /^req-[A-Za-z0-9-]{8,64}$/.test(inbound) ? inbound : `req-${crypto.randomUUID()}`;
    res.setHeader('X-Request-ID', req.id);
    next();
  });
  app.use(requireGatewaySecret(config.gatewaySecret));
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: name }));

  function finish() {
    app.use((req, _res, next) => next(E.notFound('ROUTE_NOT_FOUND', 'Route tidak ditemukan.')));
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
      if (res.headersSent) return;
      res.status(appErr.status).json(toErrorBody(appErr, req.id));
    });
    return app;
  }

  return { app, tokenService, authenticate: authenticate(tokenService), finish };
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { createServiceBase, asyncRoute };
