'use strict';
const http = require('http');
const { loadConfig, loadEnvFile } = require('./config');
const { createLogger } = require('./logger');

/** Menjalankan satu service sebagai proses terpisah (dipakai server.js tiap aplikasi). */
function runService(name, portKey, buildApp) {
  loadEnvFile();
  let config;
  try { config = loadConfig(); } catch (e) { console.error(`[${name}] ${e.message}`); process.exit(1); }
  const { openDatabase } = require('../database/db');
  const logger = createLogger(name, config.logLevel);
  const db = openDatabase(config.databasePath);
  const ready = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!ready) {
    console.error(`[${name}] Database belum dimigrasi: ${config.databasePath}. Jalankan "npm run setup" (atau "npm run db:reset").`);
    process.exit(1);
  }
  const app = buildApp({ config, db, logger });
  const server = http.createServer(app);
  server.listen(config.ports[portKey], config.host, () => {
    logger.info('listening', { url: `http://${config.host}:${config.ports[portKey]}`, db: config.databasePath });
  });
  server.on('error', (err) => {
    logger.error('listen_failed', { code: err.code, port: config.ports[portKey] });
    if (err.code === 'EADDRINUSE') console.error(`[${name}] Port ${config.ports[portKey]} sudah dipakai proses lain.`);
    process.exit(1);
  });
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return { server, db, config };
}

module.exports = { runService };
