// Menjalankan backend NYATA (gateway + 2 service + SQLite sementara) untuk test UI. Berjalan di proses Node utama (bukan jsdom).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let stack;

export async function setup({ provide }) {
  const { startStack } = require('../../tests/helpers/harness.js');
  stack = await startStack();
  provide('stack', {
    gateway: stack.urls.gateway,
    password: stack.config.seedPassword,
    jwtSecret: stack.config.jwt.secret,
    issuer: stack.config.jwt.issuer,
    audience: stack.config.jwt.audience,
  });
}

export async function teardown() { if (stack) await stack.stop(); }
