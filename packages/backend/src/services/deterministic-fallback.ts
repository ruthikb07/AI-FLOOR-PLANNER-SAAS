/**
 * Phase 3 recovery — deterministic apartment fallback (report Part 4 Option B).
 *
 * When every bounded FLUX attempt is rejected at the visual gate, the
 * deterministic apartment schematic (already verified against the manifest
 * before FLUX was called) becomes the authoritative base plan:
 *
 *   schematic ──► apartment structure (source DETERMINISTIC_SCHEMATIC)
 *             ──► Phase 4 canonical path: manifest match, party walls, core,
 *                 canonical Building, deterministic geometry validation
 *             ──► counts re-measured on the canonical Building
 *             ──► base-plan PNG rendered from the schematic (renderSchematicPng512)
 *
 * The result is always labelled FALLBACK_DETERMINISTIC. It never claims to be
 * a FLUX image and never modifies a rejected FLUX artifact.
 */

import type { Building, DesignRequirementSpecification } from '@ai-floor-planner/core';
import {
  renderSchematicPng512,
  type ApartmentGenerationManifest,
  type DeterministicApartmentSchematic,
  type FloorPlanImagePromptRequest,
  type GeneratedPlanImage,
} from '@ai-floor-planner/ai-orchestration';
import {
  measureApartmentBuilding,
  runApartmentPlanValidation,
  type ApartmentPlanValidationResult,
} from '@ai-floor-planner/planning-engine';
import { siteContext } from './extraction-pipeline.js';
import { apartmentExpectationFromManifest, schematicToApartmentStructure } from './apartment-structure.js';

/** Where the authoritative candidate came from. */
export type CandidateSource = 'FLUX' | 'FALLBACK_DETERMINISTIC';

/** What the candidate's image actually depicts. */
export type CandidateVisualSource = 'FLUX_IMAGE' | 'DETERMINISTIC_SCHEMATIC';

export const FALLBACK_DETERMINISTIC_PROVIDER = 'deterministic-planner';
export const FALLBACK_DETERMINISTIC_MODEL = 'deterministic-apartment-schematic-v1';
export const FALLBACK_DETERMINISTIC_PROMPT_VERSION = 0;

/** User-facing, provenance-honest message shown when the fallback is used. */
export const FALLBACK_USER_MESSAGE =
  'AI visual generation did not produce an acceptable candidate after the allowed attempts. ' +
  'A deterministic apartment plan has been generated instead. Source: Deterministic planner.';

export interface FallbackStructuralCounts {
  readonly flats: number;
  readonly lifts: number;
  readonly stairs: number;
  readonly commonLobby: boolean;
}

export interface FallbackIssue {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
}

export interface DeterministicFallbackPlan {
  readonly status: 'ACCEPTED' | 'REJECTED';
  /** Canonical Building; present only when ACCEPTED. */
  readonly building: Building | null;
  readonly isValid: boolean;
  readonly geometryHealthy: boolean;
  readonly issues: readonly FallbackIssue[];
  /** Counts measured on the canonical Building (not copied from the request). */
  readonly measured: FallbackStructuralCounts;
  readonly required: FallbackStructuralCounts;
  /** Phase 4 staged hard-validation outcome. */
  readonly stages: ApartmentPlanValidationResult['stages'];
}

/**
 * Builds the authoritative deterministic base plan from the schematic and
 * validates it through the SAME Phase 4 canonical path as an interpreted
 * image (completeness → manifest match → apartment structure → canonical
 * geometry → deterministic geometry validation). Provenance stays
 * DETERMINISTIC_SCHEMATIC; FLUX-specific visual rules are not applied because
 * this plan is not a FLUX image. Count guarantees are never relaxed.
 */
export function buildDeterministicFallbackPlan(input: {
  readonly schematic: DeterministicApartmentSchematic;
  readonly manifest: ApartmentGenerationManifest;
  readonly requirements: DesignRequirementSpecification;
  readonly projectId: string;
  readonly projectName: string;
}): DeterministicFallbackPlan {
  const structure = schematicToApartmentStructure(input.schematic);
  const expectation = apartmentExpectationFromManifest(input.manifest);
  const result = runApartmentPlanValidation({
    structure,
    expectation,
    site: siteContext(input.requirements),
    projectId: input.projectId,
    projectName: input.projectName,
    manifest: input.manifest as any,
  });

  const required: FallbackStructuralCounts = {
    flats: expectation.flats,
    lifts: expectation.lifts,
    stairs: expectation.stairs,
    commonLobby: expectation.commonLobby,
  };
  // Measured on the canonical Building when it exists, otherwise on the structure.
  const measuredBuilding = result.building ? measureApartmentBuilding(result.building) : null;
  const measured: FallbackStructuralCounts = measuredBuilding
    ? { flats: measuredBuilding.flats, lifts: measuredBuilding.lifts, stairs: measuredBuilding.stairs, commonLobby: measuredBuilding.lobbies > 0 }
    : { flats: result.counts.flats, lifts: result.counts.lifts, stairs: result.counts.stairs, commonLobby: result.counts.lobbies > 0 };

  return {
    status: result.status,
    building: result.building,
    isValid: result.status === 'ACCEPTED',
    geometryHealthy: result.validation.geometryHealthy,
    issues: result.diagnostics,
    measured,
    required,
    stages: result.stages,
  };
}

/**
 * Renders the deterministic schematic as the base-plan image and wraps it in
 * the artifact-store contracts. Provider/model identify the deterministic
 * planner explicitly so history can never confuse it with a FLUX attempt.
 */
export function buildDeterministicFallbackImage(input: {
  readonly schematic: DeterministicApartmentSchematic;
  readonly seed: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly floorsCount: number;
  readonly roadFacing: string;
  readonly now?: () => Date;
}): { readonly image: GeneratedPlanImage; readonly request: FloorPlanImagePromptRequest } {
  const startedAt = Date.now();
  const png = renderSchematicPng512(input.schematic);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const description =
    `Deterministic apartment base plan rendered from schematic (${input.schematic.flatCount} flats, ` +
    `${input.schematic.core.lifts.length} lifts, ${input.schematic.core.stairs.length} stairs, common lobby). ` +
    'Not generated by FLUX.';

  const request: FloorPlanImagePromptRequest = {
    schemaVersion: 1,
    promptVersion: FALLBACK_DETERMINISTIC_PROMPT_VERSION,
    prompt: description,
    negativePrompt: '',
    seed: input.seed,
    width,
    height,
    metadata: {
      projectId: input.projectId,
      projectName: input.projectName,
      plotWidthMm: input.plotWidthMm,
      plotDepthMm: input.plotDepthMm,
      floorsCount: input.floorsCount,
      roadFacing: input.roadFacing,
      projectType: 'apartment',
    },
  };

  const image: GeneratedPlanImage = {
    imageBase64: png.toString('base64'),
    mimeType: 'image/png',
    provider: FALLBACK_DETERMINISTIC_PROVIDER,
    model: FALLBACK_DETERMINISTIC_MODEL,
    seed: input.seed,
    promptVersion: FALLBACK_DETERMINISTIC_PROMPT_VERSION,
    prompt: description,
    generatedAt: (input.now ? input.now() : new Date()).toISOString(),
    latencyMs: Date.now() - startedAt,
  };

  return { image, request };
}
