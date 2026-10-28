#!/usr/bin/env node
'use strict';
// Query SQL lokal untuk inspeksi/demo (pengganti CLI sqlite3). Default HANYA SELECT; --write untuk percobaan trigger/integritas.
//   npm run db:query -- "SELECT username, role FROM users"
//   npm run db:query -- --write "DELETE FROM audit_logs"      (ditolak trigger append-only)
const { loadConfig, loadEnvFile } = require('../packages/shared');
const { openDatabase } = require('../packages/database');

loadEnvFile();
const args = process.argv.slice(2);
const write = args.includes('--write');
const sql = args.filter((a) => a !== '--write').join(' ').trim();
if (!sql) { console.error('Gunakan: npm run db:query -- "SELECT ..."'); process.exit(1); }
if (!write && !/^\s*select\b/i.test(sql)) { console.error('Hanya SELECT yang diizinkan tanpa --write.'); process.exit(1); }
const db = openDatabase(loadConfig().databasePath);
try {
  const stmt = db.prepare(sql);
  if (stmt.reader) console.table(stmt.all());
  else console.log(`OK, baris terpengaruh: ${stmt.run().changes}`);
} catch (e) { console.error(`DITOLAK/ERROR: ${e.message}`); process.exitCode = 2; } finally { db.close(); }
