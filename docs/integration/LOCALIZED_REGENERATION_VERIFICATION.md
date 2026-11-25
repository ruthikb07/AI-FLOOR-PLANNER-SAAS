# Protected Localized Regeneration Verification (Phase 5 Gate E5)

## 1. Test Suites Executed

- `packages/planning-engine/src/__tests__/phase5a-architectural-intelligence.test.ts`
- `packages/backend/src/__tests__/phase4a-canonical-cad-editing.test.ts`
- `packages/frontend/e2e/rh-phase4a-cad-workflow.spec.ts`

---

## 2. Mandatory 14-Scenario Verification Matrix

| # | Mandatory Gate E5 Scenario | Scope / Operation | Verified Evidence |
| --- | --- | --- | --- |
| 1 | Regenerate only Flat 2 of a 4-flat floor | `SINGLE_FLAT` / `REGENERATE_ALTERNATIVE` | `PREVIEW_READY`, Flat 2 internal room boundaries & adjacency graph updated, `zoneAreaDeltaMm2 < 0.001`, `floorPlanarDeltaMm2 < 0.001` |
| 2 | Verify Flats 1, 3, and 4 unchanged | `verifyProtectedRegionInvariance` | `unaffectedUnitsIdentical === true`, `beforeProtectedDigest === afterProtectedDigest`, exact room/wall/door/window equality |
| 3 | Verify shared `230 mm` party walls unchanged | `partyWallsGeometryInvariant` | Collinear `UNIT_SEPARATION` (`230 mm`) centerline digest identical before & after |
| 4 | Verify central core unchanged | `coreElementsIdentical` & `columnsIdentical` | Stairs, lifts, common corridors, shafts, and columns 100% byte-identical |
| 5 | Verify other floors unchanged | `unaffectedFloorsIdentical` | `Stilt`, upper typical floor, and `Terrace` `stableValueHash` 100% identical |
| 6 | Regenerate only 1 bedroom | `SINGLE_ROOM` / `REGENERATE_ROOM` | Bedroom re-proportioned within Flat 2's unlocked neighbour pair; all other flats untouched |
| 7 | Relocate kitchen inside 1 flat | `SINGLE_FLAT` / `RELOCATE_KITCHEN` | Kitchen centroid moved `>= 800 mm` to opposite wet bay; connected & ventilated; Flats 1, 3, 4 untouched |
| 8 | Convert 1 flat `2BHK -> 3BHK` when area allows | `SINGLE_FLAT` / `CONVERT_BHK` (`3BHK`) | Flat 2 updated to `3BHK` (`3` bedrooms, `>= 2` ventilated baths); Flats 1, 3, 4 remain `2BHK` untouched |
| 9 | Increase Master Bedroom area in 1 flat | `SINGLE_FLAT` / `RESIZE_MASTER_BEDROOM` | Master Bedroom area increased inside Flat 2 envelope; sibling rooms remain habitable |
| 10 | Change Living/Dining arrangement in 1 flat | `SINGLE_FLAT` & `CONNECTED_ROOM_GROUP` | Public zone reconfigured; in `CONNECTED_ROOM_GROUP`, Flat 2's own bedrooms also remain byte-identical |
| 11 | Regenerate inside an irregular/trapezoid flat | `SINGLE_FLAT` (chamfered/trapezoid `u2`) | `sutherlandHodgmanClip` exact partition (`zoneAreaDeltaMm2 < 0.001`, `floorPlanarDeltaMm2 < 0.001`), Flat 1 untouched |
| 12 | Reject infeasible local target / lock / stale rev | `CONVERT_BHK` (`4BHK` on compact flat) | `REJECTED_BY_CONSTRAINTS` / `REFUSED_LOCKED` / `REFUSED_STALE_REVISION`, canonical `Building` untouched |
| 13 | Undo and Redo localized regeneration | `EditorEngine` + `ReplaceBuildingCommand` | `undo()` restores exact pre-edit `stableValueHash`; `redo()` restores exact post-edit `stableValueHash` |
| 14 | Save and reload after localized regeneration | `serializeBuilding` -> `deserializeBuilding` | Round-trip preserves exact canonical hash, unit/room/wall IDs, and `verifyProtectedRegionInvariance` |
