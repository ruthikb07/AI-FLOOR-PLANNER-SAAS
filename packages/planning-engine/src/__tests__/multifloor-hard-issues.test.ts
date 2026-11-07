/**
 * Quick diagnostic to find the exact "hard issues" on a multi-floor building.
 */
import { describe, it, expect } from 'vitest';
import {
  Direction,
  normalizeDesignRequirementSpecification,
} from '@ai-floor-planner/core';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { diagnosticsToValidation } from '../repair/engine';

describe('Multi-floor hard issue diagnostic', () => {
  it('prints per-floor validation details for the default 14x14 2BHK 3-floor building', () => {
    const spec = normalizeDesignRequirementSpecification({
      hard: {
        plotWidthMm: 14000,
        plotDepthMm: 14000,
        roadFacing: Direction.North,
        floorsCount: 3,
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
    
    for (let i = 0; i < candidates.length; i++) {
      const building = candidates[i]!.building;
      const diag = evaluateDesign(building);
      const validation = diagnosticsToValidation(building);
      const errors = diag.warnings.filter(w => w.severity === 'error');
      console.log(`Candidate [${i}] ${building.name}: Valid=${validation.isValid}, Failed=${validation.failed}, Errors=${errors.length}`);
      for (const e of errors) {
        console.log(`  ERROR: ${e.code} - ${e.message}`);
      }
      expect(errors.length).toBe(0);
      expect(validation.failed).toBe(0);
      expect(validation.isValid).toBe(true);
    }
  });
});
