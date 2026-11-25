/**
 * Architectural Requirement Hierarchy, Conflict Diagnostics & Efficiency Breakdown (Phase 5 Gate B).
 *
 * Enforces the strict 7-level requirement precedence order:
 *   1. PHYSICAL_MANDATORY        — Envelope bounds, planar conservation (< 0.001 mm²), ventilation, core access, height-driven fire rules
 *   2. EXPLICIT_USER_CONSTRAINTS — User-stated hard rules (NO OTS, centered building, single lift, stair count when <= 15 m, bedroom balconies, area targets)
 *   3. LOCKED_ENTITIES           — Locked floors, flats, rooms, openings, and protected cores
 *   4. USER_PREFERENCES          — Soft design priorities (daylight, privacy, larger kitchen, orientation)
 *   5. REFERENCE_IMAGE_GUIDANCE  — Reference image topological/stylistic cues (never overrides 1–4)
 *   6. AI_SUGGESTIONS            — Provider-proposed parameters (validated, never overrides 1–5)
 *   7. ENGINE_DEFAULTS           — Conservative architectural heuristics
 *
 * Also computes an honest, exact component-by-component floor efficiency breakdown
 * without inventing an artificial universal efficiency percentage.
 */

import {
  EXACT_SQMM_PER_SQFT,
  EXACT_SQMM_PER_SQM,
  RoomType,
  architecturalSpaceRole,
  type ApartmentBhkType,
  type Floor,
  type GenerationControlState,
  type MultiSheetApartmentConfig,
  type Room,
} from '@ai-floor-planner/core';
import {
  measureApartmentAreaLedger,
  openingFitsApartmentWall,
  polygonArea,
  polygonBoundingBox,
} from '@ai-floor-planner/geometry-engine';
import { computeBuildingStackParameters } from '../apartment/multi-sheet-apartment-solver';
import { interpretArchitecturalIntent, IntentConflictError } from '../topology/architectural-intent';
import { FLAT_AREA_BOUNDS_SQM } from '../topology/topology-families';

export type RequirementHierarchyTierId =
  | 'PHYSICAL_MANDATORY'
  | 'EXPLICIT_USER_CONSTRAINTS'
  | 'LOCKED_ENTITIES'
  | 'USER_PREFERENCES'
  | 'REFERENCE_IMAGE_GUIDANCE'
  | 'AI_SUGGESTIONS'
  | 'ENGINE_DEFAULTS';

export interface RequirementHierarchyTierSpec {
  readonly rank: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly id: RequirementHierarchyTierId;
  readonly label: string;
  readonly description: string;
}

export const ARCHITECTURAL_REQUIREMENT_HIERARCHY: readonly RequirementHierarchyTierSpec[] = [
  {
    rank: 1,
    id: 'PHYSICAL_MANDATORY',
    label: 'Physical, Geometric & Life-Safety Mandatory Rules',
    description: 'Buildable envelope containment, < 0.001 mm² planar conservation, bathroom ventilation, common-core flat access, and > 15 m high-rise dual-stair rules.',
  },
  {
    rank: 2,
    id: 'EXPLICIT_USER_CONSTRAINTS',
    label: 'Explicit User Mandatory Constraints',
    description: 'NO OTS / perimeter-only ventilation, centered building, single lift, stair count (<= 15 m), separate bedroom balconies, explicit unit/carpet targets, and locked massing.',
  },
  {
    rank: 3,
    id: 'LOCKED_ENTITIES',
    label: 'Locked Floors, Flats, Rooms & Cores',
    description: 'Entities protected in GenerationControlState that cannot be moved, shrunk, or deleted.',
  },
  {
    rank: 4,
    id: 'USER_PREFERENCES',
    label: 'User Architectural Preferences',
    description: 'Daylight/privacy/efficiency emphasis, kitchen size/style, living orientation, and corridor minimization.',
  },
  {
    rank: 5,
    id: 'REFERENCE_IMAGE_GUIDANCE',
    label: 'Reference Image Guidance',
    description: 'Uploaded plan/massing cues used only where compatible with tiers 1–4.',
  },
  {
    rank: 6,
    id: 'AI_SUGGESTIONS',
    label: 'Validated AI Suggestions',
    description: 'Structured LLM brief interpretation subordinate to physical rules, explicit user constraints, and locks.',
  },
  {
    rank: 7,
    id: 'ENGINE_DEFAULTS',
    label: 'Engine Defaults',
    description: 'Fallback architectural proportions when higher tiers leave a parameter open.',
  },
] as const;

