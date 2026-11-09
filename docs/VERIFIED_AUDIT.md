# ARGON 4 — Verified Technical Baseline Audit

> **Audit Date:** 2026-11-10  
> **Auditor:** Lead Software Architect, AI-FLOOR-PLANNER-SAAS  
> **Repository:** [https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS)  
> **Git Anchor:** Commit `a2370d5` (`feat: complete ARGON 4 Phase 1 & 2 geometry, synthesis, and Stage 6A studio intake`)  
> **Toolchain:** Node.js `v24.18.0`, pnpm `9.7.0`, TypeScript `5.5.4`, Vite `5.4.21`, Turbo `2.0.14`, Vitest `2.0.5`  
> **Governance:** `AGENTS.md` (Sole Authority of Canonical Model, Evidence Freshness, Zero Fabricated Assumptions)

---

## 1. Executive Summary

A comprehensive architectural and diagnostic audit was executed across all packages in the `ai-floor-planner` monorepo.

### Verification Summary
- **Monorepo Structure:** 9 interdependent workspace packages under `pnpm@9.7.0` and `turbo@2.0.14`.
- **Package Installation:** `pnpm install --frozen-lockfile` passed with zero errors (`Lockfile is up to date, 10 workspace projects`).
- **Static Typecheck:** `pnpm typecheck` passed with **16/16 tasks successful (0 errors)** across all packages.
- **Production Compilation:** `pnpm build` passed with **9/9 packages built cleanly**, including the standalone CJS backend bundle (`dist-server/server.cjs`) and Vite frontend asset bundle (`dist/`).
- **Linting:** `pnpm lint` passed with **16/16 tasks successful (0 errors, 0 warnings)**.
- **Test Suite Results:**
  - **1,607 passing tests** across **186 test files**.
  - **1 failing test** in `packages/backend/src/__tests__/real-provider-smoke.test.ts` due to an expired/offline live Gemini API key in local environment.
  - **5 skipped tests** (live network/provider integration suites).

---

## 2. Monorepo Architecture & Actual Entry Points

```
packages/
├── core/                  # Canonical Building Model, domain entities, commands
├── geometry-engine/       # Planar polygon algebra, raw area conservation
├── constraint-engine/     # Hard & soft architectural validators, scoring
├── planning-engine/       # Multi-story synthesis, space snapper, UDCPR solver
├── ai-orchestration/      # Cloudflare FLUX & Gemini vision transport/prompts
├── renderer/              # 2D SVG rendering, dimensions, layers, symbols
├── projection-3d/         # 3D Three.js projections, Blender 5.2 procedural script generator
├── backend/               # Node HTTP server (port 4200), CAD accoreconsole runner, exports
└── frontend/              # React 18 SPA (port 3000), ARGON Studio interface
```

### Package Entry Points and Direct Dependencies

| Package | Entry Point (`main` / `types`) | Key Internal Workspace Dependencies | Core Role |
| :--- | :--- | :--- | :--- |
| `@ai-floor-planner/core` | `./dist/index.js`<br>`./dist/index.d.ts` | None (`@noble/hashes`) | Canonical `Building`, `Floor`, `Room`, `Wall`, `Opening`, `Column`, `Beam`, `Staircase`, UDCPR types, undoable commands. |
| `@ai-floor-planner/geometry-engine` | `./dist/index.js`<br>`./dist/index.d.ts` | `@ai-floor-planner/core` | Planar math, cell ledger, raw polygon conservation ($\Delta < 0.001\text{ mm}^2$), residential envelope bounds. |
| `@ai-floor-planner/constraint-engine` | `./dist/index.js`<br>`./dist/index.d.ts` | `@ai-floor-planner/core`,<br>`@ai-floor-planner/geometry-engine` | 31 constraint evaluators: plot containment, room overlap, window/door validity, daylight, privacy, circulation. |
| `@ai-floor-planner/renderer` | `./dist/index.js`<br>`./dist/index.d.ts` | `@ai-floor-planner/core`,<br>`@ai-floor-planner/geometry-engine` | Multi-floor architectural 2D SVG generation, dimension chains, furniture symbols, architectural hatch patterns. |
| `@ai-floor-planner/projection-3d` | `./dist/index.js`<br>`./dist/index.d.ts` | `@ai-floor-planner/core`,<br>`@ai-floor-planner/geometry-engine` | Three.js scene graph derivation, procedural Blender 5.2 Python script synthesis (`blender-script-generator.ts`), MEP routing. |
| `@ai-floor-planner/planning-engine` | `./dist/index.js`<br>`./dist/index.d.ts` | `@ai-floor-planner/core`,<br>`@ai-floor-planner/geometry-engine`,<br>`@ai-floor-planner/constraint-engine` | `executeAuditedPlanningPipeline()`, `GeometryValidator`, `MultiStoryResidentialSynthesizer`, UDCPR 2020 engine. |
| `@ai-floor-planner/ai-orchestration` | `./dist/index.js`<br>`./dist/index.d.ts` | `@ai-floor-planner/core`,<br>`@ai-floor-planner/planning-engine` | Cloudflare FLUX 2 Klein 4B transport, Gemini vision interpretation, architectural prompt compilers, preflight gating. |
| `@ai-floor-planner/backend` | `./dist/index.js`<br>`./dist/server.js`<br>`./dist-server/server.cjs` | All workspace packages | HTTP API (port `4200`), generation orchestrator, AutoCAD `accoreconsole` DWG generator, PDF/DXF/Blender exporters. |
| `@ai-floor-planner/frontend` | `src/main.tsx`<br>`src/App.tsx` | All workspace packages (types & planning worker) | React 18 / Vite SPA (port `3000`), ARGON Studio shell, 6 workspace suites, Zustand / sync stores. |

