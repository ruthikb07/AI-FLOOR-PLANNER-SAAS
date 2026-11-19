/**
 * RH PLANNER PHASE 7 — AUTOCAD DXF ARC ENTITIES & CSI ETABS .E2K CURVED / POLYGONAL EXPORT TEST
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';
import { renderBuilding } from '@ai-floor-planner/renderer';
import { projectBuildingTo3D, projectBuildingScene } from '@ai-floor-planner/projection-3d';
import { ResidentialCadSerializer } from '../cad/residential-cad-serializer';
import { generateETABSE2KFromBuilding } from '../services/etabs-e2k-generator';

describe('RH Phase 7: Curved/Polygonal DXF Arc & ETABS .e2k Serialization', () => {
  it('emits valid DXF with ARC entities on A-WALL-EXTR and discretized chord BEAMs/AREA in ETABS .e2k for CURVED_CRESCENT', () => {
    const result = solveMultiSheetApartmentProject({
      projectId: 'phase7_cad_test',
      projectName: 'Phase 7 Crescent Export Tower',
      structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
      plotWidthMm: 42000,
      plotDepthMm: 34000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.South],
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'pune_pmc',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 4,
      floorToFloorHeightMm: 3150,
      stiltHeightMm: 3150,
      flatsPerFloor: 4,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_AND_SURFACE',
      setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      buildingMassingShape: 'CURVED_CRESCENT',
    });

    const serializer = new ResidentialCadSerializer();
    const dxfOut = serializer.serialize(result.building, {
      standard: 'A',
      combined: true,
    });
    expect(dxfOut.verification.isValid).toBe(true);
    const dxfText = Buffer.from(dxfOut.data).toString('utf-8');
    expect(dxfText).toContain('ARC');
    expect(dxfText).toContain('A-WALL-EXTR');

    // Verify 2D SVG true arc paths and 3D curved projection meshes end-to-end
    const typFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    const svg = renderBuilding(result.building, typFloor.level, 1000, 800);
    expect(svg).toMatch(/<path[^>]*d="M [^"]* A [^"]*"/);

    const proj3d = projectBuildingTo3D(result.building);
    expect(proj3d.walls.some(w => Boolean(w.arc && w.arc.radiusMm > 0))).toBe(true);
    const scene3d = projectBuildingScene(result.building);
    expect(scene3d.meshes.length).toBeGreaterThan(0);

    const e2k = generateETABSE2KFromBuilding(result.building);
    expect(e2k).toContain('$ LINE CONNECTIVITIES');
    expect(e2k).toContain('BEAM230X450');
    expect(e2k).toContain('AREA');
    // Polygonal/curved floor slabs emit multi-point AREA polygon > 4 points
    const areaLine = e2k.split('\n').find(l => l.trim().startsWith('AREA') && l.includes('FLOOR'));
    expect(areaLine).toBeTruthy();
    const numPtsMatch = areaLine?.match(/FLOOR\s+(\d+)/);
    expect(Number(numPtsMatch?.[1] ?? 0)).toBeGreaterThan(4);
  });

  it('serializes Y_SHAPE_TRISKELE and TRIANGULAR_ATRIUM cleanly to DXF and ETABS .e2k without errors', () => {
    for (const shape of ['Y_SHAPE_TRISKELE', 'TRIANGULAR_ATRIUM'] as const) {
      const result = solveMultiSheetApartmentProject({
        projectId: `phase7_${shape.toLowerCase()}`,
        projectName: `Phase 7 ${shape}`,
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
        plotWidthMm: 42000,
        plotDepthMm: 34000,
        roadWidthMm: 12000,
        roadAccessSides: [Direction.South],
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction: 'pune_pmc',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 4,
        floorToFloorHeightMm: 3150,
        stiltHeightMm: 3150,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
        siteAmenities: DEFAULT_SITE_AMENITIES,
        stiltAmenities: DEFAULT_STILT_AMENITIES,
        terraceAmenities: DEFAULT_TERRACE_AMENITIES,
        parkingMode: 'STILT_AND_SURFACE',
        setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
        buildingMassingShape: shape,
      });

      const dxfOut = new ResidentialCadSerializer().serialize(result.building, {
        standard: 'A',
        combined: true,
      });
      expect(dxfOut.verification.isValid).toBe(true);

      const e2k = generateETABSE2KFromBuilding(result.building);
      expect(e2k).toContain('BEAM230X450');
      expect(e2k).toContain('AREA');
    }
  });
});
