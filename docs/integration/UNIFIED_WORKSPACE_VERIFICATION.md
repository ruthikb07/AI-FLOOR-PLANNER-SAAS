# Unified Workspace Synchronization Verification (Phase 5C — Gate K)

## 1. Canonical Single Source of Truth
Every RH Planner studio workspace reads from and writes to the single canonical `Building` revision managed by `useEditorStore()` (`editor.building`, `editor.activeFloor`, `editor.selection`, `editor.generationControl`):

| Studio Mode Group | Workspace | Canonical State Read | Canonical State Write / Sync |
| --- | --- | --- | --- |
| **Design** | `Brief`, `Massing`, `Floor 3D`, `Tower 3D` | `building`, `activeFloor`, `selection`, `version` | `setBuilding`, `applyRefinement`, `switchFloor`, `selectEntity`, `executeCommand` |
| **Drafting** | `2D CAD`, `Precision CAD Studio`, `Edit Plan` | `building`, `activeFloor`, `selection`, `cadDraftingAnnotations` | `editApartmentPartition`, `editCanonicalWallThickness`, `editApartmentOpening`, `regenerateProtectedScope` |
| **BIM Coordination** | `BIM Studio`, `Compliance`, `Exports` | `building`, `IfcExchangeManifest`, `BimQuantityRow[]`, `BimClash[]` | `selectEntity`, `switchFloor`, preview-gated `applyRefinement`, verified IFC4/DXF/DWG/PDF exports |
| **Structural** | `Structural` (`StructuralCADWorkspace`) | Approved `building` (`Rev #N`), `columns`, `beams`, `slabThicknessMm` | Provisional RCC framing (`synthesizeStructuralFraming`) & separate ETABS/structural handoff |

## 2. Verified Cross-View Synchronization Flows
1. **Cross-Workspace Selection & Storey Persistence:**
   - Selecting a `wall`, `room`, `door`, or `window` in `BIM Studio` and clicking **Open in Precision CAD** activates `PrecisionCadWorkbench` on the exact storey with the matching canonical entity pre-selected in the `Direct Canonical Element Editor`.
   - Selecting a `room`, `wall`, `door`, or `window` in `2D CAD`, `Precision CAD`, or `BIM Studio` renders an immediate 3D selection highlight overlay in `ThreeBuildingScene.tsx` (`Floor 3D` & `Tower 3D`) without rebuilding static floor meshes.
2. **Stale Preview Invalidation & Revision Safety:**
   - All pending CAD/BIM/AI previews bind to `expectedRevision === building.version` and clear automatically whenever `building.version` advances via another edit, Undo, or Redo.
   - Outbound IFC4, DXF, DWG, PDF, and Blender exports bind to `exchangeRevision(building)` (`projectId`, `buildingId`, `revision`, `sha256`), rejecting stale artifacts cleanly.

## Independent review

Canonical opening and room selection is bound to the original entity even when mesh faces are merged for rendering. CAD previews are cancelled on workspace, floor, lock or revision changes. Disk snapshots use a persisted receipt with a separate revision sequence and preserve the accepted model's revision. A concurrent stale save returns HTTP 409. Independent browser evidence for each export is tracked in the [acceptance report](PHASE5_ACCEPTANCE.md).
