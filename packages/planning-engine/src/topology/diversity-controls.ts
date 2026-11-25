/**
 * Canonical Design Alternative Diversity Comparator & Exploration Controls (Phase 5 Gate C).
 *
 * Evaluates two canonical `Building` alternatives across ALL six required dimensions:
 *   1. Room adjacency graph distance
 *   2. Door / circulation connectivity graph distance
 *   3. Apartment unit boundary topology distance
 *   4. Stair / lift vertical core arrangement shift
 *   5. Physical geometry fingerprint (`physicalLayoutHash`)
 *   6. Macro building massing shape (`buildingMassingShape`)
 *
 * Also translates user-facing exploration controls (`Preserve selected rooms`,
 * `Preserve core`, `Preserve exterior footprint`, `Change internal layout`,
 * `Explore alternative massing`, `Optimize carpet area`, `Improve circulation`,
 * `Improve daylight`) into deterministic planning configurations and verifies
 * that generated alternatives obey preserved elements.
 */

import {
  RoomType,
  architecturalSpaceRole,
  stableValueHash,
  type Building,
  type BuildingMassingShape,
  type Floor,
  type MultiSheetApartmentConfig,
  type Room,
} from '@ai-floor-planner/core';
import { polygonBoundingBox, sharedEdge } from '@ai-floor-planner/geometry-engine';
import { ALL_NAMED_SHAPE_IDS } from '../catalog/shape-catalog';
import { ROOM_SLICING_ARCHETYPES, type RoomSlicingArchetypeId } from '../interpretation/space-filling-snapper';
import { physicalLayoutHash } from './physical-layout-fingerprint';

export interface AlternativeExplorationControls {
  readonly preserveSelectedRooms?: readonly string[];
  readonly preserveCore?: boolean;
  readonly preserveExteriorFootprint?: boolean;
  readonly changeInternalLayout?: boolean;
  readonly exploreAlternativeMassing?: boolean;
  readonly optimizeCarpetArea?: boolean;
  readonly improveCirculation?: boolean;
  readonly improveDaylight?: boolean;
}

export interface CanonicalAlternativeComparison {
  readonly roomAdjacencyDistance: number;
  readonly doorCirculationDistance: number;
  readonly apartmentBoundaryDistance: number;
  readonly coreArrangementShift: number;
  readonly physicalGeometryIdentical: boolean;
  readonly massingShapeChanged: boolean;
  readonly meaningful: boolean;
  readonly differences: readonly string[];
  readonly explanation: string;
}

function representativeResidentialFloor(building: Building): Floor | undefined {
  return building.floors.find(f => (f.apartmentUnits?.length ?? 0) > 0) ?? building.floors[0];
}

function normalizedSpaceKind(room: Room): string {
  if (architecturalSpaceRole(room) === 'OPEN_TO_SKY_VOID') return 'OTS';
  switch (room.type) {
    case RoomType.Living: return 'LIVING';
    case RoomType.Dining: return 'DINING';
    case RoomType.Kitchen: return 'KITCHEN';
    case RoomType.Bedroom: return room.name.toLowerCase().includes('master') ? 'MASTER_BED' : 'BED';
    case RoomType.Bathroom: return 'BATH';
    case RoomType.Balcony: return 'BALCONY';
    case RoomType.Utility: return 'UTILITY';
    case RoomType.Corridor: return room.unitId ? 'UNIT_PASSAGE' : 'COMMON_CORRIDOR';
    case RoomType.Foyer: return room.unitId ? 'UNIT_FOYER' : 'LOBBY';
    case RoomType.Staircase: return 'STAIR';
    case RoomType.Lift: return 'LIFT';
    case RoomType.Storage: return 'STORE';
    case RoomType.Study: return 'STUDY';
    case RoomType.Pooja: return 'POOJA';
    default: return String(room.type).toUpperCase();
  }
}

function multisetJaccardDistance(listA: readonly string[], listB: readonly string[]): number {
  if (listA.length === 0 && listB.length === 0) return 0;
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const item of listA) countA.set(item, (countA.get(item) ?? 0) + 1);
  for (const item of listB) countB.set(item, (countB.get(item) ?? 0) + 1);
  const allKeys = new Set([...countA.keys(), ...countB.keys()]);
  let intersection = 0;
  let union = 0;
  for (const k of allKeys) {
    const a = countA.get(k) ?? 0;
    const b = countB.get(k) ?? 0;
    intersection += Math.min(a, b);
    union += Math.max(a, b);
  }
  return union === 0 ? 0 : Number((1 - intersection / union).toFixed(4));
}

