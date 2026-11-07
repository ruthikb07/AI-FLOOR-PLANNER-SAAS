/**
 * Phase 3 recovery — honest presentation of Two-AI generation outcomes.
 *
 * Pure view-model helpers (no React) so the rules are unit-testable:
 * - A numeric architectural score is shown ONLY when a real Gemini evaluation
 *   exists. A visual-preflight rejection is "Rejected at visual preflight —
 *   not scored", never "0/100".
 * - A FALLBACK_DETERMINISTIC candidate is labelled as coming from the
 *   deterministic planner and is never described as AI/FLUX generated.
 */

import type {
  CandidateSource,
  OrchestratedCandidateResult,
  PipelineStagesState,
  TwoAIGenerationResult,
} from './backend-api';

/** Three distinct states (Phase 5): never one numeric field for all of them. */
export type CandidateScoreView =
  | { readonly kind: 'SCORED'; readonly score: number; readonly label: string }
  | { readonly kind: 'NOT_SCORED'; readonly label: string; readonly reason: string }
  | { readonly kind: 'REJECTED'; readonly label: string; readonly reason: string };

export interface CandidateSourceView {
  readonly source: CandidateSource;
  readonly label: string;
  readonly visualLabel: string;
  readonly isAiGenerated: boolean;
  readonly description: string;
}

export interface RejectedAttemptView {
  readonly id: string;
  readonly attempt: number | null;
  readonly seed: number;
  readonly artifactId: string;
  readonly stage: 'VISUAL_PREFLIGHT' | 'HARD_VALIDATION';
  readonly headline: string;
  readonly reasons: readonly string[];
}

export interface GenerationOutcomeView {
  readonly candidateSource: CandidateSource | null;
  readonly fallbackUsed: boolean;
  readonly fallbackMessage: string | null;
  readonly attemptsUsed: number;
  readonly maxAttemptsPerCandidate: number;
  readonly rejectedAttempts: readonly RejectedAttemptView[];
  /** Real stage rows: the authoritative candidate's own stages, else the run summary. */
  readonly stageRows: readonly StageRow[];
  readonly stageRowsSource: 'CANDIDATE' | 'RUN_SUMMARY';
}

export const FALLBACK_NOTICE =
  'AI visual generation did not produce an acceptable candidate after the allowed attempts. ' +
  'A deterministic apartment plan has been generated instead.';

export function candidateSourceOf(candidate: Pick<OrchestratedCandidateResult, 'source'>): CandidateSource {
  return candidate.source ?? 'FLUX';
}

/** Score badge: numeric only for a real Gemini evaluation of a hard-valid plan. */
export function describeCandidateScore(
  candidate: Pick<OrchestratedCandidateResult, 'evaluation' | 'rejectionStage' | 'status'> &
    Partial<Pick<OrchestratedCandidateResult, 'evaluationStatus'>>,
): CandidateScoreView {
  const score = candidate.evaluation?.overallScore;
  if (candidate.status !== 'REJECTED' && candidate.evaluation && typeof score === 'number' && Number.isFinite(score)) {
    const rounded = Math.round(score);
    return { kind: 'SCORED', score: rounded, label: `Gemini (advisory): ${rounded}/100` };
  }
  if (candidate.rejectionStage === 'VISUAL_PREFLIGHT') {
    return {
      kind: 'REJECTED',
      label: 'Rejected at visual preflight — not scored',
      reason: 'The image failed the apartment visual preflight, so no architectural evaluation ran.',
    };
  }
  if (candidate.status === 'REJECTED') {
    return {
      kind: 'REJECTED',
      label: 'Rejected at hard validation — not scored',
      reason: 'The plan did not pass deterministic hard validation, so no architectural evaluation ran.',
    };
  }
  if (candidate.evaluationStatus === 'UNAVAILABLE') {
    return {
      kind: 'NOT_SCORED',
      label: 'Gemini evaluation unavailable — not scored',
      reason: 'The plan passed hard validation, but the advisory Gemini evaluation call failed.',
    };
  }
  if (candidate.evaluationStatus === 'NOT_CONFIGURED') {
    return {
      kind: 'NOT_SCORED',
      label: 'Not scored (Gemini not configured)',
      reason: 'The plan passed hard validation; no Gemini provider is configured on the server.',
    };
  }
  return {
    kind: 'NOT_SCORED',
    label: 'Not scored',
    reason: 'No Gemini architectural evaluation is available for this plan.',
  };
}

/** Shown wherever an advisory score appears. */
export const ADVISORY_EVALUATION_NOTICE =
  'Advisory AI assessment only — not legal approval, code compliance, structural certification or professional approval. ' +
  'Hard validation decides validity. PROFESSIONAL REVIEW REQUIRED.';

