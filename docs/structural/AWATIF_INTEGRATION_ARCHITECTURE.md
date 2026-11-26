# Awatif Integration Architecture (`Phase A3`)

## 1. Unified Single-Application Architecture

RH Planner integrates Awatif as an internal headless computational package (`@ai-floor-planner/structural-engine`) inside the existing monorepo — **one application, one localhost runtime, one canonical `Building` model, and one unified ARGON Studio UI**.

```mermaid
flowchart TD
  Canon["Canonical Architectural Building (mm)\n@ai-floor-planner/core"] --> Assembler["Canonical-to-Structural Frame Assembler\nDemand-Differentiated Sizing + Opening Clash Check"]
  Inputs["Reviewed Engineering & Geotechnical Inputs\nIS 875 Loads, Concrete/Steel Grades, Explicit Soil SBC"] --> LoadEngine["Indian Load & Combination Engine\nTributary Slab-to-Beam + Wall Loads + IS 456/1893 Combos"]
  Assembler --> UnitIn["Explicit Unit & Coordinate Adapter IN\nmm, N, MPa -> m, kN, kPa (Right-Handed Z-Up)"]
  LoadEngine --> UnitIn
  UnitIn --> Solver["AwatifStructuralSolver\nPrimary: AWATIF_CPP_WASM (lSolver.wasm Eigen::SparseLU)\nReference: TYPESCRIPT_SPARSE_LU_REFERENCE"]
  Solver --> Dynamics["Local Modal & IS 1893:2016 Seismic Engine\nCondensed Flexibility Jacobi Eigen + Parabolic Qi"]
  Solver --> PostProc["Exact FEF + 6-DOF Rotations + 11-Station Forces\nGlobal 6-DOF Force & Moment Equilibrium Audit"]
  PostProc --> RCC["Indian Code RCC Design Engine\nIS 456 + IS 13920 Beams, Biaxial Columns, Slabs, Stairs"]
  PostProc --> Found["Geotechnical-Gated Foundation Engine\nIS 456 Cl. 34 + IS 1904 Isolated/Combined/Strap/Strip/Rigid Raft"]
  RCC --> DefectOpt["Defect Detector & Protected Localized Optimizer\nMandatory Full-Structure Global Reanalysis Loop"]
  Found --> DefectOpt
  DefectOpt --> BBS["Reinforcement Detailing, BBS & Deduplicated BOQ"]
  BBS --> Views["Unified ARGON Structural Studio + Cota CAD Sheets + OpenBIM IFC"]
```

## 2. Revision & Hash Binding Contract

Every structural analysis, RCC design, foundation design, optimization run, BBS schedule, and structural drawing package is cryptographically bound to:
- `projectId` & `buildingId`
- `sourceArchitecturalRevision` (`building.version`) & `sourceArchitecturalSha256` (`canonicalBuildingHash(building)`)
- `structuralModelRevision` & `engineeringInputsDigest`

Any architectural edit in AI Floor Plan, Cota CAD, or OpenBIM Studio increments `building.version`, immediately marking prior structural analysis results `STALE` until reanalyzed. Conversely, structural optimization modifies structural member sections/reinforcement/footings **without** altering protected architectural room polygons, wall positions, doors, windows, stairs, or lifts.

## 3. Execution Environments (Web Worker + Node Backend)

- **Browser / Web Worker:** `@ai-floor-planner/structural-engine` runs in a dedicated Worker or async task so large multi-combination solves and iterative global-reanalysis optimization never block the main UI thread.
- **Node.js Backend (`/api/v1/structural/*` & `/api/v1/export/*`):** Executes the exact same `lSolver.wasm` binary in Node.js for server-verified analysis, PDF engineering reports, Cota DXF/DWG structural sheets, OpenBIM IFC structural exports, and persistence.
