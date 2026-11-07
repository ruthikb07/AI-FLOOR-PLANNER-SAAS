/**
 * Two-phase upgrade, Phase 1 — four concept cards (view-model).
 * Valid cards show "Gemini (advisory): N/100"; rejected cards show their reason
 * and are not scored (never 0/100); a failed FLUX call shows no image. Nothing
 * is applied automatically.
 */
import { describe, expect, it } from 'vitest';
import { describeConceptCards } from '../services/two-ai-candidates';
import type { OrchestratedCandidateResult, TwoAIGenerationResult } from '../services/backend-api';

const artifact = (id: string) => ({
  generationId: id, projectId: 'p', seed: 1, model: '@cf/black-forest-labs/flux-2-klein-9b', provider: 'cloudflare',
  promptVersion: 2, originalPrompt: 'x', negativePrompt: 'y', width: 512, height: 512, mimeType: 'image/png',
  generatedAt: '2026-09-26T00:00:00Z', latencyMs: 1, imageBase64: 'iVBORw0KGgo=',
});

const concept = (n: number, strategy: 'balanced' | 'daylight' | 'privacy' | 'circulation', label: string) => ({
  candidateNumber: n, candidateCount: 4, strategy, label, intent: `${label} intent`, slotSeed: 42 + (n - 1) * 137,
  schematicPngBase64: 'AAAA', spatialChecksPassed: 30, spatialChecksTotal: 30, referenceIds: ['ref_a', 'ref_b', 'ref_c'],
});

function candidate(over: Partial<OrchestratedCandidateResult> & Pick<OrchestratedCandidateResult, 'id' | 'seed' | 'status'>): OrchestratedCandidateResult {
  return {
    building: null,
    artifact: artifact(`art_${over.id}`),
    validation: { isValid: false, recommendedForEditing: false, geometryHealthy: false, overallScore: null, verificationIssues: [] },
    evaluation: null,
    diagnostics: [],
    rejectedReason: null,
    ...over,
  } as OrchestratedCandidateResult;
}

const result: Pick<TwoAIGenerationResult, 'candidates' | 'conceptSlots'> = {
  candidates: [
    candidate({
      id: 'c1', seed: 42, status: 'ACCEPTED', rejectionStage: null, evaluationStatus: 'SCORED',
      building: { id: 'b1' } as never,
      evaluation: { overallScore: 77 } as never,
      stages: { imageGeneration: 'SUCCESS', imageArtifact: 'AVAILABLE', visualPreflight: 'PASSED', imageInterpretation: 'SUCCESS', imageTo2D: 'SUCCESS', validation: 'SUCCESS', geminiEvaluation: 'SUCCESS' },
      concept: concept(1, 'balanced', 'Balanced / symmetric'),
    }),
    candidate({
      id: 'c2', seed: 179, status: 'REJECTED', rejectionStage: 'VISUAL_PREFLIGHT', evaluationStatus: 'NOT_SCORED_REJECTED',
      validation: { isValid: false, recommendedForEditing: false, geometryHealthy: false, overallScore: null, verificationIssues: [{ code: 'VISUAL_PREFLIGHT_FAIL', severity: 'error', message: 'Requested 2 flats, but image shows 4 flats.' }] },
      stages: { imageGeneration: 'SUCCESS', imageArtifact: 'AVAILABLE', visualPreflight: 'REJECTED', imageInterpretation: 'SKIPPED', imageTo2D: 'SKIPPED', validation: 'SKIPPED', geminiEvaluation: 'SKIPPED' },
      concept: concept(2, 'daylight', 'Daylight / external edge'),
    }),
    candidate({
      id: 'c4', seed: 453, status: 'REJECTED', rejectionStage: 'HARD_VALIDATION', evaluationStatus: 'NOT_SCORED_REJECTED',
      evaluation: { overallScore: 0 } as never,
      validation: { isValid: false, recommendedForEditing: false, geometryHealthy: false, overallScore: null, verificationIssues: [{ code: 'APARTMENT_UNIT_BEDROOM_MISMATCH', severity: 'error', message: 'FLAT 02 (3BHK) has 2 bedroom(s); manifest requires 3.' }] },
      concept: concept(4, 'circulation', 'Circulation / efficiency'),
    }),
  ],
  conceptSlots: [
    { candidateNumber: 4, strategy: 'circulation', label: 'Circulation / efficiency', seed: 453, status: 'GENERATED', candidateId: 'c4', referenceIds: [] },
    { candidateNumber: 1, strategy: 'balanced', label: 'Balanced / symmetric', seed: 42, status: 'GENERATED', candidateId: 'c1', referenceIds: ['ref_a'] },
    { candidateNumber: 3, strategy: 'privacy', label: 'Privacy-oriented', seed: 316, status: 'GENERATION_FAILED', candidateId: null, referenceIds: [], error: 'TimeoutError' },
    { candidateNumber: 2, strategy: 'daylight', label: 'Daylight / external edge', seed: 179, status: 'GENERATED', candidateId: 'c2', referenceIds: [] },
  ],
};

describe('Two-phase upgrade — concept cards', () => {
  const cards = describeConceptCards(result);

  it('shows the four concepts in candidate order with strategy and seed', () => {
    expect(cards.map(c => [c.candidateNumber, c.title, c.seed])).toEqual([
      [1, 'Candidate 01 — Balanced / symmetric', 42],
      [2, 'Candidate 02 — Daylight / external edge', 179],
      [3, 'Candidate 03 — Privacy-oriented', 316],
      [4, 'Candidate 04 — Circulation / efficiency', 453],
    ]);
  });

  it('valid card: advisory Gemini score, preflight passed, applicable only by the user', () => {
    const c = cards[0]!;
    expect(c.status).toBe('VALID');
    expect(c.score).toEqual({ kind: 'SCORED', score: 77, label: 'Gemini (advisory): 77/100' });
    expect(c.preflightLabel).toBe('Preflight: passed');
    expect(c.canApply).toBe(true);
    expect(c.schematicDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(c.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(c.layoutChecksLabel).toBe('Deterministic layout checks: 30/30 passed');
  });

  it('rejected cards show the reason and are not scored — never 0/100', () => {
    const pf = cards[1]!;
    expect(pf.status).toBe('REJECTED');
    expect(pf.score.kind).toBe('REJECTED');
    expect(pf.score.label).not.toMatch(/\d+\/100/);
    expect(pf.reasons).toEqual(['Requested 2 flats, but image shows 4 flats.']);
    expect(pf.canApply).toBe(false);
    const hv = cards[3]!;
    expect(hv.score.label).toBe('Rejected at hard validation — not scored');
    expect(hv.reasons[0]).toMatch(/3BHK/);
    expect(hv.canApply).toBe(false);
  });

  it('a failed FLUX call is an honest empty card (no image, not scored)', () => {
    const f = cards[2]!;
    expect(f.status).toBe('GENERATION_FAILED');
    expect(f.imageDataUrl).toBeNull();
    expect(f.score.label).toBe('Not scored');
    expect(f.reasons[0]).toMatch(/TimeoutError/);
    expect(f.canApply).toBe(false);
  });

  it('no concept slots ⇒ no cards (single-candidate runs unchanged)', () => {
    expect(describeConceptCards({ candidates: [], conceptSlots: undefined })).toEqual([]);
  });
});