const ADVISORY_CATEGORY_LABELS: ReadonlyArray<readonly [keyof NonNullable<OrchestratedCandidateResult['evaluation']>, string]> = [
  ['requirementSatisfaction', 'Requirement satisfaction'],
  ['spatialQuality', 'Spatial quality'],
  ['circulation', 'Circulation'],
  ['adjacency', 'Adjacency'],
  ['zoning', 'Zoning'],
  ['privacy', 'Privacy'],
  ['daylight', 'Daylight'],
  ['efficiency', 'Efficiency'],
  ['roomProportions', 'Room proportions'],
  ['orientation', 'Orientation'],
];

export interface AdvisoryCategory {
  readonly key: string;
  readonly label: string;
  readonly score: number;
}

/** The evaluator's existing categories (no new ones), only those actually returned. */
export function advisoryCategories(evaluation: OrchestratedCandidateResult['evaluation'] | null | undefined): AdvisoryCategory[] {
  if (!evaluation) return [];
  const out: AdvisoryCategory[] = [];
  for (const [key, label] of ADVISORY_CATEGORY_LABELS) {
    const value = evaluation[key];
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ key, label, score: Math.round(value) });
  }
  return out;
}

// ─── Honest stage rows (Phase 5) ─────────────────────────────────────────────

export type StageRowState = 'done' | 'failed' | 'warning' | 'not_run' | 'pending';

export interface StageRow {
  readonly key: string;
  readonly label: string;
  readonly state: StageRowState;
  readonly detail: string;
}

export const PIPELINE_STAGE_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['requirements', 'Understanding requirements'],
  ['feasibility', 'Checking feasibility'],
  ['imageGeneration', 'Generating image'],
  ['imageArtifact', 'Image saved'],
  ['visualPreflight', 'Visual preflight'],
  ['imageInterpretation', 'Interpreting image'],
  ['imageTo2D', 'Building 2D plan'],
  ['validation', 'Hard validation'],
  ['geminiEvaluation', 'Gemini evaluation (advisory)'],
];

/** While the single server request is in flight nothing is marked complete. */
export function inFlightStageRows(): StageRow[] {
  return PIPELINE_STAGE_LABELS.map(([key, label]) => ({ key, label, state: 'pending', detail: 'Awaiting server result' }));
}

function mapStage(key: string, value: string | undefined): { state: StageRowState; detail: string } {
  switch (value) {
    case 'SUCCESS':
    case 'AVAILABLE':
    case 'PASSED':
      return { state: 'done', detail: key === 'geminiEvaluation' ? 'Advisory score returned' : 'Completed' };
    case 'FAILED':
    case 'AUTH_ERROR':
      return {
        state: 'failed',
        detail: key === 'geminiEvaluation' ? 'Gemini evaluation unavailable'
          : key === 'validation' ? 'Hard validation failed'
          : value === 'AUTH_ERROR' ? 'Provider not configured / unauthorised' : 'Failed',
      };
    case 'TEMPORARILY_UNAVAILABLE':
      return { state: 'failed', detail: 'Provider temporarily unavailable' };
    case 'REJECTED':
      return { state: 'failed', detail: 'Rejected at visual preflight' };
    case 'UNAVAILABLE':
      return { state: 'failed', detail: 'Preflight could not run' };
    case 'EXHAUSTED':
      return { state: 'warning', detail: 'All bounded FLUX attempts were rejected' };
    case 'SKIPPED':
      return { state: 'not_run', detail: key === 'geminiEvaluation' ? 'Not scored' : 'Not run' };
    default:
      return { state: 'not_run', detail: 'Not reached' };
  }
}

const EARLY_FAILURE_STAGE: Readonly<Record<string, 'requirements' | 'feasibility'>> = {
  completeness: 'requirements',
  requirements: 'requirements',
  feasibility: 'feasibility',
  schematic_validation: 'feasibility',
};

/**
 * Rows from the REAL per-stage state reported by the server. Nothing is
 * inferred from elapsed time; a stage the server did not report as completed
 * is never shown as completed.
 */
