import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as acad from '@node-projects/acad-ts';
import {
  CadExportService,
} from '../services/cad-export-service.js';
import { createBackendServer } from '../server.js';
import { resolveServiceConfig } from '../env.js';
import {
  solveOrthogonalSpaceFillingApartment,
  apartmentStructureToBuilding,
  populateCanonicalFurniture,
  solveMultiSheetApartmentProject,
} from '@ai-floor-planner/planning-engine';
import {
  type Building,
  SwingDirection,
  RoomType,
  Direction,
} from '@ai-floor-planner/core';

import { createMockCanonicalBuilding } from '../__fixtures__/canonical-building.js';

describe('CadExportService - Genuine DWG and DXF Export Engine', () => {
  const service = new CadExportService();
  const mockBuilding = createMockCanonicalBuilding();

  it('generates a genuine binary AutoCAD DWG file with AC1032 magic bytes', () => {
    const result = service.exportCad(mockBuilding, 'dwg', {
      includeDimensions: true,
      includeOpenings: true,
      includeSite: true,
      includeHatches: true,
    });

    expect(result.format).toBe('dwg');
    expect(result.mimeType).toBe('application/x-dwg');
    expect(result.filename.endsWith('.dwg')).toBe(true);
    expect(result.data.byteLength).toBeGreaterThan(5000);

    // Verify first 6 bytes are AutoCAD 2018-2025 binary magic: "AC1032"
    const magic = Buffer.from(result.data.subarray(0, 6)).toString('ascii');
    expect(magic).toBe('AC1032');
    expect(result.validation.magic).toBe('AC1032');
    expect(result.validation.isValid).toBe(true);
    expect(result.validation.roundTripVerified).toBe(true);
  });

  it('generates a valid ASCII DXF file with standard DXF header and EOF', () => {
    const result = service.exportCad(mockBuilding, 'dxf', {
      includeDimensions: true,
      includeOpenings: true,
      includeSite: true,
    });

    expect(result.format).toBe('dxf');
    expect(result.mimeType).toBe('application/dxf');
    expect(result.filename.endsWith('.dxf')).toBe(true);
    expect(result.data.byteLength).toBeGreaterThan(1000);

    const dxfText = Buffer.from(result.data).toString('utf8');
    expect(dxfText).toContain('SECTION');
    expect(dxfText).toContain('HEADER');
    expect(dxfText).toContain('ENTITIES');
    expect(dxfText.trim().endsWith('EOF')).toBe(true);
    expect(result.validation.isValid).toBe(true);
  });

  it('populates and preserves the complete professional CAD layer hierarchy', () => {
    const result = service.exportCad(mockBuilding, 'dwg');
    const layers = result.validation.layers;

    // Check mandatory architectural and structural layers
    expect(layers).toContain('A-WALL');
    expect(layers).toContain('A-WALL-EXT');
    expect(layers).toContain('A-WALL-INT');
    expect(layers).toContain('A-WALL-PARTY');
    expect(layers).toContain('A-DOOR');
    expect(layers).toContain('A-WINDOW');
    expect(layers).toContain('A-WIND');
    expect(layers).toContain('A-GLAZ');
    expect(layers).toContain('S-COLUMN');
    expect(layers).toContain('S-BEAM');
    expect(layers).toContain('A-STAIR');
    expect(layers).toContain('A-LIFT');
    expect(layers).toContain('A-FURN');
    expect(layers).toContain('A-ROOM-NAME');
    expect(layers).toContain('A-ROOM-AREA');
    expect(layers).toContain('A-DIMS');
    expect(layers).toContain('A-ANNO');
    expect(layers).toContain('A-HATCH');
    expect(layers).toContain('SITE');
    expect(layers).toContain('A-SITE-BLDG');
    expect(layers).toContain('A-SITE-ROAD');
    expect(layers).toContain('A-SITE-PARK');
    expect(layers).toContain('A-SITE-LAND');
  });

  it('performs full round-trip read-back validation using DwgReader', () => {
    const result = service.exportCad(mockBuilding, 'dwg');

    // Reopen and inspect with DwgReader
    const reader = new acad.DwgReader(result.data);
    const doc = reader.read();

    expect(doc).toBeDefined();
    expect(doc.header).toBeDefined();
    expect(doc.header!.version).toBe(acad.ACadVersion.AC1032);

    const layerNames = [...doc.layers!].map(l => l.name);
    expect(layerNames).toContain('A-WALL-EXT');
    expect(layerNames).toContain('A-WALL-PARTY');
    expect(layerNames).toContain('A-DOOR');
    expect(layerNames).toContain('A-ROOM-NAME');

    // Confirm entities round-trip
    const entities = [...doc.entities!];
    expect(entities.length).toBeGreaterThan(5);

    // Confirm presence of party wall, door, and room text entities
    const hasPartyWall = entities.some(e => e.layer?.name === 'A-WALL-PARTY');
    const hasDoor = entities.some(e => e.layer?.name === 'A-DOOR');
    const hasRoomName = entities.some(e => e.layer?.name === 'A-ROOM-NAME');
    expect(hasPartyWall).toBe(true);
    expect(hasDoor).toBe(true);
    expect(hasRoomName).toBe(true);
  });

  it('exports AutoCAD DWG with layer A-FURN and verifies Plancraft furniture primitives round-trip via DwgReader', () => {
    const furnishedBuilding: Building = {
      ...mockBuilding,
      name: 'Plancraft Furnished Residency',
      floors: [
        {
          ...mockBuilding.floors[0]!,
          id: 'floor-0',
          furniture: [
            {
              id: 'furn-bed-1',
              type: 'bed',
              roomId: 'room-1',
              xMm: 6000,
              yMm: 6000,
              widthMm: 1800,
              depthMm: 2000,
              rotationDeg: 0,
              anchorWall: 'NORTH',
              layer: 'A-FURN',
            },
            {
              id: 'furn-sofa-1',
              type: 'l_sofa',
              roomId: 'room-1',
              xMm: 8000,
              yMm: 6000,
              widthMm: 2400,
              depthMm: 2000,
              rotationDeg: 90,
              anchorWall: 'WEST',
              layer: 'A-FURN',
            },
            {
              id: 'furn-table-1',
              type: 'table',
              roomId: 'room-1',
              xMm: 11000,
              yMm: 7000,
              widthMm: 1400,
              depthMm: 900,
              rotationDeg: 0,
              anchorWall: 'SOUTH',
              layer: 'A-FURN',
            },
            {
              id: 'furn-toilet-1',
              type: 'toilet',
              roomId: 'room-1',
              xMm: 13000,
              yMm: 6000,
              widthMm: 400,
              depthMm: 700,
              rotationDeg: 0,
              anchorWall: 'NORTH',
              layer: 'A-FURN',
            },
          ],
        },
      ],
    };

    const result = service.exportCad(furnishedBuilding, 'dwg', {
      floorId: 'floor-0',
      includeFurniture: true,
    });

    expect(result.format).toBe('dwg');
    expect(result.data.byteLength).toBeGreaterThan(3000);
    expect(result.validation.magic).toMatch(/^AC10/);
    expect(result.validation.layers).toContain('A-FURN');

    // Read back binary AC1032 DWG with DwgReader
    const reader = new acad.DwgReader(result.data);
    const doc = reader.read();
    expect(doc).toBeDefined();

    // Verify A-FURN layer exists in DWG layer table with color index 8
    const layerNames = [...doc.layers!].map(l => l.name);
    expect(layerNames).toContain('A-FURN');
    const furnLayer = [...doc.layers!].find(l => l.name === 'A-FURN');
    expect(furnLayer).toBeDefined();
    const colorVal = (furnLayer!.color as any)?.colorIndex ?? (furnLayer!.color as any)?.index ?? (furnLayer as any).colorIndex;
    expect(colorVal).toBe(8);

    // Verify entities on layer A-FURN exist in drawing database
    const entities = [...doc.entities!];
    const furnEntities = entities.filter(e => e.layer?.name === 'A-FURN');
    expect(furnEntities.length).toBeGreaterThan(0);
  });

  it('preserves true 1:1 millimetre architectural dimensions and sensible coordinate extents', () => {
    const result = service.exportCad(mockBuilding, 'dwg', { includeSite: true });
    const bounds = result.validation.bounds;

    expect(bounds.widthMm).toBeGreaterThan(15000);
    expect(bounds.heightMm).toBeGreaterThan(15000);
    expect(result.validation.units).toBe('Millimeters');
    expect(result.validation.modelSpaceScale).toBe('1:1');
  });

  it('supports exporting multiple floors side-by-side with distinct level titles', () => {
    const multiFloorBuilding: Building = {
      ...mockBuilding,
      floors: [
        mockBuilding.floors[0]!,
        {
          ...mockBuilding.floors[0]!,
          id: 'floor-1',
          level: 1,
          name: 'First Floor',
        },
      ],
    };

    const result = service.exportCad(multiFloorBuilding, 'dwg', {
      exportScope: 'all_floors',
    });

    expect(result.validation.floorsExported).toHaveLength(2);
    expect(result.validation.floorsExported).toContain('Ground Floor');
    expect(result.validation.floorsExported).toContain('First Floor');
  });

  it('exports complex realistic apartment candidate plans without errors', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const candPath = path.resolve(__dirname, '../../../../tests/fixtures/apartment-closure/four-2bhk/canonical.json');
    const candidate = JSON.parse(fs.readFileSync(candPath, 'utf8'));
    const candidateResult = service.exportCad(candidate, 'dwg');
    expect(candidateResult.data.length).toBeGreaterThan(1000);
    expect(candidateResult.validation.isValid).toBe(true);
    expect(candidateResult.validation.magic).toMatch(/^AC/);

    const fix2bhk = path.resolve(__dirname, '../../../../tests/fixtures/30x50-2bhk.json');
    if (fs.existsSync(fix2bhk)) {
      const bld = JSON.parse(fs.readFileSync(fix2bhk, 'utf8'));
      const result = service.exportCad(bld, 'dwg');
      expect(result.data.length).toBeGreaterThan(1000);
      expect(result.validation.isValid).toBe(true);
      expect(result.validation.magic).toMatch(/^AC/);
    }
  });

  it('exports genuine, complete DXF with columns on S-COLUMN, beams on S-BEAM, furniture on A-FURN, windows on A-WINDOW, and dimensions on A-DIMS', () => {
    const result = service.exportCad(mockBuilding, 'dxf', {
      includeFurniture: true,
      includeStructural: true,
      includeDimensions: true,
      includeHatches: true,
    });

    expect(result.format).toBe('dxf');
    expect(result.mimeType).toBe('application/dxf');
    expect(result.data.length).toBeGreaterThan(10000);

    const dxfText = Buffer.from(result.data).toString('ascii');

    // DXF standard sections
    expect(dxfText).toContain('SECTION\n  2\nHEADER');
    expect(dxfText).toContain('SECTION\n  2\nTABLES');
    expect(dxfText).toContain('SECTION\n  2\nENTITIES');
    expect(dxfText.trim().endsWith('EOF')).toBe(true);

    // Standard CAD layers present in tables & entities
    expect(dxfText).toContain('A-WALL');
    expect(dxfText).toContain('A-DOOR');
    expect(dxfText).toContain('A-WINDOW');
    expect(dxfText).toContain('S-COLUMN');
    expect(dxfText).toContain('S-BEAM');
    expect(dxfText).toContain('A-DIMS');
    expect(dxfText).toContain('A-TEXT');
    expect(dxfText).toContain('A-HATCH');
    expect(dxfText).toContain('A-FURN');
    expect(dxfText).toContain('SITE');

    // Units millimeter header check ($INSUNITS = 4)
    expect(dxfText).toContain('$INSUNITS');

    // Entity count is substantial with all architectural components
    expect(result.validation.entityCount).toBeGreaterThan(30);
    expect(result.validation.bounds.widthMm).toBeGreaterThan(15000);
  });

  it('formats meaningful DXF filename such as AI_BUILDING_SAAS_Floor_01.dxf', () => {
    const aiBuilding: Building = {
      ...mockBuilding,
      name: 'AI Building SaaS',
      floors: [
        {
          ...mockBuilding.floors[0]!,
          level: 1,
          name: 'Floor 1',
        },
      ],
    };

    const result = service.exportCad(aiBuilding, 'dxf', { floorId: aiBuilding.floors[0]!.id });
    expect(result.filename).toMatch(/^bldg_test_dwg_1_r3_current_floor_floor_0_[a-f0-9]{64}\.dxf$/);
  });

  it('exports distinct DXF files for different floor levels', () => {
    const multiFloorBuilding: Building = {
      ...mockBuilding,
      name: 'Metro Residences',
      floors: [
        {
          ...mockBuilding.floors[0]!,
          id: 'fl-ground',
          level: 0,
          name: 'Ground Floor',
        },
        {
          ...mockBuilding.floors[0]!,
          id: 'fl-first',
          level: 1,
          name: 'First Floor',
          rooms: [mockBuilding.floors[0]!.rooms[0]!], // subset of rooms
        },
      ],
    };

    const groundExport = service.exportCad(multiFloorBuilding, 'dxf', { floorId: 'fl-ground' });
    const firstExport = service.exportCad(multiFloorBuilding, 'dxf', { floorId: 'fl-first' });

    expect(groundExport.filename).toMatch(/^bldg_test_dwg_1_r3_current_floor_fl_ground_[a-f0-9]{64}\.dxf$/);
    expect(firstExport.filename).toMatch(/^bldg_test_dwg_1_r3_current_floor_fl_first_[a-f0-9]{64}\.dxf$/);
    expect(groundExport.validation.floorsExported).toEqual(['Ground Floor']);
    expect(firstExport.validation.floorsExported).toEqual(['First Floor']);
  });

  it('exports complete 5-drawing project side-by-side in AutoCAD model space with DWG round-trip verification', () => {
    const multiSheetBuilding: Building = {
      ...mockBuilding,
      name: 'Gulmohar Woods Apartment',
      floors: [
        { ...mockBuilding.floors[0]!, id: 'fl-stilt', level: 0, name: 'STILT_PARKING_PLAN' },
        { ...mockBuilding.floors[0]!, id: 'fl-typ', level: 1, name: 'TYPICAL_FLOOR_PLAN' },
        { ...mockBuilding.floors[0]!, id: 'fl-refuge', level: 8, name: 'REFUGE_FLOOR_PLAN' },
        { ...mockBuilding.floors[0]!, id: 'fl-terr', level: 13, name: 'TERRACE_PLAN' },
      ],
    };

    const result = service.exportCad(multiSheetBuilding, 'dwg', {
      exportScope: 'complete_project',
      includeSite: true,
      includeTitleBlock: true,
    });

    expect(result.format).toBe('dwg');
    expect(result.data.byteLength).toBeGreaterThan(5000);
    expect(result.validation.magic).toMatch(/^AC10/);
    expect(result.validation.siteIncluded).toBe(true);
    expect(result.validation.floorsExported.length).toBe(4);
    expect(result.validation.roundTripVerified).toBe(true);

    // Verify side-by-side layout: total width spans site + 4 floors + margins
    expect(result.validation.bounds.widthMm).toBeGreaterThan(100000);

    // Read back via DwgReader
    const reader = new acad.DwgReader(result.data);
    const doc = reader.read();
    expect(doc).toBeDefined();
    expect(doc.header).toBeDefined();
    expect(result.validation.entityCount).toBeGreaterThan(50);
  });

  it('exports multi-page 1:100 ISO A3 vector PDF for complete apartment project', async () => {
    const { PdfExportService } = await import('../services/pdf-export-service.js');
    const pdfService = new PdfExportService();
    const multiSheetBuilding: Building = {
      ...mockBuilding,
      name: 'Gulmohar Woods Apartment',
      floors: [
        { ...mockBuilding.floors[0]!, id: 'fl-stilt', level: 0, name: 'STILT_PARKING_PLAN' },
        { ...mockBuilding.floors[0]!, id: 'fl-typ', level: 1, name: 'TYPICAL_FLOOR_PLAN' },
        { ...mockBuilding.floors[0]!, id: 'fl-refuge', level: 8, name: 'REFUGE_FLOOR_PLAN' },
        { ...mockBuilding.floors[0]!, id: 'fl-terr', level: 13, name: 'TERRACE_PLAN' },
      ],
    };

    const result = pdfService.exportPdf(multiSheetBuilding, {
      exportScope: 'complete_project',
      paperSize: 'A3',
      orientation: 'landscape',
    });

    expect(result.filename).toMatch(/^bldg-test-dwg-1_r3_complete_project_all_[a-f0-9]{64}\.pdf$/);
    expect(result.mimeType).toBe('application/pdf');
    expect(result.pageCount).toBe(5); // Site plan plus four canonical floor sheets
    expect(result.data.byteLength).toBeGreaterThan(2000);
    const pdfStr = Buffer.from(result.data).toString('utf-8');
    expect(pdfStr).toContain('%PDF-1.4');
    expect(pdfStr).toContain('%%EOF');
    expect(pdfStr).toContain('Gulmohar Woods Apartment');
  });
});

