import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
        '@ai-floor-planner/geometry-engine': path.resolve(__dirname, '../geometry-engine/src/index.ts'),
        '@ai-floor-planner/planning-engine': path.resolve(__dirname, '../planning-engine/src/index.ts'),
        '@ai-floor-planner/constraint-engine': path.resolve(__dirname, '../constraint-engine/src/index.ts'),
      '@ai-floor-planner/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    name: '@ai-floor-planner/ai-orchestration',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
