import { describe, it } from 'vitest';
import {
  Direction,
  createBuilding,
  normalizeDesignRequirementSpecification,
  type Building,
  type DesignRequirementSpecification,
} from '@ai-floor-planner/core';
import { CandidateGenerator } from '../generator/candidate-generator';
import { RoomProgramGenerator } from '../program/generator';

function withProjectSite(spec: DesignRequirementSpecification, building: Building): DesignRequirementSpecification {
  return normalizeDesignRequirementSpecification({ ...spec, projectId: building.projectId, projectName: building.name,
    plotShape: building.site.plotShape, orientationDegrees: building.site.orientation, setbacksMm: building.site.setbacks,
    hard: { ...spec.hard, plotWidthMm: building.site.plotWidth, plotDepthMm: building.site.plotDepth, roadFacing: building.site.roadFacing },
  });
}

function createQuickDesignRequirements(building: Building, prompt: string): DesignRequirementSpecification {
  return withProjectSite(normalizeDesignRequirementSpecification({
    rawUserPrompt: prompt,
    hard: { floorsCount: building.site.plannedFloorCount ?? Math.max(building.floors.length, 1), bedroomCount: 2, bathroomCount: 2, parkingSpacesCount: 0 },
    soft: { balconyPreferred: false, vastuCompliance: false },
  }), building);
}

describe('Seed loop reproduction', () => {
  it('tests seeds 100 to 110', () => {
    const building = createBuilding({
      projectId: 'proj_test',
      name: 'Offset Stepped Wings (Service-Articulated) (2BHK)',
      site: {
        plotWidth: 18288,
        plotDepth: 16764,
        roadFacing: Direction.North,
        orientation: 0,
        setbacks: { front: 2000, rear: 1500, left: 1000, right: 1000 },
      },
      floors: [
        { buildingId: 'proj_test', level: 0 },
        { buildingId: 'proj_test', level: 1 },
        { buildingId: 'proj_test', level: 2 },
      ],
    });

    const roomCounts = {
      floors: 3,
      bedrooms: 2,
      bathrooms: 2,
      living: 1,
      dining: 1,
      kitchen: 1,
      balcony: 1,
    };
    const vastuEnabled = true;
    const fullPlotEnabled = false;
    const gardenEnabled = false;

    const specPrompt = `${roomCounts.bedrooms} bedrooms, ${roomCounts.bathrooms} bathrooms, living room, dining, kitchen${vastuEnabled ? ', with vastu orientation' : ''}`;
    const baseSpec = createQuickDesignRequirements(building, specPrompt);
    const spec = normalizeDesignRequirementSpecification({
      ...baseSpec,
      hard: {
        ...baseSpec.hard,
        plotWidthMm: building.site.plotWidth,
        plotDepthMm: building.site.plotDepth,
        roadFacing: building.site.roadFacing,
        floorsCount: Math.max(1, roomCounts.floors || 1),
        staircaseRequired: (roomCounts.floors || 1) > 1,
        bedroomCount: roomCounts.bedrooms,
        bathroomCount: roomCounts.bathrooms,
        livingRoomRequired: roomCounts.living > 0,
        kitchenRequired: roomCounts.kitchen > 0,
        diningRoomRequired: roomCounts.dining > 0,
        parkingRequired: !fullPlotEnabled,
        parkingSpacesCount: !fullPlotEnabled ? 1 : 0,
        fullPlotCoverage: fullPlotEnabled,
      },
      soft: {
        ...baseSpec.soft,
        balconyPreferred: roomCounts.balcony > 0,
        vastuCompliance: vastuEnabled,
        gardenPreference: gardenEnabled,
      },
      orientationDegrees: building.site.orientation,
      setbacksMm: fullPlotEnabled ? { front: 0, rear: 0, left: 0, right: 0 } : building.site.setbacks,
    });

    const programGen = new RoomProgramGenerator();
    const program = programGen.generateProgram(spec);
    const candidateGen = new CandidateGenerator();

    for (let seed = 100; seed <= 115; seed++) {
      try {
        const archCandidates = candidateGen.generateArchitecturalCandidates(spec, program, seed);
        if (archCandidates.length === 0) {
          console.log(`[ZERO CANDIDATES] Seed ${seed} returned 0 candidates!`);
        }
      } catch (err: any) {
        console.error(`[ERROR] Seed ${seed} failed:`, err.message);
      }
    }
  });
});
