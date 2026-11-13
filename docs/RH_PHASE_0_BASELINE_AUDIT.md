# RH PLANNER — PHASE 0: BASELINE REPOSITORY AUDIT

**Date:** 2026-11-13  
**Repository:** `https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS`  
**Active Branch:** `feature/phase2-room-area-regeneration`  
**Audit Scope:** Full-stack package inventory, active generation execution trace, answers to Critical Investigation Questions 2A–2L, and root-cause analysis of observed architectural defects.

---

## 1. Monorepo Package Inventory & Responsibilities

The repository is a 9-package TypeScript/pnpm monorepo (`pnpm-workspace.yaml` -> `packages/*`):

| Package | Path | Primary Responsibility | Active in Generation? |
|---|---|---|---|
| `@ai-floor-planner/core` | `packages/core` | Canonical `Building`, `Floor`, `Room`, `Wall`, `Door`, `Window`, `Column`, `Stair`, `Site` domain types; `EditorEngine` command pattern (`ApplyRoomAreaRegenerationCommand`, `ReplaceBuildingCommand`, etc.); `DynamicApartmentManifest` and `MultiSheetApartmentConfig` contracts. | **YES** (Domain model & state engine) |
| `@ai-floor-planner/geometry-engine` | `packages/geometry-engine` | Exact polygon mathematics (`polygonArea` shoelace formula, `polygonIntersectionArea`), wall segment synthesis (`generateApartmentWalls`, `openingFitsApartmentWall`), and planar conservation ledger (`measureApartmentAreaLedger`). | **YES** (Polygon math, wall generation, area ledger) |
| `@ai-floor-planner/constraint-engine` | `packages/constraint-engine` | Hard/soft architectural constraint evaluators, `validateApartmentClosure` (door hosting, reachability, exterior wall ownership, wet-over-dry stacking), and regulatory compliance checks. | **YES** (Closure validation & repair loop) |
| `@ai-floor-planner/planning-engine` | `packages/planning-engine` | Active deterministic floor-plan synthesizer: `executeAuditedPlanningPipeline`, `solveMultiSheetApartmentProject`, `selectProductionTopology`, `generateDesignConcepts`, `interpretArchitecturalIntent`, `TOPOLOGY_FAMILIES`, `plan-assembler`, `sliceFlatRooms` (`space-filling-snapper.ts`), `repairApartmentPlan`, `GeometryValidator`, `evaluateUDCPRCompliance`, and `optimizeRoomArea`. | **YES** (100% of active plan generation runs here) |
| `@ai-floor-planner/ai-orchestration` | `packages/ai-orchestration` | `GeminiProvider`, `OpenAIProvider`, `RuleBasedRequirementParser`, `evaluatePlanArchitecturally`, `AIEditPlanner`, and a parallel deterministic apartment planner (`apartment/layout-planner.ts`, `apartment/area-budget.ts`, `apartment/manifest.ts`). | **NO (Bypassed during generation)** — only `evaluatePlanArchitecturally` is wired to backend `/api/evaluate/architecture`. |
| `@ai-floor-planner/renderer` | `packages/renderer` | 2D HTML5 Canvas / SVG CAD rendering primitives, room fills, wall hatching, door swing arcs, window symbols, and dimension annotations. | **YES** (2D CAD canvas rendering) |
| `@ai-floor-planner/projection-3d` | `packages/projection-3d` | Extrudes canonical `Building` floors, walls, slabs, doors, windows, and stairs into Three.js 3D scene graphs (`Building3DProjector`). | **YES** (3D Isometric & 3D Customizer views) |
| `@ai-floor-planner/backend` | `packages/backend` | Node HTTP server (`src/server.ts`, port `4200`) mounting `/api/health`, `/api/evaluate/architecture`, `/api/export/*` (DWG, DXF, PDF, Blender `.blend`/`.glb`), and `/api/v1/export/etabs-package` (native CSI ETABS `.edb` COM OAPI + `.e2k`). | **Export & post-hoc evaluation only** — never called during plan generation. |
| `@ai-floor-planner/frontend` | `packages/frontend` | React 18 + Vite UI (`ArgonStudioShell`, `ProjectSetupWizard`, `ArchitecturalCADWorkspace`, `FloorIsometricEditor`, `Building3DCustomizer`, `ExportCenterWorkspace`) and Web Worker (`argon-planning.worker.ts`). | **YES** (Active UI entry point) |

