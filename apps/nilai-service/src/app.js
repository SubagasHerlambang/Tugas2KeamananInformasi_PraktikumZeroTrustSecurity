'use strict';
const { systemClock, createLogger } = require('../../../packages/shared');
const { createServiceBase } = require('../../../packages/security');
const { createGradesRepo } = require('./repositories/grades.repo');
const { createGatewayClient } = require('./services/gateway-client');
const { createFinalizationService } = require('./services/finalization.service');
const { createNilaiRoutes } = require('./routes/nilai.routes');

/** Service Nilai (port 3001): resource kelas & nilai. Menolak request tanpa gateway secret + token yang valid. */
function createNilaiApp({ db, config, clock = systemClock, logger = createLogger('nilai-service', config.logLevel), fetchImpl }) {
  const base = createServiceBase({ name: 'nilai-service', config, logger });
  const repo = createGradesRepo(db);
  const gateway = createGatewayClient({
    baseUrl: config.urls.gateway, clientId: config.serviceClient.id, clientSecret: config.serviceClient.secret,
    timeoutMs: config.upstreamTimeoutMs, fetchImpl, logger,
  });
  const finalization = createFinalizationService({ repo, gateway, clock, config, logger });
  base.app.use(createNilaiRoutes({ authenticate: base.authenticate, db, repo, finalization, clock, config }));
  return base.finish();
}

module.exports = { createNilaiApp };
