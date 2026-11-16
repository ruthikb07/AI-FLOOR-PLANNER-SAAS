/** Provider-neutral requirement parsing with a deterministic safety fallback. */

import type { AIProvider, Building, DesignRequirementSpecification, EditOperation } from '@ai-floor-planner/core';
import { AITaskType } from '@ai-floor-planner/core';
import { RuleBasedRequirementParser } from '../providers/rule-based';
import { REQUIREMENT_EXTRACTION_PROMPT } from '../requirements/schema';
import { validateRequirementPayload } from '../requirements/validation';
import { extractAIEditContext } from '../editing/context';
import { RuleBasedEditParser, type LocalEditParseOptions } from '../editing/parser';
import { AI_EDIT_RESPONSE_SCHEMA, AI_EDIT_SYSTEM_PROMPT } from '../editing/schema';
import type { AIEditDiagnostic, AIEditParseResult } from '../editing/types';
import { validateAIEditPayload } from '../editing/validation';
import {
  generateArchitecturalProposal,
  type ArchitecturalProposalResult,
  type GenerateArchitecturalProposalOptions,
} from './architectural-proposal';

export type RequirementParseSource = 'provider' | 'rule_based' | 'rule_based_fallback';

export interface RequirementParseDiagnostic {
  readonly code: 'EMPTY_PROMPT' | 'PROMPT_TRUNCATED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_PROVIDER_OUTPUT';
  readonly severity: 'info' | 'warning';
  readonly message: string;
}

export interface RequirementParseResult {
  readonly requirements: DesignRequirementSpecification;
  readonly source: RequirementParseSource;
  readonly providerName: string | null;
  readonly model: string | null;
  readonly usedFallback: boolean;
  readonly diagnostics: readonly RequirementParseDiagnostic[];
  readonly latencyMs: number;
}

export interface AIOrchestrationOptions {
  readonly providerTimeoutMs?: number;
  readonly maxPromptLength?: number;
}

export class AIOrchestrationService {
  private readonly ruleParser = new RuleBasedRequirementParser();
  private readonly editParser = new RuleBasedEditParser();
  private readonly timeoutMs: number;
  private readonly maxPromptLength: number;

  constructor(
    private readonly provider?: AIProvider,
    options: AIOrchestrationOptions = {},
  ) {
    this.timeoutMs = options.providerTimeoutMs ?? 16000;
    this.maxPromptLength = options.maxPromptLength ?? 5000;
  }

  /** Backwards-compatible API consumed by Phases 1-7. */
  async parseRequirements(prompt: string): Promise<DesignRequirementSpecification> {
    return (await this.parseRequirementsDetailed(prompt)).requirements;
  }

