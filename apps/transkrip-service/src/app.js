'use strict';
const { systemClock, createLogger } = require('../../../packages/shared');
const { createServiceBase } = require('../../../packages/security');
const { createTranscriptRepo } = require('./repositories/transcript.repo');
const { createTranskripRoutes } = require('./routes/transkrip.routes');

/** Service Transkrip (port 3002): resource transkrip. Sinkronisasi hanya dari token service. */
function createTranskripApp({ db, config, clock = systemClock, logger = createLogger('transkrip-service', config.logLevel) }) {
  const base = createServiceBase({ name: 'transkrip-service', config, logger });
  const repo = createTranscriptRepo(db);
  base.app.use(createTranskripRoutes({ authenticate: base.authenticate, db, repo, clock }));
  return base.finish();
}

module.exports = { createTranskripApp };
