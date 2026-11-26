# Awatif License and Dependency Audit (`Phase A4`)

## 1. Third-Party Licenses Audited

| Component | Version / Commit | License | Compatibility & Obligation |
|---|---|---|---|
| **Awatif** (`madil4/awatif`) | `v3.4.0` (`a9017ec55343c07cb0c5f0e832b3214f97106641`) | **MIT** (`Copyright (c) 2025 Mohamed Adil`) | Fully permissive; license text preserved at `docs/integration/licenses/awatif-MIT.txt` and attributed in root `NOTICE`. |
| **Eigen C++ Templates** (`Eigen/Dense`, `Eigen/Sparse`, `Eigen/SparseLU`) | `3.4.x` (compiled inside `lSolver.wasm`) | **MPL-2.0** | Header-only C++ template library; MPL-2.0 permits static/WASM compilation into proprietary or commercial works while keeping C++ kernel source (`lSolver.cpp`) documented and attributed in `NOTICE`. |
| **Emscripten JS Runtime Glue** (`lSolver.js`) | Emscripten ES6 module runtime | **MIT / University of Illinois NCSA Dual License** | Permissive runtime loader; supports Node.js, Browser, and Web Worker without external CDN requests. |

## 2. Excluded Awatif Dependencies (Zero Bloat Policy)

Awatif's upstream workspace depended on `vanjs-core`, `lit-html`, `mathjs`, `@awatif/ui`, and `@awatif/components`. None of those packages were added to RH Planner's `package.json`:

- `vanjs-core` / `lit-html`: **Excluded** — UI renders natively inside RH Planner's React + Three.js ARGON Structural Studio.
- `mathjs`: **Excluded** — Replaced by compact typed Float64 linear algebra in `packages/structural-engine/src/math/frame-mechanics.ts`.
- Remote solver endpoints (`getNlPositionsAndForcesRemote`): **Excluded** — Zero external network dependencies.

## 3. Reproducible Portable WASM Build Configuration

Upstream `awatif/components/package.json` contained a macOS developer-specific path (`-I /Users/mohamed/Applications/eigen/`).
RH Planner replaces this with `packages/structural-engine/scripts/build-awatif-wasm.mjs` (`pnpm --filter @ai-floor-planner/structural-engine run build:wasm`), which resolves Eigen headers portably via:

1. `process.env.EIGEN3_INCLUDE_DIR`
2. `packages/structural-engine/vendor/eigen`
3. `/usr/include/eigen3` or `/usr/local/include/eigen3`

When Emscripten (`emcc`) is not installed on a developer workstation, the SHA-256-verified `lSolver.js` and `lSolver.wasm` artifacts from Awatif `v3.4.0` (`a9017ec55343c07cb0c5f0e832b3214f97106641`) are copied deterministically to `dist/wasm/` via `scripts/copy-wasm-assets.mjs`.
