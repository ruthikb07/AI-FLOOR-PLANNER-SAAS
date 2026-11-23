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
import { validateRegulatoryContextSchema, type MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import {
  evaluateArchitecturalComplianceScore,
  executeAuditedPlanningPipeline,
  generateApartmentOutcome,
} from '@ai-floor-planner/planning-engine';
import type { RouteResponse } from './evaluation-routes.js';

export interface GenerationRouteDeps {
  readonly gemini: BaseAIProvider | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function includesSurveyGeometry(value: unknown): boolean {
  return isRecord(value) && (value.siteGeometryMode === 'survey' ||
    value.surveyDraft != null || value.surveyBoundary != null ||
    value.plotBoundary != null || value.buildableEnvelope != null);
}

function parseGenerationRequest(body: unknown): {
  config: MultiSheetApartmentConfig;
  seed: number;
  rejectedTopologyHashes: readonly string[];
} | null {
  if (!isRecord(body)) return null;

  const rawConfig = isRecord(body.config) ? body.config : body;
  const plotWidthMm = Number(rawConfig.plotWidthMm);
  const plotDepthMm = Number(rawConfig.plotDepthMm);
  const flatsPerFloor = Number(rawConfig.flatsPerFloor);

  if (
    !Number.isFinite(plotWidthMm) ||
    plotWidthMm <= 0 ||
    !Number.isFinite(plotDepthMm) ||
    plotDepthMm <= 0 ||
    !Number.isFinite(flatsPerFloor) ||
    flatsPerFloor < 1
  ) {
    return null;
  }

  const config = rawConfig as unknown as MultiSheetApartmentConfig;
  const seedRaw = body.seed ?? config.generationSeed ?? 1;
  const seed = Number.isFinite(Number(seedRaw)) ? Math.max(1, Math.floor(Number(seedRaw))) : 1;

  const rejectedRaw = body.rejectedTopologyHashes ?? config.rejectedTopologyHashes ?? [];
  const rejectedTopologyHashes = Array.isArray(rejectedRaw)
    ? rejectedRaw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return { config, seed, rejectedTopologyHashes };
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
          message: 'plotWidthMm > 0, plotDepthMm > 0, and flatsPerFloor >= 1 are required.',
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

    // If compliance < 85 after deterministic solver loop and live AI provider is configured,
    // escalate up to 2 corrective re-proposals (deterministic mode already exhausted its retry loop).
    const maxOuterRetries = deps.gemini ? 2 : 0;
    for (let retryIdx = 1; !complianceReport.passed && retryIdx <= maxOuterRetries; retryIdx++) {
      const priorHash = (pipelineResult.building.metadata as unknown as Record<string, unknown>)?.topologyHash;
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
      const retryIsBetter =
        retryCompliance.redConflictCount < complianceReport.redConflictCount ||
        (retryCompliance.redConflictCount === complianceReport.redConflictCount &&
          retryCompliance.score >= complianceReport.score);
      if (retryIsBetter) {
        proposalResult = retryProposal;
        pipelineResult = retryPipeline;
        complianceReport = retryCompliance;
      }
    }

    const enrichedBuilding = {
      ...pipelineResult.building,
      metadata: {
        ...pipelineResult.building.metadata,
        complianceReport,
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
        building: enrichedBuilding,
        complianceReport,
        proposal: proposalResult.proposal,
        telemetry: proposalResult.telemetry,
      },
    };
  } catch (error) {
    const outcome = generateApartmentOutcome(proposalResult.enrichedConfig);
    const reason =
      outcome.status === 'PLAN'
        ? (error instanceof Error ? error.message : 'Pipeline verification failed.')
        : outcome.reason;
    return {
      status: 422,
      json: {
        error: {
          code: outcome.status === 'PLAN' ? 'PIPELINE_FAILED' : outcome.status,
          message: reason,
        },
        outcome,
        proposal: proposalResult.proposal,
        telemetry: proposalResult.telemetry,
      },
    };
  }
}