---

## 3. ARGON Studio Interface Audit: Real vs. Local UI vs. Placeholder

Inspection of `packages/frontend/src/components/argon/` reveals the exact status of all user controls:

### Workspace 01: Project Setup Wizard (`ProjectSetupWizard.tsx`)
- **Status:** `VERIFIED_WORKING (100% Real)`
- **Stage 1 (Plot & Setbacks):** Real-time calculated plot area ($m^2$), footprint ($m^2$), ground coverage (%), statutory setbacks.
- **Stage 2 (Floors & Parking):** Floor counter (1–40), stilt parking toggle, estimated building height ($m$).
- **Stage 3 (Flats & BHK Mix):** Dynamic flat counter (2–4), BHK mix allocator with strict unit count validation (`isBhkMixValid`).
- **Stage 4 (Prompt & Upload):** AI prompt text, reference sketch upload (image parser and dataURL encoder).
- **Persistence:** Back/forward navigation never loses state; backing store uses `useStudioStore.ts` with `localStorage` snapshot.
- **Generate Trigger:** Spawns Web Worker `argon-planning.worker.ts`, invokes `executeAuditedPlanningPipeline()`, streams 6 live pipeline stages, on completion updates `editor.setBuilding()` and auto-switches to 2D CAD Studio.

### Workspace 02: 2D CAD Studio (`ArchitecturalCADWorkspace.tsx`)
- **Status:** `VERIFIED_WORKING (100% Real)`
- **Floor Switcher:** Real; switches active floor via `editor.switchFloor(floor.id)`.
- **Quick Export Buttons (DWG, DXF, PDF):** Real; calls `requestVerifiedExport()` and `downloadVerifiedExport()`.
- **Architectural Canvas:** Real; interactive SVG pan/zoom, room/opening selection, wall dragging, snaps.
- **Property Inspector:** Real; displays and updates selected entity properties.
- **Geometry Audit Panel:** Real; live `GeometryValidator.audit()` displaying measured $\Delta\text{ mm}^2$ and active violation list.
- **CAD Layer Toggles (Walls, Openings, Stairs, Dimensions, Columns, Beams, Furniture):** Real; controls SVG layer visibility.

### Workspace 03: Floor Isometric Editor (`FloorIsometricEditor.tsx`)
- **Status:** `PARTIAL_INTEGRATION (Requires Hardening)`
- **Floor Switcher Buttons:** Hardcoded array (`stilt`, `1st_floor`, `2nd_floor`, etc.) rather than reading `editor.building.floors`. Updates local `selectedFloorId` state only; does **not** call `editor.switchFloor()`.
- **Viewport:** Renders 2D `ArchitecturalCanvas` instead of a 3D isometric Three.js viewport plate.
- **Priority:** Elevate in Phase 6B to render a true Three.js orthographic/isometric camera view of the isolated floor slab.

