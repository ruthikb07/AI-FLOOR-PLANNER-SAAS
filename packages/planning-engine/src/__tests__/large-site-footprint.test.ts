import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification, RoomType } from '@ai-floor-planner/core';
import { polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';
import { sourceProgramItemId } from '../graph/scorer';

describe('program-scaled automatic footprints on large sites', () => {
  it('keeps lift, stair and garden requests without creating 20-metre-wide strips', () => {
    const spec = normalizeDesignRequirementSpecification({ hard:{plotWidthMm:50000,plotDepthMm:60000,bedroomCount:2,bathroomCount:2,floorsCount:1,staircaseRequired:true,liftRequired:true},soft:{gardenPreference:true,balconyPreferred:false,vastuCompliance:false} });
    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const rooms = candidate.building.floors.flatMap(floor => floor.rooms);
      for (const type of [RoomType.Staircase, RoomType.Lift, RoomType.Garden]) expect(rooms.some(room => room.type === type)).toBe(true);
      for (const item of program.items) {
        const matches = rooms.filter(room => room.tags.some(tag => tag.startsWith('program:') && sourceProgramItemId(tag.slice(8)) === item.id));
        expect(matches.length).toBeGreaterThan(0);
        for (const room of matches) expect(room.area).toBeLessThanOrEqual(item.maxAreaMm2 + Math.max(room.width,room.height)*10);
      }
    }
  });
  it.each([50000, 80000])('does not stretch a 2BHK program across a %i mm site', plotWidthMm => {
    const spec = normalizeDesignRequirementSpecification({ hard:{plotWidthMm,plotDepthMm:60000,bedroomCount:2,bathroomCount:2,floorsCount:1},soft:{balconyPreferred:false,vastuCompliance:false} });
    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.building.site.plotWidth).toBe(plotWidthMm);
      expect(candidate.building.site.plotDepth).toBe(60000);
      expect(candidate.validation.isValid).toBe(true);
      expect(polygonBoundingBox(candidate.building.floors[0]!.boundary).width).toBeLessThan(12000);
      let checkedRooms = 0;
      for (const room of candidate.building.floors.flatMap(floor => floor.rooms)) {
        const tag = room.tags.find(value => value.startsWith('program:'));
        const item = tag && program.items.find(value => value.id === sourceProgramItemId(tag.slice(8)));
        if (item) {
          checkedRooms++;
          expect(room.area).toBeLessThanOrEqual(item.maxAreaMm2 + Math.max(room.width, room.height) * 10);
          expect(room.width).toBeGreaterThanOrEqual(item.minWidthMm);
          expect(room.height).toBeGreaterThanOrEqual(item.minHeightMm);
        }
        if (room.type === RoomType.Bathroom) expect(room.area / 1e6).toBeLessThan(7.1);
      }
      expect(checkedRooms).toBe(program.items.length);
    }
  });
});
