/**
 * AI Concept Image service — Master PRD Phase 2 (§17/§18).
 *
 * Pure, deterministic helpers connecting the canonical project state to the
 * server-side FLUX image boundary. No credentials ever exist in this file.
 *
 * Determinism (PRD §17): seeds advance by a fixed step per attempt, never
 * Math.random — the same attempt always produces the same seed, and a new
 * attempt produces a different candidate possibility.
 */

import { adaptSpaceProgramToResidentialRequirements, type Building, type DesignRequirementSpecification } from '@ai-floor-planner/core';
import { compileFloorPlanImagePrompt, type FloorPlanImagePromptRequest } from '@ai-floor-planner/ai-orchestration';
import type { ProjectEnvelope } from './storage';

/** Fixed, non-random seed step between candidate attempts (PRD §17). */
export const IMAGE_SEED_STEP = 7919;

export function nextImageSeed(baseSeed: number, attempt: number): number {
  const safeAttempt = Math.max(0, Math.trunc(attempt));
  const seed = (Math.trunc(baseSeed) + safeAttempt * IMAGE_SEED_STEP) % 2_147_483_647;
  return seed < 0 ? seed + 2_147_483_647 : seed;
}

/** The reviewed base seed for image attempts, derived from the project state. */
export function imageBaseSeed(project: ProjectEnvelope, fallback = 20260904): number {
  const candidateSeed = project.generationSession?.requestSeed;
  return Number.isFinite(candidateSeed) && (candidateSeed as number) > 0 ? candidateSeed as number : fallback;
}

/**
 * Derive the canonical requirement spec for image generation from the reviewed
 * Space Program. Returns undefined when the project has no reviewable program —
 * the UI must then say so instead of fabricating a brief.
 */
export function resolveImageRequirements(project: ProjectEnvelope): DesignRequirementSpecification | undefined {
  const program = project.spaceProgram;
  if (!program || program.items.length === 0) return undefined;
  try {
    return adaptSpaceProgramToResidentialRequirements(program, project.building).requirements;
  } catch {
    return undefined;
  }
}

/** Compile the deterministic prompt request for one attempt. */
export function compileImageRequest(
  project: ProjectEnvelope,
  attempt: number,
  additionalPrompt?: string,
): FloorPlanImagePromptRequest | undefined {
  const requirements = resolveImageRequirements(project);
  if (!requirements) return undefined;
  return compileFloorPlanImagePrompt({
    requirements,
    site: project.building.site,
    ...(project.spaceProgram ? { program: project.spaceProgram } : {}),
    ...(additionalPrompt !== undefined ? { additionalPrompt } : {}),
    seed: nextImageSeed(imageBaseSeed(project), attempt),
  });
}

/** Data URL for displaying the stored original image. */
export function imageDataUrl(mimeType: string, imageBase64: string): string {
  return `data:${mimeType};base64,${imageBase64}`;
}

/** Canonical building that the image was generated from (freshness check). */
export function imageContextSignature(building: Building): string {
  return `${building.id}:${building.version}:${building.site.plotWidth}x${building.site.plotDepth}`;
}