'use strict';
// Logger terstruktur (JSON per baris) dengan sanitasi field sensitif (PRD 14.4).
const SENSITIVE = /(authorization|cookie|password|secret|token|api[-_]?key|hash)/i;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function sanitize(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}...`;
  return value;
}

function createLogger(name, level = process.env.LOG_LEVEL || 'info', sink = null) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, svc: name, msg, ...sanitize(fields || {}) });
    if (sink) return sink(line);
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };
  return { debug: (m, f) => emit('debug', m, f), info: (m, f) => emit('info', m, f), warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f) };
}

module.exports = { createLogger, sanitize };
