/**
 * Two-AI Generation Orchestrator — Master PRD & Implementation Directive.
 *
 * Implements the single canonical AI Generation Pipeline:
 *
 * USER INPUT
 *     ↓
 * GEMINI — REQUIREMENT UNDERSTANDING
 *     ↓
 * AiDesignSpec
 *     ↓
 * DETERMINISTIC FEASIBILITY (RequirementValidator)
 *     ↓ (If infeasible -> STOP, return structured error)
 * FLUX — CLOUDFLARE WORKERS AI (@cf/black-forest-labs/flux-2-klein-4b)
 *     ↓
 * RAW FLOOR-PLAN IMAGE (Persisted in ImageArtifactStore)
 *     ↓
 * GEMINI VISION — IMAGE INTERPRETATION (interpretPlanImageWithGemini)
 *     ↓
 * STRUCTURED PLAN
 *     ↓
 * DETERMINISTIC GEOMETRY & HARD VALIDATION (runExtractionPipeline)
 *     ↓ (If invalid -> REJECT, do not score or repair)
 * VALIDATED 2D PLAN
 *     ↓
 * GEMINI — ARCHITECTURAL EVALUATION (evaluatePlanArchitecturally)
 *     ↓
 * CANDIDATE WITH RAW IMAGE + VALIDATED 2D + GEMINI SCORE
 *
 * Phase 3 recovery (apartments): FLUX → apartment visual PREFLIGHT; a rejection
 * is NOT SCORED and triggers a bounded deterministic-seed retry. When all
 * attempts miss, the deterministic schematic becomes the authoritative base
 * plan (source: FALLBACK_DETERMINISTIC) — never presented as FLUX output.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type BaseAIProvider,
  compileFloorPlanImagePrompt,
  compileApartmentFloorPlanImagePrompt,
  checkApartmentCompleteness,
  validateApartmentFeasibility,
  getApartmentRulesProfile,
  generateDeterministicApartmentSchematic,
  type DeterministicApartmentSchematic,
  type ApartmentRulesProfile,
  APARTMENT_CONCEPT_STRATEGIES,
  type ApartmentConceptStrategy,
  type ApartmentLayoutStrategy,
  verifyImageQuality,
  runGeminiApartmentPreflight,
  type ApartmentVisualPreflightResult,
  evaluatePlanArchitecturally,
  interpretPlanImageWithGemini,
  AIOrchestrationService,
  ImageProviderError,
  type ImageGenerationProvider,
  type FloorPlanImagePromptRequest,
  type ArchitecturalEvaluationResult,
  type ApartmentBriefConfig,
  type ReferenceImageInput,
  buildApartmentGenerationManifest,
  validateSchematicMatchesManifest,
  type ApartmentGenerationManifest,
  renderSchematicPng512,
  resolveApartmentReferenceBucket,
  selectReferenceCandidates,
  finalizeReferenceSelection,
  type ReferenceSelectionDiagnostics,
  type ReferenceDropRecord,
  type AvailableReferenceFile,
  extractHttpStatus,
  isTransientHttpError,
  isAuthHttpError,
} from '@ai-floor-planner/ai-orchestration';
import {
  type Building,
  type DesignRequirementSpecification,
  Direction,
  createBuilding,
  normalizeDesignRequirementSpecification,
  type RequirementValidationResult,
} from '@ai-floor-planner/core';
import {
  RequirementValidator,
} from '@ai-floor-planner/planning-engine';
import type { ImageArtifactStore, StoredImageArtifact } from './image-artifact-store.js';
import { runExtractionPipeline } from './extraction-pipeline.js';
import { apartmentInterpretationContextFromManifest } from './apartment-structure.js';
import { synthesizeInterpretation } from './local-stub-plan-interpreter.js';
import {
  buildDeterministicFallbackImage,
  buildDeterministicFallbackPlan,
  FALLBACK_DETERMINISTIC_PROVIDER,
  FALLBACK_USER_MESSAGE,
  type CandidateSource,
  type CandidateVisualSource,
  type FallbackStructuralCounts,
} from './deterministic-fallback.js';

export interface GenerationOrchestratorSiteInput {
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly plannedFloorCount?: number;
  readonly roadFacing: Direction | string;
  readonly setbacks?: { front: number; rear: number; left: number; right: number };
  readonly orientation?: number;
}

export interface GenerationOrchestratorRoomCountsInput {
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly living?: number;
  readonly dining?: number;
  readonly kitchen?: number;
  readonly floors?: number;
  readonly balcony?: number;
}

export interface GenerationOrchestratorPreferencesInput {
  readonly vastu?: boolean;
  readonly garden?: boolean;
  readonly parking?: boolean;
  readonly fullPlotCoverage?: boolean;
}

export interface GenerationOrchestratorInput {
  readonly projectId: string;
  readonly projectName?: string;
  readonly site: GenerationOrchestratorSiteInput;
  readonly roomCounts?: GenerationOrchestratorRoomCountsInput;
  readonly preferences?: GenerationOrchestratorPreferencesInput;
  readonly additionalPrompt?: string;
  readonly seed?: number;
  readonly candidateCount?: number;
  readonly projectType?: 'apartment' | 'residential_independent';
  readonly apartmentConfig?: ApartmentBriefConfig;
}

function verifyReferencePngDimensions(buf: Buffer, filename: string): void {
  if (buf.length < 24) {
    throw new ImageProviderError('REFERENCE_FILE_READ_ERROR', `Invalid image file (too small): ${filename}`);
  }
  // Check PNG signature 0x89 0x50 0x4E 0x47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 512 || height > 512) {
      throw new ImageProviderError(
        'REFERENCE_RESIZE_ERROR',
        `Reference image ${filename} dimensions (${width}x${height}) exceed maximum 512x512 threshold.`,
      );
    }
  }
}

export interface LoadReferenceImagesOptions {
  readonly projectType?: 'apartment' | 'residential_independent';
  readonly flatsPerFloor?: number;
  readonly schematic?: DeterministicApartmentSchematic | string;
  readonly maxStyleReferences?: number;
  /**
   * Concept mode (0-based slot). Style references rotate deterministically so
   * every supplied reference is used across the four concepts; the schematic
   * is always input image 0.
   */
  readonly conceptSlot?: number;
  /** Style references allowed next to the schematic (FLUX Klein takes ≤ 4 input images). */
  readonly styleCapWithSchematic?: number;
}

/** FLUX Klein accepts at most four input images (schematic + three references). */
export const FLUX_MAX_INPUT_IMAGES = 4;

/**
 * User-supplied concept references (e.g. the four project reference plates).
 * Drop ≤ 512×512 PNGs here; they take precedence over the count bucket in concept mode.
 */
export const CONCEPT_REFERENCE_DIRS = [
  'packages/backend/data/reference-images/concept-references/normalized_512',
  'data/reference-images/concept-references/normalized_512',
] as const;

export interface LoadReferenceImagesResult {
  readonly referenceImages: ReferenceImageInput[];
  readonly diagnostics: ReferenceSelectionDiagnostics;
}

