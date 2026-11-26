#!/usr/bin/env node
/**
 * Reproducible portable WebAssembly build script for Awatif lSolver.cpp.
 * Replaces upstream hardcoded developer path (/Users/mohamed/Applications/eigen/)
 * with portable EIGEN3_INCLUDE_DIR discovery.
 *
 * Usage:
 *   EIGEN3_INCLUDE_DIR=/path/to/eigen-3.4.0 node ./scripts/build-awatif-wasm.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(scriptDir, '..');
const cppSource = resolve(pkgRoot, 'src', 'wasm', 'lSolver.cpp');
const outJs = resolve(pkgRoot, 'src', 'wasm', 'lSolver.js');

const candidateEigenDirs = [
  process.env.EIGEN3_INCLUDE_DIR,
  resolve(pkgRoot, 'vendor', 'eigen'),
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

const emccCmd = process.platform === 'win32' ? 'emcc.bat' : 'emcc';
const args = [
  cppSource,
  '-o',
  outJs,
  `-I${eigenInclude}`,
  '-O3',
  '-msimd128',
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sENVIRONMENT=web,worker,node',
  '-sEXPORTED_FUNCTIONS=["_lSolve","_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPF64","HEAP32","HEAPU8","HEAPU32"]',
];

console.log(`[build-awatif-wasm] Compiling ${cppSource} with Eigen from ${eigenInclude}...`);
execFileSync(emccCmd, args, { stdio: 'inherit' });
console.log(`[build-awatif-wasm] Successfully built ${outJs} and lSolver.wasm`);
