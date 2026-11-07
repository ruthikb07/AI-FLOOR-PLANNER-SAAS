import { describe, it, expect } from 'vitest';
import { Direction, normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Candidate Generation 3BHK Diagnostic Test', () => {
  const directions = [Direction.North, Direction.South, Direction.East, Direction.West];

  for (const dir of directions) {
    for (const floors of [1, 2]) {
      it(`generates candidates for dir=${dir}, floors=${floors}`, () => {
        const spec = normalizeDesignRequirementSpecification({
          projectId: `test_${dir}_f${floors}`,
          projectName: `Test ${dir} ${floors}F`,
          hard: {
            plotWidthMm: 9144,
            plotDepthMm: 15240,
            roadFacing: dir,
            floorsCount: floors,
            staircaseRequired: floors > 1,
            bedroomCount: 3,
            bathroomCount: 2,
            kitchenCount: 1,
            livingCount: 1,
            diningCount: 1,
            parkingRequired: true,
            parkingSpacesCount: 1,
            fullPlotCoverage: false,
          },
          soft: {
            vastuCompliance: true,
            gardenPreference: false,
          },
          orientationDegrees: 0,
          setbacksMm: { front: 1500, rear: 1000, left: 1000, right: 1000 },
        });

        const programGen = new RoomProgramGenerator();
        const program = programGen.generateProgram(spec);
        const candidateGen = new CandidateGenerator();

        const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 101);
        console.log(`[MATRIX] dir=${dir} floors=${floors} candidates=${candidates.length}`);
        expect(candidates.length).toBeGreaterThanOrEqual(1);
      });
    }
  }
});
