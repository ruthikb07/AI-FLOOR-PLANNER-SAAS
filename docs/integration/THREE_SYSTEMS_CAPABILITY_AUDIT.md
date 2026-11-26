# Three-Systems Capability & Overlap Audit

## 1. System-by-System Capability Inventory

### A. Primary Host — RH Planner (`AI-FLOOR-PLANNER-SAAS`)
- **Existing Verified Capabilities:**
  - Hybrid Gemini + deterministic architectural brief interpretation, reference-image spatial graph extraction, and conflict hierarchy resolution.
  - Multi-storey residential & bungalow topological generation (20+ massing shapes, surveyed site boundary intake, exact `0.000 mm²` planar area conservation, shared exterior plumbing shafts + sloped gravity drainage coordination).
  - Maharashtra UDCPR 2020 & NBC 2016 statutory rule engine + IS 456 / IS 1893 preliminary structural framing & ETABS bridge.
  - Interactive 2D Architectural Editor (`InteractivePlanEditorPage`), SVG engineering overlays, `PrecisionCadWorkbench` controlled canonical edits, Floor Cutaway 3D, Tower 3D (`ThreeBuildingScene` with WebGL recovery), and verified DWG/DXF/IFC4/GLB/Blender/PDF exports.
  - IndexedDB + backend atomic local-disk project & revision storage (`local-project-store.ts`).
- **Missing Capabilities Supplied by External Engines:**
  - Full 240-command professional 2D/3D CAD drafting, 3D CSG solid booleans, UCS, splines/ellipses/blocks/attributes/hatches, paper-space layouts with scaled viewports & projected views, STEP/IGES/STL/OBJ CAD exchange (supplied by **Cota CAD**).
  - BCF 2.1 issue tracking & `.bcfzip` round-trip, buildingSMART IDS 1.0 specification auditing, IFC4/IFC4X3 semantic validation & per-entity fidelity reports, 3D BVH/GJK multi-mode clash & clearance matrix, Uniclass/OmniClass/UniFormat classification, formula schedules/5D QTO, and COBie 2.4 export (supplied by **OpenBIM Studio**).

### B. Source Application 1 — OpenBIM Studio (`amdghedy/openBIMstudio` v0.74.0)
- **Inspected Source Modules:** `src/main.ts`, `src/core/*`, `src/features/ids.ts`, `src/modules/ifc-semantics/*`, `src/modules/clash/*`, `src/modules/issues/bcf-markup.ts`, `src/modules/export/{bcf21.ts,cobie.ts}`, `src/modules/schedules/*`, `src/modules/cost/qto-rules.ts`.
- **Capabilities Integrated into `@ai-floor-planner/openbim-integration`:**
  - **IFC4 & IFC4X3 Semantic Engine:** Pure-TS STEP instance scanner, preflight guard, semantic graph extractor (`IfcProject`/`IfcSite`/`IfcBuilding`/`IfcBuildingStorey`, property sets, quantity sets, classifications, spatial containment), semantic validator (`IFC-E-BAD-GUID`, `IFC-W-DUP-GUID`, `IFC-E-DANGLING-REF`, `IFC-W-UNITS-MISSING`, `IFC-W-ORPHAN-ELEMENT`, `IFC-W-EMPTY-PSET`, `IFC-W-EMPTY-QTO`, `IFC-W-CLASSIF-DANGLING`), and per-entity interoperability inventory.
  - **3D Clash & Clearance Coordination:** `TriangleBVH`, `PointCloudConvex` GJK distance, and 8 clash modes (`hard-triangle`, `hard-conservative`, `convex-gjk`, `sphere`, `center-in-volume`, `clearance`, `duplicates`, `penetration-depth`) operating across canonical 3D elements and multiple aligned IFC references.
  - **BCF 2.1 Issue Management:** Spec-conformant `markup.bcf` XML builder/parser (`RFC 4122` UUIDs, child elements per `markup.xsd`, legacy attribute reader fallback) + `.bcfzip` archive writer/reader (`bcf.version`, `project.bcfp`, `viewpoint.bcfv`).
  - **IDS 1.0 Validation:** XML parser + specification runner (`entity`, `attribute`, `property`, `classification`, `material`, `partOf` facets; `simpleValue`, `enumeration`, `pattern`, numeric & length bounds) + built-in architectural IDS rule packs.
  - **BIM Authoring, Classification, Schedules, 5D QTO & COBie 2.4:** Safe AST formula compiler (`schedule-formula.ts`), Uniclass 2015 / OmniClass 21 / UniFormat II hierarchical roll-ups (`schedule-classification.ts`), 5D QTO rules (`qto-rules.ts`), COBie 2.4 12-table HTML `.xls` & `.zip` CSV exporter (`cobie.ts`), and validated BIM element authoring/property editors.
- **Excluded / Superseded Upstream Parts:** OpenBIM's standalone DOM boot chain (`document.getElementById('app')`, `window.__obs*` globals), Redux/MUI/ThatOpen/Monaco/Tesseract UI chrome, Cloudflare Worker auth, and GPL/LGPL WASM converters.

