import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification, Direction, createBuilding } from '@ai-floor-planner/core';
import { compileFloorPlanImagePrompt } from '@ai-floor-planner/ai-orchestration';
import { createQuickDesignRequirements, withProjectSite } from '../services/design-site-context';

/**
 * Phase 1A/1C — Unified input integration.
 *
 * Verifies that the canonical Site is the single source of truth: the AI design
 * spec and the future FLUX image prompt both derive plot dimensions, setbacks,
 * road orientation and floor count from the SAME canonical site object, with no
 * disconnected or duplicated state.
 */
describe('Phase 1A/1C — unified architectural input feeds the prompt compiler', () => {
  it('derives spec and image prompt from the same canonical site', () => {
    const building = createBuilding({
      projectId: 'unified-input',
      name: 'Unified Input',
      site: {
        plotWidth: 12_192, // 40 ft
        plotDepth: 18_288, // 60 ft
        plannedFloorCount: 2,
        roadFacing: Direction.South,
        setbacks: { front: 2_000, rear: 1_500, left: 1_200, right: 1_200 },
      },
      floors: [{ buildingId: '', level: 0 }],
    });

    // The quick-requirements helper must mirror the canonical site.
    const spec = withProjectSite(createQuickDesignRequirements(building, '3BHK with study'), building);
    expect(spec.hard.plotWidthMm).toBe(12_192);
    expect(spec.hard.plotDepthMm).toBe(18_288);
    expect(spec.hard.roadFacing).toBe(Direction.South);
    expect(spec.hard.floorsCount).toBe(2);
    expect(spec.setbacksMm).toEqual({ front: 2_000, rear: 1_500, left: 1_200, right: 1_200 });
    expect(spec.projectId).toBe('unified-input');

    // The deterministic prompt compiler consumes the same site + spec.
    const request = compileFloorPlanImagePrompt({ requirements: spec, site: building.site, seed: 7 });
    expect(request.metadata.plotWidthMm).toBe(12_192);
    expect(request.metadata.plotDepthMm).toBe(18_288);
    expect(request.metadata.floorsCount).toBe(2);
    expect(request.metadata.roadFacing).toBe(Direction.South);
    expect(request.metadata.projectId).toBe('unified-input');
    expect(request.prompt).toContain('road facing South');
    // Phase 2 compact prompt format: "<w>m (width) x <d>m (depth)" — still derived from the canonical site.
    expect(request.prompt).toContain('12.19m (width) x 18.29m (depth)');
  });

  it('normalization reconciles multi-floor staircase requirements deterministically', () => {
    // A 2-floor brief without an explicit staircase must normalize to require one,
    // so downstream feasibility and the prompt agree on the program.
    const spec = normalizeDesignRequirementSpecification({
      hard: { floorsCount: 3, bedroomCount: 3, bathroomCount: 2, staircaseRequired: false },
    });
    expect(spec.hard.staircaseRequired).toBe(true);
    expect(spec.hard.floorsCount).toBe(3);
  });
});
