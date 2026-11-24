/**
 * AI orchestration types.
 * Defines interfaces for AI providers, requests, responses, and edit operations.
 */

import type { AITaskType } from './enums';
import type { Building } from './building';
import type { DesignPreferences } from './requirements';
import type { DesignRequirementSpecification } from './design-intelligence';
import type { PlanScore } from './constraints';

// ─── Provider Interface ─────────────────────────────────────────────────────

/** Token usage for an AI request. */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly thoughtsTokens?: number;
}

/** Application-level AI reasoning policy modes. */
export type AIReasoningMode = 'FAST' | 'BALANCED' | 'DEEP';

/** Precise invocation classification for provider, cache, shared in-flight, fallback, failure, and cancellation paths. */
export type AIInvocationMode =
  | 'LIVE_PROVIDER'
  | 'CACHED_PROVIDER_RESPONSE'
  | 'SHARED_IN_FLIGHT_REQUEST'
  | 'DETERMINISTIC_FALLBACK'
  | 'PROVIDER_FAILURE'
  | 'CANCELLED';

/** Granular failure classification for provider resilience and quota cooldowns. */
export type GeminiFailureClass =
  | 'MODEL_QUOTA_EXHAUSTED'
  | 'PROJECT_QUOTA_EXHAUSTED'
  | 'AUTH_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'TRUNCATED_OR_INVALID_STRUCTURED_OUTPUT'
  | 'OUTPUT_TOKEN_EXHAUSTED'
  | 'UNSUPPORTED_THINKING_CONFIG'
  | 'REQUEST_ERROR';

/** Per-attempt failure record preserving partial or unknown token consumption honestly. */
export interface FailedAttemptTelemetry {
  readonly model: string;
  readonly errorCode: string;
  readonly failureClass: GeminiFailureClass;
  readonly latencyMs: number;
  readonly tokenUsage: TokenUsage | 'UNKNOWN';
}

/** Classification of interpreted architectural brief requirements. */
export type BriefRequirementCategory =
  | 'MANDATORY'
  | 'USER_PREFERENCE'
  | 'AI_SUGGESTION'
  | 'DEFAULT'
  | 'INFERRED_CONSTRAINT'
  | 'JURISDICTION_VERIFICATION_REQUIRED';

export interface StructuredBriefRequirementItem {
  readonly key: string;
  readonly category: BriefRequirementCategory;
  readonly value: string | number | boolean | readonly string[];
  readonly source: 'USER_CONFIG' | 'USER_PROMPT' | 'REFERENCE_IMAGE' | 'AI_PROPOSAL' | 'SYSTEM_DEFAULT' | 'REGULATORY_RULE';
  readonly summary: string;
}

export interface BriefRequirementConflict {
  readonly code:
    | 'CONFLICTING_UNIT_COUNT'
    | 'CONFLICTING_OTS_DIRECTIVE'
    | 'CONFLICTING_LOCKED_MASSING'
    | 'CONFLICTING_BALCONY_DIRECTIVE'
    | 'REFERENCE_OVERRIDDEN_BY_BRIEF';
  readonly resolution: 'USER_CONFIG_PRECEDENCE' | 'EXPLICIT_BRIEF_PRECEDENCE' | 'BLOCKS_PUBLICATION';
  readonly message: string;
}

export interface StructuredBriefInterpretation {
  readonly schemaVersion: 1;
  readonly items: readonly StructuredBriefRequirementItem[];
  readonly conflicts: readonly BriefRequirementConflict[];
}

export type ReferenceAttachmentDisposition =
  | 'NONE'
  | 'VISION_INLINE_ATTACHED'
  | 'ADVISORY_METADATA_ONLY'
  | 'UNSUPPORTED_FORMAT'
  | 'MALFORMED_DATA';

/** Sanitized generation telemetry shared across backend, canonical metadata, and UI. */
export interface AIProposalTelemetry {
  readonly geminiInvoked: boolean;
  readonly invocationMode?: AIInvocationMode;
  readonly reasoningMode?: AIReasoningMode;
  readonly appliedThinkingBudget?: number;
  readonly provider: string;
  readonly requestedModel?: string;
  readonly modelUsed?: string;
  readonly attemptedModels?: readonly string[];
  readonly apiCallCount?: number;
  readonly cacheHit?: boolean;
  readonly sharedInFlight?: boolean;
  readonly latencyMs?: number;
  readonly providerExecutionMs?: number;
  readonly solverLatencyMs?: number;
  readonly totalLatencyMs?: number;
  /** Token consumption attributable to this specific request (0 on cache hit or shared follower; undefined when UNKNOWN). */
  readonly tokenUsage?: TokenUsage;
  /** Explicit current-request token consumption or 'UNKNOWN' when a failed provider call did not report usage. */
  readonly currentRequestTokenUsage?: TokenUsage | 'UNKNOWN';
  /** Original provider-reported token usage that produced the proposal (preserved across cache hits & shared requests). */
  readonly proposalTokenUsage?: TokenUsage | 'UNKNOWN';
  readonly failedAttempts?: readonly FailedAttemptTelemetry[];
  readonly fallbackReason?: string;
  readonly fallbackTriggered?: boolean;
  readonly providerErrorCode?: string;
  readonly failureClass?: GeminiFailureClass;
  readonly interpretationSource?: 'GEMINI' | 'DETERMINISTIC';
  readonly influencedGeometry?: boolean;
  readonly referenceDisposition?: ReferenceAttachmentDisposition;
  readonly referenceGuidanceApplied?: readonly string[];
  readonly referenceGuidanceRejected?: readonly string[];
  readonly referenceImageUsedForGeometry: boolean;
  readonly conflictsDetected?: readonly BriefRequirementConflict[];
  readonly interpretedRequirements?: StructuredBriefInterpretation;
}

