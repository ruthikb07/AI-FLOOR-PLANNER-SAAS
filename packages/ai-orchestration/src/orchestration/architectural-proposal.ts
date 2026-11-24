import {
  type AIImageInput,
  type AIProposalTelemetry,
  type AIProvider,
  type AIResponse,
  type BriefRequirementConflict,
  type BuildingMassingShape,
  type MultiSheetApartmentConfig,
  type PlanCategory,
  type ReferenceAttachmentDisposition,
  type StructuredBriefInterpretation,
  type StructuredBriefRequirementItem,
  AITaskType,
  exchangeArtifactDigest,
  mixedUnitSpecs,
  parseMixedUnitProgram,
} from '@ai-floor-planner/core';
import { GEMINI_SUPPORTED_IMAGE_MIME_TYPES, geminiErrorCode } from '../providers/gemini';

export const BUILDING_MASSING_SHAPES: readonly BuildingMassingShape[] = [
  'CURVED_CRESCENT',
  'WAVE_SERPENTINE',
  'ROTUNDA_COURTYARD',
  'ELLIPTICAL_TOWER',
  'LOTUS_PETAL_RADIAL',
  'BOWFRONT_CHAMFERED',
  'TRIANGULAR_ATRIUM',
  'Y_SHAPE_TRISKELE',
  'BUTTERFLY_V_WING',
  'HEXAGONAL_HONEYCOMB',
  'TRAPEZOIDAL_TAPERED',
  'DIAGONAL_ZIGZAG',
  'COMPACT_DOUBLE_LOADED',
  'H_SHAPE_WING',
  'U_SHAPE_COURTYARD',
  'L_SHAPE_CORNER',
  'CRUCIFORM_PLUS',
  'PINWHEEL_CLUSTER',
  'STEPPED_OFFSET_BLOCK',
  'T_SHAPE_SPINE',
  'O_SHAPE_PERIMETER_COURT',
];

export const PLAN_CATEGORIES: readonly PlanCategory[] = [
  'HIGH_RISE_APARTMENT',
  'LUXURY_VILLA_BUNGALOW',
  'DUPLEX_TRIPLEX_SKY_VILLA',
  'ROW_HOUSE_TOWNHOUSE',
  'COURTYARD_CLUSTER_HOUSING',
  'IRREGULAR_PLOT_CUSTOM',
];

function normalizeBriefSpelling(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/\bcental\b/gi, 'central')
    .replace(/\bdiffer(?:e?nt|ant)\b/gi, 'different')
    .replace(/\bdiffrent\b/gi, 'different')
    .replace(/\bapartement(s?)\b/gi, 'apartment$1')
    .replace(/\bappartment(s?)\b/gi, 'apartment$1')
    .replace(/\bvaastu\b|\bvasthu\b/gi, 'vastu')
    .replace(/\bventilatation\b/gi, 'ventilation');
}

export type RoomSlicingArchetypeId =
  | 'CENTRAL_LIVING_SPLIT_BEDROOMS'
  | 'CORNER_L_LIVING_REAR_SLEEPING'
  | 'FRONT_BALCONY_OPEN_KITCHEN'
  | 'LINEAR_TANDEM_DEEP_PLATE'
  | 'MIRRORED_WET_CORE_STACK';

export const ROOM_SLICING_ARCHETYPES: readonly RoomSlicingArchetypeId[] = [
  'CENTRAL_LIVING_SPLIT_BEDROOMS',
  'CORNER_L_LIVING_REAR_SLEEPING',
  'FRONT_BALCONY_OPEN_KITCHEN',
  'LINEAR_TANDEM_DEEP_PLATE',
  'MIRRORED_WET_CORE_STACK',
];

export type ProposalTopologyFamilyId =
  | 'CENTRAL_CORE_SPINE'
  | 'DUAL_WING'
  | 'SIDE_CORE'
  | 'CENTRAL_COURTYARD'
  | 'LINEAR_SINGLE_LOADED'
  | 'PERIMETER_HABITABLE'
  | 'SPLIT_CORE';

export interface ReferenceSpatialGraph {
  readonly detectedCorePosition?: 'CENTRAL' | 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'SPLIT';
  readonly detectedCorridorAxis?: 'HORIZONTAL' | 'VERTICAL' | 'RING';
  readonly relativeRoomCentroids: ReadonlyArray<{
    readonly roomType: string;
    readonly nx: number;
    readonly ny: number;
  }>;
  readonly balconyEdges: readonly ('NORTH' | 'SOUTH' | 'EAST' | 'WEST')[];
  readonly wetCoreClustering?: 'SHARED_SHAFT' | 'PERIMETER' | 'MIXED';
}

export interface ArchitecturalProposal {
  readonly preferredTopologyFamily: ProposalTopologyFamilyId;
  readonly preferredArchetype: RoomSlicingArchetypeId;
  readonly buildingMassingShape: BuildingMassingShape;
  readonly planCategory?: PlanCategory;
  readonly maxOtsRatio?: number;
  readonly corePlacement: 'CENTRAL' | 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'SPLIT';
  readonly ventilationStrategy: 'PERIMETER_ONLY' | 'SIDE_SHAFTS' | 'CENTRAL_COURTYARD';
  readonly noOts: boolean;
  readonly centerBuildingInEnvelope: boolean;
  readonly targetAreaSqFt?: number;
  readonly areaTargetScope?: 'GROSS_FLOOR_AREA' | 'FLOOR_TOTAL_CARPET' | 'PER_APARTMENT_CARPET';
  readonly bedroomBalconies: 'ALL_BEDROOMS' | 'MASTER_ONLY' | 'STANDARD' | 'NONE';
  readonly kitchenStyle: 'OPEN' | 'ENCLOSED';
  readonly kitchenSize: 'LARGER' | 'STANDARD';
  readonly vastuPreferences: {
    readonly kitchenQuadrant: 'SE' | 'NW' | 'ANY';
    readonly masterBedroomQuadrant: 'SW' | 'ANY';
    readonly entranceDirection: 'NORTH' | 'EAST' | 'WEST' | 'SOUTH' | 'ANY';
  };
  readonly designRationale: string;
  readonly referenceSpatialGraph?: ReferenceSpatialGraph;
}

export interface ArchitecturalProposalTelemetry extends AIProposalTelemetry {
  readonly geminiInvoked: boolean;
  readonly provider: string;
  readonly modelUsed: string;
  readonly latencyMs: number;
  readonly fallbackTriggered: boolean;
  readonly referenceImageUsedForGeometry: boolean;
}

export interface ArchitecturalProposalResult {
  readonly proposal: ArchitecturalProposal;
  readonly telemetry: ArchitecturalProposalTelemetry;
  readonly enrichedConfig: MultiSheetApartmentConfig;
}

