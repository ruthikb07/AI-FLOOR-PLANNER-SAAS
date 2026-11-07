import { describe, expect, it } from 'vitest';
import type { OrchestratedCandidateResult, TwoAIGenerationResult } from '../services/backend-api';
import {
  describeCandidateScore,
  describeCandidateSource,
  summarizeGenerationOutcome,
} from '../services/two-ai-candidates';

const artifact = (id: string, provider = 'cloudflare') => ({
  generationId: id,
  projectId: 'p',
  seed: 42,
  model: provider === 'cloudflare' ? '@cf/black-forest-labs/flux-2-klein-4b' : 'deterministic-apartment-schematic-v1',
  provider,
  promptVersion: 1,
  originalPrompt: '',
  negativePrompt: '',
  width: 512,
  height: 512,
  mimeType: 'image/png',
  generatedAt: '2026-09-26T00:00:00.000Z',
  latencyMs: 1,
  imageBase64: 'AA==',
}) as unknown as OrchestratedCandidateResult['artifact'];

const rejectedAtPreflight = (attempt: number, seed: number): OrchestratedCandidateResult => ({
  id: `cand_two_ai_${seed}_0`,
  seed,
  status: 'REJECTED',
  source: 'FLUX',
  visualSource: 'FLUX_IMAGE',
  attempt,
  rejectionStage: 'VISUAL_PREFLIGHT',
  building: null,
  artifact: artifact(`gen_${seed}`),
  validation: {
    isValid: false,
    recommendedForEditing: false,
    geometryHealthy: false,
    overallScore: null,
    verificationIssues: [
      { code: 'VISUAL_PREFLIGHT_FAIL', severity: 'error', message: 'Flat count mismatch: Requested 2 flats, but image shows 3 flats.' },
      { code: 'VISUAL_PREFLIGHT_FAIL', severity: 'error', message: 'Staircase count insufficient: Requested 2 stair(s), but detected 1.' },
    ],
  },
  evaluation: null,
  diagnostics: [],
  rejectedReason: 'Rejected at visual preflight: ...',
});

const fallbackCandidate = (evaluationScore: number | null): OrchestratedCandidateResult => ({
  id: 'cand_fallback_deterministic_42',
  seed: 42,
  status: 'ACCEPTED',
  source: 'FALLBACK_DETERMINISTIC',
  visualSource: 'DETERMINISTIC_SCHEMATIC',
  rejectionStage: null,
  building: { id: 'b', floors: [] } as unknown as OrchestratedCandidateResult['building'],
  artifact: artifact('gen_fallback', 'deterministic-planner'),
  validation: { isValid: true, recommendedForEditing: true, geometryHealthy: true, overallScore: null, verificationIssues: [] },
  evaluation: evaluationScore === null ? null : ({ overallScore: evaluationScore } as OrchestratedCandidateResult['evaluation']),
  diagnostics: [],
  rejectedReason: null,
});

describe('Phase 3 — honest score presentation', () => {
  it('a preflight rejection is "Rejected at visual preflight — not scored", never 0/100', () => {
    const view = describeCandidateScore(rejectedAtPreflight(1, 42));
    // Phase 5: REJECTED is its own state, distinct from NOT_SCORED and SCORED.
    expect(view.kind).toBe('REJECTED');
    expect(view.label).toBe('Rejected at visual preflight — not scored');
    expect(view.label).not.toMatch(/\d+\s*\/\s*100/);
    expect(view.label).not.toContain('0');
  });

  it('a real Gemini evaluation is the only source of a numeric score', () => {
    expect(describeCandidateScore(fallbackCandidate(71))).toEqual({ kind: 'SCORED', score: 71, label: 'Gemini (advisory): 71/100' });
    // A genuine Gemini 0 is still shown as a real score.
    expect(describeCandidateScore(fallbackCandidate(0))).toEqual({ kind: 'SCORED', score: 0, label: 'Gemini (advisory): 0/100' });
    // No evaluation → not scored (no fabricated default like 85).
    const unscored = describeCandidateScore(fallbackCandidate(null));
    expect(unscored.kind).toBe('NOT_SCORED');
    expect(unscored.label).toBe('Not scored');
  });
});

describe('Phase 3 — no false AI claim', () => {
  it('labels FALLBACK_DETERMINISTIC as the deterministic planner, never AI/FLUX', () => {
    const view = describeCandidateSource(fallbackCandidate(null));
    expect(view.source).toBe('FALLBACK_DETERMINISTIC');
    expect(view.isAiGenerated).toBe(false);
    expect(view.label).toBe('Deterministic planner (fallback)');
    expect(view.visualLabel).not.toMatch(/FLUX|AI/);
    expect(view.description).toContain('Source: Deterministic planner.');
    expect(view.description).not.toMatch(/generated successfully/i);
  });

  it('summarizes a fallback outcome with rejected attempts and their reasons', () => {
    const result = {
      success: true,
      projectId: 'p',
      requirements: {} as TwoAIGenerationResult['requirements'],
      feasibility: {},
      latencyMs: 1,
      candidates: [rejectedAtPreflight(1, 42), rejectedAtPreflight(2, 7961), rejectedAtPreflight(3, 15880), fallbackCandidate(71)],
      candidateSource: 'FALLBACK_DETERMINISTIC',
      visualAttempts: { maxPerCandidate: 3, attempted: 3, seeds: [42, 7961, 15880] },
      fallback: {
        used: true,
        reason: 'FLUX_PREFLIGHT_EXHAUSTED',
        message: 'x',
        fluxAttempts: 3,
        maxVisualAttemptsPerCandidate: 3,
        rejectedCandidateIds: [],
        rejectedArtifactIds: [],
        fallbackCandidateId: 'cand_fallback_deterministic_42',
        fallbackArtifactId: 'gen_fallback',
        measured: { flats: 2, lifts: 2, stairs: 2, commonLobby: true },
        required: { flats: 2, lifts: 2, stairs: 2, commonLobby: true },
      },
    } as TwoAIGenerationResult;

    const outcome = summarizeGenerationOutcome(result);
    expect(outcome.candidateSource).toBe('FALLBACK_DETERMINISTIC');
    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.fallbackMessage).toContain('A deterministic apartment plan has been generated instead.');
    expect(outcome.attemptsUsed).toBe(3);
    expect(outcome.rejectedAttempts.map(a => a.seed)).toEqual([42, 7961, 15880]);
    for (const att of outcome.rejectedAttempts) {
      expect(att.headline).toBe('Rejected at visual preflight');
      expect(att.reasons).toContain('Flat count mismatch: Requested 2 flats, but image shows 3 flats.');
    }
  });

  it('treats legacy candidates without a source as FLUX (unchanged Path A labelling)', () => {
    const legacy = { ...rejectedAtPreflight(1, 1), source: undefined, status: 'ACCEPTED' as const };
    expect(describeCandidateSource(legacy).source).toBe('FLUX');
    expect(describeCandidateSource(legacy).isAiGenerated).toBe(true);
  });
});
