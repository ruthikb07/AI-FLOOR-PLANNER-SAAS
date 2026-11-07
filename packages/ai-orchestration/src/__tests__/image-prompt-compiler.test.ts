import { describe, expect, it } from 'vitest';
import {
  createBuilding,
  createEmptySpaceProgram,
  createProgramItem,
  getSpaceDefinition,
  normalizeDesignRequirementSpecification,
  Direction,
  PreferenceLevel,
} from '@ai-floor-planner/core';
import {
  compileFloorPlanImagePrompt,
  compileApartmentFloorPlanImagePrompt,
  FLOOR_PLAN_PROMPT_VERSION,
} from '../orchestration/image-prompt-compiler';

function siteFixture(overrides: Partial<Parameters<typeof createBuilding>[0]['site']> = {}) {
  return createBuilding({
    projectId: 'prompt-test',
    name: 'Prompt Test',
    site: {
      plotWidth: 9144, // 30 ft
      plotDepth: 15240, // 50 ft
      plannedFloorCount: 1,
      roadFacing: Direction.North,
      setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
      ...overrides,
    },
    floors: [{ buildingId: '', level: 0 }],
  }).site;
}

function specFixture(overrides: Record<string, unknown> = {}) {
  return normalizeDesignRequirementSpecification({
    projectId: 'prompt-test',
    projectName: 'Test Home',
    hard: {
      floorsCount: 1,
      bedroomCount: 2,
      bathroomCount: 2,
      livingRoomRequired: true,
      kitchenRequired: true,
      diningRoomRequired: true,
      parkingRequired: true,
      parkingSpacesCount: 1,
    },
    soft: { vastuCompliance: true, naturalLightPreference: PreferenceLevel.High },
    ...overrides,
  });
}

describe('Phase 1C — compileFloorPlanImagePrompt', () => {
  it('is deterministic: identical input + seed yields an identical request', () => {
    const input = { requirements: specFixture(), site: siteFixture(), seed: 42 };
    const a = compileFloorPlanImagePrompt(input);
    const b = compileFloorPlanImagePrompt(input);
    expect(a).toEqual(b);
    expect(a.prompt).toBe(b.prompt);
  });

  it('changes the request when the seed changes (candidate diversity hook)', () => {
    const base = { requirements: specFixture(), site: siteFixture() };
    const a = compileFloorPlanImagePrompt({ ...base, seed: 1 });
    const b = compileFloorPlanImagePrompt({ ...base, seed: 2 });
    expect(a.seed).toBe(1);
    expect(b.seed).toBe(2);
    expect(a).not.toEqual(b);
  });

  it('targets a top-down orthographic drafting style and guards against non-plan imagery', () => {
    const req = compileFloorPlanImagePrompt({ requirements: specFixture(), site: siteFixture(), seed: 7 });
    expect(req.prompt.toLowerCase()).toContain('top-down orthographic');
    expect(req.prompt.toLowerCase()).toContain('residential floor plan');
    expect(req.negativePrompt).toContain('perspective');
    expect(req.negativePrompt).toContain('photorealistic');
    expect(req.negativePrompt).toContain('furniture');
  });

  it('propagates site dimensions, setbacks, orientation and parking into the prompt', () => {
    const site = siteFixture({ roadFacing: Direction.East });
    const req = compileFloorPlanImagePrompt({ requirements: specFixture(), site, seed: 5 });
    expect(req.prompt).toContain('9.14m (width) x 15.24m (depth)');
    expect(req.prompt).toContain('road facing East');
    expect(req.prompt).toContain('front 1500mm');
    expect(req.prompt).toContain('parking for 1 car(s)');
    expect(req.metadata.plotWidthMm).toBe(9144);
    expect(req.metadata.roadFacing).toBe(Direction.East);
  });

  it('prefers the reviewed Space Program schedule over the raw brief when provided', () => {
    const program = {
      ...createEmptySpaceProgram('residential'),
      items: [
        createProgramItem(getSpaceDefinition('bedroom')!, 'b1', { quantity: 3 }),
        createProgramItem(getSpaceDefinition('kitchen')!, 'k1', { quantity: 1 }),
      ],
    };
    const req = compileFloorPlanImagePrompt({
      requirements: specFixture(),
      site: siteFixture(),
      program,
      seed: 9,
    });
    expect(req.prompt).toContain('3 x Bedroom');
    expect(req.prompt).toContain('Kitchen');
  });

  it('includes the additional natural-language brief deterministically', () => {
    const req = compileFloorPlanImagePrompt({
      requirements: specFixture(),
      site: siteFixture(),
      additionalPrompt: 'puja room near the entrance, study facing garden',
      seed: 11,
    });
    expect(req.prompt).toContain('ADDITIONAL BRIEF: puja room near the entrance, study facing garden');
  });

  it('is reproducible: schema, prompt version, seed and aspect-adapted size are pinned', () => {
    const req = compileFloorPlanImagePrompt({ requirements: specFixture(), site: siteFixture(), seed: 3 });
    expect(req.schemaVersion).toBe(1);
    expect(req.promptVersion).toBe(FLOOR_PLAN_PROMPT_VERSION);
    expect(req.seed).toBe(3);
    // 9.144m x 15.24m is portrait => height > width
    expect(req.height).toBeGreaterThan(req.width);
    expect(req.width).toBe(768);
    expect(req.height).toBe(1344);
  });

  it('honours explicit width and height overrides when provided', () => {
    const req = compileFloorPlanImagePrompt({
      requirements: specFixture(),
      site: siteFixture(),
      seed: 3,
      width: 1024,
      height: 1024,
    });
    expect(req.width).toBe(1024);
    expect(req.height).toBe(1024);
  });
});

