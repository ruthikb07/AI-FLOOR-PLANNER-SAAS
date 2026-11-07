/**
 * Image Prompt Compiler — Master PRD Phase 1C foundation.
 *
 * A DETERMINISTIC service that converts the canonical requirement spec, the
 * canonical Site, the reviewed Space Program and the user's free-text brief into
 * a single, reproducible image-generation request. This is the ONLY place a
 * floor-plan image prompt is assembled (Master PRD §14 forbids building prompt
 * strings ad hoc in multiple UI components).
 *
 * Boundary discipline:
 *  - This compiler produces the REQUEST only. It performs no network call.
 *  - The FLUX image model (Phase 2) generates the visual concept; it is NOT the
 *    CAD engine, geometry validator or source of truth (Master PRD §5 / §7).
 *  - The deterministic system remains responsible for feasibility, geometry and
 *    validation; Gemini (AI #2) is responsible for understanding/evaluation.
 *
 * Determinism contract (Master PRD §17):
 *      same input + same seed   => byte-identical request
 *      same input + new seed    => different candidate possibility
 */

import type {
  DesignRequirementSpecification,
  Site,
  SpaceProgram,
  DynamicApartmentManifest,
} from '@ai-floor-planner/core';
import type { ApartmentBriefConfig } from '../types/apartment.js';
import {
  type ApartmentGenerationManifest,
  type ApartmentUnitManifestItem,
  buildApartmentGenerationManifest,
} from '../apartment/manifest.js';
import { computeAspectAdaptedDimensions } from './aspect-ratio.js';
import type { ReferenceSelectionDiagnostics } from '../apartment/reference-library.js';

/** Bump when the prompt template changes so persisted artifacts stay reproducible. */
export const FLOOR_PLAN_PROMPT_VERSION = 2 as const;

export interface FloorPlanImagePromptInput {
  /** Canonical requirement spec (the PRD's "AiDesignSpec"). */
  readonly requirements: DesignRequirementSpecification;
  /** Canonical site; authoritative for plot size, setbacks and orientation. */
  readonly site: Site;
  /** Reviewed Space Program; supplies the room schedule when available. */
  readonly program?: SpaceProgram;
  /** Additional natural-language requirements (defaults to spec.rawUserPrompt). */
  readonly additionalPrompt?: string;
  /** Deterministic candidate seed. */
  readonly seed: number;
  /** Output image width in px (defaults to plot-derived aspect dimension). */
  readonly width?: number;
  /** Output image height in px (defaults to plot-derived aspect dimension). */
  readonly height?: number;
  /** Multi-reference image inputs for FLUX Klein (§3). */
  readonly referenceImages?: readonly ReferenceImageInput[];
  /** Structured reference selection and drop diagnostics (Phase 2 recovery). */
  readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
}

export interface ReferenceImageInput {
  readonly id: string;
  readonly name: string;
  readonly base64Data: string;
  readonly mimeType?: string;
}

export interface FloorPlanImagePromptRequest {
  readonly schemaVersion: 1;
  readonly promptVersion: number;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  /** Multi-reference image inputs for FLUX Klein (§3). */
  readonly referenceImages?: readonly ReferenceImageInput[];
  /** Structured reference selection and drop diagnostics (Phase 2 recovery). */
  readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
  /** Reproducibility + persistence metadata (PRD §17 / §18). */
  readonly metadata: {
    readonly projectId?: string;
    readonly projectName: string;
    readonly plotWidthMm: number;
    readonly plotDepthMm: number;
    readonly floorsCount: number;
    readonly roadFacing: string;
    readonly projectType?: 'apartment' | 'residential_independent';
    readonly apartmentConfig?: unknown;
    readonly manifest?: unknown;
    readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
  };
}

/** Negative prompt guards against non-plan imagery (PRD §17 "Avoid" list). */
const NEGATIVE_PROMPT =
  'perspective, 3d render, photorealistic, isometric, furniture, landscaping, people, ' +
  'cars, textures, shadows, artistic, watercolor, decorative, blurry, colored photo, ' +
  'crooked walls, broken walls, missing walls, floating walls, wood flooring, tile texture, drop shadow, ambient occlusion, 3d model';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Build the comma-separated room schedule from the reviewed program, else the brief. */
