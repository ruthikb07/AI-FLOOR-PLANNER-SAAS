import path from 'path';
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  {
    resolve: {
      alias: {
        '@ai-floor-planner/constraint-engine': path.resolve(__dirname, 'packages/constraint-engine/src/index.ts'),
        '@ai-floor-planner/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
        '@ai-floor-planner/geometry-engine': path.resolve(__dirname, 'packages/geometry-engine/src/index.ts'),
        '@ai-floor-planner/planning-engine': path.resolve(__dirname, 'packages/planning-engine/src/index.ts'),
        '@ai-floor-planner/renderer': path.resolve(__dirname, 'packages/renderer/src/index.ts'),
        '@ai-floor-planner/projection-3d': path.resolve(__dirname, 'packages/projection-3d/src/index.ts'),
        '@ai-floor-planner/ai-orchestration': path.resolve(__dirname, 'packages/ai-orchestration/src/index.ts'),
      },
    },
    test: {
      name: 'integration',
      include: ['tests/**/*.test.ts'],
    },
  },
]);
