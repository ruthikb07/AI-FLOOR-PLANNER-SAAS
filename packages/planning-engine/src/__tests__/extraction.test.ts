import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification, RoomType } from '@ai-floor-planner/core';
import type { ExtractedPlan } from '../interpretation/extraction';
import {
  extractedRoomType,
  imageRectToMillimetres,
  inspectExtractionStructure,
  normalizeExtractedPlan,
} from '../interpretation/extraction-analysis';
import {
  attachExtractedOpenings,
  extractPlanToBuilding,
} from '../interpretation/extraction-building';
import { validateExtractedPlan } from '../interpretation/extraction-validation';

function extractionFixture(overrides: Partial<ExtractedPlan> = {}): ExtractedPlan {
  return {
    id: 'extract-phase3',
    boundary: { points: [{ x: 0, y: 0 }, { x: 1024, y: 0 }, { x: 1024, y: 768 }, { x: 0, y: 768 }] },
    rooms: [
      { id: 'r-bedroom', name: 'Bedroom', type: 'bedroom', imageX: 60, imageY: 60, imageWidth: 380, imageHeight: 300, imageArea: 114_000, imageMinWidth: 2000, imageMinHeight: 2000, orientationHint: undefined },
      { id: 'r-living', name: 'Living Room', type: 'living', imageX: 470, imageY: 60, imageWidth: 490, imageHeight: 300, imageArea: 147_000, imageMinWidth: 2000, imageMinHeight: 2000, orientationHint: undefined },
      { id: 'r-kitchen', name: 'Kitchen', type: 'kitchen', imageX: 60, imageY: 390, imageWidth: 300, imageHeight: 300, imageArea: 90_000, imageMinWidth: 1800, imageMinHeight: 1800, orientationHint: undefined },
      { id: 'r-bath', name: 'Bathroom', type: 'bathroom', imageX: 390, imageY: 390, imageWidth: 180, imageHeight: 200, imageArea: 36_000, imageMinWidth: 1200, imageMinHeight: 1200, orientationHint: undefined },
      { id: 'r-dining', name: 'Dining Room', type: 'dining', imageX: 600, imageY: 390, imageWidth: 360, imageHeight: 300, imageArea: 108_000, imageMinWidth: 2000, imageMinHeight: 2000, orientationHint: undefined },
    ],
    doors: [
      { id: 'd-1', imageX: 445, imageY: 200, imageWidth: 24, imageHeight: 10, type: 'single', swingDirection: 'inward', connectsRooms: ['r-bedroom', 'r-living'], adjacentRoomId: 'r-bedroom' },
    ],
    windows: [
      { id: 'w-1', imageX: 200, imageY: 62, imageWidth: 120, imageHeight: 8, adjacentRoomId: 'r-bedroom' },
    ],
    stairs: [
      { id: 's-1', name: 'Staircase', imageX: 610, imageY: 700, imageWidth: 140, imageHeight: 68 },
    ],
    parking: [],
    metadata: {
      imageWidePixels: 1024,
      imageTallPixels: 768,
      imageAspectRatio: 1024 / 768,
      plotAspectRatio: 0,
      aspectMismatchRatio: 0,
      orientationDegrees: 0,
      roadFacing: 'north',
      extractionSource: 'test',
      confidence: 'likely',
      normalizedAt: '',
    },
    ...overrides,
  };
}

const site = { plotWidth: 13_653, plotDepth: 10_240, orientation: 0, roadFacing: 'north' };
const buildable = { ...site, frontSetback: 1500, rearSetback: 1000, leftSetback: 1000, rightSetback: 1000 };

function specFixture() {
  return normalizeDesignRequirementSpecification({
    hard: { plotWidthMm: 13_653, plotDepthMm: 10_240, floorsCount: 1, bedroomCount: 1, bathroomCount: 1, livingRoomRequired: true, kitchenRequired: true, diningRoomRequired: true, staircaseRequired: false, parkingRequired: false, parkingSpacesCount: 0 },
  });
}

