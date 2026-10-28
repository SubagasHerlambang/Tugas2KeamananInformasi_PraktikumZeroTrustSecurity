'use strict';
const { runService } = require('../../../packages/shared/bootstrap');
const { createGatewayApp } = require('./app');

runService('gateway', 'gateway', ({ config, db, logger }) => createGatewayApp({ db, config, logger }));
