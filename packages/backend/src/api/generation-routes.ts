/**
 * Architectural generation route (`POST /api/projects/generate` and `/api/v1/projects/generate`).
 *
 * Orchestrates live Gemini architectural proposal synthesis (schema-locked + optional
 * multimodal reference-image spatial graph) followed by exact deterministic geometry
 * synthesis and compliance validation in `@ai-floor-planner/planning-engine`.
 */

import {
  generateArchitecturalProposal,
  type BaseAIProvider,
} from '@ai-floor-planner/ai-orchestration';
import { randomUUID } from 'node:crypto';
import {
  EXACT_SQMM_PER_SQFT,
  validateRegulatoryContextSchema,
  type AIReasoningMode,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { prepareSurveyGeneration, SurveyGenerationError } from '@ai-floor-planner/geometry-engine';
import { generationBlockingFindings } from '@ai-floor-planner/constraint-engine';
import { isRecord } from './http-input.js';
import {
  evaluateArchitecturalComplianceScore,
  executeAuditedPlanningPipeline,
  generateApartmentOutcome,
} from '@ai-floor-planner/planning-engine';
import type { RouteResponse } from './evaluation-routes.js';

export interface GenerationRouteDeps {
  readonly gemini: BaseAIProvider | null;
}

export interface GenerationRequestRuntimeOptions {
  readonly signal?: AbortSignal;
  readonly authContextDigest?: string;
  readonly reasoningModeOverride?: AIReasoningMode;
}

function includesSurveyGeometry(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.siteGeometryMode === 'survey' ||
      value.surveyDraft != null ||
      value.surveyBoundary != null ||
      value.plotBoundary != null ||
      value.buildableEnvelope != null ||
      (isRecord(value.irregularPlotBoundary) && value.irregularPlotBoundary.sourceFormat === 'survey'))
  );
}

function parseGenerationRequest(body: unknown): {
  config: MultiSheetApartmentConfig;
  seed: number;
  generationRunId: string;
  rejectedTopologyHashes: readonly string[];
  reasoningMode?: AIReasoningMode;
} | null {
  if (!isRecord(body)) return null;

  const rawConfig = isRecord(body.config) ? body.config : body;
  const measured = rawConfig.surveyBoundary != null;
  const positive = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const setbacks = rawConfig.setbacksMm;
  const wetWallLayout = isRecord(rawConfig.architectureOptions) ? rawConfig.architectureOptions.coordinatedWetWallLayout : undefined;
  const flats = Number(rawConfig.flatsPerFloor);
  const floors = Number(rawConfig.numTypicalFloors);
  if (
    (!measured && ![rawConfig.plotWidthMm, rawConfig.plotDepthMm].every(positive)) ||
    ![
      rawConfig.roadWidthMm,
      rawConfig.floorToFloorHeightMm,
      rawConfig.stiltHeightMm,
    ].every(positive) ||
    !Number.isInteger(rawConfig.numTypicalFloors) ||
    floors < 1 ||
    floors > 40 ||
    !Number.isInteger(rawConfig.flatsPerFloor) ||
    flats < 1 ||
    flats > 6 ||
    !Array.isArray(rawConfig.units) ||
    rawConfig.units.length !== flats ||
    rawConfig.units.some(
      (unit, index) =>
        !isRecord(unit) ||
        typeof unit.bhkType !== 'string' ||
        !/^[1-4]BHK$/.test(unit.bhkType) ||
        unit.unitIndex !== index + 1 ||
        (unit.targetCarpetSqFt !== undefined && !positive(unit.targetCarpetSqFt)),
    ) ||
    (rawConfig.requireAreaTargets !== undefined && typeof rawConfig.requireAreaTargets !== 'boolean') ||
    (wetWallLayout !== undefined && typeof wetWallLayout !== 'boolean') ||
    (rawConfig.areaAcceptanceTolerancePercent !== undefined &&
      (!Number.isFinite(rawConfig.areaAcceptanceTolerancePercent) ||
        Number(rawConfig.areaAcceptanceTolerancePercent) < 0 ||
        Number(rawConfig.areaAcceptanceTolerancePercent) >= 100)) ||
    (rawConfig.projectId !== undefined &&
      (typeof rawConfig.projectId !== 'string' || !/^[a-z0-9_-]{1,96}$/i.test(rawConfig.projectId))) ||
    (rawConfig.aiPrompt !== undefined &&
      (typeof rawConfig.aiPrompt !== 'string' || rawConfig.aiPrompt.length > 32_000)) ||
    (setbacks !== undefined &&
      (!isRecord(setbacks) ||
        ['front', 'rear', 'left', 'right'].some(
          key => !Number.isFinite(setbacks[key]) || Number(setbacks[key]) < 0,
        )))
  ) {
    return null;
  }

  const runId = body.generationRunId;
  if (
    runId !== undefined &&
    (typeof runId !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(runId) ||
      runId.toLowerCase() === String(rawConfig.projectId).toLowerCase())
  ) {
    return null;
  }

  const config = rawConfig as unknown as MultiSheetApartmentConfig;
  const seedRaw = body.seed ?? config.generationSeed ?? 1;
  const seed = Number.isFinite(Number(seedRaw)) ? Math.max(1, Math.floor(Number(seedRaw))) : 1;

  const rejectedRaw = body.rejectedTopologyHashes ?? config.rejectedTopologyHashes ?? [];
  const rejectedTopologyHashes = Array.isArray(rejectedRaw)
    ? rejectedRaw
        .slice(0, 128)
        .filter((item): item is string => typeof item === 'string' && item.length <= 128 && item.trim().length > 0)
    : [];

  const rawMode = typeof body.reasoningMode === 'string' ? body.reasoningMode.toUpperCase() : undefined;
  const reasoningMode: AIReasoningMode | undefined =
    rawMode === 'FAST' || rawMode === 'BALANCED' || rawMode === 'DEEP' ? rawMode : undefined;

  return {
    config,
    seed,
    generationRunId: typeof runId === 'string' ? runId : randomUUID(),
    rejectedTopologyHashes,
    ...(reasoningMode ? { reasoningMode } : {}),
  };
}

