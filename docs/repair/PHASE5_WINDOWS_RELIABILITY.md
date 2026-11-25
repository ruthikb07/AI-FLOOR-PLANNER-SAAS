# Phase 5 Gate A — Windows Studio, Download & Native BIM Reliability Report

## 1. Scope & Baseline Protection (Gate A3)

- **Branch:** `feat/phase5-professional-architectural-studio`
- **Verified Base Commit:** `a833799b77e3df603427f0a8d347f2fb6c4e7d84` (`feat/phase4b-openbim-ifc-integration`, descending from `a6885a175a3ad18779e61d852aa8c19b7447b8a9` and Phase 4A.1 `dc2e3ca777381b74a45297fc595a0b5cb0656e9d`).
- **Clean Non-OneDrive Worktree:** `C:\Users\ruthi\rh-planner-phase5` (isolated from OneDrive file locks and open-editor sync overwrites; original operator checkouts preserved untouched).

---

## 2. Gate A1 — Root-Cause Diagnosis & Permanent Repairs

### Finding 1: Archived Browser Revision Download Timeout on Windows (`storage.ts` & `ProjectPortfolio.tsx`)
- **Root Cause:**
  1. `exportProjectAsJsonFile()` in `packages/frontend/src/services/storage.ts` called `a.click(); URL.revokeObjectURL(url);` synchronously on consecutive lines without appending `<a>` to `document.body`. Under Windows CPU load during full E2E runs, Chromium's out-of-process download manager processed the blob navigation IPC *after* `URL.revokeObjectURL(url)` had already destroyed the blob handle, dropping the download and hanging `page.waitForEvent('download')`.
  2. `BrowserRevisionArchive` (`packages/frontend/src/components/argon/ProjectPortfolio.tsx`) ran `JSON.parse(entry.payload)` on multi-MB IndexedDB archive strings only for `exportProjectAsJsonFile` to immediately run `serializeBuilding(...)`, `JSON.parse(...)`, and `JSON.stringify(..., null, 2)` synchronously on the main UI thread.
- **Permanent Fix:**
  - Added `triggerJsonBlobDownload()` in `packages/frontend/src/services/storage.ts` which mounts a hidden `<a>`, triggers `.click()`, removes the element, and defers `URL.revokeObjectURL(url)` by `10,000 ms`.
  - Added `exportArchivedProjectPayloadAsJsonFile(payload, projectId, version)` so `BrowserRevisionArchive` streams the already-validated archived JSON string directly into a `Blob` with zero main-thread JSON re-parsing.
- **Verified Windows Timing:** `rh-repair.spec.ts` (`archives the previous IndexedDB data`) improved from `23.9 s` (and intermittent timeout in Phase 4B) to **`10.1 s`** (`100%` pass).

### Finding 2: Extended Windows Studio Orbit & Software WebGL Fill-Rate (`ThreeBuildingScene.tsx` & `rh-studio-workflow.spec.ts`)
- **Root Cause:**
  1. `rh-studio-workflow.spec.ts` launches Chromium with `--enable-unsafe-swiftshader` (CPU software WebGL) and mounts three 3D scenes sequentially (`ConceptModel` -> `FloorIsometricEditor` -> `Tower 3D`). `ThreeBuildingScene.tsx` previously rendered CPU SwiftShader at `pixelRatio = min(dpr, 1.5)` (`2160 × 1350`) with `1536 × 1536` `PCFSoftShadowMap`.
  2. In `rh-studio-workflow.spec.ts`, the `MutationObserver` frame counter (`sampleFrames++ < 120`, ~2 seconds at 60 Hz) was registered *before* `tower.boundingBox()` and mouse positioning, risking observer disconnection under heavy Windows CPU/trace load before software WebGL completed 9 orbit frames.