const CORE_PROPOSAL_PROPERTIES: Record<string, unknown> = {
  preferredTopologyFamily: {
    type: 'string',
    enum: [
      'CENTRAL_CORE_SPINE',
      'DUAL_WING',
      'SIDE_CORE',
      'CENTRAL_COURTYARD',
      'LINEAR_SINGLE_LOADED',
      'PERIMETER_HABITABLE',
      'SPLIT_CORE',
    ],
  },
  preferredArchetype: {
    type: 'string',
    enum: ROOM_SLICING_ARCHETYPES,
  },
  buildingMassingShape: {
    type: 'string',
    enum: BUILDING_MASSING_SHAPES,
  },
  maxOtsRatio: { type: 'number' },
  corePlacement: {
    type: 'string',
    enum: ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'SPLIT'],
  },
  ventilationStrategy: {
    type: 'string',
    enum: ['PERIMETER_ONLY', 'SIDE_SHAFTS', 'CENTRAL_COURTYARD'],
  },
  noOts: { type: 'boolean' },
  centerBuildingInEnvelope: { type: 'boolean' },
  targetAreaSqFt: { type: 'number' },
  areaTargetScope: {
    type: 'string',
    enum: ['GROSS_FLOOR_AREA', 'FLOOR_TOTAL_CARPET', 'PER_APARTMENT_CARPET'],
  },
  bedroomBalconies: {
    type: 'string',
    enum: ['ALL_BEDROOMS', 'MASTER_ONLY', 'STANDARD', 'NONE'],
  },
  kitchenStyle: {
    type: 'string',
    enum: ['OPEN', 'ENCLOSED'],
  },
  kitchenSize: {
    type: 'string',
    enum: ['LARGER', 'STANDARD'],
  },
  vastuPreferences: {
    type: 'object',
    properties: {
      kitchenQuadrant: { type: 'string', enum: ['SE', 'NW', 'ANY'] },
      masterBedroomQuadrant: { type: 'string', enum: ['SW', 'ANY'] },
      entranceDirection: { type: 'string', enum: ['NORTH', 'EAST', 'WEST', 'SOUTH', 'ANY'] },
    },
    required: ['kitchenQuadrant', 'masterBedroomQuadrant', 'entranceDirection'],
  },
  designRationale: { type: 'string' },
};

const CORE_REQUIRED_FIELDS = [
  'preferredTopologyFamily',
  'preferredArchetype',
  'buildingMassingShape',
  'corePlacement',
  'ventilationStrategy',
  'noOts',
  'centerBuildingInEnvelope',
  'bedroomBalconies',
  'kitchenStyle',
  'kitchenSize',
  'vastuPreferences',
  'designRationale',
];

/** Compact schema used when no reference image is attached (~35% fewer schema tokens). */
export const ARCHITECTURAL_PROPOSAL_TEXT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: CORE_PROPOSAL_PROPERTIES,
  required: CORE_REQUIRED_FIELDS,
};

/** Full schema including referenceSpatialGraph when a vision reference image is attached. */
export const ARCHITECTURAL_PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ...CORE_PROPOSAL_PROPERTIES,
    referenceSpatialGraph: {
      type: 'object',
      properties: {
        detectedCorePosition: { type: 'string', enum: ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'SPLIT'] },
        detectedCorridorAxis: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL', 'RING'] },
        relativeRoomCentroids: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              roomType: { type: 'string' },
              nx: { type: 'number' },
              ny: { type: 'number' },
            },
            required: ['roomType', 'nx', 'ny'],
          },
        },
        balconyEdges: {
          type: 'array',
          items: { type: 'string', enum: ['NORTH', 'SOUTH', 'EAST', 'WEST'] },
        },
        wetCoreClustering: { type: 'string', enum: ['SHARED_SHAFT', 'PERIMETER', 'MIXED'] },
      },
      required: ['detectedCorePosition', 'detectedCorridorAxis', 'relativeRoomCentroids', 'balconyEdges', 'wetCoreClustering'],
    },
  },
  required: CORE_REQUIRED_FIELDS,
};

export interface ClassifiedReferenceAttachment {
  readonly imagePart: AIImageInput | null;
  readonly disposition: ReferenceAttachmentDisposition;
  readonly imageDigest?: string;
}

export function classifyReferenceAttachment(
  referenceImage?: MultiSheetApartmentConfig['referenceImage'],
): ClassifiedReferenceAttachment {
  if (!referenceImage?.dataUrl) {
    return { imagePart: null, disposition: 'NONE' };
  }
  const trimmed = referenceImage.dataUrl.trim();
  const declaredMime = (referenceImage.mimeType || '').trim().toLowerCase();
  if (
    declaredMime === 'application/pdf' ||
    declaredMime === 'application/dxf' ||
    declaredMime === 'image/svg+xml' ||
    /^data:(?:application\/pdf|application\/dxf|image\/svg\+xml)/i.test(trimmed)
  ) {
    return { imagePart: null, disposition: 'ADVISORY_METADATA_ONLY' };
  }
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (match && match[1] && match[2]) {
    const mimeType = match[1].trim().toLowerCase();
    if (!GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      return { imagePart: null, disposition: 'UNSUPPORTED_FORMAT' };
    }
    const clean = match[2].replace(/\s+/g, '');
    if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
      return { imagePart: null, disposition: 'MALFORMED_DATA' };
    }
    return {
      imagePart: { mimeType, data: clean },
      disposition: 'VISION_INLINE_ATTACHED',
      imageDigest: exchangeArtifactDigest(new TextEncoder().encode(clean)).slice(0, 24),
    };
  }
  if (GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(declaredMime) && !trimmed.startsWith('data:')) {
    const clean = trimmed.replace(/\s+/g, '');
    if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
      return { imagePart: null, disposition: 'MALFORMED_DATA' };
    }
    return {
      imagePart: { mimeType: declaredMime, data: clean },
      disposition: 'VISION_INLINE_ATTACHED',
      imageDigest: exchangeArtifactDigest(new TextEncoder().encode(clean)).slice(0, 24),
    };
  }
  return { imagePart: null, disposition: 'MALFORMED_DATA' };
}

function detectExplicitPromptShape(prompt: string): BuildingMassingShape | undefined {
  return /\bcurved\s+crescent|\bcrescent|\bc[- ]?arc\b/.test(prompt) ? 'CURVED_CRESCENT'
    : /\bserpentine|\bs[- ]?curve|\bundulating\b/.test(prompt) ? 'WAVE_SERPENTINE'
      : /\brotunda|\bcircular\s+courtyard\b/.test(prompt) ? 'ROTUNDA_COURTYARD'
        : /\belliptical|\boval\s+tower\b/.test(prompt) ? 'ELLIPTICAL_TOWER'
          : /\blotus\s+petal|\bradial\s+petal\b/.test(prompt) ? 'LOTUS_PETAL_RADIAL'
            : /\bbow[- ]?front|\bchamfered\b/.test(prompt) ? 'BOWFRONT_CHAMFERED'
              : /\btriangular\s+atrium|\btriangular\b/.test(prompt) ? 'TRIANGULAR_ATRIUM'
                : /\by[- ]?shape|\btriskele\b/.test(prompt) ? 'Y_SHAPE_TRISKELE'
                  : /\bbutterfly|\bv[- ]?wing\b/.test(prompt) ? 'BUTTERFLY_V_WING'
                    : /\bhexagonal|\bhoneycomb\b/.test(prompt) ? 'HEXAGONAL_HONEYCOMB'
                      : /\btrapezoid(?:al)?|\btapered\b/.test(prompt) ? 'TRAPEZOIDAL_TAPERED'
                        : /\bzigzag|\bsawtooth|\bchevron\b/.test(prompt) ? 'DIAGONAL_ZIGZAG'
                          : /\bt[- ]?shape|\bt[- ]?wing\b/.test(prompt) ? 'T_SHAPE_SPINE'
                            : /\bo[- ]?shape|\bperimeter\s+court\b/.test(prompt) ? 'O_SHAPE_PERIMETER_COURT'
                              : /\bh[- ]?shape\b|\bh[- ]?wing\b/.test(prompt) ? 'H_SHAPE_WING'
                                : /\bu[- ]?shape\b|\bu[- ]?courtyard\b/.test(prompt) ? 'U_SHAPE_COURTYARD'
                                  : /\bl[- ]?shape\b|\bl[- ]?wing\b/.test(prompt) ? 'L_SHAPE_CORNER'
                                    : /\bcruciform\b|\bplus[- ]?shape\b/.test(prompt) ? 'CRUCIFORM_PLUS'
                                      : /\bpinwheel\b/.test(prompt) ? 'PINWHEEL_CLUSTER'
                                        : /\bstepped\b|\boffset\s+block\b/.test(prompt) ? 'STEPPED_OFFSET_BLOCK'
                                          : undefined;
}

