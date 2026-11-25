import { defineConfig } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const frontendPort = process.env.RH_TEST_FRONTEND_PORT ?? '44317';
const backendPort = process.env.RH_TEST_BACKEND_PORT ?? '44318';
if (![frontendPort, backendPort].every(port => /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535)) {
  throw new Error('Playwright requires valid loopback ports.');
}
const frontend = 'http://127.0.0.1:' + frontendPort;
const backend = 'http://127.0.0.1:' + backendPort;
const inheritedStore = process.env.RH_TEST_RUN_PROJECT_STORE;
const projectStore = inheritedStore ?? mkdtempSync(join(tmpdir(), 'rh-playwright-repair-'));
if (!inheritedStore) {
  process.env.RH_TEST_RUN_PROJECT_STORE = projectStore;
  // Workers inherit this path. Only the process that created it owns cleanup.
  process.once('exit', () => {
    rmSync(projectStore, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
}
process.env.RH_CINEMATIC_URL = frontend;

export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.RH_TEST_PROJECT_MATRIX === '1' ? ['rh-phase51-project-matrix.spec.ts', 'rh-survey-setup.spec.ts'] : [
    'rh-repair.spec.ts',
    'rh-local-cad-import-and-library.spec.ts',
    'rh-survey-setup.spec.ts',
    'rh-studio-workflow.spec.ts',
    'rh-phase4a-cad-workflow.spec.ts',
    'rh-phase4b-bim-workflow.spec.ts',
    'rh-phase5-unified-studio.spec.ts',
  ],
  timeout: 90_000,
  workers: 1,
  use: { baseURL: frontend, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node ../backend/dist-server/server.cjs',
      url: backend + '/api/v1/health',
      env: { PORT: backendPort, RH_API_HOST: '127.0.0.1', RH_API_TOKEN: '', GEMINI_API_KEY: '',
        RH_API_ALLOWED_ORIGINS: frontend, RH_LOCAL_PROJECTS_DIR: projectStore },
    },
    {
      command: 'pnpm exec vite preview --host 127.0.0.1 --port ' + frontendPort + ' --strictPort',
      url: frontend,
      env: { VITE_API_PROXY_TARGET: backend },
    },
  ],
});
