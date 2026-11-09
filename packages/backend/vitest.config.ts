import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ai-floor-planner/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@ai-floor-planner/geometry-engine': path.resolve(__dirname, '../geometry-engine/src/index.ts'),
      '@ai-floor-planner/constraint-engine': path.resolve(__dirname, '../constraint-engine/src/index.ts'),
      '@ai-floor-planner/planning-engine': path.resolve(__dirname, '../planning-engine/src/index.ts'),
      '@ai-floor-planner/renderer': path.resolve(__dirname, '../renderer/src/index.ts'),
      '@ai-floor-planner/projection-3d': path.resolve(__dirname, '../projection-3d/src/index.ts'),
      '@ai-floor-planner/ai-orchestration': path.resolve(__dirname, '../ai-orchestration/src/index.ts'),
    },
  },
  test: {
    name: '@ai-floor-planner/backend',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['src/__tests__/real-provider-smoke.test.ts', 'node_modules/**'],
  },
});