### Workspace 04: 3D Building Customizer (`Building3DCustomizer.tsx`)
- **Status:** `HYBRID (Real 3D Engine, Unwired Drawer Controls)`
- **3D Core Viewport:** Real; renders Three.js WebGL viewport via `<ModelWorkspace />` with real geometry, orbit controls, floor switching.
- **Explode Slider (`explodeValue`):** Local UI state only; slider adjusts percentage (0–100%) but is not wired as a prop to `<ModelWorkspace />`.
- **Day/Night Lighting Toggle (`lightingMode`):** Local UI state only; does not toggle ambient/directional light intensities in Three.js scene.
- **Fixture & Furniture Options:** Buttons in right-hand drawer render UI list with hover effects, but have no click handler mutating canonical building openings or furniture entities.

### Workspace 05: Engineering (`UdcprEtabsAnalysis.tsx`)
- **Status:** `VERIFIED_WORKING (UDCPR) / HONEST_PLACEHOLDER (ETABS)`
- **UDCPR / NBC Tab:** Real.
  - 12+ live regulatory parameters (authority type, congestion zone, road width, building height, FSI caps, parking class).
  - Changing any parameter dispatches `UpdateRegulatoryContextCommand` to the canonical building revision history.
  - Full UDCPR 2020 clause check evaluation; clicking any clause violation (`highlight(r)`) switches floor and highlights the entity on the canvas.
  - Report download / preview triggers verified backend PDF/JSON export.
- **ETABS Structural Analysis Tab:** Honest Placeholder. Displays `NOT_RUN — PENDING PHASE 6`. Button disabled (`Structural report unavailable`). No fake analysis flags exist.

### Workspace 06: Export Center (`ExportCenterWorkspace.tsx`)
- **Status:** `VERIFIED_WORKING (100% Real)`
- **Artifact Matrix:** Real; generates independent rows for Site Plan, every individual floor, Structural Layout (`S-COLS` / `S-BEAM`), Complete Drawing Set, Geometry Validation Report, and UDCPR Statutory Report.
- **Preview & Download:** Real; calls `/api/export/:format` with SHA-256 validation and byte verification before download.

---

## 4. Test & Verification Matrix (Actual Executions)

### Monorepo Suite Results

| Package | Test Files | Passed | Failed | Skipped | Duration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `@ai-floor-planner/core` | 22 | 192 | 0 | 0 | 2.40s |
| `@ai-floor-planner/geometry-engine` | 4 | 86 | 0 | 0 | 1.35s |
| `@ai-floor-planner/constraint-engine` | 31 | 185 | 0 | 0 | 3.36s |
| `@ai-floor-planner/renderer` | 7 | 88 | 0 | 0 | 1.43s |
| `@ai-floor-planner/projection-3d` | 3 | 28 | 0 | 0 | 1.34s |
| `@ai-floor-planner/planning-engine` | 52 | 447 | 0 | 0 | 8.03s |
| `@ai-floor-planner/ai-orchestration` | 21 | 242 | 0 | 2 | 7.52s |
| `@ai-floor-planner/backend` | 22 | 173 | 1 | 3 | 48.87s |
| `@ai-floor-planner/frontend` | 32 | 166 | 0 | 0 | 10.70s |
| **Monorepo Total** | **194** | **1,607** | **1** | **5** | **85.00s** |

### Confirmed Failing Test Analysis

**Failure Location:** `packages/backend/src/__tests__/real-provider-smoke.test.ts:173:36`  
**Command:** `pnpm --filter @ai-floor-planner/backend test`  
**Error Output:**
```
FAIL |@ai-floor-planner/backend| src/__tests__/real-provider-smoke.test.ts > Real Provider Smoke Tests (Live Verification) > Server health diagnostics correctly reflect provider connectivity without leaking secrets
AssertionError: expected 'AUTH_FAILED' to be 'REACHABLE' // Object.is equality

Expected: "REACHABLE"
Received: "AUTH_FAILED"

 ❯ src/__tests__/real-provider-smoke.test.ts:173:36
    171|     if (hasGemini) {
    172|       expect(health.gemini.configured).toBe(true);
    173|       expect(health.gemini.status).toBe('REACHABLE');
       |                                    ^
    174|     }
```
**Root Cause:** The test checks `process.env.GEMINI_API_KEY`. When present, it issues a live network health ping to Google Gemini API. Because the local `.env` key is either inactive or rate-limited, the endpoint returns `AUTH_FAILED`. This is an environment configuration issue for live network smoke testing, not a regression in deterministic application logic.

