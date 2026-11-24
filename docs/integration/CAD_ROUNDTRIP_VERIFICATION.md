# Canonical CAD Round-Trip & Controlled Writeback Verification

## 1. Outbound & Readback Round-Trip Verification

Verified in:
- `packages/core/src/__tests__/cota-cad-kernel-and-adapter.test.ts` (**3/3 passed**)
- `packages/core/src/__tests__/cad-bim-adapter-contract.test.ts` (**2/2 passed**)
- `packages/backend/src/__tests__/phase4a-cad-adapter-and-roundtrip.test.ts` (**1/1 passed**)

### Measured Fidelity Results (Orthogonal Multi-Sheet + Curved `ROTUNDA_COURTYARD`)

| Check | Orthogonal 4-Storey Residential | Curved `ROTUNDA_COURTYARD` | Tolerance / Requirement |
| --- | --- | --- | --- |
| DXF Header Units (`$INSUNITS`) | `4` (Millimetres) | `4` (Millimetres) | Exact `mm` |
| Lost Canonical Entity IDs | **`0`** | **`0`** | `0` lost IDs |
| Changed Door / Window `hostWallId` | **`0`** | **`0`** | `0` host mutations |
| Straight Wall Endpoint Deviation | **`0.000 mm`** | **`0.000 mm`** | `<= 0.001 mm` |
| Curved Wall Analytic `ARC` Radius / Center Deviation | N/A | **`< 0.001 mm`** (`> 0` `ARC` entities verified) | Analytic `ARC` preserved (not lost to chord-only) |
| Stale Revision / Tampered Byte Rejection | Throws on mismatch | Throws on mismatch | `assertExchangeArtifact` SHA-256 + revision gate |
| Independent `parseUploadedCadFile` DXF Re-Import | Passed (`mm` detected, layers & polylines recovered) | Passed | Independent parser cross-check |
| Production `CadExportService` `AC1032` DWG + `acad-ts` `DwgReader` | Passed (`AC1032` header, binary entities read back) | Passed | Verified RH Planner DWG pipeline preserved |

## 2. Controlled Canonical CAD Writeback & AI Edit Bridge Verification

Verified in `packages/backend/src/__tests__/phase4a-canonical-cad-editing.test.ts` and `packages/frontend/e2e/rh-phase4a-cad-workflow.spec.ts`:

| Scenario / Instruction | Outcome | Verified Invariants |
| --- | --- | --- |
| `"Resize this window to 1500 mm"` | `PREVIEW_READY` → `1500 mm` width on host wall | `closureValid: true`, `unaffectedFlatsUnchanged: true` |
| `"Move this bedroom door towards the corner"` | `PREVIEW_READY` → shifted with full corner return clearance | `openingFitsApartmentWall === true`, `0` opening collisions |
| `"Increase the master bedroom carpet area"` | `PREVIEW_READY` → partition shifted inside target flat | `planarDeltaMm2 < 0.001`, other flats byte-identical |
| `"Reduce the passage width without compromising circulation"` | `PREVIEW_READY` → partition shifted with `>= 1,100 mm` clear width | NBC `1,100 mm` circulation floor & flat closure preserved |
| `"Regenerate only Flat 2 while keeping the remaining flats unchanged"` | **`REFUSED_UNSUPPORTED`** (`proposedBuilding: null`) | Refuses topological single-flat re-synthesis across shared party walls/cores; Flats 1, 3, 4 100% untouched |
| Raw CAD `TRIM` / `EXTEND` / `MOVE` / `ROTATE` / `MIRROR` on `CANONICAL_ARCHITECTURAL` wall | Blocked by `guardDraftingMutation` (`requiresCanonicalWorkflow: true`) | Prevents raw CAD geometry from corrupting room closure or 3D projection |
| Stale `expectedRevision` or locked floor/room | `REFUSED_STALE_REVISION` / `REFUSED_LOCKED` | Blocks out-of-date or locked canonical mutations |
| Post-Accept Synchronization & Undo/Redo | `version + 1` → 2D CAD, Floor 3D, Tower 3D, DXF, DWG, PDF, GLB, Undo, Redo | Exact `stableValueHash` restoration on Undo and re-application on Redo |