export interface RequirementConflictAlternative {
  readonly optionId: string;
  readonly summary: string;
  readonly measurableAdjustment: Record<string, number | string>;
}

export interface RequirementConflictDiagnostic {
  readonly code:
    | 'PROMPT_CONTRADICTION'
    | 'ENVELOPE_TOO_SMALL_FOR_PROGRAM'
    | 'CARPET_TARGETS_EXCEED_ENVELOPE'
    | 'HIGH_RISE_STAIR_MINIMUM_OVERRIDE'
    | 'HIGH_RISE_LIFT_MINIMUM_OVERRIDE'
    | 'BEDROOM_BALCONIES_INCOMPATIBLE_WITH_NO_BALCONIES'
    | 'REFERENCE_OR_AI_SUBORDINATED';
  readonly severity: 'BLOCKING' | 'OVERRIDDEN_BY_HIGHER_TIER';
  readonly higherPriorityTier: RequirementHierarchyTierId;
  readonly lowerPriorityTier: RequirementHierarchyTierId;
  readonly explanation: string;
  readonly alternatives: readonly RequirementConflictAlternative[];
}

export interface RequirementHierarchyEvaluation {
  readonly isFeasibleWithoutConflict: boolean;
  readonly hierarchy: readonly RequirementHierarchyTierSpec[];
  readonly buildableEnvelopeMm: { readonly widthMm: number; readonly depthMm: number; readonly areaM2: number; readonly areaSqFt: number };
  readonly minimumRequiredGrossM2: number;
  readonly conflicts: readonly RequirementConflictDiagnostic[];
}

const MIN_HABITABLE_CARPET_SQM_BY_BHK: Record<ApartmentBhkType, number> = {
  '1BHK': 30,
  '2BHK': 48,
  '3BHK': 68,
  '4BHK': 92,
};

