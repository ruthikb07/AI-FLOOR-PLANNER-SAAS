# Cota Architecture Analysis & Selective Integration Boundary

## 1. Upstream Cota v2.49.3 Architecture Overview

Inspection of `cota-main` revealed a two-service monorepo:
- `services/web` (Vite 8 + React 19 + Three.js r169 + Zustand 5):
  - `src/core/geom.ts` & `curves.ts`: 2D analytic geometry, DXF bulge arcs, 3-point circles/arcs, segment-segment and segment-arc intersections, bounding boxes.
  - `src/core/snap.ts`: Priority-ranked OSNAP engine (`endpoint`, `midpoint`, `center`, `intersection`, `perpendicular`, `nearest`, `grid`, `ortho`).
  - `src/core/editing.ts`: Curve trimming (`trimCurve`), boundary extension (`extendCurve`), parallel offsetting (`offsetPrim`), translation, rotation, and mirror reflection.
  - `src/core/dimension.ts`: Linear/aligned dimension measurement and angular measurement.
  - `src/core/io/dxf.ts` & `dwg.ts`: ASCII DXF and `@node-projects/acad-ts` DWG serialization.
  - `src/core/occt/*`: On-demand OpenCascade WASM 3D solid modeling (`LGPL-2.1`).
- `services/api`: FastAPI collaboration/conversion microservice (excluded).

## 2. RH Planner Selective Integration Architecture

Rather than embedding Cota as a competing full-screen React 19 / Three.js application with duplicate document state, RH Planner integrates Cota at the **pure-TypeScript domain & lazy-loaded workbench layers**:

1. **`packages/core/src/interchange/cota-cad-kernel.ts` & `cota-cad-helpers.ts`:**
   - Framework-free 2D CAD entity model (`LINE`, `POLYLINE` with bulges, `ARC`, `CIRCLE`, `RECTANGLE`, `TEXT`, `DIMENSION`), analytic intersections, `resolveCadSnap`, `measureCadDistance`, `measureCadAngle`, `cadArcFrom3Points`, and drafting operations (`offsetDraftingEntity`, `trimDraftingLine`, `extendDraftingLine`, `moveDraftingEntity`, `rotateDraftingEntity`, `mirrorDraftingEntity`).
   - Enforces a hard `origin` invariant (`CANONICAL_ARCHITECTURAL` vs `DRAFTING_ANNOTATION`): raw CAD drafting mutations (`TRIM`, `EXTEND`, `MOVE`, `ROTATE`, `MIRROR`) are blocked on `CANONICAL_ARCHITECTURAL` entities so wall topology, room closure, and hosted openings can never desynchronize.
2. **`packages/core/src/interchange/canonical-cad-adapter.ts` (`CanonicalDxfExchangeAdapter`):**
   - Projects RH Planner's canonical `Building` model into `CanonicalCadDocument` and `AC1015` ASCII DXF (`$INSUNITS = 4` mm) with deterministic hex handles and `RH_CANONICAL` XDATA provenance, implementing `CanonicalExchangeAdapter`.
3. **`packages/planning-engine/src/refinement/cad-ai-edit-proposal.ts` & `POST /api/v1/cad/edit-proposal`:**
   - Controlled writeback bridge translating structured or natural-language CAD edits into validated canonical `Building` revisions via `editApartmentOpening`, `moveApartmentPartition`, and `optimizeRoomArea`.
4. **`packages/frontend/src/components/argon/PrecisionCadWorkbench.tsx`:**
   - Lazy-loaded (`React.lazy`) inside `ArchitecturalCADWorkspace.tsx` using RH Planner's warm beige atelier palette (`#F4F4ED` / `#FCFCF7` / `#122624` / `#9B6948`), backed directly by `EditorEngine` for unified Undo/Redo, 3D sync, and durable persistence.
