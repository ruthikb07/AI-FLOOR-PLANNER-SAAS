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
}

/** Information about a model. */
export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
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
}

/** An AI response. */
export interface AIResponse {
  readonly content: string;
  readonly parsed?: Record<string, unknown>;
  readonly usage: TokenUsage;
  readonly model: string;
  readonly latencyMs: number;
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
