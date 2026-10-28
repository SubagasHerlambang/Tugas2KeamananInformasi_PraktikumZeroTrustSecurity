#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { loadConfig, loadEnvFile } = require('../shared');
const { openDatabase, migrate, seed, summary } = require('./index');

function main() {
  loadEnvFile();
  const cmd = process.argv[2];
  const cfg = loadConfig();
  const file = cfg.databasePath;
  if (cmd === 'reset') {
    if (cfg.env === 'production') throw new Error('Reset database dilarang pada NODE_ENV=production');
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  }
  const db = openDatabase(file);
  if (cmd === 'migrate' || cmd === 'reset' || cmd === 'seed') {
    const ran = migrate(db);
    console.log(ran.length ? `Migrasi diterapkan: ${ran.join(', ')}` : 'Skema sudah terbaru.');
  }
  if (cmd === 'seed' || cmd === 'reset') {
    const result = seed(db, {
      demoPassword: cfg.seedPassword, serviceClientId: cfg.serviceClient.id,
      serviceClientSecret: cfg.serviceClient.secret, bcryptCost: cfg.bcryptCost,
    });
    console.log('Seed selesai:', JSON.stringify(result));
  }
  if (cmd === 'summary') console.log(JSON.stringify(summary(db), null, 2));
  if (!['migrate', 'seed', 'reset', 'summary'].includes(cmd)) {
    console.error('Gunakan: migrate | seed | reset | summary');
    process.exitCode = 1;
  }
  console.log(`Database: ${file}`);
  db.close();
}
try { main(); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