export function evaluateBriefRequirementHierarchyAndConflicts(
  config: MultiSheetApartmentConfig,
  control?: GenerationControlState,
): RequirementHierarchyEvaluation {
  const conflicts: RequirementConflictDiagnostic[] = [];
  const setbacks = config.setbacksMm ?? { front: 3000, rear: 2000, left: 2000, right: 2000 };
  const envW = Math.max(0, config.plotWidthMm - setbacks.left - setbacks.right);
  const envD = Math.max(0, config.plotDepthMm - setbacks.front - setbacks.rear);
  const envAreaMm2 = config.irregularPlotBoundary?.buildablePolygon
    ? polygonArea(config.irregularPlotBoundary.buildablePolygon)
    : envW * envD;
  const envAreaM2 = envAreaMm2 / EXACT_SQMM_PER_SQM;
  const envAreaSqFt = envAreaMm2 / EXACT_SQMM_PER_SQFT;

  const unitTypes: ApartmentBhkType[] = Array.from({ length: config.flatsPerFloor }, (_, idx) => {
    return config.units?.[idx]?.bhkType ?? '2BHK';
  });

  const stack = computeBuildingStackParameters(config);
  const coreAllowanceM2 = stack.minStaircases * 11.5 + stack.minLifts * 4.4 + Math.max(8, config.flatsPerFloor * 3.5);
  const minUnitsGrossM2 = unitTypes.reduce((sum, bhk) => {
    const bounds = FLAT_AREA_BOUNDS_SQM[bhk];
    return sum + Math.max((bounds?.min ?? MIN_HABITABLE_CARPET_SQM_BY_BHK[bhk]) * 1.16, MIN_HABITABLE_CARPET_SQM_BY_BHK[bhk] * 1.18);
  }, 0);
  const minimumRequiredGrossM2 = Number((minUnitsGrossM2 + coreAllowanceM2).toFixed(2));

  // 1. Prompt contradiction check
  let parsedProgram: ReturnType<typeof interpretArchitecturalIntent> | undefined;
  try {
    parsedProgram = interpretArchitecturalIntent({
      prompt: config.aiPrompt,
      flatsPerFloor: config.flatsPerFloor,
      unitTypes,
    });
  } catch (err) {
    if (err instanceof IntentConflictError) {
      conflicts.push({
        code: 'PROMPT_CONTRADICTION',
        severity: 'BLOCKING',
        higherPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
        lowerPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
        explanation: err.message,
        alternatives: [
          {
            optionId: 'resolve_contradiction',
            summary: 'State a single non-contradictory placement or ventilation directive in the project brief.',
            measurableAdjustment: { conflictCode: err.code },
          },
        ],
      });
    }
  }

  // 2. Envelope capacity vs requested flat program
  if (envW < 6500 || envD < 6500 || envAreaM2 < minimumRequiredGrossM2) {
    const maxFlats2Bhk = Math.max(1, Math.floor(Math.max(0, envAreaM2 - coreAllowanceM2) / (MIN_HABITABLE_CARPET_SQM_BY_BHK['2BHK'] * 1.18)));
    const scaleNeeded = envAreaM2 > 0 ? Math.sqrt(minimumRequiredGrossM2 / envAreaM2) : 1.5;
    const reqPlotW = Math.ceil((envW * scaleNeeded + setbacks.left + setbacks.right) / 500) * 500;
    const reqPlotD = Math.ceil((envD * scaleNeeded + setbacks.front + setbacks.rear) / 500) * 500;
    conflicts.push({
      code: 'ENVELOPE_TOO_SMALL_FOR_PROGRAM',
      severity: 'BLOCKING',
      higherPriorityTier: 'PHYSICAL_MANDATORY',
      lowerPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
      explanation: `Buildable envelope is ${envAreaM2.toFixed(1)} m² (${envAreaSqFt.toFixed(0)} sq ft, ${(envW / 1000).toFixed(2)} m × ${(envD / 1000).toFixed(2)} m), below the minimum ${minimumRequiredGrossM2.toFixed(1)} m² gross plate required for ${config.flatsPerFloor} flat(s) (${unitTypes.join(', ')}) plus circulation core.`,
      alternatives: [
        {
          optionId: 'reduce_flats_per_floor',
          summary: `Reduce flats per floor from ${config.flatsPerFloor} to ${Math.min(config.flatsPerFloor - 1, maxFlats2Bhk) || 1} on this plot.`,
          measurableAdjustment: { suggestedFlatsPerFloor: Math.max(1, Math.min(config.flatsPerFloor - 1, maxFlats2Bhk)) },
        },
        {
          optionId: 'enlarge_plot_or_reduce_setbacks',
          summary: `Use a plot of at least ${(reqPlotW / 1000).toFixed(1)} m × ${(reqPlotD / 1000).toFixed(1)} m to fit ${config.flatsPerFloor} flats.`,
          measurableAdjustment: { requiredPlotWidthMm: reqPlotW, requiredPlotDepthMm: reqPlotD, minimumGrossM2: minimumRequiredGrossM2 },
        },
      ],
    });
  }

  // 3. Explicit carpet targets exceeding buildable envelope
  const requestedCarpetsSqFt = (config.units ?? []).map(u => u.targetCarpetSqFt ?? 0).filter(v => v > 0);
  if (requestedCarpetsSqFt.length > 0) {
    const sumCarpetM2 = requestedCarpetsSqFt.reduce((s, v) => s + v * (EXACT_SQMM_PER_SQFT / EXACT_SQMM_PER_SQM), 0);
    // Wall footprint + core + common circulation takes at least ~22% of gross floor plate
    const requiredGrossForTargetsM2 = sumCarpetM2 / 0.78 + coreAllowanceM2 * 0.5;
    if (requiredGrossForTargetsM2 > envAreaM2 * 1.02) {
      const maxTotalCarpetSqFt = Math.max(
        300,
        Math.floor(((Math.max(0, envAreaM2 - coreAllowanceM2) * 0.84) * EXACT_SQMM_PER_SQM) / EXACT_SQMM_PER_SQFT),
      );
      const maxPerFlatSqFt = Math.floor(maxTotalCarpetSqFt / Math.max(1, config.flatsPerFloor));
      conflicts.push({
        code: 'CARPET_TARGETS_EXCEED_ENVELOPE',
        severity: 'BLOCKING',
        higherPriorityTier: 'PHYSICAL_MANDATORY',
        lowerPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
        explanation: `Requested unit carpet targets total ${requestedCarpetsSqFt.reduce((a, b) => a + b, 0).toFixed(0)} sq ft (${sumCarpetM2.toFixed(1)} m²), requiring ~${requiredGrossForTargetsM2.toFixed(1)} m² gross plate, which exceeds the ${envAreaM2.toFixed(1)} m² (${envAreaSqFt.toFixed(0)} sq ft) buildable envelope.`,
        alternatives: [
          {
            optionId: 'clamp_carpet_to_envelope',
            summary: `Set per-flat carpet target to <= ${maxPerFlatSqFt} sq ft (total <= ${maxTotalCarpetSqFt} sq ft/floor).`,
            measurableAdjustment: { maxPerFlatCarpetSqFt: maxPerFlatSqFt, maxFloorCarpetSqFt: maxTotalCarpetSqFt },
          },
          {
            optionId: 'add_upper_storeys',
            summary: `Distribute total area across additional storeys with fewer flats per floor.`,
            measurableAdjustment: { suggestedFlatsPerFloor: Math.max(1, Math.floor(config.flatsPerFloor / 2)) },
          },
        ],
      });
    }
  }

  // 4. High-rise > 15 m fire-stair / lift override check
  if (parsedProgram?.mandatory.stairCountRequired && parsedProgram.mandatory.stairCount < stack.minStaircases) {
    conflicts.push({
      code: 'HIGH_RISE_STAIR_MINIMUM_OVERRIDE',
      severity: 'OVERRIDDEN_BY_HIGHER_TIER',
      higherPriorityTier: 'PHYSICAL_MANDATORY',
      lowerPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
      explanation: `Brief requested ${parsedProgram.mandatory.stairCount} staircase, but building height is ${(stack.totalBuildingHeightMm / 1000).toFixed(2)} m (> 15.0 m high-rise threshold), requiring at least ${stack.minStaircases} fire staircases.`,
      alternatives: [
        {
          optionId: 'keep_two_fire_stairs',
          summary: `Retain ${stack.minStaircases} staircases for ${(stack.totalBuildingHeightMm / 1000).toFixed(1)} m building height.`,
          measurableAdjustment: { requiredStaircases: stack.minStaircases },
        },
        {
          optionId: 'reduce_height_under_15m',
          summary: `Reduce storey count so total height <= 15.0 m if a single-stair core is required.`,
          measurableAdjustment: { maxHeightForSingleStairMm: 15000 },
        },
      ],
    });
  }

  if (parsedProgram?.mandatory.singleLiftRequired && stack.minLifts > 1) {
    conflicts.push({
      code: 'HIGH_RISE_LIFT_MINIMUM_OVERRIDE',
      severity: 'OVERRIDDEN_BY_HIGHER_TIER',
      higherPriorityTier: 'PHYSICAL_MANDATORY',
      lowerPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
      explanation: `Brief requested 1 lift, while building height ${(stack.totalBuildingHeightMm / 1000).toFixed(2)} m (> 15.0 m) normally requires ${stack.minLifts} lifts (passenger + stretcher).`,
      alternatives: [
        {
          optionId: 'dual_lift_core',
          summary: `Provide 2 lifts for high-rise vertical service.`,
          measurableAdjustment: { recommendedLifts: stack.minLifts },
        },
      ],
    });
  }

  if (parsedProgram?.mandatory.noBalconies && parsedProgram.preferences.bedroomBalconies !== 'NONE_REQUESTED') {
    conflicts.push({
      code: 'BEDROOM_BALCONIES_INCOMPATIBLE_WITH_NO_BALCONIES',
      severity: 'OVERRIDDEN_BY_HIGHER_TIER',
      higherPriorityTier: 'EXPLICIT_USER_CONSTRAINTS',
      lowerPriorityTier: 'USER_PREFERENCES',
      explanation: 'Explicit "no balconies" constraint overrides bedroom balcony preference.',
      alternatives: [
        {
          optionId: 'honour_no_balconies',
          summary: 'Omit all balconies as explicitly prohibited.',
          measurableAdjustment: { balconiesProvided: 0 },
        },
      ],
    });
  }

  if (
    (config.referenceImage || config.aiProposal) &&
    (control?.lockedFloorIds.length || control?.lockedEntityIds.length || config.lockedMassingShape)
  ) {
    conflicts.push({
      code: 'REFERENCE_OR_AI_SUBORDINATED',
      severity: 'OVERRIDDEN_BY_HIGHER_TIER',
      higherPriorityTier: control?.lockedEntityIds.length || control?.lockedFloorIds.length ? 'LOCKED_ENTITIES' : 'EXPLICIT_USER_CONSTRAINTS',
      lowerPriorityTier: config.referenceImage ? 'REFERENCE_IMAGE_GUIDANCE' : 'AI_SUGGESTIONS',
      explanation: 'Reference-image and AI suggestions were subordinated to active user constraints and entity locks.',
      alternatives: [],
    });
  }

  return {
    isFeasibleWithoutConflict: !conflicts.some(c => c.severity === 'BLOCKING'),
    hierarchy: ARCHITECTURAL_REQUIREMENT_HIERARCHY,
    buildableEnvelopeMm: {
      widthMm: envW,
      depthMm: envD,
      areaM2: Number(envAreaM2.toFixed(2)),
      areaSqFt: Number(envAreaSqFt.toFixed(1)),
    },
    minimumRequiredGrossM2,
    conflicts,
  };
}

