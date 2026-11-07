/**
 * Phase 3 - Gemini Vision image interpretation (PRD 20).
 *
 * The Gemini vision capability is used ONLY to interpret a generated plan
 * image into a structured intermediate representation (ExtractedPlan). It must
 * NOT author authoritative geometry - the deterministic planning system
 * validates and normalizes everything it produces (PRD 5-7).
 */

import type { DynamicApartmentManifest } from '@ai-floor-planner/core';
import { AISafetyError, type BaseAIProvider } from '../providers/base';

/** Shared schema parts for vision interpretation. */
const roomProps = {
  id: { type: 'string' },
  name: { type: 'string' },
  type: { type: 'string' },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number', exclusiveMinimum: 0 },
  height: { type: 'number', exclusiveMinimum: 0 },
  anchorWall: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
  zoneCategory: { type: 'string', enum: ['living_dining', 'private_passage', 'wet_cluster', 'bedroom', 'core', 'other'] },
} as const;

const roomRequired = ['id', 'name', 'type', 'x', 'y', 'width', 'height'] as const;

const doorProps = {
  id: { type: 'string' },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
  type: { type: 'string', enum: ['single', 'double', 'sliding', 'open_passage', 'unknown'] },
  swingDirection: { type: 'string', enum: ['inward', 'outward', 'left', 'right', 'unknown'] },
  adjacentRoomId: { type: 'string' },
} as const;

const windowProps = {
  id: { type: 'string' },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
  adjacentRoomId: { type: 'string' },
} as const;

/** Vision interpretation schema returned by Gemini. */
export const IMAGE_INTERPRETATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['boundary', 'rooms', 'doors', 'windows', 'stairs', 'parking'],
  properties: {
    boundary: {
      type: 'object',
      additionalProperties: false,
      required: ['points'],
      properties: {
        points: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } } },
          minItems: 3,
        },
      },
    },
    rooms: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: roomRequired, properties: roomProps },
    },
    doors: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'x', 'y', 'width', 'height', 'type', 'adjacentRoomId'], properties: doorProps },
    },
    windows: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'x', 'y', 'width', 'height', 'adjacentRoomId'], properties: windowProps },
    },
    stairs: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'x', 'y', 'width', 'height'], properties: roomProps },
    },
    parking: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'x', 'y', 'width', 'height'], properties: roomProps },
    },
  },
} as const;

// ─── Recovery Phase 4: apartment-aware extension of the SAME schema ─────────

/** flatId value for shared/common spaces (core, lobby, corridors, shafts). */
export const COMMON_AREA_FLAT_ID = 'COMMON';

/** Apartment interpretations use Gemini's normalized 0–1000 box convention. */
export const APARTMENT_INTERPRETATION_FRAME = { width: 1000, height: 1000 } as const;

const flatIdProp = {
  type: 'string',
  description: `Id of the flat (flats[].id) this space belongs to, or "${COMMON_AREA_FLAT_ID}" for shared common space.`,
} as const;

const groupedRoomItem = {
  type: 'object',
  additionalProperties: false,
  required: [...roomRequired, 'flatId'],
  properties: { ...roomProps, flatId: flatIdProp },
} as const;

const coreElementItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'x', 'y', 'width', 'height', 'flatId'],
  properties: { ...roomProps, flatId: flatIdProp },
} as const;

const commonElementItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'x', 'y', 'width', 'height'],
  properties: roomProps,
} as const;

/**
 * Apartment interpretation schema: the base IMAGE_INTERPRETATION_SCHEMA
 * extended with explicit flat grouping, flat boundaries, and the common core
 * (lifts, stairs, lobbies, corridors, shafts). Rooms and stairs carry a
 * flatId so private and common areas are never flattened together.
 */
/**
 * Builds a dynamic apartment vision interpretation schema tailored to the requested
 * flats per floor and unit typologies (§1A).
 */
