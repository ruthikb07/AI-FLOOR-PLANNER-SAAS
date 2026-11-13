# AI Building SaaS — Verified ARGON 4 Delivery Roadmap

> **Baseline Audit Date:** 2026-11-10  
> **Phase 1 Verification:** Complete  
> **Phase 2.5 Independent Review:** NOT READY — see [independent review](PHASE2_CODEX_INDEPENDENT_REVIEW.md)
> **Repository:** [https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS)  
> **Audited By:** Lead Software Architect, AI-FLOOR-PLANNER-SAAS  
> **Governance:** `AGENTS.md` (Sole Authority of Canonical Model, Evidence Freshness, Zero Fabricated Assumptions)

---

## 1. Scope and Delivery Discipline

The project targets high-quality, editable residential architectural 2D generation, canonical-model-driven Blender 5.2 / Three.js 3D visualization, statutory Maharashtra UDCPR 2020 validation, and native AutoCAD DWG / multi-sheet PDF export.

### Core Architectural Axioms
1. **Canonical Model Primacy:** The canonical `Building` contract from `@ai-floor-planner/core` is the sole source of authoritative state. SVG, Three.js, React components, and exported CAD files are pure projections.
2. **Deterministic Solvers Only:** AI interprets the user's brief into structured intent, and nothing more. All geometry creation, wall sizing, room allocation, column/beam grids, and statutory compliance checks are owned by deterministic computational geometry solvers. No image model participates in deciding layout, counts or geometry, and geometry is never read back out of an image; the former Cloudflare FLUX generation, image-to-plan vision interpretation and visual preflight paths have been removed.
3. **Honest Gate Reporting:** If an external service, solver, or environment requirement is missing or unverified, the system must report `NOT_RUN`, `BLOCKED`, or `PROFESSIONAL_REVIEW_REQUIRED`. Never fabricate a passing score or structural safety approval.

---

## 2. Verified Monorepo Baseline Status

| Area / Subsystem | Status | Test Verification | Source Reality |
| :--- | :---: | :---: | :--- |
| **Monorepo Build & Types** | `VERIFIED` | 16/16 typecheck, 9/9 build | `pnpm typecheck` (16 tasks), `pnpm build` (9 packages), and `pnpm lint` pass with 0 errors. |
| **Mathematical Geometry** | `VERIFIED` | 498 tests pass | Zero-error planar area conservation ($\Delta < 0.001\text{ mm}^2$), non-overlapping rooms, snap-to-grid column placement. |
| **Apartment Topology & Synthesis** | `VERIFIED` | 447 tests pass | Multi-story synthesizer (`multi-story-residential-synthesizer.ts`), Quad/Triple/Double BHK room counts, living room corridor entry, utility attached to kitchen. |
| **Maharashtra UDCPR 2020** | `VERIFIED` | 158 tests pass | FSI (Basic/Premium/TDR/Ancillary), marginal setbacks ($H/5, H/4$), Table 8-A parking, 10% ROS open space, statutory disclaimer. |
| **CAD & PDF Export Pipeline** | `VERIFIED` | 173 tests pass (5 skipped) | Native AutoCAD `accoreconsole.exe` DWG validation, standard DXF fallback, multi-sheet vector PDF with `FIT_TO_PAGE` protection. |
| **Floor Isometric Editor** | `VERIFIED` | 5 regression tests pass | Reads actual floors from `editor.building.floors`; switches active floor via `editor.switchFloor`; renders isolated 3D Three.js view with 2D plan mode toggle. |
| **3D Building Customizer** | `VERIFIED` | 7 regression tests pass | Explode slider vertically separates floors; Day/Night alters scene lighting; fixture profiles dispatch typed commands (`UpdateWindowPropertiesCommand`, `UpdateDoorPropertiesCommand`, `BatchCommand`); furniture explicitly disabled with Phase 8 badge. |
| **ARGON Studio Shell (Stage 6A)** | `VERIFIED` | 178 frontend tests pass | Warm vellum theme (`#F5F0E8`), 4-stage intake wizard with persistent `useStudioStore`, live computed metrics, Web Worker pipeline execution. |
| **2D CAD Studio** | `VERIFIED` | Tested & functional | Interactive SVG canvas, layer segregation, embedded Property Inspector, live `GeometryValidator` audit. |
| **Export Center** | `VERIFIED` | Tested & functional | Multi-format independent export triggers with SHA-256 integrity verification. |
| **ETABS Structural Analysis** | `HONEST_STUB` | Honest placeholder | Stated as `NOT_RUN — PENDING PHASE 6`. Report button disabled; zero false claims. |

---

## 3. Prioritized Implementation Sequence

### Phase 1 — Test Hygiene & Viewport Control Stabilization (Complete)
- [x] **Task 1.1 — Test Suite Hygiene:**
  - Separated real external-provider smoke tests (`real-provider-smoke.test.ts`) from deterministic local unit tests via `vitest.integration.config.ts`.
  - Added dedicated integration command: `pnpm --filter @ai-floor-planner/backend test:integration`.
  - Local unit test suite runs 100% green without network access.
  - Preserved honest error assertions on invalid API credentials.
