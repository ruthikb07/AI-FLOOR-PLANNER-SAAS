# Direct CAD Editing & Architectural Element Realism Verification (Phase 5B — Gates F & G)

## 1. Overview
Phase 5B upgrades `PrecisionCadWorkbench.tsx` and the canonical planning/geometry engines so architects can directly manipulate canonical walls, doors, windows, room area targets, and drafting dimensions with OSNAP precision, live canonical preview, full Undo/Redo, and one-click Protected Localized Regeneration fallback.

## 2. Implemented Capabilities (Gate F)
| Capability | Implementation | Canonical Validation & Protection |
| --- | --- | --- |
| **Interactive Move Tool (`move`)** | `PrecisionCadWorkbench.tsx` (`pendingStart` -> target OSNAP pick) | Computes exact orthogonal wall offset or along-wall/along-arc opening projection, generating a validated `DirectCadPreview` before commit. |
| **Direct Wall Nudge & Thickness** | `editApartmentPartition` & `editCanonicalWallThickness` (`90–350 mm`) | Refuses `< 230 mm` edits on exterior envelope and inter-flat party walls; protects locked rooms and structural shafts; preserves room polygon closure and `< 0.001 mm²` conservation. |
| **Partition Constraint Fallback** | One-click `Regenerate Flat Locally` button in `cad-direct-canonical-editor` | When a partition has perpendicular T-junctions that prevent isolated sliding, offers immediate `SINGLE_FLAT` protected regeneration without mutating neighboring flats or cores. |
| **Door Move, Width & Swing Flip** | `editApartmentOpening` (`SwingDirection.Left` / `Right`, `widthMm`, `offsetMm`) | Enforces `>= 100 mm` jamb return clearance, bathroom `>= 750 mm` / habitable `>= 850 mm` / entry `>= 1,000 mm` clear leaf widths, and column collision avoidance. |
| **Straight & Curved Window Editing** | `canonicalCurvedOpeningGeometry` + `openingFitsApartmentWall` + `editApartmentOpening` | Hosts, adds, moves, resizes, and updates `sillHeightMm` (`0–2,100 mm`) on both straight exterior walls and curved `ROTUNDA_COURTYARD` / `BOWFRONT_CHAMFERED` arc walls. |
| **Multi-Unit Room Sizing in CAD** | `parseMultiUnitAreaInput` + `regenerateProtectedScope` (`SINGLE_ROOM`) | Accepts `sq ft`, `sq m`, `mm²`, or `W × L` (`12'6" x 14'`) directly inside the CAD inspector. |
| **Dimension Override Editing** | `commitDraftingEntities` (`DIMENSION.textOverride`) | Updates CAD drafting dimension overrides with full canonical revision bump and Undo/Redo support. |

## 3. Architectural Element Realism Audit (Gate G)
`auditArchitecturalElementRealism(floor)` in `packages/planning-engine/src/diagnostics/architectural-efficiency.ts` verifies:
- **Balcony Guards:** Exterior balcony edges use `PARAPET` (`1,050–1,100 mm` height) or `GUARDRAIL`, never full-height opaque room walls.
- **Open Stilt Parking:** Stilt parking storeys remain open-perimeter (`OPEN_EDGE` / `CURB` / `GUARDRAIL`) without enclosing parking bays in solid room masonry.
- **Door Jamb Returns:** Physical doors maintain practical `>= 100 mm` masonry/frame return clearances from corners.
- **Zero Unrequested Lift Machine Rooms:** Terrace storeys never invent unrequested lift machine rooms (`unrequestedLiftMachineRooms === 0`).

## 4. Automated Verification Evidence
- `packages/backend/src/__tests__/phase5b-cad-bim-intelligence.test.ts` (Gate F & G suite)
- `packages/backend/src/__tests__/phase4a-canonical-cad-editing.test.ts`
- `packages/frontend/e2e/rh-phase4a-cad-workflow.spec.ts` (live Chromium Desktop & Mobile)