export function buildDynamicApartmentVisionSchema(context?: {
  readonly flatsPerFloor?: number;
  readonly allowedBhkTypes?: readonly string[];
}): Record<string, unknown> {
  const flatsProps: Record<string, unknown> = {
    type: 'array',
    description: 'Each distinct self-contained apartment unit with its outer boundary box.',
  };
  if (context?.flatsPerFloor) {
    flatsProps.minItems = context.flatsPerFloor;
    flatsProps.maxItems = context.flatsPerFloor;
  }

  const unitTypeProps: Record<string, unknown> = {
    type: 'string',
    description: 'Typology from the bedrooms actually drawn, e.g. 1BHK, 2BHK, 3BHK, or 4BHK.',
  };
  if (context?.allowedBhkTypes && context.allowedBhkTypes.length > 0) {
    unitTypeProps.enum = [...context.allowedBhkTypes];
  }

  return {
    ...IMAGE_INTERPRETATION_SCHEMA,
    required: [...IMAGE_INTERPRETATION_SCHEMA.required, 'flats', 'lifts', 'lobbies', 'corridors', 'shafts'],
    properties: {
      ...IMAGE_INTERPRETATION_SCHEMA.properties,
      rooms: { type: 'array', items: groupedRoomItem },
      stairs: { type: 'array', items: coreElementItem },
      flats: {
        ...flatsProps,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'unitType', 'x', 'y', 'width', 'height'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string', description: 'Visible flat label, e.g. FLAT 01.' },
            unitType: unitTypeProps,
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
          },
        },
      },
      lifts: { type: 'array', items: coreElementItem },
      lobbies: { type: 'array', items: commonElementItem },
      corridors: { type: 'array', items: commonElementItem },
      shafts: { type: 'array', items: commonElementItem },
    },
  };
}

/**
 * Apartment interpretation schema: the base IMAGE_INTERPRETATION_SCHEMA
 * extended with explicit flat grouping, flat boundaries, and the common core
 * (lifts, stairs, lobbies, corridors, shafts). Rooms and stairs carry a
 * flatId so private and common areas are never flattened together.
 */
export const APARTMENT_IMAGE_INTERPRETATION_SCHEMA = buildDynamicApartmentVisionSchema();

/** Structured apartment context sent with the image (manifest-derived). */
export interface ApartmentInterpretationContext {
  readonly flatsPerFloor: number;
  readonly unitMix: ReadonlyArray<{ readonly unitType: string; readonly count: number }>;
  readonly lifts: number;
  readonly stairs: number;
  readonly commonLobby: boolean;
}

export interface InterpretPlanImageOptions {
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly orientationDegrees: number;
  readonly roadFacing: string;
  readonly userPrompt?: string;
  readonly imageBase64: string;
  readonly imageMimeType: string;
  readonly timeoutMs?: number;
  /** When present, the apartment-aware schema and normalized 0–1000 frame are used. */
  readonly apartmentContext?: ApartmentInterpretationContext;
  /** Canonical dynamic manifest driving generation (§1A). */
  readonly dynamicManifest?: DynamicApartmentManifest;
  /** Original structured requirements, sent as JSON context (never as geometry). */
  readonly requirements?: Readonly<Record<string, unknown>>;
}

export type InterpretationCoordinateFrame =
  | { readonly kind: 'image_pixels' }
  | { readonly kind: 'normalized'; readonly width: number; readonly height: number };

export interface PlanInterpretationResponse {
  readonly parsed: unknown;
  readonly model: string;
  readonly latencyMs: number;
  readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  readonly coordinateFrame: InterpretationCoordinateFrame;
}

/**
 * Call Gemini Vision on a generated floor-plan image and return the raw
 * structured interpretation. The caller (planning-engine) converts this into
 * the deterministic ExtractedPlan and validates it before any canonical use.
 */
