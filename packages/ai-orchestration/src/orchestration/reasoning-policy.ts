import type { AIReasoningMode, MultiSheetApartmentConfig } from '@ai-floor-planner/core';

export interface ModelThinkingCapabilities {
  readonly supportsThinkingConfig: boolean;
  readonly supportsZeroThinking: boolean;
  /** When true and desired budget is 0, omit thinkingConfig rather than clamping up or sending 0. */
  readonly omitThinkingWhenZero?: boolean;
  readonly minThinkingBudget: number;
  readonly maxThinkingBudget: number;
}

export interface ResolvedReasoningParameters {
  readonly mode: AIReasoningMode;
  readonly includeThinkingConfig: boolean;
  readonly thinkingBudget?: number;
  readonly maxOutputTokens: number;
}

const runtimeUnsupportedThinkingModels = new Set<string>();

export function recordModelUnsupportedThinking(modelId: string): void {
  const key = modelId.trim().toLowerCase();
  if (key) runtimeUnsupportedThinkingModels.add(key);
}

export function clearModelCapabilityCache(): void {
  runtimeUnsupportedThinkingModels.clear();
}

/**
 * Inspects actual model family capabilities rather than assuming every model
 * accepts `thinkingConfig: { thinkingBudget: 0 }`.
 */
export function inspectModelThinkingCapabilities(modelId: string): ModelThinkingCapabilities {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized || runtimeUnsupportedThinkingModels.has(normalized)) {
    return {
      supportsThinkingConfig: false,
      supportsZeroThinking: false,
      minThinkingBudget: 0,
      maxThinkingBudget: 0,
    };
  }

  // Legacy Gemini 1.5 / 2.0 or non-Gemini families do not support Gemini thinkingConfig
  if (
    normalized.startsWith('gemini-1.') ||
    normalized.startsWith('gemini-2.0') ||
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1-') ||
    normalized.startsWith('o3-') ||
    normalized.startsWith('claude-')
  ) {
    return {
      supportsThinkingConfig: false,
      supportsZeroThinking: false,
      minThinkingBudget: 0,
      maxThinkingBudget: 0,
    };
  }

  // Pro / dedicated thinking models require positive thinking budgets and reject thinkingBudget: 0
  if (normalized.includes('-pro') || normalized.includes('thinking')) {
    return {
      supportsThinkingConfig: true,
      supportsZeroThinking: false,
      minThinkingBudget: 128,
      maxThinkingBudget: 2048,
    };
  }

  // Gemini 3.5 Flash-Lite & flash-lite-latest reject thinkingBudget: 0 (HTTP 400) but accept omitted config or positive budgets
  if (normalized.startsWith('gemini-3.5-flash-lite') || normalized === 'gemini-flash-lite-latest') {
    return {
      supportsThinkingConfig: true,
      supportsZeroThinking: false,
      omitThinkingWhenZero: true,
      minThinkingBudget: 128,
      maxThinkingBudget: 1024,
    };
  }

  // Gemini 2.5+ Flash and Gemini 3.x Flash families support configurable thinkingBudget >= 0
  return {
    supportsThinkingConfig: true,
    supportsZeroThinking: true,
    minThinkingBudget: 0,
    maxThinkingBudget: 1024,
  };
}

/**
 * Classifies an architectural generation request into RH Planner's three application
 * reasoning policies:
 * - FAST: straightforward uniform residential briefs & simple structured extraction
 * - BALANCED: multimodal reference images, mixed-BHK programs, Vastu/architectural preferences, or variant exploration
 * - DEEP: irregular/surveyed plots, strict unequal carpet targets, conflicting directives, 5-6 flats/floor, or complex multi-constraint briefs
 */
