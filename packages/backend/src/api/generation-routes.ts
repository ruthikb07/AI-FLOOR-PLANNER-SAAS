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
import { validateRegulatoryContextSchema, type MultiSheetApartmentConfig } from '@ai-floor-planner/core';
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

function includesSurveyGeometry(value: unknown): boolean {
  return isRecord(value) && (value.siteGeometryMode === 'survey' ||
    value.surveyDraft != null || value.surveyBoundary != null ||
    value.plotBoundary != null || value.buildableEnvelope != null);
}

function parseGenerationRequest(body: unknown): {
  config: MultiSheetApartmentConfig;
  seed: number;
  generationRunId: string;
  rejectedTopologyHashes: readonly string[];
} | null {
  if (!isRecord(body)) return null;

  const rawConfig = isRecord(body.config) ? body.config : body;
  const positive = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const setbacks = rawConfig.setbacksMm;
  const flats = Number(rawConfig.flatsPerFloor);
  const floors = Number(rawConfig.numTypicalFloors);
  if (![rawConfig.plotWidthMm, rawConfig.plotDepthMm, rawConfig.roadWidthMm,
    rawConfig.floorToFloorHeightMm, rawConfig.stiltHeightMm].every(positive)
    || !Number.isInteger(rawConfig.numTypicalFloors) || floors < 1 || floors > 40
    || !Number.isInteger(rawConfig.flatsPerFloor) || flats < 1 || flats > 6
    || !Array.isArray(rawConfig.units) || rawConfig.units.length !== flats
    || rawConfig.units.some((unit, index) => !isRecord(unit) || typeof unit.bhkType !== 'string' || !/^[1-4]BHK$/.test(unit.bhkType)
      || unit.unitIndex !== index + 1 || (unit.targetCarpetSqFt !== undefined && !positive(unit.targetCarpetSqFt)))
    || (rawConfig.requireAreaTargets !== undefined && typeof rawConfig.requireAreaTargets !== 'boolean')
    || (rawConfig.areaAcceptanceTolerancePercent !== undefined && (!Number.isFinite(rawConfig.areaAcceptanceTolerancePercent)
      || Number(rawConfig.areaAcceptanceTolerancePercent) < 0 || Number(rawConfig.areaAcceptanceTolerancePercent) >= 100))
    || (rawConfig.projectId !== undefined && (typeof rawConfig.projectId !== 'string' || !/^[a-z0-9_-]{1,96}$/i.test(rawConfig.projectId)))
    || (rawConfig.aiPrompt !== undefined && (typeof rawConfig.aiPrompt !== 'string' || rawConfig.aiPrompt.length > 32_000))
    || (setbacks !== undefined && (!isRecord(setbacks) ||
      ['front', 'rear', 'left', 'right'].some(key => !Number.isFinite(setbacks[key]) || Number(setbacks[key]) < 0)))) return null;

  const runId = body.generationRunId;
  if (runId !== undefined && (typeof runId !== 'string'
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(runId)
    || runId.toLowerCase() === String(rawConfig.projectId).toLowerCase())) return null;

  const config = rawConfig as unknown as MultiSheetApartmentConfig;
  const seedRaw = body.seed ?? config.generationSeed ?? 1;
  const seed = Number.isFinite(Number(seedRaw)) ? Math.max(1, Math.floor(Number(seedRaw))) : 1;

  const rejectedRaw = body.rejectedTopologyHashes ?? config.rejectedTopologyHashes ?? [];
  const rejectedTopologyHashes = Array.isArray(rejectedRaw)
    ? rejectedRaw.slice(0, 128).filter((item): item is string => typeof item === 'string' && item.length <= 128 && item.trim().length > 0)
    : [];

  return { config, seed, generationRunId: typeof runId === 'string' ? runId : randomUUID(), rejectedTopologyHashes };
}

