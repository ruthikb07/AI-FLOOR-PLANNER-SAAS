import {
  Direction,
  RoomType,
  WallType,
  architecturalBoundaryRole,
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  rectToPolygon,
  type Room,
} from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { describe, expect, it } from 'vitest';
import { projectBuildingTo3D } from '../project-building';

describe('Gate 3 — Built Slab Union & Zero Gap-Bridging Wall Artifacts', () => {
  it('carves perimeter recesses and open-ended OTS voids out of floor plate boundary and excludes void-only bridge walls', () => {
    const base = createBuilding({
      projectId: 'gate3-slab-test',
      name: 'Gate 3 Slab Union',
      site: { plotWidth: 30000, plotDepth: 30000, roadFacing: Direction.South },
      floors: [{ buildingId: '', level: 1, name: '1ST_FLOOR_PLAN' }],
    });
    const floorBase = createFloor({
      buildingId: base.id,
      level: 1,
      name: '1ST_FLOOR_PLAN',
      boundary: rectToPolygon(0, 0, 20000, 12000),
    });
    const fid = floorBase.id;

    // Two residential wings separated on the West by an open-ended 2m OTS notch + a central lobby + an interior shaft
    const flatNorth: Room = {
      ...createRoom({ floorId: fid, type: RoomType.Living, name: 'Flat 101 Living', x: 0, y: 0, width: 12000, height: 5000 }),
      unitId: 'flat_01',
      architecturalRole: 'ENCLOSED_HABITABLE',
      spaceUse: 'UNIT',
    };
    const flatSouth: Room = {
      ...createRoom({ floorId: fid, type: RoomType.Living, name: 'Flat 103 Living', x: 0, y: 7000, width: 12000, height: 5000 }),
      unitId: 'flat_03',
      architecturalRole: 'ENCLOSED_HABITABLE',
      spaceUse: 'UNIT',
    };
    const centralLobby: Room = {
      ...createRoom({ floorId: fid, type: RoomType.Corridor, name: 'Central Lobby', x: 12000, y: 0, width: 8000, height: 12000 }),
      architecturalRole: 'LIFT_LOBBY',
      spaceUse: 'COMMON',
    };
    const otsNotch: Room = {
      ...createRoom({ floorId: fid, type: RoomType.OTS, name: 'Inter-Flat OTS Duct', x: 0, y: 5000, width: 12000, height: 2000 }),
      architecturalRole: 'OPEN_TO_SKY_VOID',
      spaceUse: 'VOID',
      openToSky: true,
    };
    const mepShaft: Room = {
      ...createRoom({ floorId: fid, type: RoomType.ServiceShaft, name: 'MEP Shaft', x: 15000, y: 4500, width: 1200, height: 1800 }),
      architecturalRole: 'SERVICE_SHAFT',
      spaceUse: 'SERVICE',
    };

    // Void-only outer edge bridging across the West mouth of the OTS notch
    const otsBridgeWall = createWall({
      floorId: fid,
      startPoint: { x: 0, y: 5000 },
      endPoint: { x: 0, y: 7000 },
      thickness: 230,
      type: WallType.External,
      roomIds: [otsNotch.id],
    });
    const realFacadeWall = createWall({
      floorId: fid,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 12000, y: 0 },
      thickness: 230,
      type: WallType.External,
      roomIds: [flatNorth.id],
    });

    // Architectural semantics rule must classify void-only edges as OPEN_BOUNDARY
    expect(architecturalBoundaryRole([otsNotch], true)).toBe('OPEN_BOUNDARY');
    // Balcony-to-OTS parapet edge still remains PARAPET
    const balcony: Room = {
      ...createRoom({ floorId: fid, type: RoomType.Balcony, name: 'Balcony', x: 0, y: 3500, width: 3000, height: 1500 }),
      unitId: 'flat_01',
      architecturalRole: 'BALCONY_SLAB',
      spaceUse: 'OUTDOOR',
    };
    expect(architecturalBoundaryRole([balcony, otsNotch], false)).toBe('PARAPET');

    const building = {
      ...base,
      floors: [
        {
          ...floorBase,
          rooms: [flatNorth, flatSouth, centralLobby, otsNotch, mepShaft],
          walls: [otsBridgeWall, realFacadeWall],
        },
      ],
    };

    const projection = projectBuildingTo3D(building);
    const plate = projection.floorPlates[0]!;

    // Full envelope was 20m x 12m = 240 m²; OTS notch is 12m x 2m = 24 m² -> Built slab MUST be 216 m²!
    const builtAreaM2 = polygonArea(plate.boundary) / 1_000_000;
    expect(builtAreaM2).toBeCloseTo(216, 1);

    // Strictly-interior MEP shaft cutout is preserved, while boundary-carved OTS notch is NOT duplicated as a hole
    expect(plate.cutouts).toHaveLength(1);
    expect(polygonArea(plate.cutouts[0]!) / 1_000_000).toBeCloseTo(2.16, 1);

    // Zero void-only gap-connecting wall bridges in 3D projection
    expect(projection.walls.some(w => w.sourceEntityId === otsBridgeWall.id)).toBe(false);
    expect(projection.walls.some(w => w.sourceEntityId === realFacadeWall.id)).toBe(true);
  });
});
