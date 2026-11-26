# OpenBIMStudio source and license audit

| Field | Verified value |
| --- | --- |
| Archive | `openBIMstudio-main.zip`, 27,098,065 bytes, 2,182 ZIP entries |
| SHA-256 | `a43193a02c5f444722e247a6ad6c9b98789ae235d6533a37ebc8b60cc167c959` |
| Upstream | [amdghedy/openBIMstudio](https://github.com/amdghedy/openBIMstudio) |
| Revision | [22fc82481331abaab2825cd4e898ca65bfe53fa8](https://github.com/amdghedy/openBIMstudio/commit/22fc82481331abaab2825cd4e898ca65bfe53fa8) from the ZIP comment. The archived license, manifest, GlobalId helpers, STEP preflight and triangle BVH matched raw upstream bytes at this revision. |
| Version and license | Package `open-bim-studio` 0.74.0. MIT, copyright 2026 Amdghedy. The original license accompanies the adapted code. |

## Source review and reuse

- `bim-gaps/authored-ifc.ts` has a native writer but depends on OpenBIMStudio element geometry, twin export logic and wall sweeps. Its model entities and units require translation. The canonical adapter writes directly from RH Planner types.
- `bim-gaps/ifc-guid.ts` contains dependency-free compressed GUID helpers. This integration adapts the compression and validation functions, with RH Planner's SHA-256 namespace and duplicate checks.
- `ifc-semantics` includes a pure STEP reader, unit resolution, preflight, semantic report and import timeout. Upstream tests cover malformed STEP, dangling references and duplicate GUIDs. Those files are reference material.
- `clash/geometry.ts` uses Three.js and the application context. `triangle-bvh.ts` and `gjk.ts` are narrower candidates. Upstream has clash/type/independent IFC tests. Those tests describe its own integration.
- `schedules`, `cost/qto-rules.ts`, `federation/manager.ts`, `export/bcf21.ts` and `bcf/bcf3-schema.ts` contain schedule, federation and issue logic coupled to upstream selection, persistence or model identity. The corresponding RH Planner capabilities require separate acceptance.

## Runtime and third-party boundary

Upstream declares React 18.3, Three.js 0.182, Vite 8, TypeScript 5.6, Redux Toolkit and web-ifc 0.0.77. RH Planner uses React 18.3, Three.js 0.185, Vite 5, TypeScript 5.5 and Zustand. Upstream uses web-ifc WASM and worker assets under MPL-2.0, OpenCascade WASM under LGPL-2.1, rvt-rs WASM with Apache-2.0 notices, Rhino3dm WASM with MIT attribution, and separate CAD and LibreDWG WASM build assets. These dependencies and independent executables are outside the runtime integration. Hosted account services, native twin reconstruction, RVT, MEP calculation, BCF, and plugins were not adopted. Existing Cota and Noto obligations remain in the root notice.