function extractRoomAdjacencyPairs(floor: Floor): string[] {
  const roomById = new Map(floor.rooms.map(r => [r.id, r]));
  const pairs: string[] = [];
  for (const wall of floor.walls) {
    if (wall.roomIds.length === 2) {
      const len = Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y);
      if (len < 500) continue;
      const ra = roomById.get(wall.roomIds[0]!);
      const rb = roomById.get(wall.roomIds[1]!);
      if (ra && rb) {
        pairs.push([normalizedSpaceKind(ra), normalizedSpaceKind(rb)].sort().join('--'));
      }
    }
  }
  if (pairs.length === 0) {
    for (let i = 0; i < floor.rooms.length; i++) {
      for (let j = i + 1; j < floor.rooms.length; j++) {
        if (sharedEdge(floor.rooms[i]!.boundary, floor.rooms[j]!.boundary, 15)) {
          pairs.push([normalizedSpaceKind(floor.rooms[i]!), normalizedSpaceKind(floor.rooms[j]!)].sort().join('--'));
        }
      }
    }
  }
  return pairs;
}

function extractDoorCirculationPairs(floor: Floor): string[] {
  const roomById = new Map(floor.rooms.map(r => [r.id, r]));
  const pairs: string[] = [];
  for (const door of floor.doors) {
    const [aId, bId] = door.connectsRooms;
    const ra = aId ? roomById.get(aId) : undefined;
    const rb = bId ? roomById.get(bId) : undefined;
    if (ra && rb) {
      const edgeTag = door.type === 'open_passage' ? 'OPEN' : door.type === 'sliding' ? 'SLIDE' : 'DOOR';
      pairs.push(`${[normalizedSpaceKind(ra), normalizedSpaceKind(rb)].sort().join('<>')}:${edgeTag}`);
    }
  }
  return pairs;
}

