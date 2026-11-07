import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import { synthesizeInterpretation } from '../services/local-stub-plan-interpreter';
import { runExtractionPipeline } from '../services/extraction-pipeline';

const REQUIREMENTS = normalizeDesignRequirementSpecification({
  projectName: 'Pipeline Home',
  hard: { plotWidthMm: 10240, plotDepthMm: 10240, floorsCount: 1, bedroomCount: 2, bathroomCount: 1, livingRoomRequired: true, kitchenRequired: true, diningRoomRequired: false, staircaseRequired: false, parkingRequired: false, parkingSpacesCount: 0 },
});

describe('Phase 3 — extraction pipeline (PRD 19-24)', () => {
  it('accepts a clean synthesized interpretation with a candidate building', () => {
    const synthesized = synthesizeInterpretation(REQUIREMENTS);
    const result = runExtractionPipeline({
      projectId: 'pipeline-1',
      projectName: 'Pipeline Home',
      requirements: REQUIREMENTS,
      imageWidePixels: 1024,
      imageTallPixels: 1024,
      payload: synthesized.payload,
      extractionSource: 'local_rule_based',
      confidence: synthesized.confidence,
      interpretationSource: synthesized.source,
    });
    expect(result.status).toBe('ACCEPTED');
    expect(result.building).not.toBeNull();
    expect(result.building!.floors).toHaveLength(1);
    expect(result.validation).not.toBeNull();
    expect(result.validation!.isValid).toBe(true);
    expect(result.interpretationSource).toBe('rule_based');
  });

  it('rejects tampered geometry that would distort the original', () => {
    const synthesized = synthesizeInterpretation(REQUIREMENTS);
    const tampered = {
      ...(synthesized.payload as Record<string, unknown>),
      rooms: [{ id: 'x1', name: 'Bedroom', type: 'bedroom', x: 0, y: 0, width: 1000, height: 1000 }],
    };
    // Forcing every room to overlap the full plot is structurally untrustworthy.
    const result = runExtractionPipeline({
      projectId: 'pipeline-2',
      projectName: 'Pipeline Home',
      requirements: REQUIREMENTS,
      imageWidePixels: 1024,
      imageTallPixels: 1024,
      payload: { boundary: (synthesized.payload as Record<string, unknown>).boundary, rooms: [tampered.rooms[0], tampered.rooms[0], tampered.rooms[0]] },
      extractionSource: 'local_rule_based',
      confidence: 'ambiguous',
      interpretationSource: 'rule_based',
    });
    expect(result.status).toBe('REJECTED');
    expect(result.building).toBeNull();
    expect(result.validation).not.toBeNull();
    expect(result.validation!.isValid).toBe(false);
  });

  it('rejects an interpretation with no usable rooms, honestly labelled', () => {
    const result = runExtractionPipeline({
      projectId: 'pipeline-3',
      projectName: 'Pipeline Home',
      requirements: REQUIREMENTS,
      imageWidePixels: 1024,
      imageTallPixels: 1024,
      payload: {
        boundary: { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] },
        rooms: [],
      },
      extractionSource: 'local_rule_based',
      confidence: 'ambiguous',
      interpretationSource: 'rule_based',
    });
    expect(result.status).toBe('REJECTED');
    expect(result.building).toBeNull();
    expect(result.diagnostics.some(d => d.code === 'EXTRACTION_NO_ROOMS')).toBe(true);
  });
});