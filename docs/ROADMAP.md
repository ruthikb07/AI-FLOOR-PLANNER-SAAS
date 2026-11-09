# AI Building SaaS — Verified ARGON 4 Delivery Roadmap

> **Baseline Audit Date:** 2026-11-10  
> **Baseline Commit:** `a2370d5` (`feat: complete ARGON 4 Phase 1 & 2 geometry, synthesis, and Stage 6A studio intake`)  
> **Repository:** [https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS)  
> **Audited By:** Lead Software Architect, AI-FLOOR-PLANNER-SAAS  
> **Governance:** `AGENTS.md` (Sole Authority of Canonical Model, Evidence Freshness, Zero Fabricated Assumptions)

---

## 1. Scope and Delivery Discipline

The project targets high-quality, editable residential architectural 2D generation, canonical-model-driven Blender 5.2 / Three.js 3D visualization, statutory Maharashtra UDCPR 2020 validation, and native AutoCAD DWG / multi-sheet PDF export.

### Core Architectural Axioms
1. **Canonical Model Primacy:** The canonical `Building` contract from `@ai-floor-planner/core` is the sole source of authoritative state. SVG, Three.js, React components, and exported CAD files are pure projections.
2. **Deterministic Solvers First:** AI interprets user intent and generates schematic proposals. All geometry creation, wall sizing, room allocation, column/beam grids, and statutory compliance checks are owned by deterministic computational geometry solvers.
3. **Honest Gate Reporting:** If an external service, solver, or environment requirement is missing or unverified, the system must report `NOT_RUN`, `BLOCKED`, or `PROFESSIONAL_REVIEW_REQUIRED`. Never fabricate a passing score or structural safety approval.

---

## 2. Verified Baseline Status (Audit Commit `a2370d5`)

| Area / Subsystem | Status | Test Verification | Source Reality |
| :--- | :---: | :---: | :--- |
| **Monorepo Build & Types** | `VERIFIED` | 16/16 typecheck, 9/9 build | `pnpm typecheck` (16 tasks), `pnpm build` (9 packages), and `pnpm lint` pass with 0 errors. |
| **Mathematical Geometry** | `VERIFIED` | 447 tests pass | Zero-error planar area conservation ($\Delta < 0.001\text{ mm}^2$), non-overlapping rooms, snap-to-grid column placement. |
| **Apartment Topology & Synthesis** | `VERIFIED` | All suites pass | Multi-story synthesizer (`multi-story-residential-synthesizer.ts`), Quad/Triple/Double BHK room counts, living room corridor entry, utility attached to kitchen. |
| **Maharashtra UDCPR 2020** | `VERIFIED` | 34 rules checked | FSI (Basic/Premium/TDR/Ancillary), marginal setbacks ($H/5, H/4$), Table 8-A parking, 10% ROS open space, statutory disclaimer. |
| **CAD & PDF Export Pipeline** | `VERIFIED` | 24 file artifacts pass | Native AutoCAD `accoreconsole.exe` DWG validation, standard DXF fallback, multi-sheet vector PDF with `FIT_TO_PAGE` protection. |
| **ARGON Studio Shell (Stage 6A)** | `VERIFIED` | 166 frontend tests pass | Warm vellum theme (`#F5F0E8`), 4-stage intake wizard with persistent `useStudioStore`, live computed metrics, Web Worker pipeline execution. |
| **2D CAD Studio** | `VERIFIED` | Tested & functional | Interactive SVG canvas, layer segregation, embedded Property Inspector, live `GeometryValidator` audit. |
| **Export Center** | `VERIFIED` | Tested & functional | Multi-format independent export triggers with SHA-256 integrity verification. |
| **Floor Isometric Editor** | `PARTIAL` | UI wired to 2D canvas | Floor buttons use hardcoded array and do not update `editor.activeFloor`; renders 2D canvas instead of 3D isometric plate. |
| **3D Building Customizer** | `HYBRID` | 3D WebGL functional | Viewport uses Three.js `ModelWorkspace`, but explode slider, lighting mode, and fixture drawer buttons are local UI state. |
| **ETABS Structural Analysis** | `HONEST_STUB` | Honest placeholder | Stated as `NOT_RUN — PENDING PHASE 6`. Buttons disabled; no false claims. |

---

## 3. Prioritized Implementation Sequence

