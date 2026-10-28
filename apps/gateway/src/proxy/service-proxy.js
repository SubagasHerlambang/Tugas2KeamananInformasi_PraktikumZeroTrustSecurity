'use strict';
const { createProxyMiddleware } = require('http-proxy-middleware');
const { E, toErrorBody } = require('../../../../packages/shared');

/**
 * Proxy ke service hulu SETELAH keputusan allow. Gateway menimpa X-Gateway-Secret dari konfigurasi server
 * (nilai kiriman client dibuang) dan meneruskan Authorization apa adanya agar service memverifikasi ulang.
 */
function createServiceProxies({ config, audit, logger }) {
  const make = (target, label) => createProxyMiddleware({
    target,
    changeOrigin: false,
    xfwd: false,
    proxyTimeout: config.upstreamTimeoutMs,
    timeout: config.upstreamTimeoutMs,
    on: {
      proxyReq(proxyReq, req) {
        for (const h of ['x-gateway-secret', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-user-id', 'x-user-role']) proxyReq.removeHeader(h);
        proxyReq.setHeader('X-Gateway-Secret', config.gatewaySecret);
        proxyReq.setHeader('X-Request-ID', req.id);
      },
      proxyRes(proxyRes, req) {
        audit.setStatusCode(req.auditId, proxyRes.statusCode);
        if (proxyRes.statusCode >= 500) {
          audit.recordBestEffort({
            subject: req.auditSubject, endpoint: req.path, deviceId: req.auditDeviceId, result: 'deny',
            reasonCode: 'UPSTREAM_SERVICE_FAILURE', requestId: req.id, method: req.method, statusCode: proxyRes.statusCode, ip: req.ip,
          });
        }
      },
      error(err, req, res) {
        logger.error('upstream_error', { upstream: label, request_id: req.id, code: err.code });
        audit.setStatusCode(req.auditId, 502);
        audit.recordBestEffort({
          subject: req.auditSubject, endpoint: req.path, deviceId: req.auditDeviceId, result: 'deny',
          reasonCode: 'UPSTREAM_SERVICE_FAILURE', requestId: req.id, method: req.method, statusCode: 502, ip: req.ip,
        });
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.status(502).json(toErrorBody(E.upstream(), req.id));
        } else if (res && typeof res.end === 'function') res.end();
      },
    },
  });
  return { nilai: make(config.urls.nilai, 'nilai'), transkrip: make(config.urls.transkrip, 'transkrip') };
}

module.exports = { createServiceProxies };