export function defaultProposalForConfig(
  config: MultiSheetApartmentConfig,
  seed: number,
): ArchitecturalProposal {
  const prompt = normalizeBriefSpelling(config.aiPrompt).toLowerCase();
  const explicitlyNoOts = /\bno\s+ots\b|\bwithout\s+ots\b|\bexclude\s+ots\b|\bperimeter\s+only\b/.test(prompt);
  const explicitlyOts = !explicitlyNoOts && /\bopen[- ]to[- ]sky\b|\bots\b|\bcourtyard\b/.test(prompt);
  const explicitlyNoBalcony = /\bno\s+balcon|\bwithout\s+balcon|\bexclude\s+balcon|\bzero\s+balcon/.test(prompt);
  const properSpaceUtilization = /\bproper\s+space\s+utiliz|\bspace\s+utilization\b|\befficient\s+space\b|\bno\s+(?:empty|wasted|giant)\s+(?:void|gap|strip)/.test(prompt);
  const ventilatedOtsShafts = !explicitlyNoOts && /\bventilated\s+(?:central\s+)?ots\s+shafts?\b|\bots\s+shafts?\b|\bcentral\s+ots\b/.test(prompt);
  const requestsDifferentShape = /\bdifferent\s+(?:building\s+)?(?:shape|shapes|massing|footprint)|\bunique\s+shape|\bnon[- ]?rectang|\bvaried\s+massing\b/.test(prompt);
  const explicitShape = detectExplicitPromptShape(prompt);
  const inferredCategory: PlanCategory | undefined =
    config.planCategory
    ?? (/\bluxury\s+villa|\bbungalow|\bindependent\s+villa\b/.test(prompt) ? 'LUXURY_VILLA_BUNGALOW'
      : /\bduplex|\btriplex|\bsky\s+villa\b/.test(prompt) ? 'DUPLEX_TRIPLEX_SKY_VILLA'
        : /\brow[- ]?house|\btown[- ]?house\b/.test(prompt) ? 'ROW_HOUSE_TOWNHOUSE'
          : /\bcourtyard\s+cluster|\bcluster\s+housing\b/.test(prompt) ? 'COURTYARD_CLUSTER_HOUSING'
            : /\birregular\s+plot|\btrapezoid(?:al)?\s+plot\b/.test(prompt) ? 'IRREGULAR_PLOT_CUSTOM'
              : /\bhigh[- ]?rise|\bapartment\s+tower\b/.test(prompt) ? 'HIGH_RISE_APARTMENT'
                : undefined);
  const centerBuilding = Boolean(
    config.centerBuildingInEnvelope || /\bcenter(?:ed)?\s+(?:the\s+)?building\b|\bcenter\b/.test(prompt),
  );
  const archetypeIndex = Math.max(0, seed - 1) % ROOM_SLICING_ARCHETYPES.length;
  const preferredArchetype = (config.preferredArchetype as RoomSlicingArchetypeId | undefined)
    ?? ROOM_SLICING_ARCHETYPES[archetypeIndex]!;
  const rejectedShapeSet = new Set<string>(config.rejectedShapeIds ?? []);
  const unrejectedPool = BUILDING_MASSING_SHAPES.filter(s => !rejectedShapeSet.has(s));
  const shapePool = unrejectedPool.length > 0 ? unrejectedPool : BUILDING_MASSING_SHAPES;
  const buildingMassingShape: BuildingMassingShape =
    config.buildingMassingShape
    ?? explicitShape
    ?? ((requestsDifferentShape || config.autoExploreNovelShape || rejectedShapeSet.size > 0)
      ? shapePool[(seed - 1) % shapePool.length]!
      : seed > 1
        ? shapePool[(seed - 1) % shapePool.length]!
        : 'COMPACT_DOUBLE_LOADED');
  const preferredTopologyFamily: ProposalTopologyFamilyId = explicitlyOts && !ventilatedOtsShafts && !properSpaceUtilization
    ? 'CENTRAL_COURTYARD'
    : config.flatsPerFloor >= 4
      ? 'CENTRAL_CORE_SPINE'
      : 'DUAL_WING';

  return {
    preferredTopologyFamily,
    preferredArchetype,
    buildingMassingShape,
    ...(inferredCategory ? { planCategory: inferredCategory } : {}),
    maxOtsRatio: explicitlyNoOts ? 0 : (properSpaceUtilization || ventilatedOtsShafts) ? 0.12 : undefined,
    corePlacement: 'CENTRAL',
    ventilationStrategy: explicitlyOts ? 'CENTRAL_COURTYARD' : 'PERIMETER_ONLY',
    noOts: explicitlyNoOts,
    centerBuildingInEnvelope: centerBuilding,
    targetAreaSqFt: config.targetAreaSqFt,
    areaTargetScope: config.areaTargetScope,
    bedroomBalconies: explicitlyNoBalcony
      ? 'NONE'
      : /\ball\s+bedroom|\bprivate\s+bedroom\s+balcon|\beach\s+having\s+(?:one\s+)?bedroom\s+with\s+a\s+private\s+balcony/.test(prompt)
        ? 'ALL_BEDROOMS'
        : /\bmaster.*balcony/.test(prompt)
          ? 'MASTER_ONLY'
          : 'ALL_BEDROOMS',
    kitchenStyle: /\bopen\s+kitchen\b/.test(prompt) ? 'OPEN' : 'ENCLOSED',
    kitchenSize: /\blarge[r]?\s+kitchen|\bspacious\s+kitchen/.test(prompt) ? 'LARGER' : 'STANDARD',
    vastuPreferences: {
      kitchenQuadrant: /\bsoutheast|\bse\b|\bvastu/.test(prompt) ? 'SE' : 'ANY',
      masterBedroomQuadrant: /\bsouthwest|\bsw\b|\bvastu/.test(prompt) ? 'SW' : 'ANY',
      entranceDirection: /\bnorth\s+(?:facing|entry|entrance)/.test(prompt)
        ? 'NORTH'
        : /\beast\s+(?:facing|entry|entrance)/.test(prompt)
          ? 'EAST'
          : 'ANY',
    },
    designRationale: 'Deterministic baseline architectural synthesis aligned with NBC 2016 and UDCPR parameters.',
  };
}