function buildRoomSchedule(input: FloorPlanImagePromptInput): string {
  const { requirements, program } = input;
  const hard = requirements.hard;
  const soft = requirements.soft;

  if (program && program.items.length > 0) {
    const parts = program.items
      .filter(item => item.quantity > 0)
      .map(item => {
        const m2 = (item.preferredAreaMm2 / 1e6).toFixed(1);
        return item.quantity > 1
          ? `${item.quantity} x ${item.name} (~${m2} m2 each)`
          : `${item.name} (~${m2} m2)`;
      });
    if (parts.length > 0) return parts.join(', ');
  }

  // Derive a deterministic schedule from the hard/soft brief.
  const parts: string[] = [];
  if (hard.bedroomCount > 0) parts.push(`${hard.bedroomCount} bedroom(s)`);
  if (hard.bathroomCount > 0) parts.push(`${hard.bathroomCount} bathroom(s)`);
  if (hard.livingRoomRequired) parts.push('living room');
  if (hard.kitchenRequired) parts.push(soft.openKitchen ? 'open kitchen' : 'kitchen');
  if (hard.diningRoomRequired) parts.push('dining room');
  if (hard.staircaseRequired) parts.push('staircase');
  if (hard.liftRequired) parts.push('lift');
  if (soft.poojaRoom) parts.push('pooja room');
  if (soft.studyRoom) parts.push('study');
  if (soft.servantQuarter) parts.push('servant quarter');
  for (const custom of hard.customRooms ?? []) {
    parts.push(`${custom.count} x ${custom.name ?? String(custom.type)}`);
  }
  return parts.join(', ');
}

/**
 * Compile the deterministic villa / independent residence floor-plan image-generation request.
 * Applies plot-aspect ratio output dimensions, count-matched references, and compact directive.
 */
export function compileFloorPlanImagePrompt(
  input: FloorPlanImagePromptInput,
): FloorPlanImagePromptRequest {
  const { requirements, site } = input;
  const { hard } = requirements;
  const { setbacks } = site;

  // Derive width/height from plot aspect ratio (Phase 2 recovery, P3/P9)
  const aspect = computeAspectAdaptedDimensions(site.plotWidth / 1000, site.plotDepth / 1000);
  const width = input.width ?? aspect.width;
  const height = input.height ?? aspect.height;
  const seed = input.seed;

  const plotWidthM = (site.plotWidth / 1000).toFixed(2);
  const plotDepthM = (site.plotDepth / 1000).toFixed(2);
  const floors = Math.max(1, hard.floorsCount);
  const floorLabel = floors === 1 ? 'single-storey ground floor' : `${floors}-storey`;

  const brief = (input.additionalPrompt ?? requirements.rawUserPrompt ?? '').trim();
  const roomSchedule = buildRoomSchedule(input);

  const directiveLines = [
    'Generate ONE professional top-down 2D residential floor plan (single-family villa / independent residence).',
    '',
    `PROJECT: ${requirements.projectName}, ${floorLabel}.`,
    `PLOT PROPORTIONS: ${plotWidthM}m (width) x ${plotDepthM}m (depth), road facing ${titleCase(site.roadFacing)}.`,
    `SETBACKS: front ${setbacks.front}mm, rear ${setbacks.rear}mm, left ${setbacks.left}mm, right ${setbacks.right}mm.`,
    `ROOM PROGRAM: ${roomSchedule || 'standard residential layout'}.`,
    ...(hard.parkingRequired && hard.parkingSpacesCount > 0 ? [`PARKING: dedicated parking for ${hard.parkingSpacesCount} car(s).`] : []),
    ...(brief.length > 0 ? [`ADDITIONAL BRIEF: ${brief}`] : []),
    '',
    'MANDATORY DIRECTIVES:',
    '- Top-down orthographic 2D architectural drafting, crisp black linework on pure white background (#ffffff).',
    '- Continuous solid black exterior perimeter walls (230mm) and clean double-line interior partition walls (115mm).',
    '- Clear room separation, proper wall thicknesses, door swings, and window openings.',
    '- Clear spatial zoning: combined LIVING_DINING zone, private bedroom circulation passage, and clustered wet walls (kitchen and bathrooms).',
    '- Structural solid walls providing clean anchor walls (north, south, east, west) clear of door swings for future furnishings.',
    '- English architectural labels only (LIVING, DINING, KITCHEN, BEDROOM, BATH, FOYER, PARKING).',
    '- Strictly 90-degree orthogonal corners with solid filled walls and zero floating linework.',
    ...(input.referenceImages && input.referenceImages.length > 0
      ? ['- Use the supplied reference images for visual drafting style. Current project requirements always override references.']
      : []),
    '',
    'STRICT PROHIBITIONS:',
    'Do not use 3D, perspective, shadows, photorealism, furniture clutter, artistic textures, or non-Latin text.',
    'No missing walls, no crooked walls, no floating walls, no color gradients, no floor texture fills.',
  ];

  const prompt = directiveLines.join('\n');

  return {
    schemaVersion: 1,
    promptVersion: FLOOR_PLAN_PROMPT_VERSION,
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    seed,
    width,
    height,
    referenceImages: input.referenceImages,
    referenceDiagnostics: input.referenceDiagnostics,
    metadata: {
      ...(requirements.projectId ? { projectId: requirements.projectId } : {}),
      projectName: requirements.projectName,
      plotWidthMm: site.plotWidth,
      plotDepthMm: site.plotDepth,
      floorsCount: floors,
      roadFacing: site.roadFacing,
      projectType: 'residential_independent',
      referenceDiagnostics: input.referenceDiagnostics,
    },
  };
}

