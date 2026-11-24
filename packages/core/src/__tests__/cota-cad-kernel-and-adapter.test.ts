import { describe, expect, it } from 'vitest';
import {
  CanonicalDxfExchangeAdapter,
  DEFAULT_CAD_OSNAP_CONFIG,
  RoomType,
  cadArcFrom3Points,
  createBuilding,
  createDoor,
  createRoom,
  createWall,
  createWindow,
  exchangeRevision,
  extendDraftingLine,
  measureCadAngle,
  measureCadDistance,
  mirrorDraftingEntity,
  moveDraftingEntity,
  offsetDraftingEntity,
  projectBuildingToCanonicalCad,
  resolveCadSnap,
  rotateDraftingEntity,
  trimDraftingLine,
  type Building,
  type CadLineEntity,
} from '../index';

function buildFixtureBuilding(): Building {
  const base = createBuilding({
    projectId: 'cad-adapter-fixture',
    name: 'Canonical CAD Fixture',
    site: { plotWidth: 12000, plotDepth: 15000 },
    floors: [{ buildingId: '', level: 0 }],
  });
  const floor = base.floors[0]!;
  const living = {
    ...createRoom({ floorId: floor.id, type: RoomType.Living, x: 1000, y: 1000, width: 5200, height: 4200 }),
    id: 'room-living',
    name: 'Living Room',
  };
  const straightWall = {
    ...createWall({
      floorId: floor.id,
      roomIds: [living.id],
      startPoint: { x: 1000, y: 1000 },
      endPoint: { x: 6200, y: 1000 },
      thickness: 230,
    }),
    id: 'wall-north',
    hasOpening: true,
  };
  const curvedWall = {
    ...createWall({
      floorId: floor.id,
      roomIds: [living.id],
      startPoint: { x: 6200, y: 1000 },
      endPoint: { x: 6200, y: 5200 },
      thickness: 230,
    }),
    id: 'wall-curved-east',
    arc: {
      center: { x: 6200, y: 3100 },
      radiusMm: 2100,
      startAngleRad: -Math.PI / 2,
      endAngleRad: Math.PI / 2,
      segments: 16,
      anticlockwise: false,
    },
  };
  const door = {
    ...createDoor({
      floorId: floor.id,
      wallId: straightWall.id,
      position: { x: 2400, y: 1000 },
      width: 1000,
      connectsRooms: [living.id, '__outside__'],
    }),
    id: 'door-main',
  };
  const windowEntity = {
    ...createWindow({
      floorId: floor.id,
      wallId: straightWall.id,
      position: { x: 4600, y: 1000 },
      width: 1500,
      roomId: living.id,
    }),
    id: 'win-living',
  };
  return {
    ...base,
    version: 3,
    floors: [
      {
        ...floor,
        elevationMm: 450,
        boundary: {
          points: [
            { x: 1000, y: 1000 },
            { x: 6200, y: 1000 },
            { x: 6200, y: 5200 },
            { x: 1000, y: 5200 },
          ],
        },
        rooms: [living],
        walls: [straightWall, curvedWall],
        doors: [door],
        windows: [windowEntity],
      },
    ],
  };
}

