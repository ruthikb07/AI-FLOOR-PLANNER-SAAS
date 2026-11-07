import { describe, expect, it } from 'vitest';
import { createBuilding, createEmptySpaceProgram, createProgramItem, getSpaceDefinition, Direction } from '@ai-floor-planner/core';
import {
  IMAGE_SEED_STEP,
  compileImageRequest,
  imageBaseSeed,
  imageContextSignature,
  imageDataUrl,
  nextImageSeed,
  resolveImageRequirements,
} from '../services/ai-concept-image';
import { CURRENT_PROJECT_SCHEMA_VERSION, type ProjectEnvelope } from '../services/storage';

function envelope(): ProjectEnvelope {
  const building = createBuilding({
    projectId: 'phase2',
    name: 'Phase 2 Home',
    site: {
      plotWidth: 9144,
      plotDepth: 15240,
      plannedFloorCount: 1,
      roadFacing: Direction.North,
      setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
    },
    floors: [{ buildingId: '', level: 0 }],
  });
  const spaceProgram = {
    ...createEmptySpaceProgram('residential'),
    items: [
      createProgramItem(getSpaceDefinition('living')!, 'living', { quantity: 1 }),
      createProgramItem(getSpaceDefinition('kitchen')!, 'kitchen', { quantity: 1 }),
      createProgramItem(getSpaceDefinition('bedroom')!, 'bedroom', { quantity: 2 }),
      createProgramItem(getSpaceDefinition('common_bathroom')!, 'bath', { quantity: 1 }),
    ],
  };
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId: 'phase2',
    name: 'Phase 2 Home',
    createdAt: '2026-09-19T00:00:00Z',
    updatedAt: '2026-09-19T00:00:00Z',
    building,
    spaceProgram,
  };
}

describe('Phase 2 — deterministic image seeds (PRD §17)', () => {
  it('advances attempts by a fixed step, never randomly', () => {
    expect(nextImageSeed(1000, 0)).toBe(1000);
    expect(nextImageSeed(1000, 1)).toBe(1000 + IMAGE_SEED_STEP);
    expect(nextImageSeed(1000, 2)).toBe(1000 + IMAGE_SEED_STEP * 2);
    // Same call twice is identical (no randomness).
    expect(nextImageSeed(1000, 3)).toBe(nextImageSeed(1000, 3));
  });

  it('wraps into the positive 32-bit range', () => {
    const seed = nextImageSeed(2_147_483_646, 2);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2_147_483_647);
  });

  it('prefers the reviewed generation seed when present', () => {
    const base = envelope();
    expect(imageBaseSeed(base)).toBe(20260904);
    expect(imageBaseSeed({ ...base, generationSession: { schemaVersion: 1, generatedAt: 'x', candidates: [], requestSeed: 4242 } })).toBe(4242);
  });
});

describe('Phase 2 — request compilation from canonical state', () => {
  it('derives requirements from the reviewed Space Program', () => {
    const requirements = resolveImageRequirements(envelope());
    expect(requirements).toBeDefined();
    expect(requirements!.hard.plotWidthMm).toBe(9144);
    expect(requirements!.hard.plotDepthMm).toBe(15240);
  });

  it('returns undefined without a reviewed program (never fabricates a brief)', () => {
    const value = envelope();
    expect(resolveImageRequirements({ ...value, spaceProgram: undefined })).toBeUndefined();
    expect(compileImageRequest({ ...value, spaceProgram: undefined }, 0)).toBeUndefined();
  });

  it('compiles attempt 0 and attempt 1 to different seeds but the same prompt', () => {
    const first = compileImageRequest(envelope(), 0)!;
    const second = compileImageRequest(envelope(), 1)!;
    expect(first.seed).toBe(20260904);
    expect(second.seed).toBe(20260904 + IMAGE_SEED_STEP);
    expect(first.prompt).toBe(second.prompt);
    expect(first.prompt).toContain('road facing North');
    expect(first.metadata.projectId).toBe('phase2');
  });

  it('builds a displayable data URL and a revision signature', () => {
    expect(imageDataUrl('image/png', 'QUJD')).toBe('data:image/png;base64,QUJD');
    const value = envelope();
    const signature = imageContextSignature(value.building);
    expect(signature).toContain(value.building.id);
    expect(signature).toContain('9144x15240');
  });
});