---

## 2. Active Application Entry Point & Generation Path

1. **Browser Entry:** `packages/frontend/src/main.tsx` mounts `<App />` (`packages/frontend/src/App.tsx`), which renders `<ArgonStudioShell />` (`packages/frontend/src/components/argon/ArgonStudioShell.tsx`).
2. **Project Setup Wizard:** When the user clicks **Generate** in `ProjectSetupWizard.tsx` (lines 71–85), `onGenerate(wizardData)` invokes `handleGenerate` in `ArgonStudioShell.tsx` (lines 89–163).
3. **Request Normalization:** `createArgonRequest(data)` (`packages/frontend/src/services/argon-request.ts`, lines 4–30) converts `ProjectSetupWizardData` into `MultiSheetApartmentConfig`.
4. **Web Worker Execution:** `ArgonStudioShell.tsx` spawns a browser Web Worker (`packages/frontend/src/services/argon-planning.worker.ts`, lines 1–18) and sends `{ type: 'START_PIPELINE', config }`.
5. **Deterministic Pipeline:** The Web Worker calls `executeAuditedPlanningPipeline(config, callback)` (`packages/planning-engine/src/pipeline/stage-progress-emitter.ts`, lines 106–255), which executes:
   - `computeBuildingStackParameters(config)`
   - `solveMultiSheetApartmentProject(config)` (`packages/planning-engine/src/apartment/multi-sheet-apartment-solver.ts`, lines 1924–2250)
   - `GeometryValidator.audit(projectResult.building, true)`
   - `evaluateUDCPRCompliance(auditResult.repairedBuilding, config)`
6. **Canonical Model Replacement:** The resulting `Building` is loaded into `useEditorStore` (`packages/frontend/src/stores/editor-store.ts`) via `editor.setBuilding(result.building, ...)`.

---

## 3. Root-Cause Analysis of User Screenshots (Images 1, 2, 3)

In the user's test session (Image 3), the user entered the prompt:
> *"Design a modern G+5 apartment with 4 spacious 2BHK flats per floor, each having one bedroom with a private balcony. Provide a central lift core, staircases on both sides, and an open-to-sky (OTS) courtyard. Optimize for Vastu, natural light, ventilation, privacy, and efficient space utilization."*

The generated plan (Images 1 & 2) exhibited severe architectural defects. Source-level tracing reveals the exact chain of causes:

### Defect 1: Why `LINEAR_SINGLE_LOADED` was chosen instead of a Central Lift Core (Image 1)
- In `packages/planning-engine/src/topology/architectural-intent.ts` (lines 110–116), `clausesOf(prompt)` splits the prompt on commas and `"and"`.
- The clause `"Provide a central lift core"` matches `mentionsCore` and sets `core = 'CENTRAL'` (line 199).
- **However**, line 203 checks:
  ```ts
  if (has(clause, /\b(place|position|put|locate|keep|move|shift)\b/)) coreIsRequired = true;
  ```
  Because the user wrote `"Provide"` (and not `"place"` or `"position"`), `coreIsRequired` remains `false`! Consequently, `mandatory.corePlacement` is left `undefined` (line 322), and `'CENTRAL'` is downgraded to a soft preference (`preferences.corePreference = 'CENTRAL'`).
