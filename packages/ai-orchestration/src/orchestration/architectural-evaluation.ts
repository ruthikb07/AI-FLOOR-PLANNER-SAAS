/**
 * Phase 3 - Gemini architectural evaluation (PRD 25).
 *
 * Gemini evaluates a VALID plan (already accepted by the deterministic system)
 * against the original requirements and the generated image. It produces a
 * STRUCTURED score + analysis, never free-form scoring text. This is separate
 * from deterministic validation: the system asks "Is this plan valid?" and
 * Gemini answers "How good is this valid plan?" (PRD 26).
 */

import { AISafetyError, type BaseAIProvider } from '../providers/base';

/** Structured architectural evaluation returned by Gemini. */
export const ARCHITECTURAL_EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallScore', 'requirementSatisfaction', 'spatialQuality', 'circulation', 'adjacency', 'zoning', 'privacy', 'daylight', 'efficiency', 'roomProportions', 'orientation', 'strengths', 'concerns'],
  properties: {
    overallScore: { type: 'number', minimum: 0, maximum: 100 },
    requirementSatisfaction: { type: 'number', minimum: 0, maximum: 100 },
    spatialQuality: { type: 'number', minimum: 0, maximum: 100 },
    circulation: { type: 'number', minimum: 0, maximum: 100 },
    adjacency: { type: 'number', minimum: 0, maximum: 100 },
    zoning: { type: 'number', minimum: 0, maximum: 100 },
    privacy: { type: 'number', minimum: 0, maximum: 100 },
    daylight: { type: 'number', minimum: 0, maximum: 100 },
    efficiency: { type: 'number', minimum: 0, maximum: 100 },
    roomProportions: { type: 'number', minimum: 0, maximum: 100 },
    orientation: { type: 'number', minimum: 0, maximum: 100 },
    strengths: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
} as const;

export interface ArchitecturalEvaluationOptions {
  readonly buildingSummary: string;
  readonly requirementsSummary: string;
  readonly imageBase64?: string;
  readonly imageMimeType?: string;
  readonly timeoutMs?: number;
}

export interface ArchitecturalEvaluationResult {
  readonly overallScore: number;
  readonly requirementSatisfaction: number;
  readonly spatialQuality: number;
  readonly circulation: number;
  readonly adjacency: number;
  readonly zoning: number;
  readonly privacy: number;
  readonly daylight: number;
  readonly efficiency: number;
  readonly roomProportions: number;
  readonly orientation: number;
  readonly strengths: readonly string[];
  readonly concerns: readonly string[];
  readonly rationale: string;
  readonly model: string;
  readonly latencyMs: number;
}

/**
 * Evaluate a valid plan architecturally using Gemini. Requires the plan to
 * have already passed deterministic validation.
 */
export async function evaluatePlanArchitecturally(
  provider: BaseAIProvider,
  options: ArchitecturalEvaluationOptions,
): Promise<ArchitecturalEvaluationResult> {
  const systemPrompt = [
    'You are a senior residential architect reviewing a validated floor plan.',
    'Score each architectural dimension 0-100 and return ONLY the JSON object defined by the schema.',
    'Never claim code compliance, structural safety or professional approval.',
    'Evaluate requirement satisfaction, spatial quality, circulation, adjacency, zoning, privacy, daylight, efficiency, room proportions and orientation separately.',
  ].join(' ');

  const userPrompt = [
    'Evaluate this valid floor plan architecturally.',
    `Plan: ${options.buildingSummary}`,
    `Requirements: ${options.requirementsSummary}`,
  ].join('\n');

  const apiResponse = await provider.complete({
    taskType: 'design_critique' as never,
    systemPrompt,
    userPrompt,
    // Explicit typed image part (recovery Phase 4, P8).
    ...(options.imageBase64
      ? { images: [{ mimeType: options.imageMimeType ?? 'image/png', data: options.imageBase64 }] }
      : {}),
    responseFormat: 'json',
    responseSchema: ARCHITECTURAL_EVALUATION_SCHEMA as Record<string, unknown>,
    maxTokens: 2000,
    temperature: 0,
  });

  const parsed = apiResponse.parsed;
  if (parsed === undefined) {
    throw new AISafetyError('Gemini architectural evaluation returned no structured score.');
  }

  const record = parsed as Record<string, unknown>;
  return {
    overallScore: Number(record.overallScore ?? 0),
    requirementSatisfaction: Number(record.requirementSatisfaction ?? 0),
    spatialQuality: Number(record.spatialQuality ?? 0),
    circulation: Number(record.circulation ?? 0),
    adjacency: Number(record.adjacency ?? 0),
    zoning: Number(record.zoning ?? 0),
    privacy: Number(record.privacy ?? 0),
    daylight: Number(record.daylight ?? 0),
    efficiency: Number(record.efficiency ?? 0),
    roomProportions: Number(record.roomProportions ?? 0),
    orientation: Number(record.orientation ?? 0),
    strengths: Array.isArray(record.strengths) ? record.strengths.map(String) : [],
    concerns: Array.isArray(record.concerns) ? record.concerns.map(String) : [],
    rationale: typeof record.rationale === 'string' ? record.rationale : '',
    model: apiResponse.model,
    latencyMs: apiResponse.latencyMs,
  };
}