export async function handleProjectGeneration(
  body: unknown,
  deps: GenerationRouteDeps,
): Promise<RouteResponse> {
  if (includesSurveyGeometry(body) || (isRecord(body) && includesSurveyGeometry(body.config))) {
    return {
      status: 422,
      json: { error: { code: 'SURVEY_GENERATION_UNSUPPORTED', message: 'This route requires a planner that accepts the exact surveyed boundary and buildable envelope.' } },
    };
  }
  const parsed = parseGenerationRequest(body);
  if (!parsed) {
    return {
      status: 400,
      json: {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Check plot and road dimensions, heights, setbacks, 1 to 40 floors and the matching 1 to 6 unit BHK mix.',
        },
      },
    };
  }

  if (parsed.config.regulatoryContext !== undefined) {
    const errors = validateRegulatoryContextSchema(parsed.config.regulatoryContext);
    if (errors.length) {
      return {
        status: 400,
        json: { error: { code: 'INVALID_REGULATORY_CONTEXT', message: errors.map(error => error.path).join(', ') } },
      };
    }
  }

  let proposalResult = await generateArchitecturalProposal(deps.gemini, {
    config: parsed.config,
    seed: parsed.seed,
    rejectedTopologyHashes: parsed.rejectedTopologyHashes,
  });

  try {
    let pipelineResult = await executeAuditedPlanningPipeline(proposalResult.enrichedConfig);
    let complianceReport = evaluateArchitecturalComplianceScore(pipelineResult.building, {
      config: proposalResult.enrichedConfig,
    });

    let blockers = generationBlockingFindings(pipelineResult.building, pipelineResult.validationReport);
    // If compliance < 85 after deterministic solver loop and live AI provider is configured,
    // escalate up to 2 corrective re-proposals (deterministic mode already exhausted its retry loop).
    const maxOuterRetries = deps.gemini ? 2 : 0;
    for (let retryIdx = 1; (blockers.length || !complianceReport.passed) && retryIdx <= maxOuterRetries; retryIdx++) {
      try {
        const priorHash = pipelineResult.building.metadata.generationBrief?.topologyHash;
        const priorShape = pipelineResult.building.metadata.generationBrief?.buildingMassingShape;
        const updatedRejected = typeof priorHash === 'string' && priorHash.length > 0
          ? [...new Set([...parsed.rejectedTopologyHashes, priorHash])]
          : [...parsed.rejectedTopologyHashes];
        const updatedRejectedShapes =
          !parsed.config.buildingMassingShape && priorShape
            ? [...new Set([...(parsed.config.rejectedShapeIds ?? []), priorShape])]
            : parsed.config.rejectedShapeIds;
        const correctiveHint = complianceReport.violations
          .slice(0, 3)
          .map(v => (typeof v === 'string' ? v : v.message))
          .join(' ');
        const retryProposal = await generateArchitecturalProposal(deps.gemini, {
          config: {
            ...parsed.config,
            ...(updatedRejectedShapes ? { rejectedShapeIds: updatedRejectedShapes as typeof parsed.config.rejectedShapeIds } : {}),
            aiPrompt: `${parsed.config.aiPrompt ?? ''} [COMPLIANCE CORRECTION ${retryIdx}: ${correctiveHint}]`.trim(),
          },
          seed: parsed.seed + retryIdx * 12,
          rejectedTopologyHashes: updatedRejected,
        });
        const retryPipeline = await executeAuditedPlanningPipeline(retryProposal.enrichedConfig);
        const retryCompliance = evaluateArchitecturalComplianceScore(retryPipeline.building, {
          config: retryProposal.enrichedConfig,
        });
        const retryBlockers = generationBlockingFindings(retryPipeline.building, retryPipeline.validationReport);
        const retryIsBetter = retryBlockers.length === 0 && (blockers.length > 0 ||
          retryCompliance.redConflictCount < complianceReport.redConflictCount ||
          (retryCompliance.redConflictCount === complianceReport.redConflictCount &&
            retryCompliance.score >= complianceReport.score));
        if (retryIsBetter) {
          proposalResult = retryProposal;
          pipelineResult = retryPipeline;
          complianceReport = retryCompliance;
          blockers = retryBlockers;
        }
      } catch {
        // A failed optional re-proposal cannot discard the first audited result.
      }
    }

    if (blockers.length) {
      return {
        status: 422,
        json: { generationRunId: parsed.generationRunId, telemetry: proposalResult.telemetry, error: {
          code: 'GENERATION_CHECKS_FAILED',
          message: `Required design checks failed. ${blockers[0]!.message} Try a different massing or adjust the brief.`,
          findings: blockers.slice(0, 20),
        } },
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
          aiTelemetry: proposalResult.telemetry,
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
        telemetry: proposalResult.telemetry,
      },
    };
  } catch (error) {
    let failure = { code: 'PIPELINE_FAILED', message: error instanceof Error ? error.message : 'Pipeline verification failed.' };
    let diagnostic: Exclude<ReturnType<typeof generateApartmentOutcome>, { status: 'PLAN' }> | undefined;
    try {
      const outcome = generateApartmentOutcome(proposalResult.enrichedConfig);
      if (outcome.status !== 'PLAN') {
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
        telemetry: proposalResult.telemetry,
      },
    };
  }
}