- Next, in `packages/planning-engine/src/topology/candidate-scoring.ts` (lines 287–295), `CENTRAL_CORE_SPINE` has `otsAreaOf(partition) = 79.8 m²`, whereas `LINEAR_SINGLE_LOADED` turns the entire northern unused envelope (`40000 x 15600 mm = 624.0 m²`) plus core tail (`26600 x 3000 mm = 79.8 m²`) into `OPEN_TO_SKY_VOID`. Under `candidate-scoring.ts`, `LINEAR_SINGLE_LOADED` outscores `CENTRAL_CORE_SPINE` on `VENTILATION_COMPLETENESS` and `DAYLIGHT_EXPOSURE`, so `selectProductionTopology` selects `LINEAR_SINGLE_LOADED`!

### Defect 2: Why a giant `40000 x 15600 mm (624.0 sq m)` OTS Void dominates the top half of the building (Image 1)
- In `packages/planning-engine/src/topology/topology-families.ts` (`generateTopologyCandidates`, lines 1797–1798), `planFootprint()` is bypassed (`const footprint: FootprintPlan = { built: ctx.envelope, surplus: [], surplusAreaMm2: 0 }`).
- In `linearSingleLoaded` (`topology-families.ts`, lines 1554–1607), the 4 flats are arranged in a single horizontal row (`9000 mm` deep) + `2400 mm` corridor + `3000 mm` core band = `14400 mm` total depth out of the `30000 mm` envelope depth.
- `sliceFlatRow` trims the remaining `30000 - 14400 = 15600 mm` across the full `40000 mm` width into `row.leftovers`, and lines 1605–1606 push every leftover box into `shaftBoxes` with role `'OPEN_TO_SKY_VOID'`.
- `multi-sheet-apartment-solver.ts` then creates a room named `"OPEN TO SKY COURT (LIGHT AND AIR VOID) 40000 x 15600 mm (624.0 sq m)"` inside the building footprint!

### Defect 3: Why the Master Bedroom opens directly into the Kitchen (Image 2)
- In `packages/planning-engine/src/interpretation/space-filling-snapper.ts` (`sliceFlatRooms`, lines 745–1215), each flat (`10000 x 9000 mm` in world space, transposed to `localW = 9000, localH = 10000` for `SOUTH` entry) is split into `bedZone` (`x = 0..4500`) and `livingZone` (`x = 4500..9000`).
- Along the local `y` axis (`0..10000 mm`):
  - In `bedZone`: `masterBed` spans `y = 0..3780`, `passage` spans `y = 3780..6780`, and `bed2` spans `y = 6780..10000`.
  - In `livingZone`: `utilityRoom` spans `y = 0..1430`, `kitchenRoom` spans `y = 1430..6400` (`serviceDepth = 6400 mm`), and `livingRoom` spans `y = 6400..10000`.
- Because `serviceDepth` (`6400 mm`) extends almost to the end of `passage` (`6780 mm`), the shared wall between `livingRoom` (`y = 6400..10000`) and `passage` (`y = 3780..6780`) is only **`380 mm`** long (`6780 - 6400 = 380 mm`).
- A `900 mm` passage entrance requires at least `1100 mm` of wall (`900 mm` opening + `2 x 100 mm` corner returns), so `createConnectingDoor` between `livingRoom` and `passage` returns `null`!
- Consequently, the entire private wing (`passage`, `master_bed`, `bed_2`, `master_bath`, `common_bath`) is disconnected from `livingRoom`.
- When `repairApartmentPlan` runs (`packages/planning-engine/src/repair/apartment-error-repair.ts`, lines 1025–1085), its BFS reachability pass finds `master_bed` unreachable, picks the reachable room with the longest shared wall (`kitchenRoom`, sharing `2350 mm`), and punches a door directly between `KITCHEN` and `MASTER BEDROOM`!

### Defect 4: Why Flats 2 and 3 have an interior `"Family Sit-out"` box with red dashed boundaries (Image 2)
- In `packages/planning-engine/src/topology/plan-assembler.ts` (lines 198–210 and 484–491), when a flat's `Sit-out Balcony` does not touch the outer envelope edge (Flats 2 and 3 in `LINEAR_SINGLE_LOADED`, whose local low-`y` edge abuts the neighbouring flat to the west), `projectsToOutsideFace` drops the balcony and `reabsorbDropped` relabels it as `name: 'Family Sit-out', type: 'living', planningZone: 'PUBLIC'`.
- Because both `Family Sit-out` (`type: 'living'`) and `Dining & Family Hall` (`type: 'dining'`) are in `PUBLIC` zone, `generateApartmentWalls` (`packages/geometry-engine/src/wall-recognition/wall-generator.ts`) marks their shared boundaries as `OPEN_BOUNDARY`, which the 2D CAD canvas renders as bright red dashed lines.