// ─── Exact Component-by-Component Architectural Efficiency Breakdown ────────

export interface EfficiencyBucketMetric {
  readonly areaMm2: number;
  readonly areaSqM: number;
  readonly areaSqFt: number;
  readonly shareOfGrossPercent: number;
}

export interface FloorEfficiencyBreakdown {
  readonly floorId: string;
  readonly floorName: string;
  readonly planarDeltaMm2: number;
  readonly isPlanarConserved: boolean;
  readonly grossFloorPlate: EfficiencyBucketMetric;
  readonly modeledHabitableCarpet: EfficiencyBucketMetric;
  readonly wallFootprint: EfficiencyBucketMetric;
  readonly commonCirculation: EfficiencyBucketMetric;
  readonly verticalCore: EfficiencyBucketMetric;
  readonly privateUnitCirculation: EfficiencyBucketMetric;
  readonly balconiesAndOutdoor: EfficiencyBucketMetric;
  readonly serviceSpacesAndShafts: EfficiencyBucketMetric;
  readonly openToSkyVoids: EfficiencyBucketMetric;
  readonly residualUnassigned: EfficiencyBucketMetric;
  readonly notes: readonly string[];
}

function toBucket(areaMm2: number, grossMm2: number): EfficiencyBucketMetric {
  const safeGross = Math.max(1, grossMm2);
  return {
    areaMm2,
    areaSqM: Number((areaMm2 / EXACT_SQMM_PER_SQM).toFixed(3)),
    areaSqFt: Number((areaMm2 / EXACT_SQMM_PER_SQFT).toFixed(2)),
    shareOfGrossPercent: Number(((areaMm2 / safeGross) * 100).toFixed(2)),
  };
}

