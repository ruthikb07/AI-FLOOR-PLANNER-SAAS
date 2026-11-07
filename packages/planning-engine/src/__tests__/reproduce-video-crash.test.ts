import { describe, it } from 'vitest';
import { Direction, normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Video Reproduction 60x55 ft 2BHK', () => {
  it('reproduces candidate generation on 60x55 ft (18288 x 16764 mm)', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 18288,
        plotDepthMm: 16764,
        roadFacing: Direction.North,
        floorsCount: 3,
        staircaseRequired: true,
        bedroomCount: 2,
        bathroomCount: 2,
        livingRoomRequired: true,
        diningRoomRequired: true,
        kitchenRequired: true,
        parkingRequired: true,
        parkingSpacesCount: 1,
      },
      soft: {
        vastuCompliance: true,
        gardenPreference: true,
      },
      setbacksMm: {
        front: 2000,
        rear: 1500,
        left: 1000,
        right: 1000,
      },
    });

    const programGen = new RoomProgramGenerator();
    const program = programGen.generateProgram(spec);
    const candidateGen = new CandidateGenerator();

    console.log('Testing generateArchitecturalCandidates with 60x55 ft...');
    try {
      const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);
      console.log(`Generated ${candidates.length} candidates!`);
      for (const c of candidates) {
        console.log(`Candidate: ${c.name} - Valid: ${c.validation.isValid} - Issues: ${c.validation.violations.length}`);
      }
    } catch (err) {
      console.error('CRASH in generateArchitecturalCandidates:', err);
    }
  });
});