export async function interpretPlanImageWithGemini(
  provider: BaseAIProvider,
  options: InterpretPlanImageOptions,
): Promise<PlanInterpretationResponse> {
  const dynamic = options.dynamicManifest;
  const apartment =
    options.apartmentContext ??
    (dynamic
      ? {
          flatsPerFloor: dynamic.flatsPerFloor,
          unitMix: dynamic.units.map(u => ({ unitType: u.bhkType, count: 1 })),
          lifts: 2,
          stairs: 2,
          commonLobby: true,
        }
      : undefined);
  const frame = APARTMENT_INTERPRETATION_FRAME;

  const dynamicSchema = dynamic
    ? buildDynamicApartmentVisionSchema({
        flatsPerFloor: dynamic.flatsPerFloor,
        allowedBhkTypes: dynamic.units.map(u => u.bhkType),
      })
    : apartment
      ? APARTMENT_IMAGE_INTERPRETATION_SCHEMA
      : IMAGE_INTERPRETATION_SCHEMA;

  const systemPrompt = [
    'You are an architectural vision interpreter for a residential floor-planning tool adhering to Plancraft two-stage structural and measurement extraction rules.',
    'Stage 1 (Structural Inventory): Scan the floor plan systematically (perimeter-first, row-by-row). Accurately identify enclosed rooms without merging.',
    'Differentiate combined LIVING_DINING zones (open-plan living and dining space) from isolated living/dining rooms.',
    'Delineate private bedroom circulation passages separating public common areas from private bedrooms and baths.',
    'Cluster wet-wall zones (bathrooms, toilets, kitchens, and plumbing shafts sharing plumbing infrastructure).',
    'Stage 2 (Relational Furniture Anchors): Identify primary furniture anchor walls (north, south, east, west) where solid walls support bed headboards, living sofas, TV consoles, or wet-wall kitchen counters.',
    'Read the supplied floor-plan image and return ONLY the JSON interpretation defined by the schema.',
    'Never invent rooms, walls, doors, windows, stairs, lifts, flats or parking that are not visible.',
    apartment
      ? `Use normalized coordinates: x and width in 0-${frame.width} across the image width, y and height in 0-${frame.height} down the image height.`
      : 'Use image pixel coordinates.',
    'Return the building boundary as the outermost wall polygon.',
    'Every room must have a stable id, a visible name/label, a canonical type, and a bounding box.',
    ...(apartment
      ? [
        `This is a multi-unit apartment floor plate with EXACTLY ${apartment.flatsPerFloor} residential flat(s). List every self-contained flat in "flats" with its outer boundary box and unit type derived from the bedrooms actually drawn.`,
        `Assign every room to its flat via flatId. Lifts, staircases, the common lobby, corridors and service shafts are COMMON space (flatId "${COMMON_AREA_FLAT_ID}") and must never be assigned to a flat.`,
        'Put lifts in "lifts", staircases in "stairs", the shared lobby in "lobbies", common passages in "corridors", ducts/OTS/shafts in "shafts".',
        'Boxes must be tight to the drawn walls and distinct spaces must not overlap: the lobby/corridor box covers only open circulation and excludes lifts, stairs and shafts; every room box lies inside its own flat box; flat boxes do not overlap each other or the core.',
        'The brief below is context only: report what the image shows even when it differs from the brief. Do not copy the brief counts.',
      ]
      : []),
    'Do not claim code compliance, structural safety or professional approval.',
  ].join(' ');

  const userPrompt = [
    'Interpret the attached floor-plan image into the structured schema.',
    `Plot dimensions: ${options.plotWidthMm} mm x ${options.plotDepthMm} mm.`,
    `Orientation: ${options.orientationDegrees} degrees; road facing ${options.roadFacing}.`,
    options.userPrompt ? `Additional requirements: ${options.userPrompt}` : '',
    apartment ? `Apartment brief (context only): ${JSON.stringify(apartment)}` : '',
    dynamic ? `Dynamic apartment manifest (context only): ${JSON.stringify(dynamic)}` : '',
    options.requirements ? `Structured requirements (context only): ${JSON.stringify(options.requirements)}` : '',
  ].filter(Boolean).join('\n');

  const apiResponse = await provider.complete({
    taskType: 'image_interpretation' as never,
    systemPrompt,
    userPrompt,
    // Explicit typed image part (recovery Phase 4, P8) — never embedded in prompt text.
    images: [{ mimeType: options.imageMimeType, data: options.imageBase64 }],
    responseFormat: 'json',
    responseSchema: dynamicSchema as Record<string, unknown>,
    maxTokens: apartment ? 16384 : 8192,
    temperature: 0,
  });

  const parsed = apiResponse.parsed;
  if (parsed === undefined) {
    throw new AISafetyError('Gemini vision returned no parsed interpretation.');
  }

  return {
    parsed,
    model: apiResponse.model,
    latencyMs: apiResponse.latencyMs,
    usage: apiResponse.usage,
    coordinateFrame: apartment
      ? { kind: 'normalized', width: frame.width, height: frame.height }
      : { kind: 'image_pixels' },
  };
}