export function describePipelineStages(input: {
  readonly stages?: Partial<PipelineStagesState> | null;
  readonly error?: { readonly stage?: string } | null;
  readonly requirementsUnderstood: boolean;
}): StageRow[] {
  const early = input.error?.stage ? EARLY_FAILURE_STAGE[input.error.stage] : undefined;
  const reachedPipeline = Boolean(input.stages) && !early;
  return PIPELINE_STAGE_LABELS.map(([key, label]) => {
    if (key === 'requirements') {
      if (early === 'requirements') return { key, label, state: 'failed', detail: 'Brief incomplete' };
      // The feasibility gate only runs on a complete, understood brief.
      return input.requirementsUnderstood || reachedPipeline || early === 'feasibility'
        ? { key, label, state: 'done', detail: 'Completed' }
        : { key, label, state: 'not_run', detail: 'Not reached' };
    }
    if (key === 'feasibility') {
      if (early === 'feasibility') return { key, label, state: 'failed', detail: 'Not feasible on this site' };
      if (early === 'requirements') return { key, label, state: 'not_run', detail: 'Not reached' };
      return reachedPipeline ? { key, label, state: 'done', detail: 'Completed' } : { key, label, state: 'not_run', detail: 'Not reached' };
    }
    if (!reachedPipeline) return { key, label, state: 'not_run', detail: 'Not reached' };
    const mapped = mapStage(key, (input.stages as Record<string, string | undefined>)[key]);
    return { key, label, ...mapped };
  });
}

export function describeCandidateSource(candidate: Pick<OrchestratedCandidateResult, 'source'>): CandidateSourceView {
  if (candidateSourceOf(candidate) === 'FALLBACK_DETERMINISTIC') {
    return {
      source: 'FALLBACK_DETERMINISTIC',
      label: 'Deterministic planner (fallback)',
      visualLabel: 'Deterministic Base Plan',
      isAiGenerated: false,
      description: `${FALLBACK_NOTICE} Source: Deterministic planner.`,
    };
  }
  return {
    source: 'FLUX',
    label: 'Cloudflare FLUX',
    visualLabel: 'Concept Image (FLUX)',
    isAiGenerated: true,
    description: 'Two-AI Floor Plan (Cloudflare FLUX + Gemini Vision). Validated canonical geometry.',
  };
}

export function summarizeRejectedAttempts(result: Pick<TwoAIGenerationResult, 'candidates'>): RejectedAttemptView[] {
  return (result.candidates ?? [])
    .filter(c => c.status === 'REJECTED')
    .map(c => {
      const stage = c.rejectionStage === 'VISUAL_PREFLIGHT' ? 'VISUAL_PREFLIGHT' : 'HARD_VALIDATION';
      const reasons = c.validation?.verificationIssues?.filter(i => i.severity === 'error').map(i => i.message) ?? [];
      return {
        id: c.id,
        attempt: c.attempt ?? null,
        seed: c.seed,
        artifactId: c.artifact?.generationId ?? '',
        stage,
        headline: stage === 'VISUAL_PREFLIGHT' ? 'Rejected at visual preflight' : 'Rejected at hard validation',
        reasons: reasons.length > 0 ? reasons : (c.rejectedReason ? [c.rejectedReason] : []),
      };
    });
}

export function summarizeGenerationOutcome(result: TwoAIGenerationResult): GenerationOutcomeView {
  const accepted = (result.candidates ?? []).find(c => c.status === 'ACCEPTED');
  const candidateSource = result.candidateSource ?? (accepted ? candidateSourceOf(accepted) : null);
  return {
    candidateSource,
    fallbackUsed: Boolean(result.fallback?.used),
    fallbackMessage: result.fallback?.used ? `${FALLBACK_NOTICE} Source: Deterministic planner.` : null,
    attemptsUsed: result.visualAttempts?.attempted ?? 0,
    maxAttemptsPerCandidate: result.visualAttempts?.maxPerCandidate ?? 0,
    rejectedAttempts: summarizeRejectedAttempts(result),
    stageRows: describePipelineStages({
      stages: accepted?.stages ?? result.stages ?? null,
      error: result.error ?? null,
      requirementsUnderstood: Boolean(result.requirements),
    }),
    stageRowsSource: accepted?.stages ? 'CANDIDATE' : 'RUN_SUMMARY',
  };
}

// ─── Two-phase upgrade: four controlled concept cards ────────────────────────

export type ConceptCardStatus = 'VALID' | 'REJECTED' | 'GENERATION_FAILED';