/** Negative prompt guards specifically against non-plan imagery for apartment generation (§19, §36). */
export const APARTMENT_NEGATIVE_PROMPT =
  'NO VILLA, NO SINGLE FAMILY HOUSE, NO EXTRA FLATS, NO MISSING FLATS, NO MERGED FLATS, ' +
  'NO WRONG UNIT MIX, NO EXTRA BEDROOMS, NO MISSING BEDROOMS, NO EXTRA LIFTS, NO MISSING LIFTS, ' +
  'NO EXTRA STAIRS, NO MISSING STAIRS, NO RANDOM CORE, NO RANDOM AMENITIES, NO RANDOM ROOMS, ' +
  'NO CYRILLIC, NO RUSSIAN, NO NON-LATIN SCRIPT, NO GIBBERISH, NO PSEUDO-TEXT, NO RANDOM NUMBERS, ' +
  'NO WATERMARK, NO LOGO, NO 3D, NO PERSPECTIVE, NO PHOTOREALISTIC INTERIOR, NO HAND DRAWING, ' +
  'NO ARTISTIC RENDERING, NO DISTORTED WALLS, NO OVERLAPPING FLATS, NO FLOATING WALLS, ' +
  'NO MISSING WALLS, NO CROOKED WALLS, NO SHADOWS, NO COLOR GRADIENT, NO FLOOR TEXTURE, NO 3D FURNITURE';

export interface ApartmentFloorPlanImagePromptInput {
  readonly projectId?: string;
  readonly projectName?: string;
  readonly site: Site;
  readonly apartmentConfig: ApartmentBriefConfig;
  readonly manifest?: ApartmentGenerationManifest;
  readonly dynamicManifest?: DynamicApartmentManifest;
  readonly additionalPrompt?: string;
  readonly seed: number;
  readonly width?: number;
  readonly height?: number;
  readonly referenceImages?: readonly ReferenceImageInput[];
  readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
  /**
   * Concept mode (two-phase upgrade): the first reference image is this
   * candidate's deterministic schematic; the strategy line explains its intent.
   */
  readonly concept?: {
    readonly candidateNumber: number;
    readonly candidateCount: number;
    readonly label: string;
    readonly intent: string;
  };
}

/** Input for compiling a FLUX image prompt from a canonical DynamicApartmentManifest. */
export interface DynamicApartmentFloorPlanPromptInput {
  readonly projectId?: string;
  readonly projectName?: string;
  readonly manifest: DynamicApartmentManifest;
  readonly seed: number;
  readonly width?: number;
  readonly height?: number;
  readonly additionalPrompt?: string;
  readonly referenceImages?: readonly ReferenceImageInput[];
  readonly referenceDiagnostics?: ReferenceSelectionDiagnostics;
}

/**
 * Compact concept prompt: schematic-first, requirements > layout > reference style.
 * Short on purpose (FLUX follows short, concrete directives better than essays).
 */