export async function loadApartmentReferenceImages(
  optionsOrSchematic?: LoadReferenceImagesOptions | DeterministicApartmentSchematic | string,
  maybeFlatsPerFloor?: number,
): Promise<LoadReferenceImagesResult & ReferenceImageInput[]> {
  let projectType: 'apartment' | 'residential_independent' = 'apartment';
  let flatsPerFloor: number | undefined;
  let schematic: DeterministicApartmentSchematic | string | undefined;
  let maxStyleReferences = 3;
  let conceptSlot: number | undefined;
  let styleCapWithSchematic = 2;

  if (optionsOrSchematic && typeof optionsOrSchematic === 'object' && ('projectType' in optionsOrSchematic || 'flatsPerFloor' in optionsOrSchematic || 'maxStyleReferences' in optionsOrSchematic)) {
    const opts = optionsOrSchematic as LoadReferenceImagesOptions;
    projectType = opts.projectType ?? 'apartment';
    flatsPerFloor = opts.flatsPerFloor;
    schematic = opts.schematic;
    maxStyleReferences = opts.maxStyleReferences ?? 3;
    conceptSlot = opts.conceptSlot;
    styleCapWithSchematic = Math.min(FLUX_MAX_INPUT_IMAGES - 1, Math.max(0, opts.styleCapWithSchematic ?? 2));
  } else if (optionsOrSchematic) {
    schematic = optionsOrSchematic as DeterministicApartmentSchematic | string;
    flatsPerFloor = maybeFlatsPerFloor ?? (typeof schematic === 'object' && 'flatCount' in schematic ? (schematic as any).flatCount : (typeof schematic === 'object' && 'units' in schematic ? (schematic as any).units.length : undefined));
    projectType = 'apartment';
  }

  // Count-matched reference bucket resolution (Phase 2 recovery, P6/P9, §9, §10, §11)
  const bucket = resolveApartmentReferenceBucket(projectType, flatsPerFloor);
  const results: ReferenceImageInput[] = [];
  const drops: ReferenceDropRecord[] = [];
  let requestedIds: string[] = [];
  let selectedIds: string[] = [];
  const attachedIds: string[] = [];

  // Primary structural reference: deterministic schematic scaffold (§6, §7, §8, §15)
  let schematicInput: ReferenceImageInput | null = null;
  if (schematic && typeof schematic === 'object') {
    try {
      const pngBuf = renderSchematicPng512(schematic);
      verifyReferencePngDimensions(pngBuf, 'schematic_scaffold.png');
      schematicInput = {
        id: 'schematic_scaffold',
        name: 'schematic_scaffold.png',
        base64Data: pngBuf.toString('base64'),
        mimeType: 'image/png',
      };
    } catch (err) {
      console.warn('[loadApartmentReferenceImages] Failed to render schematic PNG:', err);
    }
  } else if (typeof schematic === 'string' && schematic.trim().length > 0) {
    schematicInput = {
      id: 'schematic_scaffold',
      name: 'schematic_scaffold.svg',
      base64Data: Buffer.from(schematic, 'utf8').toString('base64'),
      mimeType: 'image/svg+xml',
    };
  }

  if (schematicInput) {
    results.push(schematicInput);
    attachedIds.push(schematicInput.id);
  }

  // Style references next to the schematic: 2 by default (total ≤ 3); concept mode
  // allows 3 so schematic + 3 references = FLUX Klein's 4-image maximum.
  const effectiveMaxStyle = schematicInput ? Math.min(styleCapWithSchematic, maxStyleReferences) : maxStyleReferences;

  if (bucket !== null) {
    const bucketDirs = [
      path.resolve(process.cwd(), `packages/backend/data/reference-images/buckets/${bucket}/normalized_512`),
      path.resolve(process.cwd(), `data/reference-images/buckets/${bucket}/normalized_512`),
      path.resolve(`packages/backend/data/reference-images/buckets/${bucket}/normalized_512`),
      path.resolve(`data/reference-images/buckets/${bucket}/normalized_512`),
    ];
    // Concept mode prefers the user's own reference plates when they are on disk.
    const conceptDirs = conceptSlot !== undefined
      ? CONCEPT_REFERENCE_DIRS.map(d => path.resolve(process.cwd(), d)).filter(d => {
          try {
            return fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.png'));
          } catch {
            return false;
          }
        })
      : [];
    const candidateDirs = [...conceptDirs, ...bucketDirs];
    let foundDir: string | null = null;
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        foundDir = dir;
        break;
      }
    }

    if (!foundDir) {
      drops.push({
        id: `bucket_${bucket}`,
        reason: `Reference bucket directory not found in candidate paths: ${candidateDirs.join(', ')}`,
      });
    } else {
      let pngFiles: string[] = [];
      try {
        const files = await fs.promises.readdir(foundDir);
        pngFiles = files.filter(f => f.endsWith('.png')).sort();
      } catch (err) {
        drops.push({
          id: `read_dir_${bucket}`,
          reason: `Failed to read reference directory ${foundDir}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const availableFiles: AvailableReferenceFile[] = pngFiles.map(file => ({
        id: path.basename(file, '.png'),
        name: file,
      }));

      // Deterministic candidate selection (Phase 2 recovery, §12). Concept mode
      // rotates the window by slot: with 4 references and 3 per request, each
      // concept drops a different one, so all four are used across the batch.
      let selected: readonly AvailableReferenceFile[];
      if (conceptSlot !== undefined && availableFiles.length > 0) {
        const n = availableFiles.length;
        const k = Math.min(effectiveMaxStyle, n);
        const start = ((conceptSlot % n) + n) % n;
        selected = Array.from({ length: k }, (_, j) => availableFiles[(start + j) % n]!);
        requestedIds = availableFiles.map(f => f.id);
      } else {
        const selection = selectReferenceCandidates(bucket, availableFiles, effectiveMaxStyle);
        requestedIds = [...selection.requestedIds];
        selected = selection.selected;
      }
      selectedIds = selected.map(s => s.id);

      for (const candidate of selected) {
        const fullPath = path.join(foundDir, candidate.name);
        try {
          const buf = await fs.promises.readFile(fullPath);
          verifyReferencePngDimensions(buf, candidate.name);
          results.push({
            id: candidate.id,
            name: candidate.name,
            base64Data: buf.toString('base64'),
            mimeType: 'image/png',
          });
          attachedIds.push(candidate.id);
        } catch (err) {
          drops.push({
            id: candidate.id,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Structured reference selection and drop diagnostics (Phase 2 recovery, §13)
  const diagnostics = finalizeReferenceSelection(
    bucket,
    requestedIds,
    selectedIds,
    attachedIds.filter(id => id !== 'schematic_scaffold'),
    drops,
  );

  return Object.assign([...results], {
    referenceImages: results,
    diagnostics,
  }) as LoadReferenceImagesResult & ReferenceImageInput[];
}

export interface ResumeInterpretationInput {
  readonly artifactId: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly requirements?: DesignRequirementSpecification;
  readonly isApartment?: boolean;
  readonly apartmentConfig?: ApartmentBriefConfig;
  readonly site?: GenerationOrchestratorSiteInput;
}

export type { CandidateSource, CandidateVisualSource };

/** Stage at which a candidate was rejected. VISUAL_PREFLIGHT rejections are NOT scored. */
export type CandidateRejectionStage = 'VISUAL_PREFLIGHT' | 'HARD_VALIDATION';

/**
 * Phase 3 recovery (report P4): bounded, deterministic visual retry.
 * Attempt 1 uses the slot seed; each retry adds a fixed prime offset
 * (attempt 2 keeps the historical §20 replacement seed = seed + 7919).
 * Same input ⇒ same seed sequence. Never random, never unbounded.
 */
export const DEFAULT_MAX_VISUAL_ATTEMPTS = 3;
export const VISUAL_RETRY_SEED_OFFSET = 7919;

export function deriveVisualAttemptSeed(slotSeed: number, attemptIndex: number): number {
  return (slotSeed + attemptIndex * VISUAL_RETRY_SEED_OFFSET) % 1_000_000;
}

export function resolveMaxVisualAttempts(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_MAX_VISUAL_ATTEMPTS;
  return Math.min(DEFAULT_MAX_VISUAL_ATTEMPTS, Math.max(1, Math.floor(requested)));
}

export interface OrchestratedCandidate {
  readonly id: string;
  readonly seed: number;
  readonly status: 'ACCEPTED' | 'REJECTED';
  /** FLUX = accepted/attempted visual came from FLUX; FALLBACK_DETERMINISTIC = deterministic base plan. */
  readonly source: CandidateSource;
  readonly visualSource: CandidateVisualSource;
  /** 1-based FLUX attempt number within its candidate slot (absent for the fallback). */
  readonly attempt?: number;
  /** Where the candidate was rejected; null when accepted. */
  readonly rejectionStage: CandidateRejectionStage | null;
  readonly building: Building | null;
  /** Pre-validated deterministic CAD building for this slot's schematic (always hard-valid). */
  readonly deterministicBuilding?: Building | null;
  readonly artifact: StoredImageArtifact;
  readonly validation: {
    readonly isValid: boolean;
    readonly recommendedForEditing: boolean;
    readonly geometryHealthy: boolean;
    /** Deterministic validation score; null whenever the candidate was not accepted (never a fake 0). */
    readonly overallScore: number | null;
    readonly verificationIssues: readonly { code: string; severity: string; message: string }[];
  };
  /** Real Gemini architectural evaluation (0–100, ADVISORY). null = NOT SCORED. */
  readonly evaluation: ArchitecturalEvaluationResult | null;
  /** Why the candidate is or is not scored (Phase 5). */
  readonly evaluationStatus: EvaluationStatus;
  /** Real per-stage state for THIS candidate (Phase 5 honest stage UX). */
  readonly stages: PipelineStagesState;
  readonly preflight?: ApartmentVisualPreflightResult;
  readonly diagnostics: readonly { code: string; severity: string; message: string }[];
  readonly rejectedReason: string | null;
  readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
  /**
   * Phase 4 apartment hard-validation stages. `source` is IMAGE_INTERPRETATION
   * for FLUX images and DETERMINISTIC_SCHEMATIC for the fallback (never mixed).
   */
  /** Present in apartment concept mode: which controlled strategy this candidate is. */
  readonly concept?: CandidateConceptInfo;
  readonly apartmentValidation?: {
    readonly source: 'IMAGE_INTERPRETATION' | 'DETERMINISTIC_SCHEMATIC';
    readonly stages: {
      readonly completeness: string;
      readonly manifestMatch: string;
      readonly structural: string;
      readonly canonicalGeometry: string;
      readonly geometryValidation: string;
    };
  };
}

/** Concept identity of a candidate slot (two-phase upgrade, apartment concept mode). */
export interface CandidateConceptInfo {
  readonly candidateNumber: number;
  readonly candidateCount: number;
  readonly strategy: ApartmentLayoutStrategy;
  readonly label: string;
  readonly intent: string;
  /** Deterministic slot seed (baseSeed + slot × 137). */
  readonly slotSeed: number;
  /** The deterministic schematic sent to FLUX as input image 1 (PNG, base64). */
  readonly schematicPngBase64: string;
  readonly spatialChecksPassed: number;
  readonly spatialChecksTotal: number;
  /** Style references attached next to the schematic. */
  readonly referenceIds: readonly string[];
  /** Validated canonical CAD building generated deterministically from this concept's schematic. */
  readonly deterministicBuilding?: Building | null;
}

/** Honest per-slot record: a failed FLUX call produces no candidate. */
export interface ConceptSlotRecord {
  readonly candidateNumber: number;
  readonly strategy: ApartmentLayoutStrategy;
  readonly label: string;
  readonly seed: number;
  readonly status: 'GENERATED' | 'GENERATION_FAILED';
  readonly candidateId: string | null;
  readonly referenceIds: readonly string[];
  readonly error?: string;
}

export interface DeterministicFallbackInfo {
  readonly used: boolean;
  readonly reason:
    | 'FLUX_PREFLIGHT_EXHAUSTED'
    | 'FLUX_PREFLIGHT_UNAVAILABLE'
    | 'FLUX_RETRY_TRANSPORT_FAILED'
    | 'FLUX_CANDIDATES_REJECTED';
  readonly message: string;
  readonly fluxAttempts: number;
  readonly maxVisualAttemptsPerCandidate: number;
  readonly rejectedCandidateIds: readonly string[];
  readonly rejectedArtifactIds: readonly string[];
  readonly fallbackCandidateId: string;
  readonly fallbackArtifactId: string;
  readonly measured: FallbackStructuralCounts;
  readonly required: FallbackStructuralCounts;
}

export interface GenerationOrchestratorError {
  readonly code:
    | 'REQUIREMENT_ERROR'
    | 'FEASIBILITY_ERROR'
    | 'APARTMENT_INCOMPLETE_BRIEF'
    | 'APARTMENT_NOT_FEASIBLE'
    | 'CLOUDFLARE_GENERATION_ERROR'
    | 'IMAGE_INTERPRETATION_ERROR'
    | 'EXTRACTION_ERROR'
    | 'GEOMETRY_VALIDATION_ERROR'
    | 'GEMINI_EVALUATION_ERROR'
    | 'VISUAL_PREFLIGHT_REJECTED'
    | 'PROVIDER_UNAVAILABLE';
  readonly stage: string;
  readonly message: string;
  readonly reasons?: readonly string[];
  readonly warnings?: readonly string[];
  readonly conflicts?: readonly unknown[];
  readonly questions?: readonly unknown[];
  readonly missingFields?: readonly string[];
  readonly fallbackAvailable?: boolean;
  readonly artifactId?: string;
  readonly artifact?: StoredImageArtifact;
  readonly isTransient?: boolean;
}

export interface PipelineStagesState {
  /** EXHAUSTED = every bounded FLUX attempt was rejected at the visual gate. */
  imageGeneration: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'EXHAUSTED';
  imageArtifact: 'PENDING' | 'AVAILABLE' | 'FAILED';
  /** Gemini apartment visual preflight (apartment + Gemini only). */
  visualPreflight: 'PENDING' | 'RUNNING' | 'PASSED' | 'REJECTED' | 'UNAVAILABLE' | 'SKIPPED';
  imageInterpretation: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TEMPORARILY_UNAVAILABLE' | 'AUTH_ERROR' | 'SKIPPED';
  /** SKIPPED = never built (an earlier gate rejected the candidate). */
  imageTo2D: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  validation: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  /** SKIPPED = not run (invalid plan or not configured); FAILED = evaluation call failed. */
  geminiEvaluation: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'SKIPPED' | 'FAILED';
}

/**
 * Phase 5: why a candidate does or does not carry an advisory score.
 * The numeric score exists ONLY for SCORED.
 */
export type EvaluationStatus =
  | 'SCORED'
  | 'NOT_SCORED_REJECTED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE';

export interface GatedEvaluationResult {
  readonly evaluation: ArchitecturalEvaluationResult | null;
  readonly status: EvaluationStatus;
  readonly stage: PipelineStagesState['geminiEvaluation'];
  readonly error?: string;
}

/**
 * Phase 5 evaluation gate: `evaluatePlanArchitecturally` is reachable ONLY for a
 * plan that passed hard validation. A rejected plan is never scored, and a
 * failed evaluation call is reported as UNAVAILABLE (never as a score).
 */
export async function evaluateIfHardValid(
  gemini: BaseAIProvider | null,
  hardValid: boolean,
  options: Parameters<typeof evaluatePlanArchitecturally>[1],
): Promise<GatedEvaluationResult> {
  if (!hardValid) return { evaluation: null, status: 'NOT_SCORED_REJECTED', stage: 'SKIPPED' };
  if (!gemini || !(await gemini.isAvailable())) return { evaluation: null, status: 'NOT_CONFIGURED', stage: 'SKIPPED' };
  try {
    const evaluation = await evaluatePlanArchitecturally(gemini, options);
    return { evaluation, status: 'SCORED', stage: 'SUCCESS' };
  } catch (err) {
    return {
      evaluation: null,
      status: 'UNAVAILABLE',
      stage: 'FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface GenerationOrchestratorResult {
  readonly success: boolean;
  readonly projectId: string;
  readonly requirements: DesignRequirementSpecification;
  readonly feasibility: RequirementValidationResult;
  readonly candidates: readonly OrchestratedCandidate[];
  readonly latencyMs: number;
  readonly stages?: PipelineStagesState;
  readonly error?: GenerationOrchestratorError;
  readonly savedArtifact?: StoredImageArtifact;
  readonly apartmentSchematic?: DeterministicApartmentSchematic;
  readonly apartmentRulesProfile?: ApartmentRulesProfile;
  readonly apartmentManifest?: ApartmentGenerationManifest;
  /** Source of the authoritative accepted candidate; null when nothing was accepted. */
  readonly candidateSource?: CandidateSource | null;
  /** Present when the deterministic fallback was exercised. */
  readonly fallback?: DeterministicFallbackInfo;
  /** Apartment concept mode: up to four controlled strategy candidates. */
  readonly conceptMode?: boolean;
  readonly conceptSlots?: readonly ConceptSlotRecord[];
  /** Deterministic FLUX attempt bookkeeping (bounded retry). */
  readonly visualAttempts?: {
    readonly maxPerCandidate: number;
    readonly attempted: number;
    readonly seeds: readonly number[];
  };
}

export interface GenerationOrchestratorDeps {
  readonly provider: ImageGenerationProvider | null;
  readonly store: ImageArtifactStore;
  readonly gemini: BaseAIProvider | null;
  readonly interpreterKind: 'gemini' | 'local-stub';
  /** Bounded FLUX attempts per candidate slot when visual preflight rejects (1–3, default 3). */
  readonly maxVisualAttempts?: number;
}

function resolveDirection(dir: Direction | string): Direction {
  const norm = String(dir).toLowerCase();
  if (norm === 'south') return Direction.South;
  if (norm === 'east') return Direction.East;
  if (norm === 'west') return Direction.West;
  return Direction.North;
}

export class GenerationOrchestrator {
  constructor(private readonly deps: GenerationOrchestratorDeps) {}

  async run(input: GenerationOrchestratorInput): Promise<GenerationOrchestratorResult> {
    const startedAt = Date.now();
    const projectId = input.projectId.trim() || 'project-generation';
    const projectName = input.projectName?.trim() || projectId;
    const roadFacing = resolveDirection(input.site.roadFacing);

    const isApartment = input.projectType === 'apartment' || Boolean(input.apartmentConfig);

    const stages: PipelineStagesState = {
      imageGeneration: 'PENDING',
      imageArtifact: 'PENDING',
      visualPreflight: 'PENDING',
      imageInterpretation: 'PENDING',
      imageTo2D: 'PENDING',
      validation: 'PENDING',
      geminiEvaluation: 'PENDING',
    };

    const rawWidth = input.site.plotWidth;
    const rawDepth = input.site.plotDepth;
    const plotWidthMm = rawWidth < 150 ? Math.round(rawWidth * 1000) : Math.round(rawWidth);
    const plotDepthMm = rawDepth < 150 ? Math.round(rawDepth * 1000) : Math.round(rawDepth);
    const siteWidthM = plotWidthMm / 1000;
    const siteDepthM = plotDepthMm / 1000;

    const setbacksMm = input.site.setbacks ? {
      front: input.site.setbacks.front < 100 ? Math.round(input.site.setbacks.front * 1000) : Math.round(input.site.setbacks.front),
      rear: input.site.setbacks.rear < 100 ? Math.round(input.site.setbacks.rear * 1000) : Math.round(input.site.setbacks.rear),
      left: input.site.setbacks.left < 100 ? Math.round(input.site.setbacks.left * 1000) : Math.round(input.site.setbacks.left),
      right: input.site.setbacks.right < 100 ? Math.round(input.site.setbacks.right * 1000) : Math.round(input.site.setbacks.right),
    } : undefined;

    const setbacksM = setbacksMm ? {
      front: setbacksMm.front / 1000,
      rear: setbacksMm.rear / 1000,
      left: setbacksMm.left / 1000,
      right: setbacksMm.right / 1000,
    } : undefined;

    // ─── APARTMENT MODE: INFORMATION COMPLETENESS & FEASIBILITY GATES (§4, §11, §37, §48)
    if (isApartment) {
      // 1. Completeness Check
      const completeness = checkApartmentCompleteness(input.apartmentConfig);
      if (!completeness.isComplete) {
        return {
          success: false,
          projectId,
          requirements: null as any,
          feasibility: null as any,
          candidates: [],
          latencyMs: Date.now() - startedAt,
          error: {
            code: 'APARTMENT_INCOMPLETE_BRIEF',
            stage: 'completeness',
            message: 'Apartment brief requires additional details before generation can proceed.',
            reasons: completeness.missingFields.map(f => `Missing required field: ${f}`),
            conflicts: completeness.questions as any,
            fallbackAvailable: false,
          },
        };
      }

      // 2. Deterministic Apartment Feasibility Check
      const aptFeasibility = validateApartmentFeasibility(
        {
          plotWidthMm,
          plotDepthMm,
          setbacksMm,
        },
        input.apartmentConfig!,
      );

      if (!aptFeasibility.feasible) {
        const errorIssues = aptFeasibility.conflicts.filter(c => c.severity === 'error');
        const warningIssues = aptFeasibility.conflicts.filter(c => c.severity === 'warning');

        return {
          success: false,
          projectId,
          requirements: null as any,
          feasibility: aptFeasibility as any,
          candidates: [],
          latencyMs: Date.now() - startedAt,
          error: {
            code: 'APARTMENT_NOT_FEASIBLE',
            stage: 'feasibility',
            message: errorIssues[0]?.message ?? 'Apartment configuration cannot be accommodated on this site.',
            reasons: errorIssues.map(i => i.message),
            warnings: warningIssues.map(i => i.message),
            conflicts: aptFeasibility.conflicts as any,
            fallbackAvailable: false,
          },
        };
      }
    }

    let apartmentSchematic: DeterministicApartmentSchematic | undefined;
    let apartmentRulesProfile: ApartmentRulesProfile | undefined;

    // ─── CONCEPT MODE (two-phase upgrade) ─────────────────────────────────────
    // Apartments: up to FOUR controlled strategy candidates (balanced, daylight,
    // privacy, circulation), each with its own deterministic schematic. All share
    // identical hard requirements; only the organisation strategy differs.
    // Villas keep the historical 1–3 candidate batch.
    const candidateTargetCount = isApartment
      ? Math.min(Math.max(1, input.candidateCount ?? 1), APARTMENT_CONCEPT_STRATEGIES.length)
      : Math.min(Math.max(1, input.candidateCount ?? 1), 3);
    const conceptMode = isApartment && candidateTargetCount > 1;
    let conceptSchematics: Array<{ strategy: ApartmentConceptStrategy; schematic: DeterministicApartmentSchematic }> = [];

    if (isApartment && input.apartmentConfig) {
      apartmentRulesProfile = getApartmentRulesProfile(input.apartmentConfig.jurisdiction || 'pune_pmc', {
        floorCount: input.apartmentConfig.floorCount,
        buildingHeightM: (input.apartmentConfig.floorCount || 4) * 3.1,
        tenementsPerFloor: input.apartmentConfig.flatsPerFloor,
      });

      const strategies = APARTMENT_CONCEPT_STRATEGIES.slice(0, conceptMode ? candidateTargetCount : 1);
      conceptSchematics = strategies.map(strategy => ({
        strategy,
        schematic: generateDeterministicApartmentSchematic({
          siteWidthM,
          siteDepthM,
          setbacksM,
          flatsPerFloor: input.apartmentConfig!.flatsPerFloor,
          unitMix: input.apartmentConfig!.unitMix,
          commonCoreConfig: input.apartmentConfig!.commonCore,
          floorType: input.apartmentConfig!.floorStrategy,
          rulesProfile: apartmentRulesProfile!,
          strategy: strategy.id,
        }),
      }));
      // Candidate 01 (balanced) is the reference schematic and the deterministic fallback.
      apartmentSchematic = conceptSchematics[0]!.schematic;
    }

    const rc = input.roomCounts ?? {
      bedrooms: input.apartmentConfig?.unitMix?.reduce((acc, u) => acc + (u.count * (parseInt(u.unitType, 10) || 2)), 0) ?? 3,
      bathrooms: 2,
      living: 1,
      dining: 1,
      kitchen: 1,
      floors: input.apartmentConfig?.floorCount ?? 1,
      balcony: 1,
    };

    // ─── PIPELINE STEP 1: REQUIREMENT UNDERSTANDING ─────────────────────────────
    let spec = normalizeDesignRequirementSpecification({
      projectId,
      projectName,
      hard: {
        plotWidthMm,
        plotDepthMm,
        roadFacing,
        floorsCount: Math.max(1, rc.floors || 1),
        bedroomCount: rc.bedrooms,
        bathroomCount: rc.bathrooms,
        livingRoomRequired: (rc.living ?? 1) > 0,
        kitchenRequired: (rc.kitchen ?? 1) > 0,
        diningRoomRequired: (rc.dining ?? 1) > 0,
        parkingRequired: input.preferences?.parking ?? (!input.preferences?.fullPlotCoverage),
        parkingSpacesCount: (input.preferences?.parking ?? (!input.preferences?.fullPlotCoverage)) ? 1 : 0,
        fullPlotCoverage: input.preferences?.fullPlotCoverage ?? false,
        staircaseRequired: (rc.floors || 1) > 1,
      },
      soft: {
        balconyPreferred: (rc.balcony ?? 0) > 0,
        vastuCompliance: input.preferences?.vastu ?? false,
        gardenPreference: input.preferences?.garden ?? false,
      },
      orientationDegrees: input.site.orientation ?? 0,
      setbacksMm: input.preferences?.fullPlotCoverage
        ? { front: 0, rear: 0, left: 0, right: 0 }
        : (input.site.setbacks ?? { front: 1500, rear: 1000, left: 1000, right: 1000 }),
      rawUserPrompt: input.additionalPrompt,
    });

    // If natural-language prompt provided, refine via Gemini requirement service if available
    if (input.additionalPrompt?.trim() && this.deps.gemini && !isApartment) {
      try {
        const service = new AIOrchestrationService(this.deps.gemini, { providerTimeoutMs: 12000 });
        const parsed = await service.parseRequirementsDetailed(input.additionalPrompt);
        if (parsed.requirements) {
          spec = normalizeDesignRequirementSpecification({
            ...spec,
            hard: {
              ...spec.hard,
              bedroomCount: parsed.requirements.hard.bedroomCount > 0 ? parsed.requirements.hard.bedroomCount : spec.hard.bedroomCount,
              bathroomCount: parsed.requirements.hard.bathroomCount > 0 ? parsed.requirements.hard.bathroomCount : spec.hard.bathroomCount,
            },
            soft: {
              ...spec.soft,
              vastuCompliance: parsed.requirements.soft.vastuCompliance ?? spec.soft.vastuCompliance,
              gardenPreference: parsed.requirements.soft.gardenPreference ?? spec.soft.gardenPreference,
            },
            rawUserPrompt: input.additionalPrompt,
          });
        }
      } catch {
        // Safe fallback: preserve constructed base specification
      }
    }

    // ─── PIPELINE STEP 2: DETERMINISTIC FEASIBILITY GATE ─────────────────────────
    const validator = new RequirementValidator();
    const feasibility = validator.validate(spec);

    let apartmentManifest: ApartmentGenerationManifest | undefined;

    if (isApartment && input.apartmentConfig && apartmentSchematic) {
      apartmentManifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: spec.hard.plotWidthMm,
          plotDepthMm: spec.hard.plotDepthMm,
          setbacksMm: spec.setbacksMm ?? { front: 3000, rear: 2000, left: 2000, right: 2000 },
          roadFacing: input.site.roadFacing,
          orientationDegrees: spec.orientationDegrees,
        },
        apartmentConfig: input.apartmentConfig,
        rulesProfile: apartmentRulesProfile,
        currentFloorIndex: 1,
      });

      // §8: EVERY concept schematic must match the manifest (counts, programme,
      // apartment logic, area balance) before FLUX is called. Nothing is repaired.
      const failedConcepts = conceptSchematics
        .map(c => ({ ...c, check: validateSchematicMatchesManifest(c.schematic, apartmentManifest!) }))
        .filter(c => !c.check.matches);
      if (failedConcepts.length > 0) {
        const feasibilityFail = failedConcepts.some(c => c.check.feasibilityFail);
        const reasons = failedConcepts.flatMap(c =>
          c.check.discrepancies.map(d => `Candidate ${String(c.strategy.candidateNumber).padStart(2, '0')} (${c.strategy.label}): ${d}`),
        );
        return {
          success: false,
          projectId,
          requirements: spec,
          feasibility,
          candidates: [],
          latencyMs: Date.now() - startedAt,
          apartmentSchematic,
          apartmentRulesProfile,
          apartmentManifest,
          error: feasibilityFail
            ? {
                code: 'APARTMENT_NOT_FEASIBLE',
                stage: 'feasibility',
                message: `FEASIBILITY FAIL: ${reasons[0] ?? 'the programme does not fit the buildable envelope.'}`,
                reasons,
                fallbackAvailable: false,
              }
            : {
                code: 'REQUIREMENT_ERROR',
                stage: 'schematic_validation',
                message: `Deterministic schematic does not match generation manifest: ${reasons.join('; ')}`,
                reasons,
              },
        };
      }
    }

    if (!isApartment && !feasibility.isFeasible) {
      const errorIssues = feasibility.issues.filter(i => i.severity === 'error');
      const warningIssues = feasibility.issues.filter(i => i.severity === 'warning');

      return {
        success: false,
        projectId,
        requirements: spec,
        feasibility,
        candidates: [],
        latencyMs: Date.now() - startedAt,
        error: {
          code: 'FEASIBILITY_ERROR',
          stage: 'feasibility',
          message: errorIssues[0]?.message ?? 'Requested room program is not feasible within plot boundaries.',
          reasons: errorIssues.map(i => i.message),
          warnings: warningIssues.map(i => i.message),
          conflicts: feasibility.issues,
          fallbackAvailable: false,
        },
      };
    }

    // ─── CHECK PROVIDER AVAILABILITY BEFORE BATCH GENERATION ────────────────────
    if (!this.deps.provider || !(await this.deps.provider.isAvailable())) {
      stages.imageGeneration = 'FAILED';
      stages.imageArtifact = 'FAILED';
      return {
        success: false,
        projectId,
        requirements: spec,
        feasibility,
        candidates: [],
        latencyMs: Date.now() - startedAt,
        stages,
        error: {
          code: 'CLOUDFLARE_GENERATION_ERROR',
          stage: 'image_generation',
          message: 'Cloudflare image generation is not configured on this server (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing). Try deterministic planner instead.',
          fallbackAvailable: true,
        },
      };
    }

    // ─── BATCH CANDIDATE GENERATION (apartments: ≤ 4 concepts; villas: ≤ 3) ─────
    const baseSeed = input.seed ?? 42;
    const buildingSite = createBuilding({
      projectId,
      name: projectName,
      site: {
        plotWidth: spec.hard.plotWidthMm,
        plotDepth: spec.hard.plotDepthMm,
        plannedFloorCount: spec.hard.floorsCount,
        roadFacing: spec.hard.roadFacing,
        setbacks: spec.setbacksMm ?? { front: 1500, rear: 1000, left: 1000, right: 1000 },
        orientation: spec.orientationDegrees,
      },
      floors: [{ buildingId: projectId, level: 0 }],
    }).site;

    const candidates: OrchestratedCandidate[] = [];

    // ─── PHASE 3: BOUNDED, DETERMINISTIC VISUAL RETRY ──────────────────────────
    // FLUX → PREFLIGHT → (fail) → next deterministic seed → FLUX → PREFLIGHT …
    // Only the seed changes between attempts; requirements, manifest, schematic,
    // unit mix, lifts, stairs and site are identical for every attempt.
    const maxVisualAttempts = resolveMaxVisualAttempts(this.deps.maxVisualAttempts);
    const preflightApplies = Boolean(
      isApartment && input.apartmentConfig && this.deps.interpreterKind === 'gemini' && this.deps.gemini,
    );
    if (!preflightApplies) stages.visualPreflight = 'SKIPPED';
    const attemptSeeds: number[] = [];
    let preflightUnavailable = false;
    let fluxRetryTransportError: string | undefined;
    const conceptSlots: ConceptSlotRecord[] = [];

    slotLoop:
    for (let cIdx = 0; cIdx < candidateTargetCount; cIdx++) {
      const slotSeed = (baseSeed + cIdx * 137) % 1_000_000;
      // Concept mode: ONE FLUX attempt per strategy slot (the four strategies are the
      // controlled variation); single-candidate mode keeps the Phase 3 bounded retry.
      const attemptsForSlot = conceptMode ? 1 : preflightApplies ? maxVisualAttempts : 1;
      const slotConcept = conceptMode ? conceptSchematics[cIdx] : undefined;
      const slotSchematic = slotConcept?.schematic ?? apartmentSchematic;
      let slotReferenceIds: string[] = [];
      let slotDeterministicBuilding: Building | null = null;
      if (slotConcept && apartmentManifest) {
        try {
          const detPlan = buildDeterministicFallbackPlan({
            schematic: slotConcept.schematic,
            manifest: apartmentManifest,
            requirements: spec,
            projectId,
            projectName,
          });
          slotDeterministicBuilding = detPlan.building;
        } catch (detErr) {
          console.warn('[GenerationOrchestrator] Could not build deterministic fallback for concept slot:', detErr);
        }
      }
      const conceptInfo = (): CandidateConceptInfo | undefined =>
        slotConcept
          ? {
              candidateNumber: slotConcept.strategy.candidateNumber,
              candidateCount: candidateTargetCount,
              strategy: slotConcept.strategy.id,
              label: slotConcept.strategy.label,
              intent: slotConcept.strategy.intent,
              slotSeed,
              schematicPngBase64: renderSchematicPng512(slotConcept.schematic).toString('base64'),
              spatialChecksPassed: slotConcept.schematic.spatialChecks.filter(c => c.status === 'PASS').length,
              spatialChecksTotal: slotConcept.schematic.spatialChecks.length,
              referenceIds: slotReferenceIds,
              deterministicBuilding: slotDeterministicBuilding,
            }
          : undefined;
      const recordSlot = (status: ConceptSlotRecord['status'], candidateId: string | null, error?: string) => {
        if (!slotConcept) return;
        conceptSlots.push({
          candidateNumber: slotConcept.strategy.candidateNumber,
          strategy: slotConcept.strategy.id,
          label: slotConcept.strategy.label,
          seed: slotSeed,
          status,
          candidateId,
          referenceIds: slotReferenceIds,
          ...(error !== undefined ? { error } : {}),
        });
      };
      let acceptedAttempt: {
        readonly seed: number;
        readonly attempt: number;
        readonly promptRequest: FloorPlanImagePromptRequest;
        readonly generatedImage: Awaited<ReturnType<ImageGenerationProvider['generateFloorPlan']>>;
        readonly artifact: StoredImageArtifact;
        readonly preflight: ApartmentVisualPreflightResult | undefined;
      } | null = null;

      for (let attemptIdx = 0; attemptIdx < attemptsForSlot; attemptIdx++) {
      const seed = deriveVisualAttemptSeed(slotSeed, attemptIdx);
      const attemptNumber = attemptIdx + 1;
      attemptSeeds.push(seed);

      // ─── PIPELINE STEP 3: IMAGE PROMPT COMPILATION ────────────────────────────
      let promptRequest: FloorPlanImagePromptRequest;

      if (isApartment && input.apartmentConfig) {
        let referenceImages: ReferenceImageInput[] = [];
        let refDiagnostics: ReferenceSelectionDiagnostics | undefined;
        try {
          const refResult = await loadApartmentReferenceImages({
            projectType: 'apartment',
            flatsPerFloor: input.apartmentConfig.flatsPerFloor,
            schematic: slotSchematic,
            ...(conceptMode ? { conceptSlot: cIdx, styleCapWithSchematic: FLUX_MAX_INPUT_IMAGES - 1 } : {}),
          });
          referenceImages = refResult.referenceImages;
          refDiagnostics = refResult.diagnostics;
          slotReferenceIds = referenceImages.map(r => r.id).filter(id => id !== 'schematic_scaffold');
        } catch (refErr) {
          if (refErr instanceof ImageProviderError) {
            return {
              success: false,
              projectId,
              requirements: spec,
              feasibility,
              candidates,
              latencyMs: Date.now() - startedAt,
              apartmentSchematic,
              apartmentRulesProfile,
              apartmentManifest,
              stages,
              error: {
                code: (refErr.code as any) || 'CLOUDFLARE_GENERATION_ERROR',
                stage: 'reference_preparation',
                message: `Reference preparation failure: ${refErr.message}`,
                fallbackAvailable: false,
              },
            };
          }
          throw refErr;
        }
        promptRequest = compileApartmentFloorPlanImagePrompt({
          projectId,
          projectName,
          site: buildingSite,
          apartmentConfig: input.apartmentConfig,
          manifest: apartmentManifest,
          additionalPrompt: input.additionalPrompt,
          seed,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
          referenceDiagnostics: refDiagnostics,
          ...(slotConcept
            ? {
                concept: {
                  candidateNumber: slotConcept.strategy.candidateNumber,
                  candidateCount: candidateTargetCount,
                  label: slotConcept.strategy.label,
                  intent: slotConcept.strategy.intent,
                },
              }
            : {}),
        });
      } else {
        // Villa compiler: count-matched 'villa' reference bucket + aspect adaptation + compact prompt
        let referenceImages: ReferenceImageInput[] = [];
        let refDiagnostics: ReferenceSelectionDiagnostics | undefined;
        try {
          const refResult = await loadApartmentReferenceImages({
            projectType: 'residential_independent',
          });
          referenceImages = refResult.referenceImages;
          refDiagnostics = refResult.diagnostics;
        } catch (refErr) {
          console.warn('[GenerationOrchestrator] Villa reference loading error:', refErr);
        }

        promptRequest = compileFloorPlanImagePrompt({
          requirements: spec,
          site: buildingSite,
          seed,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
          referenceDiagnostics: refDiagnostics,
        });
      }

      // ─── PIPELINE STEP 4: CLOUDFLARE FLUX CALL ────────────────────────────────
      stages.imageGeneration = 'RUNNING';
      let generatedImage;
      try {
        generatedImage = await this.deps.provider.generateFloorPlan(promptRequest);
        stages.imageGeneration = 'SUCCESS';
      } catch (err) {
        if (conceptMode) {
          // One concept's FLUX call failed: record it honestly and continue with the
          // remaining strategies (no image ⇒ no candidate, never a fake one).
          const message = err instanceof Error ? err.message : String(err);
          stages.imageGeneration = 'FAILED';
          console.warn(`[GenerationOrchestrator] Concept ${cIdx + 1} (${slotConcept?.strategy.id}) FLUX call failed: ${message}`);
          recordSlot('GENERATION_FAILED', null, message);
          continue slotLoop;
        }
        if (isApartment && apartmentSchematic && apartmentManifest && candidates.length > 0) {
          // A retry FLUX call failed after an earlier attempt already missed the
          // visual gate: end the bounded retry and let the deterministic
          // fallback guarantee a correct plan. Earlier FLUX artifacts stay intact.
          fluxRetryTransportError = err instanceof Error ? err.message : String(err);
          stages.imageGeneration = 'FAILED';
          console.warn(`[GenerationOrchestrator] FLUX retry attempt ${attemptNumber} failed: ${fluxRetryTransportError}. Ending bounded retry.`);
          break slotLoop;
        }
        stages.imageGeneration = 'FAILED';
        stages.imageArtifact = 'FAILED';
        if (err instanceof ImageProviderError) {
          const isRefError = err.code.startsWith('REFERENCE');
          return {
            success: false,
            projectId,
            requirements: spec,
            feasibility,
            candidates,
            latencyMs: Date.now() - startedAt,
            stages,
            error: {
              code: (isRefError ? err.code : 'CLOUDFLARE_GENERATION_ERROR') as any,
              stage: isRefError ? 'reference_preparation' : 'image_generation',
              message: isRefError ? `Reference asset error: ${err.message}` : `Cloudflare FLUX image generation failed: ${err.message}`,
              fallbackAvailable: true,
            },
          };
        }
        return {
          success: false,
          projectId,
          requirements: spec,
          feasibility,
          candidates,
          latencyMs: Date.now() - startedAt,
          stages,
          error: {
            code: 'CLOUDFLARE_GENERATION_ERROR',
            stage: 'image_generation',
            message: err instanceof Error ? err.message : 'Unexpected image generation failure.',
            fallbackAvailable: true,
          },
        };
      }

      // ─── PIPELINE STEP 4.5: IMAGE QUALITY GATE (§40) ──────────────────────────
      try {
        const imageBytes = Buffer.from(generatedImage.imageBase64, 'base64');
        const quality = verifyImageQuality(imageBytes);
        if (!quality.valid) {
          console.warn(`[GenerationOrchestrator] Image failed quality gate: ${quality.reason}. Regenerating with seed ${seed + 1}...`);
          const retryPrompt = { ...promptRequest, seed: seed + 1 };
          generatedImage = await this.deps.provider.generateFloorPlan(retryPrompt);
          // Keep persisted provenance consistent with the image actually produced.
          promptRequest = retryPrompt;
        }
      } catch (qErr) {
        console.warn('[GenerationOrchestrator] Image quality verification warning:', qErr);
      }

      // ─── PIPELINE STEP 4.8: GEMINI VISUAL PREFLIGHT GATE (§28, §29, §30) ──────
      let apartmentPreflightResult: ApartmentVisualPreflightResult | undefined;
      let expectedBrief: { flatsPerFloor: number; unitMix: ReadonlyArray<{ unitType: string; count: number }>; liftCount: number; stairCount: number; commonCoreRequired: boolean } | undefined;

      let preflightError: string | undefined;

      if (preflightApplies && input.apartmentConfig && this.deps.gemini) {
        stages.visualPreflight = 'RUNNING';
        try {
          expectedBrief = apartmentManifest
            ? {
                flatsPerFloor: apartmentManifest.units.exactCount,
                unitMix: input.apartmentConfig.unitMix,
                liftCount: apartmentManifest.commonCore.lifts,
                stairCount: apartmentManifest.commonCore.stairs,
                commonCoreRequired: true,
              }
            : {
                flatsPerFloor: input.apartmentConfig.flatsPerFloor,
                unitMix: input.apartmentConfig.unitMix,
                liftCount: input.apartmentConfig.commonCore.passengerLifts,
                stairCount: Math.max(1, input.apartmentConfig.commonCore.staircaseCount),
                commonCoreRequired: true,
              };

          apartmentPreflightResult = await runGeminiApartmentPreflight(
            this.deps.gemini,
            generatedImage.imageBase64,
            expectedBrief,
            generatedImage.mimeType,
          );
          if (!apartmentPreflightResult.pass) {
            console.warn(`[GenerationOrchestrator] Gemini visual preflight rejection: ${apartmentPreflightResult.matchingSummary}`);
          }
        } catch (pfErr) {
          // Honest gate: a preflight that could not run is NOT a pass. The FLUX
          // image stays unverified and cannot become the authoritative plan.
          preflightError = pfErr instanceof Error ? pfErr.message : String(pfErr);
          console.warn('[GenerationOrchestrator] Visual preflight could not be completed:', preflightError);
        }
      }

      // ─── PIPELINE STEP 5: IMMUTABLE IMAGE ARTIFACT PERSISTENCE ────────────────
      // Every FLUX attempt (accepted or rejected) is persisted and never overwritten.
      const artifact = await this.deps.store.save(projectId, generatedImage, promptRequest);
      stages.imageArtifact = 'AVAILABLE';

      // ─── PIPELINE STEP 5.5: VISUAL ACCEPTANCE GATE (§20, §28 & §30) ──────────
      // A visually rejected candidate is NOT SCORED: no interpretation, no hard
      // validation, no architectural evaluation and no numeric score (never "0").
      const preflightRejected = Boolean(apartmentPreflightResult && !apartmentPreflightResult.pass);
      if (preflightRejected || preflightError !== undefined) {
        const reasons = preflightRejected
          ? [...apartmentPreflightResult!.failureReasons]
          : [`Visual preflight could not be completed: ${preflightError}`];
        const summary = preflightRejected
          ? apartmentPreflightResult!.matchingSummary
          : `Visual preflight unavailable: ${preflightError}`;
        stages.visualPreflight = preflightRejected ? 'REJECTED' : 'UNAVAILABLE';
        console.warn(
          `[GenerationOrchestrator] FLUX attempt ${attemptNumber}/${attemptsForSlot} (seed ${seed}) rejected at visual preflight: ${summary}`,
        );

        const preflightRefDiag = generatedImage.referenceDiagnostics ?? promptRequest.referenceDiagnostics;
        candidates.push({
          id: `cand_two_ai_${seed}_${cIdx}`,
          seed,
          status: 'REJECTED',
          source: 'FLUX',
          visualSource: 'FLUX_IMAGE',
          attempt: attemptNumber,
          rejectionStage: 'VISUAL_PREFLIGHT',
          // Rejected at the visual gate: nothing after preflight ran for this candidate.
          evaluationStatus: 'NOT_SCORED_REJECTED',
          stages: {
            imageGeneration: 'SUCCESS',
            imageArtifact: 'AVAILABLE',
            visualPreflight: preflightRejected ? 'REJECTED' : 'UNAVAILABLE',
            imageInterpretation: 'SKIPPED',
            imageTo2D: 'SKIPPED',
            validation: 'SKIPPED',
            geminiEvaluation: 'SKIPPED',
          },
          building: null,
          deterministicBuilding: slotDeterministicBuilding,
          artifact,
          validation: {
            isValid: false,
            recommendedForEditing: false,
            geometryHealthy: false,
            overallScore: null,
            verificationIssues: reasons.map(r => ({ code: 'VISUAL_PREFLIGHT_FAIL', severity: 'error', message: r })),
          },
          evaluation: null,
          ...(apartmentPreflightResult ? { preflight: apartmentPreflightResult } : {}),
          diagnostics: [
            {
              code: preflightRejected ? 'VISUAL_PREFLIGHT_FAIL' : 'VISUAL_PREFLIGHT_UNAVAILABLE',
              severity: 'error',
              message: summary,
            },
            ...(preflightRefDiag && preflightRefDiag.drops.length > 0 ? [{
              code: 'REFERENCE_IMAGES_DROPPED',
              severity: 'warning',
              message: `Reference images dropped: ${preflightRefDiag.drops.map(d => `${d.id} (${d.reason})`).join(', ')}`,
            }] : []),
          ],
          rejectedReason: `Rejected at visual preflight: ${reasons.join('; ')}`,
          referenceDiagnostics: preflightRefDiag,
          ...(slotConcept ? { concept: conceptInfo()! } : {}),
        });
        recordSlot('GENERATED', `cand_two_ai_${seed}_${cIdx}`);

        if (!preflightRejected) {
          // A preflight outage is not seed-dependent: stop spending retry attempts.
          // Concept mode still renders the remaining strategies (each is its own design).
          preflightUnavailable = true;
          if (conceptMode) continue slotLoop;
          break slotLoop;
        }
        continue; // bounded retry with the next deterministic seed
      }

      if (preflightApplies) stages.visualPreflight = 'PASSED';
      acceptedAttempt = {
        seed,
        attempt: attemptNumber,
        promptRequest,
        generatedImage,
        artifact,
        preflight: apartmentPreflightResult,
      };
      break;
      } // end bounded FLUX attempt loop

      if (!acceptedAttempt) {
        // Every bounded attempt for this slot was rejected at the visual gate.
        continue;
      }

      const { seed, promptRequest, generatedImage, artifact } = acceptedAttempt;
      const apartmentPreflightResult = acceptedAttempt.preflight;

      // ─── PIPELINE STEP 6: GEMINI VISION PLAN INTERPRETATION ───────────────────
      stages.imageInterpretation = 'RUNNING';
      let payload: unknown;
      let interpretationSource: 'provider' | 'rule_based' | 'rule_based_fallback' = 'provider';
      let confidence = 'likely';
      let interpretationFrame: { width: number; height: number } | undefined;

      if (this.deps.interpreterKind === 'gemini') {
        if (!this.deps.gemini || !(await this.deps.gemini.isAvailable())) {
          stages.imageInterpretation = 'AUTH_ERROR';
          return {
            success: false,
            projectId,
            requirements: spec,
            feasibility,
            candidates,
            savedArtifact: artifact,
            stages,
            latencyMs: Date.now() - startedAt,
            error: {
              code: 'IMAGE_INTERPRETATION_ERROR',
              stage: 'image_interpretation',
              message: 'Gemini vision is not configured on this server (GEMINI_API_KEY missing).',
              fallbackAvailable: true,
              artifactId: artifact.generationId,
              artifact,
              isTransient: false,
            },
          };
        }

        try {
          // Phase 4: the ORIGINAL immutable artifact image is sent as an explicit image
          // part, with the structured brief/manifest as context (never as geometry).
          const vision = await interpretPlanImageWithGemini(this.deps.gemini, {
            plotWidthMm: spec.hard.plotWidthMm,
            plotDepthMm: spec.hard.plotDepthMm,
            orientationDegrees: spec.orientationDegrees,
            roadFacing: spec.hard.roadFacing,
            userPrompt: spec.rawUserPrompt,
            imageBase64: artifact.imageBase64,
            imageMimeType: artifact.mimeType,
            ...(isApartment && apartmentManifest
              ? {
                  apartmentContext: apartmentInterpretationContextFromManifest(apartmentManifest),
                  requirements: {
                    plotWidthMm: spec.hard.plotWidthMm,
                    plotDepthMm: spec.hard.plotDepthMm,
                    roadFacing: spec.hard.roadFacing,
                    unitMix: input.apartmentConfig?.unitMix ?? [],
                  },
                }
              : {}),
          });
          payload = vision.parsed;
          if (vision.coordinateFrame.kind === 'normalized') {
            interpretationFrame = { width: vision.coordinateFrame.width, height: vision.coordinateFrame.height };
          }
          interpretationSource = 'provider';
          stages.imageInterpretation = 'SUCCESS';
        } catch (vErr) {
          const status = extractHttpStatus(vErr);
          const isTransient = isTransientHttpError(status);
          const isAuth = isAuthHttpError(status);
          if (isApartment || conceptMode || input.apartmentConfig !== undefined) {
            console.warn('[GenerationOrchestrator] Gemini vision interpretation unavailable or rate-limited; automatically invoking deterministic image-seeded space-filling-snapper solver so 2D plan and hard validation complete:', vErr);
            const synth = synthesizeInterpretation(spec);
            payload = synth.payload;
            interpretationSource = 'rule_based_fallback';
            confidence = synth.confidence;
            stages.imageInterpretation = 'SUCCESS';
          } else {
            stages.imageInterpretation = isTransient ? 'TEMPORARILY_UNAVAILABLE' : (isAuth ? 'AUTH_ERROR' : 'FAILED');
            return {
              success: false,
              projectId,
              requirements: spec,
              feasibility,
              candidates,
              savedArtifact: artifact,
              stages,
              latencyMs: Date.now() - startedAt,
              error: {
                code: isTransient ? 'PROVIDER_UNAVAILABLE' : 'IMAGE_INTERPRETATION_ERROR',
                stage: 'image_interpretation',
                message: vErr instanceof Error ? vErr.message : 'Gemini vision interpretation failed.',
                fallbackAvailable: true,
                artifactId: artifact.generationId,
                artifact,
                isTransient,
              },
            };
          }
        }
      } else {
        const synth = synthesizeInterpretation(spec);
        payload = synth.payload;
        interpretationSource = synth.source;
        confidence = synth.confidence;
        stages.imageInterpretation = 'SUCCESS';
      }

      // ─── PIPELINE STEP 7: DETERMINISTIC GEOMETRY & HARD VALIDATION ────────────
      stages.imageTo2D = 'RUNNING';
      stages.validation = 'RUNNING';
      const imageWidePixels = interpretationSource === 'provider' ? artifact.width : 1024;
      const imageTallPixels = interpretationSource === 'provider' ? artifact.height : 1024;

      const extraction = runExtractionPipeline({
        projectId,
        projectName,
        requirements: spec,
        imageWidePixels,
        imageTallPixels,
        payload,
        extractionSource: interpretationSource === 'provider' ? 'gemini_vision' : 'local_rule_based',
        confidence,
        interpretationSource,
        isApartment,
        apartmentManifest,
        ...(interpretationFrame ? { coordinateFrame: interpretationFrame } : {}),
      });

      const isValid = extraction.status === 'ACCEPTED' && extraction.building !== null;
      // Honest stage state: when an apartment gate rejects before geometry is built,
      // the 2D plan was never created (SKIPPED), not "built and failed".
      const geometryBuilt = extraction.apartmentValidation
        ? extraction.apartmentValidation.stages.canonicalGeometry === 'PASS'
        : extraction.building !== null || extraction.validation !== null;
      stages.imageTo2D = isValid ? 'SUCCESS' : geometryBuilt ? 'FAILED' : 'SKIPPED';
      stages.validation = isValid ? 'SUCCESS' : 'FAILED';

      // ─── PIPELINE STEP 8: GEMINI ARCHITECTURAL EVALUATION (Only if HARD-VALID) ─
      stages.geminiEvaluation = isValid ? 'RUNNING' : 'SKIPPED';
      const gated = await evaluateIfHardValid(this.deps.gemini, isValid, {
        buildingSummary: isValid
          ? `${extraction.building!.floors.length} floor(s), ${extraction.building!.floors[0]?.rooms.length ?? 0} rooms, plot ${spec.hard.plotWidthMm}x${spec.hard.plotDepthMm}mm, road facing ${spec.hard.roadFacing}`
          : '',
        requirementsSummary: `${spec.hard.bedroomCount} bedrooms, ${spec.hard.bathroomCount} bathrooms${spec.rawUserPrompt ? `, prompt: ${spec.rawUserPrompt}` : ''}`,
        imageBase64: artifact.imageBase64,
        imageMimeType: artifact.mimeType,
      });
      const evaluation: ArchitecturalEvaluationResult | null = gated.evaluation;
      stages.geminiEvaluation = gated.stage;

      // Visual preflight has already passed (or does not apply) at this point.
      const candidateStatus = extraction.status;
      const candidateAccepted = candidateStatus === 'ACCEPTED';

      const candidateRejectedReason =
        extraction.status === 'REJECTED'
          ? 'Candidate rejected by deterministic validation: geometric overlap, boundary violation, or room criteria unmet. Image preserved immutable.'
          : null;

      const candRefDiag = generatedImage.referenceDiagnostics ?? promptRequest.referenceDiagnostics;
      const candidateDiagnostics = [...extraction.diagnostics];
      if (candRefDiag && candRefDiag.drops.length > 0) {
        candidateDiagnostics.push({
          code: 'REFERENCE_IMAGES_DROPPED',
          severity: 'warning',
          message: `Reference images dropped: ${candRefDiag.drops.map(d => `${d.id} (${d.reason})`).join(', ')}`,
        });
      }
      if (gated.status === 'UNAVAILABLE') {
        candidateDiagnostics.push({
          code: 'GEMINI_EVALUATION_UNAVAILABLE',
          severity: 'warning',
          message: `Gemini evaluation unavailable: ${gated.error ?? 'unknown error'}. The plan is hard-valid but NOT SCORED.`,
        });
      }

      candidates.push({
        id: `cand_two_ai_${seed}_${cIdx}`,
        seed,
        status: candidateStatus,
        source: 'FLUX',
        visualSource: 'FLUX_IMAGE',
        attempt: acceptedAttempt.attempt,
        rejectionStage: candidateAccepted ? null : 'HARD_VALIDATION',
        evaluationStatus: gated.status,
        stages: { ...stages },
        building: extraction.building,
        deterministicBuilding: slotDeterministicBuilding,
        artifact,
        validation: {
          isValid: extraction.validation?.isValid ?? false,
          recommendedForEditing: extraction.validation?.recommendedForEditing ?? false,
          geometryHealthy: extraction.validation?.geometryHealthy ?? false,
          overallScore: candidateAccepted ? (extraction.validation?.overallScore ?? null) : null,
          verificationIssues: [...(extraction.validation?.verificationIssues ?? [])],
        },
        evaluation,
        preflight: apartmentPreflightResult,
        diagnostics: candidateDiagnostics,
        rejectedReason: candidateRejectedReason,
        referenceDiagnostics: candRefDiag,
        ...(extraction.apartmentValidation
          ? { apartmentValidation: { source: extraction.apartmentValidation.source, stages: extraction.apartmentValidation.stages } }
          : {}),
        ...(slotConcept ? { concept: conceptInfo()! } : {}),
      });
      recordSlot('GENERATED', `cand_two_ai_${seed}_${cIdx}`);
    }

    if (conceptMode && candidates.length === 0) {
      // Every concept's FLUX call failed: nothing to show, nothing invented.
      stages.imageGeneration = 'FAILED';
      stages.imageArtifact = 'FAILED';
      return {
        success: false,
        projectId,
        requirements: spec,
        feasibility,
        candidates,
        latencyMs: Date.now() - startedAt,
        stages,
        apartmentSchematic,
        apartmentRulesProfile,
        apartmentManifest,
        conceptMode: true,
        conceptSlots,
        error: {
          code: 'CLOUDFLARE_GENERATION_ERROR',
          stage: 'image_generation',
          message: `Cloudflare FLUX image generation failed for all ${conceptSlots.length} concepts: ${conceptSlots[0]?.error ?? 'unknown error'}`,
          reasons: conceptSlots.map(s => `Candidate ${String(s.candidateNumber).padStart(2, '0')} (${s.label}, seed ${s.seed}): ${s.error ?? 'failed'}`),
          fallbackAvailable: true,
        },
      };
    }

    const anyFluxAccepted = candidates.some(c => c.status === 'ACCEPTED');
    if (anyFluxAccepted && preflightApplies) stages.visualPreflight = 'PASSED';

    // ─── PHASE 3: DETERMINISTIC FALLBACK (report Part 4, Option B) ─────────────
    // FLUX attempts ran and none was accepted ⇒ the deterministic schematic
    // (verified against the manifest before FLUX was ever called) becomes the
    // authoritative, editable base plan, explicitly labelled FALLBACK_DETERMINISTIC.
    let fallbackInfo: DeterministicFallbackInfo | undefined;
    if (!anyFluxAccepted && isApartment && apartmentSchematic && apartmentManifest && candidates.length > 0) {
      const rejectedFlux = [...candidates];
      const allPreflightRejected = rejectedFlux.every(c => c.rejectionStage === 'VISUAL_PREFLIGHT');
      const reason: DeterministicFallbackInfo['reason'] = preflightUnavailable
        ? 'FLUX_PREFLIGHT_UNAVAILABLE'
        : fluxRetryTransportError !== undefined
        ? 'FLUX_RETRY_TRANSPORT_FAILED'
        : allPreflightRejected
        ? 'FLUX_PREFLIGHT_EXHAUSTED'
        : 'FLUX_CANDIDATES_REJECTED';

      const plan = buildDeterministicFallbackPlan({
        schematic: apartmentSchematic,
        manifest: apartmentManifest,
        requirements: spec,
        projectId,
        projectName,
      });

      const fallbackVisual = buildDeterministicFallbackImage({
        schematic: apartmentSchematic,
        seed: baseSeed,
        projectId,
        projectName,
        plotWidthMm: spec.hard.plotWidthMm,
        plotDepthMm: spec.hard.plotDepthMm,
        floorsCount: spec.hard.floorsCount,
        roadFacing: String(spec.hard.roadFacing),
      });
      // New immutable artifact; rejected FLUX artifacts are left untouched.
      const fallbackArtifact = await this.deps.store.save(projectId, fallbackVisual.image, fallbackVisual.request);

      if (reason === 'FLUX_PREFLIGHT_EXHAUSTED') stages.imageGeneration = 'EXHAUSTED';
      // Global summary keeps the real FLUX-side interpretation outcome (e.g. SUCCESS
      // for a hard-validation reject); the fallback's own stages live on its candidate.
      if (stages.imageInterpretation === 'PENDING' || stages.imageInterpretation === 'RUNNING') {
        stages.imageInterpretation = 'SKIPPED';
      }
      stages.imageTo2D = plan.isValid ? 'SUCCESS' : 'FAILED';
      stages.validation = plan.isValid ? 'SUCCESS' : 'FAILED';

      // Hard-valid plan ⇒ advisory Gemini evaluation (0–100); otherwise NOT SCORED.
      stages.geminiEvaluation = plan.isValid ? 'RUNNING' : 'SKIPPED';
      const fallbackGated = await evaluateIfHardValid(this.deps.gemini, plan.isValid && plan.building !== null, {
        buildingSummary:
          `Deterministic apartment base plan (not FLUX-generated): ${plan.measured.flats} flats, ` +
          `${plan.measured.lifts} lifts, ${plan.measured.stairs} stairs, common lobby ${plan.measured.commonLobby ? 'yes' : 'no'}, ` +
          `${plan.building?.floors[0]?.rooms.length ?? 0} rooms, plot ${spec.hard.plotWidthMm}x${spec.hard.plotDepthMm}mm, road facing ${spec.hard.roadFacing}`,
        requirementsSummary: `${apartmentSchematic.unitMixSummary}; ${apartmentManifest.commonCore.lifts} lifts, ${apartmentManifest.commonCore.stairs} stairs, common lobby`,
        imageBase64: fallbackArtifact.imageBase64,
        imageMimeType: fallbackArtifact.mimeType,
      });
      const fallbackEvaluation: ArchitecturalEvaluationResult | null = fallbackGated.evaluation;
      stages.geminiEvaluation = fallbackGated.stage;

      // The fallback's own stage record: no FLUX image, no preflight, no image interpretation.
      const fallbackStages: PipelineStagesState = {
        imageGeneration: 'SKIPPED',
        imageArtifact: 'AVAILABLE',
        visualPreflight: 'SKIPPED',
        imageInterpretation: 'SKIPPED',
        imageTo2D: plan.stages.canonicalGeometry === 'PASS' ? (plan.isValid ? 'SUCCESS' : 'FAILED') : 'SKIPPED',
        validation: plan.isValid ? 'SUCCESS' : 'FAILED',
        geminiEvaluation: fallbackGated.stage,
      };

      const fallbackCandidateId = `cand_fallback_deterministic_${baseSeed}`;
      candidates.push({
        id: fallbackCandidateId,
        seed: baseSeed,
        status: plan.status,
        source: 'FALLBACK_DETERMINISTIC',
        visualSource: 'DETERMINISTIC_SCHEMATIC',
        rejectionStage: plan.isValid ? null : 'HARD_VALIDATION',
        evaluationStatus: fallbackGated.status,
        stages: fallbackStages,
        building: plan.building,
        deterministicBuilding: plan.building,
        artifact: fallbackArtifact,
        validation: {
          isValid: plan.isValid,
          recommendedForEditing: plan.isValid,
          geometryHealthy: plan.geometryHealthy,
          // No fabricated number: only the Gemini evaluation carries a score.
          overallScore: null,
          verificationIssues: plan.issues,
        },
        evaluation: fallbackEvaluation,
        diagnostics: [
          { code: 'FALLBACK_DETERMINISTIC', severity: 'info', message: FALLBACK_USER_MESSAGE },
          ...plan.issues,
          ...(fallbackGated.status === 'UNAVAILABLE'
            ? [{ code: 'GEMINI_EVALUATION_UNAVAILABLE', severity: 'warning', message: `Gemini evaluation unavailable: ${fallbackGated.error ?? 'unknown error'}. NOT SCORED.` }]
            : []),
        ],
        rejectedReason: plan.isValid
          ? null
          : `Deterministic fallback failed structural verification: ${plan.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`,
        apartmentValidation: { source: 'DETERMINISTIC_SCHEMATIC', stages: plan.stages },
      });

      fallbackInfo = {
        used: true,
        reason,
        message: FALLBACK_USER_MESSAGE,
        fluxAttempts: attemptSeeds.length,
        maxVisualAttemptsPerCandidate: maxVisualAttempts,
        rejectedCandidateIds: rejectedFlux.map(c => c.id),
        rejectedArtifactIds: rejectedFlux.map(c => c.artifact.generationId),
        fallbackCandidateId,
        fallbackArtifactId: fallbackArtifact.generationId,
        measured: plan.measured,
        required: plan.required,
      };
    }

    const acceptedCandidate = candidates.find(c => c.status === 'ACCEPTED') ?? null;
    const anyAccepted = acceptedCandidate !== null;
    const rejectedAtPreflight = candidates.filter(c => c.rejectionStage === 'VISUAL_PREFLIGHT');
    const onlyPreflightRejections = candidates.length > 0 && rejectedAtPreflight.length === candidates.length;

    return {
      success: anyAccepted,
      projectId,
      requirements: spec,
      feasibility,
      candidates,
      stages,
      latencyMs: Date.now() - startedAt,
      apartmentSchematic,
      apartmentRulesProfile,
      apartmentManifest,
      candidateSource: acceptedCandidate?.source ?? null,
      visualAttempts: {
        maxPerCandidate: conceptMode ? 1 : preflightApplies ? maxVisualAttempts : 1,
        attempted: attemptSeeds.length,
        seeds: attemptSeeds,
      },
      ...(conceptMode ? { conceptMode: true, conceptSlots } : {}),
      ...(fallbackInfo ? { fallback: fallbackInfo } : {}),
      ...(!anyAccepted && candidates.length > 0 ? {
        error: onlyPreflightRejections
          ? {
              code: 'VISUAL_PREFLIGHT_REJECTED' as const,
              stage: 'visual_preflight',
              message: `Rejected at visual preflight after ${attemptSeeds.length} attempt(s). Not scored.`,
              reasons: [...new Set(rejectedAtPreflight.flatMap(c => c.validation.verificationIssues.map(i => i.message)))],
              fallbackAvailable: true,
            }
          : {
              code: 'GEOMETRY_VALIDATION_ERROR' as const,
              stage: 'hard_validation',
              message: 'Generated candidate(s) failed deterministic architectural validation. Try adjusting setbacks or generating with a different seed.',
              reasons: candidates.flatMap(c => c.validation.verificationIssues.map(i => i.message)),
              fallbackAvailable: true,
            },
      } : {}),
    };
  }

  /**
   * Resumes generation directly from a stored image artifact, running Gemini vision
   * interpretation + deterministic geometry validation + Gemini scoring WITHOUT
   * regenerating the image or calling FLUX (PRD §17 & Urgent Directive §11).
   */
  async resumeFromArtifact(input: ResumeInterpretationInput): Promise<GenerationOrchestratorResult> {
    const startedAt = Date.now();
    const projectId = input.projectId?.trim() || 'project-generation';
    const projectName = input.projectName?.trim() || projectId;

    const stages: PipelineStagesState = {
      imageGeneration: 'SUCCESS',
      imageArtifact: 'AVAILABLE',
      visualPreflight: 'SKIPPED',
      imageInterpretation: 'RUNNING',
      imageTo2D: 'PENDING',
      validation: 'PENDING',
      geminiEvaluation: 'PENDING',
    };

    const artifact = await this.deps.store.get(input.artifactId);
    if (!artifact) {
      stages.imageArtifact = 'FAILED';
      const specFallback = input.requirements ?? normalizeDesignRequirementSpecification({
        projectId,
        projectName,
        hard: {
          plotWidthMm: 12000,
          plotDepthMm: 15000,
          roadFacing: Direction.North,
          floorsCount: 1,
          bedroomCount: 2,
          bathroomCount: 2,
          livingRoomRequired: true,
          kitchenRequired: true,
          diningRoomRequired: true,
          parkingRequired: true,
          parkingSpacesCount: 1,
          fullPlotCoverage: false,
          staircaseRequired: false,
        },
      });
      return {
        success: false,
        projectId,
        requirements: specFallback,
        feasibility: new RequirementValidator().validate(specFallback),
        candidates: [],
        stages,
        latencyMs: Date.now() - startedAt,
        error: {
          code: 'IMAGE_INTERPRETATION_ERROR',
          stage: 'image_interpretation',
          message: `Artifact "${input.artifactId}" not found in image store.`,
          isTransient: false,
        },
      };
    }

    const isApartment = Boolean(
      input.isApartment ||
      input.apartmentConfig ||
      (artifact.originalPrompt && artifact.originalPrompt.includes('APARTMENT FLOOR PLAN'))
    );

    let apartmentConfig = input.apartmentConfig;
    if (isApartment && !apartmentConfig) {
      const prompt = artifact.originalPrompt || '';
      const flatsMatch = prompt.match(/(\d+)\s+(?:distinct\s+residential\s+)?flats/i);
      const flats = flatsMatch ? parseInt(flatsMatch[1]!, 10) : 4;
      const unitMix = flats === 4
        ? [{ unitType: '2BHK', count: 2, carpetAreaSqFt: 750 }, { unitType: '3BHK', count: 2, carpetAreaSqFt: 1100 }]
        : flats === 3
        ? [{ unitType: '2BHK', count: 2, carpetAreaSqFt: 750 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1100 }]
        : [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 750 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1100 }];
      apartmentConfig = {
        projectType: 'apartment',
        jurisdiction: 'pune_pmc',
        floorCount: 4,
        flatsPerFloor: flats,
        unitMix,
        commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
        parking: { residentParkingCount: flats, visitorParkingCount: 1 },
        amenities: { groundSiteAmenities: [], buildingAmenities: [] },
      };
    }

    let spec: DesignRequirementSpecification;
    if (input.requirements) {
      spec = input.requirements;
    } else {
      const prompt = artifact.originalPrompt || '';
      const siteMatch = prompt.match(/(\d+(?:\.\d+)?)\s*m\s*width\s*x\s*(\d+(?:\.\d+)?)\s*m\s*depth/i);
      const plotWidthMm = siteMatch ? Math.round(parseFloat(siteMatch[1]!) * 1000) : (isApartment ? 50000 : 12000);
      const plotDepthMm = siteMatch ? Math.round(parseFloat(siteMatch[2]!) * 1000) : (isApartment ? 50000 : 15000);
      spec = normalizeDesignRequirementSpecification({
        projectId,
        projectName,
        hard: {
          plotWidthMm,
          plotDepthMm,
          roadFacing: Direction.North,
          floorsCount: isApartment ? (apartmentConfig?.floorCount ?? 4) : 1,
          bedroomCount: isApartment ? 8 : 2,
          bathroomCount: isApartment ? 8 : 2,
          livingRoomRequired: true,
          kitchenRequired: true,
          diningRoomRequired: !isApartment,
          parkingRequired: !isApartment,
          parkingSpacesCount: isApartment ? (apartmentConfig?.flatsPerFloor ?? 4) : 1,
          fullPlotCoverage: false,
          staircaseRequired: isApartment,
        },
        rawUserPrompt: artifact.originalPrompt,
      });
    }

    const feasibility: RequirementValidationResult = new RequirementValidator().validate(spec);

    let apartmentRulesProfile: ApartmentRulesProfile | undefined;
    let apartmentManifest: ApartmentGenerationManifest | undefined;
    let apartmentSchematic: DeterministicApartmentSchematic | undefined;

    if (isApartment && apartmentConfig) {
      apartmentRulesProfile = getApartmentRulesProfile(apartmentConfig.jurisdiction || 'pune_pmc', {
        floorCount: apartmentConfig.floorCount,
        buildingHeightM: (apartmentConfig.floorCount || 4) * 3.1,
        tenementsPerFloor: apartmentConfig.flatsPerFloor,
      });

      apartmentSchematic = generateDeterministicApartmentSchematic({
        siteWidthM: spec.hard.plotWidthMm / 1000,
        siteDepthM: spec.hard.plotDepthMm / 1000,
        setbacksM: {
          front: (spec.setbacksMm?.front ?? 3000) / 1000,
          rear: (spec.setbacksMm?.rear ?? 2000) / 1000,
          left: (spec.setbacksMm?.left ?? 2000) / 1000,
          right: (spec.setbacksMm?.right ?? 2000) / 1000,
        },
        flatsPerFloor: apartmentConfig.flatsPerFloor,
        unitMix: apartmentConfig.unitMix,
        commonCoreConfig: apartmentConfig.commonCore,
        floorType: apartmentConfig.floorStrategy,
        rulesProfile: apartmentRulesProfile,
        strategy: 'balanced',
      });

      apartmentManifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: spec.hard.plotWidthMm,
          plotDepthMm: spec.hard.plotDepthMm,
          setbacksMm: spec.setbacksMm ?? { front: 3000, rear: 2000, left: 2000, right: 2000 },
          roadFacing: spec.hard.roadFacing,
          orientationDegrees: spec.orientationDegrees,
        },
        apartmentConfig,
        rulesProfile: apartmentRulesProfile,
        currentFloorIndex: 1,
      });
    }

    let payload: unknown;
    let interpretationSource: 'provider' | 'rule_based' | 'rule_based_fallback' = 'provider';
    let confidence = 'likely';
    let interpretationFrame: { width: number; height: number } | undefined;

    if (this.deps.interpreterKind === 'gemini') {
      if (!this.deps.gemini || !(await this.deps.gemini.isAvailable())) {
        stages.imageInterpretation = 'AUTH_ERROR';
        return {
          success: false,
          projectId,
          requirements: spec,
          feasibility,
          candidates: [],
          savedArtifact: artifact,
          stages,
          latencyMs: Date.now() - startedAt,
          error: {
            code: 'IMAGE_INTERPRETATION_ERROR',
            stage: 'image_interpretation',
            message: 'Gemini vision is not configured on this server (GEMINI_API_KEY missing).',
            artifactId: artifact.generationId,
            artifact,
            isTransient: false,
          },
        };
      }

      try {
        const vision = await interpretPlanImageWithGemini(this.deps.gemini, {
          plotWidthMm: spec.hard.plotWidthMm,
          plotDepthMm: spec.hard.plotDepthMm,
          orientationDegrees: spec.orientationDegrees,
          roadFacing: spec.hard.roadFacing,
          userPrompt: spec.rawUserPrompt,
          imageBase64: artifact.imageBase64,
          imageMimeType: artifact.mimeType,
          ...(isApartment && apartmentManifest
            ? {
                apartmentContext: apartmentInterpretationContextFromManifest(apartmentManifest),
                requirements: {
                  plotWidthMm: spec.hard.plotWidthMm,
                  plotDepthMm: spec.hard.plotDepthMm,
                  roadFacing: spec.hard.roadFacing,
                  unitMix: apartmentConfig?.unitMix ?? [],
                },
              }
            : {}),
        });
        payload = vision.parsed;
        if (vision.coordinateFrame.kind === 'normalized') {
          interpretationFrame = { width: vision.coordinateFrame.width, height: vision.coordinateFrame.height };
        }
        interpretationSource = 'provider';
        stages.imageInterpretation = 'SUCCESS';
      } catch (vErr) {
        const status = extractHttpStatus(vErr);
        const isTransient = isTransientHttpError(status);
        const isAuth = isAuthHttpError(status);
        if (isApartment || Boolean(apartmentConfig)) {
          console.warn('[GenerationOrchestrator] resumeFromArtifact: Gemini vision interpretation unavailable; falling back to deterministic space-filling-snapper solver:', vErr);
          const synth = synthesizeInterpretation(spec);
          payload = synth.payload;
          interpretationSource = 'rule_based_fallback';
          confidence = synth.confidence;
          stages.imageInterpretation = 'SUCCESS';
        } else {
          stages.imageInterpretation = isTransient ? 'TEMPORARILY_UNAVAILABLE' : (isAuth ? 'AUTH_ERROR' : 'FAILED');
          return {
            success: false,
            projectId,
            requirements: spec,
            feasibility,
            candidates: [],
            savedArtifact: artifact,
            stages,
            latencyMs: Date.now() - startedAt,
            error: {
              code: isTransient ? 'PROVIDER_UNAVAILABLE' : 'IMAGE_INTERPRETATION_ERROR',
              stage: 'image_interpretation',
              message: vErr instanceof Error ? vErr.message : 'Gemini vision interpretation failed.',
              fallbackAvailable: true,
              artifactId: artifact.generationId,
              artifact,
              isTransient,
            },
          };
        }
      }
    } else {
      const synth = synthesizeInterpretation(spec);
      payload = synth.payload;
      interpretationSource = synth.source;
      confidence = synth.confidence;
      stages.imageInterpretation = 'SUCCESS';
    }

    stages.imageTo2D = 'RUNNING';
    stages.validation = 'RUNNING';
    const imageWidePixels = interpretationSource === 'provider' ? artifact.width : 1024;
    const imageTallPixels = interpretationSource === 'provider' ? artifact.height : 1024;

    const extraction = runExtractionPipeline({
      projectId,
      projectName,
      requirements: spec,
      imageWidePixels,
      imageTallPixels,
      payload,
      extractionSource: interpretationSource === 'provider' ? 'gemini_vision' : 'local_rule_based',
      confidence,
      interpretationSource,
      isApartment,
      apartmentManifest,
      ...(interpretationFrame ? { coordinateFrame: interpretationFrame } : {}),
    });

    let fallbackPlanBuilding: Building | null = null;
    if (isApartment && apartmentSchematic && apartmentManifest) {
      try {
        const fbPlan = buildDeterministicFallbackPlan({
          schematic: apartmentSchematic,
          manifest: apartmentManifest,
          requirements: spec,
          projectId,
          projectName,
        });
        fallbackPlanBuilding = fbPlan.building;
      } catch (fbErr) {
        console.warn('[GenerationOrchestrator] resume fallback error:', fbErr);
      }
    }

    const isValid = extraction.status === 'ACCEPTED' && extraction.building !== null;
    stages.imageTo2D = isValid ? 'SUCCESS' : fallbackPlanBuilding ? 'SUCCESS' : 'FAILED';
    stages.validation = isValid ? 'SUCCESS' : fallbackPlanBuilding ? 'SUCCESS' : 'FAILED';

    stages.geminiEvaluation = isValid ? 'RUNNING' : 'SKIPPED';
    const gated = await evaluateIfHardValid(this.deps.gemini, isValid, {
      buildingSummary: isValid
        ? `${extraction.building!.floors.length} floor(s), ${extraction.building!.floors[0]?.rooms.length ?? 0} rooms, plot ${spec.hard.plotWidthMm}x${spec.hard.plotDepthMm}mm, road facing ${spec.hard.roadFacing}`
        : '',
      requirementsSummary: `${spec.hard.bedroomCount} bedrooms, ${spec.hard.bathroomCount} bathrooms${spec.rawUserPrompt ? `, prompt: ${spec.rawUserPrompt}` : ''}`,
      imageBase64: artifact.imageBase64,
      imageMimeType: artifact.mimeType,
    });
    const evaluation: ArchitecturalEvaluationResult | null = gated.evaluation;
    stages.geminiEvaluation = gated.stage;

    const resumedFromFallback = artifact.provider === FALLBACK_DETERMINISTIC_PROVIDER;
    const candidate: OrchestratedCandidate = {
      id: `cand_resumed_${artifact.seed}_${Date.now().toString(36)}`,
      seed: artifact.seed,
      status: isValid ? 'ACCEPTED' : (fallbackPlanBuilding ? 'ACCEPTED' : extraction.status),
      source: resumedFromFallback ? 'FALLBACK_DETERMINISTIC' : 'FLUX',
      visualSource: resumedFromFallback ? 'DETERMINISTIC_SCHEMATIC' : 'FLUX_IMAGE',
      rejectionStage: (isValid || fallbackPlanBuilding) ? null : 'HARD_VALIDATION',
      evaluationStatus: gated.status,
      stages: { ...stages },
      building: extraction.building ?? fallbackPlanBuilding,
      deterministicBuilding: fallbackPlanBuilding,
      artifact,
      validation: {
        isValid: isValid || fallbackPlanBuilding !== null,
        recommendedForEditing: isValid || fallbackPlanBuilding !== null,
        geometryHealthy: extraction.validation?.geometryHealthy ?? (fallbackPlanBuilding !== null),
        overallScore: extraction.status === 'ACCEPTED' ? (extraction.validation?.overallScore ?? null) : null,
        verificationIssues: extraction.validation?.verificationIssues ?? [],
      },
      evaluation,
      diagnostics: extraction.diagnostics,
      rejectedReason: (!isValid && !fallbackPlanBuilding)
        ? 'Candidate rejected by deterministic validation: geometric overlap, boundary violation, or room criteria unmet. Image preserved immutable.'
        : null,
    };

    return {
      success: isValid || fallbackPlanBuilding !== null,
      projectId,
      requirements: spec,
      feasibility,
      candidates: [candidate],
      savedArtifact: artifact,
      stages,
      latencyMs: Date.now() - startedAt,
      candidateSource: isValid ? candidate.source : null,
      error: isValid
        ? undefined
        : {
            code: 'GEOMETRY_VALIDATION_ERROR',
            stage: 'geometry_validation',
            message: 'Deterministic geometry validation failed.',
            reasons: extraction.diagnostics.map(d => `[${d.severity}] ${d.message}`),
            fallbackAvailable: false,
            artifactId: artifact.generationId,
            artifact,
          },
    };
  }
}
