import {
  GeminiExecutionError,
  resolveModelThinkingParameters,
  type BaseAIProvider,
} from '@ai-floor-planner/ai-orchestration';
import {
  AITaskType,
  validateBuildingSchema,
  type AIInvocationMode,
  type Building,
  type GenerationControlState,
  type TokenUsage,
} from '@ai-floor-planner/core';
import {
  parseCadEditInstructionDeterministically,
  proposeControlledCadEdit,
  type CadAiEditProposalResult,
  type CadEditAction,
  type CadEditIntent,
} from '@ai-floor-planner/planning-engine';

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
    targetOpeningKind: { type: 'string', enum: ['door', 'window'] },
    targetWidthMm: { type: 'number' },
    shiftMm: { type: 'number' },
    moveOpeningMode: { type: 'string', enum: ['TOWARDS_CORNER', 'CENTER', 'SHIFT_MM'] },
    areaDeltaPercent: { type: 'number' },
    targetAreaSqM: { type: 'number' },
    targetAreaSqFt: { type: 'number' },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_ACTIONS = new Set<CadEditAction>([
  'RESIZE_ROOM_AREA',
  'MOVE_OPENING',
  'ADJUST_PARTITION_OR_PASSAGE',
  'RESIZE_OPENING',
  'LOCALIZED_FLAT_REGENERATION',
]);

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

  const building = body.building as Building | undefined;
  const floorId = typeof body.floorId === 'string' ? body.floorId.trim() : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  const selectedEntityId = typeof body.selectedEntityId === 'string' ? body.selectedEntityId.trim() : undefined;
  const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined;
  const expectedRevisionDigest =
    typeof body.expectedRevisionDigest === 'string' ? body.expectedRevisionDigest : undefined;
  const control = isRecord(body.control) ? (body.control as unknown as GenerationControlState) : undefined;

  if (!building || !isRecord(building) || validateBuildingSchema(building).length > 0) {
    return {
      status: 400,
      json: { error: { code: 'INVALID_BUILDING', message: 'A valid canonical Building payload is required.' } },
    };
  }
  if (!floorId) {
    return {
      status: 400,
      json: { error: { code: 'MISSING_FLOOR_ID', message: 'floorId is required.' } },
    };
  }
  if (!instruction && !isRecord(body.parsedIntent)) {
    return {
      status: 400,
      json: { error: { code: 'MISSING_INSTRUCTION', message: 'instruction or parsedIntent is required.' } },
    };
  }

  if (runtimeOptions.signal?.aborted) {
    return {
      status: 499,
      json: { error: { code: 'REQUEST_CANCELLED', message: 'CAD edit proposal cancelled.' } },
    };
  }

  const startedAt = Date.now();
  let parsedIntent: CadEditIntent | undefined =
    isRecord(body.parsedIntent) && VALID_ACTIONS.has(body.parsedIntent.action as CadEditAction)
      ? (body.parsedIntent as unknown as CadEditIntent)
      : undefined;
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
      if (isRecord(decoded) && VALID_ACTIONS.has(decoded.action as CadEditAction)) {
        const raw = decoded;
        parsedIntent = {
          action: raw.action as CadEditAction,
          ...(selectedEntityId
            ? { targetEntityId: selectedEntityId.replace(/^cad:(?:wall|room|door|window|stair|floor|anno:room):/, '') }
            : {}),
          ...(typeof raw.targetRoomQuery === 'string' ? { targetRoomQuery: raw.targetRoomQuery } : {}),
          ...(typeof raw.targetUnitIndex === 'number' ? { targetUnitIndex: raw.targetUnitIndex } : {}),
          ...(raw.targetOpeningKind === 'door' || raw.targetOpeningKind === 'window'
            ? { targetOpeningKind: raw.targetOpeningKind }
            : {}),
          ...(typeof raw.targetWidthMm === 'number' ? { targetWidthMm: raw.targetWidthMm } : {}),
          ...(typeof raw.shiftMm === 'number' ? { shiftMm: raw.shiftMm } : {}),
          ...(raw.moveOpeningMode === 'TOWARDS_CORNER' ||
          raw.moveOpeningMode === 'CENTER' ||
          raw.moveOpeningMode === 'SHIFT_MM'
            ? { moveOpeningMode: raw.moveOpeningMode }
            : {}),
          ...(typeof raw.areaDeltaPercent === 'number' ? { areaDeltaPercent: raw.areaDeltaPercent } : {}),
          ...(typeof raw.targetAreaSqM === 'number' ? { targetAreaSqM: raw.targetAreaSqM } : {}),
          ...(typeof raw.targetAreaSqFt === 'number' ? { targetAreaSqFt: raw.targetAreaSqFt } : {}),
          ...(raw.localScope === 'SINGLE_FLAT' ||
          raw.localScope === 'SINGLE_ROOM' ||
          raw.localScope === 'CONNECTED_ROOM_GROUP' ||
          raw.localScope === 'EDITABLE_ZONE'
            ? { localScope: raw.localScope }
            : {}),
          ...(raw.localOperation === 'REGENERATE_ALTERNATIVE' ||
          raw.localOperation === 'RELOCATE_KITCHEN' ||
          raw.localOperation === 'CONVERT_BHK' ||
          raw.localOperation === 'RESIZE_MASTER_BEDROOM' ||
          raw.localOperation === 'RECONFIGURE_LIVING_DINING' ||
          raw.localOperation === 'REGENERATE_ROOM'
            ? { localOperation: raw.localOperation }
            : {}),
          ...(raw.targetBhk === '1BHK' ||
          raw.targetBhk === '2BHK' ||
          raw.targetBhk === '3BHK' ||
          raw.targetBhk === '4BHK'
            ? { targetBhk: raw.targetBhk }
            : {}),
        };
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
      fallbackReason = err instanceof Error ? err.message.slice(0, 120) : 'GEMINI_EDIT_PARSE_FAILED';
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
