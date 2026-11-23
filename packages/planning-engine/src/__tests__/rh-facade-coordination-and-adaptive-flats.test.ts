import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  DoorType,
  RoomType,
  WindowType,
  architecturalSpaceRole,
  type IrregularPlotBoundary,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  measureApartmentAreaLedger,
  openingFitsApartmentWall,
  polygonArea,
  polygonBoundingBox,
} from '@ai-floor-planner/geometry-engine';
import {
  FACADE_LINTEL_DATUM_MM,
  computeIrregularPlotInscribedEnvelope,
  evaluateArchitecturalComplianceScore,
  scoreFlatExteriorEdges,
  solveMultiSheetApartmentProject,
  synthesizeCoordinatedChajjaBands,
} from '../index';

function make4x2BhkConfig(
  overrides: Partial<MultiSheetApartmentConfig> = {},
): MultiSheetApartmentConfig {
  return {
    projectId: 'rh-facade-coord-test',
    projectName: 'RH Architectural Coordination & Adaptive Flats Tower',
    plotWidthMm: 42_000,
    plotDepthMm: 34_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3500 },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 4,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    includeWindowChajjas: true,
    ...overrides,
  };
}

function makeIrregularAngledPlot(): IrregularPlotBoundary {
  const polygon = {
    points: [
      { x: 0, y: 0 },
      { x: 44_000, y: 1800 },
      { x: 41_200, y: 35_400 },
      { x: 1400, y: 33_800 },
    ],
  };
  const edgeSetbacksMm = [3000, 3500, 4500, 3000];
  const inscribed = computeIrregularPlotInscribedEnvelope(polygon, edgeSetbacksMm);
  const edgeLengthsMm = polygon.points.map((p, i) => {
    const q = polygon.points[(i + 1) % polygon.points.length]!;
    return Math.round(Math.hypot(q.x - p.x, q.y - p.y));
  });
  return {
    polygon,
    areaMm2: polygonArea(polygon),
    perimeterMm: edgeLengthsMm.reduce((s, l) => s + l, 0),
    roadEdgeIndex: 2,
    edgeSetbacksMm,
    edgeLengthsMm,
    buildablePolygon: inscribed.buildablePolygon,
    inscribedEnvelopeMm: inscribed.inscribedEnvelope,
    sourceFormat: 'survey',
  };
}

