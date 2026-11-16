# AI Building SaaS — Verified ARGON 4 Feature Matrix

> **Baseline Audit Date:** 2026-11-10  
> **Phase 1 Verification:** Complete  
> **Phase 2.5 Independent Review:** NOT READY — see [independent review](PHASE2_CODEX_INDEPENDENT_REVIEW.md)
> **Repository:** [https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS)  
> **Verified By:** Lead Software Architect, AI-FLOOR-PLANNER-SAAS  
> **Governance:** `AGENTS.md` (Sole Authority of Canonical Model, Evidence Freshness, Zero Fabricated Assumptions)

---

## Phase 2.5 verified scope (supersedes earlier Phase 2 claims)

| Capability | Current evidence / limit |
| :--- | :--- |
| Edited area retained across unit switches | Regression-tested using actual React input events; canonical target retained in mm². |
| Command acceptance | Full building/control fingerprints and deterministic replay; partial, stale, forged and validator-free proposals rejected. |
| Wall/opening identity | Preserved without cloning doors; ambiguous endpoint/topology reconstruction rejected. |
| Minima | Project-configured areas plus conservative engineering defaults, not universal statutory rules. |
| Undo/redo, persistence, exports | Fixture-level execution, reload, PDF/SVG bytes, DWG read-back, DXF area text and 3D wall coordinate tests. |
| Actual synthesized physical floors | BLOCKED: center/start opening-position contracts are inconsistent across consumers. |
| Browser / WebGL acceptance | NOT VERIFIED: browser service timed out; component/worker tests are not browser evidence. |
| Complete phase readiness | NOT READY. Integration authentication and furniture identity failures remain; see report for exact gate results. |

The historical package counts and unrelated capability rows below were not independently recertified by this focused audit. Passing software tests does not certify statutory or structural compliance.

## 1. System-Level Architecture & Package Matrix

| Subsystem / Package | Location | Verified Status | Test Coverage | Primary Responsibilities |
| :--- | :--- | :---: | :---: | :--- |
| **Canonical Data Model** | `@ai-floor-planner/core` | `VERIFIED_WORKING` | 22 files / 192 tests | Immutable building contracts, structural columns (`S-COLS`), beams (`S-BEAM`), stairs, typed reversible command pattern (`EditorEngine`, `BatchCommand`, `UpdateDoorPropertiesCommand`, `UpdateWindowPropertiesCommand`). |
| **Geometry Computation Engine** | `@ai-floor-planner/geometry-engine` | `VERIFIED_WORKING` | 51 files / 498 tests | Polygon clipping (Greiner-Hormann), spatial indexing (R-Tree), offset buffers, zero-error planar area calculation, staircase tread/riser solids. |
| **Spatial Planning & Synthesis** | `@ai-floor-planner/planning-engine` | `VERIFIED_WORKING` | 52 files / 447 tests | Multi-story residential synthesis (`multi-story-residential-synthesizer.ts`), corridor topology, BHK unit slicing, column-beam grid generation, stairs alignment. |
| **Maharashtra UDCPR 2020** | `@ai-floor-planner/constraint-engine` | `VERIFIED_WORKING` | 18 files / 158 tests | Statutory rules evaluator (`residential-udcpr-evaluator.ts`): FSI ledger, marginal distances, parking standards, 10% recreational open space. |
| **AI Brief Interpretation** | `@ai-floor-planner/ai-orchestration` | `VERIFIED_WORKING` | 141 tests | Gemini / OpenAI / rule-based chain for turning a brief into structured intent, with schema repair. Output is validated deterministically before it reaches geometry. Image generation, image-to-plan vision interpretation and visual preflight were removed; no image model participates in layout. |
| **SVG 2D Architectural Renderer** | `@ai-floor-planner/renderer` | `VERIFIED_WORKING` | 12 files / 54 tests | High-precision vector floor plans, Indian standard layer mapping (`A-WALL`, `A-DOOR`, `A-WIND`, `S-COLS`, `S-BEAM`), dimension annotations. |
| **3D Three.js & Blender Projections** | `@ai-floor-planner/projection-3d` | `VERIFIED_WORKING` | 3 files / 28 tests | Three.js scene projection of canonical building, procedural Blender 5.2 Python script generator (`blender-script-generator.ts`), MEP cable/pipe routing. |
| **CAD Export & accoreconsole Engine** | `@ai-floor-planner/backend` | `VERIFIED_WORKING` | 21 files / 173 tests | True AutoCAD `.dwg` generation via `accoreconsole.exe`, fallback `.dxf` generator, `pdf-lib` multi-sheet PDF generator with `FIT_TO_PAGE` protection. |
| **ARGON Studio User Interface** | `@ai-floor-planner/frontend` | `VERIFIED_WORKING` | 34 files / 178 tests | Architectural Beige theme (`#F5F0E8`), 4-stage intake wizard, persistent `useStudioStore`, 2D CAD studio, export center, live progress modal, floor isometric editor, 3D customizer. |

