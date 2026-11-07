/**
 * Phase 3 - Extraction pipeline (PRD 19-24).
 *
 * RAW IMAGE -> INTERPRETATION -> STRUCTURED PLAN -> NORMALIZATION ->
 * DETERMINISTIC GEOMETRY -> HARD VALIDATION -> ACCEPT or REJECT.
 *
 * The deterministic system owns acceptance. A rejected extraction is returned
 * as REJECTED with actionable reasons; the original image is never modified and
 * no substitute geometry is presented as if it came from the image.
 *
 * Recovery Phase 4: the apartment branch now interprets the IMAGE (flat
 * grouping, core, lifts, stairs, lobby) and validates it against the manifest.
 * It no longer substitutes the deterministic schematic for the interpreted
 * plan — that substitution belongs only to the explicit FALLBACK_DETERMINISTIC
 * path, which keeps its own provenance.
 */

import {
  type Building,
  type DesignRequirementSpecification,
  type SpaceProgram,
} from '@ai-floor-planner/core';
import type { ApartmentGenerationManifest } from '@ai-floor-planner/ai-orchestration';
import {
  attachExtractedOpenings,
  createExtractionMetadata,
  extractPlanToBuilding,
  extractedPlanToApartmentStructure,
  inspectExtractionStructure,
  normalizeExtractedPlan,
  parseExtractionPayload,
  runApartmentPlanValidation,
  validateExtractedPlan,
  type ApartmentPlanValidationResult,
  type DiagnosticFragment,
  type ExtractedPlan,
  type ExtractedPlanValidation,
} from '@ai-floor-planner/planning-engine';
import { apartmentExpectationFromManifest } from './apartment-structure.js';

export interface ExtractionPipelineInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly requirements: DesignRequirementSpecification;
  readonly program?: SpaceProgram;
  readonly imageWidePixels: number;
  readonly imageTallPixels: number;
  /** Raw vision payload (already fetched). */
  readonly payload: unknown;
  readonly extractionSource: string;
  readonly confidence: string;
  readonly interpretationSource: 'provider' | 'rule_based' | 'rule_based_fallback';
  readonly isApartment?: boolean;
  readonly apartmentManifest?: ApartmentGenerationManifest;
  /**
   * Coordinate frame of the interpretation. Apartment interpretations use a
   * normalized frame (e.g. 1000×1000); defaults to the image pixel size.
   */
  readonly coordinateFrame?: { readonly width: number; readonly height: number };
}

export interface ExtractionPipelineResult {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly planId: string;
  readonly extractedPlan: ExtractedPlan | null;
  /** Candidate canonical Building; present only when ACCEPTED (PRD 23). */
  readonly building: Building | null;
  readonly validation: ExtractedPlanValidation | null;
  readonly diagnostics: readonly DiagnosticFragment[];
  readonly interpretationSource: string;
  readonly confidence: string;
  /** Apartment staged hard-validation outcome (Phase 4). */
  readonly apartmentValidation?: Pick<ApartmentPlanValidationResult, 'stages' | 'counts' | 'source'>;
}

export function siteContext(requirements: DesignRequirementSpecification) {
  const hard = requirements.hard;
  return {
    plotWidth: hard.plotWidthMm,
    plotDepth: hard.plotDepthMm,
    orientation: requirements.orientationDegrees,
    roadFacing: hard.roadFacing,
    frontSetback: requirements.setbacksMm?.front ?? 0,
    rearSetback: requirements.setbacksMm?.rear ?? 0,
    leftSetback: requirements.setbacksMm?.left ?? 0,
    rightSetback: requirements.setbacksMm?.right ?? 0,
  };
}