function sanitizeProposalWithPromptGuardrails(
  raw: Record<string, unknown> | undefined,
  config: MultiSheetApartmentConfig,
  seed: number,
  hasReferenceImage: boolean,
): { proposal: ArchitecturalProposal; rejectedReferenceGuidance: readonly string[] } {
  const base = defaultProposalForConfig(config, seed);
  if (!raw) return { proposal: base, rejectedReferenceGuidance: [] };
  const prompt = normalizeBriefSpelling(config.aiPrompt).toLowerCase();
  const explicitlyNoOts = /\bno\s+ots\b|\bwithout\s+ots\b|\bexclude\s+ots\b/.test(prompt);
  const explicitlyCentral = /\bcentral\s+lift|\bcentral\s+core/.test(prompt);
  const explicitlyNoBalcony = /\bno\s+balcon|\bwithout\s+balcon|\bexclude\s+balcon|\bzero\s+balcon/.test(prompt);
  const rejectedReferenceGuidance: string[] = [];

  const family = typeof raw.preferredTopologyFamily === 'string'
    && ['CENTRAL_CORE_SPINE', 'DUAL_WING', 'SIDE_CORE', 'CENTRAL_COURTYARD', 'LINEAR_SINGLE_LOADED', 'PERIMETER_HABITABLE', 'SPLIT_CORE'].includes(raw.preferredTopologyFamily)
    ? (raw.preferredTopologyFamily as ProposalTopologyFamilyId)
    : base.preferredTopologyFamily;

  const archetype =
    config.preferredArchetype && ROOM_SLICING_ARCHETYPES.includes(config.preferredArchetype as RoomSlicingArchetypeId)
      ? (config.preferredArchetype as RoomSlicingArchetypeId)
      : typeof raw.preferredArchetype === 'string'
        && ROOM_SLICING_ARCHETYPES.includes(raw.preferredArchetype as RoomSlicingArchetypeId)
        ? (raw.preferredArchetype as RoomSlicingArchetypeId)
        : base.preferredArchetype;

  const buildingMassingShape =
    config.buildingMassingShape
      ? config.buildingMassingShape
      : typeof raw.buildingMassingShape === 'string'
        && (BUILDING_MASSING_SHAPES.includes(raw.buildingMassingShape as BuildingMassingShape) || raw.buildingMassingShape.startsWith('PARAM_'))
        ? (raw.buildingMassingShape as BuildingMassingShape)
        : base.buildingMassingShape;

  const planCategory =
    config.planCategory
      ? config.planCategory
      : typeof raw.planCategory === 'string'
        && PLAN_CATEGORIES.includes(raw.planCategory as PlanCategory)
        ? (raw.planCategory as PlanCategory)
        : base.planCategory;

  const maxOtsRatio = typeof raw.maxOtsRatio === 'number' && Number.isFinite(raw.maxOtsRatio) && raw.maxOtsRatio >= 0 && raw.maxOtsRatio <= 0.35
    ? raw.maxOtsRatio
    : base.maxOtsRatio;

  const corePlacement = explicitlyCentral
    ? 'CENTRAL'
    : typeof raw.corePlacement === 'string' && ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'SPLIT'].includes(raw.corePlacement)
      ? (raw.corePlacement as ArchitecturalProposal['corePlacement'])
      : base.corePlacement;

  const noOts = explicitlyNoOts ? true : typeof raw.noOts === 'boolean' ? raw.noOts : base.noOts;
  const ventilationStrategy = noOts
    ? 'PERIMETER_ONLY'
    : typeof raw.ventilationStrategy === 'string' && ['PERIMETER_ONLY', 'SIDE_SHAFTS', 'CENTRAL_COURTYARD'].includes(raw.ventilationStrategy)
      ? (raw.ventilationStrategy as ArchitecturalProposal['ventilationStrategy'])
      : base.ventilationStrategy;

  const centerBuildingInEnvelope = base.centerBuildingInEnvelope || raw.centerBuildingInEnvelope === true;

  const targetAreaSqFt = config.targetAreaSqFt ?? (typeof raw.targetAreaSqFt === 'number' && Number.isFinite(raw.targetAreaSqFt) && raw.targetAreaSqFt > 200 ? raw.targetAreaSqFt : undefined);
  const areaTargetScope = config.areaTargetScope
    ?? (typeof raw.areaTargetScope === 'string' && ['GROSS_FLOOR_AREA', 'FLOOR_TOTAL_CARPET', 'PER_APARTMENT_CARPET'].includes(raw.areaTargetScope)
      ? (raw.areaTargetScope as ArchitecturalProposal['areaTargetScope'])
      : base.areaTargetScope);

  const rawVastu = (typeof raw.vastuPreferences === 'object' && raw.vastuPreferences !== null)
    ? (raw.vastuPreferences as Record<string, unknown>)
    : {};

  let referenceSpatialGraph: ReferenceSpatialGraph | undefined;
  if (!hasReferenceImage && raw.referenceSpatialGraph !== undefined) {
    rejectedReferenceGuidance.push('UNATTACHED_IMAGE_SPATIAL_GRAPH_DISCARDED');
  } else if (hasReferenceImage && raw.referenceSpatialGraph !== undefined) {
    if (typeof raw.referenceSpatialGraph !== 'object' || raw.referenceSpatialGraph === null || Array.isArray(raw.referenceSpatialGraph)) {
      rejectedReferenceGuidance.push('MALFORMED_REFERENCE_GRAPH_OBJECT');
    } else {
      const rg = raw.referenceSpatialGraph as Record<string, unknown>;
      const validCore = ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'SPLIT'].includes(String(rg.detectedCorePosition));
      if (rg.detectedCorePosition !== undefined && !validCore) {
        rejectedReferenceGuidance.push('INVALID_DETECTED_CORE_POSITION');
      }
      const validAxis = ['HORIZONTAL', 'VERTICAL', 'RING'].includes(String(rg.detectedCorridorAxis));
      if (rg.detectedCorridorAxis !== undefined && !validAxis) {
        rejectedReferenceGuidance.push('INVALID_DETECTED_CORRIDOR_AXIS');
      }
      const validWet = ['SHARED_SHAFT', 'PERIMETER', 'MIXED'].includes(String(rg.wetCoreClustering));
      if (rg.wetCoreClustering !== undefined && !validWet) {
        rejectedReferenceGuidance.push('INVALID_WET_CORE_CLUSTERING');
      }

      const centroids: Array<{ roomType: string; nx: number; ny: number }> = [];
      if (Array.isArray(rg.relativeRoomCentroids)) {
        for (const item of rg.relativeRoomCentroids) {
          if (!item || typeof item !== 'object') {
            rejectedReferenceGuidance.push('MALFORMED_ROOM_CENTROID');
            continue;
          }
          const point = item as Record<string, unknown>;
          const roomType = typeof point.roomType === 'string' ? point.roomType.trim() : '';
          const nx = point.nx;
          const ny = point.ny;
          // Reject malformed or out-of-range [0..1] normalized coordinates rather than clamping invalid numbers.
          if (
            !roomType ||
            typeof nx !== 'number' ||
            typeof ny !== 'number' ||
            !Number.isFinite(nx) ||
            !Number.isFinite(ny) ||
            nx < 0 ||
            nx > 1 ||
            ny < 0 ||
            ny > 1
          ) {
            rejectedReferenceGuidance.push('MALFORMED_ROOM_CENTROID');
            continue;
          }
          centroids.push({ roomType, nx, ny });
        }
      }

      const balconyEdges: Array<'NORTH' | 'SOUTH' | 'EAST' | 'WEST'> = [];
      if (Array.isArray(rg.balconyEdges)) {
        for (const edge of rg.balconyEdges) {
          if (['NORTH', 'SOUTH', 'EAST', 'WEST'].includes(String(edge))) {
            balconyEdges.push(String(edge) as 'NORTH' | 'SOUTH' | 'EAST' | 'WEST');
          } else {
            rejectedReferenceGuidance.push('INVALID_BALCONY_EDGE');
          }
        }
      }

      referenceSpatialGraph = {
        detectedCorePosition: validCore ? (String(rg.detectedCorePosition) as ReferenceSpatialGraph['detectedCorePosition']) : undefined,
        detectedCorridorAxis: validAxis ? (String(rg.detectedCorridorAxis) as ReferenceSpatialGraph['detectedCorridorAxis']) : undefined,
        relativeRoomCentroids: centroids,
        balconyEdges,
        wetCoreClustering: validWet ? (String(rg.wetCoreClustering) as ReferenceSpatialGraph['wetCoreClustering']) : undefined,
      };
    }
  }

  const bedroomBalconies: ArchitecturalProposal['bedroomBalconies'] = explicitlyNoBalcony
    ? 'NONE'
    : typeof raw.bedroomBalconies === 'string' && ['ALL_BEDROOMS', 'MASTER_ONLY', 'STANDARD', 'NONE'].includes(raw.bedroomBalconies)
      ? (raw.bedroomBalconies as ArchitecturalProposal['bedroomBalconies'])
      : base.bedroomBalconies;

  return {
    proposal: {
      preferredTopologyFamily: noOts && family === 'CENTRAL_COURTYARD' ? 'CENTRAL_CORE_SPINE' : family,
      preferredArchetype: archetype,
      buildingMassingShape,
      ...(planCategory ? { planCategory } : {}),
      ...(maxOtsRatio !== undefined ? { maxOtsRatio } : {}),
      corePlacement,
      ventilationStrategy,
      noOts,
      centerBuildingInEnvelope,
      ...(targetAreaSqFt !== undefined ? { targetAreaSqFt } : {}),
      ...(areaTargetScope !== undefined ? { areaTargetScope } : {}),
      bedroomBalconies,
      kitchenStyle: typeof raw.kitchenStyle === 'string' && ['OPEN', 'ENCLOSED'].includes(raw.kitchenStyle)
        ? (raw.kitchenStyle as ArchitecturalProposal['kitchenStyle'])
        : base.kitchenStyle,
      kitchenSize: typeof raw.kitchenSize === 'string' && ['LARGER', 'STANDARD'].includes(raw.kitchenSize)
        ? (raw.kitchenSize as ArchitecturalProposal['kitchenSize'])
        : base.kitchenSize,
      vastuPreferences: {
        kitchenQuadrant: ['SE', 'NW', 'ANY'].includes(String(rawVastu.kitchenQuadrant))
          ? (String(rawVastu.kitchenQuadrant) as 'SE' | 'NW' | 'ANY')
          : base.vastuPreferences.kitchenQuadrant,
        masterBedroomQuadrant: ['SW', 'ANY'].includes(String(rawVastu.masterBedroomQuadrant))
          ? (String(rawVastu.masterBedroomQuadrant) as 'SW' | 'ANY')
          : base.vastuPreferences.masterBedroomQuadrant,
        entranceDirection: ['NORTH', 'EAST', 'WEST', 'SOUTH', 'ANY'].includes(String(rawVastu.entranceDirection))
          ? (String(rawVastu.entranceDirection) as 'NORTH' | 'EAST' | 'WEST' | 'SOUTH' | 'ANY')
          : base.vastuPreferences.entranceDirection,
      },
      designRationale: typeof raw.designRationale === 'string' && raw.designRationale.trim()
        ? raw.designRationale.trim().slice(0, 480)
        : base.designRationale,
      ...(referenceSpatialGraph ? { referenceSpatialGraph } : {}),
    },
    rejectedReferenceGuidance: [...new Set(rejectedReferenceGuidance)],
  };
}