export async function handleProjectGeneration(
  body: unknown,
  deps: GenerationRouteDeps,
  runtimeOptions: GenerationRequestRuntimeOptions = {},
): Promise<RouteResponse> {
  const requestConfig = isRecord(body) && isRecord(body.config) ? body.config : body;
  const hasSurveyContract = isRecord(requestConfig) && requestConfig.surveyBoundary != null;
  const hasOuterAlias = isRecord(body) && body !== requestConfig && includesSurveyGeometry(body);
  if (hasOuterAlias || (!hasSurveyContract && includesSurveyGeometry(requestConfig))) {
    return {
      status: 422,
      json: {
        error: {
          code: 'SURVEY_GENERATION_UNSUPPORTED',
          message: 'This route requires a planner that accepts the exact surveyed boundary and buildable envelope.',
        },
      },
    };
  }
  const parsed = parseGenerationRequest(body);
  if (!parsed) {
    return {
      status: 400,
      json: {
        error: {
          code: 'INVALID_REQUEST',
          message:
            'Check plot and road dimensions, heights, setbacks, 1 to 40 floors and the matching 1 to 6 unit BHK mix.',
        },
      },
    };
  }

  if (hasSurveyContract) {
    try {
      const survey = prepareSurveyGeneration(parsed.config.surveyBoundary, parsed.config.setbacksMm);
      parsed.config = {
        ...parsed.config,
        plotWidthMm: survey.bounds.width, plotDepthMm: survey.bounds.height,
        roadAccessSides: [survey.roadFacing], irregularPlotBoundary: survey.boundary,
        ...(parsed.config.regulatoryContext && { regulatoryContext: {
          ...parsed.config.regulatoryContext, plotAreaSqm: survey.boundary.areaMm2 / 1e6,
        } }),
      };
    } catch (error) {
      if (!(error instanceof SurveyGenerationError)) throw error;
      return { status: error.code === 'INVALID_SURVEY_BOUNDARY' ? 400 : 422,
        json: { error: { code: error.code, message: error.message } } };
    }
  }

  if (parsed.config.regulatoryContext !== undefined) {
    const errors = validateRegulatoryContextSchema(parsed.config.regulatoryContext);
    if (errors.length) {
      return {
        status: 400,
        json: {
          error: {
            code: 'INVALID_REGULATORY_CONTEXT',
            message: errors.map(error => error.path).join(', '),
          },
        },
      };
    }
  }

  const signal = runtimeOptions.signal;
  if (signal?.aborted) {
    return {
      status: 499,
      json: {
        generationRunId: parsed.generationRunId,
        error: { code: 'REQUEST_CANCELLED', message: 'Generation cancelled before execution.' },
      },
    };
  }

  const { config } = parsed;
  if (config.requireAreaTargets && !config.irregularPlotBoundary) {
    const requestedCarpetSqFt = config.units?.reduce((sum, unit) => sum + (unit.targetCarpetSqFt ?? 0), 0) ?? 0;
    const tolerance = (config.areaAcceptanceTolerancePercent ?? 5) / 100;
    const minimumCarpetMm2 = requestedCarpetSqFt * (1 - tolerance) * EXACT_SQMM_PER_SQFT;
    const siteAreaMm2 = config.plotWidthMm * config.plotDepthMm;
    // The entire plot is a hard upper bound even before subtracting setbacks, walls and common areas.
    if (minimumCarpetMm2 > siteAreaMm2) {
      const siteAreaSqFt = siteAreaMm2 / EXACT_SQMM_PER_SQFT;
      const minimumCarpetSqFt = minimumCarpetMm2 / EXACT_SQMM_PER_SQFT;
      const minimumSiteSqFt = Math.ceil(minimumCarpetSqFt);
      const maximumTargetSqFt = Math.floor(siteAreaSqFt / (1 - tolerance));
      return {
        status: 422,
        json: {
          generationRunId: parsed.generationRunId,
          error: {
            code: 'CARPET_TARGETS_EXCEED_ENVELOPE',
            message: `Required unit carpet totals ${requestedCarpetSqFt.toFixed(0)} sq ft. Even at the lower tolerance bound of ${minimumCarpetSqFt.toFixed(0)} sq ft, it exceeds the entire ${siteAreaSqFt.toFixed(0)} sq ft plot.`,
            alternatives: [
              {
                optionId: 'reduce_carpet_per_floor',
                summary: `Reduce the total per-floor target below ${maximumTargetSqFt} sq ft and reassess the room mix, setbacks and common areas.`,
                measurableAdjustment: { maximumTargetSqFt },
              },
              {
                optionId: 'increase_plot_area',
                summary: `Use a larger site. The required carpet alone takes at least ${minimumSiteSqFt} sq ft before setbacks and common areas.`,
                measurableAdjustment: { minimumSiteSqFt },
              },
            ],
          },
        },
      };
    }
  }

  const routeStartedAt = Date.now();
  let proposalResult = await generateArchitecturalProposal(deps.gemini, {
    config: parsed.config,
    seed: parsed.seed,
    rejectedTopologyHashes: parsed.rejectedTopologyHashes,
    signal,
    authContextDigest: runtimeOptions.authContextDigest,
    reasoningMode: parsed.reasoningMode ?? runtimeOptions.reasoningModeOverride,
  });

  // Never silently continue expensive geometry generation when caller cancelled during AI stage
  if (signal?.aborted || proposalResult.telemetry.invocationMode === 'CANCELLED') {
    return {
      status: 499,
      json: {
        generationRunId: parsed.generationRunId,
        telemetry: {
          ...proposalResult.telemetry,
          solverLatencyMs: 0,
          totalLatencyMs: Date.now() - routeStartedAt,
        },
        error: {
          code: 'REQUEST_CANCELLED',
          message: 'Generation was cancelled; geometry synthesis skipped.',
        },
      },
    };
  }

  const strictAlternative = parsed.config.requireAreaTargets && parsed.rejectedTopologyHashes.length > 0;
  const attemptedSeeds: number[] = [];
  async function solveGeneration(config: MultiSheetApartmentConfig) {
    if (!strictAlternative) return executeAuditedPlanningPipeline(config);

    let firstMeasured: Awaited<ReturnType<typeof executeAuditedPlanningPipeline>> | undefined;
    let failure: unknown;
    // Keep the original constraints and exclusions while trying a small deterministic seed window.
    for (let offset = 0; offset < 4 && !signal?.aborted; offset++) {
      const seed = parsed!.seed + offset;
      attemptedSeeds.push(seed);
      try {
        const result = await executeAuditedPlanningPipeline({ ...config, generationSeed: seed });
        if (generationBlockingFindings(result.building, result.validationReport).length === 0) return result;
        firstMeasured ??= result;
      } catch (error) {
        failure = error;
      }
    }
    if (firstMeasured) return firstMeasured;
    throw failure ?? new Error('No candidate reached geometry validation.');
  }

  try {
    const solverStartedAt = Date.now();
    let pipelineResult = await solveGeneration(proposalResult.enrichedConfig);
    if (signal?.aborted) {
      return {
        status: 499,
        json: {
          generationRunId: parsed.generationRunId,
          telemetry: {
            ...proposalResult.telemetry,
            invocationMode: 'CANCELLED',
            solverLatencyMs: Date.now() - solverStartedAt,
            totalLatencyMs: Date.now() - routeStartedAt,
          },
          error: {
            code: 'REQUEST_CANCELLED',
            message: 'Generation cancelled before publication.',
          },
        },
      };
    }

    let complianceReport = evaluateArchitecturalComplianceScore(pipelineResult.building, {
      config: proposalResult.enrichedConfig,
    });

    let blockers = generationBlockingFindings(pipelineResult.building, pipelineResult.validationReport);
    if (blockers.length && proposalResult.telemetry.interpretationSource === 'GEMINI' && !signal?.aborted) {
      // The user brief and exclusions stay in force when optional AI guidance fails the geometry gate.
      const rules = await generateArchitecturalProposal(null, {
        config: parsed.config,
        seed: parsed.seed,
        rejectedTopologyHashes: parsed.rejectedTopologyHashes,
      });
      try {
        const candidate = await executeAuditedPlanningPipeline(rules.enrichedConfig);
        if (!generationBlockingFindings(candidate.building, candidate.validationReport).length) {
          const telemetry = {
            ...rules.telemetry,
            geminiInvoked: proposalResult.telemetry.geminiInvoked,
            invocationMode: proposalResult.telemetry.invocationMode,
            reasoningMode: proposalResult.telemetry.reasoningMode,
            cacheHit: proposalResult.telemetry.cacheHit,
            sharedInFlight: proposalResult.telemetry.sharedInFlight,
            requestedModel: proposalResult.telemetry.requestedModel,
            modelUsed: proposalResult.telemetry.modelUsed,
            attemptedModels: proposalResult.telemetry.attemptedModels,
            apiCallCount: proposalResult.telemetry.apiCallCount,
            providerExecutionMs: proposalResult.telemetry.providerExecutionMs,
            tokenUsage: proposalResult.telemetry.tokenUsage,
            currentRequestTokenUsage: proposalResult.telemetry.currentRequestTokenUsage,
            proposalTokenUsage: proposalResult.telemetry.proposalTokenUsage,
            failedAttempts: proposalResult.telemetry.failedAttempts,
            providerErrorCode: proposalResult.telemetry.providerErrorCode,
            latencyMs: proposalResult.telemetry.latencyMs + rules.telemetry.latencyMs,
            influencedGeometry: false,
            fallbackReason: `Gemini guidance did not pass the required plan checks (${blockers[0]!.code}). The geometry engine used the original brief.`,
          };
          const candidateCompliance = evaluateArchitecturalComplianceScore(candidate.building, {
            config: rules.enrichedConfig,
          });
          pipelineResult = candidate;
          proposalResult = { ...rules, telemetry };
          complianceReport = candidateCompliance;
          blockers = [];
        }
      } catch {
        // Keep the first failed audit if the same brief also fails the deterministic solve.
      }
    }

    // Token-free bounded deterministic recovery: only run when mandatory blockers remain AND massing is unlocked.
    if (
      blockers.length > 0 &&
      !signal?.aborted &&
      !parsed.config.buildingMassingShape &&
      !parsed.config.lockedMassingShape &&
      !parsed.config.requireAreaTargets
    ) {
      try {
        const prior = pipelineResult.building.metadata.generationBrief;
        const attemptedLayouts = new Set(parsed.rejectedTopologyHashes);
        if (prior?.topologyHash) attemptedLayouts.add(prior.topologyHash);
        if (prior?.physicalLayoutHash) attemptedLayouts.add(prior.physicalLayoutHash);
        const priorShape = prior?.buildingMassingShape;
        const updatedRejectedShapes = priorShape
          ? [...new Set([...(parsed.config.rejectedShapeIds ?? []), priorShape])]
          : parsed.config.rejectedShapeIds;
        const retryProposal = await generateArchitecturalProposal(null, {
          config: {
            ...parsed.config,
            ...(updatedRejectedShapes
              ? { rejectedShapeIds: updatedRejectedShapes as typeof parsed.config.rejectedShapeIds }
              : {}),
          },
          seed: parsed.seed + 12,
          rejectedTopologyHashes: [...attemptedLayouts],
        });
        const retryPipeline = await executeAuditedPlanningPipeline(retryProposal.enrichedConfig);
        const retryBlockers = generationBlockingFindings(retryPipeline.building, retryPipeline.validationReport);
        if (retryBlockers.length === 0) {
          const retryCompliance = evaluateArchitecturalComplianceScore(retryPipeline.building, {
            config: retryProposal.enrichedConfig,
          });
          proposalResult = {
            ...retryProposal,
            telemetry: {
              ...proposalResult.telemetry,
              interpretationSource: 'DETERMINISTIC',
              fallbackTriggered: true,
              influencedGeometry: false,
              fallbackReason:
                proposalResult.telemetry.fallbackReason ??
                `Initial seed failed mandatory checks (${blockers[0]!.code}); recovered via deterministic variant search.`,
            },
          };
          pipelineResult = retryPipeline;
          complianceReport = retryCompliance;
          blockers = [];
        }
      } catch {
        // Retain original blockers if deterministic variant search cannot recover.
      }
    }

    if (signal?.aborted) {
      return {
        status: 499,
        json: {
          generationRunId: parsed.generationRunId,
          error: { code: 'REQUEST_CANCELLED', message: 'Generation cancelled before publishing response.' },
        },
      };
    }

    const solverLatencyMs = Date.now() - solverStartedAt;
    const totalLatencyMs = Date.now() - routeStartedAt;
    const enrichedTelemetry = {
      ...proposalResult.telemetry,
      solverLatencyMs,
      totalLatencyMs,
      ...(strictAlternative && { alternativeSearch: { attemptedSeeds, seedBudget: 4 } }),
    };

    if (blockers.length) {
      return {
        status: 422,
        json: {
          generationRunId: parsed.generationRunId,
          telemetry: enrichedTelemetry,
          error: {
            code: 'GENERATION_CHECKS_FAILED',
            message: strictAlternative
              ? `No distinct candidate satisfied the strict area and geometry requirements across ${attemptedSeeds.length} seeds. ${blockers[0]!.message}`
              : `Required design checks failed. ${blockers[0]!.message} Try a different massing or adjust the brief.`,
            findings: blockers.slice(0, 20),
          },
        },
      };
    }

    const enrichedBuilding = {
      ...pipelineResult.building,
      metadata: {
        ...pipelineResult.building.metadata,
        complianceReport,
        generationRunId: parsed.generationRunId,
        generationBrief: {
          ...pipelineResult.building.metadata.generationBrief,
          aiTelemetry: enrichedTelemetry,
        },
      },
    };

    return {
      status: 200,
      json: {
        ...pipelineResult,
        generationRunId: parsed.generationRunId,
        building: enrichedBuilding,
        complianceReport,
        proposal: proposalResult.proposal,
        telemetry: enrichedTelemetry,
      },
    };
  } catch (error) {
    let failure = {
      code: 'PIPELINE_FAILED',
      message: error instanceof Error ? error.message : 'Pipeline verification failed.',
    };
    let diagnostic: Exclude<ReturnType<typeof generateApartmentOutcome>, { status: 'PLAN' }> | undefined;
    try {
      const outcome = strictAlternative || signal?.aborted ? undefined : generateApartmentOutcome(proposalResult.enrichedConfig);
      if (strictAlternative) {
        failure = { code: 'STRICT_AREA_ALTERNATIVES_EXHAUSTED',
          message: `No distinct candidate reached geometry validation across ${attemptedSeeds.length} seeds. ${failure.message}` };
      }
      if (outcome && outcome.status !== 'PLAN') {
        diagnostic = outcome;
        failure = { code: outcome.status, message: outcome.reason };
      }
    } catch {
      // Keep the original failure even when recovery cannot classify it.
    }
    return {
      status: 422,
      json: {
        generationRunId: parsed.generationRunId,
        error: failure,
        ...(diagnostic ? { outcome: diagnostic } : {}),
        proposal: proposalResult.proposal,
        telemetry: {
          ...proposalResult.telemetry,
          ...(strictAlternative && { alternativeSearch: { attemptedSeeds, seedBudget: 4 } }),
        },
      },
    };
  }
}