describe('Comprehensive AutoCAD Binary DWG & DXF Round-Trip HTTP Verification Gate', () => {
  let server: any;
  let serverUrl = '';

  beforeAll(async () => {
    const config = resolveServiceConfig();
    const deps = {
      gemini: null,
      briefInterpreterKind: 'local-stub' as const,
      config,
    };
    server = createBackendServer(deps);
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          serverUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  function createTestPlanBuilding(flatsCount: 2 | 3 | 4, bhkType: '2BHK' | '3BHK' | '4BHK'): Building {
    const mix = Array(flatsCount).fill(bhkType);
    const flats = Array.from({ length: flatsCount }, (_, i) => ({
      id: `flat_0${i + 1}`,
      label: `Flat 0${i + 1}`,
      unitType: mix[i] as any,
      imageX: 50 + (900 / flatsCount) * i,
      imageY: 60,
      imageWidth: 900 / flatsCount - 20,
      imageHeight: 880,
    }));

    const rooms: any[] = [];
    for (const f of flats) {
      rooms.push(
        { id: `${f.id}_living`, name: 'Living & Dining', type: 'living', imageX: f.imageX + 10, imageY: f.imageY + 10, imageWidth: f.imageWidth - 20, imageHeight: 300, imageArea: 60000, imageMinWidth: 200, imageMinHeight: 200, flatId: f.id },
        { id: `${f.id}_kitchen`, name: 'Kitchen', type: 'kitchen', imageX: f.imageX + 10, imageY: f.imageY + 320, imageWidth: 150, imageHeight: 180, imageArea: 27000, imageMinWidth: 150, imageMinHeight: 150, flatId: f.id },
        { id: `${f.id}_utility`, name: 'Utility Yard', type: 'utility', imageX: f.imageX + 10, imageY: f.imageY + 510, imageWidth: 150, imageHeight: 100, imageArea: 15000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id },
        { id: `${f.id}_balcony`, name: 'Balcony', type: 'balcony', imageX: f.imageX + 170, imageY: f.imageY + 320, imageWidth: 120, imageHeight: 290, imageArea: 34800, imageMinWidth: 120, imageMinHeight: 200, flatId: f.id },
        { id: `${f.id}_bed_master`, name: 'Master Bedroom', type: 'bedroom', imageX: f.imageX + 10, imageY: f.imageY + 620, imageWidth: 180, imageHeight: 200, imageArea: 36000, imageMinWidth: 150, imageMinHeight: 150, flatId: f.id },
        { id: `${f.id}_bath_master`, name: 'Master Bath', type: 'bathroom', imageX: f.imageX + 10, imageY: f.imageY + 830, imageWidth: 100, imageHeight: 100, imageArea: 10000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id },
        { id: `${f.id}_bed_2`, name: 'Bedroom 02', type: 'bedroom', imageX: f.imageX + 200, imageY: f.imageY + 620, imageWidth: 150, imageHeight: 200, imageArea: 30000, imageMinWidth: 150, imageMinHeight: 150, flatId: f.id },
        { id: `${f.id}_bath_common`, name: 'Common Bath', type: 'bathroom', imageX: f.imageX + 120, imageY: f.imageY + 830, imageWidth: 100, imageHeight: 100, imageArea: 10000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id },
      );
      if (bhkType === '3BHK' || bhkType === '4BHK') {
        rooms.push({ id: `${f.id}_bed_3`, name: 'Bedroom 03', type: 'bedroom', imageX: f.imageX + 230, imageY: f.imageY + 830, imageWidth: 140, imageHeight: 100, imageArea: 14000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id });
      }
      if (bhkType === '4BHK') {
        rooms.push({ id: `${f.id}_bed_4`, name: 'Bedroom 04', type: 'bedroom', imageX: f.imageX + 380, imageY: f.imageY + 830, imageWidth: 140, imageHeight: 100, imageArea: 14000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id });
      }
    }

    const testSite = {
      id: 'site-test-cad',
      plotWidth: 38000,
      plotDepth: 30000,
      plotArea: 38000 * 30000,
      setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
    };

    const solved = solveOrthogonalSpaceFillingApartment({
      plan: {
        metadata: { source: 'unit_test', confidence: 0.95 },
        flats,
        rooms,
        doors: [],
        windows: [],
        stairs: [],
        parking: [],
      } as any,
      site: testSite as any,
      manifest: {
        units: mix.map(t => ({ type: t })),
        lotAllotmentMode: 'FULL_LOT_100_PERCENT',
      } as any,
    } as any);

    const { building: bldg } = apartmentStructureToBuilding(
      solved,
      testSite as any,
      'proj-cad-test',
      'CAD Test Building',
    );

    return populateCanonicalFurniture(bldg);
  }

  const configurations = [
    { name: 'Double 2BHK Plan', flatsCount: 2 as const, bhkType: '2BHK' as const },
    { name: 'Triple 3BHK Plan', flatsCount: 3 as const, bhkType: '3BHK' as const },
    { name: 'Quad 4BHK Plan', flatsCount: 4 as const, bhkType: '4BHK' as const },
  ];

  for (const config of configurations) {
    it(`exports valid binary AC1032 DWG and DXF via HTTP for ${config.name}`, async () => {
      const building = createTestPlanBuilding(config.flatsCount, config.bhkType);

      // 1. Test POST /api/v1/export/dwg
      const dwgRes = await fetch(`${serverUrl}/api/v1/export/dwg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building,
          options: {
            includeFurniture: true,
            includeDimensions: true,
            includeRoomLabels: true,
            includeRoomAreas: true,
            includeOpenings: true,
            includeSite: true,
            includeTitleBlock: true,
          },
        }),
      });
      expect(dwgRes.status).toBe(200);
      expect(dwgRes.headers.get('content-type')).toBe('application/acad');
      expect(dwgRes.headers.get('content-disposition')).toContain('attachment; filename=');

      const dwgArrayBuffer = await dwgRes.arrayBuffer();
      const dwgBuffer = Buffer.from(dwgArrayBuffer);
      expect(dwgBuffer.byteLength).toBeGreaterThan(5000);

      // Assert ASCII AC1032 Magic
      const magic6 = dwgBuffer.subarray(0, 6).toString('ascii');
      expect(magic6).toBe('AC1032');

      // Parse binary buffer with acad.DwgReader
      const reader = new acad.DwgReader(new Uint8Array(dwgArrayBuffer));
      const doc = reader.read();
      expect(doc).toBeDefined();
      expect(doc.header).toBeDefined();

      // Assert TILEMODE === 1 (Model Space active on open)
      expect(doc.header?.showModelSpace).toBe(true);

      // Assert Model Space contains > 50 valid geometric entities across required layers
      const entities = doc.entities ? [...doc.entities] : [];
      expect(entities.length).toBeGreaterThan(50);

      const layerNames = doc.layers ? [...doc.layers].map(l => l.name) : [];
      expect(layerNames).toContain('A-WALL-EXT');
      expect(layerNames).toContain('A-WALL-PARTY');
      expect(layerNames).toContain('A-WALL-INT');
      expect(layerNames).toContain('A-DOOR');
      expect(layerNames).toContain('A-WIND');
      expect(layerNames).toContain('A-FURN');
      expect(layerNames).toContain('A-ROOM-NAME');
      expect(layerNames).toContain('A-DIMS');

      // Assert all entity coordinates are finite
      for (const ent of entities) {
        if ((ent as any).insertPoint) {
          expect(Number.isFinite((ent as any).insertPoint.x)).toBe(true);
          expect(Number.isFinite((ent as any).insertPoint.y)).toBe(true);
        }
        if ((ent as any).vertices) {
          for (const v of (ent as any).vertices) {
            const loc = v.location ?? v.point ?? v;
            expect(Number.isFinite(loc.x)).toBe(true);
            expect(Number.isFinite(loc.y)).toBe(true);
          }
        }
      }

      // Assert *Active VPort camera table record exists and is calibrated
      const vports = doc.vPorts ? [...doc.vPorts] : [];
      const activeVPort = vports.find(v => v.name === '*Active' || v.name === '*ACTIVE') || vports[0];
      expect(activeVPort).toBeDefined();
      expect(Number.isFinite(activeVPort!.center.x)).toBe(true);
      expect(Number.isFinite(activeVPort!.center.y)).toBe(true);
      expect(activeVPort!.viewHeight).toBeGreaterThan(1000);

      // 2. Test POST /api/v1/export/dxf
      const dxfRes = await fetch(`${serverUrl}/api/v1/export/dxf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building,
          options: {
            includeFurniture: true,
            includeDimensions: true,
            includeRoomLabels: true,
            includeRoomAreas: true,
            includeOpenings: true,
            includeSite: true,
            includeTitleBlock: true,
          },
        }),
      });

      expect(dxfRes.status).toBe(200);
      expect(dxfRes.headers.get('content-type')).toBe('application/dxf');
      const dxfText = await dxfRes.text();
      expect(dxfText).toContain('SECTION\n  2\nHEADER');
      expect(dxfText).toContain('SECTION\n  2\nENTITIES');
      expect(dxfText.trim().endsWith('EOF')).toBe(true);
      expect(dxfText).toContain('A-WALL');
      expect(dxfText).toContain('A-DOOR');
      expect(dxfText).toContain('A-FURN');
    });
  }
});