describe('Phase 3 — extraction normalization (PRD 22)', () => {
  it('maps image pixels to real millimetres using the known site dimensions', () => {
    const plan = extractionFixture();
    const real = imageRectToMillimetres(plan.rooms[0]!, plan.metadata, site);
    expect(real).not.toBeNull();
    expect(real!.x).toBeCloseTo((60 / 1024) * 13_653, 1);
    expect(real!.y).toBeCloseTo((60 / 768) * 10_240, 1);
    expect(real!.width).toBeCloseTo((380 / 1024) * 13_653, 1);
  });

  it('reports an aspect mismatch as a warning instead of distorting geometry', () => {
    const plan = extractionFixture({ metadata: { ...extractionFixture().metadata, imageWidePixels: 1024, imageTallPixels: 200 } });
    const { diagnostics } = normalizeExtractedPlan(plan, site);
    expect(diagnostics.some(issue => issue.code === 'NORMALIZATION_ASPECT_MISMATCH')).toBe(true);
  });

  it('refuses to normalize when dimensions are zero', () => {
    const plan = extractionFixture({ metadata: { ...extractionFixture().metadata, imageWidePixels: 0, imageTallPixels: 0 } });
    const { normalized, diagnostics } = normalizeExtractedPlan(plan, site);
    expect(normalized).toBeNull();
    expect(diagnostics.some(issue => issue.code === 'NORMALIZATION_FAILED_ZERO_DIMENSIONS')).toBe(true);
  });

  it('maps common vision labels to canonical types', () => {
    expect(extractedRoomType('Master Bedroom')).toBe(RoomType.Bedroom);
    expect(extractedRoomType('Toilet + Bath')).toBe(RoomType.Bathroom);
    expect(extractedRoomType('Kitchen / Store')).toBe(RoomType.Kitchen);
    expect(extractedRoomType('Drawing Hall')).toBe(RoomType.Living);
    expect(extractedRoomType('Stair Hall')).toBe(RoomType.Staircase);
    expect(extractedRoomType('Car Porch')).toBe(RoomType.Parking);
  });
});
describe('Phase 3 — extraction to canonical building (PRD 21)', () => {
  it('converts every extracted space into a tagged ground-floor room', () => {
    const plan = extractionFixture();
    const { building, diagnostics } = extractPlanToBuilding(plan, buildable, 'phase3-proj', 'Phase 3 Home');
    expect(building).not.toBeNull();
    const names = building!.floors[0]!.rooms.map(room => room.name);
    expect(names).toContain('Bedroom');
    expect(names).toContain('Living Room');
    expect(names).toContain('Kitchen');
    expect(names).toContain('Staircase');
    expect(building!.floors[0]!.rooms.every(room => room.tags.some(tag => tag.startsWith('extracted:')))).toBe(true);
    expect(diagnostics).toEqual([]);
  });

  it('rejects a degenerate boundary instead of inventing geometry', () => {
    const plan = extractionFixture({ boundary: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
    const { building, diagnostics } = extractPlanToBuilding(plan, buildable, 'phase3-proj', 'Phase 3 Home');
    expect(building).toBeNull();
    expect(diagnostics.some(issue => issue.code === 'EXTRACTION_BOUNDARY_DEGENERATE')).toBe(true);
  });

  it('flags rather than fabricates doors whose adjacent room is missing', () => {
    const plan = extractionFixture();
    const missing = extractionFixture({ rooms: plan.rooms.filter(room => room.id !== 'r-bedroom') });
    const base = extractPlanToBuilding(missing, buildable, 'phase3-proj', 'Phase 3 Home');
    const resolved = attachExtractedOpenings(base.building!, missing, site);
    expect(resolved.diagnostics.some(issue => issue.code === 'EXTRACTION_DOOR_SKIPPED')).toBe(true);
  });
});

describe('Phase 3 — hard validation of the extracted plan (PRD 23)', () => {
  it('accepts a clean extraction and recommends it for editing', () => {
    const plan = extractionFixture();
    const { building } = extractPlanToBuilding(plan, buildable, 'phase3-proj', 'Phase 3 Home');
    const { building: withOpenings } = attachExtractedOpenings(building!, plan, site);
    const result = validateExtractedPlan(withOpenings, plan, specFixture());
    expect(result.isValid).toBe(true);
    expect(result.recommendedForEditing).toBe(true);
    expect(result.verificationIssues).toEqual([]);
  });

  it('rejects an extraction that omits a required bedroom without relaxing the program', () => {
    const plan = extractionFixture({ rooms: extractionFixture().rooms.filter(room => room.id !== 'r-bedroom') });
    const { building } = extractPlanToBuilding(plan, buildable, 'phase3-proj', 'Phase 3 Home');
    const result = validateExtractedPlan(building!, plan, specFixture());
    expect(result.isValid).toBe(false);
    expect(result.verificationIssues.some(issue => issue.code === 'EXTRACTION_MISSING_REQUIRED_ROOMS')).toBe(true);
    expect(result.recommendedForEditing).toBe(false);
  });

  it('rejects extracted rooms that overlap', () => {
    const plan = extractionFixture({
      rooms: [
        { id: 'r-a', name: 'Bedroom A', type: 'bedroom', imageX: 60, imageY: 60, imageWidth: 400, imageHeight: 300, imageArea: 120_000, imageMinWidth: 2000, imageMinHeight: 2000, orientationHint: undefined },
        { id: 'r-b', name: 'Bedroom B', type: 'bedroom', imageX: 80, imageY: 80, imageWidth: 400, imageHeight: 300, imageArea: 120_000, imageMinWidth: 2000, imageMinHeight: 2000, orientationHint: undefined },
      ],
    });
    const { building } = extractPlanToBuilding(plan, buildable, 'phase3-proj', 'Phase 3 Home');
    const result = validateExtractedPlan(building!, plan, specFixture());
    expect(result.isValid).toBe(false);
    expect(result.verificationIssues.some(issue => issue.code === 'EXTRACTION_ROOM_COLLISIONS')).toBe(true);
  });

  it('flags a structurally degenerate extraction before geometry checks', () => {
    const plan = extractionFixture({ boundary: { points: [] } });
    expect(inspectExtractionStructure(plan).some(issue => issue.code === 'EXTRACTION_BOUNDARY_DEGENERATE')).toBe(true);
  });
});