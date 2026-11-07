import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
        '@ai-floor-planner/constraint-engine': path.resolve(__dirname, '../constraint-engine/src/index.ts'),
      '@ai-floor-planner/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@ai-floor-planner/geometry-engine': path.resolve(__dirname, '../geometry-engine/src/index.ts'),
    },
  },
  test: {
    name: '@ai-floor-planner/planning-engine',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
