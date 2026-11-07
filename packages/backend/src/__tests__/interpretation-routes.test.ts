import { describe, expect, it } from 'vitest';
import { normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import { handleArchitecturalEvaluation, handleImageInterpretation } from '../api/interpretation-routes';

const REQUIREMENTS = normalizeDesignRequirementSpecification({
  projectName: 'Route Home',
  hard: { plotWidthMm: 10240, plotDepthMm: 10240, floorsCount: 1, bedroomCount: 2, bathroomCount: 1, livingRoomRequired: true, kitchenRequired: true, diningRoomRequired: false, staircaseRequired: false, parkingRequired: false, parkingSpacesCount: 0 },
});

describe('Phase 3 — interpretation route (PRD 20-23)', () => {
  it('rejects a malformed interpretation request before touching any provider', async () => {
    const result = await handleImageInterpretation({ projectId: 'p' }, { gemini: null, interpreterKind: 'gemini' });
    expect(result.status).toBe(400);
  });

  it('reports 503 when vision interpretation is not configured', async () => {
    const result = await handleImageInterpretation({
      projectId: 'route-1', requirements: REQUIREMENTS, imageBase64: 'QUJD', imageMimeType: 'image/png', imageWidePixels: 1024, imageTallPixels: 1024,
    }, { gemini: null, interpreterKind: 'gemini' });
    expect(result.status).toBe(503);
    expect((result.json as { error: { code: string } }).error.code).toBe('IMAGE_INTERPRETER_NOT_CONFIGURED');
  });

  it('accepts a clean local interpretation with real canonical geometry', async () => {
    const result = await handleImageInterpretation({
      projectId: 'route-1', projectName: 'Route Home', requirements: REQUIREMENTS, imageBase64: 'QUJD', imageMimeType: 'image/png', imageWidePixels: 1024, imageTallPixels: 1024,
    }, { gemini: null, interpreterKind: 'local-stub' });
    expect(result.status).toBe(200);
    const body = result.json as { status: string; building: unknown; interpretationSource: string; diagnostics: unknown[] };
    expect(body.status).toBe('ACCEPTED');
    expect(body.interpretationSource).toBe('rule_based');
    expect(body.building).not.toBeNull();
  });

  it('never returns geometry when the pipeline rejects', async () => {
    const result = await handleImageInterpretation({
      projectId: 'route-2', projectName: 'Route Home', requirements: REQUIREMENTS, imageBase64: 'QUJD', imageMimeType: 'image/png', imageWidePixels: 0, imageTallPixels: 0,
    }, { gemini: null, interpreterKind: 'gemini' });
    expect(result.status).toBe(400);
  });
});

describe('Phase 3 — architectural evaluation route (PRD 25/26)', () => {
  it('rejects a malformed evaluation request', async () => {
    const result = await handleArchitecturalEvaluation({}, { gemini: null, interpreterKind: 'local-stub' });
    expect(result.status).toBe(400);
  });

  it('reports 503 when the evaluator is not configured and produces no score', async () => {
    const result = await handleArchitecturalEvaluation({
      buildingSummary: '4 rooms, 1 floor', requirementsSummary: '2BHK',
    }, { gemini: null, interpreterKind: 'local-stub' });
    expect(result.status).toBe(503);
    expect((result.json as { error: { code: string } }).error.code).toBe('ARCHITECTURAL_EVALUATOR_NOT_CONFIGURED');
  });
});
