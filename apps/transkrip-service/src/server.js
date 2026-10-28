'use strict';
const { runService } = require('../../../packages/shared/bootstrap');
const { createTranskripApp } = require('./app');

runService('transkrip-service', 'transkrip', ({ config, db, logger }) => createTranskripApp({ db, config, logger }));
