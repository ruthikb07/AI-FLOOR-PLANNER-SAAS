import { normalizeDesignRequirementSpecification, type Building, type DesignRequirementSpecification } from '@ai-floor-planner/core';

/** Requirements may change the room brief, never silently replace the current site. */
export function withProjectSite(spec: DesignRequirementSpecification, building: Building): DesignRequirementSpecification {
  return normalizeDesignRequirementSpecification({ ...spec, projectId: building.projectId, projectName: building.name,
    plotShape: building.site.plotShape, orientationDegrees: building.site.orientation, setbacksMm: building.site.setbacks,
    hard: { ...spec.hard, plotWidthMm: building.site.plotWidth, plotDepthMm: building.site.plotDepth, roadFacing: building.site.roadFacing },
  });
}

export function generationStatus(hasError: boolean, areaFeasible: boolean, candidateCount: number): string {
  if (hasError) return 'NO VALID LAYOUT GENERATED';
  if (candidateCount > 0) return 'LAYOUT CANDIDATES AVAILABLE — REVIEW REQUIRED';
  return areaFeasible ? 'AREA ESTIMATE ONLY — LAYOUT NOT YET VERIFIED' : 'ROOM PROGRAM NEEDS REVISION';
}

export function createQuickDesignRequirements(building: Building, prompt: string): DesignRequirementSpecification {
  return withProjectSite(normalizeDesignRequirementSpecification({
    rawUserPrompt: prompt,
    hard: { floorsCount: building.site.plannedFloorCount ?? Math.max(building.floors.length, 1), bedroomCount: 2, bathroomCount: 2, parkingSpacesCount: 0 },
    soft: { balconyPreferred: false, vastuCompliance: false },
  }), building);
}
