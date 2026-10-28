#!/usr/bin/env node
'use strict';
// Menjalankan gateway (3000), nilai-service (3001), transkrip-service (3002) sebagai TIGA PROSES TERPISAH.
const { spawn } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const services = [
  ['transkrip', 'apps/transkrip-service/src/server.js'],
  ['nilai', 'apps/nilai-service/src/server.js'],
  ['gateway', 'apps/gateway/src/server.js'],
];
const children = services.map(([name, file]) => {
  const child = spawn(process.execPath, [path.join(root, file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}]`.padEnd(12);
  const pipe = (stream, out) => stream.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => out.write(`${tag}${l}\n`)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => { if (!shuttingDown) { console.error(`${tag}berhenti (kode ${code}); menghentikan semua service.`); shutdown(1); } });
  return child;
});
let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