function compileApartmentConceptPrompt(
  manifest: ApartmentGenerationManifest,
  concept: NonNullable<ApartmentFloorPlanImagePromptInput['concept']>,
  hasReferences: boolean,
): string {
  const count = manifest.units.exactCount;
  const countWord =
    count === 1
      ? 'ONE'
      : count === 2
        ? 'TWO'
        : count === 3
          ? 'THREE'
          : count === 4
            ? 'FOUR'
            : count === 5
              ? 'FIVE'
              : count === 6
                ? 'SIX'
                : String(count);

  const flats = manifest.units.units
    .map(
      (u: ApartmentUnitManifestItem) =>
        `${u.label} ${u.type}: ${u.bedrooms} bedrooms, ${u.bathrooms} baths, living/dining, kitchen, utility${u.balconies > 0 ? `, ${u.balconies} balcony` : ''}`,
    )
    .join('; ');
  return [
    'HARD ARCHITECTURAL CONTRACT: ONE TYPICAL FLOOR.',
    `IT MUST CONTAIN EXACTLY ${countWord} AND ONLY ${countWord} APARTMENTS.`,
    ...manifest.units.units.map(u => `${u.label.toUpperCase()} = ${u.type.toUpperCase()}`),
    `DO NOT CREATE:`,
    `FLAT ${String(count + 1).padStart(2, '0')}`,
    'Clean 2D architectural apartment floor plan, top-down orthographic CAD blueprint, solid black exterior and party walls, thin partition walls, black walls on white, thin door swings.',
    `CONCEPT ${String(concept.candidateNumber).padStart(2, '0')} of ${String(concept.candidateCount).padStart(2, '0')} - ${concept.label}: ${concept.intent}`,
    'Input image 1 is the deterministic layout: keep its flat boundaries, core position, room arrangement and doors.',
    ...(hasReferences
      ? ['Other input images are drafting-style and organisation references only: never copy their flat count, geometry, names, numbers, text or watermarks.']
      : []),
    'Priority: user requirements > deterministic layout > reference style.',
    `EXACTLY ${manifest.units.exactCount} flats. ${flats}.`,
    `Common core: EXACTLY ${manifest.commonCore.lifts} lifts drawn as boxes with X, EXACTLY ${manifest.commonCore.stairs} stairs with treads, one common lobby touching every flat entrance.`,
    'Entry sequence in every flat: common lobby > entrance door > foyer > living/dining > passage > bedrooms. The lobby never opens into a bedroom or bath.',
    'Balconies outside the facade. English labels only: FLAT 01, FLAT 02, LIVING/DINING, KITCHEN, MASTER BED, BEDROOM, BATH, UTILITY, FOYER, BALCONY, LIFT, STAIR, COMMON LOBBY.',
    'No 3D, no perspective, no furniture clutter, no watermark, no logo, no non-Latin text.',
  ].join('\n');
}

/**
 * Compile a specialized 2D Apartment Floor Plan Image Prompt based on the Structured Generation Manifest (§1, §17, §18).
 * Phase 2 recovery (P2, P3): Replaces long-form essay with a short, compact directive while preserving manifest metadata.
 * Adapts output canvas width and height to the plot aspect ratio.
 */