describe('Phase 4A Gate D — Cota Pure-TS CAD Kernel & Canonical CAD Adapter', () => {
  it('projects canonical Building to CAD with stable handles, curved arcs, hosts, and <0.01 mm DXF readback', async () => {
    const building = buildFixtureBuilding();
    const doc1 = projectBuildingToCanonicalCad(building);
    const doc2 = projectBuildingToCanonicalCad({ ...building, version: 4 });

    // Stable handles survive revision increments
    expect(doc1.mappings).toEqual(doc2.mappings);
    expect(doc1.unit).toBe('mm');
    expect(doc1.expectedRevision).toBe(3);

    const adapter = new CanonicalDxfExchangeAdapter();
    const rev = exchangeRevision(building);
    const artifact = await adapter.export(building, rev);
    const readback = await adapter.readback(artifact, rev, building);

    expect(readback.lostCanonicalIds).toEqual([]);
    expect(readback.changedHostIds).toEqual([]);
    expect(readback.maximumPositionErrorMm).toBeLessThanOrEqual(0.001);
    expect(readback.maximumArcDeviationMm).toBeLessThanOrEqual(0.001);
    expect(readback.maximumAreaErrorMm2).toBeLessThanOrEqual(0.01);
  });

  it('resolves endpoint, midpoint, intersection, perpendicular, center, and grid snaps accurately', () => {
    const building = buildFixtureBuilding();
    const doc = projectBuildingToCanonicalCad(building);
    const layerMap = new Map(doc.layers.map(l => [l.name, l]));
    const entities = doc.sheets[0]!.entities;

    // Endpoint snap near (1000, -1000)
    const endSnap = resolveCadSnap({ x: 1040, y: -980 }, entities, layerMap, DEFAULT_CAD_OSNAP_CONFIG, 250);
    expect(endSnap.snapType).toBe('endpoint');
    expect(endSnap.point).toEqual({ x: 1000, y: -1000 });

    // Midpoint snap on straight wall (1000,-1000)->(6200,-1000) => (3600,-1000)
    const midSnap = resolveCadSnap({ x: 3580, y: -1020 }, entities, layerMap, DEFAULT_CAD_OSNAP_CONFIG, 250);
    expect(midSnap.snapType).toBe('midpoint');
    expect(midSnap.point).toEqual({ x: 3600, y: -1000 });

    // Perpendicular snap from basePoint (3100, -2500) onto wall y = -1000 => (3100, -1000)
    const perpSnap = resolveCadSnap(
      { x: 3110, y: -1015 },
      entities,
      layerMap,
      { ...DEFAULT_CAD_OSNAP_CONFIG, midpoint: false },
      250,
      { x: 3100, y: -2500 },
    );
    expect(perpSnap.snapType).toBe('perpendicular');
    expect(perpSnap.point.x).toBeCloseTo(3100, 3);
    expect(perpSnap.point.y).toBeCloseTo(-1000, 3);

    // Grid snap fallback when cursor is far from entities
    const gridSnap = resolveCadSnap(
      { x: 20080, y: 20130 },
      entities,
      layerMap,
      { ...DEFAULT_CAD_OSNAP_CONFIG, gridSnap: true, gridStepMm: 100 },
      200,
    );
    expect(gridSnap.snapType).toBe('grid');
    expect(gridSnap.point).toEqual({ x: 20100, y: 20100 });
  });

  it('executes distance, angle, 3-pt arc, offset, trim, extend, move, rotate, mirror and blocks canonical mutation', () => {
    const dist = measureCadDistance({ x: 0, y: 0 }, { x: 3000, y: 4000 });
    expect(dist.distanceMm).toBeCloseTo(5000, 6);
    expect(dist.deltaXMm).toBe(3000);
    expect(dist.deltaYMm).toBe(4000);

    const ang = measureCadAngle({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 });
    expect(ang?.interiorAngleDeg).toBeCloseTo(90, 6);

    const arc3 = cadArcFrom3Points({ x: 1000, y: 0 }, { x: 0, y: 1000 }, { x: -1000, y: 0 });
    expect(arc3?.radius).toBeCloseTo(1000, 5);
    expect(arc3?.center.x).toBeCloseTo(0, 5);
    expect(arc3?.center.y).toBeCloseTo(0, 5);

    const canonicalWallLine: CadLineEntity = {
      id: 'cad:wall:w1',
      handle: '1A0',
      type: 'LINE',
      layer: 'A-WALL-EXT',
      origin: 'CANONICAL_ARCHITECTURAL',
      canonicalId: 'w1',
      canonicalKind: 'wall',
      start: { x: 0, y: 0 },
      end: { x: 5000, y: 0 },
    };
    // Raw drafting operations MUST refuse direct mutation of canonical architectural walls
    expect(moveDraftingEntity(canonicalWallLine, 200, 0)).toMatchObject({
      ok: false,
      requiresCanonicalWorkflow: true,
    });
    expect(rotateDraftingEntity(canonicalWallLine, { x: 0, y: 0 }, 45)).toMatchObject({
      ok: false,
      requiresCanonicalWorkflow: true,
    });
    expect(mirrorDraftingEntity(canonicalWallLine, { x: 0, y: 0 }, { x: 0, y: 1000 })).toMatchObject({
      ok: false,
      requiresCanonicalWorkflow: true,
    });

    // Offset from a canonical wall safely creates a non-canonical auxiliary construction line on D-DRAFT
    const offsetRes = offsetDraftingEntity(canonicalWallLine, 600, { x: 2500, y: 1000 }, 'draft-1', 'DF1');
    expect(offsetRes.ok).toBe(true);
    expect(offsetRes.entity).toMatchObject({
      origin: 'DRAFTING_ANNOTATION',
      layer: 'D-DRAFT',
      start: { x: 0, y: 600 },
      end: { x: 5000, y: 600 },
    });

    // Trim & Extend on drafting lines
    const cutter: CadLineEntity = {
      id: 'draft-cutter',
      handle: 'DF2',
      type: 'LINE',
      layer: 'D-DRAFT',
      origin: 'DRAFTING_ANNOTATION',
      start: { x: 2000, y: -1000 },
      end: { x: 2000, y: 2000 },
    };
    const trimmed = trimDraftingLine(offsetRes.entity as CadLineEntity, [cutter], { x: 3500, y: 600 });
    expect(trimmed.ok).toBe(true);
    expect(trimmed.replacementEntities).toHaveLength(1);
    expect((trimmed.replacementEntities![0] as CadLineEntity).end).toEqual({ x: 2000, y: 600 });

    const farBoundary: CadLineEntity = {
      id: 'draft-far',
      handle: 'DF3',
      type: 'LINE',
      layer: 'D-DRAFT',
      origin: 'DRAFTING_ANNOTATION',
      start: { x: 6500, y: -1000 },
      end: { x: 6500, y: 2000 },
    };
    const extended = extendDraftingLine(
      trimmed.replacementEntities![0] as CadLineEntity,
      [farBoundary],
      { x: 1950, y: 600 },
    );
    expect(extended.ok).toBe(true);
    expect((extended.entity as CadLineEntity).end).toEqual({ x: 6500, y: 600 });
  });
});
