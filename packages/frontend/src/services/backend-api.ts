import type { Building, DesignRequirementSpecification, SpaceProgram } from '@ai-floor-planner/core';
import type { RequirementParseResult, AIEditParseResult, FloorPlanImagePromptRequest, ApartmentBriefConfig } from '@ai-floor-planner/ai-orchestration';
import {
  runGenerationWorkflow,
  type ReviewedWorkflowInput,
  type GenerationWorkflowResult,
  type GenerationStageId,
} from '@ai-floor-planner/planning-engine';

export interface ImageInterpretationOutcome {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly planId: string;
  readonly interpretationSource: string;
  readonly confidence: string;
  readonly diagnostics: readonly { code: string; severity: string; message: string }[];
  readonly validation: {
    readonly isValid: boolean;
    readonly recommendedForEditing: boolean;
    readonly geometryHealthy: boolean;
    readonly overallScore: number;
  } | null;
  /** Canonical Building — present ONLY when ACCEPTED (PRD 23). */
  readonly building: Building | null;
  readonly rejectedReason: string | null;
}

export interface ArchitecturalScore {
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
}

/** The artifact returned by the server-side image boundary (PRD §17). */
export interface StoredPlanImageArtifact {
  readonly generationId: string;
  readonly projectId: string;
  readonly seed: number;
  readonly model: string;
  readonly provider: string;
  readonly promptVersion: number;
  readonly originalPrompt: string;
  readonly negativePrompt: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
  readonly generatedAt: string;
  readonly latencyMs: number;
  readonly imageBase64: string;
}

export class BackendError extends Error {
  readonly code: string;
  readonly requestId?: string;

  constructor(code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.requestId = requestId;
    Object.setPrototypeOf(this, BackendError.prototype);
  }
}

export interface GenerationJobProgress {
  readonly stage?: GenerationStageId;
  readonly status: 'PENDING' | 'ACTIVE' | 'SUCCEEDED' | 'FAILED';
}

