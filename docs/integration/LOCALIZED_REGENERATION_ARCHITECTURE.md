# Protected Localized Regeneration Architecture (Phase 5 Gate E)

## 1. Purpose

Replaces the Phase 4A multi-flat `REFUSED_UNSUPPORTED` guardrail with a mathematically bounded, invariant-verified local regeneration solver (`packages/planning-engine/src/refinement/protected-local-regeneration.ts`) capable of regenerating:

- **`SINGLE_FLAT`**: 1 apartment unit on a `1..6` flat residential floor (e.g., Flat 2 of a 4-flat floor).
- **`SINGLE_ROOM`**: 1 unlocked room paired with its unlocked neighbour(s) inside the same flat.
- **`CONNECTED_ROOM_GROUP`**: A connected subset of unlocked rooms inside 1 flat (e.g., `Living + Dining + Kitchen` public/service zone while keeping the flat's bedrooms & bathrooms untouched).
- **`EDITABLE_ZONE`**: Any explicit unlocked room-union polygon contained within 1 flat.

---

## 2. Immutable Protection Boundary

Before any candidate reaches preview, `verifyProtectedRegionInvariance()` computes cryptographic digests (`stableValueHash`) and entity-level diffs proving:

1. **Unaffected Storeys (`unaffectedFloorsIdentical`):** Every `Floor` with `floor.id !== targetFloorId` (`Stilt`, other typical floors, `Refuge`, `Terrace`) is 100% byte-identical.
2. **Unaffected Flats (`unaffectedUnitsIdentical`):** Every `apartmentUnit` with `unit.id !== targetUnitId` — its `unit.boundary`, rooms, internal `115 mm` partitions, doors, and windows — is 100% byte-identical.
3. **Shared `230 mm` Party Walls & Exterior Outline (`partyWallsGeometryInvariant`, `exteriorOutlineInvariant`):** Merged collinear `230 mm` `UNIT_SEPARATION` lines and `floor.boundary` neither shift nor thin by even `0.01 mm`.
4. **Vertical Core & Structural Columns (`coreElementsIdentical`, `columnsIdentical`):** Stairs, lifts, common corridors, lift lobbies, shafts, and structural columns remain 100% identical, and no candidate internal partition is allowed to bisect a structural column.
5. **Locked Entities (`lockedEntitiesIdentical`):** Locked floors, flats, rooms, walls, and openings in `GenerationControlState` are strictly protected (`REFUSED_LOCKED` if targeted directly, or preserved in-place via unlocked sub-zone extraction).
6. **Planar Conservation (`< 0.001 mm²`):** Both `|Area(zoneAfter) - Area(zoneBefore)| < 0.001 mm²` and full-floor `measureApartmentAreaLedger(afterFloor)` (`delta`, `unassigned`, `overlap < 0.001 mm²`) must hold.

---

## 3. Atomic Pipeline

```mermaid
flowchart LR
  A["Selection & Intent"] --> B["Revision & Lock Gate"]
  B --> C["Boundary Context & Local Frame"]
  C --> D["Multi-Variant Local Slicing + Polygon Clip"]
  D --> E["Wall, Door & Window Synthesis"]
  E --> F["Schema + Geometry + Closure + Quality Audit"]
  F --> G["SHA-256 Protected Invariance Proof"]
  G --> H["Preview Ready -> ReplaceBuildingCommand (Undo/Redo)"]
```

- **Irregular / Clipped Flats:** Orthogonal candidate room grids over `bbox(unit.boundary)` are clipped to convex non-rectangular / chamfered / trapezoidal unit polygons via `sutherlandHodgmanClip(ccwZonePolygon, rectClip)`, guaranteeing $\sum \text{Area}(R_i \cap Z) = \text{Area}(Z)$ to floating-point precision (`< 0.001 mm²`).
- **Workspace Synchronization:** Accepted previews execute through `EditorEngine` (`ReplaceBuildingCommand`), incrementing `building.version` atomically and updating 2D Plan, Precision CAD, Floor 3D, Tower 3D, BIM Studio, Schedules, and IFC/DXF/DWG/PDF/GLB exports from the single canonical `Building`.
