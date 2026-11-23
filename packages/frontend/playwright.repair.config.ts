import { defineConfig } from '@playwright/test';

const frontend = 'http://127.0.0.1:44317';
const backend = 'http://127.0.0.1:44318';
process.env.RH_CINEMATIC_URL = frontend;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['rh-repair.spec.ts', 'rh-local-cad-import-and-library.spec.ts', 'rh-survey-setup.spec.ts'],
  timeout: 90_000,
  workers: 1,
  use: { baseURL: frontend, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node ../backend/dist-server/server.cjs',
      url: backend + '/api/v1/health',
      env: { PORT: '44318', RH_API_HOST: '127.0.0.1', RH_API_TOKEN: '', GEMINI_API_KEY: '',
        RH_API_ALLOWED_ORIGINS: frontend, RH_LOCAL_PROJECTS_DIR: './test-results/repair-local-projects' },
    },
    {
      command: 'pnpm exec vite preview --host 127.0.0.1 --port 44317 --strictPort',
      url: frontend,
      env: { VITE_API_PROXY_TARGET: backend },
    },
  ],
});