---

## 4. Direct Answers to Investigation Questions (2A–2L)

### 2A. Why does regeneration produce nearly identical layouts?
1. **100% Deterministic Pipeline with Static Seed:** `createArgonRequest` (`packages/frontend/src/services/argon-request.ts`, lines 4–30) never populates `generationSeed`. In `generative-topology-engine.ts` (line 262), `const seed = input.seed ?? fnv1a(intentDigest)` hashes only the mandatory counts, preferences, and envelope dimensions. Identical wizard inputs always produce the exact same seed.
2. **Always Picks Rank 0:** `selectProductionTopology` (`packages/planning-engine/src/topology/production-bridge.ts`, line 117) always selects `result.concepts[0]`.
3. **Rigid Proportional Room Slicer:** Every topology family delegates room layout inside each flat to the exact same function—`sliceFlatRooms` in `packages/planning-engine/src/interpretation/space-filling-snapper.ts` (lines 736–1612)—which slices every flat into the same fixed 2-column template (`bedZone` on one side, `livingZone` on the other).

### 2B. Does the active application actually invoke Gemini during architectural generation?
**NO.**
- Active generation executes entirely inside the frontend Web Worker (`packages/frontend/src/services/argon-planning.worker.ts` -> `executeAuditedPlanningPipeline` -> `solveMultiSheetApartmentProject`).
- Zero HTTP requests are made to `packages/backend` (`http://localhost:4200`) during floor-plan generation, and `GeminiProvider` (`packages/ai-orchestration/src/providers/gemini.ts`) is never called.

### 2C. Is Gemini generating structured architectural proposals or merely evaluating generated geometry?
- In the active backend (`packages/backend/src/server.ts`, lines 187–194), Gemini is mounted **only** on `POST /api/evaluate/architecture` (`packages/backend/src/api/evaluation-routes.ts`, lines 35–88), which calls `evaluatePlanArchitecturally` (`packages/ai-orchestration/src/orchestration/architectural-evaluation.ts`) to produce post-hoc advisory text commentary on an already-generated plan.
- Even that endpoint is never called by the active `ArgonStudioShell` / `ProjectSetupWizard` flow.
- While `packages/ai-orchestration` contains `AIOrchestrationService.parseRequirements` (`packages/ai-orchestration/src/orchestration/service.ts`) and `AIEditPlanner` (`packages/ai-orchestration/src/editing/planner.ts`), neither is connected to the active `ArgonStudioShell` generation pipeline.

### 2D. Are area calculations derived from actual polygons or estimated percentages?
**Both exist at different stages—creating a disconnect between generation and reporting:**
1. **During Room Slicing (Generation):** Room dimensions are allocated via **hardcoded proportional fractions** of the flat's bounding box (`box.w` and `box.h`) in `sliceFlatRooms` (`space-filling-snapper.ts`, lines 758, 774, 801, 1060, 1087).
2. **During Validation & Ledger Auditing:** `measureApartmentAreaLedger` (`packages/geometry-engine/src/architectural/apartment-wall-Synthesis.ts`, lines 432–495) and `polygonArea` (`packages/geometry-engine/src/polygon/metrics.ts`) compute **exact shoelace polygon areas** in $\text{mm}^2$, subtracting wall-polygon intersections for `roomUsable` and verifying $\Delta = |\text{Gross} - \text{Accounted}| < 0.001\text{ mm}^2$.
3. **In Project Schedule (`generateApartmentProjectSchedule`):** `reraCarpetAreaM2` is computed from `typicalLedger.roomUsable[r.id]` (exact polygon area minus internal wall footprint), but `totalUnitBuiltUpM2` (`multi-sheet-apartment-solver.ts`, line 1828) adds an estimated `+15%` (`(carpetM2 + balconyM2) * 0.15`) for walls and pro-rata core.

