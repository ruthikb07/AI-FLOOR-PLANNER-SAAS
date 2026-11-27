# Awatif Source Audit (`Phase A1`)

## 1. Upstream Repository Provenance

| Attribute | Value |
|---|---|
| Upstream Repository | `https://github.com/madil4/awatif.git` |
| Inspected Checkpoint Commit | `a9017ec55343c07cb0c5f0e832b3214f97106641` |
| Upstream Version | `3.4.0` |
| License | `MIT` (`Copyright (c) 2025 Mohamed Adil`) |
| Embedded `lSolver.cpp` SHA-256 | `BDF03AEC63D2CAE007CFD41B30A8F7842DAD5FF18E743CD38046CCA55676A241` |
| Embedded `lSolver.wasm` SHA-256 | `BED1520293A560787CDB7088F2AD188E8E195F0051DDF084403EBDC65BB41DC1` |
| Embedded `lSolver.js` SHA-256 | `3037087FC9711461B1AA32D870893586FADEBB258D9AF4249AD117654F38FCFD` |

## 2. Package & Directory Map of Awatif `v3.4.0`

1. **`components/` (`@awatif/components`):**
   - `data-model.ts`: Reactive VanJS `State<T>` wrappers around `Geometry`, `Mesh` (`nodes`, `elements`, `supports`, `loads`, `elementsProps`, `releases`, `positions`, `internalForces`, `reactions`), and `Components`.
   - `analysis/l-solver/cpp/lSolver.cpp` & `built/{lSolver.js, lSolver.wasm}`: **Production C++/Eigen `SparseLU` WebAssembly 3D linear frame solver** (`_lSolve`, `_malloc`, `_free`).
   - `analysis/l-solver/getPositionsAndForcesCpp.ts`: JavaScript/Emscripten typed-array pointer wrapper around `_lSolve`.
   - `analysis/l-solver/getPositionsAndForces.ts` & `helpers/`: Reference TypeScript direct-stiffness solver using `mathjs` (`getLocalStiffnessMatrix`, `getTransformationMatrix`, `getGlobalStiffnessMatrix`).
   - `analysis/l-solver/getReactions.ts`: Nodal reaction recovery from `kGlobal * dxGlobal - F_applied`.
   - `loads/getLoads.ts`, `supports/getSupports.ts`, `releases/getReleases.ts`, `local-axes/getLocalAxes.ts`, `mesh/getMesh.ts`: Pre-processing helpers.
   - `design/generic-member/genericMember.ts`: Basic unfactored axial/moment interaction ratio template (`N/N_cap + My/My_cap + Mz/Mz_cap`).
2. **`ui/` (`@awatif/ui`) & `templates/` (`templates/runAnalysis.ts`):**
   - Standalone VanJS (`vanjs-core`) + `lit-html` + Three.js web viewer shell.
   - **Prohibited Remote Reference Detected (`templates/runAnalysis.ts:11,138`):** Imports `getNlPositionsAndForcesRemote` for remote nonlinear cloud execution.

## 3. Exact Mathematical & Engineering Audit Findings

1. **Element Formulation:**
   - 2-node, 6-DOF-per-node (`[ux, uy, uz, rx, ry, rz]`, 12 DOFs total) 3D prismatic Euler-Bernoulli space-frame element with axial (`EA/L`), biaxial flexure (`12EIy/L³`, `12EIz/L³`), and Saint-Venant torsion (`GJ/L`). Shear deformation (Timoshenko) and plate/shell elements are **not** present in Awatif `v3.4.0`.
2. **Local Coordinate Convention (`lSolver.cpp:53-83`):**
   - `x_local` runs from start node `n0` to end node `n1`.
   - For non-vertical members (`|n| < 1`): `y_local = (-m/D, l/D, 0)` (horizontal), `z_local = (-l*n/D, -m*n/D, D)` (`+Z` upward when horizontal). Hence **vertical gravity bending on horizontal beams is governed by `Iy` and `My` / `Vz`**.
   - For upward vertical columns (`n = +1`): `x_local = +Z`, `y_local = +Y`, `z_local = -X`.
3. **Section-Force Sign Convention (`lSolver.cpp:416-430`):**
   - `N = [fLocal(0), -fLocal(6)]` (positive = compression),
   - `Vy = [-fLocal(1), fLocal(7)]`, `Vz = [-fLocal(2), fLocal(8)]`,
   - `Mx = [fLocal(3), -fLocal(9)]`,
   - `My = [-fLocal(4), fLocal(10)]` (positive = hogging / top tension on horizontal beams; negative = sagging / bottom tension; satisfies `dMy/dx = Vz`),
   - `Mz = [-fLocal(5), fLocal(11)]`.
4. **Three Upstream Limitations Remediated in RH Planner's `@ai-floor-planner/structural-engine`:**
   - **Distributed-load Fixed-End Forces (`FEF`):** Upstream `getLoads.ts` lumped line loads as `[qL/2, qL/2, 0, 0, 0, 0]` without fixed-end moments `±qL²/12`. RH Planner computes exact statically condensed `f_FEF` for uniform/trapezoidal and point member loads, passes equivalent nodal loads `F_eq = F_nodal - sum(T^T f_FEF)` into `lSolver.wasm`, and superimposes `f_FEF` + particular integral curves across 11+ stations!
   - **Nodal Rotation Output:** `lSolver.cpp` computes full 6-DOF deformations internally in Eigen `SparseLU` (`deformations`), but `positions_out` only exports `[x+ux, y+uy, z+uz]`. RH Planner recovers the exact nodal rotations `[rx, ry, rz]` from rotational equilibrium `K_rr u_r = F_r - K_rt u_t_wasm` and verifies the full 6-DOF free stiffness residual `||K_ff u_f - F_f|| / ||F_f|| <= 1e-12`.
   - **WASM Heap Growth Safety & Build Portability:** Upstream `getPositionsAndForcesCpp.ts` cached `mod.HEAPF64` before `_malloc` (unsafe across `_emscripten_resize_heap`), and `components/package.json` hardcoded `-I /Users/mohamed/Applications/eigen/`. RH Planner refreshes Emscripten heap views after every `_malloc` and provides portable `scripts/build-awatif-wasm.mjs` using `EIGEN3_INCLUDE_DIR`.

## 4. Inclusion / Exclusion Decision Matrix

| Awatif Module | Decision | Reason |
|---|---|---|
| `lSolver.cpp`, `lSolver.wasm`, `lSolver.js` | **EMBEDDED (`packages/structural-engine/src/wasm/`)** | Verified C++/Eigen `SparseLU` 3D linear frame solver |
| Direct-stiffness math & release condensation | **RE-ENGINEERED ZERO-DEP TS (`src/math/frame-mechanics.ts`)** | Eliminates heavy `mathjs` runtime dependency; adds exact `FEF` & arbitrary roll angle `beta` |
| `@awatif/ui`, `vanjs-core`, `lit-html`, `templates/` | **EXCLUDED** | RH Planner uses its own unified React/Three.js ARGON Studio |
| `getNlPositionsAndForcesRemote` | **STRICTLY PROHIBITED & EXCLUDED** | Violates local offline solver architecture |
| `genericMember.ts` | **REPLACED** | Replaced with clause-traceable Indian Standard (`IS 456` / `IS 13920` / `IS 1904`) RCC & Foundation engines |
