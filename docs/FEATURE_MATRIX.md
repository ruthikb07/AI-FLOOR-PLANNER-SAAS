# ARGON 4 — System Feature & Implementation Matrix

> **Baseline Date:** 2026-11-10  
> **Repository:** [https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS)  
> **Commit:** `a2370d5`

---

## 1. Subsystem Capability Matrix

| Subsystem | Package | Implementation Status | Test Coverage | Source Reality / Capabilities |
| :--- | :--- | :---: | :---: | :--- |
| **Canonical Building Model** | `@ai-floor-planner/core` | `VERIFIED_WORKING` | 22 files / 192 tests | Sole source of authoritative state. Full support for floors, rooms, walls, openings, structural columns (`S-COLS`), beams (`S-BEAM`), staircases (`CanonicalStaircase`), UDCPR contexts, undoable command pattern. |
| **Planar Geometry Engine** | `@ai-floor-planner/geometry-engine` | `VERIFIED_WORKING` | 4 files / 86 tests | Pure planar polygon arithmetic, disjoint component union, Sutherland-Hodgman clipping, raw planar area conservation ($\Delta < 0.001\text{ mm}^2$), residential envelope bounds. |
| **Constraint Validation Engine** | `@ai-floor-planner/constraint-engine` | `VERIFIED_WORKING` | 31 files / 185 tests | 31 independent validators covering plot containment, room boundary overlap, door/window wall hosting, minimum room dimensions, daylight, circulation, privacy. |
| **Multi-Story Planning Engine** | `@ai-floor-planner/planning-engine` | `VERIFIED_WORKING` | 52 files / 447 tests | Elastic space snapper, quad/triple/double BHK unit packer, vertical core continuity solver, structural column & beam network generator, `executeAuditedPlanningPipeline()`. |
| **Maharashtra UDCPR 2020 Engine** | `@ai-floor-planner/planning-engine` | `VERIFIED_WORKING` | Integrated in suite | FSI calculation (Basic, Premium, TDR, Ancillary), front/rear/side setbacks ($H/5$, $H/4$), Table 8-A stilt parking norms, recreational open space (ROS), fire staircase widths. |
| **AI Orchestration & Vision** | `@ai-floor-planner/ai-orchestration` | `VERIFIED_WORKING` | 19 files / 242 tests | Cloudflare FLUX 2 Klein 4B floor-plan generation transport, Gemini vision interpretation, architectural prompt compilers, visual preflight validation. |
| **2D Architectural Renderer** | `@ai-floor-planner/renderer` | `VERIFIED_WORKING` | 7 files / 88 tests | High-fidelity architectural 2D SVG generation, wall fills, Indian standard line weights, opening arcs, dimension chains, furniture layout symbols, layer segregation. |
| **3D Three.js & Blender Projections** | `@ai-floor-planner/projection-3d` | `VERIFIED_WORKING` | 3 files / 28 tests | Three.js scene projection of canonical building, procedural Blender 5.2 Python script generator (`blender-script-generator.ts`), MEP cable/pipe routing. |
| **CAD Export & accoreconsole Engine** | `@ai-floor-planner/backend` | `VERIFIED_WORKING` | 21 files / 173 tests | True AutoCAD `.dwg` generation via `accoreconsole.exe`, fallback `.dxf` generator, `pdf-lib` multi-sheet PDF generator with `FIT_TO_PAGE` protection. |
| **ARGON Studio User Interface** | `@ai-floor-planner/frontend` | `VERIFIED_WORKING` | 32 files / 166 tests | Architectural Beige theme (`#F5F0E8`), 4-stage intake wizard, persistent `useStudioStore`, 2D CAD studio, export center, live progress modal. |

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
| | `ArchitecturalCADWorkspace` | Geometry Audit Display | Real | `GeometryValidator` | Live audit of active building with measured delta in $\text{mm}^2$. |
| **03 Floor Editor** | `FloorIsometricEditor` | Floor Selector Buttons | Placeholder | Local state only | Does **not** switch floor in `editor`; uses hardcoded floor array. |
| | `FloorIsometricEditor` | Viewport Canvas | Placeholder | 2D SVG canvas | Displays standard 2D canvas rather than a 3D isometric plate. |
| **04 3D Building** | `Building3DCustomizer` | 3D WebGL Viewport | Real | `ModelWorkspace` | Real Three.js 3D viewport rendering slabs, walls, and openings. |
| | `Building3DCustomizer` | Explode Slider (0–100%) | Placeholder | Local state only | Slider updates state, but is not passed to Three.js canvas. |
| | `Building3DCustomizer` | Day / Night Lighting Toggles | Placeholder | Local state only | Toggles state, but does not alter scene lighting. |
| | `Building3DCustomizer` | Fixture & Furniture Options | Placeholder | Local UI only | Hover/selection works, but does not mutate building geometry. |
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
| **Rule 6.3** | Building height restrictions vs. road width | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 6.4** | Marginal distances & setbacks ($H/5$ side, $H/4$ rear) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 3.4** | 10% Recreational Open Space (ROS) requirement | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Table 8-A** | Stilt & surface car/two-wheeler parking quotas | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 9.1** | Minimum room sizes (Habitable $\ge 9.5\text{ m}^2$, Kitchen $\ge 5.5\text{ m}^2$) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 9.3** | Minimum staircase clear width ($\ge 1.2\text{ m}$ residential, $\ge 1.5\text{ m}$ high-rise) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
| **Rule 9.4** | Natural ventilation & window glazing ratios ($\ge 1/10$ floor area) | `residential-udcpr-evaluator.ts` | `VERIFIED_WORKING` |