- [x] **Task 1.2 — Floor Isometric Editor (`FloorIsometricEditor.tsx`):**
  - Removed hardcoded floor definitions (`floorLevels`).
  - Read dynamic floors from `editor.building.floors`.
  - Connected floor selection buttons to `editor.switchFloor(floor.id)`.
  - Replaced misleading 2D-only canvas with genuine 3D orthographic/isometric Three.js presentation (`ThreeBuildingScene`) in isolated floor mode (`floorMode="isolate"`).
  - Provided clean 2D/3D mode switcher preserving full 2D drafting functionality.
  - Added regression test suite: `packages/frontend/src/__tests__/floor-isometric-editor.test.tsx`.
- [x] **Task 1.3 — 3D Customization Controls (`Building3DCustomizer.tsx`):**
  - Connected Explode slider to actual vertical floor separation via `explodeDistance` in `ThreeBuildingScene`.
  - Connected Day/Night toggle to Three.js lighting (sunlight vs. indigo night sky with warm interior illumination).
  - Connected window and door fixture selections to typed editor commands (`UpdateWindowPropertiesCommand`, `UpdateDoorPropertiesCommand`, and `BatchCommand`).
  - Added "Apply Global 3D Skin" batch operation across all building openings.
  - Disabled unsupported furniture controls and visibly flagged them with `Pending Phase 8 (PBR Catalog)` badge.
  - Added regression test suite: `packages/frontend/src/__tests__/building-3d-customizer.test.tsx`.

---

### Phase 2.5 — Independent room regeneration review (NOT READY)
- [x] Reproduce target-unit reset, corrupt door identity, and stale direct-command acceptance before repairing them.
- [x] Preserve target area in mm², use actual preview constraints, reject partial alternatives, and revalidate at command execution.
- [x] Preserve wall/opening identities; reject ambiguous topology, fixed-room edits, and locked host changes.
- [x] Remove the arbitrary 85% envelope cap and misleading universal statutory-minimum claims.
- [x] Add cancellable solver workers and stale-result protection.
- [x] Exercise undo/redo, local storage, real PDF/SVG output, DWG read-back, DXF area labels and canonical 3D wall coordinates on fixtures.
- [ ] Establish one explicit canonical opening-position contract and migrate legacy renderer/projection/export consumers; then enable physical-floor regeneration.
- [ ] Extend conservative wall reconstruction to complete closed apartments, including split partitions and verified circulation/clearance continuity.
- [ ] Complete browser/WebGL acceptance scenarios; current browser service is unavailable.
- [ ] Resolve integration failures: live provider AUTH_FAILED/403 and nondeterministic furniture IDs in the existing generation pipeline.
- [ ] Rerun all release gates and obtain professional architectural review before marking the phase complete.

Evidence and exact limitations: [PHASE2_CODEX_INDEPENDENT_REVIEW.md](PHASE2_CODEX_INDEPENDENT_REVIEW.md).

---

### Phase 3 — Multi-Floor Cadastral & Site Coordination (Next Phase)
- [ ] **Task 2.1 — Site Boundary Snapping & Setback Offsets:**
  - Enforce site boundary polygon vertex snapping in 2D and 3D overlays.
  - Calculate dynamic statutory marginal distances ($H/5$ front, $H/4$ rear/side) directly on site polygon offsets.
- [ ] **Task 2.2 — Multi-Level Staircore Vertical Continuity:**
  - Enforce shaft clearance check across consecutive floor slabs to ensure stair opening congruency.

---

### Phase 3 — ETABS Structural Analysis Integration (Phase 6)
- [ ] **Task 3.1 — ETABS `.e2k` File Generator:**
  - Serialize column grid (`S-COLS`) and beam network (`S-BEAM`) into standard ETABS `.e2k` text format.
- [ ] **Task 3.2 — Structural Check & Utilization Parser:**
  - Implement parsing of ETABS member utilization, drift, and displacement results.
- [ ] **Task 3.3 — ETABS Error Report PDF:**
  - Generate a professional engineering PDF report documenting member utilization, failed checks, and statutory disclaimers.

---

### Phase 4 — Blender 5.2 Headless Rendering Pipeline (Phase 8)
- [ ] **Task 4.1 — Procedural Blender Asset Exporter:**
  - Expand `packages/backend/src/blender/blender-runner.ts` to execute `blender.exe` in headless background mode (`--background --python run_blender.py`).
- [ ] **Task 4.2 — PBR Architectural Finishes & Furniture Library:**
  - Integrate PBR 3D furniture models (`A-FURN`) with realistic materials, shadows, and glTF runtime catalogs.

---

## 4. Development & Verification Checkpoint Protocol

1. Before starting a phase: verify clean working tree and run `pnpm test:unit`.
2. Commit message format: `feat(scope): ...` or `fix(scope): ...`.
3. Keep work on the feature/review branch. Do not merge or push to main without explicit authorization.
4. Maintain `AGENTS.md` and feature matrices with verified realities only.
