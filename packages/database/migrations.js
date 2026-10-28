'use strict';
// Skema tunggal (satu sumber definisi tabel). Mengikuti ERD PRD bab 10.
const MIGRATIONS = [
  {
    version: 1,
    name: 'init_schema',
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','dosen','mahasiswa')),
  nim           TEXT UNIQUE,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (role <> 'mahasiswa' OR nim IS NOT NULL)
);

CREATE TABLE devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  device_id    TEXT NOT NULL UNIQUE,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT
);

CREATE TABLE refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  device_id  INTEGER REFERENCES devices(id)
);

CREATE TABLE service_clients (
  client_id   TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE classes (
  id          TEXT PRIMARY KEY,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  lecturer_id TEXT NOT NULL REFERENCES users(id),
  term        TEXT NOT NULL
);

CREATE TABLE enrollments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   TEXT NOT NULL REFERENCES classes(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE (class_id, student_id)
);

CREATE TABLE grades (
  id           TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id),
  student_id   TEXT NOT NULL REFERENCES users(id),
  score        REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalizing','final','sync_failed')),
  updated_by   TEXT REFERENCES users(id),
  finalized_at TEXT,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (class_id, student_id),
  CHECK ((status = 'final') = (finalized_at IS NOT NULL))
);

CREATE TABLE transcript_entries (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL REFERENCES classes(id),
  student_id  TEXT NOT NULL REFERENCES users(id),
  grade_id    TEXT NOT NULL UNIQUE REFERENCES grades(id),
  score       REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  term        TEXT NOT NULL,
  version     INTEGER NOT NULL CHECK (version >= 1),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','published')),
  synced_at   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK ((sync_status = 'published') = (synced_at IS NOT NULL))
);

CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    TEXT NOT NULL,
  subject_sub  TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','service','anonymous')),
  endpoint     TEXT NOT NULL,
  device_id    TEXT,
  result       TEXT NOT NULL CHECK (result IN ('allow','deny')),
  reason_code  TEXT NOT NULL,
  request_id   TEXT,
  method       TEXT,
  status_code  INTEGER,
  ip           TEXT
);

-- Integritas: dosen harus role dosen, peserta harus mahasiswa, nilai hanya untuk mahasiswa terdaftar.
CREATE TRIGGER trg_classes_lecturer_role BEFORE INSERT ON classes
WHEN (SELECT role FROM users WHERE id = NEW.lecturer_id) IS NOT 'dosen'
BEGIN SELECT RAISE(ABORT, 'lecturer_id harus mengacu ke user role dosen'); END;

CREATE TRIGGER trg_enrollments_student_role BEFORE INSERT ON enrollments
WHEN (SELECT role FROM users WHERE id = NEW.student_id) IS NOT 'mahasiswa'
BEGIN SELECT RAISE(ABORT, 'student_id harus mengacu ke user role mahasiswa'); END;

CREATE TRIGGER trg_grades_enrolled BEFORE INSERT ON grades
WHEN NOT EXISTS (SELECT 1 FROM enrollments WHERE class_id = NEW.class_id AND student_id = NEW.student_id)
BEGIN SELECT RAISE(ABORT, 'mahasiswa belum terdaftar pada kelas'); END;

-- Audit log append-only: tidak boleh dihapus; satu-satunya UPDATE yang diizinkan adalah mengisi status_code (NULL -> nilai).
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs bersifat append-only'); END;

CREATE TRIGGER trg_audit_limited_update BEFORE UPDATE ON audit_logs
WHEN NOT (OLD.status_code IS NULL AND NEW.status_code IS NOT NULL
  AND NEW.id = OLD.id AND NEW.timestamp = OLD.timestamp AND NEW.subject_sub = OLD.subject_sub
  AND NEW.subject_type = OLD.subject_type AND NEW.endpoint = OLD.endpoint AND NEW.device_id IS OLD.device_id
  AND NEW.result = OLD.result AND NEW.reason_code = OLD.reason_code AND NEW.request_id IS OLD.request_id
  AND NEW.method IS OLD.method AND NEW.ip IS OLD.ip)
BEGIN SELECT RAISE(ABORT, 'audit_logs bersifat append-only'); END;

CREATE INDEX idx_users_nim ON users(nim);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_classes_lecturer ON classes(lecturer_id);
CREATE INDEX idx_enrollments_class_student ON enrollments(class_id, student_id);
CREATE INDEX idx_grades_class_student ON grades(class_id, student_id);
CREATE INDEX idx_grades_student ON grades(student_id);
CREATE INDEX idx_transcript_student_status ON transcript_entries(student_id, sync_status);
CREATE INDEX idx_audit_ts_sub_result ON audit_logs(timestamp, subject_sub, result);
`,
  },
];

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const ran = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, new Date().toISOString());
    })();
    ran.push(m.version);
  }
  return ran;
}

module.exports = { MIGRATIONS, migrate };
