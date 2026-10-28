'use strict';
const { runService } = require('../../../packages/shared/bootstrap');
const { createNilaiApp } = require('./app');

runService('nilai-service', 'nilai', ({ config, db, logger }) => createNilaiApp({ db, config, logger }));