/**
 * Converts the user's configuration, prompt, and validated proposal into an explicit
 * structured requirements schema with mandatory/preference/suggestion/default/jurisdiction
 * provenance and explicit conflict detection.
 */
export function interpretStructuredBriefRequirements(
  config: MultiSheetApartmentConfig,
  proposal: ArchitecturalProposal,
  interpretationSource: 'GEMINI' | 'DETERMINISTIC',
): StructuredBriefInterpretation {
  const prompt = normalizeBriefSpelling(config.aiPrompt ?? '').toLowerCase();
  const items: StructuredBriefRequirementItem[] = [];
  const conflicts: BriefRequirementConflict[] = [];

  items.push({
    key: 'plot_envelope',
    category: 'MANDATORY',
    value: `${config.plotWidthMm}x${config.plotDepthMm}mm`,
    source: 'USER_CONFIG',
    summary: `Plot ${config.plotWidthMm / 1000}m × ${config.plotDepthMm / 1000}m, road ${config.roadWidthMm / 1000}m (${config.roadAccessSides.join(', ')}).`,
  });

  items.push({
    key: 'floors_and_parking',
    category: 'MANDATORY',
    value: `${config.verticalStackType}:${config.numTypicalFloors}`,
    source: 'USER_CONFIG',
    summary: `${config.verticalStackType} with ${config.numTypicalFloors} residential floor(s), parking mode ${config.parkingMode}.`,
  });

  const unitSummary = (config.units ?? [])
    .map(u => `${u.unitIndex}:${u.bhkType}${u.targetCarpetSqFt ? `@${u.targetCarpetSqFt}sqft` : ''}`)
    .join(', ');
  items.push({
    key: 'unit_program',
    category: 'MANDATORY',
    value: `${config.flatsPerFloor} flats (${unitSummary})`,
    source: 'USER_CONFIG',
    summary: `${config.flatsPerFloor} flat(s)/floor (${unitSummary || 'unspecified'}).`,
  });

  if (config.setbacksMm) {
    items.push({
      key: 'setbacks_mm',
      category: 'MANDATORY',
      value: `F:${config.setbacksMm.front},R:${config.setbacksMm.rear},L:${config.setbacksMm.left},Ri:${config.setbacksMm.right}`,
      source: 'USER_CONFIG',
      summary: `Setbacks (mm) Front ${config.setbacksMm.front}, Rear ${config.setbacksMm.rear}, Sides ${config.setbacksMm.left}/${config.setbacksMm.right}.`,
    });
  }

  // Conflict 1: Sized unit schedule vs conflicting mixed-BHK count in prompt
  const parsedMixed = parseMixedUnitProgram(normalizeBriefSpelling(config.aiPrompt));
  const hasSizedSchedule = Boolean(config.units?.some(u => u.targetCarpetSqFt !== undefined));
  if (parsedMixed && parsedMixed.length >= 1 && parsedMixed.length !== config.flatsPerFloor && hasSizedSchedule) {
    conflicts.push({
      code: 'CONFLICTING_UNIT_COUNT',
      resolution: 'BLOCKS_PUBLICATION',
      message: `Prompt specifies ${parsedMixed.length} flats while sized unit schedule has ${config.flatsPerFloor} slots.`,
    });
  }

  // Conflict 2: NO OTS vs explicit courtyard / OTS request in same prompt
  const promptHasNoOts = /\bno\s+ots\b|\bwithout\s+ots\b|\bexclude\s+ots\b/.test(prompt);
  const promptRequestsCourtyard = /\bcentral\s+(?:open[- ]to[- ]sky\s+)?courtyard\b|\bwith\s+ots\s+courtyard\b/.test(prompt);
  if (promptHasNoOts && promptRequestsCourtyard) {
    conflicts.push({
      code: 'CONFLICTING_OTS_DIRECTIVE',
      resolution: 'EXPLICIT_BRIEF_PRECEDENCE',
      message: 'Brief mentions both NO OTS and a central courtyard; negative NO OTS constraint takes precedence.',
    });
  }
  if (promptHasNoOts || proposal.noOts) {
    items.push({
      key: 'no_ots',
      category: promptHasNoOts ? 'MANDATORY' : interpretationSource === 'GEMINI' ? 'AI_SUGGESTION' : 'DEFAULT',
      value: true,
      source: promptHasNoOts ? 'USER_PROMPT' : interpretationSource === 'GEMINI' ? 'AI_PROPOSAL' : 'SYSTEM_DEFAULT',
      summary: 'Exclude internal Open-To-Sky (OTS) shafts; rely on perimeter ventilation.',
    });
  }

  // Conflict 3: Locked massing shape vs different prompt shape
  const promptShape = detectExplicitPromptShape(prompt);
  if (config.buildingMassingShape && promptShape && promptShape !== config.buildingMassingShape) {
    conflicts.push({
      code: 'CONFLICTING_LOCKED_MASSING',
      resolution: 'USER_CONFIG_PRECEDENCE',
      message: `Locked massing ${config.buildingMassingShape} overrides prompt shape ${promptShape}.`,
    });
  }
  items.push({
    key: 'building_massing_shape',
    category: config.buildingMassingShape || promptShape
      ? 'MANDATORY'
      : interpretationSource === 'GEMINI'
        ? 'AI_SUGGESTION'
        : 'DEFAULT',
    value: proposal.buildingMassingShape,
    source: config.buildingMassingShape
      ? 'USER_CONFIG'
      : promptShape
        ? 'USER_PROMPT'
        : interpretationSource === 'GEMINI'
          ? 'AI_PROPOSAL'
          : 'SYSTEM_DEFAULT',
    summary: `Selected building massing: ${proposal.buildingMassingShape}.`,
  });

  // Conflict 4: Balcony negative constraint vs positive balcony request
  const promptNoBalcony = /\bno\s+balcon|\bwithout\s+balcon|\bexclude\s+balcon|\bzero\s+balcon/.test(prompt);
  const promptAllBalconies = /\ball\s+bedroom\s+balcon|\bgenerous\s+corner\s+balcon|\bcantilevered\s+balcon/.test(prompt);
  if (promptNoBalcony && promptAllBalconies) {
    conflicts.push({
      code: 'CONFLICTING_BALCONY_DIRECTIVE',
      resolution: 'EXPLICIT_BRIEF_PRECEDENCE',
      message: 'Brief contains both no-balcony and balcony-provision clauses; explicit no-balcony exclusion takes precedence.',
    });
  }
  items.push({
    key: 'balcony_policy',
    category: promptNoBalcony ? 'MANDATORY' : promptAllBalconies ? 'USER_PREFERENCE' : 'DEFAULT',
    value: proposal.bedroomBalconies,
    source: promptNoBalcony || promptAllBalconies ? 'USER_PROMPT' : 'SYSTEM_DEFAULT',
    summary: `Balcony allocation: ${proposal.bedroomBalconies}.`,
  });

  if (proposal.centerBuildingInEnvelope) {
    const promptCentered = Boolean(config.centerBuildingInEnvelope || /\bcenter(?:ed)?\b/.test(prompt));
    items.push({
      key: 'center_building',
      category: promptCentered ? 'MANDATORY' : 'AI_SUGGESTION',
      value: true,
      source: config.centerBuildingInEnvelope ? 'USER_CONFIG' : promptCentered ? 'USER_PROMPT' : 'AI_PROPOSAL',
      summary: 'Center building footprint inside permissible setback envelope.',
    });
  }

  // Reference image vs explicit core brief conflict
  if (
    proposal.referenceSpatialGraph?.detectedCorePosition &&
    /\b(?:central\s+lift|central\s+core|lifts?|stairs?|staircases?)\b/.test(prompt) &&
    proposal.referenceSpatialGraph.detectedCorePosition !== proposal.corePlacement
  ) {
    conflicts.push({
      code: 'REFERENCE_OVERRIDDEN_BY_BRIEF',
      resolution: 'EXPLICIT_BRIEF_PRECEDENCE',
      message: `Explicit brief core placement (${proposal.corePlacement}) overrides reference image core hint (${proposal.referenceSpatialGraph.detectedCorePosition}).`,
    });
  }

  if (proposal.vastuPreferences.kitchenQuadrant !== 'ANY' || proposal.vastuPreferences.masterBedroomQuadrant !== 'ANY') {
    items.push({
      key: 'vastu_orientation',
      category: /\bvastu|\bsoutheast|\bsouthwest\b/.test(prompt) ? 'USER_PREFERENCE' : 'AI_SUGGESTION',
      value: `Kitchen:${proposal.vastuPreferences.kitchenQuadrant},Master:${proposal.vastuPreferences.masterBedroomQuadrant}`,
      source: /\bvastu|\bsoutheast|\bsouthwest\b/.test(prompt) ? 'USER_PROMPT' : 'AI_PROPOSAL',
      summary: `Vastu zoning preference: Kitchen ${proposal.vastuPreferences.kitchenQuadrant}, Master ${proposal.vastuPreferences.masterBedroomQuadrant}.`,
    });
  }

  items.push({
    key: 'udcpr_jurisdiction_verification',
    category: 'JURISDICTION_VERIFICATION_REQUIRED',
    value: config.jurisdiction,
    source: 'REGULATORY_RULE',
    summary: `Setback, FSI entitlement, road-width height cap, and fire egress require licensed architect verification under ${config.jurisdiction} / Maharashtra UDCPR 2020.`,
  });

  return {
    schemaVersion: 1,
    items,
    conflicts,
  };
}