### C. Source Application 2 — Cota CAD (`mxchristian17/cota` v2.49.3)
- **Inspected Source Modules:** `services/web/src/core/{document,commands,geom,editing,snap,dimension,hatch,text,linetype,fields,layout,drawing,projection,io,layers,region,thread,ui}`, `services/web/src/render/{Viewport,CameraController,csg,csgClean,smoothShading,tjunctions}`, `services/api/*`.
- **Capabilities Integrated into `@ai-floor-planner/cota-integration`:**
  - **2D Drafting & Curves:** `LINE`, `XLINE`, `RAY`, `PLINE` (straight + arc bulges + widths), `POLYGON`, `RECTANGLE`, `ARC`, `CIRCLE` (center/radius, 3P, 2P, TTR), `ELLIPSE`, `SPLINE`, `POINT`, `DIVIDE`, `MEASURE`, `TEXT`, `MTEXT` (Hershey Simplex stroke font + TTF), `HATCH` (ISO/ANSI patterns + island detection), `BOUNDARY`, `REGION`, `BLOCK`, `INSERT`, `BEDIT`, `ATTDEF`/`ATTEDIT`/`ATTSYNC`.
  - **Geometric Editing & Grips:** `MOVE`, `COPY`, `ROTATE`, `SCALE`, `MIRROR`, `OFFSET`, `STRETCH`, `LENGTHEN`, `TRIM`, `EXTEND`, `BREAK`, `BREAKATPOINT`, `JOIN`, `FILLET`, `CHAMFER`, `ARRAY` (rectangular/polar), `ALIGN`, `EXPLODE`, `MATCHPROP`, `PEDIT`, `DRAWORDER`, `GROUP`/`UNGROUP`, `PURGE`, `QSELECT`, interactive grip editing.
  - **Precision Snapping & Coordinates:** `END`, `MID`, `CEN`, `GCEN`, `NOD`, `QUA`, `INT`, `PER`, `TAN`, `NEA`, `GRID`, `ORTHO`, `OTRACK`, `POLAR`, `DYN`, absolute/relative/polar coordinate parser, `UCS` (World, Face, Object, View, Named, X/Y/Z axis rotation), `DIST`, `AREA`, `ID`, `LIST`, `MASSPROP`.
  - **3D Solid Modeling & Views:** `BOX`, `CYLINDER`, `CONE`, `SPHERE`, `TORUS`, `EXTRUDE`, `REVOLVE`, `UNION`, `SUBTRACT`, `INTERSECT`, `SLICE`, `FILLETEDGE`, `CHAMFEREDGE`, `FLATSHOT`, `SOLPROF`; visual styles (`2dwireframe`, `3dwireframe`, `hidden`, `shaded`, `shaded+edges`), Perspective/Orthographic camera, 1–4 `VPORTS`, `VIEW` named views, and interactive ViewCube.
  - **Advanced Dimensioning & Paper Space:** `DIM`, `DIMLINEAR`, `DIMALIGNED`, `DIMANGULAR`, `DIMARC`, `DIMRADIUS`, `DIMDIAMETER`, `DIMORDINATE`, `DIMJOGGED`, `DIMBASELINE`, `DIMCONTINUE`, `QDIM`, `AUTODIM`, `LEADER`/`QLEADER`/`MLEADER`, `DIMCENTER`, `CENTERLINE`, `DIMSTYLE`, associative & annotative dimensions; `LAYOUT`, `PAGESETUP`, `MVIEW`, `MSPACE`/`PSPACE`, `VPCLIP`, `VPLAYER`, `VIEWBASE`/`VIEWPROJ`/`VIEWGEN`/`VIEWUPDATE`, `FIELD`, `PLOT`/`PUBLISH` vector PDF.
  - **CAD File Interoperability:** `.cota` JSON, `.dxf` R2018, `.dwg` AC1032 (via `@node-projects/acad-ts`), `.obj`, `.stl`, pure-TS `.step`/`.iges` geometry reader with explicit unsupported-entity warnings, and vector `.pdf`.
- **Excluded / Superseded Upstream Parts:** Cota's React 19 standalone `App.tsx`, global Zustand singleton (`store.ts`), Python FastAPI/SQLModel `services/api` auth/database server, LGPL `occt-wasm`/`occt-import-js` WASM binaries, and GPL `LibreDWG` CLI.

---

## 2. Overlap Resolution Matrix

| Overlapping Capability | Authoritative Implementation Chosen | Rationale |
| --- | --- | --- |
| Authoritative Building Model (rooms, walls, doors, windows, slabs, levels) | **RH Planner `@ai-floor-planner/core`** | Enforces `0.000 mm²` planar conservation, Indian wall hierarchy, UDCPR/NBC compliance, and structural framing. |
| AI Architectural Generation & CAD/BIM NL Intent | **RH Planner `@ai-floor-planner/ai-orchestration` + `backend`** | Server-side Gemini security, model fallback, SHA-256 request caching, and deterministic validation gate. |
| 2D/3D General CAD Kernel, Command Line, Paper Space & Vector Plot | **Cota Engine in `@ai-floor-planner/cota-integration`** | Mature 240-command CAD interpreter, UCS, associative dimensions, hatches, blocks, CSG solids, and vector PDF plotter. |
| IFC4 Authored Export | **RH Planner `CanonicalIfcExchangeAdapter`** + **OpenBIM Semantic Validator** | Preserves RH Planner's FreeCAD/IfcOpenShell-verified curved/straight IFC4 writer while adding OpenBIM's semantic & IDS checks. |
| Clash Detection, BCF 2.1, IDS 1.0, Classification, 5D QTO & COBie 2.4 | **OpenBIM Engine in `@ai-floor-planner/openbim-integration`** | Adds BVH/GJK 3D clash modes, spec-conformant BCF 2.1 `.bcfzip`, IDS 1.0 XML audit, and COBie 2.4 tables cleanly. |
| Project Storage, Revisions & Authentication | **RH Planner `storage.ts` (IndexedDB) + `local-project-store.ts` (Backend)** | Single project envelope, single revision counter, zero duplicate databases or auth systems. |
