import { defineConfig } from '@playwright/test';
import repairConfig from './playwright.repair.config';

export default defineConfig({
  ...repairConfig,
  testMatch: 'rh-webgl-recovery.spec.ts',
});