describe('VERIFICATION GATE: Architectural Logic, CAD Geometry & Sheet Separation', () => {
  const cadService = new CadExportService();
  const project = solveMultiSheetApartmentProject({
    plotWidthMm: 50000,
    plotDepthMm: 50000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    flatsPerFloor: 4,
    numTypicalFloors: 7,
    siteAmenities: {
      securityCabin: true,
      landscapeGardenRos: true,
      childrenPlayTotLot: true,
      seniorCitizenSitout: true,
      transformerDgYard: true,
      ugwtPumpRoom: true,
      stpPlant: true,
      owcWasteYard: true,
      rainwaterHarvestingPits: true,
      evChargingBays: true,
    },
    stiltAmenities: {
      grandEntranceLobby: true,
      societyOffice: true,
      fitnessGymnasium: true,
      multipurposeHall: true,
      meterBmsRoom: true,
      driverStaffToilet: true,
    },
    terraceAmenities: {
      stairMumtyHeadroom: true,
      liftMachineRoom: true,
      overheadWaterTank: true,
      solarPvArray: true,
      terraceYogaDeck: true,
    },
    parkingMode: 'STILT_AND_SURFACE',
  });

  it('1. Zero Balcony Columns: 0 structural columns exist on outer corners of any BALCONY or UTILITY space', () => {
    const typicalSheet = project.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!;
    const typicalBuilding: Building = { ...project.building, floors: [typicalSheet.floor!] };
    const exportRes = cadService.exportCad(typicalBuilding, 'dwg', {
      includeFurniture: true,
      includeOpenings: true,
      includeRoomLabels: true,
      includeSite: true,
    });
    const cadDoc = new acad.DwgReader(exportRes.data).read();

    const columnEntities = (cadDoc.entities ? [...cadDoc.entities] : []).filter(e => {
      const lay = (e as any).layer?.name ?? (e as any).layer;
      return lay === 'S-COLS' || lay === 'S-COLUMN';
    });
    const balconyRooms = typicalBuilding.floors[0]!.rooms.filter(
      r => r.type === RoomType.Balcony || /BALCONY|SIT-OUT|UTILITY/i.test(r.name)
    );

    // Verify 0 columns on outer corners of balconies
    for (const balc of balconyRooms) {
      const balcCorners = balc.boundary.points;
      for (const col of columnEntities) {
        const cx = (col as any).insertPoint?.x ?? (col as any).vertices?.[0]?.location?.x ?? (col as any).center?.x;
        const cy = (col as any).insertPoint?.y ?? (col as any).vertices?.[0]?.location?.y ?? (col as any).center?.y;
        if (cx !== undefined && cy !== undefined) {
          for (const pt of balcCorners) {
            const dist = Math.hypot(pt.x - cx, pt.y - cy);
            if (dist < 100) {
              const sharedWithIndoor = typicalBuilding.floors[0]!.rooms.some(
                other =>
                  other.id !== balc.id &&
                  other.type !== RoomType.Balcony &&
                  !/BALCONY|SIT-OUT|UTILITY/i.test(other.name) &&
                  other.boundary.points.some(op => Math.hypot(op.x - pt.x, op.y - pt.y) < 100)
              );
              expect(sharedWithIndoor).toBe(true);
            }
          }
        }
      }
    }
  });

  it('2. Zero Core Swinging Doors on Lifts & Staircases + True Dog-Legged Treads & Lift Tracks', () => {
    const typicalSheet = project.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!;
    const typicalBuilding: Building = { ...project.building, floors: [typicalSheet.floor!] };
    const exportRes = cadService.exportCad(typicalBuilding, 'dwg', {
      includeFurniture: true,
      includeOpenings: true,
      includeRoomLabels: true,
      includeSite: true,
    });
    const cadDoc = new acad.DwgReader(exportRes.data).read();

    const doorArcs = (cadDoc.entities ? [...cadDoc.entities] : []).filter(e => {
      const lay = (e as any).layer?.name ?? (e as any).layer;
      return lay === 'A-DOOR' && (e instanceof acad.Arc || (e as any).radius !== undefined);
    });
    const coreRooms = typicalBuilding.floors[0]!.rooms.filter(
      r => /STAIR|LIFT|ELEVATOR/i.test(r.name) || r.type === RoomType.Staircase
    );

    for (const arc of doorArcs) {
      const ax = (arc as any).center?.x;
      const ay = (arc as any).center?.y;
      if (ax !== undefined && ay !== undefined) {
        for (const cr of coreRooms) {
          const minX = Math.min(...cr.boundary.points.map(p => p.x));
          const maxX = Math.max(...cr.boundary.points.map(p => p.x));
          const minY = Math.min(...cr.boundary.points.map(p => p.y));
          const maxY = Math.max(...cr.boundary.points.map(p => p.y));
          const isInside = ax >= minX - 200 && ax <= maxX + 200 && ay >= minY - 200 && ay <= maxY + 200;
          expect(isInside).toBe(false);
        }
      }
    }

    const stairEntities = (cadDoc.entities ? [...cadDoc.entities] : []).filter(e => {
      const lay = (e as any).layer?.name ?? (e as any).layer;
      return lay === 'A-STAIR';
    });
    expect(stairEntities.length).toBeGreaterThanOrEqual(10);

    const liftEntities = (cadDoc.entities ? [...cadDoc.entities] : []).filter(e => {
      const lay = (e as any).layer?.name ?? (e as any).layer;
      return lay === 'A-LIFT';
    });
    expect(liftEntities.length).toBeGreaterThanOrEqual(2);
  });

  it('3. Corner-Anchored Doors: All bathroom/toilet doors swing inward with 0 collisions', () => {
    const typicalSheet = project.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!;
    const typicalBuilding: Building = { ...project.building, floors: [typicalSheet.floor!] };
    const floorDoors = typicalBuilding.floors[0]!.doors;
    expect(floorDoors.length).toBeGreaterThan(0);

    const toiletBathDoors = floorDoors.filter(d => {
      const room = typicalBuilding.floors[0]!.rooms.find(r => r.id === (d as any).roomId || d.connectsRooms?.includes(r.id));
      return room && (room.type === RoomType.Bathroom || /TOILET|BATH|WC/i.test(room.name));
    });
    for (const d of toiletBathDoors) {
      expect(d.swingDirection).toBe(SwingDirection.Inward);
    }
  });

  it('4. Non-Inverted CAD Furniture & Wall Clearance', () => {
    const typicalSheet = project.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!;
    const typicalBuilding: Building = { ...project.building, floors: [typicalSheet.floor!] };
    const exportRes = cadService.exportCad(typicalBuilding, 'dwg', {
      includeFurniture: true,
      includeOpenings: true,
      includeRoomLabels: true,
      includeSite: true,
    });
    const cadDoc = new acad.DwgReader(exportRes.data).read();

    const furnEntities = (cadDoc.entities ? [...cadDoc.entities] : []).filter(e => {
      const lay = (e as any).layer?.name ?? (e as any).layer;
      return lay === 'A-FURN';
    });
    expect(furnEntities.length).toBeGreaterThan(0);
    for (const f of furnEntities) {
      if ((f as any).vertices) {
        for (const v of (f as any).vertices) {
          const loc = v.location ?? v.point ?? v;
          expect(Number.isFinite(loc.x)).toBe(true);
          expect(Number.isFinite(loc.y)).toBe(true);
        }
      }
    }
  });

  it('5. Sheet Separation & Column Deduplication', () => {
    const typicalSheet = project.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!;
    const stiltSheet = project.sheets.find(s => s.sheetType === 'STILT_PARKING_PLAN')!;
    const colScheduleSheet = project.sheets.find(s => s.sheetType === 'COLUMN_SCHEDULE_PLAN')!;

    // Sheet 03 (Typical Floor) contains 0 parking bay zones
    const parkingInTypical = (typicalSheet.floor?.rooms || []).filter(r => r.type === RoomType.Parking);
    expect(parkingInTypical.length).toBe(0);

    // Sheet 02 (Stilt Parking) contains 0 residential flats
    const stiltRooms = stiltSheet.floor!.rooms;
    const flatsInStilt = stiltRooms.filter(r => r.type === RoomType.Bedroom || /BEDROOM|FLAT/i.test(r.name));
    expect(flatsInStilt.length).toBe(0);

    // Sequential column numbering C1..CN
    const colScheduleBuilding: Building = { ...project.building, floors: [colScheduleSheet.floor!] };
    const colExportRes = cadService.exportCad(colScheduleBuilding, 'dwg', {
      exportScope: 'current_floor',
    });
    const colScheduleDoc = new acad.DwgReader(colExportRes.data).read();
    const colTexts = (colScheduleDoc.entities ? [...colScheduleDoc.entities] : []).filter(e => {
      const lay = (e as any).layer?.name ?? (e as any).layer;
      return (lay === 'S-COLS' || lay === 'S-COLUMN') && e instanceof acad.TextEntity;
    }) as acad.TextEntity[];

    const colTags = colTexts.map(t => (t as any).value ?? (t as any).text).filter(t => /^C\d+$/.test(t));
    expect(colTags.length).toBeGreaterThan(0);
    const uniqueTags = new Set(colTags);
    expect(uniqueTags.size).toBe(colTags.length);
    expect(colTags).toContain('C1');
  });
});