### 2E. Is the requested area scope explicitly defined?
**NO.**
- In `ProjectSetupWizard.tsx` (`Stage2BuildingTypology.tsx`), the user enters per-BHK carpet areas (`bhkCarpetAreas[i].carpetAreaSqFt`), which `createArgonRequest` maps to `units[i].targetCarpetSqFt`.
- There is no field in `ProjectSetupWizardData` or `MultiSheetApartmentConfig` to distinguish whether a user-requested area target (e.g., `"2,000 sq. ft."` in prompt or setup) refers to:
  1. **Gross Floor Plate Area** (`2,000 sq. ft.` = $185.81\text{ m}^2$ total floor footprint),
  2. **Total Carpet Area per Floor** (`2,000 sq. ft.` = $185.81\text{ m}^2$ across all 4 flats, i.e., $500\text{ sq. ft.} / 46.45\text{ m}^2$ per flat), or
  3. **Carpet Area per Apartment** (`2,000 sq. ft.` = $185.81\text{ m}^2$ per flat, requiring $\approx 743.2\text{ m}^2$ of net unit carpet + core/walls per floor).

### 2F. Can the current architecture guarantee that a 2,000 sq. ft. target is not silently reduced?
**NO—in fact, it is guaranteed to silently ignore and clamp `targetCarpetSqFt`!**
- Trace `config.units[i].targetCarpetSqFt` through `solveMultiSheetApartmentProject`:
  1. `createArgonRequest` passes `targetCarpetSqFt` inside `config.units`.
  2. `selectProductionTopology` (`production-bridge.ts`, line 79) extracts **only** `unitTypes = (config.units ?? []).map(u => u.bhkType)` and **completely discards `targetCarpetSqFt`**!
  3. `flatFootprintTarget` (`topology-families.ts`, lines 764–793) ignores `targetCarpetSqFt` and looks up `FLAT_AREA_BOUNDS_SQM['2BHK'] = { min: 48, max: 95 }` ($95\text{ m}^2 \approx 1,022\text{ sq. ft.}$ gross) and clamps flat dimensions to `FLAT_BOUNDS.maxSpanMm = 9000` and `FLAT_BOUNDS.maxRunMm = 16000` ($144\text{ m}^2$ maximum box, with `partitionDefects` rejecting any flat above `maxSpanMm * 1.6`).
  4. Thus, a 2,000 sq. ft. ($185.81\text{ m}^2$) per-apartment target is **silently reduced** to $\sim 70\text{–}90\text{ m}^2$ ($\sim 750\text{–}970\text{ sq. ft.}$) without warning!

### 2G. Are building placement, setbacks and plot boundaries calculated correctly?
**Partially:**
- `multi-sheet-apartment-solver.ts` (lines 1929–1934) computes the buildable envelope from `plotWidthMm`, `plotDepthMm`, and `setbacksMm`:
  ```ts
  const envX = setbacks.left;
  const envY = setbacks.rear;
  const envW = config.plotWidthMm - setbacks.left - setbacks.right;
  const envH = config.plotDepthMm - setbacks.front - setbacks.rear;
  ```
- **However**, because `generateTopologyCandidates` (`topology-families.ts`, line 1797) disables `planFootprint` and sets `built: ctx.envelope`, the building boundary (`typicalFloor.boundary`) is always forced equal to the entire permissible envelope `(envX, envY, envW, envH)`.
- When the flats and core occupy less than `(envW, envH)`, the unused envelope is **not** left as open plot setback margin around a centered building; instead, it is included inside `typicalFloor.boundary` as giant `OPEN_TO_SKY_VOID` rooms, inflating `groundCoverageM2` and `consumedFsi` to 100% of the buildable envelope!