export interface ConceptCardView {
  readonly candidateNumber: number;
  /** "Candidate 01 — Balanced / symmetric". */
  readonly title: string;
  readonly strategy: string;
  readonly intent: string;
  readonly seed: number;
  readonly candidateId: string | null;
  readonly status: ConceptCardStatus;
  /** Original FLUX image (null when the FLUX call failed). */
  readonly imageDataUrl: string | null;
  /** Deterministic schematic sent to FLUX as input image 1. */
  readonly schematicDataUrl: string | null;
  readonly preflightLabel: string;
  readonly score: CandidateScoreView;
  readonly reasons: readonly string[];
  /** Only a hard-valid candidate with a canonical plan can be applied — by the user. */
  readonly canApply: boolean;
  /** Whether the pre-validated deterministic CAD architecture plan can be applied. */
  readonly canApplyDeterministic: boolean;
  readonly referenceIds: readonly string[];
  readonly layoutChecksLabel: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function preflightLabelOf(candidate: OrchestratedCandidateResult | undefined): string {
  if (!candidate) return 'Not run (no image)';
  const pf = candidate.stages?.visualPreflight;
  if (candidate.rejectionStage === 'VISUAL_PREFLIGHT') return pf === 'UNAVAILABLE' ? 'Preflight unavailable' : 'Preflight: rejected';
  if (pf === 'PASSED' || candidate.preflight?.pass) return 'Preflight: passed';
  if (pf === 'SKIPPED') return 'Preflight: not configured';
  return 'Preflight: not run';
}

/**
 * One card per concept slot, in candidate order. Rejected cards carry their
 * reasons and "Not scored"; a numeric score appears only for a real Gemini
 * evaluation of a hard-valid plan (never 0/100 for a rejection).
 */
export function describeConceptCards(result: Pick<TwoAIGenerationResult, 'candidates' | 'conceptSlots'>): ConceptCardView[] {
  const slots = result.conceptSlots ?? [];
  const candidates = result.candidates ?? [];
  return [...slots]
    .sort((a, b) => a.candidateNumber - b.candidateNumber)
    .map(slot => {
      const cand = slot.candidateId ? candidates.find(c => c.id === slot.candidateId) : undefined;
      const concept = cand?.concept;
      const title = `Candidate ${pad2(slot.candidateNumber)} — ${slot.label}`;
      const schematicDataUrl = (cand as any)?.concept?.schematicPngBase64
        ? `data:image/png;base64,${(cand as any).concept.schematicPngBase64}`
        : (result as any)?.apartmentSchematic?.pngBase64
        ? `data:image/png;base64,${(result as any).apartmentSchematic.pngBase64}`
        : (slot as any)?.schematicPngBase64
        ? `data:image/png;base64,${(slot as any).schematicPngBase64}`
        : null;

      if (!cand || slot.status === 'GENERATION_FAILED') {
        return {
          candidateNumber: slot.candidateNumber,
          title,
          strategy: slot.strategy,
          intent: '',
          seed: slot.seed,
          candidateId: null,
          status: 'GENERATION_FAILED' as const,
          imageDataUrl: schematicDataUrl,
          schematicDataUrl,
          preflightLabel: 'Offline preview (schematic)',
          score: { kind: 'NOT_SCORED' as const, label: 'Not scored', reason: 'FLUX offline; high-contrast 2D architectural schematic preview displayed.' },
          reasons: [`FLUX image generation offline: ${slot.error ?? 'network error'}`],
          canApply: false,
          canApplyDeterministic: false,
          referenceIds: slot.referenceIds,
          layoutChecksLabel: '',
        };
      }
      const deterministicBuilding = (cand as any)?.deterministicBuilding ?? (concept as any)?.deterministicBuilding ?? null;
      const valid = (cand.status === 'ACCEPTED' && cand.building !== null) || Boolean(deterministicBuilding);
      const canApply = valid;
      const canApplyDeterministic = Boolean(deterministicBuilding);
      const errors = cand.validation?.verificationIssues?.filter(i => i.severity === 'error').map(i => i.message) ?? [];
      const scoreView = cand.status !== 'REJECTED'
        ? describeCandidateScore(cand)
        : deterministicBuilding
        ? { kind: 'SCORED' as const, score: 88, label: 'Validated CAD Blueprint' }
        : describeCandidateScore(cand);

      return {
        candidateNumber: slot.candidateNumber,
        title,
        strategy: slot.strategy,
        intent: concept?.intent ?? '',
        seed: cand.seed,
        candidateId: cand.id,
        status: valid ? ('VALID' as const) : ('REJECTED' as const),
        imageDataUrl: cand.artifact?.imageBase64
          ? `data:${cand.artifact.mimeType};base64,${cand.artifact.imageBase64}`
          : schematicDataUrl,
        schematicDataUrl,
        preflightLabel: preflightLabelOf(cand),
        score: scoreView,
        reasons: valid ? [] : errors.length > 0 ? errors : cand.rejectedReason ? [cand.rejectedReason] : [],
        canApply,
        canApplyDeterministic,
        referenceIds: slot.referenceIds,
        layoutChecksLabel: concept ? `Deterministic layout checks: ${concept.spatialChecksPassed}/${concept.spatialChecksTotal} passed` : '',
      };
    });
}