export function selectArchitecturalReasoningMode(
  config: MultiSheetApartmentConfig,
  seed: number,
  hasReferenceImage: boolean,
  overrideMode?: AIReasoningMode,
): AIReasoningMode {
  if (overrideMode === 'FAST' || overrideMode === 'BALANCED' || overrideMode === 'DEEP') {
    return overrideMode;
  }

  const prompt = (config.aiPrompt ?? '').trim().toLowerCase();
  const hasIrregularSite = Boolean(
    config.irregularPlotBoundary && config.irregularPlotBoundary.polygon.points.length >= 3,
  );
  const sizedTargets = (config.units ?? [])
    .map(u => u.targetCarpetSqFt)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const hasUnequalTargets = new Set(sizedTargets).size >= 2;
  const hasStrictTargets = Boolean(config.requireAreaTargets && sizedTargets.length > 0);

  const hasPromptConflict =
    (/\bno\s+ots\b|\bwithout\s+ots\b/.test(prompt) && /\bcourtyard\b|\bots\s+shaft/.test(prompt)) ||
    (/\bno\s+balcon|\bwithout\s+balcon/.test(prompt) && /\ball\s+bedroom.*balcon|\bcantilevered\s+balcon/.test(prompt));

  const directiveMatches = [
    /\bvastu|\bsoutheast|\bsouthwest\b/.test(prompt),
    /\bno\s+ots|\bcourtyard|\bventilat/.test(prompt),
    /\bbalcon/.test(prompt),
    /\bcenter(?:ed)?\b/.test(prompt),
    /\bcrescent|\brotunda|\bpinwheel|\bstepped|\btriskele|\bh[- ]?shape|\bu[- ]?shape|\bl[- ]?shape|\birregular/.test(prompt),
    /\bopen\s+kitchen|\blarge[r]?\s+kitchen/.test(prompt),
  ].filter(Boolean).length;

  if (
    hasIrregularSite ||
    hasUnequalTargets ||
    hasStrictTargets ||
    hasPromptConflict ||
    config.flatsPerFloor >= 5 ||
    (prompt.length >= 180 && directiveMatches >= 3)
  ) {
    return 'DEEP';
  }

  const distinctBhkCount = new Set((config.units ?? []).map(u => u.bhkType)).size;
  if (
    hasReferenceImage ||
    distinctBhkCount > 1 ||
    seed > 1 ||
    Boolean(config.autoExploreNovelShape) ||
    directiveMatches >= 2 ||
    prompt.length >= 90
  ) {
    return 'BALANCED';
  }

  return 'FAST';
}

const MODE_THINKING_BUDGETS: Record<AIReasoningMode, number> = {
  FAST: 0,
  BALANCED: 192,
  DEEP: 512,
};

export function resolveModelThinkingParameters(
  modelId: string,
  mode: AIReasoningMode,
  options: {
    readonly hasVisionImage?: boolean;
    readonly explicitThinkingBudget?: number;
    readonly explicitMaxTokens?: number;
    readonly taskKind?: 'ARCHITECTURAL_PROPOSAL' | 'CAD_EDIT_INTENT';
  } = {},
): ResolvedReasoningParameters {
  const caps = inspectModelThinkingCapabilities(modelId);
  const taskKind = options.taskKind ?? 'ARCHITECTURAL_PROPOSAL';
  const baseOutputTokens =
    taskKind === 'CAD_EDIT_INTENT'
      ? 240
      : mode === 'DEEP'
      ? options.hasVisionImage
        ? 1450
        : 1100
      : mode === 'BALANCED'
      ? options.hasVisionImage
        ? 1150
        : 850
      : options.hasVisionImage
      ? 950
      : 650;

  if (!caps.supportsThinkingConfig) {
    return {
      mode,
      includeThinkingConfig: false,
      maxOutputTokens: options.explicitMaxTokens ?? baseOutputTokens,
    };
  }

  const rawDesired =
    typeof options.explicitThinkingBudget === 'number'
      ? options.explicitThinkingBudget
      : MODE_THINKING_BUDGETS[mode];
  if (rawDesired === 0 && !caps.supportsZeroThinking && caps.omitThinkingWhenZero) {
    return {
      mode,
      includeThinkingConfig: false,
      maxOutputTokens: options.explicitMaxTokens ?? baseOutputTokens,
    };
  }
  const clampedBudget =
    rawDesired === 0 && !caps.supportsZeroThinking
      ? caps.minThinkingBudget
      : Math.max(caps.minThinkingBudget, Math.min(caps.maxThinkingBudget, Math.round(rawDesired)));

  return {
    mode,
    includeThinkingConfig: true,
    thinkingBudget: clampedBudget,
    maxOutputTokens: options.explicitMaxTokens ?? baseOutputTokens + Math.min(384, Math.round(clampedBudget * 0.5)),
  };
}
