import type { BaseAIProvider } from '@ai-floor-planner/ai-orchestration';
import {
  AITaskType,
  validateBuildingSchema,
  type Building,
  type GenerationControlState,
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
  },
};

export interface CadEditProposalApiResponse {
  readonly proposal: CadAiEditProposalResult;
  readonly aiTelemetry: {
    readonly geminiInvoked: boolean;
    readonly interpretationSource: 'GEMINI_ASSISTED' | 'DETERMINISTIC';
    readonly modelUsed?: string;
    readonly fallbackReason?: string;
    readonly latencyMs: number;
    readonly tokenUsage?: {
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly totalTokens: number;
      readonly thoughtsTokens?: number;
    };
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

export async function handleCadEditProposal(
  body: unknown,
  deps: { readonly gemini: BaseAIProvider | null; readonly briefInterpreterKind: 'gemini' | 'local-stub' },
): Promise<{ status: number; json: CadEditProposalApiResponse | { error: { code: string; message: string } } }> {
  if (!isRecord(body)) {
    return {
      status: 400,
      json: { error: { code: 'INVALID_REQUEST', message: 'Expected JSON object with building, floorId, and instruction.' } },
    };
  }

  const building = body.building as Building | undefined;
  const floorId = typeof body.floorId === 'string' ? body.floorId.trim() : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  const selectedEntityId = typeof body.selectedEntityId === 'string' ? body.selectedEntityId.trim() : undefined;
  const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined;
  const expectedRevisionDigest = typeof body.expectedRevisionDigest === 'string' ? body.expectedRevisionDigest : undefined;
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

  const startedAt = Date.now();
  let parsedIntent: CadEditIntent | undefined =
    isRecord(body.parsedIntent) && VALID_ACTIONS.has(body.parsedIntent.action as CadEditAction)
      ? (body.parsedIntent as unknown as CadEditIntent)
      : undefined;
  let intentSource: 'GEMINI_ASSISTED' | 'DETERMINISTIC' = 'DETERMINISTIC';
  let geminiInvoked = false;
  let modelUsed: string | undefined;
  let fallbackReason: string | undefined;
  let tokenUsage: CadEditProposalApiResponse['aiTelemetry']['tokenUsage'];

  if (!parsedIntent && deps.gemini && deps.briefInterpreterKind === 'gemini') {
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
        maxTokens: 220,
        thinkingBudget: 0,
      });
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
        };
        intentSource = 'GEMINI_ASSISTED';
        modelUsed = response.model;
        tokenUsage = {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          ...(response.usage.thoughtsTokens !== undefined
            ? { thoughtsTokens: response.usage.thoughtsTokens }
            : {}),
        };
      } else {
        fallbackReason = 'INVALID_STRUCTURED_EDIT_INTENT';
      }
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message.slice(0, 120) : 'GEMINI_EDIT_PARSE_FAILED';
    }
  } else if (!parsedIntent && !deps.gemini) {
    fallbackReason = 'GEMINI_NOT_CONFIGURED';
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
        interpretationSource: intentSource,
        ...(modelUsed ? { modelUsed } : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
        latencyMs: Date.now() - startedAt,
        ...(tokenUsage ? { tokenUsage } : {}),
      },
    },
  };
}
