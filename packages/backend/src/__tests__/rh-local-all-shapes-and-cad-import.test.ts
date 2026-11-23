import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  PlotShape,
  type BuildingMassingShape,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  BUILDING_SHAPE_CATALOG,
  solveMultiSheetApartmentProject,
} from '@ai-floor-planner/planning-engine';
import { projectBuildingTo3D } from '@ai-floor-planner/projection-3d';
import { createBackendServer } from '../server.js';
import {
  importFloorPlanLayoutFromCad,
  importPlotBoundaryFromCad,
  parseDxfContent,
} from '../services/cad-layout-importer.js';

function makeDxfPolyline(layer: string, pts: Array<[number, number, number?]>, closed = true): string {
  const lines = ['0', 'LWPOLYLINE', '8', layer, '90', String(pts.length), '70', closed ? '1' : '0'];
  for (const [x, y, bulge] of pts) {
    lines.push('10', String(x), '20', String(y));
    if (bulge && Math.abs(bulge) > 1e-6) lines.push('42', String(bulge));
  }
  return lines.join('\n');
}

function makeDxfLine(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return ['0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)].join('\n');
}

function makeDxfText(layer: string, x: number, y: number, text: string): string {
  return ['0', 'TEXT', '8', layer, '10', String(x), '20', String(y), '40', '250', '1', text].join('\n');
}

function wrapDxf(entities: string[], insUnits = 4): string {
  return [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$INSUNITS', '70', String(insUnits),
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    ...entities,
    '0', 'ENDSEC',
    '0', 'EOF',
    '',
  ].join('\n');
}

/** Realistic irregular quadrilateral plot DXF (angled north & east edges, ~44m x 36m). */
const IRREGULAR_PLOT_DXF = wrapDxf([
  makeDxfPolyline('PLOT-BOUNDARY', [
    [0, 0],
    [44_000, 1_500],
    [42_000, 35_000],
    [1_200, 36_500],
  ], true),
  makeDxfText('A-TEXT', 22_000, 18_000, 'SURVEY PLOT 42A'),
]);

/** Realistic 2BHK apartment floor-plan DXF with walls, doors, windows, OTS duct, and labels. */
const FLOOR_PLAN_DXF = wrapDxf([
  // Outer rectangle 14,000 x 10,000 mm broken into rooms via interior wall lines
  makeDxfLine('A-WALL', 0, 0, 14_000, 0),
  makeDxfLine('A-WALL', 14_000, 0, 14_000, 10_000),
  makeDxfLine('A-WALL', 14_000, 10_000, 0, 10_000),
  makeDxfLine('A-WALL', 0, 10_000, 0, 0),
  // Vertical partition at x=6000 (Living+Dining on west, Bedrooms/Kitchen on east)
  makeDxfLine('A-WALL', 6_000, 0, 6_000, 10_000),
  // Vertical partition at x=10000 in top & bottom halves
  makeDxfLine('A-WALL', 10_000, 0, 10_000, 10_000),
  // Horizontal partition at y=5000 across entire plan
  makeDxfLine('A-WALL', 0, 5_000, 14_000, 5_000),
  // Door & window markers
  makeDxfLine('A-DOOR', 6_000, 2_100, 6_000, 3_000),
  makeDxfLine('A-DOOR', 6_000, 7_100, 6_000, 8_000),
  makeDxfLine('A-WIND', 2_200, 0, 3_800, 0),
  makeDxfLine('A-WIND', 11_200, 10_000, 12_800, 10_000),
  // Furniture layer (should be ignored by default)
  makeDxfPolyline('A-FURN', [[500, 500], [2000, 500], [2000, 1400], [500, 1400]], true),
  // Room labels (note AutoCAD Y-up: y=7500 is top half, y=2500 is bottom half)
  makeDxfText('A-TEXT', 3_000, 7_500, 'Flat 101 Living Room'),
  makeDxfText('A-TEXT', 3_000, 2_500, 'Flat 101 Dining Hall'),
  makeDxfText('A-TEXT', 8_000, 7_500, 'Flat 101 Kitchen'),
  makeDxfText('A-TEXT', 8_000, 2_500, 'Flat 101 Master Bedroom'),
  makeDxfText('A-TEXT', 12_000, 7_500, 'Flat 101 Toilet'),
  makeDxfText('A-TEXT', 12_000, 2_500, 'Flat 101 Bedroom 02'),
]);

function makeBaseConfig(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: `rh-all-shapes-${overrides.buildingMassingShape ?? 'base'}`,
    projectName: `Local Shape Test ${overrides.buildingMassingShape ?? 'Base'}`,
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    plotWidthMm: 42_000,
    plotDepthMm: 34_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 1,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    flatsPerFloor: 4,
    units: Array.from({ length: 4 }, (_, i) => ({
      unitIndex: i + 1,
      bhkType: '2BHK' as const,
      hasUtilityBalcony: true,
    })),
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    generationSeed: 1,
    ...overrides,
  };
}

