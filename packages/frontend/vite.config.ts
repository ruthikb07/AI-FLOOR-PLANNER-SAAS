import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4200',
        changeOrigin: true,
      },
    },
  },
  test: {
    // JSDOM and Three.js fixtures compete for CPU and memory under a monorepo run.
    minWorkers: 1,
    maxWorkers: 3,
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
