import {
  GeminiExecutionError,
  redactSecret,
  resolveModelThinkingParameters,
  type BaseAIProvider,
} from '@ai-floor-planner/ai-orchestration';
import {
  AITaskType,
  type AIInvocationMode,
  type Building,
  type GenerationControlState,
  type TokenUsage,
} from '@ai-floor-planner/core';
import {
  parseCadEditInstructionDeterministically,
  proposeControlledCadEdit,
  type CadAiEditProposalResult,
  type CadEditIntent,
} from '@ai-floor-planner/planning-engine';
import { buildingInputError, isRecord } from './http-input.js';

const CAD_EDIT_INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: [
        'RESIZE_ROOM_AREA',
        'MOVE_OPENING',
        'ADJUST_PARTITION_OR_PASSAGE',
        'RESIZE_OPENING',
        'LOCALIZED_FLAT_REGENERATION',
      ],
    },
    targetRoomQuery: { type: 'string' },
    targetUnitIndex: { type: 'integer' },
    targetEntityId: { type: 'string' },
    targetOpeningKind: { type: 'string', enum: ['door', 'window'] },
    targetWidthMm: { type: 'number' },
    shiftMm: { type: 'number' },
    moveOpeningMode: { type: 'string', enum: ['TOWARDS_CORNER', 'CENTER', 'SHIFT_MM'] },
    areaDeltaPercent: { type: 'number' },
    targetAreaSqM: { type: 'number' },
    targetAreaSqFt: { type: 'number' },
    targetAreaMm2: { type: 'number' },
    variantIndex: { type: 'integer' },
    localScope: {
      type: 'string',
      enum: ['SINGLE_FLAT', 'SINGLE_ROOM', 'CONNECTED_ROOM_GROUP', 'EDITABLE_ZONE'],
    },
    localOperation: {
      type: 'string',
      enum: [
        'REGENERATE_ALTERNATIVE',
        'RELOCATE_KITCHEN',
        'CONVERT_BHK',
        'RESIZE_MASTER_BEDROOM',
        'RECONFIGURE_LIVING_DINING',
        'REGENERATE_ROOM',
      ],
    },
    targetBhk: { type: 'string', enum: ['1BHK', '2BHK', '3BHK', '4BHK'] },
  },
};

export interface CadEditProposalApiResponse {
  readonly proposal: CadAiEditProposalResult;
  readonly aiTelemetry: {
    readonly geminiInvoked: boolean;
    readonly invocationMode: AIInvocationMode;
    readonly reasoningMode: 'FAST';
    readonly interpretationSource: 'GEMINI_ASSISTED' | 'DETERMINISTIC';
    readonly modelUsed?: string;
    readonly apiCallCount: number;
    readonly fallbackReason?: string;
    readonly latencyMs: number;
    readonly tokenUsage?: TokenUsage;
    readonly currentRequestTokenUsage: TokenUsage | 'UNKNOWN';
  };
}

type IntentField = { readonly type: string; readonly enum?: readonly string[] };
const intentFields = CAD_EDIT_INTENT_SCHEMA.properties as Record<string, IntentField>;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const revisionNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseCadIntent(value: unknown): CadEditIntent | undefined {
  if (!isRecord(value) || typeof value.action !== 'string') return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(intentFields, key)) return undefined;
    const field = intentFields[key]!;
    if (field.type === 'string') {
      if (!identifier(entry) || (field.enum && !field.enum.includes(entry))) return undefined;
    } else {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
      if (field.type === 'integer' && !revisionNumber(entry)) return undefined;
      if (['targetAreaMm2', 'targetAreaSqM', 'targetAreaSqFt', 'targetWidthMm', 'targetUnitIndex'].includes(key)
        && entry <= 0) return undefined;
      if (key === 'areaDeltaPercent' && entry <= -100) return undefined;
    }
  }
  if (value.action === 'RESIZE_OPENING' && value.targetWidthMm === undefined) return undefined;
  if (value.moveOpeningMode === 'SHIFT_MM' && value.shiftMm === undefined) return undefined;
  return value as unknown as CadEditIntent;
}