---

## 5. Investigation of Historical Audit Reports vs. Source Reality

Comparison against historical audit document `docs/phase0/FAILURES.md`:

| Historical Failure Reported in Phase 0 | Current Source State | Verdict |
| :--- | :--- | :--- |
| `apartment-error-repair.test.ts` (6 failing tests on corridor privacy, missing rooms, orphan rooms) | All 6 tests in `apartment-error-repair.test.ts` **PASS** in 786ms. | **RESOLVED** in ARGON 4 Phase 1/2. |
| `plancraft-integration.test.ts` (5 failing tests on furniture collisions across 2BHK/3BHK/4BHK) | All 9 tests in `plancraft-integration.test.ts` **PASS** in 747ms. | **RESOLVED** in ARGON 4 Phase 1/2. |
| `space-filling-snapper.test.ts` (Elastic snapper setbacks & metric solver failures) | All 21 tests in `space-filling-snapper.test.ts` **PASS** in 568ms. | **RESOLVED** in ARGON 4 Phase 2. |
| `two-phase-concepts.test.ts` (Phase 1 controlled FLUX concepts & fallback) | All 6 tests in `two-phase-concepts.test.ts` **PASS** in 4,557ms. | **RESOLVED** in ARGON 4 Phase 2. |
| `phase4-image-to-2d.test.ts` (Manifest interpretation to canonical plan) | All 5 tests in `phase4-image-to-2d.test.ts` **PASS** in 218ms. | **RESOLVED** in ARGON 4 Phase 2. |
| `phase5-evaluation-and-sweep.test.ts` (Architectural evaluation sweep) | All 6 tests in `phase5-evaluation-and-sweep.test.ts` **PASS** in 3,110ms. | **RESOLVED** in ARGON 4 Phase 2. |

**Conclusion:** All mathematical geometry, elastic snapping, apartment layout, and furniture collision regressions identified in previous audits have been completely resolved in the current codebase.

---

## 6. Confirmed Defects & Technical Debt

1. **`FloorIsometricEditor.tsx` Viewport & State Desync:**
   - *File:* `packages/frontend/src/components/argon/FloorIsometricEditor.tsx`
   - *Issue:* Hardcoded floor levels (`stilt`, `1st_floor`, etc.) ignore actual floors in `editor.building`. Floor button clicks do not update `editor.activeFloor`. Viewport uses 2D canvas rather than isolated 3D isometric plate.
2. **`Building3DCustomizer.tsx` Disconnected Controls:**
   - *File:* `packages/frontend/src/components/argon/Building3DCustomizer.tsx`
   - *Issue:* `explodeValue` and `lightingMode` states are not passed to `<ModelWorkspace />`. Element Customizer buttons do not update building entities.
3. **Live Smoke Test in Default Unit Suite:**
   - *File:* `packages/backend/src/__tests__/real-provider-smoke.test.ts`
   - *Issue:* Real external API test is executed as part of `pnpm test:unit`, causing failure when external API credentials are unconfigured or expired. Should be separated into `test:integration`.
4. **Turbo Concurrent Build Contention on Windows:**
   - *Issue:* `turbo run test:unit` attempts to rebuild `packages/backend` concurrently while other packages compile, causing occasional file lock contention on `server.cjs` or `.tsbuildinfo` under Windows filesystem semantics.

---

## 7. Local Development Environment & Reproduction Guide

### Prerequisites
- **Node.js:** `>= 20.0.0` (Tested on `v24.18.0`)
- **Package Manager:** `pnpm@9.7.0`
- **Optional Tools:**
  - AutoCAD with `accoreconsole.exe` in `C:\Program Files\Autodesk\AutoCAD 2021\` (for native DWG generation; fallback DXF is generated automatically if absent).
  - Blender `>= 4.2` (for procedural `.blend` file rendering).

### Running the Application Locally

```powershell
# 1. Install dependencies
pnpm install --frozen-lockfile

# 2. Build shared packages
pnpm build

# 3. Start Backend Server (runs on http://127.0.0.1:4200)
pnpm --filter @ai-floor-planner/backend dev

# 4. In a separate terminal, start Frontend Dev Server (runs on http://localhost:3000)
pnpm --filter @ai-floor-planner/frontend dev
```

> **Note:** The frontend Vite dev server automatically proxies `/api/*` requests to the backend at `http://127.0.0.1:4200`.
