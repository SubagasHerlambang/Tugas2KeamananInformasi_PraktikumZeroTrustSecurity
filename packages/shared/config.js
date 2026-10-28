'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function parseDurationSeconds(value, label) {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(String(value).trim());
  if (!m) throw new Error(`${label} tidak valid: "${value}" (contoh: 10m, 1d, 5m)`);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return Number(m[1]) * mult;
}

function loadEnvFile() {
  // dotenv hanya dipakai oleh entry point server/CLI; test memberi env eksplisit.
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
}

function need(env, name, minLen = 1) {
  const v = env[name];
  if (!v || v.trim().length < minLen || /^<.*>$/.test(v.trim())) {
    throw new Error(`Konfigurasi ${name} belum diisi dengan benar (minimal ${minLen} karakter). Jalankan "npm run setup" atau isi .env.`);
  }
  return v;
}
const int = (env, name, def) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} harus bilangan bulat >= 0`);
  return n;
};

function loadConfig(env = process.env) {
  const portGateway = int(env, 'PORT_GATEWAY', 3000);
  const portNilai = int(env, 'PORT_NILAI', 3001);
  const portTranskrip = int(env, 'PORT_TRANSKRIP', 3002);
  const host = env.BIND_HOST || '127.0.0.1';
  const dbPath = env.DATABASE_PATH || './data/securecampus.sqlite';
  return {
    env: env.NODE_ENV || 'development',
    host,
    ports: { gateway: portGateway, nilai: portNilai, transkrip: portTranskrip },
    urls: {
      gateway: env.GATEWAY_BASE_URL || `http://127.0.0.1:${portGateway}`,
      nilai: env.NILAI_URL || `http://127.0.0.1:${portNilai}`,
      transkrip: env.TRANSKRIP_URL || `http://127.0.0.1:${portTranskrip}`,
    },
    databasePath: path.isAbsolute(dbPath) || dbPath === ':memory:' ? dbPath : path.resolve(ROOT, dbPath),
    jwt: {
      secret: need(env, 'JWT_SIGNING_SECRET', 32),
      issuer: env.JWT_ISSUER || 'securecampus-local',
      audience: env.JWT_AUDIENCE || 'securecampus-api',
      accessTtlSec: parseDurationSeconds(env.ACCESS_TOKEN_TTL || '10m', 'ACCESS_TOKEN_TTL'),
      refreshTtlSec: parseDurationSeconds(env.REFRESH_TOKEN_TTL || '1d', 'REFRESH_TOKEN_TTL'),
      serviceTtlSec: parseDurationSeconds(env.SERVICE_TOKEN_TTL || '5m', 'SERVICE_TOKEN_TTL'),
    },
    gatewaySecret: need(env, 'GATEWAY_SECRET', 24),
    serviceClient: {
      id: env.SERVICE_NILAI_CLIENT_ID || 'service-nilai',
      secret: need(env, 'SERVICE_NILAI_CLIENT_SECRET', 16),
    },
    accessWindow: {
      start: env.ACCESS_WINDOW_START || '07:00',
      end: env.ACCESS_WINDOW_END || '21:00',
      timezone: env.ACCESS_TIMEZONE || 'Asia/Jakarta',
    },
    bcryptCost: int(env, 'BCRYPT_COST', 10),
    seedPassword: env.SEED_DEMO_PASSWORD || '',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
    rateLimit: { max: int(env, 'LOGIN_RATE_LIMIT_MAX', 20), windowMs: int(env, 'LOGIN_RATE_LIMIT_WINDOW_MS', 60000) },
    upstreamTimeoutMs: int(env, 'UPSTREAM_TIMEOUT_MS', 10000),
    finalizeLockTimeoutMs: int(env, 'FINALIZE_LOCK_TIMEOUT_MS', 60000),
    logLevel: env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig, loadEnvFile, parseDurationSeconds, ROOT };
