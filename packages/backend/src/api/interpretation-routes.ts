/**
 * Phase 3 - Image interpretation and architectural evaluation routes.
 *
 * These handlers keep Gemini credentials server-side (PRD 36). The browser
 * sends the stored image + the canonical requirement spec; the server performs
 * vision interpretation, deterministic validation, and (separately) the
 * architectural evaluation of an already-valid plan.
 */

import type { DesignRequirementSpecification, SpaceProgram } from '@ai-floor-planner/core';
import { normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import {
  evaluatePlanArchitecturally,
  interpretPlanImageWithGemini,
  type BaseAIProvider,
} from '@ai-floor-planner/ai-orchestration';
import { runExtractionPipeline } from '../services/extraction-pipeline';
import { synthesizeInterpretation } from '../services/local-stub-plan-interpreter';
import { isRecord, type RouteResponse } from './image-routes';

export type ImageInterpreterKind = 'gemini' | 'local-stub';

export interface InterpretationRouteDeps {
  readonly gemini: BaseAIProvider | null;
  readonly interpreterKind: ImageInterpreterKind;
}

interface InterpretBody {
  readonly projectId: string;
  readonly projectName: string;
  readonly requirements: DesignRequirementSpecification;
  readonly program?: SpaceProgram;
  readonly imageBase64: string;
  readonly imageMimeType: string;
  readonly imageWidePixels: number;
  readonly imageTallPixels: number;
}

function parseInterpretBody(body: unknown): InterpretBody | null {
  const record = isRecord(body) ? body : null;
  if (!record) return null;
  const projectId = typeof record.projectId === 'string' && record.projectId.trim() ? record.projectId.trim() : null;
  const imageBase64 = typeof record.imageBase64 === 'string' && record.imageBase64.length > 0 ? record.imageBase64 : null;
  const imageMimeType = typeof record.imageMimeType === 'string' ? record.imageMimeType : 'image/png';
  const imageWidePixels = typeof record.imageWidePixels === 'number' ? record.imageWidePixels : null;
  const imageTallPixels = typeof record.imageTallPixels === 'number' ? record.imageTallPixels : null;
  if (!projectId || !imageBase64 || !imageWidePixels || !imageTallPixels) return null;
  const requirements = normalizeDesignRequirementSpecification(record.requirements);
  return {
    projectId,
    projectName: typeof record.projectName === 'string' && record.projectName.trim() ? record.projectName.trim() : projectId,
    requirements,
    ...(record.program && typeof record.program === 'object' ? { program: record.program as SpaceProgram } : {}),
    imageBase64,
    imageMimeType,
    imageWidePixels,
    imageTallPixels,
  };
}

/** Reject outcome shared by all pipeline failure paths. */
function interpretRouteResult(result: ReturnType<typeof runExtractionPipeline>): RouteResponse {
  return {
    status: 200,
    json: {
      status: result.status,
      planId: result.planId,
      interpretationSource: result.interpretationSource,
      confidence: result.confidence,
      diagnostics: result.diagnostics,
      validation: result.validation
        ? {
          isValid: result.validation.isValid,
          recommendedForEditing: result.validation.recommendedForEditing,
          geometryHealthy: result.validation.geometryHealthy,
          overallScore: result.validation.overallScore,
        }
        : null,
      // Geometry is returned ONLY when the deterministic system accepted it (PRD 23).
      building: result.status === 'ACCEPTED' ? result.building : null,
      rejectedReason: result.status === 'REJECTED'
        ? 'The extracted plan did not pass deterministic validation. The image was not modified and no substitute plan was created.'
        : null,
    },
  };
}

/**
 * Interpret a stored FLUX image into a validated canonical 2D plan, or reject
 * it with actionable reasons. Never returns geometry on rejection.
 */
export async function handleImageInterpretation(body: unknown, deps: InterpretationRouteDeps): Promise<RouteResponse> {
  const parsed = parseInterpretBody(body);
  if (!parsed) {
    return { status: 400, json: { error: { code: 'INVALID_REQUEST', message: 'projectId, imageBase64 and image dimensions are required.' } } };
  }

  let payload: unknown;
  let interpretationSource: 'provider' | 'rule_based' | 'rule_based_fallback';
  let confidence: string;

  if (deps.interpreterKind === 'gemini') {
    if (!deps.gemini || !(await deps.gemini.isAvailable())) {
      return {
        status: 503,
        json: { error: { code: 'IMAGE_INTERPRETER_NOT_CONFIGURED', message: 'Vision interpretation is not configured on this server (GEMINI_API_KEY missing). The image was not interpreted.' } },
      };
    }
    try {
      const vision = await interpretPlanImageWithGemini(deps.gemini, {
        plotWidthMm: parsed.requirements.hard.plotWidthMm,
        plotDepthMm: parsed.requirements.hard.plotDepthMm,
        orientationDegrees: parsed.requirements.orientationDegrees,
        roadFacing: parsed.requirements.hard.roadFacing,
        ...(parsed.requirements.rawUserPrompt ? { userPrompt: parsed.requirements.rawUserPrompt } : {}),
        imageBase64: parsed.imageBase64,
        imageMimeType: parsed.imageMimeType,
      });
      payload = vision.parsed;
      interpretationSource = 'provider';
      confidence = 'likely';
    } catch (error) {
      return {
        status: 502,
        json: { error: { code: 'IMAGE_INTERPRETATION_FAILED', message: error instanceof Error ? error.message : 'Vision interpretation failed.' } },
      };
    }
  } else {
    const synthesized = synthesizeInterpretation(parsed.requirements, parsed.program);
    payload = synthesized.payload;
    interpretationSource = synthesized.source;
    confidence = synthesized.confidence;
  }

  const result = runExtractionPipeline({
    projectId: parsed.projectId,
    projectName: parsed.projectName,
    requirements: parsed.requirements,
    ...(parsed.program ? { program: parsed.program } : {}),
    imageWidePixels: parsed.imageWidePixels,
    imageTallPixels: parsed.imageTallPixels,
    payload,
    extractionSource: interpretationSource === 'provider' ? 'gemini_vision' : 'local_rule_based',
    confidence,
    interpretationSource,
  });

  return interpretRouteResult(result);
}

/** Evaluate an already-valid plan architecturally with Gemini (PRD 25). */
export async function handleArchitecturalEvaluation(body: unknown, deps: InterpretationRouteDeps): Promise<RouteResponse> {
  const record = isRecord(body) ? body : null;
  const buildingSummary = record && typeof record.buildingSummary === 'string' ? record.buildingSummary : null;
  const requirementsSummary = record && typeof record.requirementsSummary === 'string' ? record.requirementsSummary : null;
  if (!record || !buildingSummary || !requirementsSummary) {
    return { status: 400, json: { error: { code: 'INVALID_REQUEST', message: 'buildingSummary and requirementsSummary are required.' } } };
  }
  if (!deps.gemini || !(await deps.gemini.isAvailable())) {
    return { status: 503, json: { error: { code: 'ARCHITECTURAL_EVALUATOR_NOT_CONFIGURED', message: 'Architectural evaluation is not configured on this server (GEMINI_API_KEY missing). No score was produced.' } } };
  }
  try {
    const evaluation = await evaluatePlanArchitecturally(deps.gemini, {
      buildingSummary,
      requirementsSummary,
      ...(typeof record.imageBase64 === 'string' ? { imageBase64: record.imageBase64 } : {}),
      ...(typeof record.imageMimeType === 'string' ? { imageMimeType: record.imageMimeType } : {}),
    });
    return { status: 200, json: { evaluation } };
  } catch (error) {
    return { status: 502, json: { error: { code: 'ARCHITECTURAL_EVALUATION_FAILED', message: error instanceof Error ? error.message : 'Evaluation failed.' } } };
  }
}