function isControl(value: unknown): value is GenerationControlState {
  return isRecord(value) && value.schemaVersion === 1 && identifier(value.revisionId)
    && value.footprintLocked === true && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt))
    && [value.lockedEntityIds, value.lockedFloorIds, value.protectedCoreIds].every(list =>
      Array.isArray(list) && list.every(identifier));
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export async function handleCadEditProposal(
  body: unknown,
  deps: { readonly gemini: BaseAIProvider | null; readonly briefInterpreterKind: 'gemini' | 'local-stub' },
  runtimeOptions: { readonly signal?: AbortSignal } = {},
): Promise<{ status: number; json: CadEditProposalApiResponse | { error: { code: string; message: string } } }> {
  if (!isRecord(body)) {
    return {
      status: 400,
      json: {
        error: { code: 'INVALID_REQUEST', message: 'Expected JSON object with building, floorId, and instruction.' },
      },
    };
  }

  if (buildingInputError(body.building)) {
    return {
      status: 400,
      json: { error: { code: 'INVALID_BUILDING', message: 'A valid canonical Building payload is required.' } },
    };
  }
  const building = body.building as Building;
  const { floorId, expectedRevision, expectedRevisionDigest, control, selectedEntityId } = body;
  if (!identifier(floorId) || !building.floors.some(floor => floor.id === floorId)) {
    return {
      status: 400,
      json: { error: { code: 'INVALID_FLOOR_ID', message: 'Select a floor in the canonical building.' } },
    };
  }
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  let parsedIntent = parseCadIntent(body.parsedIntent);
  if ((selectedEntityId !== undefined && !identifier(selectedEntityId))
    || (expectedRevision !== undefined && !revisionNumber(expectedRevision))
    || (expectedRevisionDigest !== undefined && (typeof expectedRevisionDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedRevisionDigest)))
    || (control !== undefined && !isControl(control))
    || (body.instruction !== undefined && (typeof body.instruction !== 'string' || body.instruction.length > 32_000))
    || (body.parsedIntent !== undefined && !parsedIntent)
    || (!instruction && !parsedIntent)) {
    return {
      status: 400,
      json: { error: { code: 'INVALID_CAD_EDIT', message: 'Check the selected entity, revision, locks and edit intent.' } },
    };
  }

  if (runtimeOptions.signal?.aborted) {
    return {
      status: 499,
      json: { error: { code: 'REQUEST_CANCELLED', message: 'CAD edit proposal cancelled.' } },
    };
  }

  const startedAt = Date.now();
  let intentSource: 'GEMINI_ASSISTED' | 'DETERMINISTIC' = 'DETERMINISTIC';
  let invocationMode: AIInvocationMode = 'DETERMINISTIC_FALLBACK';
  let geminiInvoked = false;
  let apiCallCount = 0;
  let modelUsed: string | undefined;
  let fallbackReason: string | undefined;
  let tokenUsage: TokenUsage | undefined = ZERO_USAGE;
  let currentRequestTokenUsage: TokenUsage | 'UNKNOWN' = ZERO_USAGE;

  if (!parsedIntent && deps.gemini && deps.briefInterpreterKind === 'gemini') {
    const modelInfo = deps.gemini.getModelInfo();
    const resolvedReasoning = resolveModelThinkingParameters(modelInfo.model, 'FAST', {
      taskKind: 'CAD_EDIT_INTENT',
    });
    geminiInvoked = true;
    try {
      const response = await deps.gemini.complete({
        taskType: AITaskType.NaturalLanguageEdit,
        systemPrompt:
          'Extract one structured architectural CAD edit operation from the user instruction. Never invent coordinates; classify into RESIZE_ROOM_AREA, MOVE_OPENING, ADJUST_PARTITION_OR_PASSAGE, RESIZE_OPENING, or LOCALIZED_FLAT_REGENERATION.',
        userPrompt: `Selected entity: ${selectedEntityId ?? 'none'}\nInstruction: ${instruction}`,
        responseFormat: 'json',
        responseSchema: CAD_EDIT_INTENT_SCHEMA,
        responseSchemaName: 'cad_edit_intent',
        temperature: 0,
        maxTokens: resolvedReasoning.maxOutputTokens,
        reasoningMode: 'FAST',
        ...(resolvedReasoning.includeThinkingConfig && resolvedReasoning.thinkingBudget !== undefined
          ? { thinkingBudget: resolvedReasoning.thinkingBudget }
          : {}),
        signal: runtimeOptions.signal,
      });
      apiCallCount = response.apiCallCount ?? 1;
      const decoded: unknown =
        response.parsed ??
        (response.content.trim().startsWith('{') ? JSON.parse(response.content) : null);
      const validatedIntent = parseCadIntent(decoded);
      if (validatedIntent) {
        parsedIntent = { ...validatedIntent, targetEntityId: selectedEntityId };
        intentSource = 'GEMINI_ASSISTED';
        invocationMode = 'LIVE_PROVIDER';
        modelUsed = response.model;
        tokenUsage = response.usage;
        currentRequestTokenUsage = response.usage;
      } else {
        invocationMode = 'PROVIDER_FAILURE';
        tokenUsage = response.usage;
        currentRequestTokenUsage = response.usage;
        fallbackReason = 'INVALID_STRUCTURED_EDIT_INTENT';
      }
    } catch (err) {
      invocationMode = runtimeOptions.signal?.aborted ? 'CANCELLED' : 'PROVIDER_FAILURE';
      apiCallCount = err instanceof GeminiExecutionError ? err.apiCallCount : 1;
      tokenUsage = undefined;
      currentRequestTokenUsage = 'UNKNOWN';
      fallbackReason = err instanceof Error ? redactSecret(err.message).slice(0, 120) : 'GEMINI_EDIT_PARSE_FAILED';
    }
  } else if (!parsedIntent && !deps.gemini) {
    fallbackReason = 'GEMINI_NOT_CONFIGURED';
  }

  if (runtimeOptions.signal?.aborted) {
    return {
      status: 499,
      json: { error: { code: 'REQUEST_CANCELLED', message: 'CAD edit proposal cancelled.' } },
    };
  }

  if (!parsedIntent) {
    parsedIntent = parseCadEditInstructionDeterministically(instruction, selectedEntityId);
    intentSource = 'DETERMINISTIC';
  }

  const proposal = proposeControlledCadEdit({
    building,
    floorId,
    control,
    expectedRevision,
    expectedRevisionDigest,
    selectedEntityId,
    instruction,
    parsedIntent,
    intentSource,
  });

  return {
    status: 200,
    json: {
      proposal,
      aiTelemetry: {
        geminiInvoked,
        invocationMode,
        reasoningMode: 'FAST',
        interpretationSource: intentSource,
        ...(modelUsed ? { modelUsed } : {}),
        apiCallCount,
        ...(fallbackReason ? { fallbackReason } : {}),
        latencyMs: Date.now() - startedAt,
        ...(tokenUsage ? { tokenUsage } : {}),
        currentRequestTokenUsage,
      },
    },
  };
}