  /** Parse with auditable provider/fallback provenance for Phase 8 UI and logs. */
  async parseRequirementsDetailed(prompt: string): Promise<RequirementParseResult> {
    const startedAt = Date.now();
    const diagnostics: RequirementParseDiagnostic[] = [];
    const trimmed = prompt.trim();
    const safePrompt = (trimmed || '30x50 2BHK').slice(0, this.maxPromptLength);

    if (!trimmed) {
      diagnostics.push({ code: 'EMPTY_PROMPT', severity: 'info', message: 'An empty description was replaced with the safe 30×50 2BHK baseline.' });
    }
    if (trimmed.length > this.maxPromptLength) {
      diagnostics.push({ code: 'PROMPT_TRUNCATED', severity: 'warning', message: `Input was limited to ${this.maxPromptLength} characters before parsing.` });
    }

    if (!this.provider) {
      return this.localResult(safePrompt, 'rule_based', diagnostics, startedAt);
    }

    const providerName = this.provider.name;
    const model = this.provider.getModelInfo().model;
    try {
      if (!(await this.provider.isAvailable())) {
        diagnostics.push({ code: 'PROVIDER_UNAVAILABLE', severity: 'warning', message: `${providerName} is not configured; deterministic parsing was used.` });
        return this.localResult(safePrompt, 'rule_based_fallback', diagnostics, startedAt, providerName, model);
      }

      const providerResponse = await this.withTimeout(this.provider.complete({
        taskType: AITaskType.RequirementExtraction,
        systemPrompt: REQUIREMENT_EXTRACTION_PROMPT,
        userPrompt: safePrompt,
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 1800,
      }));
      const validation = validateRequirementPayload(providerResponse.parsed, safePrompt);
      if (!validation.valid || !validation.requirements) {
        diagnostics.push({
          code: 'INVALID_PROVIDER_OUTPUT',
          severity: 'warning',
          message: `Provider output failed ${validation.errors.length} validation check${validation.errors.length === 1 ? '' : 's'}; deterministic parsing was used.`,
        });
        return this.localResult(safePrompt, 'rule_based_fallback', diagnostics, startedAt, providerName, providerResponse.model);
      }

      return {
        requirements: validation.requirements,
        source: 'provider',
        providerName,
        model: providerResponse.model,
        usedFallback: false,
        diagnostics,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.message === 'AI requirement provider timed out.';
      diagnostics.push({
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
        severity: 'warning',
        message: timedOut
          ? `${providerName} exceeded the parsing time limit; deterministic parsing was used.`
          : `${providerName} could not safely parse this description; deterministic parsing was used.`,
      });
      return this.localResult(safePrompt, 'rule_based_fallback', diagnostics, startedAt, providerName, model);
    }
  }

  /** Backwards-compatible core orchestration contract for Phase 9. */
  async parseEditCommand(command: string, context: Building): Promise<readonly EditOperation[]> {
    const parsed = await this.parseEditCommandDetailed(command, context);
    if (!parsed.intent) return [];
    const operationType = parsed.intent.action === 'resize_room' ? 'resize'
      : parsed.intent.action === 'move_room' ? 'move'
        : 'modify';
    return [{
      type: operationType,
      changes: { ...parsed.intent },
      reasoning: parsed.intent.reasoning,
    }];
  }

  async parseEditCommandDetailed(
    command: string,
    building: Building,
    options: LocalEditParseOptions = {},
  ): Promise<AIEditParseResult> {
    const startedAt = Date.now();
    const diagnostics: AIEditDiagnostic[] = [];
    const safeCommand = command.trim().slice(0, 1000);
    if (!safeCommand) {
      diagnostics.push({ code: 'EMPTY_COMMAND', severity: 'info', message: 'Enter an edit instruction.' });
      return this.localEditResult('', building, options, 'rule_based', diagnostics, startedAt);
    }
    if (!this.provider) return this.localEditResult(safeCommand, building, options, 'rule_based', diagnostics, startedAt);

    const providerName = this.provider.name;
    const model = this.provider.getModelInfo().model;
    try {
      if (!(await this.provider.isAvailable())) {
        diagnostics.push({ code: 'PROVIDER_UNAVAILABLE', severity: 'warning', message: `${providerName} is not configured; deterministic edit parsing was used.` });
        return this.localEditResult(safeCommand, building, options, 'rule_based_fallback', diagnostics, startedAt, providerName, model);
      }
      const context = extractAIEditContext(building, options.activeFloorId, options.selectedRoomId);
      const response = await this.withTimeout(this.provider.complete({
        taskType: AITaskType.NaturalLanguageEdit,
        systemPrompt: AI_EDIT_SYSTEM_PROMPT,
        userPrompt: `Instruction: ${safeCommand}\n\n${context.promptSummary}`,
        responseFormat: 'json',
        responseSchema: AI_EDIT_RESPONSE_SCHEMA,
        responseSchemaName: 'floor_plan_edit',
        temperature: 0,
        maxTokens: 800,
      }), 'AI edit provider timed out.');
      const validated = validateAIEditPayload(response.parsed);
      if (!validated.intent) {
        diagnostics.push({ code: 'INVALID_PROVIDER_OUTPUT', severity: 'warning', message: `Provider edit failed ${validated.errors.length} validation check${validated.errors.length === 1 ? '' : 's'}; deterministic parsing was used.` });
        return this.localEditResult(safeCommand, building, options, 'rule_based_fallback', diagnostics, startedAt, providerName, response.model);
      }
      return {
        intent: validated.intent,
        source: 'provider',
        providerName,
        model: response.model,
        usedFallback: false,
        diagnostics,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.message === 'AI edit provider timed out.';
      diagnostics.push({
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
        severity: 'warning',
        message: timedOut
          ? `${providerName} exceeded the edit parsing time limit; deterministic parsing was used.`
          : `${providerName} could not safely parse this edit; deterministic parsing was used.`,
      });
      return this.localEditResult(safeCommand, building, options, 'rule_based_fallback', diagnostics, startedAt, providerName, model);
    }
  }

  async proposeArchitecture(
    input: GenerateArchitecturalProposalOptions,
  ): Promise<ArchitecturalProposalResult> {
    return generateArchitecturalProposal(this.provider, input);
  }

  private localResult(
    prompt: string,
    source: 'rule_based' | 'rule_based_fallback',
    diagnostics: readonly RequirementParseDiagnostic[],
    startedAt: number,
    providerName: string | null = null,
    model: string | null = null,
  ): RequirementParseResult {
    return {
      requirements: this.ruleParser.parse(prompt),
      source,
      providerName,
      model,
      usedFallback: source === 'rule_based_fallback',
      diagnostics,
      latencyMs: Date.now() - startedAt,
    };
  }

  private localEditResult(
    command: string,
    building: Building,
    options: LocalEditParseOptions,
    source: 'rule_based' | 'rule_based_fallback',
    diagnostics: AIEditDiagnostic[],
    startedAt: number,
    providerName: string | null = null,
    model: string | null = null,
  ): AIEditParseResult {
    const parsed = this.editParser.parse(command, building, options);
    if (!parsed.intent && parsed.message && !diagnostics.some(diagnostic => diagnostic.code === 'EMPTY_COMMAND')) {
      diagnostics.push({ code: 'UNSUPPORTED_COMMAND', severity: 'info', message: parsed.message });
    }
    return {
      intent: parsed.intent,
      source,
      providerName,
      model,
      usedFallback: source === 'rule_based_fallback',
      diagnostics,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMessage = 'AI requirement provider timed out.'): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), this.timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