/** Information about a model. */
export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly fallbackModels?: readonly string[];
  /** Non-secret hash of provider endpoint, fallback list, deadline, and retry policy. */
  readonly configFingerprint?: string;
  readonly contextWindow: number;
  readonly supportsJson: boolean;
  readonly supportsStreaming: boolean;
}

/**
 * An explicit image input for multimodal requests (recovery Phase 4, P8).
 * Images travel as typed parts — never embedded in prompt text.
 */
export interface AIImageInput {
  /** IANA media type, e.g. image/png or image/jpeg. */
  readonly mimeType: string;
  /** Raw base64 bytes (no data-URL prefix, no whitespace requirements). */
  readonly data: string;
}

/** An AI request payload. */
export interface AIRequest {
  readonly taskType: AITaskType;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Explicit image parts sent alongside the text prompt (vision tasks). */
  readonly images?: readonly AIImageInput[];
  readonly context?: AIContext;
  readonly responseFormat?: 'json' | 'text';
  /** Optional strict JSON schema selected by the orchestration task. */
  readonly responseSchema?: Record<string, unknown>;
  readonly responseSchemaName?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Application-level reasoning policy (FAST, BALANCED, DEEP) resolved per model capability. */
  readonly reasoningMode?: AIReasoningMode;
  /** Optional explicit thinking token budget override. */
  readonly thinkingBudget?: number;
  /** Optional overall deadline (ms) covering primary, fallback, retries, and bounded recovery. */
  readonly totalDeadlineMs?: number;
  /** Optional hard cap on total HTTP attempts across all models and recoveries. */
  readonly maxTotalAttempts?: number;
  /** Optional cancellation signal propagated to network fetch. */
  readonly signal?: AbortSignal;
}

/** An AI response. */
export interface AIResponse {
  readonly content: string;
  readonly parsed?: Record<string, unknown>;
  readonly usage: TokenUsage;
  readonly model: string;
  readonly latencyMs: number;
  readonly finishReason?: string;
  readonly reasoningMode?: AIReasoningMode;
  readonly appliedThinkingBudget?: number;
  readonly fallbackFromErrorCode?: string;
  readonly attemptedModels?: readonly string[];
  readonly apiCallCount?: number;
  readonly failedAttempts?: readonly FailedAttemptTelemetry[];
}

/** A streaming AI response chunk. */
export interface AIChunk {
  readonly content: string;
  readonly isComplete: boolean;
}

/** Context provided to AI requests (only what's needed for the task). */
export interface AIContext {
  readonly plotDimensions?: { width: number; depth: number };
  readonly roomSummary?: readonly RoomSummary[];
  readonly currentScores?: PlanScore;
  readonly userPreferences?: DesignPreferences;
  readonly editHistory?: readonly string[];
}

/** Simplified room summary for AI context. */
export interface RoomSummary {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly area: number;
}

// ─── AI Provider Contract ───────────────────────────────────────────────────

/** Interface every AI provider must implement. */
export interface AIProvider {
  readonly name: string;
  complete(request: AIRequest): Promise<AIResponse>;
  stream(request: AIRequest): AsyncIterable<AIChunk>;
  isAvailable(): Promise<boolean>;
  getModelInfo(): ModelInfo;
}

// ─── AI Orchestration Contract ──────────────────────────────────────────────

/** The public interface of the AI Orchestration layer. */
export interface AIOrchestration {
  parseRequirements(naturalLanguage: string): Promise<DesignRequirementSpecification>;
  parseEditCommand(command: string, context: Building): Promise<readonly EditOperation[]>;
  critiquePlan(building: Building, score: PlanScore): Promise<DesignCritique>;
  explainPlan(building: Building): Promise<string>;
}

// ─── Edit Operations ────────────────────────────────────────────────────────

/** Types of edit operations that AI can propose. */
export type EditOperationType = 'move' | 'resize' | 'add' | 'remove' | 'modify';

/** A structured edit operation proposed by AI. */
export interface EditOperation {
  readonly type: EditOperationType;
  readonly targetId?: string;
  readonly changes: Record<string, unknown>;
  readonly reasoning: string;
}

/** AI critique of a plan with suggestions. */
export interface DesignCritique {
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly suggestions: readonly string[];
  readonly overallAssessment: string;
}

// ─── Quota & Cost ───────────────────────────────────────────────────────────

/** User's AI usage quota status. */
export interface QuotaStatus {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly resetsAt: string;
}

/** Estimated cost for an AI request. */
export interface CostEstimate {
  readonly estimatedTokens: number;
  readonly estimatedCostUsd: number;
  readonly provider: string;
  readonly model: string;
}
