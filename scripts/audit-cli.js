#!/usr/bin/env node
'use strict';
// Lihat audit log lokal (tidak ada endpoint publik untuk audit). Contoh:
//   npm run audit                      -> 30 event terakhir
//   npm run audit -- --result deny     -> hanya deny
//   npm run audit -- --limit 100 --subject USR-MHS-001 --reason OUT_OF_ACCESS_HOURS
const { loadConfig, loadEnvFile } = require('../packages/shared');
const { openDatabase } = require('../packages/database');

loadEnvFile();
const cfg = loadConfig();
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const db = openDatabase(cfg.databasePath);
const where = []; const params = [];
if (opt('result')) { where.push('result = ?'); params.push(opt('result')); }
if (opt('subject')) { where.push('subject_sub = ?'); params.push(opt('subject')); }
if (opt('reason')) { where.push('reason_code = ?'); params.push(opt('reason')); }
const limit = Math.min(Number(opt('limit', 30)) || 30, 1000);
const rows = db.prepare(`SELECT id, timestamp, subject_type AS type, subject_sub AS subject, method, endpoint, device_id AS device,
  result, reason_code AS reason, status_code AS status, request_id FROM audit_logs
  ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`).all(...params);
console.table(rows.reverse());
const totals = db.prepare('SELECT result, COUNT(*) AS n FROM audit_logs GROUP BY result').all();
console.log('Total:', totals.map((t) => `${t.result}=${t.n}`).join('  ') || '(kosong)');
db.close();
