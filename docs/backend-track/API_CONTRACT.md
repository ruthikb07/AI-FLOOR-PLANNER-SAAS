# ARGON 4 — Backend API Contract & Export Specifications

**Author:** Lead Computational Architecture & TS Backend Engineer  
**Role:** Track A — Backend & Geometry Engines  
**Status:** PRODUCTION SPECIFICATION  
**Date:** November 2026  

---

## 1. Architectural Generation & Synthesis Endpoints

### 1.1 `POST /api/apartment/synthesize`
Generates a complete multi-story residential building adhering to statutory setbacks, unit manifests, and structural grids.

**Request Schema (`MultiSheetApartmentConfig`):**
```typescript
interface MultiSheetApartmentConfig {
  projectName: string;
  plotWidthMm: number;
  plotDepthMm: number;
  roadWidthMm: number;
  roadAccessSides: ('north' | 'south' | 'east' | 'west')[];
  setbacksMm: {
    front: number;
    rear: number;
    left: number;
    right: number;
  };
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT' | 'FULL_LOT_100_PERCENT';
  jurisdiction: string;
  verticalStackType: 'STILT_PLUS_N' | 'GROUND_PLUS_N';
  numTypicalFloors: number;
  flatsPerFloor: 1 | 2 | 3 | 4;
  units: Array<{
    unitIndex: number;
    bhkType: '1BHK' | '2BHK' | '3BHK' | '4BHK';
    hasUtilityBalcony?: boolean;
    targetCarpetSqFt?: number;
  }>;
  parkingMode?: 'STILT_ONLY' | 'BASEMENT_AND_STILT';
  aiPrompt?: string;
}
```

**Response Schema:**
```typescript
interface SynthesisResponse {
  building: Building;
  validationReport: {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  };
  regulatoryStatus: 'COMPLIANT' | 'NON_COMPLIANT';
  udcprReport: UDCPRComplianceReport;
}
```

---

## 2. Interactive Area Customization & Regeneration

### 2.1 `POST /api/rooms/regenerate-area`
Allows precise single-room area modification while solving for surrounding room adjustments and safeguarding locked rooms, plot boundaries, and structural elements.

**Request Schema:**
```typescript
interface RoomAreaRegenerationRequest {
  building: Building;
  floorId: string;
  roomId: string;
  targetAreaMm2: number;
  lockedRoomIds?: string[];
  preserveAspect?: boolean;
}
```

**Response Schema:**
```typescript
interface RoomAreaRegenerationResponse {
  isFeasible: boolean;
  candidates: Array<{
    building: Building;
    deltaMm2: number;
    affectedRoomIds: string[];
    costScore: number;
  }>;
  diagnostics?: string[];
  reason?: string;
}
```

---

## 3. CAD & 3D Procedural Export Endpoints

### 3.1 `POST /api/export/multi-story-cad`
Generates an audited multi-sheet AutoCAD package (DXF and DWG via Autodesk AutoCAD 2021 `accoreconsole.exe`).

**CAD Layer Standards:**
- `A-WALL-EXTR`: Exterior perimeter structural walls ($230\text{ mm}$ solid hatching).
- `A-WALL-INTR`: Internal partition walls ($115\text{ mm}$).
- `A-DOOR`: Door leaf, frame, and swing arc ($90^\circ$ swing).
- `A-GLAZ`: Windows, glass partitions, and balcony railings.
- `A-COLS`: Reinforced concrete structural column grid.
- `A-FURN`: Architectural furniture symbols (Plancraft layer).
- `A-FLOR-LEVL`: Slab boundaries, balcony depressions, and floor drops.
- `A-ANNO-DIMS`: Aligned and linear dimension strings in millimeters.

**Response Schema:**
```typescript
interface CadPackageResponse {
  directory: string;
  status: 'SUCCESS' | 'PARTIAL';
  files: number;
  nativeAudits: number;
  zeroErrorAudits: number;
  sheets: Array<{
    sheetName: string;
    level: number;
    dxfUrl: string;
    dwgUrl?: string;
  }>;
}
```

### 3.2 `POST /api/export/blender`
Compiles a complete 3D procedural Blender scene (`.blend`) and WebGL binary glTF (`.glb`).

**Scene Organization:**
- Collection `Building_ARGON4`: Root collection.
  - Sub-collections `Level_00_Stilt`, `Level_01_Typical`, ..., `Level_04_Terrace`.
  - Mesh objects: Walls (with Boolean opening cutters), Slabs, Sills, Columns, Beams, Furniture blocks.

