# Canonical Building ↔ CAD Entity Mapping Specification

## 1. Coordinate Frame, Units & Scale

| Property | Canonical `Building` Model | Canonical CAD / DXF Exchange (`EXCHANGE_FRAME`) |
| --- | --- | --- |
| Linear Unit | Millimetres (`mm`), `INSUNITS = 4` | Millimetres (`mm`), `$INSUNITS = 4`, `$MEASUREMENT = 1` |
| Axes | `X` East (right), `Y` South (down) | Right-handed `X` East (right), `Y = -planY` North (up), `Z = floorElevationMm` up |
| Transform | `(x, y)` on `Floor` | `planPointToCad(p) = (p.x, -p.y)`, `cadPointToPlan(q) = (q.x, -q.y)` |
| Arc Orientation | `WallArcSpec.anticlockwise` in `(X, Y-down)` | Reflected in `(X, Y-up)` (`ccwInCad = !arc.anticlockwise`) preserving exact world-space chord & midpoint |
| Handle Identity | `floorId`, `wall.id`, `room.id`, `door.id`, `window.id` | Deterministic hex handle `deterministicDxfHandle(floorId, kind, canonicalId)` + `RH_CANONICAL` XDATA `kind|floorId|canonicalId|hostWallId` |

## 2. Canonical Element → CAD Layer & Primitive Mapping

| Canonical Source | CAD Layer | Primitive Type | Lock Default | Writeback Policy |
| --- | --- | --- | --- | --- |
| `Floor.boundary` | `A-SLAB` | Closed `POLYLINE` + floor `POINT` marker | Locked | Controlled envelope solver only |
| `Floor.voidBoundaries[]` (OTS / Cutouts) | `A-VOID` | Closed `POLYLINE` (`DASHED`) | Locked | Controlled OTS/refinement solver only |
| `Wall` (`EXTERNAL` / straight) | `A-WALL-EXT` | `LINE` | Locked if structural/floor-locked | Controlled setback / room-area solver |
| `Wall` (`INTERNAL_PARTITION` / straight) | `A-WALL-INT` | `LINE` | Editable via canonical bridge | `moveApartmentPartition` / `optimizeRoomArea` |
| `Wall` (`wall.arc` curved) | `A-WALL-EXT` / `A-WALL-INT` | Analytic `ARC` | Locked | Coordinated shape/massing solver |
| `Room` (`boundary`) | `A-ROOM` (`A-LIFT` for lifts) | Closed `POLYLINE` + `A-ANNO` `TEXT` (`name + m²`) | Respects `room.isFixed` & locks | `optimizeRoomArea` / `moveApartmentPartition` |
| `Door` (`openingGeometryVersion: 1` center) | `A-DOOR` | `LINE` along host wall (`hostWallId` preserved) | Editable via canonical bridge | `editApartmentOpening` (move / resize) |
| `Window` (`openingGeometryVersion: 1` center) | `A-WIND` | `LINE` along host wall (`hostWallId` preserved) | Editable via canonical bridge | `editApartmentOpening` (move / resize) |
| `Stair` (`boundary`) | `A-STAIR` | Closed `POLYLINE` | Locked (Protected Core) | Protected vertical circulation |
| Overall Envelope Dimensions | `A-DIM` | `DIMENSION` (`LINEAR` width & depth in `mm`) | Locked (Derived) | Auto-regenerated per revision |
| Auxiliary User CAD Annotations | `D-DRAFT`, `D-DIM`, `D-ANNO` | `LINE`, `POLYLINE`, `ARC`, `CIRCLE`, `RECTANGLE`, `DIMENSION`, `TEXT` | Editable | Persisted in `Building.metadata.cadDraftingAnnotations[floorId]` |

## 3. Explicit Conversion Notes (`CadConversionNote`)

1. `OPEN_BOUNDARY_OMITTED_FROM_PHYSICAL_WALLS`: Virtual open-passage dividers retain manifest handle mappings for opening host integrity.
2. `FURNITURE_NOT_MAPPED_IN_EXCHANGE_V1`: `Floor.furniture` remains in canonical `Building` and is omitted from structural/architectural Exchange V1 primitives.
3. `PROVISIONAL_FRAMING_EXCLUDED_BY_DEFAULT`: Architecture-first CAD sheets omit preliminary columns/beams unless the Structural Framing overlay/export is explicitly selected.
4. `CURVED_ROOM_BOUNDARY_TESSELLATED_POLYGON`: Curved walls export as exact analytic DXF `ARC` primitives while room area polylines retain canonical polygon vertices.