export function compileApartmentFloorPlanImagePrompt(
  input: ApartmentFloorPlanImagePromptInput,
): FloorPlanImagePromptRequest {
  if (input.dynamicManifest) {
    return compileDynamicApartmentFloorPlanImagePrompt({
      projectId: input.projectId,
      projectName: input.projectName,
      manifest: input.dynamicManifest,
      seed: input.seed,
      width: input.width,
      height: input.height,
      additionalPrompt: input.additionalPrompt,
      referenceImages: input.referenceImages,
      referenceDiagnostics: input.referenceDiagnostics,
    });
  }

  const { site, apartmentConfig, seed } = input;

  // Derive width/height from plot aspect ratio (Phase 2 recovery, P3)
  const aspect = computeAspectAdaptedDimensions(site.plotWidth / 1000, site.plotDepth / 1000);
  const width = input.width ?? aspect.width;
  const height = input.height ?? aspect.height;

  // Build or use provided canonical manifest (§3)
  const manifest =
    input.manifest ??
    buildApartmentGenerationManifest({
      site: {
        plotWidthMm: site.plotWidth,
        plotDepthMm: site.plotDepth,
        setbacksMm: site.setbacks,
        roadFacing: site.roadFacing,
        orientationDegrees: site.orientation,
      },
      apartmentConfig,
    });

  const floorsCount = manifest.project.floors;
  const floorStrategy = manifest.project.floorType;

  // Unit mix representation
  const unitMixParts = apartmentConfig.unitMix.map(u => `${u.count} x ${u.unitType}`);
  const unitMixDescription = unitMixParts.join(', ');

  // Compact Directive (Phase 2 recovery, P2) — replaces ~120-line prose essay
  const promptLines = [
    'CREATE ONE PROFESSIONAL 2D INDIAN APARTMENT FLOOR PLAN.',
    '',
    `PROJECT: Multi-unit residential apartment (${floorsCount} floors).`,
    `CURRENT FLOOR: ${floorStrategy.toUpperCase()} RESIDENTIAL FLOOR.`,
    `JURISDICTION: ${manifest.jurisdiction.authority} (${manifest.jurisdiction.ruleProfile}).`,
    `PLOT PROPORTIONS: ${manifest.site.widthM}m width × ${manifest.site.depthM}m depth.`,
    '',
    'REFERENCE PRIORITY:',
    '1. USER/MANIFEST REQUIREMENTS (authoritative for counts & mix)',
    '2. DETERMINISTIC SCHEMATIC (primary structural reference for layout & core)',
    '3. REFERENCE IMAGE VISUAL STYLE (architectural drafting style only)',
    '',
    'HARD REQUIREMENTS:',
    `1. Generate EXACTLY ${manifest.units.exactCount} separate residential flats (${manifest.units.units.map((u: ApartmentUnitManifestItem) => `${u.label}: ${u.type}`).join(', ')}).`,
    `2. Exact unit mix: ${unitMixDescription}. Total bedrooms across floor: ${manifest.roomTotals.bedrooms}.`,
    `3. Common core: EXACTLY ${manifest.commonCore.lifts} separate elevator shaft(s) [X], EXACTLY ${manifest.commonCore.stairs} staircase(s), common lobby and corridor.`,
    '4. Clean 2D orthographic technical drafting, solid black walls, clear partition lines, thin door swing arcs, crisp black architectural linework on white background.',
    '5. English only: readable English architectural labels only (FLAT, LIVING, BEDROOM, KITCHEN, BATH, BALCONY, LIFT, STAIR, COMMON LOBBY).',
    '6. Plancraft Spatial Zoning: Combined LIVING_DINING zone, private bedroom circulation passages, clustered wet-wall plumbing, and solid furniture anchor walls.',
    '',
    'DO NOT GENERATE:',
    'No villa, no single-family house, no extra flats, no missing flats, no merged flats. No 3D, no perspective, no photorealism, no furniture clutter, no Cyrillic or non-Latin script, no crooked walls.',
  ];

  const prompt = input.concept
    ? compileApartmentConceptPrompt(manifest, input.concept, (input.referenceImages?.length ?? 0) > 0)
    : promptLines.join('\n');

  return {
    schemaVersion: 1,
    promptVersion: FLOOR_PLAN_PROMPT_VERSION,
    prompt,
    negativePrompt: APARTMENT_NEGATIVE_PROMPT,
    seed,
    width,
    height,
    referenceImages: input.referenceImages,
    referenceDiagnostics: input.referenceDiagnostics,
    metadata: {
      projectId: input.projectId,
      projectName: input.projectName ?? 'Apartment Building Project',
      plotWidthMm: site.plotWidth,
      plotDepthMm: site.plotDepth,
      floorsCount,
      roadFacing: site.roadFacing,
      projectType: 'apartment',
      apartmentConfig,
      manifest,
      referenceDiagnostics: input.referenceDiagnostics,
    },
  };
}

/**
 * Compiles a precision orthographic 2D architectural image prompt for Cloudflare Workers AI FLUX
 * from a user-defined DynamicApartmentManifest (§1A).
 *
 * Enforces:
 * - Full-bleed 100% canvas utilization matching exact plot aspect ratio (plotWidthMm : plotDepthMm).
 * - Exact flat count (2 for Double Flat, 3 for Triple Flat, 4 for Quad Flat).
 * - Detailed programmatic unit schedules (1BHK, 2BHK, 3BHK, 4BHK) with carpet areas, attached baths, and utility.
 * - Lot utilization policy: FULL_LOT_100_PERCENT (with internal OTS light wells) vs STATUTORY_SETBACK_100_PERCENT.
 * - Delineated central elevator bank, fire-escape staircases, common corridor spine, and tenancy privacy.
 */
