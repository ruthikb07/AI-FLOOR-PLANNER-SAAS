import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(scriptDir, '..');
const srcWasmDir = resolve(pkgRoot, 'src', 'wasm');
const distWasmDir = resolve(pkgRoot, 'dist', 'wasm');

mkdirSync(distWasmDir, { recursive: true });
for (const filename of ['lSolver.js', 'lSolver.d.ts', 'lSolver.wasm']) {
  copyFileSync(resolve(srcWasmDir, filename), resolve(distWasmDir, filename));
}