### Phase 1 — Diagnostic & Baseline Stabilization (Current Phase — Complete)
- [x] Read `AGENTS.md`, workspace configuration, and all relevant documentation.
- [x] Identify entry points and dependencies across all 9 packages.
- [x] Audit ARGON Studio interface: real vs. local UI state vs. placeholders.
- [x] Run full installation, typecheck, lint, build, and test suites; record exact outputs.
- [x] Reconcile historical audit reports (`docs/phase0/FAILURES.md`) against current green test reality.
- [x] Publish `docs/VERIFIED_AUDIT.md`, `docs/FEATURE_MATRIX.md`, and updated `docs/ROADMAP.md`.
- [x] Verify reproducible local development environment.

---

### Phase 2 — Immediate Defect Rectification & Test Hardening (Immediate Next Pass)
- [ ] **Task 2.1 — Live Smoke Test Isolation:**
  - In `packages/backend/src/__tests__/real-provider-smoke.test.ts`, wrap live external API pings with a test that checks if the credentials are live, or gracefully skip with `it.skipIf(!hasValidCredentials)` so standard offline `pnpm test` runs 100% green.
- [ ] **Task 2.2 — Turbo Parallel Build Windows Lock:**
  - Adjust `turbo.json` task dependencies or backend build script to prevent file lock contention on `dist-server/server.cjs` during parallel `pnpm test:unit` execution on Windows.

---

### Phase 3 — Floor Isometric Editor (Phase 6B)
- [ ] **Task 3.1 — Dynamic Floor Switcher:**
  - Update `FloorIsometricEditor.tsx` to read dynamic floors from `editor.building.floors` rather than a hardcoded array.
  - Wire button clicks to `editor.switchFloor(floor.id)`.
- [ ] **Task 3.2 — Isolated Floor 3D Isometric Viewport:**
  - Replace the 2D SVG canvas in `FloorIsometricEditor.tsx` with a dedicated Three.js isometric viewport plate that isolates the active floor slab, hides upper floors, and provides rotation/zoom controls.

---

### Phase 4 — 3D Building Customizer Controls Wiring (Phase 6C)
- [ ] **Task 4.1 — Explode Slider Wiring:**
  - Pass `explodeValue` prop from `Building3DCustomizer.tsx` down to `<ModelWorkspace />`.
  - In `ModelWorkspace.tsx` / `BuildingSceneProjector`, apply vertical Z-offsets to floor slabs proportional to `explodeValue`.
- [ ] **Task 4.2 — Day / Night Lighting State:**
  - Pass `lightingMode` to `<ModelWorkspace />`.
  - Adjust ambient and directional Three.js lights (warm daylight sun vs. cool indigo night sky with warm interior window emissions).
- [ ] **Task 4.3 — Element Customizer Dispatch:**
  - Connect window, door, and furniture buttons in the right drawer to real editor commands that update canonical opening styles (`SLIDING_UPVC`, `CASEMENT_ALUMINUM`, `GLASS_FRENCH`) or furniture layouts on the active floor.

---

### Phase 5 — ETABS Structural Analysis Integration (Phase 7)
- [ ] **Task 5.1 — ETABS `.e2k` File Generator:**
  - Serialize column grid (`S-COLS`) and beam network (`S-BEAM`) into standard ETABS `.e2k` text format.
- [ ] **Task 5.2 — Structural Check & Utilization Parser:**
  - Implement parsing of ETABS member utilization, drift, and displacement results.
- [ ] **Task 5.3 — ETABS Error Report PDF:**
  - Generate a professional engineering PDF report documenting member utilization, failed checks, and statutory disclaimers.

---

### Phase 6 — Blender 5.2 Headless Rendering Pipeline (Phase 8)
- [ ] **Task 6.1 — Procedural Blender Asset Exporter:**
  - Expand `packages/backend/src/blender/blender-runner.ts` to execute `blender.exe` in headless background mode (`--background --python run_blender.py`).
- [ ] **Task 6.2 — PBR Architectural Finishes:**
  - Generate realistic exterior finishes, railings, chajjas, window frames, and ambient lighting in Blender scene output.

---

## 4. Development & Verification Checkpoint Protocol

1. Before starting a pass: run `git status` and record baseline commit.
2. Maintain documentation integrity: never delete existing docstrings or comments unrelated to the task.
3. Every code change must be accompanied by focused unit tests.
4. Before submitting: run `pnpm typecheck`, `pnpm lint`, and package test suite.
5. Record exact command outputs in the delivery report.