### 2H. Does the application correctly preserve user instructions such as `NO OTS` and `CENTER BUILDING`?
**NO.**
1. **`NO OTS` Crashes Intent Parsing:** In `packages/planning-engine/src/topology/architectural-intent.ts` (lines 216–222):
   ```ts
   const mentionsOts = has(clause, /\b(courtyards?|central\s+courts?|light\s*wells?|ots|open[\s-]*to[\s-]*sky|voids?|atrium)\b/);
   if (mentionsOts && has(clause, NEGATED)) {
     throw new IntentConflictError(
       'AMBIGUOUS_VENTILATION_STRATEGY',
       `The brief negates a courtyard or OTS in "${clause}". State the ventilation strategy directly...`,
     );
   }
   ```
   Saying `"no OTS"` or `"without OTS"` throws `IntentConflictError` instead of setting `ventilationStrategy = 'PERIMETER_ONLY'` and suppressing `OPEN_TO_SKY_VOID` shafts!
2. **`CENTER BUILDING` Is Ignored:** Neither `architectural-intent.ts` nor `topology-families.ts` parses `"center building"` / `"building centered"`, and `topology-families.ts` line 1797 hardcodes `built: ctx.envelope` instead of centering the built mass inside the permissible envelope.

### 2I. Are reference images actually influencing editable architectural geometry?
**NO.**
- `Stage4PromptAndUpload.tsx` reads the uploaded file as a base64 `dataUrl` and passes `referenceImage: { name, mimeType, dataUrl }` to `createArgonRequest`.
- In `multi-sheet-apartment-solver.ts` (lines 2164–2166), `config.referenceImage` is recorded only as metadata (`referenceImage: { name, mimeType }`) in `building.metadata.generationBrief` and is **never inspected, parsed, or sent to any vision model**.

### 2J. Does targeted regeneration preserve every protected room, wall, door, window and unrelated floor?
**Partially—with a confirmed window-deletion bug in `generateTargetedRefinements`:**
- There are two refinement modules in `packages/planning-engine/src/refinement/`:
  1. `optimizeRoomArea` (`room-area-optimizer.ts`): Preserves unrelated floors, checks `lockedEntityIds`, `lockedFloorIds`, and column clashes (`columnClashesWithBox`), and shifts doors and windows on moved walls via `moveOpening` (lines 281–304).
  2. `generateTargetedRefinements` (`targeted-regeneration.ts`): Asserts protected room equality via `assertProtectedEquality` (lines 133–141), **but line 130 contains a destructive bug**:
     ```ts
     windows: floor.windows.filter(window => !selected.has(window.roomId))
     ```
     Any window belonging to a selected room is **permanently deleted** when `generateTargetedRefinements` rebuilds floor dependencies!

### 2K. Are 2D and 3D generated from the same canonical geometry revision?
**YES.**
- Both `ArchitecturalCADWorkspace.tsx` (2D CAD) and `FloorIsometricEditor.tsx` / `Building3DCustomizer.tsx` (3D Three.js via `Building3DProjector.project(editor.building)`) subscribe directly to `editor.building` from `useEditorStore` (`packages/frontend/src/stores/editor-store.ts`).

### 2L. Do export services produce valid files that can be independently imported?
**YES (when the backend server on port 4200 is running):**
- `CadExportService` (`packages/backend/src/services/cad-export-service.ts`) generates AutoCAD DXF and DWG binaries and verifies magic headers, entity counts, and layer tables.
- `PdfExportService` (`packages/backend/src/services/pdf-export-service.ts`) generates multi-page ISO A3 vector PDFs (`%PDF-1.4`) with page count and byte verification.
- `BlenderExportService` (`packages/backend/src/services/blender-export-service.ts`) invokes headless Blender 4.2 LTS to produce real `.blend`, `.glb`, and `.png` renders.
- `handleETABSExportRoute` (`packages/backend/src/api/etabs-export-routes.ts`) drives native CSI ETABS 23.3.2 via PowerShell/.NET COM OAPI to produce verified `.edb` and `.e2k` files with SHA-256 verification.