export interface GenerateArchitecturalProposalOptions {
  readonly config: MultiSheetApartmentConfig;
  readonly seed?: number;
  readonly rejectedTopologyHashes?: readonly string[];
  readonly signal?: AbortSignal;
  readonly bypassCache?: boolean;
}

interface CachedProviderResponse {
  readonly response: AIResponse;
  readonly expiresAt: number;
}

const PROPOSAL_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES_PER_PROVIDER = 64;
const providerResponseCache = new WeakMap<AIProvider, Map<string, CachedProviderResponse>>();
const providerInFlightMap = new WeakMap<AIProvider, Map<string, Promise<AIResponse>>>();

export function clearArchitecturalProposalCache(provider?: AIProvider): void {
  if (provider) {
    providerResponseCache.delete(provider);
    providerInFlightMap.delete(provider);
  }
}

function buildProposalCacheKey(
  provider: AIProvider,
  config: MultiSheetApartmentConfig,
  seed: number,
  rejected: readonly string[],
  imageDigest?: string,
): string {
  const payload = JSON.stringify({
    provider: provider.name,
    model: provider.getModelInfo().model,
    plotW: config.plotWidthMm,
    plotD: config.plotDepthMm,
    roadW: config.roadWidthMm,
    stack: config.verticalStackType,
    floors: config.numTypicalFloors,
    flats: config.flatsPerFloor,
    units: (config.units ?? []).map(u => [u.unitIndex, u.bhkType, u.targetCarpetSqFt ?? null]),
    area: config.targetAreaSqFt ?? null,
    scope: config.areaTargetScope ?? null,
    shape: config.buildingMassingShape ?? null,
    cat: config.planCategory ?? null,
    prompt: normalizeBriefSpelling(config.aiPrompt ?? '').trim(),
    seed,
    rejected: [...rejected].sort(),
    img: imageDigest ?? null,
  });
  return exchangeArtifactDigest(new TextEncoder().encode(payload));
}

