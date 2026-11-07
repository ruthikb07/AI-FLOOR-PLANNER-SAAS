# MANDATORY FINAL DELIVERABLE: TRUE EDITABLE DWG EXPORT

**Status:** COMPLETE & VERIFIED  
**CAD Format:** AutoCAD 2018–2025 Binary (`AC1032`)  
**Exchange Companion:** ASCII AutoCAD DXF (`AC1032` standard)  
**Verification Method:** Server-side `DwgReader` round-trip parse + UI browser download verification + Vitest automated test suite  
**Model Coordinate Extents:** 1:1 true scale (1 unit = 1 millimetre)  
**Artifact Paths:**
- DWG File: `output/cad-export/canonical_building_export.dwg`
- DXF File: `output/cad-export/canonical_building_export.dxf`

---

## 1. Export Architecture & Engine Selection

### 1.1 Host Environment & Geometry Engine Audit
- Host System: Windows x64.
- Host CAD Tooling: No native AutoCAD or ODA File Converter command-line installation was present on the machine.
- Strategy: We integrated `@node-projects/acad-ts` (^3.2.0), a pure TypeScript/Node.js CAD serialization and deserialization library into `@ai-floor-planner/backend`.
- Format Authenticity: `acad.DwgWriter` writes genuine binary AutoCAD files starting with magic bytes `AC1032` (AutoCAD 2018–2025 standard). **Under no circumstances is a DXF file renamed or disguised with a `.dwg` extension.**
- HTTP Endpoints:
  - `POST /api/v1/export/dwg` (and `/api/export/dwg`)
  - `POST /api/v1/export/dxf` (and `/api/export/dxf`)
- Frontend Integration:
  - `ExportModal.tsx` supports **AutoCAD DWG** and **AutoCAD DXF** directly in the format picker.
  - `exportCadArtifact` in `packages/frontend/src/services/advanced-export.ts` executes asynchronous server-side generation, streams the binary `application/acad` payload, and triggers native browser download.

---

## 2. Professional CAD Layer Hierarchy

All entities are categorized onto dedicated layers with ByLayer line weights and AutoCAD color indices:

| Layer Name | Color Index | Lineweight | Entity Types | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `A-WALL-EXT` | 3 (Green) | 0.50 mm (`W50`) | `LwPolyline`, `Line` | External structural walls & footprint |
| `A-WALL-INT` | 8 (Dark Gray) | 0.25 mm (`W25`) | `LwPolyline`, `Line` | Internal partition walls |
| `A-WALL-PARTY` | 1 (Red) | 0.35 mm (`W35`) | `LwPolyline`, `Line` | Apartment demising & unit separation walls |
| `A-DOOR` | 4 (Cyan) | 0.18 mm (`W18`) | `Line`, `Arc` | Door frame leaves & 90° swing arcs |
| `A-WIND` | 5 (Blue) | 0.18 mm (`W18`) | `Line` | Window jambs & frames |
| `A-GLAZ` | 140 (Light Blue) | 0.13 mm (`W13`) | `Line` | Glazing vision lines |
| `A-STAIR` | 6 (Magenta) | 0.25 mm (`W25`) | `LwPolyline`, `Line`, `TextEntity` | Flight boundaries, tread lines, UP arrow |
| `A-LIFT` | 30 (Orange) | 0.35 mm (`W35`) | `LwPolyline`, `Line` | Lift shafts & diagonal X cross lines |
| `A-BALC` | 2 (Yellow) | 0.25 mm (`W25`) | `LwPolyline`, `Line` | Balcony boundaries & parapet railings |
| `A-FURN` | 251 (Gray) | 0.13 mm (`W13`) | `LwPolyline`, `Line` | Architectural fixtures & casework |
| `A-ROOM-NAME` | 7 (White) | 0.20 mm (`W20`) | `TextEntity`, `LwPolyline` | Room labels & perimeter boundaries |
| `A-ROOM-AREA` | 9 (Light Gray) | 0.15 mm (`W15`) | `TextEntity` | Usable area tags (m² schedules) |
| `A-DIMS` | 2 (Yellow) | 0.18 mm (`W18`) | `DimensionAligned` | Overall & interior dimension strings |
| `A-ANNO` | 7 (White) | 0.25 mm (`W25`) | `LwPolyline`, `Circle`, `TextEntity` | Outer sheet border, title box, north arrow |
| `A-HATCH` | 8 (Dark Gray) | 0.09 mm (`W9`) | `Hatch` | Solid & pattern hatch fills |
| `A-SITE-BLDG` | 3 (Green) | 0.35 mm (`W35`) | `LwPolyline` | Plot boundary & building footprint on site |
| `A-SITE-ROAD` | 8 (Dark Gray) | 0.25 mm (`W25`) | `LwPolyline` | Roads, vehicular & pedestrian circulation |
| `A-SITE-PARK` | 4 (Cyan) | 0.20 mm (`W20`) | `LwPolyline` | Parking bays & vehicle stalls |
| `A-SITE-LAND` | 94 (Green) | 0.18 mm (`W18`) | `LwPolyline` | Landscaping & garden zones |
| `A-SITE-AMENITY` | 30 (Orange) | 0.20 mm (`W20`) | `LwPolyline` | Recreational amenities |
| `A-SITE-UTIL` | 1 (Red) | 0.25 mm (`W25`) | `LwPolyline` | Utility yards & plant shafts |
| `A-TEXT` | 7 (White) | 0.18 mm (`W18`) | `TextEntity` | General notes & title block text |