describe('Phase 2 — compileApartmentFloorPlanImagePrompt (Compact Directive)', () => {
  const apartmentSite = siteFixture({
    plotWidth: 35000,
    plotDepth: 40000,
    roadFacing: Direction.North,
  });

  const apartmentConfig = {
    projectType: 'apartment' as const,
    jurisdiction: 'pune_pmc' as const,
    floorCount: 4,
    flatsPerFloor: 2,
    unitMix: [
      { unitType: '2bhk' as const, count: 1, targetCarpetAreaSqM: 65 },
      { unitType: '3bhk' as const, count: 1, targetCarpetAreaSqM: 95 },
    ],
    commonCore: {
      passengerLifts: 2,
      serviceLifts: 0,
      staircaseCount: 2,
      fireStaircaseRequired: true,
      commonLobby: true,
    },
    parking: {
      residentParkingCount: 8,
      visitorParkingCount: 2,
      twoWheelerParkingCount: 8,
      fourWheelerParkingCount: 8,
    },
    amenities: {
      groundSiteAmenities: ['visitor_parking'],
      buildingAmenities: ['society_office'],
    },
    floorStrategy: 'typical' as const,
  };

  it('produces a compact directive prompt (< 35 lines, < 1500 chars) instead of a 120-line essay', () => {
    const req = compileApartmentFloorPlanImagePrompt({
      site: apartmentSite,
      apartmentConfig,
      seed: 42,
    });

    const lines = req.prompt.split('\n');
    expect(lines.length).toBeLessThan(35);
    expect(req.prompt.length).toBeLessThan(1500);

    // No giant prose manifest dumped in prompt
    expect(req.prompt).not.toContain('Target area: ~');
    expect(req.prompt).not.toContain('BUILDABLE AREA:');
    expect(req.prompt).not.toContain('CURRENT FLOOR PLATE:');
  });

  it('contains all mandatory core facts: exact flat count, unit mix, lifts, stairs, lobby, English-only', () => {
    const req = compileApartmentFloorPlanImagePrompt({
      site: apartmentSite,
      apartmentConfig,
      seed: 42,
    });

    expect(req.prompt).toContain('Generate EXACTLY 2 separate residential flats');
    expect(req.prompt).toContain('1 x 2bhk, 1 x 3bhk');
    expect(req.prompt).toContain('EXACTLY 2 separate elevator shaft(s)');
    expect(req.prompt).toContain('EXACTLY 2 staircase(s)');
    expect(req.prompt).toContain('common lobby and corridor');
    expect(req.prompt).toContain('English only');
    expect(req.prompt).toContain('REFERENCE PRIORITY:');
    expect(req.prompt).toContain('1. USER/MANIFEST REQUIREMENTS');
    expect(req.prompt).toContain('2. DETERMINISTIC SCHEMATIC');
    expect(req.prompt).toContain('3. REFERENCE IMAGE VISUAL STYLE');
  });

  it('adapts output canvas dimensions to plot proportions (portrait for deep plot)', () => {
    const req = compileApartmentFloorPlanImagePrompt({
      site: apartmentSite, // 35m x 40m => portrait
      apartmentConfig,
      seed: 42,
    });

    expect(req.height).toBeGreaterThanOrEqual(req.width);
    expect(req.width).toBe(960);
    expect(req.height).toBe(1088);
  });

  it('stores full manifest in metadata for verification and debugging', () => {
    const req = compileApartmentFloorPlanImagePrompt({
      site: apartmentSite,
      apartmentConfig,
      seed: 42,
    });

    expect(req.metadata.manifest).toBeDefined();
    expect(req.metadata.projectType).toBe('apartment');
    expect(req.metadata.floorsCount).toBe(4);
  });
});
