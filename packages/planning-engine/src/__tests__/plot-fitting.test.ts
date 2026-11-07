import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import { polygonBoundingBox, polygonArea } from '@ai-floor-planner/geometry-engine';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Plot Footprint Full Fitting', () => {
  it('consumes the buildable envelope on a 50x50 ft (15240x15240 mm) residential plot', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 15240,
        plotDepthMm: 15240,
        bedroomCount: 3,
        bathroomCount: 2,
        livingRoomRequired: true,
        kitchenRequired: true,
        diningRoomRequired: true,
        floorsCount: 1,
      },
      soft: {
        vastuCompliance: false,
      },
    });

    const program = new RoomProgramGenerator().generateProgram(spec);
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 42);

    expect(candidates.length).toBeGreaterThan(0);
    const firstCandidate = candidates[0]!;
    expect(firstCandidate.validation.isValid).toBe(true);

    const floor = firstCandidate.building.floors[0]!;
    const bbox = polygonBoundingBox(floor.boundary);

    // Buildable width with 1200mm side setbacks: ~12840mm
    // Buildable depth with 2000 front & 1500 rear setbacks: ~11740mm
    // Footprint must fully utilize the buildable envelope rather than shrinking into a 6m corner
    expect(bbox.width).toBeGreaterThanOrEqual(11500);
    expect(bbox.height).toBeGreaterThanOrEqual(10500);

    const buildableArea = (15240 - 2400) * (15240 - 3500); // ~150.7 m2
    const actualArea = polygonArea(floor.boundary);
    expect(actualArea).toBeGreaterThanOrEqual(buildableArea * 0.8);
  });
});
