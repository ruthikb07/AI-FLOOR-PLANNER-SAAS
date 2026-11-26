import { expect, it } from 'vitest';
import { PLUMBING_RISER_TAG, rectToPolygon } from '@ai-floor-planner/core';
import { polygonArea, polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import type { ApartmentPlanRoom, ApartmentPlanStructure } from '../interpretation/apartment-plan';
import { reserveWetWallRisers } from '../mep/wet-wall-risers';

function structure(rooms: readonly ApartmentPlanRoom[]): ApartmentPlanStructure {
  return { source: 'DETERMINISTIC_SCHEMATIC', boundary: rectToPolygon(0, 0, 8000, 8000).points,
    flats: [{ id: 'flat', label: 'Flat', unitType: '2BHK', rect: { x: 500, y: 500, width: 6000, height: 5000 }, rooms }],
    commonRooms: [], ungroupedRooms: [], lifts: [], stairs: [], lobbies: [], corridors: [], shafts: [], openings: [] };
}

it('reserves a custom rectangular chase from a viable convex corner on an orthogonal wet-room polygon', () => {
  const points = [{ x: 1000, y: 1000 }, { x: 4000, y: 1000 }, { x: 4000, y: 3000 },
    { x: 3400, y: 3000 }, { x: 3400, y: 3600 }, { x: 1000, y: 3600 }];
  const room = { id: 'bath', name: 'Bath', type: 'bathroom', rect: { x: 1000, y: 1000, width: 3000, height: 2600 }, polygonPoints: points };
  const result = reserveWetWallRisers(structure([room]), { widthMm: 550, depthMm: 750 });
  expect(result.shafts).toHaveLength(1);
  const { x, y, width, height } = result.shafts[0]!.rect;
  const bath = { points: result.flats[0]!.rooms[0]!.polygonPoints! };
  expect(width * height).toBe(550 * 750);
  expect(polygonArea(bath)).toBe(polygonArea({ points }) - width * height);
  expect(polygonIntersectionArea(bath, rectToPolygon(x, y, width, height))).toBe(0);
});

it('can serve two adjacent baths with a single chase and preserves their individual identities', () => {
  const rooms = [800, 3300].map((x, index) => ({ id: `bath-${index}`, name: `Bath ${index}`, type: 'bathroom',
    rect: { x, y: 1500, width: 2500, height: 2400 } }));
  const result = reserveWetWallRisers(structure(rooms), undefined, true);
  expect(result.shafts).toHaveLength(1);
  expect(result.shafts[0]?.tags).toEqual(rooms.map(room => PLUMBING_RISER_TAG + room.id));
  expect(result.flats[0]?.rooms[1]).toEqual(rooms[1]);
});
