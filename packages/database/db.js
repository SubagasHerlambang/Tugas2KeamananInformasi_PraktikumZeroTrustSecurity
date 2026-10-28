'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/** Satu koneksi logis per proses; seluruh service memakai SATU file database bersama. */
function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

module.exports = { openDatabase };