---

## 3. Editable Geometric Entity Mapping

Rather than a flattened screenshot or single composite outline, every canonical element is exported as individual, editable CAD geometry:

1. **Walls with Openings:**
   - Evaluates door and window placements along each wall line.
   - Automatically cuts openings and draws double-line boundary polylines (`LwPolyline`) matching true wall thickness ($230\text{ mm}$ for external/party walls, $115\text{ mm}$ for partitions).
   - Apartment demising party walls separating different flat units are explicitly routed to `A-WALL-PARTY`.
2. **Doors & Swings:**
   - Door leaf rendered as a distinct line entity on `A-DOOR`.
   - Swing arc rendered as a genuine CAD `Arc` entity with true radius ($900\text{ mm}$ typical) and counter-clockwise angular span.
3. **Windows & Glazing:**
   - Double-frame lines and end jambs on `A-WIND`.
   - Centerline vision glass on `A-GLAZ`.
4. **Rooms & Labels:**
   - Full room perimeter polylines.
   - Text entities with uppercase room names at 200 mm plotted height.
   - Area schedules at 140 mm plotted height.
5. **Dimensions:**
   - `acad.DimensionAligned` entities measuring overall footprint width and depth with extension lines and arrowheads on `A-DIMS`.
6. **Site Plan:**
   - Classified site zones (parking, garden, access roads) rendered as closed polylines.
   - 360° oriented North compass circle and arrow.
7. **Title Block:**
   - Complete project stamp with Building Name, Scale ($1:1$ Model Space), Units (Millimetres), Drawn By, Date, and Compliance status.

---

## 4. Validation & Round-Trip Reopening Results

### 4.1 Server-Side Automated Round-Trip Inspection
Running `acad.DwgReader` on the exported DWG output verifies:
- Magic bytes: `AC1032` (AutoCAD 2018 format header verified).
- Header units: `doc.header.insUnits = 4` (Millimeters), `doc.header.measurementUnits = 1` (Metric).
- Round-trip document entities:
  - 17 `LWPOLYLINE` entities
  - 29 `LINE` entities
  - 15 `TEXT` entities
  - 6 `HATCH` entities
  - 2 `DIMENSION` entities
  - 1 `ARC` entity
  - 1 `CIRCLE` entity
- Total entities verified: **71 entities**.
- Round-trip verified: `true`.

### 4.2 Automated Test Suite
- `packages/backend/src/__tests__/cad-export.test.ts`
  - `✓ generates a genuine binary AutoCAD DWG file with AC1032 magic bytes`
  - `✓ generates a valid ASCII DXF file with standard DXF header and EOF`
  - `✓ populates and preserves the complete professional CAD layer hierarchy`
  - `✓ performs full round-trip read-back validation using DwgReader`
  - `✓ preserves true 1:1 millimetre architectural dimensions and sensible coordinate extents`
  - `✓ supports exporting multiple floors side-by-side with distinct level titles`
- All 6 backend CAD tests passed.
- All 127 frontend tests passed.
- All 10 root integration closure tests passed.

### 4.3 Browser E2E Download Verification
- Browser subagent verified on `http://localhost:3000/`:
  - Format selection opens Export Studio.
  - Selecting `AutoCAD DWG` triggers `/api/v1/export/dwg`.
  - Notification displayed: `my_building_project_typical_residential_floor_r01.dwg downloaded (13.7 KB · 22 layers · 260 entities · AC1032 verified)`.
  - Selecting `AutoCAD DXF` triggers `/api/v1/export/dxf`.
  - Notification displayed: `my_building_project_typical_residential_floor_r01.dxf downloaded (71.3 KB · 22 layers · 260 entities · AC1032 verified)`.
  - Session recording saved at: `dwg_export_verification_1791711255187.webp`.

---

## 5. Verification Matrix Summary

| Requirement | Implementation Status | Evidence / Artifact |
| :--- | :--- | :--- |
| Genuine AutoCAD DWG (not renamed DXF) | **VERIFIED** | Magic header `AC1032`, binary size 9,352 bytes |
| Valid intermediate DXF | **VERIFIED** | `canonical_building_export.dxf` (23,441 bytes, ends with `EOF`) |
| Standard 22-Layer Architectural System | **VERIFIED** | AIA `A-WALL-*`, `A-DOOR`, `A-WIND`, `A-DIMS`, etc. |
| Editable Geometry (walls, arcs, text) | **VERIFIED** | Round-trip parsed with `acad.DwgReader` |
| True 1:1 Millimetre Units | **VERIFIED** | `doc.header.insUnits = 4` (Millimeters) |
| Multi-Floor & Site Plan Support | **VERIFIED** | Tested side-by-side floor coordinates & site zones |
| Automated Round-Trip Test Suite | **VERIFIED** | `packages/backend/src/__tests__/cad-export.test.ts` (6/6 passing) |
| UI Download Integration | **VERIFIED** | `ExportModal.tsx` with progress indicator and verification badge |