export async function generateArchitecturalProposal(
  provider: AIProvider | null | undefined,
  input: GenerateArchitecturalProposalOptions,
): Promise<ArchitecturalProposalResult> {
  const startedAt = Date.now();
  const seed = input.seed ?? input.config.generationSeed ?? 1;
  const rejected = input.rejectedTopologyHashes ?? input.config.rejectedTopologyHashes ?? [];
  const classifiedRef = classifyReferenceAttachment(input.config.referenceImage);
  const imagePart = classifiedRef.imagePart;

  const buildEnriched = (
    proposal: ArchitecturalProposal,
    telemetryBase: Omit<ArchitecturalProposalTelemetry, 'interpretedRequirements' | 'conflictsDetected'>,
    rejectedReferenceGuidance: readonly string[] = [],
  ): ArchitecturalProposalResult => {
    const rg = proposal.referenceSpatialGraph;
    // Seed > 1 explores different archetypes and macro building massing shapes monotonically
    const effectiveArchetype = seed > 1 && rejected.length > 0 && proposal.preferredArchetype === ROOM_SLICING_ARCHETYPES[0]
      ? ROOM_SLICING_ARCHETYPES[(seed - 1) % ROOM_SLICING_ARCHETYPES.length]!
      : rg?.wetCoreClustering === 'SHARED_SHAFT' && !input.config.preferredArchetype && proposal.preferredArchetype === ROOM_SLICING_ARCHETYPES[0]
        ? 'MIRRORED_WET_CORE_STACK'
        : proposal.preferredArchetype;
    const promptExplicitlyRequestsNovelShape =
      /\b(?:cruciform|h[\s-]?shape|u[\s-]?shape|l[\s-]?shape|pinwheel|stepped|courtyard|crescent|curved|arc|rotunda|circular|oval|triskele|triang|hex|octa|pentagon|trapezoid|chevron|z[\s-]?shape|t[\s-]?shape)\b/i.test(
        input.config.aiPrompt ?? '',
      );
    const allowNovelAutoShape = Boolean(
      input.config.buildingMassingShape ||
      input.config.autoExploreNovelShape ||
      seed > 1 ||
      rejected.length > 0 ||
      imagePart ||
      promptExplicitlyRequestsNovelShape,
    );
    const effectiveMassingShape: BuildingMassingShape =
      input.config.buildingMassingShape
      ?? (!allowNovelAutoShape
        ? 'COMPACT_DOUBLE_LOADED'
        : seed > 1 && (rejected.length > 0 || proposal.buildingMassingShape === 'COMPACT_DOUBLE_LOADED')
          ? BUILDING_MASSING_SHAPES[(seed - 1) % BUILDING_MASSING_SHAPES.length]!
          : rg?.detectedCorridorAxis === 'RING' && !proposal.noOts && proposal.buildingMassingShape === 'COMPACT_DOUBLE_LOADED'
            ? 'U_SHAPE_COURTYARD'
            : proposal.buildingMassingShape);

    const finalProposal: ArchitecturalProposal = {
      ...proposal,
      preferredArchetype: effectiveArchetype,
      buildingMassingShape: effectiveMassingShape,
    };

    const basePrompt = (input.config.aiPrompt ?? '').trim();
    const synthesizedClauses: string[] = [];
    if (telemetryBase.interpretationSource === 'GEMINI' || rg) {
      if (
        effectiveMassingShape !== 'PINWHEEL_CLUSTER' &&
        basePrompt.length > 0 &&
        !/\b(?:ots|open[\s-]to[\s-]sky|courtyard|perimeter[\s-]only)\b/i.test(basePrompt)
      ) {
        if (finalProposal.noOts) {
          synthesizedClauses.push('NO OTS.');
        } else if (finalProposal.ventilationStrategy === 'CENTRAL_COURTYARD') {
          synthesizedClauses.push('Central open-to-sky courtyard.');
        }
      }
      if (!/\bkitchen\b/i.test(basePrompt)) {
        if (finalProposal.kitchenStyle === 'OPEN' && finalProposal.kitchenSize === 'LARGER') {
          synthesizedClauses.push('Open kitchen. Larger kitchen.');
        } else if (finalProposal.kitchenStyle === 'OPEN') {
          synthesizedClauses.push('Open kitchen.');
        } else if (finalProposal.kitchenSize === 'LARGER') {
          synthesizedClauses.push('Larger kitchen.');
        }
      }
      if (rg && !/\b(?:lifts?|elevators?|stairs?|staircases?|cores?|vertical\s+circulation)\b/i.test(basePrompt)) {
        if (rg.detectedCorePosition === 'CENTRAL') {
          synthesizedClauses.push('Central lift core.');
        } else if (rg.detectedCorePosition === 'SPLIT') {
          synthesizedClauses.push('Split cores.');
        } else if (rg.detectedCorePosition) {
          synthesizedClauses.push(`${rg.detectedCorePosition.toLowerCase()} core.`);
        }
      }
    }
    const referenceGuidanceApplied = [
      ...(rg && synthesizedClauses.some(clause => /core/i.test(clause)) ? ['CORE_PLACEMENT'] : []),
      ...(rg?.detectedCorridorAxis === 'RING' && !input.config.buildingMassingShape
        && effectiveMassingShape === 'U_SHAPE_COURTYARD' && proposal.buildingMassingShape !== effectiveMassingShape ? ['COURTYARD_CIRCULATION'] : []),
      ...(rg?.wetCoreClustering === 'SHARED_SHAFT' && !input.config.preferredArchetype
        && effectiveArchetype === 'MIRRORED_WET_CORE_STACK' && proposal.preferredArchetype !== effectiveArchetype ? ['WET_CORE_CLUSTERING'] : []),
    ];

    const baselineDeterministic = defaultProposalForConfig(input.config, seed);
    const aiChangedProposal = telemetryBase.interpretationSource === 'GEMINI' && (
      finalProposal.buildingMassingShape !== baselineDeterministic.buildingMassingShape ||
      finalProposal.preferredArchetype !== baselineDeterministic.preferredArchetype ||
      finalProposal.preferredTopologyFamily !== baselineDeterministic.preferredTopologyFamily ||
      finalProposal.kitchenStyle !== baselineDeterministic.kitchenStyle ||
      finalProposal.kitchenSize !== baselineDeterministic.kitchenSize ||
      finalProposal.noOts !== baselineDeterministic.noOts ||
      synthesizedClauses.length > 0 ||
      referenceGuidanceApplied.length > 0
    );

    const interpretedRequirements = interpretStructuredBriefRequirements(
      input.config,
      finalProposal,
      telemetryBase.interpretationSource ?? 'DETERMINISTIC',
    );

    const finalTelemetry: ArchitecturalProposalTelemetry = {
      ...telemetryBase,
      referenceDisposition: classifiedRef.disposition,
      referenceImageUsedForGeometry: referenceGuidanceApplied.length > 0,
      referenceGuidanceApplied,
      ...(rejectedReferenceGuidance.length > 0 ? { referenceGuidanceRejected: rejectedReferenceGuidance } : {}),
      influencedGeometry: aiChangedProposal,
      ...(interpretedRequirements.conflicts.length > 0 ? { conflictsDetected: interpretedRequirements.conflicts } : {}),
      interpretedRequirements,
    };
    const effectiveAiPrompt = [basePrompt, ...synthesizedClauses].filter(Boolean).join(' ').trim();

    const parsedMixed = parseMixedUnitProgram(normalizeBriefSpelling(input.config.aiPrompt));
    const currentUnitTypes = (input.config.units ?? []).map(u => u.bhkType);
    const sizedUnitsMatch = !input.config.units?.some(unit => unit.targetCarpetSqFt !== undefined)
      || parsedMixed?.length === currentUnitTypes.length;
    const shouldOverrideMixedUnits = Boolean(
      sizedUnitsMatch &&
      parsedMixed &&
      parsedMixed.length >= 2 &&
      parsedMixed.length <= 6 &&
      (currentUnitTypes.length !== parsedMixed.length || new Set(currentUnitTypes).size <= 1),
    );
    const resolvedFlatsPerFloor = shouldOverrideMixedUnits
      ? (parsedMixed!.length as 1 | 2 | 3 | 4 | 5 | 6)
      : input.config.flatsPerFloor;
    const resolvedUnits = shouldOverrideMixedUnits
      ? mixedUnitSpecs(parsedMixed!).map((unit, index) => ({
          ...input.config.units?.[index],
          ...unit,
          targetCarpetSqFt: input.config.units?.[index]?.targetCarpetSqFt,
        }))
      : input.config.units;

    const promptMentionsArea = /\b\d{3,5}\s*(?:sq\.?\s*ft|sqft|sft|sq\.?\s*m|sqm|m2|m²)\b/i.test(basePrompt);
    const enrichedConfig: MultiSheetApartmentConfig = {
      ...input.config,
      flatsPerFloor: resolvedFlatsPerFloor,
      ...(resolvedUnits ? { units: resolvedUnits } : {}),
      ...(effectiveAiPrompt ? { aiPrompt: effectiveAiPrompt } : {}),
      generationSeed: seed,
      rejectedTopologyHashes: rejected,
      preferredArchetype: input.config.preferredArchetype ?? finalProposal.preferredArchetype,
      buildingMassingShape: input.config.buildingMassingShape ?? finalProposal.buildingMassingShape,
      lockedMassingShape: input.config.lockedMassingShape ?? input.config.buildingMassingShape,
      centerBuildingInEnvelope: input.config.centerBuildingInEnvelope ?? finalProposal.centerBuildingInEnvelope,
      ...(promptMentionsArea && finalProposal.targetAreaSqFt !== undefined && input.config.targetAreaSqFt === undefined
        ? { targetAreaSqFt: finalProposal.targetAreaSqFt }
        : {}),
      ...(promptMentionsArea && finalProposal.areaTargetScope !== undefined && input.config.areaTargetScope === undefined
        ? { areaTargetScope: finalProposal.areaTargetScope }
        : {}),
      aiProposal: finalProposal as unknown as Record<string, unknown>,
      aiTelemetryOverride: {
        ...finalTelemetry,
      },
    };
    return { proposal: finalProposal, telemetry: finalTelemetry, enrichedConfig };
  };

  let available = false;
  let availabilityError = false;
  try {
    available = Boolean(provider && await provider.isAvailable());
  } catch {
    availabilityError = true;
  }
  if (!provider || !available) {
    const proposal = defaultProposalForConfig(input.config, seed);
    return buildEnriched(proposal, {
      geminiInvoked: false,
      provider: 'deterministic-rule-engine',
      requestedModel: provider ? provider.getModelInfo().model : 'none',
      modelUsed: 'none',
      apiCallCount: 0,
      cacheHit: false,
      latencyMs: Date.now() - startedAt,
      fallbackTriggered: true,
      fallbackReason: provider ? 'Gemini provider is unavailable.' : 'No Gemini provider is configured.',
      interpretationSource: 'DETERMINISTIC',
      ...(availabilityError ? { providerErrorCode: 'AVAILABILITY_CHECK_FAILED' } : {}),
      referenceImageUsedForGeometry: false,
    });
  }

  const requestedModel = provider.getModelInfo().model;
  const unitSummary = (input.config.units ?? [])
    .map(u => `F${u.unitIndex}:${u.bhkType}${u.targetCarpetSqFt ? `@${u.targetCarpetSqFt}sqft` : ''}`)
    .join(',');

  // Compact structured context lines to minimize prompt tokens while preserving full architectural fidelity.
  const boundedPrompt = normalizeBriefSpelling(
    (input.config.aiPrompt ?? 'Compliant residential apartment with daylight, cross-ventilation, and Vastu balance.').slice(0, 4000),
  );
  const userPromptLines = [
    `Plot:${(input.config.plotWidthMm / 1000).toFixed(1)}x${(input.config.plotDepthMm / 1000).toFixed(1)}m Road:${(input.config.roadWidthMm / 1000).toFixed(1)}m(${input.config.roadAccessSides.join(',')})`,
    `Stack:${input.config.verticalStackType} Floors:${input.config.numTypicalFloors} Flats/Floor:${input.config.flatsPerFloor} Mix:${unitSummary || '2BHK'}`,
    `Seed:${seed}${rejected.length > 0 ? ` Excluded:${rejected.slice(0, 8).join(',')}` : ''}`,
    input.config.targetAreaSqFt ? `TargetArea:${input.config.targetAreaSqFt}sqft(${input.config.areaTargetScope ?? 'UNSPECIFIED'})` : '',
    input.config.buildingMassingShape ? `LockedShape:${input.config.buildingMassingShape}` : '',
    `Brief:"${boundedPrompt}"`,
    imagePart
      ? 'Reference image attached: populate referenceSpatialGraph (detectedCorePosition, detectedCorridorAxis, relativeRoomCentroids in [0..1], balconyEdges, wetCoreClustering).'
      : '',
    seed > 1 ? `Variant #${seed}: choose distinct archetype/massing from excluded layouts.` : '',
  ].filter(Boolean).join('\n');

  const cacheKey = buildProposalCacheKey(provider, input.config, seed, rejected, classifiedRef.imageDigest);
  let cacheStore = providerResponseCache.get(provider);
  if (!cacheStore) {
    cacheStore = new Map();
    providerResponseCache.set(provider, cacheStore);
  }
  let inFlightStore = providerInFlightMap.get(provider);
  if (!inFlightStore) {
    inFlightStore = new Map();
    providerInFlightMap.set(provider, inFlightStore);
  }

  try {
    let response: AIResponse;
    let cacheHit = false;
    const cached = !input.bypassCache ? cacheStore.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) {
      response = cached.response;
      cacheHit = true;
    } else {
      let pending = !input.bypassCache ? inFlightStore.get(cacheKey) : undefined;
      if (!pending) {
        const requestPromise = provider.complete({
          taskType: AITaskType.RequirementExtraction,
          systemPrompt:
            'Principal Indian Residential Architect (NBC 2016 / UDCPR). Convert brief, site, and optional reference image into ArchitecturalProposal JSON. ' +
            'Strictly obey mandatory user rules (NO OTS, no balconies, center building, locked shape, core placement). Keep designRationale <= 180 chars.',
          userPrompt: userPromptLines,
          ...(imagePart ? { images: [imagePart] } : {}),
          responseFormat: 'json',
          responseSchema: imagePart ? ARCHITECTURAL_PROPOSAL_SCHEMA : ARCHITECTURAL_PROPOSAL_TEXT_SCHEMA,
          responseSchemaName: 'architectural_proposal',
          temperature: seed > 1 ? 0.35 : 0.1,
          maxTokens: imagePart ? 1100 : 750,
          thinkingBudget: 0,
          signal: input.signal,
        });
        if (!input.bypassCache) {
          inFlightStore.set(cacheKey, requestPromise);
        }
        pending = requestPromise;
      } else {
        cacheHit = true;
      }
      try {
        response = await pending;
      } finally {
        inFlightStore.delete(cacheKey);
      }
      if (!input.bypassCache && response.parsed && Object.keys(response.parsed).length > 0) {
        if (cacheStore.size >= MAX_CACHE_ENTRIES_PER_PROVIDER) {
          const oldestKey = cacheStore.keys().next().value;
          if (oldestKey !== undefined) cacheStore.delete(oldestKey);
        }
        cacheStore.set(cacheKey, { response, expiresAt: Date.now() + PROPOSAL_CACHE_TTL_MS });
      }
    }

    if (!response.parsed || Object.keys(response.parsed).length === 0) {
      throw new Error('Gemini returned no structured architectural proposal.');
    }
    const { proposal, rejectedReferenceGuidance } = sanitizeProposalWithPromptGuardrails(
      response.parsed,
      input.config,
      seed,
      Boolean(imagePart),
    );
    return buildEnriched(
      proposal,
      {
        geminiInvoked: !cacheHit || true,
        provider: 'google-genai',
        requestedModel,
        modelUsed: response.model,
        ...(response.attemptedModels ? { attemptedModels: response.attemptedModels } : {}),
        apiCallCount: cacheHit ? 0 : (response.apiCallCount ?? 1),
        cacheHit,
        tokenUsage: response.usage,
        latencyMs: Date.now() - startedAt,
        fallbackTriggered: response.model !== requestedModel,
        ...(response.fallbackFromErrorCode
          ? {
              providerErrorCode: response.fallbackFromErrorCode,
              fallbackReason: `Primary model ${requestedModel} returned ${response.fallbackFromErrorCode}; completed on fallback ${response.model}.`,
            }
          : {}),
        interpretationSource: 'GEMINI',
        referenceImageUsedForGeometry: false,
      },
      rejectedReferenceGuidance,
    );
  } catch (error) {
    const proposal = defaultProposalForConfig(input.config, seed);
    const providerErrorCode = geminiErrorCode(error);
    return buildEnriched(proposal, {
      geminiInvoked: true,
      provider: 'deterministic-rule-engine',
      requestedModel,
      modelUsed: requestedModel,
      apiCallCount: 1,
      cacheHit: false,
      latencyMs: Date.now() - startedAt,
      fallbackTriggered: true,
      interpretationSource: 'DETERMINISTIC',
      providerErrorCode,
      fallbackReason: `Gemini interpretation failed (${providerErrorCode}).`,
      referenceImageUsedForGeometry: false,
    });
  }
}
