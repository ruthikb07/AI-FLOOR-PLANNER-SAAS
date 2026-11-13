/**
 * Architectural evaluation route.
 *
 * Produces advisory architectural commentary on a plan that has ALREADY been
 * generated and validated deterministically. It is explicitly not part of
 * generation: it cannot create, alter or veto geometry, and its score is a
 * design opinion, never a compliance or validity result.
 *
 * The caller passes text summaries of the canonical Building and the
 * requirements. Image input is accepted only as optional context for the
 * commentary; no geometry is ever read back out of an image.
 */

import { evaluatePlanArchitecturally, type BaseAIProvider } from '@ai-floor-planner/ai-orchestration';

export interface RouteResponse {
  readonly status: number;
  readonly json: unknown;
}

export interface EvaluationRouteDeps {
  readonly gemini: BaseAIProvider | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Evaluates an already-valid plan architecturally.
 *
 * Returns 503 rather than a fabricated score when no provider is configured:
 * an unmeasured opinion must never be presented as an evaluation.
 */
export async function handleArchitecturalEvaluation(
  body: unknown,
  deps: EvaluationRouteDeps,
): Promise<RouteResponse> {
  const record = isRecord(body) ? body : null;
  const buildingSummary = record && typeof record.buildingSummary === 'string' ? record.buildingSummary : null;
  const requirementsSummary = record && typeof record.requirementsSummary === 'string' ? record.requirementsSummary : null;

  if (!record || !buildingSummary || !requirementsSummary) {
    return {
      status: 400,
      json: {
        error: {
          code: 'INVALID_REQUEST',
          message: 'buildingSummary and requirementsSummary are required.',
        },
      },
    };
  }

  if (!deps.gemini || !(await deps.gemini.isAvailable())) {
    return {
      status: 503,
      json: {
        error: {
          code: 'ARCHITECTURAL_EVALUATOR_NOT_CONFIGURED',
          message:
            'Architectural evaluation is not configured on this server (GEMINI_API_KEY missing). '
            + 'No score was produced. Plan generation is unaffected: it is deterministic and does '
            + 'not depend on this provider.',
        },
      },
    };
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
    return {
      status: 502,
      json: {
        error: {
          code: 'ARCHITECTURAL_EVALUATION_FAILED',
          message: error instanceof Error ? error.message : 'Evaluation failed.',
        },
      },
    };
  }
}
