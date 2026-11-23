import {
  type AIImageInput,
  type AIProvider,
  type BuildingMassingShape,
  type MultiSheetApartmentConfig,
  type PlanCategory,
  AITaskType,
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
  readonly bedroomBalconies: 'ALL_BEDROOMS' | 'MASTER_ONLY' | 'STANDARD';
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

export interface ArchitecturalProposalTelemetry {
  readonly geminiInvoked: boolean;
  readonly provider: string;
  readonly modelUsed: string;
  readonly latencyMs: number;
  readonly fallbackTriggered: boolean;
  readonly fallbackReason?: string;
  readonly providerErrorCode?: string;
  readonly interpretationSource?: 'GEMINI' | 'DETERMINISTIC';
  readonly referenceGuidanceApplied?: readonly string[];
  readonly referenceImageUsedForGeometry: boolean;
}

export interface ArchitecturalProposalResult {
  readonly proposal: ArchitecturalProposal;
  readonly telemetry: ArchitecturalProposalTelemetry;
  readonly enrichedConfig: MultiSheetApartmentConfig;
}

export const ARCHITECTURAL_PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
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
      enum: ['ALL_BEDROOMS', 'MASTER_ONLY', 'STANDARD'],
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
  required: [
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
  ],
};

function parseReferenceImageDataUrl(
  referenceImage?: MultiSheetApartmentConfig['referenceImage'],
): AIImageInput | null {
  if (!referenceImage?.dataUrl) return null;
  const trimmed = referenceImage.dataUrl.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (match && match[1] && match[2]) {
    const mimeType = match[1].trim().toLowerCase();
    if (!GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return null;
    return { mimeType, data: match[2].replace(/\s+/g, '') };
  }
  const fallbackMime = (referenceImage.mimeType || '').trim().toLowerCase();
  if (GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(fallbackMime) && !trimmed.startsWith('data:')) {
    return { mimeType: fallbackMime, data: trimmed.replace(/\s+/g, '') };
  }
  return null;
}

function defaultProposalForConfig(
  config: MultiSheetApartmentConfig,
  seed: number,
): ArchitecturalProposal {
  const prompt = normalizeBriefSpelling(config.aiPrompt).toLowerCase();
  const explicitlyNoOts = /\bno\s+ots\b|\bwithout\s+ots\b|\bexclude\s+ots\b|\bperimeter\s+only\b/.test(prompt);
  const explicitlyOts = !explicitlyNoOts && /\bopen[- ]to[- ]sky\b|\bots\b|\bcourtyard\b/.test(prompt);
  const properSpaceUtilization = /\bproper\s+space\s+utiliz|\bspace\s+utilization\b|\befficient\s+space\b|\bno\s+(?:empty|wasted|giant)\s+(?:void|gap|strip)/.test(prompt);
  const ventilatedOtsShafts = !explicitlyNoOts && /\bventilated\s+(?:central\s+)?ots\s+shafts?\b|\bots\s+shafts?\b|\bcentral\s+ots\b/.test(prompt);
  const requestsDifferentShape = /\bdifferent\s+(?:building\s+)?(?:shape|shapes|massing|footprint)|\bunique\s+shape|\bnon[- ]?rectang|\bvaried\s+massing\b/.test(prompt);
  const explicitShape: BuildingMassingShape | undefined =
    /\bcurved\s+crescent|\bcrescent|\bc[- ]?arc\b/.test(prompt) ? 'CURVED_CRESCENT'
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
    bedroomBalconies: /\ball\s+bedroom|\bprivate\s+bedroom\s+balcon|\beach\s+having\s+(?:one\s+)?bedroom\s+with\s+a\s+private\s+balcony/.test(prompt)
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
): ArchitecturalProposal {
  const base = defaultProposalForConfig(config, seed);
  if (!raw) return base;
  const prompt = normalizeBriefSpelling(config.aiPrompt).toLowerCase();
  const explicitlyNoOts = /\bno\s+ots\b|\bwithout\s+ots\b|\bexclude\s+ots\b/.test(prompt);
  const explicitlyCentral = /\bcentral\s+lift|\bcentral\s+core/.test(prompt);

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
  if (hasReferenceImage && typeof raw.referenceSpatialGraph === 'object' && raw.referenceSpatialGraph !== null) {
    const rg = raw.referenceSpatialGraph as Record<string, unknown>;
    const centroids = Array.isArray(rg.relativeRoomCentroids)
      ? rg.relativeRoomCentroids
        .filter((item): item is { roomType: string; nx: number; ny: number } => {
          if (!item || typeof item !== 'object') return false;
          const point = item as Record<string, unknown>;
          return typeof point.roomType === 'string' && typeof point.nx === 'number' && typeof point.ny === 'number'
            && Number.isFinite(point.nx) && Number.isFinite(point.ny);
        })
        .map(item => ({
          roomType: item.roomType,
          nx: Math.max(0, Math.min(1, item.nx)),
          ny: Math.max(0, Math.min(1, item.ny)),
        }))
      : [];
    const balconyEdges = Array.isArray(rg.balconyEdges)
      ? rg.balconyEdges.filter((e): e is 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' => ['NORTH', 'SOUTH', 'EAST', 'WEST'].includes(String(e)))
      : [];
    referenceSpatialGraph = {
      detectedCorePosition: ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'SPLIT'].includes(String(rg.detectedCorePosition))
        ? (String(rg.detectedCorePosition) as ReferenceSpatialGraph['detectedCorePosition'])
        : undefined,
      detectedCorridorAxis: ['HORIZONTAL', 'VERTICAL', 'RING'].includes(String(rg.detectedCorridorAxis))
        ? (String(rg.detectedCorridorAxis) as ReferenceSpatialGraph['detectedCorridorAxis'])
        : undefined,
      relativeRoomCentroids: centroids,
      balconyEdges,
      wetCoreClustering: ['SHARED_SHAFT', 'PERIMETER', 'MIXED'].includes(String(rg.wetCoreClustering))
        ? (String(rg.wetCoreClustering) as ReferenceSpatialGraph['wetCoreClustering'])
        : undefined,
    };
  }

  return {
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
    bedroomBalconies: typeof raw.bedroomBalconies === 'string' && ['ALL_BEDROOMS', 'MASTER_ONLY', 'STANDARD'].includes(raw.bedroomBalconies)
      ? (raw.bedroomBalconies as ArchitecturalProposal['bedroomBalconies'])
      : base.bedroomBalconies,
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
      ? raw.designRationale.trim()
      : base.designRationale,
    ...(referenceSpatialGraph ? { referenceSpatialGraph } : {}),
  };
}

export interface GenerateArchitecturalProposalOptions {
  readonly config: MultiSheetApartmentConfig;
  readonly seed?: number;
  readonly rejectedTopologyHashes?: readonly string[];
}

export async function generateArchitecturalProposal(
  provider: AIProvider | null | undefined,
  input: GenerateArchitecturalProposalOptions,
): Promise<ArchitecturalProposalResult> {
  const startedAt = Date.now();
  const seed = input.seed ?? input.config.generationSeed ?? 1;
  const rejected = input.rejectedTopologyHashes ?? input.config.rejectedTopologyHashes ?? [];
  const imagePart = parseReferenceImageDataUrl(input.config.referenceImage);

  const buildEnriched = (
    proposal: ArchitecturalProposal,
    telemetry: ArchitecturalProposalTelemetry,
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
    if (telemetry.interpretationSource === 'GEMINI' || rg) {
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
    const finalTelemetry: ArchitecturalProposalTelemetry = { ...telemetry,
      referenceImageUsedForGeometry: referenceGuidanceApplied.length > 0, referenceGuidanceApplied };
    const effectiveAiPrompt = [basePrompt, ...synthesizedClauses].filter(Boolean).join(' ').trim();

    const parsedMixed = parseMixedUnitProgram(normalizeBriefSpelling(input.config.aiPrompt));
    const currentUnitTypes = (input.config.units ?? []).map(u => u.bhkType);
    const shouldOverrideMixedUnits = Boolean(
      parsedMixed &&
      parsedMixed.length >= 2 &&
      parsedMixed.length <= 6 &&
      (currentUnitTypes.length !== parsedMixed.length || new Set(currentUnitTypes).size <= 1),
    );
    const resolvedFlatsPerFloor = shouldOverrideMixedUnits
      ? (parsedMixed!.length as 1 | 2 | 3 | 4 | 5 | 6)
      : input.config.flatsPerFloor;
    const resolvedUnits = shouldOverrideMixedUnits ? mixedUnitSpecs(parsedMixed!) : input.config.units;

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
      modelUsed: 'none',
      latencyMs: Date.now() - startedAt,
      fallbackTriggered: true,
      fallbackReason: provider ? 'Gemini provider is unavailable.' : 'No Gemini provider is configured.',
      interpretationSource: 'DETERMINISTIC',
      ...(availabilityError ? { providerErrorCode: 'AVAILABILITY_CHECK_FAILED' } : {}),
      referenceImageUsedForGeometry: false,
    });
  }

  const unitSummary = (input.config.units ?? [])
    .map(u => `Flat ${u.unitIndex}: ${u.bhkType}${u.targetCarpetSqFt ? ` (${u.targetCarpetSqFt} sq.ft.)` : ''}`)
    .join(', ');

  const userPromptLines = [
    `Site Plot: ${(input.config.plotWidthMm / 1000).toFixed(1)}m x ${(input.config.plotDepthMm / 1000).toFixed(1)}m, Road Width: ${(input.config.roadWidthMm / 1000).toFixed(1)}m.`,
    `Building Stack: ${input.config.verticalStackType}, Typical Residential Floors: ${input.config.numTypicalFloors}, Flats/Floor: ${input.config.flatsPerFloor}.`,
    `Unit Mix: ${unitSummary || 'Default 2BHK'}.`,
    `Generation Seed: ${seed}. Rejected Prior Topology Hashes: ${rejected.length > 0 ? rejected.join(', ') : 'None (first generation)'}.`,
    input.config.targetAreaSqFt ? `Requested Target Area: ${input.config.targetAreaSqFt} sq. ft. (Scope: ${input.config.areaTargetScope ?? 'UNSPECIFIED'}).` : '',
    `User Architectural Brief: "${normalizeBriefSpelling(input.config.aiPrompt ?? 'Modern compliant residential apartment tower with daylight, natural ventilation, and Vastu balance.')}"`,
    input.config.buildingMassingShape
      ? `Locked buildingMassingShape requested by user: ${input.config.buildingMassingShape} (preserve this exact massing shape).`
      : `Available buildingMassingShape options: ${BUILDING_MASSING_SHAPES.join(', ')}. Prefer non-rectangular articulated massing (H_SHAPE_WING, U_SHAPE_COURTYARD, L_SHAPE_CORNER, CRUCIFORM_PLUS, PINWHEEL_CLUSTER, STEPPED_OFFSET_BLOCK) when distinct or varied building geometry is requested, and keep maxOtsRatio <= 0.12 unless a large central courtyard is explicitly mandated.`,
    imagePart
      ? 'A reference sketch or plan image is attached. Extract referenceSpatialGraph (detectedCorePosition, detectedCorridorAxis, relativeRoomCentroids in [0..1], balconyEdges, wetCoreClustering) to guide spatial zoning.'
      : '',
    seed > 1
      ? `IMPORTANT REGENERATION DIRECTIVE: This is variant #${seed}. Propose a genuinely different buildingMassingShape, preferredArchetype, and spatial organization than prior rejected hashes.`
      : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await provider.complete({
      taskType: AITaskType.RequirementExtraction,
      systemPrompt:
        'You are a Principal Indian Residential Architect (NBC 2016 / UDCPR / RERA specialist). ' +
        'Translate the user brief, site envelope, and optional reference plan image into a structured ArchitecturalProposal JSON object. ' +
        'Strictly honor hard directives such as NO OTS, CENTER BUILDING, core placement, and Vastu rules.',
      userPrompt: userPromptLines,
      ...(imagePart ? { images: [imagePart] } : {}),
      responseFormat: 'json',
      responseSchema: ARCHITECTURAL_PROPOSAL_SCHEMA,
      responseSchemaName: 'architectural_proposal',
      temperature: seed > 1 ? 0.45 : 0.15,
      maxTokens: 4096,
    });

    if (!response.parsed || Object.keys(response.parsed).length === 0) {
      throw new Error('Gemini returned no structured architectural proposal.');
    }
    const proposal = sanitizeProposalWithPromptGuardrails(response.parsed, input.config, seed, Boolean(imagePart));
    return buildEnriched(proposal, {
      geminiInvoked: true,
      provider: 'google-genai',
      modelUsed: response.model,
      latencyMs: Date.now() - startedAt,
      fallbackTriggered: response.model !== provider.getModelInfo().model,
      ...(response.fallbackFromErrorCode ? { providerErrorCode: response.fallbackFromErrorCode } : {}),
      interpretationSource: 'GEMINI',
      referenceImageUsedForGeometry: false,
    });
  } catch (error) {
    const proposal = defaultProposalForConfig(input.config, seed);
    const providerErrorCode = geminiErrorCode(error);
    return buildEnriched(proposal, {
      geminiInvoked: true,
      provider: 'deterministic-rule-engine',
      modelUsed: provider.getModelInfo().model,
      latencyMs: Date.now() - startedAt,
      fallbackTriggered: true,
      interpretationSource: 'DETERMINISTIC',
      providerErrorCode,
      fallbackReason: `Gemini interpretation failed (${providerErrorCode}).`,
      referenceImageUsedForGeometry: false,
    });
  }
}
