#!/usr/bin/env node
/**
 * Reproducible portable WebAssembly build script for Awatif lSolver.cpp (Milestone 5.1 Gate 1).
 *
 * Key link flags:
 * - `-sSTACK_SIZE=8388608` (8 MB C execution stack; fixes the upstream 64 KB stack overflow
 *   in Eigen::SparseLU / COLAMD on >= 1,296-node 3D building frames!)
 * - `-sINITIAL_MEMORY=33554432` (32 MB initial linear memory) + `-sALLOW_MEMORY_GROWTH=1`
 * - Exports both `_lSolveBatch` (factor-once-solve-many 6-DOF solver) and `_lSolve` (upstream API)
 *   plus Emscripten stack inspection functions for runtime diagnostics.
 *
 * Usage:
 *   EIGEN3_INCLUDE_DIR=/path/to/eigen-3.4.0 node ./scripts/build-awatif-wasm.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(scriptDir, '..');
const cppSource = resolve(pkgRoot, 'src', 'wasm', 'lSolver.cpp');
const outJs = resolve(pkgRoot, 'src', 'wasm', 'lSolver.js');

const candidateEigenDirs = [
  process.env.EIGEN3_INCLUDE_DIR,
  resolve(pkgRoot, 'vendor', 'eigen'),
  join(tmpdir(), 'eigen-3.4.0'),
  '/usr/include/eigen3',
  '/usr/local/include/eigen3',
].filter(Boolean);

const eigenInclude = candidateEigenDirs.find((dir) => existsSync(resolve(dir, 'Eigen', 'SparseLU')));
if (!eigenInclude) {
  console.error(
    '[build-awatif-wasm] Eigen3 headers (Eigen/SparseLU) not found. Set EIGEN3_INCLUDE_DIR to your Eigen 3.4+ include path.',
  );
  process.exit(1);
}

mkdirSync(dirname(outJs), { recursive: true });

const args = [
  cppSource,
  '-o',
  outJs,
  `-I${eigenInclude}`,
  '-O3',
  '-msimd128',
  '-sDEFAULT_TO_CXX=1',
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sINITIAL_MEMORY=33554432',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sMAXIMUM_MEMORY=1073741824',
  '-sSTACK_SIZE=8388608',
  '-sENVIRONMENT=web,worker,node',
  '-sEXPORTED_FUNCTIONS=_lSolve,_lSolveBatch,_malloc,_free,_emscripten_stack_get_base,_emscripten_stack_get_end,_emscripten_stack_get_current',
  '-sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32,HEAPU8,HEAPU32',
];

const emsdkRoot = process.env.EMSDK || join(tmpdir(), 'emsdk-portable');
const emccPy = join(emsdkRoot, 'upstream', 'emscripten', 'em++.py');

if (process.platform === 'win32' && existsSync(emccPy)) {
  const pyDir = join(emsdkRoot, 'python');
  let pyBin = process.env.EMSDK_PYTHON || 'python';
  if (!process.env.EMSDK_PYTHON && existsSync(pyDir)) {
    const sub = readdirSync(pyDir)[0];
    if (sub && existsSync(join(pyDir, sub, 'python.exe'))) {
      pyBin = join(pyDir, sub, 'python.exe');
    }
  }
  console.log(`[build-awatif-wasm] Compiling ${cppSource} via ${pyBin} ${emccPy} (Eigen: ${eigenInclude})...`);
  execFileSync(pyBin, [emccPy, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      EMSDK: emsdkRoot,
    },
  });
} else {
  const emccCmd = process.env.EMCC_BIN || (process.platform === 'win32' ? 'em++.bat' : 'em++');
  console.log(`[build-awatif-wasm] Compiling ${cppSource} via ${emccCmd} (Eigen: ${eigenInclude})...`);
  execFileSync(emccCmd, args, { stdio: 'inherit' });
}

console.log(`[build-awatif-wasm] Successfully built ${outJs} and lSolver.wasm`);
