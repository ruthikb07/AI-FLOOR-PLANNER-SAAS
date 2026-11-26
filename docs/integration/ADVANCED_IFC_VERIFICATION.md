# Advanced IFC4 Completion, Reference Federation & 3D Clash Verification (Phase 5B — Gates H & I)

## 1. Canonical IFC4 Authoring & Curved-Wall Opening Hosting (Gates H1 & H2)
`packages/backend/src/services/canonical-ifc-adapter.ts` and `packages/geometry-engine/src/opening-geometry.ts` now author complete schema-valid `IFC4` artifacts verified by both `CanonicalIfcExchangeAdapter.readback()` and independent Python `IfcOpenShell 0.9.0.post1` (`scripts/verify-ifc4.py`):

- **Curved-Wall Hosted `IfcDoor` & `IfcWindow` (`Gate H1`):**
  - Uses `canonicalCurvedOpeningGeometry(opening, wall)` to place point-symmetric tangent-normal `IfcOpeningElement` boolean void cutters (`0.000 mm` center drift) with full sagitta + wall-thickness penetration (`halfThickness = wall.thickness / 2 + R * (1 - cos(halfSweep)) + 20 mm`) linked via `IfcRelVoidsElement` and `IfcRelFillsElement`.
  - Independently meshed via `ifcopenshell.geom.create_shape` on voided curved `IfcWall` entities in `rotunda-curved-window.ifc`.
- **Rich Architectural `Body` Representations (`Gate H2`):**
  - `IfcDoor` and `IfcWindow` emit explicit `SweptSolid` `Body` leaf/frame representations alongside `OverallHeight` and `OverallWidth`.
  - `GUARDRAIL` boundaries export as `IfcRailing` (`PredefinedType = .BALUSTRADE.`) with `Axis` + `Body` representations.
  - Canonical staircases emit decomposed `IfcStairFlight` entities (`NumberOfRisers`, `NumberOfTreads`, `RiserHeight`, `TreadLength`, `.STRAIGHT.`) aggregated under `IfcStair` via `IfcRelAggregates`, satisfying IFC4 `CorrectShapeDecomposition` (`ifcopenshell.validate` `0` schema errors).

## 2. Read-Only External IFC4 Reference Reader & Project Persistence (Gates H3 & H4)
- **`packages/frontend/src/services/ifc-reference.ts` (`Gate H3`):**
  - Supports `IFCARBITRARYCLOSEDPROFILEDEF`, `IFCARBITRARYPROFILEDEFWITHVOIDS` (preserving inner void cutouts), `IFCRECTANGLEPROFILEDEF`, `IFCCIRCLEPROFILEDEF` (24-gon prism approximation), `IFCFACETEDBREP`, `IFCTRIANGULATEDFACESET`, and `IFCPOLYGONALFACESET`, plus multi-solid `Body` representations while explicitly counting any unsupported representations.
  - External reference files remain strictly **read-only** (`MAX_REFERENCE_ENTITIES` & `EXCHANGE_MAX_BYTES` enforced) and never overwrite canonical RH Planner geometry.
- **`packages/frontend/src/services/ifc-reference-store.ts` (`Gate H4`):**
  - Persists linked IFC references, discipline tags, `(x, y, z, angle)` alignments, and clash resolution statuses in IndexedDB (`rh_planner_bim_federation_v1`) with `localStorage`/in-memory fallback, strictly isolated by `projectId`.

## 3. Spatial-Indexed 3D Clash & Clearance Engine (Gate I)
- **`packages/frontend/src/services/bim-clash.ts`:**
  - Broad-phase `2,500 mm` 2D spatial hash grid + narrow-phase ear-clipped triangle intersection (`HARD_CLASH` volume in `mm³`) and 3D prism-to-prism minimum clearance distance (`CLEARANCE` in `mm`).
  - Evaluates straight walls (split around hosted door/window openings), chorded curved walls (split around curved openings), and optional floor slabs (respecting inner cutouts), provisional RCC columns/beams, and door swing clearance zones (`includeSlabsAndStructure`).
  - Excludes zero-volume face contact (`volumeMm3 <= 1`), valid structural bearing at slab/column interfaces (`isValidStructuralBearing`), and tracks revision-bound `OPEN | RESOLVED | IGNORED` clash statuses.

## Independent replay

Windows IfcOpenShell 0.9.0.post1 read and meshed twelve generated files. The suite exercised the curved window, stable identifiers, host/fill references, staircase decomposition and edited geometry. Independent files and logs are stored separately from production source. The native desktop IFC reopen, BCF and general arbitrary IFC representation federation remain unverified.

A separate production HTTP acceptance replay authored eight more IFC4 files from persisted canonical revisions. Windows IfcOpenShell independently checked their schema, identities, units, placements, host relations and sample solids. The manifests declare profile omissions, including furniture and provisional framing. [Project matrix](PHASE5_REAL_PROJECT_ACCEPTANCE.md)