---

## 2. ARGON Studio Workspace Interface Matrix

| Workspace | Component | Button / Control | Type | State / Target | Verified Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01 Setup Wizard** | `Stage1PlotAndSetbacks` | Plot Width / Depth inputs | Real | `useStudioStore` | Updates plot dimensions; recalculates area in $m^2$ and sq ft. |
| | `Stage1PlotAndSetbacks` | Setback inputs (Front, Rear, Side) | Real | `useStudioStore` | Updates setbacks; recalculates buildable footprint and coverage. |
| | `Stage2FloorsAndParking` | Floor Counter (`-` / `+`) | Real | `useStudioStore` | Increments/decrements floors (1–40); recalculates height in meters. |
| | `Stage2FloorsAndParking` | Stilt Parking Toggle | Real | `useStudioStore` | Toggles stilt level requirement and ground level floor use. |
| | `Stage3FlatsAndBhkMix` | Flats Per Floor (2, 3, 4) | Real | `useStudioStore` | Adjusts flat count; validates unit mix sum matches flat count. |
| | `Stage3FlatsAndBhkMix` | BHK Unit Allocator | Real | `useStudioStore` | Dynamically adds/removes 1BHK–4BHK units with carpet areas. |
| | `Stage4PromptAndUpload` | AI Prompt Textarea | Real | `useStudioStore` | Stores architectural prompt intent. |
| | `Stage4PromptAndUpload` | File Upload (Reference Sketch) | Real | `useStudioStore` | Reads file bytes, generates thumbnail preview and dataURL. |
| | `ProjectSetupWizard` | `GENERATE 2D & 3D PLANS` | Real | Worker pipeline | Spawns `argon-planning.worker.ts`, executes pipeline, transitions to CAD. |
| **02 2D CAD Studio** | `ArchitecturalCADWorkspace` | Quick Export DWG / DXF / PDF | Real | `/api/export/:format` | Triggers verified backend export and starts browser file download. |
| | `ArchitecturalCADWorkspace` | Floor Selection Pills | Real | `editor.switchFloor` | Switches active building floor in editor store. |
| | `ArchitecturalCADWorkspace` | Layer Toggles (7 layers) | Real | Canvas render | Dynamically shows/hides rooms, walls, openings, stairs, dimensions, grid. |
| | `ArchitecturalCADWorkspace` | Entity Layer Toggles (3 layers) | Real | Canvas render | Toggles columns (`S-COLS`), beams (`S-BEAM`), furniture (`A-FURN`). |
| | `ArchitecturalCADWorkspace` | Property Inspector Inputs | Real | Editor commands | Mutates selected entity dimensions, names, and room categories. |
| | `PropertyInspector` | `RoomAreaCustomizerPanel` | Real | `optimizeRoomArea` / `ApplyRoomAreaRegenerationCommand` | Configures target room area ($m^2$ / sq ft), sliders, locks, and regeneration preferences. Generates Candidates A/B/C, interactive SVG preview modal, and applies reversible canonical command. |
| | `ArchitecturalCADWorkspace` | Geometry Audit Display | Real | `GeometryValidator` | Live audit of active building with measured delta in $\text{mm}^2$. |
| **03 Floor Editor** | `FloorIsometricEditor` | Floor Selector Buttons | Real | `editor.switchFloor` | Reads actual floors dynamically from `editor.building.floors`; switches active floor in canonical editor store. |
| | `FloorIsometricEditor` | Viewport Canvas | Real | `ThreeBuildingScene` | Genuine orthographic/isometric Three.js presentation in isolated floor mode (`floorMode="isolate"`), with preserved 2D drafting plan mode toggle. |
| **04 3D Building** | `Building3DCustomizer` | 3D WebGL Viewport | Real | `ModelWorkspace` | Real Three.js 3D viewport rendering slabs, walls, and openings. |
| | `Building3DCustomizer` | Explode Slider (0–100%) | Real | `ModelWorkspace` / `ThreeBuildingScene` | Computes proportional vertical floor separation distance and renders exploded levels in Three.js. |
| | `Building3DCustomizer` | Day / Night Lighting Toggles | Real | `ThreeBuildingScene` | Dynamically updates directional sun/moon intensity, sky background, and warm interior point lighting. |
| | `Building3DCustomizer` | Fixture Customizer (Windows/Doors) | Real | `editor.executeCommand` | Dispatches typed `UpdateWindowPropertiesCommand`, `UpdateDoorPropertiesCommand`, and atomic `BatchCommand` into Canonical Building. |
| | `Building3DCustomizer` | Furniture Customizer | Honest Disabled | Phase 8 Badge | Explicitly disabled (`aria-disabled="true"`) with `Pending Phase 8 (PBR Catalog)` badge to prevent unbacked state changes. |
| **05 Engineering** | `UdcprEtabsAnalysis` | Regulatory Inputs (12 fields) | Real | `editor.executeCommand` | Updates regulatory context via `UpdateRegulatoryContextCommand`. |
| | `UdcprEtabsAnalysis` | Clause Violation Rows | Real | `editor.selectEntity` | Clicking a violation switches floor and highlights entity on canvas. |
| | `UdcprEtabsAnalysis` | Download / Preview Report | Real | `/api/export/udcpr-*` | Downloads or previews verified UDCPR compliance report. |
| | `UdcprEtabsAnalysis` | ETABS Tab Button | Honest Placeholder | UI Tab | Explicitly states `NOT_RUN — PENDING PHASE 6`. Report button disabled. |
| **06 Export Center** | `ExportCenterWorkspace` | Paper Size / Scale Selectors | Real | Export options | Configures target sheet size (`A3`, `A2`, `A1`) and scale (`FIT_TO_PAGE`). |
| | `ExportCenterWorkspace` | Independent Export Buttons | Real | `/api/export/:format` | Independent download buttons for site, floors, structural, full set, UDCPR. |
| | `ExportCenterWorkspace` | In-Browser Preview Modal | Real | Modal viewer | Renders SVG drawing previews and PDF blobs directly in browser. |

