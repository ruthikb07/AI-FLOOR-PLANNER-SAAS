import { describe, expect, it } from 'vitest';
import {
  computeAspectAdaptedDimensions,
  resolveApartmentReferenceBucket,
  selectReferenceCandidates,
  finalizeReferenceSelection,
  compileApartmentFloorPlanImagePrompt,
  compileFloorPlanImagePrompt,
  type AvailableReferenceFile,
  type ReferenceDropRecord,
} from '../index.js';
import { createBuilding, Direction, normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';

describe('Phase 2 Acceptance Tests — Aspect Ratio Adaptation', () => {
  it('portrait plot yields portrait output (height > width)', () => {
    // 20m width x 40m depth = 0.5 aspect ratio
    const dims = computeAspectAdaptedDimensions(20, 40);
    expect(dims.height).toBeGreaterThan(dims.width);
    expect(dims.width).toBe(704);
    expect(dims.height).toBe(1472);
    expect(dims.width * dims.height).toBeLessThanOrEqual(1024 * 1024 * 1.05);
  });

  it('landscape plot yields landscape output (width > height)', () => {
    // 50m width x 25m depth = 2.0 aspect ratio
    const dims = computeAspectAdaptedDimensions(50, 25);
    expect(dims.width).toBeGreaterThan(dims.height);
    expect(dims.width).toBe(1472);
    expect(dims.height).toBe(704);
  });

  it('square plot yields 1024 x 1024 square output', () => {
    // 30m width x 30m depth = 1.0 aspect ratio
    const dims = computeAspectAdaptedDimensions(30, 30);
    expect(dims.width).toBe(1024);
    expect(dims.height).toBe(1024);
  });

  it('produces deterministic dimensions for any given input ratio', () => {
    const run1 = computeAspectAdaptedDimensions(35, 40);
    const run2 = computeAspectAdaptedDimensions(35, 40);
    expect(run1).toEqual(run2);
    expect(run1.width).toBe(960);
    expect(run1.height).toBe(1088);
  });

  it('both dimensions are multiples of 64 or 32 for FLUX compatibility', () => {
    const testRatios: [number, number][] = [
      [15, 45], // very narrow portrait
      [30, 40], // moderate portrait
      [35, 35], // square
      [45, 30], // moderate landscape
      [60, 20], // wide landscape
    ];

    for (const [w, d] of testRatios) {
      const dims = computeAspectAdaptedDimensions(w, d);
      expect(dims.width % 32).toBe(0);
      expect(dims.height % 32).toBe(0);
    }
  });
});

describe('Phase 2 Acceptance Tests — Count-Matched Reference Library Selection', () => {
  it('maps 1 flat to flats_1', () => {
    expect(resolveApartmentReferenceBucket('apartment', 1)).toBe('flats_1');
  });

  it('maps 2 flats to flats_2', () => {
    expect(resolveApartmentReferenceBucket('apartment', 2)).toBe('flats_2');
  });

  it('maps 3 flats to flats_3', () => {
    expect(resolveApartmentReferenceBucket('apartment', 3)).toBe('flats_3');
  });

  it('maps 4 flats to flats_4', () => {
    expect(resolveApartmentReferenceBucket('apartment', 4)).toBe('flats_4');
  });

  it('maps 6 flats to flats_6', () => {
    expect(resolveApartmentReferenceBucket('apartment', 6)).toBe('flats_6');
  });

  it('maps villa/residential_independent to villa bucket', () => {
    expect(resolveApartmentReferenceBucket('residential_independent')).toBe('villa');
    expect(resolveApartmentReferenceBucket('residential_independent', 1)).toBe('villa');
  });

  it('user count always wins in prompt even when reference has different flat count', () => {
    const site = createBuilding({
      projectId: 'p2-test',
      name: 'P2 Test',
      site: {
        plotWidth: 35000,
        plotDepth: 40000,
        plannedFloorCount: 4,
        roadFacing: Direction.North,
        setbacks: { front: 4000, rear: 3000, left: 3000, right: 3000 },
      },
      floors: [{ buildingId: '', level: 0 }],
    }).site;

    const promptReq = compileApartmentFloorPlanImagePrompt({
      site,
      apartmentConfig: {
        projectType: 'apartment',
        jurisdiction: 'pune_pmc',
        floorCount: 4,
        flatsPerFloor: 2,
        unitMix: [
          { unitType: '2bhk', count: 1 },
          { unitType: '3bhk', count: 1 },
        ],
        commonCore: {
          passengerLifts: 2,
          serviceLifts: 0,
          staircaseCount: 2,
          fireStaircaseRequired: false,
          commonLobby: true,
        },
        parking: { residentParkingCount: 8, visitorParkingCount: 2 },
        amenities: { groundSiteAmenities: [], buildingAmenities: [] },
        floorStrategy: 'typical',
      },
      seed: 42,
      referenceImages: [
        { id: 'ref_4flat_style', name: 'ref_4flat_style.png', base64Data: 'dummy', mimeType: 'image/png' },
      ],
    });

    // Prompt MUST explicitly demand user flat count (2 flats), never 4 flats
    expect(promptReq.prompt).toContain('Generate EXACTLY 2 separate residential flats');
    expect(promptReq.prompt).toContain('1 x 2bhk, 1 x 3bhk');
    expect(promptReq.prompt).toContain('1. USER/MANIFEST REQUIREMENTS (authoritative for counts & mix)');
    expect(promptReq.prompt).toContain('No villa, no single-family house, no extra flats, no missing flats');
  });

  it('reference selection is deterministic and sorted by name/ID', () => {
    const files: AvailableReferenceFile[] = [
      { id: 'ref_03', name: 'ref_03.png' },
      { id: 'ref_01', name: 'ref_01.png' },
      { id: 'ref_02', name: 'ref_02.png' },
      { id: 'ref_04', name: 'ref_04.png' },
    ];

    const sel1 = selectReferenceCandidates('flats_2', files, 2);
    const sel2 = selectReferenceCandidates('flats_2', files, 2);

    expect(sel1).toEqual(sel2);
    expect(sel1.selected.map(s => s.id)).toEqual(['ref_01', 'ref_02']);
    expect(sel1.requestedIds).toEqual(['ref_01', 'ref_02', 'ref_03', 'ref_04']);
  });

  it('surfaces reference drops structured in diagnostics (no silent drop)', () => {
    const drops: ReferenceDropRecord[] = [
      { id: 'ref_02', reason: 'Corrupt PNG header' },
    ];

    const diagnostics = finalizeReferenceSelection(
      'flats_2',
      ['ref_01', 'ref_02'],
      ['ref_01', 'ref_02'],
      ['ref_01'],
      drops,
    );

    expect(diagnostics.bucket).toBe('flats_2');
    expect(diagnostics.status).toBe('PARTIAL');
    expect(diagnostics.drops).toHaveLength(1);
    expect(diagnostics.requestedReferenceIds).toEqual(['ref_01', 'ref_02']);
    expect(diagnostics.attachedReferenceIds).toEqual(['ref_01']);
    expect(diagnostics.drops).toHaveLength(1);
    expect(diagnostics.drops[0]?.reason).toContain('Corrupt PNG header');
  });
});

describe('Phase 2 Acceptance Tests — Villa Compiler Consistency', () => {
  it('applies aspect-ratio logic, compact prompt, and villa references to villa compiler', () => {
    const site = createBuilding({
      projectId: 'villa-test',
      name: 'Villa Test',
      site: {
        plotWidth: 15000,
        plotDepth: 30000,
        plannedFloorCount: 1,
        roadFacing: Direction.East,
        setbacks: { front: 2000, rear: 1500, left: 1500, right: 1500 },
      },
      floors: [{ buildingId: '', level: 0 }],
    }).site;

    const spec = normalizeDesignRequirementSpecification({
      projectId: 'villa-test',
      projectName: 'Modern Villa',
      hard: {
        floorsCount: 1,
        bedroomCount: 3,
        bathroomCount: 3,
        livingRoomRequired: true,
        kitchenRequired: true,
        diningRoomRequired: true,
        parkingRequired: true,
        parkingSpacesCount: 2,
      },
    });

    const promptReq = compileFloorPlanImagePrompt({
      requirements: spec,
      site,
      seed: 101,
      referenceImages: [
        { id: 'ref_villa_01', name: 'ref_villa_01.png', base64Data: 'dummy', mimeType: 'image/png' },
      ],
    });

    // Aspect adapted: 15m x 30m = 0.5 aspect ratio => portrait
    expect(promptReq.height).toBeGreaterThan(promptReq.width);
    expect(promptReq.width).toBe(704);
    expect(promptReq.height).toBe(1472);

    // Compact directive style
    expect(promptReq.prompt).toContain('Generate ONE professional top-down 2D residential floor plan (single-family villa / independent residence).');
    expect(promptReq.prompt).toContain('3 bedroom(s), 3 bathroom(s)');
    expect(promptReq.prompt).toContain('English architectural labels only');
    expect(promptReq.referenceImages).toHaveLength(1);
  });
});
