import { describe, it } from 'vitest';
import {
  Direction,
  normalizeDesignRequirementSpecification,
} from '@ai-floor-planner/core';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

describe('Diagnose 26 Hard Issues', () => {
  it('prints all diagnostics and validation failures for 14x14 2BHK', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 14000,
        plotDepthMm: 14000,
        roadFacing: Direction.North,
        floorsCount: 1,
        bedroomCount: 2,
        bathroomCount: 2,
        livingRoomRequired: true,
        diningRoomRequired: true,
        kitchenRequired: true,
      },
      soft: {
        vastuCompliance: true,
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
    const candidates = candidateGen.generateArchitecturalCandidates(spec, program, 42);

    console.log(`Generated ${candidates.length} architectural candidates`);
    for (const cand of candidates) {
      console.log(`\n========================================`);
      console.log(`Candidate: ${cand.name} (${cand.strategy})`);
      console.log(`Valid: ${cand.validation.isValid}, Failed issues: ${cand.validation.violations.length}`);
      console.log(`Rooms on Ground Floor:`, cand.building.floors[0]?.rooms.map(r => `${r.name} (${r.type}) [${r.x}, ${r.y}, ${r.width}x${r.height}]`));
      console.log(`Walls on Ground Floor:`, cand.building.floors[0]?.walls.map(w => `Wall [(${w.startPoint.x},${w.startPoint.y}) -> (${w.endPoint.x},${w.endPoint.y})] type=${w.type} thickness=${w.thickness}`));
      console.log(`Violations:`);
      for (const v of cand.validation.violations) {
        console.log(`  - [${v.severity}] ${v.constraintId}: ${v.message} (affected: ${v.affectedEntities?.join(', ')})`);
      }
    }
  });
});
