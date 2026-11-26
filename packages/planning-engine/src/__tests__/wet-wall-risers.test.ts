import { expect, it } from 'vitest';
import { PLUMBING_RESERVATION_NOTE_TAG, PLUMBING_RISER_TAG, rectToPolygon, SHARED_PLUMBING_RISER_TAG } from '@ai-floor-planner/core';
import type { ApartmentPlanStructure } from '../interpretation/apartment-plan';
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