function ninthCell(cx: number, cy: number, box: { x: number; y: number; width: number; height: number }): number {
  const col = Math.min(2, Math.max(0, Math.floor(((cx - box.x) / Math.max(1, box.width)) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(((cy - box.y) / Math.max(1, box.height)) * 3)));
  return row * 3 + col;
}

function extractApartmentBoundaryTokens(floor: Floor): string[] {
  const env = polygonBoundingBox(floor.boundary);
  return (floor.apartmentUnits ?? []).map(u => {
    const b = polygonBoundingBox(u.boundary);
    const cell = ninthCell(b.x + b.width / 2, b.y + b.height / 2, env);
    const aspectBucket = Math.round((b.width / Math.max(1, b.height)) * 4) / 4;
    const vertCount = u.boundary.points.length;
    return `${u.unitType ?? 'UNIT'}@c${cell}:a${aspectBucket}:v${vertCount}`;
  });
}

function extractCoreTokens(floor: Floor): string[] {
  const env = polygonBoundingBox(floor.boundary);
  const coreRooms = floor.rooms.filter(
    r => r.type === RoomType.Staircase || r.type === RoomType.Lift || (!r.unitId && r.spaceUse === 'COMMON'),
  );
  return coreRooms.map(r => {
    const b = polygonBoundingBox(r.boundary);
    const cell = ninthCell(b.x + b.width / 2, b.y + b.height / 2, env);
    const orient = b.width > b.height * 1.35 ? 'H' : b.height > b.width * 1.35 ? 'V' : 'SQ';
    return `${normalizedSpaceKind(r)}@c${cell}:${orient}`;
  });
}

/**
 * Compares two canonical `Building` models to verify genuine architectural diversity.
 * Near-duplicates with only minor millimetre shifts are flagged `meaningful: false`.
 */
export function compareCanonicalBuildingAlternatives(
  a: Building,
  b: Building,
): CanonicalAlternativeComparison {
  const floorA = representativeResidentialFloor(a);
  const floorB = representativeResidentialFloor(b);
  const physA = physicalLayoutHash(a);
  const physB = physicalLayoutHash(b);
  const physicalGeometryIdentical = physA === physB;

  if (!floorA || !floorB) {
    return {
      roomAdjacencyDistance: 0,
      doorCirculationDistance: 0,
      apartmentBoundaryDistance: 0,
      coreArrangementShift: 0,
      physicalGeometryIdentical,
      massingShapeChanged: false,
      meaningful: false,
      differences: [],
      explanation: 'Missing residential floor geometry for diversity comparison.',
    };
  }

  const roomAdjacencyDistance = multisetJaccardDistance(
    extractRoomAdjacencyPairs(floorA),
    extractRoomAdjacencyPairs(floorB),
  );
  const doorCirculationDistance = multisetJaccardDistance(
    extractDoorCirculationPairs(floorA),
    extractDoorCirculationPairs(floorB),
  );
  const apartmentBoundaryDistance = multisetJaccardDistance(
    extractApartmentBoundaryTokens(floorA),
    extractApartmentBoundaryTokens(floorB),
  );
  const coreArrangementShift = multisetJaccardDistance(
    extractCoreTokens(floorA),
    extractCoreTokens(floorB),
  );

  const shapeA = a.metadata.generationBrief?.buildingMassingShape ?? a.metadata.generationReport?.selectedShapeId ?? 'COMPACT_DOUBLE_LOADED';
  const shapeB = b.metadata.generationBrief?.buildingMassingShape ?? b.metadata.generationReport?.selectedShapeId ?? 'COMPACT_DOUBLE_LOADED';
  const massingShapeChanged = shapeA !== shapeB;

  const differences: string[] = [];
  if (massingShapeChanged) {
    differences.push(`massing shape changed (${shapeA} -> ${shapeB})`);
  }
  if (coreArrangementShift >= 0.25) {
    differences.push(`core/corridor arrangement shifted by ${(coreArrangementShift * 100).toFixed(0)}%`);
  }
  if (apartmentBoundaryDistance >= 0.25) {
    differences.push(`apartment boundary topology changed by ${(apartmentBoundaryDistance * 100).toFixed(0)}%`);
  }
  if (roomAdjacencyDistance >= 0.14) {
    differences.push(`room adjacency graph differs by ${(roomAdjacencyDistance * 100).toFixed(0)}%`);
  }
  if (doorCirculationDistance >= 0.14) {
    differences.push(`door/circulation graph differs by ${(doorCirculationDistance * 100).toFixed(0)}%`);
  }

  const meaningful = !physicalGeometryIdentical && differences.length > 0;
  const explanation = physicalGeometryIdentical
    ? 'Identical physical geometry fingerprint; rejected as duplicate.'
    : meaningful
      ? `Distinct architectural alternative: ${differences.join('; ')}.`
      : 'Rejected near-duplicate: room adjacency graph, door circulation graph, core placement, apartment boundaries, and massing are materially unchanged (dimension-only tweak).';

  return {
    roomAdjacencyDistance,
    doorCirculationDistance,
    apartmentBoundaryDistance,
    coreArrangementShift,
    physicalGeometryIdentical,
    massingShapeChanged,
    meaningful,
    differences,
    explanation,
  };
}

/**
 * Translates user alternative-exploration controls into deterministic `MultiSheetApartmentConfig` overrides.
 */
export function resolveExplorationConfigFromControls(
  baseConfig: MultiSheetApartmentConfig,
  activeBuilding: Building,
  controls: AlternativeExplorationControls,
  attemptSeed: number,
  priorBuildings: readonly Building[] = [],
): MultiSheetApartmentConfig {
  const currentShape: BuildingMassingShape =
    (activeBuilding.metadata.generationBrief?.buildingMassingShape as BuildingMassingShape | undefined) ??
    baseConfig.buildingMassingShape ??
    'COMPACT_DOUBLE_LOADED';
  const currentArchetype =
    (activeBuilding.metadata.generationBrief?.archetype as RoomSlicingArchetypeId | undefined) ??
    'CENTRAL_LIVING_SPLIT_BEDROOMS';

  const usedShapes = new Set<string>(
    priorBuildings
      .map(b => b.metadata.generationBrief?.buildingMassingShape)
      .filter((s): s is BuildingMassingShape => Boolean(s)),
  );
  usedShapes.add(currentShape);

  const usedArchetypes = new Set<RoomSlicingArchetypeId>(
    priorBuildings
      .map(b => b.metadata.generationBrief?.archetype as RoomSlicingArchetypeId | undefined)
      .filter((a): a is RoomSlicingArchetypeId => Boolean(a)),
  );
  usedArchetypes.add(currentArchetype);

  const rejectedTopologyHashes = [
    ...(baseConfig.rejectedTopologyHashes ?? []),
    ...priorBuildings.flatMap(b => [
      b.metadata.generationBrief?.topologyHash,
      b.metadata.generationBrief?.physicalLayoutHash,
    ]),
    activeBuilding.metadata.generationBrief?.topologyHash,
    activeBuilding.metadata.generationBrief?.physicalLayoutHash,
  ].filter((h): h is string => Boolean(h));

  // Pick next distinct archetype when internal layout exploration is requested or footprint is preserved
  const nextArchetype: RoomSlicingArchetypeId =
    ROOM_SLICING_ARCHETYPES.find(a => !usedArchetypes.has(a)) ??
    ROOM_SLICING_ARCHETYPES[attemptSeed % ROOM_SLICING_ARCHETYPES.length]!;

  // Pick next massing shape when alternative massing is requested and footprint is not locked
  let nextShape: BuildingMassingShape = currentShape;
  if (controls.exploreAlternativeMassing && !controls.preserveExteriorFootprint) {
    const candidateShapes = ALL_NAMED_SHAPE_IDS.filter(
      s => s !== 'IRREGULAR_ANGLED_PLOT' && s !== 'IMPORTED_CAD_LAYOUT' && !usedShapes.has(s),
    );
    nextShape = (candidateShapes[attemptSeed % Math.max(1, candidateShapes.length)] ?? 'H_SHAPE_WING') as BuildingMassingShape;
  }

  // Append optimization clauses to prompt without violating higher-tier constraints
  const promptDirectives: string[] = [];
  if (baseConfig.aiPrompt?.trim()) promptDirectives.push(baseConfig.aiPrompt.trim());
  if (controls.optimizeCarpetArea) {
    promptDirectives.push('Prioritize compact efficiency and proper space utilization with minimal corridor waste.');
  }
  if (controls.improveCirculation) {
    promptDirectives.push('Prioritize privacy and clean circulation with bedrooms separated from shared lobby.');
  }
  if (controls.improveDaylight) {
    promptDirectives.push('Prioritize natural daylight and cross-ventilation exposure across habitable rooms.');
  }
  if (controls.preserveCore) {
    const rep = representativeResidentialFloor(activeBuilding);
    if (rep) {
      const env = polygonBoundingBox(rep.boundary);
      const stairs = rep.rooms.filter(r => r.type === RoomType.Staircase);
      if (stairs.length > 0) {
        const avgX = stairs.reduce((s, r) => s + r.x + r.width / 2, 0) / stairs.length;
        const fx = (avgX - env.x) / Math.max(1, env.width);
        if (fx > 0.32 && fx < 0.68) promptDirectives.push('Place the vertical circulation core in the central spine.');
        else if (fx <= 0.32) promptDirectives.push('Place the vertical circulation core on the west side.');
        else promptDirectives.push('Place the vertical circulation core on the east side.');
      }
    }
  }

  return {
    ...baseConfig,
    generationSeed: attemptSeed,
    aiPrompt: promptDirectives.join(' '),
    buildingMassingShape: controls.preserveExteriorFootprint ? currentShape : nextShape,
    ...(controls.preserveExteriorFootprint ? { lockedMassingShape: currentShape, autoExploreNovelShape: false } : {}),
    ...(controls.changeInternalLayout || controls.preserveExteriorFootprint || controls.preserveCore
      ? { preferredArchetype: nextArchetype }
      : {}),
    rejectedTopologyHashes: [...new Set(rejectedTopologyHashes)],
  };
}

/**
 * Verifies whether a generated alternative honoured `preserveExteriorFootprint` and `preserveSelectedRooms`.
 */
export function verifyAlternativeRespectsControls(
  before: Building,
  candidate: Building,
  controls: AlternativeExplorationControls,
): { readonly ok: boolean; readonly violations: readonly string[] } {
  const violations: string[] = [];
  const fBefore = representativeResidentialFloor(before);
  const fAfter = representativeResidentialFloor(candidate);
  if (!fBefore || !fAfter) return { ok: false, violations: ['Missing residential floor in candidate.'] };

  if (controls.preserveExteriorFootprint) {
    const shapeBefore = before.metadata.generationBrief?.buildingMassingShape ?? 'COMPACT_DOUBLE_LOADED';
    const shapeAfter = candidate.metadata.generationBrief?.buildingMassingShape ?? 'COMPACT_DOUBLE_LOADED';
    if (shapeBefore !== shapeAfter) {
      violations.push(`Exterior massing shape changed from ${shapeBefore} to ${shapeAfter} while footprint preservation was active.`);
    }
  }

  if (controls.preserveSelectedRooms?.length) {
    for (const roomId of controls.preserveSelectedRooms) {
      const rBefore = fBefore.rooms.find(r => r.id === roomId);
      const rAfter = fAfter.rooms.find(r => r.id === roomId);
      if (rBefore && (!rAfter || stableValueHash(rBefore.boundary) !== stableValueHash(rAfter.boundary))) {
        violations.push(`Preserved room '${rBefore.name}' (${roomId}) changed boundary during whole-floor alternative generation; use Protected Localized Regeneration to keep specific rooms/flats exact.`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

export function buildAlternativeExhaustionExplanation(
  producedCount: number,
  requestedCount: number,
  controls: AlternativeExplorationControls,
): string {
  const activeConstraints: string[] = [];
  if (controls.preserveExteriorFootprint) activeConstraints.push('locked exterior footprint');
  if (controls.preserveCore) activeConstraints.push('preserved core placement');
  if (controls.preserveSelectedRooms?.length) activeConstraints.push(`${controls.preserveSelectedRooms.length} locked room(s)`);
  const scopeNote = activeConstraints.length > 0 ? ` under ${activeConstraints.join(', ')}` : '';
  return `Produced ${producedCount} of ${requestedCount} requested genuinely distinct architectural layouts${scopeNote}. Remaining candidates failed mandatory geometry/ventilation rules or were suppressed as near-duplicates with identical room/circulation topology. Relax footprint/core locks or adjust the plot/unit mix to unlock additional topology families.`;
}