export class BackendAPI {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl = 'http://127.0.0.1:4200',
    fetchImpl: typeof fetch = typeof window !== 'undefined' ? window.fetch.bind(window) : globalThis.fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  /**
   * Parse a natural-language brief through the server-side AI boundary.
   *
   * SECURITY & TRUTHFULNESS (Master PRD §36 / §33): credentials live on the
   * server. This client NEVER silently substitutes a local parse for a failed
   * backend call — when the backend is unreachable it rejects with an honest
   * BACKEND_UNAVAILABLE error, and the UI degrades to its structured form input
   * instead of implying AI generation occurred.
   */
  async parseRequirementsDetailed(prompt: string): Promise<RequirementParseResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/ai/interpret-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; requestId?: string };
        };
        throw new BackendError(
          data.error?.code ?? 'BACKEND_ERROR',
          data.error?.message ?? `Request failed with status ${response.status}`,
          data.error?.requestId,
        );
      }

      return (await response.json()) as RequirementParseResult;
    } catch (cause) {
      if (cause instanceof BackendError) throw cause;
      throw new BackendError(
        'BACKEND_UNAVAILABLE',
        'The AI backend service is unavailable. Use the structured requirement inputs instead.',
        undefined,
      );
    }
  }

  async parseEditCommandDetailed(
    instruction: string,
    building: Building,
    context?: { activeFloorId?: string; selectedRoomId?: string },
  ): Promise<AIEditParseResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/ai/edit-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, building, context }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; requestId?: string };
        };
        throw new BackendError(
          data.error?.code ?? 'BACKEND_ERROR',
          data.error?.message ?? `Request failed with status ${response.status}`,
          data.error?.requestId,
        );
      }

      return (await response.json()) as AIEditParseResult;
    } catch (cause) {
      if (cause instanceof BackendError) throw cause;
      throw new BackendError(
        'BACKEND_UNAVAILABLE',
        'The AI backend service is unavailable. Edit the plan directly instead.',
        undefined,
      );
    }
  }

  /**
   * Request a FLUX floor-plan concept image through the server-side boundary.
   *
   * SECURITY (PRD §36): Cloudflare credentials exist only in the backend. This
   * client sends the deterministic compiled request and receives the persisted
   * artifact. There is deliberately NO client-side fallback — if the boundary is
   * unavailable the UI reports it honestly instead of faking an image.
   */
  async generateFloorPlanImage(
    projectId: string,
    request: FloorPlanImagePromptRequest,
    signal?: AbortSignal,
  ): Promise<StoredPlanImageArtifact> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/image/floor-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, request }),
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new BackendError(
        'IMAGE_BACKEND_UNAVAILABLE',
        'The image generation service is unreachable. Start the backend and try again.',
        undefined,
      );
    }
    const data = (await response.json().catch(() => ({}))) as {
      artifact?: StoredPlanImageArtifact;
      error?: { code?: string; message?: string; requestId?: string };
    };
    if (!response.ok || !data.artifact) {
      throw new BackendError(
        data.error?.code ?? 'IMAGE_GENERATION_FAILED',
        data.error?.message ?? `Image generation failed with status ${response.status}.`,
        data.error?.requestId,
      );
    }
    return data.artifact;
  }

  /**
   * Interpret a stored concept image into a validated canonical 2D plan.
   * Returns geometry ONLY when the deterministic system accepts it (PRD 23).
   */
  async interpretFloorPlanImage(
    projectId: string,
    projectName: string,
    requirements: DesignRequirementSpecification,
    program: SpaceProgram | undefined,
    imageBase64: string,
    imageMimeType: string,
    imageWidePixels: number,
    imageTallPixels: number,
    signal?: AbortSignal,
  ): Promise<ImageInterpretationOutcome> {
    const body = JSON.stringify({
      projectId, projectName, requirements,
      ...(program ? { program } : {}),
      imageBase64, imageMimeType, imageWidePixels, imageTallPixels,
    });
    const response = await this.post('/api/v1/image/interpret', body, signal, 'IMAGE_BACKEND_UNAVAILABLE', 'The image interpretation service is unreachable. Start the backend and try again.');
    return this.outcome(response, 'IMAGE_INTERPRETATION_FAILED');
  }

  /**
   * Request a Gemini architectural evaluation of an already-valid plan (PRD 25).
   * The server never fabricates a score when unconfigured.
   */
  async evaluateArchitecture(
    buildingSummary: string,
    requirementsSummary: string,
    imageBase64?: string,
    imageMimeType?: string,
    signal?: AbortSignal,
  ): Promise<{ evaluation: ArchitecturalScore }> {
    const response = await this.post(
      '/api/v1/architecture/evaluate',
      JSON.stringify({
        buildingSummary, requirementsSummary,
        ...(imageBase64 ? { imageBase64 } : {}),
        ...(imageMimeType ? { imageMimeType } : {}),
      }),
      signal,
      'IMAGE_BACKEND_UNAVAILABLE',
      'The architectural evaluation service is unreachable. Start the backend and try again.',
    );
    return this.outcome(response, 'ARCHITECTURAL_EVALUATION_FAILED');
  }

  private async post(path: string, body: string, signal: AbortSignal | undefined, unavailableCode: string, unavailableMessage: string): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new BackendError(unavailableCode, unavailableMessage, undefined);
    }
  }

  private async outcome<T>(response: Response, fallbackCode: string): Promise<T> {
    const data = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; requestId?: string };
    } & Partial<T>;
    if (!response.ok) {
      throw new BackendError(
        data.error?.code ?? fallbackCode,
        data.error?.message ?? `Request failed with status ${response.status}.`,
        data.error?.requestId,
      );
    }
    return data as T;
  }

  async checkHealth(): Promise<BackendHealthResponse> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/health`, {
        method: 'GET',
      });
      if (response.ok) {
        return (await response.json()) as BackendHealthResponse;
      }
    } catch {
      // Backend unreachable
    }
    return {
      status: 'degraded',
      imageProvider: 'not_configured',
      cloudflare: {
        configured: false,
        reachable: false,
        status: 'UNREACHABLE',
        model: '@cf/black-forest-labs/flux-2-klein-4b',
        detail: 'Backend server is unreachable on port 4200',
      },
      gemini: {
        configured: false,
        reachable: false,
        status: 'UNREACHABLE',
        model: 'gemini-3.6-flash',
        detail: 'Backend server is unreachable on port 4200',
      },
    };
  }

  async runTwoAIGeneration(
    input: TwoAIGenerationInput,
    signal?: AbortSignal,
  ): Promise<TwoAIGenerationResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/generation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new BackendError(
          errorData.error?.code ?? 'GENERATION_FAILED',
          errorData.error?.message ?? `Generation request failed with HTTP ${response.status}`,
        );
      }

      return (await response.json()) as TwoAIGenerationResult;
    } catch (err) {
      if (err instanceof BackendError) throw err;
      throw new BackendError(
        'BACKEND_UNAVAILABLE',
        'Backend server is unreachable on port 4200. Start backend server or use deterministic generator.',
      );
    }
  }

  async resumeTwoAIGeneration(
    input: {
      artifactId: string;
      projectId?: string;
      projectName?: string;
      requirements?: DesignRequirementSpecification;
      isApartment?: boolean;
      apartmentConfig?: ApartmentBriefConfig;
      site?: { plotWidth: number; plotDepth: number; roadFacing: string; setbacks?: { front: number; rear: number; left: number; right: number }; orientation?: number };
    },
    signal?: AbortSignal,
  ): Promise<TwoAIGenerationResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/generation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new BackendError(
          errorData.error?.code ?? 'RESUME_FAILED',
          errorData.error?.message ?? `Resume request failed with HTTP ${response.status}`,
        );
      }

      return (await response.json()) as TwoAIGenerationResult;
    } catch (err) {
      if (err instanceof BackendError) throw err;
      throw new BackendError(
        'BACKEND_UNAVAILABLE',
        'Backend server is unreachable on port 4200. Start backend server or use deterministic generator.',
      );
    }
  }

  async generate(
    input: ReviewedWorkflowInput,
    signal?: AbortSignal,
    onProgress?: (job: GenerationJobProgress) => void,
  ): Promise<GenerationWorkflowResult & { readonly requestHash: string }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/generation/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      });

      if (response.ok) {
        return (await response.json()) as GenerationWorkflowResult & { readonly requestHash: string };
      }
    } catch {
      // Standalone client-side fallback
    }

    return await runGenerationWorkflow(input, (stage: GenerationStageId, state: 'ACTIVE' | 'COMPLETE') => {
      onProgress?.({
        stage,
        status: state === 'COMPLETE' ? 'SUCCEEDED' : 'ACTIVE',
      });
    });
  }
}

export interface BackendHealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly imageProvider: 'configured' | 'not_configured';
  readonly cloudflare: {
    readonly configured: boolean;
    readonly reachable: boolean;
    readonly status: string;
    readonly model: string;
    readonly detail?: string;
  };
  readonly gemini: {
    readonly configured: boolean;
    readonly reachable: boolean;
    readonly status: string;
    readonly model: string;
    readonly detail?: string;
  };
}

export interface TwoAIGenerationInput {
  readonly projectId: string;
  readonly projectName?: string;
  readonly projectType?: 'apartment' | 'residential_independent';
  readonly apartmentConfig?: ApartmentBriefConfig;
  readonly site: {
    readonly plotWidth: number;
    readonly plotDepth: number;
    readonly plannedFloorCount?: number;
    readonly roadFacing: string;
    readonly setbacks?: { front: number; rear: number; left: number; right: number };
    readonly orientation?: number;
  };
  readonly roomCounts: {
    readonly bedrooms: number;
    readonly bathrooms: number;
    readonly living?: number;
    readonly dining?: number;
    readonly kitchen?: number;
    readonly floors?: number;
    readonly balcony?: number;
  };
  readonly preferences?: {
    readonly vastu?: boolean;
    readonly garden?: boolean;
    readonly parking?: boolean;
    readonly fullPlotCoverage?: boolean;
  };
  readonly additionalPrompt?: string;
  readonly seed?: number;
  readonly candidateCount?: number;
}

/** FLUX = visual came from FLUX; FALLBACK_DETERMINISTIC = deterministic base plan (never FLUX). */
export type CandidateSource = 'FLUX' | 'FALLBACK_DETERMINISTIC';
export type CandidateVisualSource = 'FLUX_IMAGE' | 'DETERMINISTIC_SCHEMATIC';
export type CandidateRejectionStage = 'VISUAL_PREFLIGHT' | 'HARD_VALIDATION';

/** Why a candidate does or does not carry an advisory score (Phase 5). */
export type EvaluationStatus = 'SCORED' | 'NOT_SCORED_REJECTED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

/** Real per-stage pipeline state reported by the server (Phase 5). */
export interface PipelineStagesState {
  readonly imageGeneration: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'EXHAUSTED';
  readonly imageArtifact: 'PENDING' | 'AVAILABLE' | 'FAILED';
  readonly visualPreflight?: 'PENDING' | 'RUNNING' | 'PASSED' | 'REJECTED' | 'UNAVAILABLE' | 'SKIPPED';
  readonly imageInterpretation: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TEMPORARILY_UNAVAILABLE' | 'AUTH_ERROR' | 'SKIPPED';
  readonly imageTo2D: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  readonly validation: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  readonly geminiEvaluation: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'SKIPPED' | 'FAILED';
}

export interface OrchestratedCandidateResult {
  readonly id: string;
  readonly seed: number;
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly evaluationStatus?: EvaluationStatus;
  readonly stages?: PipelineStagesState;
  /** Optional for responses produced before Phase 3; absent is treated as FLUX. */
  readonly source?: CandidateSource;
  readonly visualSource?: CandidateVisualSource;
  readonly attempt?: number;
  readonly rejectionStage?: CandidateRejectionStage | null;
  readonly building: Building | null;
  readonly artifact: StoredPlanImageArtifact;
  readonly validation: {
    readonly isValid: boolean;
    readonly recommendedForEditing: boolean;
    readonly geometryHealthy: boolean;
    /** null = not validated/accepted. Never an architectural score. */
    readonly overallScore: number | null;
    readonly verificationIssues: readonly { code: string; severity: string; message: string }[];
  };
  /** Real Gemini architectural evaluation; null = NOT SCORED. */
  readonly evaluation: ArchitecturalScore | null;
  readonly preflight?: {
    readonly pass: boolean;
    readonly failureReasons: readonly string[];
    readonly matchingSummary: string;
  };
  readonly diagnostics: readonly { code: string; severity: string; message: string }[];
  readonly rejectedReason: string | null;
  /** Apartment concept mode: which controlled strategy produced this candidate. */
  readonly concept?: CandidateConceptInfo;
}

export type ApartmentConceptStrategyId = 'balanced' | 'daylight' | 'privacy' | 'circulation';

export interface CandidateConceptInfo {
  readonly candidateNumber: number;
  readonly candidateCount: number;
  readonly strategy: ApartmentConceptStrategyId;
  readonly label: string;
  readonly intent: string;
  readonly slotSeed: number;
  /** Deterministic schematic sent to FLUX as input image 1 (PNG base64). */
  readonly schematicPngBase64: string;
  readonly spatialChecksPassed: number;
  readonly spatialChecksTotal: number;
  readonly referenceIds: readonly string[];
}

export interface ConceptSlotRecord {
  readonly candidateNumber: number;
  readonly strategy: ApartmentConceptStrategyId;
  readonly label: string;
  readonly seed: number;
  readonly status: 'GENERATED' | 'GENERATION_FAILED';
  readonly candidateId: string | null;
  readonly referenceIds: readonly string[];
  readonly error?: string;
}

export interface DeterministicFallbackInfo {
  readonly used: boolean;
  readonly reason: string;
  readonly message: string;
  readonly fluxAttempts: number;
  readonly maxVisualAttemptsPerCandidate: number;
  readonly rejectedCandidateIds: readonly string[];
  readonly rejectedArtifactIds: readonly string[];
  readonly fallbackCandidateId: string;
  readonly fallbackArtifactId: string;
  readonly measured: { readonly flats: number; readonly lifts: number; readonly stairs: number; readonly commonLobby: boolean };
  readonly required: { readonly flats: number; readonly lifts: number; readonly stairs: number; readonly commonLobby: boolean };
}

export interface TwoAIGenerationResult {
  readonly success: boolean;
  readonly projectId: string;
  readonly requirements: DesignRequirementSpecification;
  readonly feasibility: any;
  readonly candidates: readonly OrchestratedCandidateResult[];
  readonly latencyMs: number;
  readonly savedArtifact?: StoredPlanImageArtifact;
  readonly apartmentSchematic?: any;
  readonly apartmentRulesProfile?: any;
  readonly stages?: PipelineStagesState;
  readonly candidateSource?: CandidateSource | null;
  readonly fallback?: DeterministicFallbackInfo;
  readonly visualAttempts?: { readonly maxPerCandidate: number; readonly attempted: number; readonly seeds: readonly number[] };
  /** Apartment concept mode (up to four controlled strategies). */
  readonly conceptMode?: boolean;
  readonly conceptSlots?: readonly ConceptSlotRecord[];
  readonly error?: {
    readonly code: string;
    readonly stage: string;
    readonly message: string;
    readonly reasons?: readonly string[];
    readonly warnings?: readonly string[];
    readonly fallbackAvailable?: boolean;
    readonly artifactId?: string;
    readonly artifact?: StoredPlanImageArtifact;
    readonly isTransient?: boolean;
  };
}