describe('RH Planner Local Web-Use: Real CAD Import, Local Disk Library & All Catalog Shapes', () => {
  let tempProjectsDir: string;
  let serverUrl: string;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-local-projects-test-'));
    process.env.RH_LOCAL_PROJECTS_DIR = tempProjectsDir;
    const server = createBackendServer({ gemini: null, briefInterpreterKind: 'local-stub' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}`;
    closeServer = () => new Promise(resolve => server.close(() => resolve()));
  });

  afterAll(async () => {
    await closeServer();
    delete process.env.RH_LOCAL_PROJECTS_DIR;
    fs.rmSync(tempProjectsDir, { recursive: true, force: true });
  });

  it('imports a real .DXF irregular quadrilateral plot boundary and generates a multi-storey apartment inside setbacks', () => {
    const parsed = parseDxfContent(IRREGULAR_PLOT_DXF, 'irregular-site-42a.dxf');
    expect(parsed.detectedUnit).toBe('mm');
    expect(parsed.layers.some(l => l.name === 'PLOT-BOUNDARY' && l.suggestedRole === 'boundary')).toBe(true);

    const imported = importPlotBoundaryFromCad(parsed, {
      action: 'import_plot',
      fileName: 'irregular-site-42a.dxf',
      projectName: 'Irregular Site 42A',
      setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      numTypicalFloors: 2,
      flatsPerFloor: 4,
      buildingMassingShape: 'IRREGULAR_ANGLED_PLOT',
      generateBuilding: true,
    });

    expect(imported.areaM2).toBeGreaterThan(1300);
    expect(imported.areaSqFt).toBeGreaterThan(14000);
    expect(imported.plotBoundary.polygon.points).toHaveLength(4);
    expect(imported.plotBoundary.inscribedEnvelopeMm?.w).toBeGreaterThan(25_000);
    expect(imported.building).toBeDefined();

    const bldg = imported.building!;
    expect(bldg.site.plotShape).toBe(PlotShape.Irregular);
    expect(bldg.site.plotBoundary.points).toHaveLength(4);
    expect(bldg.metadata.generationBrief?.buildingMassingShape).toBe('IRREGULAR_ANGLED_PLOT');
    expect(bldg.metadata.sourceCadUnderlay?.fileName).toBe('irregular-site-42a.dxf');

    const typ = bldg.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    expect(typ.columns.length).toBeGreaterThan(0);
    expect((typ.beams?.length ?? bldg.beams?.length ?? 0)).toBeGreaterThan(0);

    // Must project cleanly to 3D with zero crashes
    const proj = projectBuildingTo3D(bldg);
    expect(proj.walls.length).toBeGreaterThan(0);
    expect(proj.floorPlates.length).toBeGreaterThan(0);
  });

  it('imports a real .DXF floor plan layout, reconstructs rooms/walls/openings, synthesizes structural framing, and projects to 3D cleanly', () => {
    const parsed = parseDxfContent(FLOOR_PLAN_DXF, 'existing-2bhk-plan.dxf');
    expect(parsed.layers.find(l => l.name === 'A-FURN')?.defaultSelected).toBe(false);

    const imported = importFloorPlanLayoutFromCad(parsed, {
      action: 'import_floor_plan',
      fileName: 'existing-2bhk-plan.dxf',
      projectName: 'Existing 2BHK CAD Plan',
      numTypicalFloors: 4,
      verticalStackType: 'STILT_PLUS_N',
    });

    expect(imported.extractedRoomCount).toBe(6);
    expect(imported.extractedWallCount).toBeGreaterThan(8);
    expect(imported.extractedDoorCount).toBeGreaterThan(0);
    expect(imported.extractedWindowCount).toBeGreaterThan(0);
    expect(imported.structuralColumnsCount).toBeGreaterThan(0);
    expect(imported.structuralBeamsCount).toBeGreaterThan(0);

    const bldg = imported.building;
    expect(bldg.floors).toHaveLength(5); // Stilt + 4 typical residential floors
    expect(bldg.metadata.generationBrief?.buildingMassingShape).toBe('IMPORTED_CAD_LAYOUT');
    expect(bldg.metadata.sourceCadUnderlay?.polylines.length).toBeGreaterThan(0);

    const typ = bldg.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    const roomNames = typ.rooms.map(r => r.name);
    expect(roomNames).toContain('Flat 101 Living Room');
    expect(roomNames).toContain('Flat 101 Kitchen');
    expect(roomNames).toContain('Flat 101 Master Bedroom');

    // Must project cleanly to 3D with zero INVALID_OPENING_INTERVAL errors
    const proj = projectBuildingTo3D(bldg);
    expect(proj.walls.length).toBeGreaterThan(0);
    expect(proj.openings.length).toBeGreaterThan(0);
  });

  it('round-trips CURVED_CRESCENT, PINWHEEL_CLUSTER, IRREGULAR_ANGLED_PLOT, and IMPORTED_CAD_LAYOUT through /api/v1/local-projects with zero lost geometry or framing', async () => {
    const crescent = solveMultiSheetApartmentProject(makeBaseConfig({ buildingMassingShape: 'CURVED_CRESCENT' })).building;
    const pinwheel = solveMultiSheetApartmentProject(makeBaseConfig({ buildingMassingShape: 'PINWHEEL_CLUSTER' })).building;
    const irregular = importPlotBoundaryFromCad(parseDxfContent(IRREGULAR_PLOT_DXF, 'site.dxf'), {
      action: 'import_plot',
      fileName: 'site.dxf',
      setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      numTypicalFloors: 1,
      flatsPerFloor: 4,
      buildingMassingShape: 'IRREGULAR_ANGLED_PLOT',
      generateBuilding: true,
    }).building!;
    const cadPlan = importFloorPlanLayoutFromCad(parseDxfContent(FLOOR_PLAN_DXF, 'floor.dxf'), {
      action: 'import_floor_plan',
      fileName: 'floor.dxf',
      numTypicalFloors: 2,
      verticalStackType: 'STILT_PLUS_N',
    }).building;

    const cases = [
      { id: 'save-crescent', shape: 'CURVED_CRESCENT', building: crescent },
      { id: 'save-pinwheel', shape: 'PINWHEEL_CLUSTER', building: pinwheel },
      { id: 'save-irregular', shape: 'IRREGULAR_ANGLED_PLOT', building: irregular },
      {
        id: 'save-cad-plan',
        shape: 'IMPORTED_CAD_LAYOUT',
        building: cadPlan,
        sourceCad: { fileName: 'floor.dxf', contentText: FLOOR_PLAN_DXF },
      },
    ];

    for (const c of cases) {
      const saveRes = await fetch(`${serverUrl}/api/v1/local-projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: c.id,
          name: c.building.name,
          building: c.building,
          sourceCad: c.sourceCad,
        }),
      });
      expect(saveRes.ok).toBe(true);
      const savedJson = (await saveRes.json()) as { manifest: { shapeId: string; hasSourceCad: boolean } };
      expect(savedJson.manifest.shapeId).toBe(c.shape);
      if (c.sourceCad) expect(savedJson.manifest.hasSourceCad).toBe(true);

      const loadRes = await fetch(`${serverUrl}/api/v1/local-projects/${c.id}`);
      expect(loadRes.ok).toBe(true);
      const loaded = (await loadRes.json()) as { building: typeof c.building };

      const origFloor = c.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
      const loadedFloor = loaded.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
      expect(loadedFloor.rooms.length).toBe(origFloor.rooms.length);
      expect(loadedFloor.walls.length).toBe(origFloor.walls.length);
      expect(loadedFloor.columns.length).toBe(origFloor.columns.length);
      expect(loadedFloor.columns.length).toBeGreaterThan(0);
      expect(loaded.building.metadata.generationBrief?.buildingMassingShape).toBe(c.shape);

      if (c.shape === 'CURVED_CRESCENT') {
        expect(loadedFloor.walls.filter(w => Boolean(w.arc && w.arc.radiusMm > 0)).length).toBeGreaterThan(0);
      }
      if (c.shape === 'PINWHEEL_CLUSTER') {
        const ducts = loadedFloor.rooms.filter(r => r.architecturalRole === 'OPEN_TO_SKY_VOID' && r.tags.includes('shaft:interflat'));
        expect(ducts).toHaveLength(4);
      }
      if (c.sourceCad) {
        const cadRes = await fetch(`${serverUrl}/api/v1/local-projects/${c.id}/source-cad`);
        expect(cadRes.ok).toBe(true);
        expect(await cadRes.text()).toContain('Flat 101 Living Room');
      }
    }

    const listRes = await fetch(`${serverUrl}/api/v1/local-projects`);
    expect(listRes.ok).toBe(true);
    const listJson = (await listRes.json()) as { projects: Array<{ projectId: string }> };
    expect(listJson.projects.length).toBe(4);

    // Delete round-trip
    const delRes = await fetch(`${serverUrl}/api/v1/local-projects/save-cad-plan`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
  }, 60_000);

  it('executes ALL catalog shapes cleanly with non-zero structural framing and zero 3D projection crashes', () => {
    expect(BUILDING_SHAPE_CATALOG.length).toBeGreaterThanOrEqual(21);
    for (const entry of BUILDING_SHAPE_CATALOG) {
      const shapeId = entry.id as BuildingMassingShape;
      const result = solveMultiSheetApartmentProject(
        makeBaseConfig({
          buildingMassingShape: shapeId,
          shapeParams: entry.defaultParams,
        }),
      );
      const bldg = result.building;
      const typ = bldg.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
      expect(typ, `Residential floor missing for ${shapeId}`).toBeDefined();
      expect(typ.rooms.length, `Rooms missing for ${shapeId}`).toBeGreaterThan(0);
      expect(typ.columns.length, `Columns missing for ${shapeId}`).toBeGreaterThan(0);
      expect(typ.beams?.length ?? bldg.beams?.length ?? 0, `Beams missing for ${shapeId}`).toBeGreaterThan(0);

      // Must project cleanly to 3D with zero exceptions
      const proj = projectBuildingTo3D(bldg);
      expect(proj.walls.length, `3D walls missing for ${shapeId}`).toBeGreaterThan(0);
      expect(proj.floorPlates.length, `3D slabs missing for ${shapeId}`).toBeGreaterThan(0);
    }
  }, 180_000);
});
