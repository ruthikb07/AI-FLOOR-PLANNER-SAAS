import { describe, it, expect } from 'vitest';
import * as acad from '@node-projects/acad-ts';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';
import { polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { fitToView, renderFloor } from '@ai-floor-planner/renderer';
import { projectBuildingScene } from '@ai-floor-planner/projection-3d';
import {
  RESIDENTIAL_CAD_LAYERS,
  ResidentialCadSerializer,
} from '../cad/residential-cad-serializer.js';
import { generateETABSE2KFromBuilding } from '../services/etabs-e2k-generator.js';

function createConfig(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    plotWidthMm: 44_000,
    plotDepthMm: 34_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 3,
    floorToFloorHeightMm: 3000,
    stiltHeightMm: 3000,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    visitorParkingPercent: 10,
    setbacksMm: { front: 2000, rear: 2000, left: 2000, right: 2000 },
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    includeWindowChajjas: true,
    ...overrides,
  };
}

describe('RH Planner Phase 4 — Chajja Projections (SVG / DXF / 3D), 3D Balustrades & Unified ETABS .e2k Plan Dictionary', () => {
  it('1. renders dashed A-CHAJJA in SVG/DXF and 600mm 3D chajja + stair-balustrade when includeWindowChajjas is true, and omits chajjas when false', () => {
    const withChajjas = solveMultiSheetApartmentProject(createConfig({ includeWindowChajjas: true })).building;
    const withoutChajjas = {
      ...withChajjas,
      metadata: {
        ...withChajjas.metadata,
        generationBrief: {
          source: 'DETERMINISTIC' as const,
          units: [],
          ...withChajjas.metadata.generationBrief,
          includeWindowChajjas: false,
        },
      },
    };

    const typ = withChajjas.floors.find((f) => f.floorUse === 'RESIDENTIAL')!;
    const transform = fitToView(polygonBoundingBox(typ.boundary), 1000, 700, 40);

    // SVG Check
    const svgEnabled = renderFloor(typ, withChajjas, transform, 1000, 700);
    const svgDisabled = renderFloor(typ, withoutChajjas, transform, 1000, 700);
    expect(svgEnabled).toContain('data-cad-layer="A-CHAJJA"');
    expect(svgEnabled).toContain('class="window-chajja"');
    expect(svgEnabled).toContain('class="stair-balustrade"');
    expect(svgDisabled).not.toContain('data-cad-layer="A-CHAJJA"');

    // DXF Check
    expect(RESIDENTIAL_CAD_LAYERS['A-CHAJJA']).toBeDefined();
    const dxfOut = new ResidentialCadSerializer().serialize(withChajjas, {
      standard: 'A',
      combined: true,
    });
    const dxfDoc = new acad.DxfReader(dxfOut.data).read();
    const chajjaEntities = [...dxfDoc.entities!].filter(
      (e) => e instanceof acad.LwPolyline && e.layer.name === 'A-CHAJJA',
    );
    expect(chajjaEntities.length).toBeGreaterThan(0);

    // 3D Scene Projection Check
    const sceneOn = projectBuildingScene(withChajjas);
    const sceneOff = projectBuildingScene(withoutChajjas);
    const chajjaMeshes = sceneOn.meshes.filter((m) => m.kind === 'chajja');
    expect(chajjaMeshes.length).toBeGreaterThan(0);
    for (const m of chajjaMeshes) {
      const zs = m.geometry.vertices.map((v) => v[2]!);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(75, 0);
    }
    expect(sceneOff.meshes.filter((m) => m.kind === 'chajja')).toHaveLength(0);
    expect(sceneOn.meshes.some((m) => m.kind === 'stair-balustrade')).toBe(true);
  });

  it('2. generates ETABS .e2k with single shared 2D $ POINT COORDINATES dictionary and per-story $ LINE ASSIGNS', () => {
    const building = solveMultiSheetApartmentProject(createConfig()).building;
    const e2k = generateETABSE2KFromBuilding(building);

    expect(e2k).toContain('$ POINT COORDINATES');
    expect(e2k).toContain('$ LINE CONNECTIVITIES');
    expect(e2k).toContain('$ LINE ASSIGNS');
    expect(e2k).toContain('$ AREA ASSIGNS');

    const pointSecMatch = e2k.match(/\$ POINT COORDINATES([\s\S]*?)\$ LINE CONNECTIVITIES/);
    expect(pointSecMatch).not.toBeNull();
    const pointLines = pointSecMatch![1]!
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('POINT '));
    expect(pointLines.length).toBeGreaterThan(4);

    // Verify 2D plan dictionary (every point has quoted id + X + Y once; no duplicate X Y coordinates across stories)
    const coordPairs = new Set<string>();
    for (const line of pointLines) {
      const m = line.match(/POINT\s+"([^"]+)"\s+([-\d.]+)\s+([-\d.]+)/);
      expect(m, `Invalid POINT syntax: ${line}`).not.toBeNull();
      const key = `${Number(m![2]).toFixed(3)}:${Number(m![3]).toFixed(3)}`;
      expect(coordPairs.has(key), `Duplicate plan coordinate in $ POINT COORDINATES: ${key}`).toBe(false);
      coordPairs.add(key);
    }

    // Verify per-story assignments exist cleanly
    const assignSecMatch = e2k.match(/\$ LINE ASSIGNS([\s\S]*?)\$ AREA ASSIGNS/);
    expect(assignSecMatch).not.toBeNull();
    const assignLines = assignSecMatch![1]!
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('LINEASSIGN '));
    expect(assignLines.length).toBeGreaterThan(pointLines.length);
  });
});
