import { expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  PLUMBING_RESERVATION_NOTE_TAG,
  PLUMBING_RISER_TAG,
  RoomType,
  SHARED_PLUMBING_RISER_TAG,
  rectToPolygon,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import type { ApartmentPlanStructure } from '../interpretation/apartment-plan';
import { synthesizeMepEngineering } from '../mep/mep-synthesizer';
import { reserveWetWallRisers } from '../mep/wet-wall-risers';

function structure(count: number): ApartmentPlanStructure {
  const flats = Array.from({ length: count }, (_, index) => {
    const id = `flat-${index}`;
    const rect = { x: (index % 2) * 2000, y: index < 2 ? 2000 : 5600, width: 2000, height: 2000 };
    const points = rectToPolygon(rect.x, rect.y, rect.width, rect.height).points;
    return { id, label: id, unitType: '1BHK', rect, rooms: [{ id: id + '-bath', name: 'Bath', type: 'bathroom', rect, polygonPoints: points }] };
  });
  return { source: 'DETERMINISTIC_SCHEMATIC', boundary: rectToPolygon(0, 0, 8000, 8000).points, flats,
    commonRooms: [], ungroupedRooms: [], lifts: [], stairs: [], lobbies: [], corridors: [], openings: [],
    shafts: [{ id: 'side-vent', name: 'Open inter-flat vent', rect: { x: 0, y: 4000, width: 4000, height: 1600 },
      architecturalRole: 'OPEN_TO_SKY_VOID', tags: ['shaft:ots', 'shaft:interflat'], assignedFlatId: null },
    { id: 'court', name: 'Central court', rect: { x: 4000, y: 3000, width: 2500, height: 3000 },
      architecturalRole: 'OPEN_TO_SKY_VOID', tags: ['shaft:ots', 'shaft:central-court'], assignedFlatId: null }],
  };
}

it.each([2, 3, 4])('serves %i nearby flats from one perimeter shaft without changing wet rooms or using the court', count => {
  const original = structure(count);
  const result = reserveWetWallRisers(original, { widthMm: 550, depthMm: 750 });
  const shafts = result.shafts.filter(shaft => shaft.tags?.includes(SHARED_PLUMBING_RISER_TAG));
  expect(shafts).toHaveLength(1);
  expect(shafts[0]?.rect).toEqual({ x: 0, y: 4000, width: 550, height: 1600 });
  expect(shafts[0]?.assignedFlatId).toBeNull();
  expect(shafts[0]?.tags).toEqual(expect.arrayContaining(original.flats.map(flat => PLUMBING_RISER_TAG + flat.rooms[0]!.id)));
  expect(result.flats).toEqual(original.flats);
  expect(result.shafts.find(shaft => shaft.id === 'court')).toEqual(original.shafts[1]);
  expect(result.shafts.find(shaft => shaft.id === 'side-vent')?.rect.width).toBe(3450);
});

it('names unserved bathrooms when only the central court could fit the duct', () => {
  const original = structure(4);
  const result = reserveWetWallRisers({ ...original, shafts: [original.shafts[1]!] });
  expect(result.shafts).toEqual([original.shafts[1]]);
  for (const [index, flat] of result.flats.entries()) {
    expect(flat.rooms[0]?.polygonPoints).toEqual(original.flats[index]!.rooms[0]!.polygonPoints);
    expect(flat.rooms[0]?.tags?.[0]).toMatch(PLUMBING_RESERVATION_NOTE_TAG);
  }
});

it.each([2, 3, 4] as const)(
  'coordinates shared external plumbing shafts and sloped gravity drainage collector runs for %i flats/floor',
  flatsPerFloor => {
    const config: MultiSheetApartmentConfig = {
      projectId: `wet-wall-drainage-${flatsPerFloor}`,
      structuralLayoutMode: 'DEFERRED',
      plotWidthMm: 38000,
      plotDepthMm: 32000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.South],
      jurisdiction: 'pune_pmc',
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 2,
      floorToFloorHeightMm: 3150,
      stiltHeightMm: 3000,
      flatsPerFloor,
      units: Array.from({ length: flatsPerFloor }, (_, i) => ({
        unitIndex: i + 1,
        bhkType: '2BHK' as const,
        hasUtilityBalcony: true,
      })),
      parkingMode: 'STILT_AND_SURFACE',
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      architectureOptions: {
        coordinatedWetWallLayout: true,
        preferExteriorLiving: true,
      },
    };
    const { building } = solveMultiSheetApartmentProject(config);
    const mep = building.mepEngineering!;
    expect(mep).toBeDefined();
    expect(mep.verticalStacks.length).toBeGreaterThanOrEqual(1);
    const unconnected = mep.verticalStacks.filter(stack => !stack.terminatesAtStiltCollector);
    const collectorProposed = unconnected.length < mep.verticalStacks.length;
    expect(mep.drainageEconomy).toMatchObject({ routingStatus: 'SCHEMATIC_UNSIZED',
      collectorTerminatesTowardsRoad: collectorProposed, unconnectedRiserCount: unconnected.length });
    if (flatsPerFloor === 2) expect(collectorProposed).toBe(true);
    if (flatsPerFloor === 3) expect(unconnected).toHaveLength(mep.verticalStacks.length);
    expect(mep.drainageEconomy!.sharedShaftCount).toBeGreaterThanOrEqual(1);
    expect(mep.drainageEconomy!.servedWetRoomCount).toBeGreaterThan(0);
    expect(mep.drainageEconomy!.totalDrainagePipeLengthMm).toBeGreaterThan(0);

    for (const floor of building.floors.filter(f => f.apartmentUnits?.length)) {
      const risers = floor.rooms.filter(r => r.tags.includes(SHARED_PLUMBING_RISER_TAG));
      const baths = floor.rooms.filter(r => r.type === RoomType.Bathroom);
      for (const bath of baths) {
        for (const riser of risers) {
          expect(polygonIntersectionArea(bath.boundary, riser.boundary)).toBeLessThan(0.001);
        }
      }
      const floorMep = mep.floors.find(f => f.floorId === floor.id)!;
      const drainRuns = floorMep.runs.filter(r => r.kind === 'SP' || r.kind === 'WP');
      expect(drainRuns.length).toBeGreaterThan(0);
      for (const run of drainRuns) {
        expect(run.slopeRatio).toBe(run.kind === 'SP' ? '1:60' : '1:50');
        expect(run.lengthMm).toBeGreaterThan(0);
      }
    }

    const stilt = building.floors.find(f => f.floorUse === 'STILT_PARKING')!;
    const stiltMep = mep.floors.find(f => f.floorId === stilt.id)!;
    expect(stiltMep.runs.some(r => r.kind === 'SP' && r.diameterMm === 160 && r.slopeRatio === '1:80')).toBe(collectorProposed);
    if (flatsPerFloor === 3) {
      const barrier = { ...stilt.rooms[0]!, type: RoomType.Staircase, boundary: building.site.plotBoundary };
      const blocked = synthesizeMepEngineering({ ...building,
        floors: building.floors.map(floor => floor.id === stilt.id ? { ...floor, rooms: [...floor.rooms, barrier] } : floor) });
      expect(blocked.verticalStacks.every(stack => !stack.terminatesAtStiltCollector)).toBe(true);
      expect(blocked.floors.find(floor => floor.floorId === stilt.id)?.runs.some(run => run.kind === 'SP')).toBe(false);
      expect(blocked.drainageEconomy?.unconnectedRiserCount).toBe(blocked.verticalStacks.length);
    }
  },
  90_000,
);
