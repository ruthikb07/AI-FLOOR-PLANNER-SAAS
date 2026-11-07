/**
 * Phase 5 — honest stage UX and advisory score states (view-model level).
 * Rows are derived ONLY from server-reported stage state.
 */
import { describe, expect, it } from 'vitest';
import type { OrchestratedCandidateResult, PipelineStagesState, TwoAIGenerationResult } from '../services/backend-api';
import {
  ADVISORY_EVALUATION_NOTICE,
  advisoryCategories,
  describeCandidateScore,
  describePipelineStages,
  inFlightStageRows,
  summarizeGenerationOutcome,
} from '../services/two-ai-candidates';

const allSuccess: PipelineStagesState = {
  imageGeneration: 'SUCCESS',
  imageArtifact: 'AVAILABLE',
  visualPreflight: 'PASSED',
  imageInterpretation: 'SUCCESS',
  imageTo2D: 'SUCCESS',
  validation: 'SUCCESS',
  geminiEvaluation: 'SUCCESS',
};

const evaluation = {
  overallScore: 74, requirementSatisfaction: 80, spatialQuality: 70, circulation: 72, adjacency: 68, zoning: 75,
  privacy: 66, daylight: 71, efficiency: 77, roomProportions: 64, orientation: 70, strengths: [], concerns: [], rationale: '', model: 'm',
} as NonNullable<OrchestratedCandidateResult['evaluation']>;

const state = (rows: ReturnType<typeof describePipelineStages>, key: string) => rows.find(r => r.key === key)!;

describe('Phase 5 — honest stage rows', () => {
  it('a fully successful run shows every stage completed', () => {
    const rows = describePipelineStages({ stages: allSuccess, requirementsUnderstood: true });
    expect(rows.map(r => r.state)).toEqual(Array(9).fill('done'));
  });

  it('interpretation failure: later stages are never shown as successful', () => {
    const rows = describePipelineStages({
      stages: { ...allSuccess, imageInterpretation: 'FAILED', imageTo2D: 'PENDING', validation: 'PENDING', geminiEvaluation: 'PENDING' },
      error: { stage: 'image_interpretation' },
      requirementsUnderstood: true,
    });
    expect(state(rows, 'imageGeneration').state).toBe('done');
    expect(state(rows, 'imageArtifact').state).toBe('done');
    expect(state(rows, 'imageInterpretation').state).toBe('failed');
    const later = rows.slice(rows.findIndex(r => r.key === 'imageInterpretation') + 1);
    expect(later.every(r => r.state !== 'done')).toBe(true);
  });

  it('hard validation failure → "Hard validation failed" and evaluation "Not scored"', () => {
    const rows = describePipelineStages({
      stages: { ...allSuccess, imageTo2D: 'FAILED', validation: 'FAILED', geminiEvaluation: 'SKIPPED' },
      requirementsUnderstood: true,
    });
    expect(state(rows, 'validation')).toMatchObject({ state: 'failed', detail: 'Hard validation failed' });
    expect(state(rows, 'geminiEvaluation')).toMatchObject({ state: 'not_run', detail: 'Not scored' });
  });

  it('evaluation call failure → "Gemini evaluation unavailable" (not success, not a score)', () => {
    const rows = describePipelineStages({ stages: { ...allSuccess, geminiEvaluation: 'FAILED' }, requirementsUnderstood: true });
    expect(state(rows, 'geminiEvaluation')).toMatchObject({ state: 'failed', detail: 'Gemini evaluation unavailable' });
  });

  it('an early feasibility stop marks nothing after it as reached', () => {
    const rows = describePipelineStages({ stages: null, error: { stage: 'feasibility' }, requirementsUnderstood: false });
    expect(state(rows, 'requirements').state).toBe('done');
    expect(state(rows, 'feasibility').state).toBe('failed');
    expect(rows.slice(2).every(r => r.state === 'not_run')).toBe(true);
  });

  it('while the request is in flight, no stage is marked complete', () => {
    expect(inFlightStageRows().every(r => r.state === 'pending')).toBe(true);
  });

  it('the fallback outcome uses the fallback candidate\'s own stages (no FLUX image claimed)', () => {
    const fallbackStages: PipelineStagesState = {
      imageGeneration: 'SKIPPED', imageArtifact: 'AVAILABLE', visualPreflight: 'SKIPPED', imageInterpretation: 'SKIPPED',
      imageTo2D: 'SUCCESS', validation: 'SUCCESS', geminiEvaluation: 'SUCCESS',
    };
    const result = {
      success: true,
      projectId: 'p',
      requirements: {} as TwoAIGenerationResult['requirements'],
      feasibility: {},
      latencyMs: 1,
      stages: { ...allSuccess, imageGeneration: 'EXHAUSTED', visualPreflight: 'REJECTED' },
      candidateSource: 'FALLBACK_DETERMINISTIC',
      candidates: [{
        id: 'fb', seed: 1, status: 'ACCEPTED', source: 'FALLBACK_DETERMINISTIC', stages: fallbackStages, evaluationStatus: 'SCORED',
        building: { floors: [] }, artifact: {}, validation: { isValid: true, recommendedForEditing: true, geometryHealthy: true, overallScore: null, verificationIssues: [] },
        evaluation, diagnostics: [], rejectedReason: null,
      }],
    } as unknown as TwoAIGenerationResult;
    const outcome = summarizeGenerationOutcome(result);
    expect(outcome.stageRowsSource).toBe('CANDIDATE');
    expect(outcome.stageRows.find(r => r.key === 'imageGeneration')!.state).toBe('not_run');
    expect(outcome.stageRows.find(r => r.key === 'validation')!.state).toBe('done');
  });
});

