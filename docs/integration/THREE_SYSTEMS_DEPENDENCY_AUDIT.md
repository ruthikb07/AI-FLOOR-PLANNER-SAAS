# Three-Systems Dependency & Runtime Compatibility Audit

## 1. Framework & Toolchain Alignment

| Layer | RH Planner (Host) | Cota v2.49.3 | OpenBIM Studio v0.74.0 | Unified Monorepo Resolution |
| --- | --- | --- | --- | --- |
| **Package Manager** | `pnpm@9.7.0` + `turbo@2.0.14` | `npm` | `npm` | **`pnpm@9.7.0` + `turbo@2.0.14`** (`packages/*` workspace) |
| **TypeScript** | `5.5.4` | `5.7.2` | `5.6.3` | **`5.5.4`** across all workspace packages |
| **Bundler** | `vite@5.4.1` | `vite@8.3.5` | `vite@8.3.6` | **Single `vite@5.4.1` server/build** in `@ai-floor-planner/frontend` |
| **UI Runtime** | `react@18.3.1` | `react@19.3.1` | `react@18.3.1` + `@mui/material` | **Single `react@18.3.1` root**; external UI shells not mounted |
| **3D Engine** | `three@0.185.1` | `three@0.169.0` | `three@0.182.0` | **Shared `three@0.185.1`** across host, Cota viewport, and OpenBIM BVH/GJK |
| **State Management** | `EditorEngine` + external-store hooks | `zustand@5.0.16` | `@reduxjs/toolkit@2.14.0` | **`EditorEngine` + `unified-workspace-store.ts`** (no Redux, no competing globals) |

---

## 2. Package-by-Package Dependency Decisions

### Adopted / Shared MIT Dependencies
| Package | Version | License | Used By | Purpose |
| --- | --- | --- | --- | --- |
| `three` | `^0.185.1` | MIT | `frontend`, `cota-integration`, `openbim-integration` | Unified 3D rendering, CAD viewports, raycasting, and BVH/GJK math |
| `three-mesh-bvh` | `^0.8.0` / `^0.7.8` | MIT | `cota-integration` | Accelerated mesh raycasting and CSG triangle spatial indexing |
| `three-bvh-csg` | `^0.0.16` | MIT | `cota-integration` | Browser-native 3D boolean `UNION`, `SUBTRACT`, `INTERSECT`, and `SLICE` solids |
| `polygon-clipping` | `0.15.7` | MIT | `cota-integration` | 2D polygon boolean operations for `HATCH`, `BOUNDARY`, and `REGION` |
| `fflate` | `0.8.3` | MIT | `cota-integration`, `openbim-integration` | Vector PDF stream deflate compression, `.bcfzip` archives, and COBie `.zip` |
| `@node-projects/acad-ts` | `^3.6.0` / `^3.2.0` | MIT | `backend`, `cota-integration` | Pure-TypeScript `AC1032` DWG reader and writer |
| `pdf-lib` | `1.17.1` | MIT | `backend` | Existing architectural & structural report PDF generation |

### Explicitly Rejected Dependencies (Not Installed)
| Upstream Dependency | Upstream Source | Reason for Rejection |
| --- | --- | --- |
| `occt-wasm@5.17.1`, `occt-import-js@^0.0.23` | Cota / OpenBIM | LGPL-2.1 ~15 MB WebAssembly binaries; replaced by pure-TS `three-bvh-csg` mesh solid kernel (`SOLIDKERNEL MESH`) and pure-TS STEP/IGES geometry readers |
| `@mlightcad/libredwg-web`, `LibreDWG` CLI | OpenBIM / Cota API | GPL-3.0 / heavy WASM; `@node-projects/acad-ts` (MIT) already handles DWG read/write |
| `@thatopen/*`, `web-ifc@0.0.77` | OpenBIM | MPL-2.0 WASM worker coupling & Three.js version pinning; RH Planner + OpenBIM pure-TS STEP/IFC4/IFC4X3 semantic reader & `ThreeBuildingScene` cover IFC workflows without WASM header issues |
| `@mui/*`, `@emotion/*`, `@reduxjs/toolkit`, `monaco-editor`, `tesseract.js`, `@tldraw/editor`, `yjs` | OpenBIM | Massive bundle bloat and competing UI/state frameworks; ARGON Studio Tailwind/Lucide design system is used uniformly |
| Python FastAPI + SQLModel + Alembic (`services/api`) | Cota | Duplicate auth, user DB, and LLM server; RH Planner's Node/TS `@ai-floor-planner/backend` remains the single backend |

---

## 3. Worker, Asset & Memory Lifecycle Requirements

1. **No Mandatory External WASM or CDN Fetches:** All CAD, CSG, hatch, vector PDF, IFC semantic, IDS, BCF, and COBie operations run 100% locally in TypeScript without external CDN requests (`CSP`-safe, offline-capable).
2. **Scoped WebGL Contexts:** `CotaWorkspace` creates its Three.js `Viewport` instances only while mounted and disposes every `WebGLRenderer`, `BufferGeometry`, `Material`, and `Texture` in `unmount()` so switching between `Tower 3D`, `Floor 3D`, `BIM Studio`, and `Professional CAD` never leaks WebGL contexts.
3. **Worker Cleanup:** IFC reference/clash workers (`ifc-reference.worker.ts`) and CAD import tasks use `AbortSignal` + `worker.terminate()` on workspace unmount or project switch.
