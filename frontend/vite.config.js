import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    environment: 'jsdom',
    pool: 'forks',
    include: ['tests/**/*.test.{js,jsx}'],
    globalSetup: ['./tests/global-setup.js'],
    fileParallelism: false,
    setupFiles: ['./tests/setup-dom.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
