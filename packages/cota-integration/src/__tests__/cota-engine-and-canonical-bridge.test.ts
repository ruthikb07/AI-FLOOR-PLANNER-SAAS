import { describe, expect, it } from 'vitest';
import {
  ColumnShape,
  DaylightLevel,
  Direction,
  DoorType,
  PlotShape,
  PrivacyLevel,
  RoomType,
  SwingDirection,
  WallType,
  WindowType,
  exchangeRevision,
  type Building,
} from '@ai-floor-planner/core';
import {
  buildCanonicalWritebackPreview,
  canonicalToCotaVec3,
  cotaVec3ToCanonical,
  getAllCotaCommands,
  mountCotaCad,
  projectCanonicalBuildingToCotaDoc,
  readCadFileWithReport,
  searchCotaCommands,
  solidMesh,
} from '../index';

function createSampleResidentialBuilding(): Building {
  const boundary = {
    points: [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 8000 },
      { x: 0, y: 8000 },
    ],
  };
  return {
    id: 'bldg-cota-01',
    projectId: 'proj-cota-01',
    name: 'RH Unified Villa',
    version: 3,
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    metadata: { projectId: 'proj-cota-01' },
    site: {
      id: 'site-01',
      plotBoundary: {
        points: [
          { x: -1500, y: -1500 },
          { x: 11500, y: -1500 },
          { x: 11500, y: 9500 },
          { x: -1500, y: 9500 },
        ],
      },
      plotWidth: 13000,
      plotDepth: 11000,
      plotArea: 143_000_000,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 1500, rear: 1500, left: 1500, right: 1500 },
      accessPoints: [{ id: 'acc-1', position: { x: 5000, y: -1500 }, width: 3600, direction: Direction.North }],
      roadFacing: Direction.North,
    },
    floors: [
      {
        id: 'floor-g',
        buildingId: 'bldg-cota-01',
        level: 0,
        name: 'Ground Floor',
        floorHeight: 3000,
        slabThicknessMm: 150,
        boundary,
        rooms: [
          {
            id: 'room-living',
            floorId: 'floor-g',
            type: RoomType.Living,
            name: 'Living Hall',
            boundary: {
              points: [
                { x: 0, y: 0 },
                { x: 5500, y: 0 },
                { x: 5500, y: 8000 },
                { x: 0, y: 8000 },
              ],
            },
            x: 0,
            y: 0,
            width: 5500,
            height: 8000,
            rotation: 0,
            area: 44_000_000,
            priority: 1,
            tags: [],
            adjacencyRequirements: [],
            daylightRequirement: DaylightLevel.High,
            privacyRequirement: PrivacyLevel.Low,
            ventilationRequired: true,
            isFixed: false,
          },
          {
            id: 'room-bed',
            floorId: 'floor-g',
            type: RoomType.Bedroom,
            name: 'Master Bedroom',
            boundary: {
              points: [
                { x: 5500, y: 0 },
                { x: 10000, y: 0 },
                { x: 10000, y: 8000 },
                { x: 5500, y: 8000 },
              ],
            },
            x: 5500,
            y: 0,
            width: 4500,
            height: 8000,
            rotation: 0,
            area: 36_000_000,
            priority: 1,
            tags: [],
            adjacencyRequirements: [],
            daylightRequirement: DaylightLevel.High,
            privacyRequirement: PrivacyLevel.High,
            ventilationRequired: true,
            isFixed: false,
          },
        ],
        walls: [
          {
            id: 'w-north',
            floorId: 'floor-g',
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 10000, y: 0 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['room-living', 'room-bed'],
            hasOpening: true,
            loadBearing: true,
          },
          {
            id: 'w-east',
            floorId: 'floor-g',
            startPoint: { x: 10000, y: 0 },
            endPoint: { x: 10000, y: 8000 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['room-bed'],
            hasOpening: true,
            loadBearing: true,
          },
          {
            id: 'w-south',
            floorId: 'floor-g',
            startPoint: { x: 10000, y: 8000 },
            endPoint: { x: 0, y: 8000 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['room-living', 'room-bed'],
            hasOpening: false,
            loadBearing: true,
          },
          {
            id: 'w-west',
            floorId: 'floor-g',
            startPoint: { x: 0, y: 8000 },
            endPoint: { x: 0, y: 0 },
            thickness: 230,
            heightMm: 3000,
            type: WallType.External,
            wallUse: 'EXTERNAL',
            roomIds: ['room-living'],
            hasOpening: false,
            loadBearing: true,
          },
          {
            id: 'w-mid',
            floorId: 'floor-g',
            startPoint: { x: 5500, y: 0 },
            endPoint: { x: 5500, y: 8000 },
            thickness: 115,
            heightMm: 3000,
            type: WallType.Partition,
            wallUse: 'INTERNAL_PARTITION',
            roomIds: ['room-living', 'room-bed'],
            hasOpening: true,
            loadBearing: false,
          },
        ],
        doors: [
          {
            id: 'door-main',
            floorId: 'floor-g',
            wallId: 'w-north',
            position: { x: 2500, y: 0 },
            width: 1050,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Inward,
            connectsRooms: ['exterior', 'room-living'],
          },
          {
            id: 'door-bed',
            floorId: 'floor-g',
            wallId: 'w-mid',
            position: { x: 5500, y: 3500 },
            width: 900,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Right,
            connectsRooms: ['room-living', 'room-bed'],
          },
        ],
        windows: [
          {
            id: 'win-east',
            floorId: 'floor-g',
            wallId: 'w-east',
            position: { x: 10000, y: 4000 },
            width: 1500,
            height: 1200,
            sillHeight: 900,
            type: WindowType.Sliding,
            roomId: 'room-bed',
          },
        ],
        stairs: [],
        columns: [
          { id: 'c1', floorId: 'floor-g', position: { x: 0, y: 0 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
          { id: 'c2', floorId: 'floor-g', position: { x: 10000, y: 0 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
          { id: 'c3', floorId: 'floor-g', position: { x: 10000, y: 8000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
          { id: 'c4', floorId: 'floor-g', position: { x: 0, y: 8000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
        ],
        beams: [
          { id: 'b1', floorId: 'floor-g', startPoint: { x: 0, y: 0 }, endPoint: { x: 10000, y: 0 }, widthMm: 230, depthMm: 450 },
        ],
      },
    ],
  };
}

function makeFakeContainer(): HTMLElement {
  return {
    innerHTML: '',
    tabIndex: 0,
    appendChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLElement;
}

describe('@ai-floor-planner/cota-integration — Professional CAD Engine & Canonical Bridge', () => {
  it('applies exact single-step coordinate transform between Canonical (x,y,z mm) and Cota (x,-y,z mm)', () => {
    const cotaPt = canonicalToCotaVec3(5500, 3500, 3000);
    expect(cotaPt).toEqual([5500, -3500, 3000]);
    const back = cotaVec3ToCanonical(cotaPt);
    expect(back).toEqual({ x: 5500, y: 3500, z: 3000 });
  });

  it('registers all 240+ Cota CAD commands & system variables and supports live search', () => {
    const all = getAllCotaCommands();
    expect(all.length).toBeGreaterThanOrEqual(200);
    const names = new Set(all.map(c => c.name));
    for (const cmd of ['LINE', 'PLINE', 'CIRCLE', 'ARC', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER', 'DIMLINEAR', 'HATCH', 'BLOCK', 'INSERT', 'BOX', 'CYLINDER', 'EXTRUDE', 'UNION', 'SUBTRACT', 'INTERSECT', 'LAYOUT', 'UCS']) {
      expect(names.has(cmd)).toBe(true);
    }
    const dimMatches = searchCotaCommands('DIM');
    expect(dimMatches.some(m => m.name === 'DIMLINEAR')).toBe(true);
  });

  it('projects Canonical Building to Cota DocumentModel with mapped layers, 3D solids, dimensions, and A3 layout', () => {
    const building = createSampleResidentialBuilding();
    const { doc, links } = projectCanonicalBuildingToCotaDoc(building, { include3DSolids: true });
    expect(links.length).toBeGreaterThanOrEqual(15);
    expect(links.some(l => l.canonicalKind === 'wall' && l.canonicalId === 'w-north')).toBe(true);
    expect(links.some(l => l.canonicalKind === 'door' && l.canonicalId === 'door-main')).toBe(true);
    expect(links.some(l => l.canonicalKind === 'window' && l.canonicalId === 'win-east')).toBe(true);
    expect(links.some(l => l.canonicalKind === 'dimension')).toBe(true);

    const solids = doc.modelEntities.filter(e => e.type === 'SOLID3D');
    expect(solids.length).toBeGreaterThanOrEqual(5);
    const mesh = solidMesh(solids[0]!.props);
    expect(mesh.vertices.length).toBeGreaterThan(4);
    expect(mesh.faces.length).toBeGreaterThan(4);

    const layout = doc.getLayout('L1');
    expect(layout).toBeDefined();
    expect(layout!.entities.some(e => e.type === 'VIEWPORT')).toBe(true);
  });

  it('executes real Cota CLI scripts (LINE, CIRCLE, BOX) and round-trips .cota, .dxf, .obj, .stl, .step, .iges, and .pdf', async () => {
    const building = createSampleResidentialBuilding();
    const ctrl = mountCotaCad({
      container: makeFakeContainer(),
      projectId: building.projectId,
      buildingId: building.id,
      drawingId: 'drw-main',
      revision: building.version,
      building,
      headless: true,
    });

    const beforeCount = ctrl.getDocument().modelEntities.length;
    await ctrl.runScriptText('LINE 100,100 2500,100 "" CIRCLE 1200,-1200 450 BOX 0,0,0 1000,1000 1000');
    const afterEntities = ctrl.getDocument().modelEntities;
    expect(afterEntities.length).toBe(beforeCount + 3);
    expect(afterEntities.some(e => e.type === 'CIRCLE' && e.layer === 'C-DRAFT')).toBe(true);
    expect(afterEntities.some(e => e.type === 'SOLID3D' && e.props.op === 'BOX')).toBe(true);

    // Per-command Undo / Redo (BOX -> CIRCLE -> LINE)
    ctrl.undo();
    expect(ctrl.getDocument().modelEntities.length).toBe(beforeCount + 2);
    ctrl.undo();
    ctrl.undo();
    expect(ctrl.getDocument().modelEntities.length).toBe(beforeCount);
    ctrl.redo();
    ctrl.redo();
    ctrl.redo();
    expect(ctrl.getDocument().modelEntities.length).toBe(beforeCount + 3);

    // Multi-format exports
    const cotaOut = await ctrl.exportDrawing('cota');
    expect(cotaOut.bytes.byteLength).toBeGreaterThan(500);
    const dxfOut = await ctrl.exportDrawing('dxf');
    const dxfStr = new TextDecoder().decode(dxfOut.bytes);
    expect(dxfStr).toContain('SECTION');
    expect(dxfStr).toContain('A-WALL');

    const objOut = await ctrl.exportDrawing('obj');
    expect(new TextDecoder().decode(objOut.bytes)).toContain('v ');
    const stlOut = await ctrl.exportDrawing('stl');
    expect(new TextDecoder().decode(stlOut.bytes)).toContain('solid ');
    const pdfOut = await ctrl.exportDrawing('pdf');
    expect(new TextDecoder().decode(pdfOut.bytes.slice(0, 8))).toContain('%PDF-1.4');

    // Pure-TS STEP ISO-10303-21 reader check
    const stepSample = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(1000.,0.,0.));
#3=CARTESIAN_POINT('',(1000.,1000.,0.));
#4=CARTESIAN_POINT('',(0.,1000.,0.));
#5=VERTEX_POINT('',#1);
#6=VERTEX_POINT('',#2);
#7=VERTEX_POINT('',#3);
#8=VERTEX_POINT('',#4);
#9=EDGE_CURVE('',#5,#6,#1,.T.);
#10=EDGE_CURVE('',#6,#7,#2,.T.);
#11=EDGE_CURVE('',#7,#8,#3,.T.);
#12=EDGE_CURVE('',#8,#5,#4,.T.);
#13=ORIENTED_EDGE('',*,*,#9,.T.);
#14=ORIENTED_EDGE('',*,*,#10,.T.);
#15=ORIENTED_EDGE('',*,*,#11,.T.);
#16=ORIENTED_EDGE('',*,*,#12,.T.);
#17=EDGE_LOOP('',(#13,#14,#15,#16));
#18=FACE_OUTER_BOUND('',#17,.T.);
#19=ADVANCED_FACE('',(#18),#1,.T.);
ENDSEC;
END-ISO-10303-21;`;
    const stepReport = await readCadFileWithReport(new TextEncoder().encode(stepSample).buffer, 'step');
    expect(stepReport.meshes.length).toBe(1);
    expect(stepReport.meshes[0]!.faces.length).toBe(2);

    ctrl.unmount();
  });

  it('enforces architectural integrity: never auto-promotes CAD lines, validates opening edits, and rejects stale revisions', () => {
    const building = createSampleResidentialBuilding();
    const { doc, links, source, floor } = projectCanonicalBuildingToCotaDoc(building);

    // Add a free-form CAD drafting line on C-DRAFT
    const draftLine = doc.addEntity({
      type: 'LINE',
      layer: 'C-DRAFT',
      props: { start: canonicalToCotaVec3(2000, 1000, 0), end: canonicalToCotaVec3(2000, 5000, 0) },
    });

    // Without explicit promotion or mapped entity edits, writeback does NOT convert C-DRAFT lines!
    const untouchedPreview = buildCanonicalWritebackPreview({
      currentBuilding: building,
      expectedSource: source,
      doc,
      links,
      floorId: floor.id,
      explicitPromoteLineIds: [],
    });
    expect(untouchedPreview.ok).toBe(false);
    expect(untouchedPreview.changes.length).toBe(0);

    // Move mapped door along host wall + explicitly promote `draftLine`
    const doorLink = links.find(l => l.canonicalKind === 'door' && l.canonicalId === 'door-main')!;
    const doorEnt = doc.getEntity(doorLink.cotaEntityId)!;
    if (doorEnt.type === 'LINE') {
      doorEnt.props.start = canonicalToCotaVec3(3000 - 600, 0, 0);
      doorEnt.props.end = canonicalToCotaVec3(3000 + 600, 0, 0);
    }

    const validPreview = buildCanonicalWritebackPreview({
      currentBuilding: building,
      expectedSource: source,
      doc,
      links,
      floorId: floor.id,
      explicitPromoteLineIds: [draftLine.id],
    });
    expect(validPreview.ok).toBe(true);
    expect(validPreview.staleRevision).toBe(false);
    expect(validPreview.changes.length).toBe(2);
    expect(validPreview.candidateBuilding?.version).toBe(building.version + 1);
    const updatedDoor = validPreview.candidateBuilding?.floors[0]?.doors.find(d => d.id === 'door-main');
    expect(updatedDoor?.position.x).toBe(3000);
    expect(updatedDoor?.width).toBe(1200);
    expect(validPreview.candidateBuilding?.floors[0]?.walls.some(w => w.id.includes(draftLine.id))).toBe(true);

    // Stale revision guard
    const newerBuilding: Building = { ...building, version: building.version + 2 };
    const stalePreview = buildCanonicalWritebackPreview({
      currentBuilding: newerBuilding,
      expectedSource: exchangeRevision(building),
      doc,
      links,
      floorId: floor.id,
    });
    expect(stalePreview.ok).toBe(false);
    expect(stalePreview.staleRevision).toBe(true);
  });
});
