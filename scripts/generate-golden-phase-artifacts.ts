/** Architectural artifacts are produced by the actual planner/validator/exporter. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const runner=path.resolve('node_modules/vitest/vitest.mjs');
const result=spawnSync(process.execPath,[runner,'run','tests/apartment-geometry-closure.test.ts'],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