export function runExtractionPipeline(input: ExtractionPipelineInput): ExtractionPipelineResult {
  const diagnostics: DiagnosticFragment[] = [];
  const planId = `extract_${input.projectId}_${input.imageWidePixels}x${input.imageTallPixels}`;
  const site = siteContext(input.requirements);

  const metadata = createExtractionMetadata({
    imageWidePixels: input.imageWidePixels,
    imageTallPixels: input.imageTallPixels,
    plotWidth: site.plotWidth,
    plotDepth: site.plotDepth,
    orientation: site.orientation,
    roadFacing: site.roadFacing,
    extractionSource: input.extractionSource,
    confidence: input.confidence,
  });

  // Recovery Phase 4: apartment-aware IMAGE → 2D → hard validation.
  if (input.isApartment && input.apartmentManifest) {
    const parsed = parseExtractionPayload(input.payload, metadata, planId);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.plan) return rejected(planId, null, diagnostics, input);

    const frame = input.coordinateFrame ?? { width: input.imageWidePixels, height: input.imageTallPixels };
    const mapped = extractedPlanToApartmentStructure(
      parsed.plan,
      { plotWidth: site.plotWidth, plotDepth: site.plotDepth },
      frame,
      {
        manifest: input.apartmentManifest as any,
      },
    );
    diagnostics.push(...mapped.diagnostics);
    if (!mapped.structure) return rejected(planId, parsed.plan, diagnostics, input);

    const result = runApartmentPlanValidation({
      structure: mapped.structure,
      expectation: apartmentExpectationFromManifest(input.apartmentManifest),
      site,
      projectId: input.projectId,
      projectName: input.projectName,
      manifest: input.apartmentManifest as any,
    });
    diagnostics.push(...result.diagnostics);
    return {
      status: result.status,
      planId,
      extractedPlan: parsed.plan,
      building: result.building,
      validation: result.validation,
      diagnostics,
      interpretationSource: input.interpretationSource,
      confidence: input.confidence,
      apartmentValidation: { stages: result.stages, counts: result.counts, source: result.source },
    };
  }

  // Generic single-family residential pipeline:
  // 1. Parse the untrusted interpretation payload.
  const parsed = parseExtractionPayload(input.payload, metadata, planId);
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.plan) {
    return rejected(planId, null, diagnostics, input);
  }

  // 2. Structural sanity before geometry work.
  const structural = inspectExtractionStructure(parsed.plan);
  diagnostics.push(...structural);
  if (structural.some((issue: DiagnosticFragment) => issue.severity === 'error')) {
    return rejected(planId, parsed.plan, diagnostics, input);
  }

  // 3. Normalize image space into real-world millimetres (site is authoritative).
  const normalized = normalizeExtractedPlan(parsed.plan, {
    plotWidth: site.plotWidth,
    plotDepth: site.plotDepth,
    orientation: site.orientation,
    roadFacing: site.roadFacing,
  });
  diagnostics.push(...normalized.diagnostics);
  if (!normalized.normalized) {
    return rejected(planId, parsed.plan, diagnostics, input);
  }
  const plan = normalized.normalized;

  // 4. Convert to a candidate canonical Building (never mutates the original).
  const conversion = extractPlanToBuilding(plan, site, input.projectId, input.projectName);
  diagnostics.push(...conversion.diagnostics);
  if (!conversion.building) {
    return rejected(planId, plan, diagnostics, input);
  }

  const withOpenings = attachExtractedOpenings(conversion.building, plan, {
    plotWidth: site.plotWidth,
    plotDepth: site.plotDepth,
  });
  diagnostics.push(...withOpenings.diagnostics);

  // 5. HARD VALIDATION — the deterministic system decides acceptance.
  const validation = validateExtractedPlan(withOpenings.building, plan, input.requirements);
  diagnostics.push(...validation.verificationIssues);

  return {
    status: validation.isValid ? 'ACCEPTED' : 'REJECTED',
    planId,
    extractedPlan: plan,
    building: validation.isValid ? withOpenings.building : null,
    validation,
    diagnostics,
    interpretationSource: input.interpretationSource,
    confidence: input.confidence,
  };
}

function rejected(
  planId: string,
  extractedPlan: ExtractedPlan | null,
  diagnostics: readonly DiagnosticFragment[],
  input: ExtractionPipelineInput,
): ExtractionPipelineResult {
  return {
    status: 'REJECTED',
    planId,
    extractedPlan,
    building: null,
    validation: null,
    diagnostics,
    interpretationSource: input.interpretationSource,
    confidence: input.confidence,
  };
}