describe('Phase 5 — SCORED / NOT SCORED / REJECTED are distinct states', () => {
  it('preflight rejected → REJECTED, no score, "not scored"', () => {
    const view = describeCandidateScore({ status: 'REJECTED', rejectionStage: 'VISUAL_PREFLIGHT', evaluation: null, evaluationStatus: 'NOT_SCORED_REJECTED' });
    expect(view.kind).toBe('REJECTED');
    expect('score' in view).toBe(false);
    expect(view.label).toMatch(/not scored/);
    expect(view.label).not.toMatch(/\/100/);
  });

  it('a REJECTED candidate never shows a number even if an evaluation object leaked in', () => {
    const view = describeCandidateScore({ status: 'REJECTED', rejectionStage: 'HARD_VALIDATION', evaluation, evaluationStatus: 'NOT_SCORED_REJECTED' });
    expect(view.kind).toBe('REJECTED');
  });

  it('evaluation success → score displayed as advisory', () => {
    const view = describeCandidateScore({ status: 'ACCEPTED', rejectionStage: null, evaluation, evaluationStatus: 'SCORED' });
    expect(view).toEqual({ kind: 'SCORED', score: 74, label: 'Gemini (advisory): 74/100' });
  });

  it('valid plan whose evaluation failed → NOT_SCORED "evaluation unavailable"', () => {
    const view = describeCandidateScore({ status: 'ACCEPTED', rejectionStage: null, evaluation: null, evaluationStatus: 'UNAVAILABLE' });
    expect(view).toMatchObject({ kind: 'NOT_SCORED', label: 'Gemini evaluation unavailable — not scored' });
  });

  it('exposes only the evaluator\'s existing categories, with the advisory notice', () => {
    const cats = advisoryCategories(evaluation);
    expect(cats.map(c => c.key)).toEqual([
      'requirementSatisfaction', 'spatialQuality', 'circulation', 'adjacency', 'zoning',
      'privacy', 'daylight', 'efficiency', 'roomProportions', 'orientation',
    ]);
    expect(advisoryCategories(null)).toEqual([]);
    expect(ADVISORY_EVALUATION_NOTICE).toMatch(/not legal approval, code compliance, structural certification/);
    expect(ADVISORY_EVALUATION_NOTICE).toContain('PROFESSIONAL REVIEW REQUIRED');
  });
});