export function compileDynamicApartmentFloorPlanImagePrompt(
  input: DynamicApartmentFloorPlanPromptInput,
): FloorPlanImagePromptRequest {
  const { manifest, seed } = input;
  const aspect = computeAspectAdaptedDimensions(manifest.plotWidthMm / 1000, manifest.plotDepthMm / 1000);
  const width = input.width ?? aspect.width;
  const height = input.height ?? aspect.height;

  const plotWidthM = (manifest.plotWidthMm / 1000).toFixed(2);
  const plotDepthM = (manifest.plotDepthMm / 1000).toFixed(2);
  const flatsCount = manifest.flatsPerFloor;
  const topologyName =
    flatsCount === 2
      ? 'DOUBLE FLAT (2 units/floor)'
      : flatsCount === 3
        ? 'TRIPLE FLAT (3 units/floor)'
        : 'QUAD FLAT (4 units/floor)';

  const unitsList = manifest.units.map(u => {
    const carpet = u.targetCarpetSqFt ? ` (~${u.targetCarpetSqFt} sq ft carpet)` : '';
    const baths = u.attachedBathCount ? ` with ${u.attachedBathCount} attached en-suite bath(s)` : '';
    const util = u.hasUtilityBalcony ? ', kitchen utility yard' : '';
    return `FLAT ${String(u.unitIndex).padStart(2, '0')}: ${u.bhkType}${carpet}${baths}${util}`;
  });

  const lotAllotmentDirective =
    manifest.lotAllotmentMode === 'FULL_LOT_100_PERCENT'
      ? 'FULL-BLEED 100% CANVAS & LOT UTILIZATION: Ground and typical floor plates extend edge-to-edge across the entire plot boundary with zero exterior setback gaps; internal light and ventilation provided via central open-to-sky (OTS) shafts and ventilation shafts.'
      : '100% COMPLETE PLOT ACCOUNTING: Full plot utilization with strict accounting across building footprint, statutory municipal setbacks, off-street parking, and perimeter circulation with zero unexplained residual blank space.';

  const promptLines = [
    'CREATE ONE PROFESSIONAL 2D INDIAN APARTMENT ARCHITECTURAL FLOOR PLAN.',
    '',
    `PROJECT: ${input.projectName ?? 'Multi-Unit Residential Apartment'}, ${topologyName}.`,
    `PLOT PROPORTIONS: ${plotWidthM}m width × ${plotDepthM}m depth (aspect ratio strictly matched).`,
    `NORTH ORIENTATION: ${manifest.northAngleDeg} degrees.`,
    `JURISDICTION: ${manifest.jurisdiction.toUpperCase()}.`,
    `CANVAS ALLOTMENT: ${lotAllotmentDirective}`,
    '',
    'HARD ARCHITECTURAL REQUIREMENTS:',
    `1. Generate EXACTLY ${flatsCount} separate self-contained flats:`,
    ...unitsList.map(u => `   - ${u}`),
    '2. Central core: Delineated elevator bank (2 passenger/service lifts [X]), 2 fire-escape staircases with treads, common lobby.',
    '3. Circulation & Tenancy Separation: Central common corridor spine connects strictly to each unit\'s Main Entrance door (1050 x 2100 mm). Common corridor NEVER opens directly into a private bedroom or bathroom.',
    '4. Wall Hierarchy: Solid black exterior and unit demising party walls (230 mm), common corridor walls (150 mm), internal room partitions (115 mm).',
    '5. Balconies: Economically useful balconies with clear depth >= 1200 mm (target 1570 mm) opening exclusively from living or bedroom spaces.',
    '6. Clean 2D orthographic technical drafting, crisp black walls on pure white background (#ffffff), 90-degree orthogonal corners, thin door swing arcs.',
    '7. English labels only: FLAT 01, FLAT 02, LIVING/DINING, KITCHEN, UTILITY, MASTER BED, BEDROOM, BATH, BALCONY, LIFT, STAIR, COMMON CORRIDOR.',
    '8. Plancraft Architectural Layout Rules: Combined LIVING_DINING zone, private bedroom circulation passages, clustered wet walls with service shafts, and solid anchor walls (north, south, east, west) clear of door swings.',
    ...(input.additionalPrompt ? ['', `ADDITIONAL BRIEF: ${input.additionalPrompt.trim()}`] : []),
  ];

  return {
    schemaVersion: 1,
    promptVersion: FLOOR_PLAN_PROMPT_VERSION,
    prompt: promptLines.join('\n'),
    negativePrompt: APARTMENT_NEGATIVE_PROMPT,
    seed,
    width,
    height,
    referenceImages: input.referenceImages,
    referenceDiagnostics: input.referenceDiagnostics,
    metadata: {
      projectId: input.projectId,
      projectName: input.projectName ?? 'Dynamic Apartment Project',
      plotWidthMm: manifest.plotWidthMm,
      plotDepthMm: manifest.plotDepthMm,
      floorsCount: 1,
      roadFacing: 'north',
      projectType: 'apartment',
      manifest,
      referenceDiagnostics: input.referenceDiagnostics,
    },
  };
}