describe('RH Planner — Exposure-Driven Per-Flat Orientation & Cross-Floor Facade Coordination', () => {
  it('1. scoreFlatExteriorEdges ranks Tier 1 Road/Corner > Tier 2 Setback > Tier 3 OTS Duct > Tier 4 Corridor/Party Wall', () => {
    const envelope = { x: 3000, y: 3000, w: 35_500, h: 26_500 };
    const swRoadFlat = { x: 3000, y: 17_000, w: 14_500, h: 12_500 };
    const otsBox = { x: 3000, y: 15_400, w: 14_500, h: 1600 };

    const profile = scoreFlatExteriorEdges(swRoadFlat, {
      flatId: 'flat_03',
      envelope,
      accessEdge: 'EAST',
      otsShaftBoxes: [otsBox],
      roadAccessSides: [Direction.South],
      setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3500 },
    });

    const byEdge = new Map(profile.edgeScores.map(e => [e.edge, e]));
    expect(byEdge.get('SOUTH')!.tier).toBe(1);
    expect(byEdge.get('SOUTH')!.classification).toBe('ROAD_FRONTAGE');
    expect(byEdge.get('WEST')!.tier).toBeLessThanOrEqual(2);
    expect(byEdge.get('NORTH')!.tier).toBe(3);
    expect(byEdge.get('NORTH')!.classification).toBe('INTERFLAT_OTS_DUCT');
    expect(byEdge.get('EAST')!.tier).toBe(4);
    expect(byEdge.get('EAST')!.classification).toBe('CORRIDOR_ENTRY');
    expect(byEdge.get('SOUTH')!.score).toBeGreaterThan(byEdge.get('WEST')!.score);
    expect(byEdge.get('WEST')!.score).toBeGreaterThan(byEdge.get('NORTH')!.score);
    expect(byEdge.get('NORTH')!.score).toBeGreaterThan(byEdge.get('EAST')!.score);
    expect(profile.orientationMode).toBe('CORNER_L_WRAP');
  });

  it('2. 4x 2BHK standard plot anchors 100% of Living Rooms on Tier 1/2 exterior perimeter with adaptive per-flat orientations and full vertical coordination', () => {
    const res = solveMultiSheetApartmentProject(
      make4x2BhkConfig({ galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER' }),
    );
    const { building, schedule } = res;
    expect(schedule.overallDeltaMm2).toBe(0);

    const compliance = evaluateArchitecturalComplianceScore(building);
    expect(compliance.score).toBeGreaterThanOrEqual(85);
    expect(compliance.redConflictCount).toBe(0);

    const coord = building.metadata.facadeCoordination;
    expect(coord).toBeDefined();
    expect(coord!.galleryCoordinationMode).toBe('DOUBLE_HEIGHT_STAGGER');
    expect(coord!.lintelDatumMm).toBe(FACADE_LINTEL_DATUM_MM);
    expect(coord!.coreAlignmentDriftMaxMm).toBeLessThanOrEqual(5);
    expect(coord!.verticalJambDriftMaxMm).toBeLessThanOrEqual(50);

    // Per-flat exposure profiles must adapt independently (not blind identical copies across quadrants)
    expect(coord!.flatExposures.length).toBe(4);
    const distinctModes = new Set(coord!.flatExposures.map(f => f.orientationMode));
    const distinctBaySides = new Set(coord!.flatExposures.map(f => f.livingBaySide));
    expect(distinctModes.size).toBeGreaterThanOrEqual(2);
    expect(distinctBaySides.size).toBeGreaterThanOrEqual(2);
    expect(coord!.flatExposures.every(f => f.livingExposureTier <= 2)).toBe(true);

    const resFloors = building.floors.filter(f => f.floorUse === 'RESIDENTIAL');
    expect(resFloors.length).toBe(4);

    // 100% of Living Rooms on every floor sit directly on an exterior perimeter wall with direct window/gallery daylight
    for (const fl of resFloors) {
      expect(Math.abs(measureApartmentAreaLedger(fl).delta)).toBeLessThan(0.001);
      const fBox = polygonBoundingBox(fl.boundary);
      const livings = fl.rooms.filter(r => r.type === RoomType.Living && r.unitId);
      expect(livings.length).toBeGreaterThanOrEqual(4);

      for (const liv of livings) {
        const lBox = polygonBoundingBox(liv.boundary);
        const onOuterEdge =
          Math.abs(lBox.x - fBox.x) <= 25 ||
          Math.abs(lBox.x + lBox.width - (fBox.x + fBox.width)) <= 25 ||
          Math.abs(lBox.y - fBox.y) <= 25 ||
          Math.abs(lBox.y + lBox.height - (fBox.y + fBox.height)) <= 25;
        const hasExteriorWall = fl.walls.some(
          w => w.roomIds.includes(liv.id) && w.wallUse === 'EXTERNAL',
        );
        expect(onOuterEdge || hasExteriorWall, `${liv.name} on ${fl.name} must sit on Tier 1/2 exterior perimeter`).toBe(true);

        const hasDirectWindow = fl.windows.some(w => w.roomId === liv.id);
        const hasDirectGallery = fl.doors.some(
          d => d.connectsRooms.includes(liv.id) &&
            d.connectsRooms.some(id => fl.rooms.find(r => r.id === id)?.type === RoomType.Balcony),
        );
        expect(hasDirectWindow || hasDirectGallery, `${liv.name} must have direct exterior window or gallery`).toBe(true);
      }

      // Unified 2,100 mm lintel datum & strict >= 100 mm nib clamping on every opening (zero INVALID_OPENING_INTERVAL)
      const roomById = new Map(fl.rooms.map(r => [r.id, r]));
      const wallById = new Map(fl.walls.map(w => [w.id, w]));
      for (const win of fl.windows) {
        const wall = wallById.get(win.wallId);
        expect(wall, `Missing host wall for ${win.id}`).toBeDefined();
        expect(openingFitsApartmentWall(wall!, win.position, win.width), `INVALID_OPENING_INTERVAL on ${win.id}`).toBe(true);
        expect(win.sillHeight + win.height).toBe(2100);
        const rm = roomById.get(win.roomId);
        if (rm?.type === RoomType.Kitchen) expect(win.sillHeight).toBe(1100);
        else if (rm?.type === RoomType.Bathroom) expect(win.sillHeight).toBe(1500);
        else expect(win.sillHeight).toBe(900);
      }
      for (const door of fl.doors) {
        const wall = wallById.get(door.wallId);
        expect(wall, `Missing host wall for ${door.id}`).toBeDefined();
        expect(openingFitsApartmentWall(wall!, door.position, door.width), `INVALID_OPENING_INTERVAL on ${door.id}`).toBe(true);
        const connectsBalc = door.connectsRooms.some(id => roomById.get(id)?.type === RoomType.Balcony);
        if (door.type === DoorType.Sliding && connectsBalc) {
          expect(door.height).toBe(2100);
          expect(door.sillHeightMm ?? 0).toBe(0);
        }
      }
    }

    // Cross-floor lock: columns, lifts, stairs & OTS ducts stay identical (<= 5 mm drift) across L1..L4
    const f1 = resFloors[0]!;
    const f2 = resFloors[1]!;
    const colSig = (fl: typeof f1) =>
      fl.columns.map(c => `${Math.round(c.position.x)},${Math.round(c.position.y)}`).sort().join('|');
    const coreSig = (fl: typeof f1) =>
      fl.rooms
        .filter(r => r.type === RoomType.Lift || r.type === RoomType.Staircase || architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID')
        .map(r => `${r.type}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
        .sort()
        .join('|');
    for (const fl of resFloors.slice(1)) {
      expect(colSig(fl)).toBe(colSig(f1));
      expect(coreSig(fl)).toBe(coreSig(f1));
    }

    // Continuous 600 mm chajja bands & OTS louver screens synthesized cleanly
    expect(coord!.chajjaBands.length).toBeGreaterThan(0);
    expect(coord!.chajjaBands.every(b => b.projectionMm === 600 && b.lintelHeightMm === 2100 && b.fasciaThicknessMm === 100)).toBe(true);
    expect(coord!.otsLouverScreens.length).toBeGreaterThan(0);

    // DOUBLE_HEIGHT_STAGGER alternates Odd vs Even gallery bays and flags double-height sky decks
    const balcSig = (fl: typeof f1) =>
      fl.rooms
        .filter(r => r.type === RoomType.Balcony)
        .map(r => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
        .sort()
        .join('|');
    expect(balcSig(f1)).not.toBe(balcSig(f2));
    expect(coord!.galleryBays.some(g => g.doubleHeightRoomIds.length > 0)).toBe(true);
  });

  it('3. STACKED_RIBBON gallery mode aligns balconies identically vertically across all residential storeys', () => {
    const res = solveMultiSheetApartmentProject(
      make4x2BhkConfig({ galleryCoordinationMode: 'STACKED_RIBBON', staggeredBalconies: false }),
    );
    expect(res.schedule.overallDeltaMm2).toBe(0);
    const coord = res.building.metadata.facadeCoordination!;
    expect(coord.galleryCoordinationMode).toBe('STACKED_RIBBON');
    expect(coord.galleryBays.every(g => g.doubleHeightRoomIds.length === 0)).toBe(true);

    const resFloors = res.building.floors.filter(f => f.floorUse === 'RESIDENTIAL');
    const balcSig = (fl: (typeof resFloors)[number]) =>
      fl.rooms
        .filter(r => r.type === RoomType.Balcony)
        .map(r => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
        .sort()
        .join('|');
    for (const fl of resFloors.slice(1)) {
      expect(balcSig(fl)).toBe(balcSig(resFloors[0]!));
    }
  });

  it('4. 4x 2BHK on irregular angled quadrilateral plot maintains 100% perimeter Living, angled exposure adaptation, vertical coordination, 0.000 delta & >= 85 compliance', () => {
    const irregularPlotBoundary = makeIrregularAngledPlot();
    const res = solveMultiSheetApartmentProject(
      make4x2BhkConfig({
        projectId: 'rh-irregular-coord-test',
        projectName: 'Irregular Angled Plot Coordinated Tower',
        plotWidthMm: 44_000,
        plotDepthMm: 35_400,
        irregularPlotBoundary,
        galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER',
      }),
    );

    expect(res.schedule.overallDeltaMm2).toBe(0);
    const compliance = evaluateArchitecturalComplianceScore(res.building);
    expect(compliance.score).toBeGreaterThanOrEqual(85);
    expect(compliance.redConflictCount).toBe(0);

    const coord = res.building.metadata.facadeCoordination!;
    expect(coord).toBeDefined();
    expect(coord.flatExposures.length).toBe(4);
    expect(coord.flatExposures.some(f => f.orientationMode === 'ANGLED_PERIMETER_FIT')).toBe(true);
    expect(coord.flatExposures.every(f => f.livingExposureTier <= 2)).toBe(true);
    expect(coord.coreAlignmentDriftMaxMm).toBeLessThanOrEqual(5);
    expect(coord.verticalJambDriftMaxMm).toBeLessThanOrEqual(50);
    expect(coord.chajjaBands.length).toBeGreaterThan(0);

    const resFloors = res.building.floors.filter(f => f.floorUse === 'RESIDENTIAL');
    for (const fl of resFloors) {
      const fBox = polygonBoundingBox(fl.boundary);
      const livings = fl.rooms.filter(r => r.type === RoomType.Living && r.unitId);
      expect(livings.length).toBeGreaterThanOrEqual(4);
      for (const liv of livings) {
        const lBox = polygonBoundingBox(liv.boundary);
        const onOuter =
          Math.abs(lBox.x - fBox.x) <= 25 ||
          Math.abs(lBox.x + lBox.width - (fBox.x + fBox.width)) <= 25 ||
          Math.abs(lBox.y - fBox.y) <= 25 ||
          Math.abs(lBox.y + lBox.height - (fBox.y + fBox.height)) <= 25;
        const hasExt = fl.walls.some(w => w.roomIds.includes(liv.id) && w.wallUse === 'EXTERNAL');
        expect(onOuter || hasExt).toBe(true);
      }
      for (const win of fl.windows) {
        expect(win.sillHeight + win.height).toBe(2100);
      }
    }
  });

  it('5. synthesizeCoordinatedChajjaBands merges adjacent exterior windows within 1,500 mm into one continuous 600 mm band with 100 mm fascia', () => {
    const res = solveMultiSheetApartmentProject(make4x2BhkConfig());
    const f1 = res.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    const extWall = f1.walls.find(w => w.wallUse === 'EXTERNAL' && Math.hypot(w.endPoint.x - w.startPoint.x, w.endPoint.y - w.startPoint.y) >= 4500)!;
    expect(extWall).toBeDefined();

    const len = Math.hypot(extWall.endPoint.x - extWall.startPoint.x, extWall.endPoint.y - extWall.startPoint.y);
    const ux = (extWall.endPoint.x - extWall.startPoint.x) / len;
    const uy = (extWall.endPoint.y - extWall.startPoint.y) / len;
    const p1 = { x: extWall.startPoint.x + ux * 900, y: extWall.startPoint.y + uy * 900 };
    const p2 = { x: extWall.startPoint.x + ux * 2800, y: extWall.startPoint.y + uy * 2800 }; // gap = 2800 - 600 - (900 + 600) = 700 mm <= 1500 mm

    const syntheticFloor = {
      ...f1,
      windows: [
        { id: 'w_close_1', floorId: f1.id, wallId: extWall.id, position: p1, width: 1200, height: 1200, sillHeight: 900, type: WindowType.Sliding, roomId: extWall.roomIds[0]! },
        { id: 'w_close_2', floorId: f1.id, wallId: extWall.id, position: p2, width: 1200, height: 1200, sillHeight: 900, type: WindowType.Sliding, roomId: extWall.roomIds[0]! },
      ],
    };
    const bands = synthesizeCoordinatedChajjaBands([syntheticFloor]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.mergedWindowCount).toBe(2);
    expect(bands[0]!.windowIds).toEqual(['w_close_1', 'w_close_2']);
    expect(bands[0]!.projectionMm).toBe(600);
    expect(bands[0]!.lintelHeightMm).toBe(2100);
    expect(bands[0]!.fasciaThicknessMm).toBe(100);
  });
});