export function computeFloorEfficiencyBreakdown(floor: Floor): FloorEfficiencyBreakdown {
  const ledger = measureApartmentAreaLedger(floor);
  const gross = ledger.gross;

  let privateCircMm2 = 0;
  let habitableCarpetMm2 = 0;
  let unitStorageServiceMm2 = 0;

  for (const room of floor.rooms) {
    if (!room.unitId) continue;
    const usable = ledger.roomUsable[room.id] ?? 0;
    if (room.spaceUse === 'OUTDOOR' || room.type === RoomType.Balcony || room.type === RoomType.Utility) {
      continue;
    }
    if (room.type === RoomType.Corridor || room.type === RoomType.Foyer) {
      privateCircMm2 += usable;
    } else if (room.type === RoomType.Storage) {
      unitStorageServiceMm2 += usable;
    } else {
      habitableCarpetMm2 += usable;
    }
  }

  const notes: string[] = [
    'Areas are measured directly from canonical wall-clipped room polygons and centreline regions (< 0.001 mm² planar conservation).',
    'No artificial universal efficiency percentage is assumed; efficiency varies naturally with core count, wall thickness, balconies, and plot geometry.',
  ];

  return {
    floorId: floor.id,
    floorName: floor.name,
    planarDeltaMm2: ledger.delta,
    isPlanarConserved: Math.abs(ledger.delta) < 0.001 && ledger.unassigned < 0.001 && ledger.overlap < 0.001,
    grossFloorPlate: toBucket(gross, gross),
    modeledHabitableCarpet: toBucket(habitableCarpetMm2, gross),
    wallFootprint: toBucket(ledger.wall, gross),
    commonCirculation: toBucket(ledger.common, gross),
    verticalCore: toBucket(ledger.core, gross),
    privateUnitCirculation: toBucket(privateCircMm2, gross),
    balconiesAndOutdoor: toBucket(ledger.balcony, gross),
    serviceSpacesAndShafts: toBucket(ledger.service + unitStorageServiceMm2, gross),
    openToSkyVoids: toBucket(ledger.void, gross),
    residualUnassigned: toBucket(ledger.unassigned, gross),
    notes,
  };
}