---

## 3. Export Formats & Serialization Support Matrix

| Format | Endpoint | Engine / Library | Verified Capabilities |
| :--- | :--- | :--- | :--- |
| **AutoCAD `.dwg`** | `POST /api/export/dwg` | AutoCAD 2021 `accoreconsole.exe` | Native AutoCAD audit verification (`AC1032`, `TILEMODE=1`). Standard AIA / Indian layers (`A-WALL`, `A-DOOR`, `A-WIND`, `S-COLS`, `S-BEAM`). |
| **AutoCAD `.dxf`** | `POST /api/export/dxf` | `@node-projects/acad-ts` + internal serializer | Standard ASCII DXF with accurate line weights, text annotations, and boundary loops. |
| **Architectural `.pdf`** | `POST /api/export/pdf` | `pdf-lib` + internal vector renderer | Multi-sheet drawing set, title blocks, `FIT_TO_PAGE` scale safeguard, dimensional annotations. |
| **UDCPR Statutory `.pdf`** | `POST /api/export/udcpr-pdf` | `pdf-lib` + UDCPR report generator | Comprehensive compliance breakdown with clause citations, FSI ledger, and statutory disclaimer. |
| **UDCPR Statutory `.json`** | `POST /api/export/udcpr-json` | Internal JSON serializer | Machine-readable rule evaluation report with SHA-256 canonical hash. |
| **Geometry Audit `.pdf`** | `POST /api/export/geometry-pdf` | `pdf-lib` + Geometry validator | Area ledger, overlap detection, measured delta $\text{mm}^2$, entity clash audit. |
| **Procedural Blender 3D** | `POST /api/export/blender-package` | Blender 4.2+ Python API generator | Complete procedural Python script (`run_blender.py`) generating architectural meshes, slabs, materials, and lighting. |

---

## 4. Maharashtra UDCPR 2020 Statutory Rules Coverage

| UDCPR Clause | Rule Description | Engine Implementation | Verified Status |
| :--- | :--- | :--- | :---: |
| **Rule 3.1 & 6.1** | Basic, Premium, TDR & Ancillary FSI caps | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 6.2** | Maximum ground coverage by corporation class | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 6.3** | Marginal open spaces (front, rear, side) based on building height $H$ | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 7.1** | Minimum plot size and road width thresholds | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 8.1 / Table 8-A**| Required car parking and two-wheeler spaces by unit size | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 9.1** | Mandatory 10% Recreational Open Space (ROS) for plots $> 2000\text{ m}^2$ | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 11.1** | Habitable room sizes (min $9.5\text{ m}^2$, width $2.4\text{ m}$) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 11.2** | Kitchen minimum dimensions ($5.5\text{ m}^2$, width $1.8\text{ m}$) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 11.3** | Bath & Water Closet separation and minimum ventilation shaft sizing | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 13.1** | Minimum staircase clear width ($1.5\text{ m}$ for residential towers) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Statutory Notice** | Professional architect review disclaimer in statutory output | `udcpr-pdf-generator.ts` | `VERIFIED_WORKING` |