- **Permanent Fix:**
  - Added `WEBGL_debug_renderer_info` software-rasterizer detection (`SwiftShader` / `llvmpipe` / `Basic Render Driver`) in `ThreeBuildingScene.tsx`, capping software rasterizers to `pixelRatio = 1` and `1024 × 1024` `PCFShadowMap` while preserving `min(dpr, 1.5)` and `1536 × 1536` `PCFSoftShadowMap` on hardware GPUs, preserving `maxPerFrame === 1` rAF render coalescing, and preserving deterministic WebGL context loss/restoration.
  - Updated `rh-studio-workflow.spec.ts` to capture stage-by-stage millisecond telemetry (`startup`, `setup`, `generate`, `concept_3d`, `alternative`, `floor_3d`, `tower_3d_first_frame`, `tower_3d_orbit`, `glb_export`, `save_reload`) and start the `360`-frame orbit `MutationObserver` immediately before `mouse.down()`.

---

## 3. Verified Windows Browser & WebGL Telemetry

### Consecutive Isolated Windows `rh-studio-workflow.spec.ts` Runs (`--repeat-each=2`)
| Stage | Run 1 Cumulative (`ms`) | Run 2 Cumulative (`ms`) |
| --- | ---: | ---: |
| `startup` | `686` | `644` |
| `setup` | `1,434` | `1,573` |
| `generate` | `4,735` | `11,034` |
| `concept_3d` | `5,409` | `11,761` |
| `alternative` | `13,269` | `38,582` |
| `floor_3d` | `18,574` | `44,014` |
| `tower_3d_first_frame` | `21,165` | `46,883` |
| `tower_3d_orbit` | `48,619` | `71,866` |
| `glb_export` | `55,980` | `82,015` |
| `save_reload` | `57,813` | `83,673` |

- **Coalesced Orbit Render Budget:**
  - Run 1: `atOrbit: { renders: 33, maxPerFrame: 1 }`, `afterOrbit: { renders: 39, maxPerFrame: 1 }`
  - Run 2: `atOrbit: { renders: 31, maxPerFrame: 1 }`, `afterOrbit: { renders: 37, maxPerFrame: 1 }`
- **Renderer Resource Footprint:** `drawCalls: 183`, `triangles: 164,714`, `geometries: 112`, `textures: 10`, `pageerror: []`.

### 5-Cycle Real Chromium WebGL Context Restoration (`rh-webgl-recovery.spec.ts`)
- **Tower 3D Cycles 1 & 2:** Restored in `1` frame (`51` GL draws), `geometries: 27 -> 27`, `textures: 9 -> 9`, pixel-identical screenshot match (`restoredView.equals(expectedView) === true`), context cleanly released on workspace switch (`detached: true, contextLost: true`).
- **Floor 3D Cycles 3 & 4:** Restored in `1` frame (`57` GL draws), `geometries: 32 -> 32`, `textures: 9 -> 9`, context cleanly released on project switch.
- **Second Project Tower Cycle 5:** Restored in `1` frame, context cleanly released on return to 2D CAD (`0` page errors).

---

## 4. Gate A2 — Native Desktop BIM & Independent IFC4 Verification Status

- **Independent `IfcOpenShell 0.9.0.post1` Verification (Windows Python 3.12.13 + Ubuntu CI):** **VERIFIED** across all 11 canonical IFC4 fixtures (`bungalow.ifc`, `compact.ifc`, `edited-window.ifc`, `flats-3.ifc`, `flats-5.ifc`, `flats-6.ifc`, `rotunda-mixed.ifc`, `single.ifc`, `stilt-multi.ifc`, `strict-unequal.ifc`, `survey-oblique.ifc`) with `0.0 mm` endpoint/opening/elevation drift and `<= 0.30 mm` curved-wall chord tolerance.
- **Local Desktop Tooling Probed on Host:**
  - **Autodesk AutoCAD 2021 (`accoreconsole.exe`):** Installed (`C:\Program Files\Autodesk\AutoCAD 2021\accoreconsole.exe`) — used for native DWG/DXF zero-error audits.
  - **Blender 5.2.1:** Installed (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`; Bonsai/BlenderBIM IFC add-on is **not** installed: `BLENDER_IFC_ADDONS = []`).
  - **CSI ETABS 23.3.2:** Installed.
  - **FreeCAD / Bonsai / Autodesk Revit / Graphisoft Archicad:** **Not installed** on this machine.
- **Honest Native Desktop BIM Reopen Status:** **`UNVERIFIED`** (no desktop IFC authoring client is installed locally; independent schema + 3D solid triangulation readback is verified via `IfcOpenShell 0.9.0.post1`).