// ─── Functional Architectural Quality Audit ─────────────────────────────────

export interface FunctionalQualityFinding {
  readonly code:
    | 'ENTRANCE_OPENS_INTO_PRIVATE_OR_WET_ROOM'
    | 'TRAPPED_INACCESSIBLE_ROOM'
    | 'KITCHEN_DISCONNECTED_FROM_PUBLIC_ZONE'
    | 'UNVENTILATED_HABITABLE_OR_WET_ROOM'
    | 'NARROW_INTERNAL_PASSAGE'
    | 'NARROW_COMMON_CORRIDOR'
    | 'EXCESSIVE_PRIVATE_PASSAGE_WASTE';
  readonly severity: 'ERROR' | 'WARNING';
  readonly elementIds: readonly string[];
  readonly description: string;
}

export interface FunctionalQualityReport {
  readonly floorId: string;
  readonly passed: boolean;
  readonly findings: readonly FunctionalQualityFinding[];
}

export function auditFloorFunctionalQuality(floor: Floor): FunctionalQualityReport {
  const findings: FunctionalQualityFinding[] = [];
  if (!floor.apartmentUnits?.length) {
    return { floorId: floor.id, passed: true, findings };
  }

  const roomById = new Map<string, Room>(floor.rooms.map(r => [r.id, r]));
  const adj = new Map<string, Set<string>>(floor.rooms.map(r => [r.id, new Set()]));

  for (const door of floor.doors) {
    const [aId, bId] = door.connectsRooms;
    const host = floor.walls.find(w => w.id === door.wallId);
    if (!aId || !bId || !host || !openingFitsApartmentWall(host, door.position, door.width)) continue;
    adj.get(aId)?.add(bId);
    adj.get(bId)?.add(aId);
  }
  for (const wall of floor.walls) {
    if (wall.boundaryRole === 'OPEN_BOUNDARY' && wall.roomIds.length === 2) {
      const [aId, bId] = wall.roomIds;
      if (aId && bId) {
        adj.get(aId)?.add(bId);
        adj.get(bId)?.add(aId);
      }
    }
  }

  for (const unit of floor.apartmentUnits) {
    const unitRooms = floor.rooms.filter(r => r.unitId === unit.id);
    const unitSet = new Set(unitRooms.map(r => r.id));

    // 1. Entry sequence: must enter into Living, Foyer, or Dining — NEVER Bedroom or Bathroom
    const entryDoors = floor.doors.filter(d => {
      const [aId, bId] = d.connectsRooms;
      const a = aId ? roomById.get(aId) : undefined;
      const b = bId ? roomById.get(bId) : undefined;
      return (
        (a?.unitId === unit.id && b?.spaceUse === 'COMMON') ||
        (b?.unitId === unit.id && a?.spaceUse === 'COMMON')
      );
    });

    const entryRoomIds: string[] = [];
    for (const d of entryDoors) {
      const insideId = d.connectsRooms.find(id => id !== undefined && unitSet.has(id));
      if (!insideId) continue;
      entryRoomIds.push(insideId);
      const inside = roomById.get(insideId)!;
      if (inside.type === RoomType.Bedroom || inside.type === RoomType.Bathroom || inside.type === RoomType.Kitchen) {
        findings.push({
          code: 'ENTRANCE_OPENS_INTO_PRIVATE_OR_WET_ROOM',
          severity: 'ERROR',
          elementIds: [d.id, inside.id],
          description: `Main flat entrance '${d.id}' opens directly into ${inside.type} '${inside.name}' instead of a Living Room or Entrance Foyer.`,
        });
      }
    }

    // 2. Zero trapped rooms via BFS inside the flat
    if (entryRoomIds.length > 0) {
      const visited = new Set<string>(entryRoomIds);
      const queue = [...entryRoomIds];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nxt of adj.get(cur) ?? []) {
          if (unitSet.has(nxt) && !visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }
      for (const rm of unitRooms) {
        if (
          rm.type === RoomType.ServiceShaft ||
          rm.type === RoomType.OTS ||
          rm.spaceUse === 'VOID' ||
          architecturalSpaceRole(rm) === 'OPEN_TO_SKY_VOID' ||
          architecturalSpaceRole(rm) === 'SERVICE_SHAFT'
        ) {
          continue;
        }
        if (!visited.has(rm.id)) {
          findings.push({
            code: 'TRAPPED_INACCESSIBLE_ROOM',
            severity: 'ERROR',
            elementIds: [rm.id],
            description: `Room '${rm.name}' in ${unit.id} has no navigable door/passage path from the flat entrance.`,
          });
        }
      }
    }

    // 3. Kitchen connectivity to Dining/Living/Foyer/Passage
    for (const kitchen of unitRooms.filter(r => r.type === RoomType.Kitchen)) {
      const neighbours = [...(adj.get(kitchen.id) ?? [])].map(id => roomById.get(id)).filter((r): r is Room => Boolean(r));
      const connectsPublic = neighbours.some(
        r =>
          r.type === RoomType.Dining ||
          r.type === RoomType.Living ||
          r.type === RoomType.FamilyLiving ||
          r.type === RoomType.Foyer ||
          r.type === RoomType.Corridor,
      );
      if (!connectsPublic) {
        findings.push({
          code: 'KITCHEN_DISCONNECTED_FROM_PUBLIC_ZONE',
          severity: 'ERROR',
          elementIds: [kitchen.id],
          description: `Kitchen '${kitchen.name}' does not connect directly to Dining, Living, or Entrance Foyer.`,
        });
      }
    }

    // 4. Internal passage clear width & waste ratio
    const unitTotalArea = unitRooms.reduce((s, r) => s + polygonArea(r.boundary), 0);
    let unitPassageArea = 0;
    for (const pass of unitRooms.filter(r => r.type === RoomType.Corridor)) {
      const box = polygonBoundingBox(pass.boundary);
      const minDim = Math.min(box.width, box.height);
      unitPassageArea += polygonArea(pass.boundary);
      if (minDim < 980) {
        findings.push({
          code: 'NARROW_INTERNAL_PASSAGE',
          severity: 'ERROR',
          elementIds: [pass.id],
          description: `Internal passage '${pass.name}' has clear span ${Math.round(minDim)} mm (< 1,000 mm minimum).`,
        });
      }
    }
    if (unitTotalArea > 0 && unitPassageArea / unitTotalArea > 0.18) {
      findings.push({
        code: 'EXCESSIVE_PRIVATE_PASSAGE_WASTE',
        severity: 'WARNING',
        elementIds: [unit.id],
        description: `Internal passages consume ${((unitPassageArea / unitTotalArea) * 100).toFixed(1)}% of ${unit.id} (> 18% threshold).`,
      });
    }
  }

  // 5. Common corridor / lobby clear width (1,200 mm NBC residential corridor minimum)
  for (const corr of floor.rooms.filter(r => !r.unitId && r.spaceUse === 'COMMON' && r.type === RoomType.Corridor)) {
    const box = polygonBoundingBox(corr.boundary);
    const minDim = Math.min(box.width, box.height);
    if (minDim < 1180) {
      findings.push({
        code: 'NARROW_COMMON_CORRIDOR',
        severity: 'ERROR',
        elementIds: [corr.id],
        description: `Common corridor '${corr.name}' has width ${Math.round(minDim)} mm (< 1,200 mm minimum).`,
      });
    }
  }

  // 6. Bathroom ventilation check
  for (const bath of floor.rooms.filter(r => r.unitId && r.type === RoomType.Bathroom)) {
    const hasVent = floor.windows.some(w => w.roomId === bath.id) || floor.walls.some(
      w => w.roomIds.includes(bath.id) && (w.wallUse === 'EXTERNAL' || w.wallUse === 'SHAFT'),
    );
    if (!hasVent) {
      findings.push({
        code: 'UNVENTILATED_HABITABLE_OR_WET_ROOM',
        severity: 'ERROR',
        elementIds: [bath.id],
        description: `Bathroom '${bath.name}' touches neither an exterior facade nor a ventilation shaft.`,
      });
    }
  }

  return {
    floorId: floor.id,
    passed: !findings.some(f => f.severity === 'ERROR'),
    findings,
  };
}
