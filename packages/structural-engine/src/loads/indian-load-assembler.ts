/**
 * @ai-floor-planner/structural-engine — Traceable Indian Load & Physical Support-Edge Engine (Carbon 4 Section 04)
 *
 * Implements explicit, clause-traceable gravity, lateral seismic, and lateral wind loading
 * per IS 875 (Parts 1, 2, 3), IS 456:2000 Cl. 24.5 & Table 18, and IS 1893 (Part 1): 2016 Cl. 6.3.1.2:
 * - Member self-weight applied ONCE (zero duplicate self-weight!)
 * - Physical Support-Edge Graph for slab-to-beam gravity transfer (ZERO `length^1.35` heuristic!):
 *   1. Exact One-Way Opposite-Edge Transfer (`w * lx / 2` per opposite edge, 100% force conservation).
 *   2. Rectangular two-way 45-degree tributary edge transfer (IS 456 Cl. 24.5):
 *      - Short edges (`lx`): triangular tributary load `F_short = F_panel * (lx / (4 * ly))`
 *      - Long edges (`ly`): trapezoidal tributary load `F_long = F_panel * (0.5 - lx / (4 * ly))`
 *      - Exact conservation: `2 * F_short + 2 * F_long === F_panel` to 1e-12!
 *   3. Unresolved panels are recorded with their unapplied source loads and block scope acceptance.
 *   4. Explicit meshedSlabPanelIds excludes loads owned by a coupled shell model.
 * - Masonry wall & roof parapet line loads (deducting door/window openings) applied in `SUPERIMPOSED_DEAD`
 * - Staircase waist + riser/step + live load reactions transferred onto stair landing/header beams
 * - Overhead water tank reactions at identified roof column ends, with force and moment reconciliation.
 * - Structured `loadSourceAudit` trail recording source, units, case, geometry, force, and receiving member IDs.
 */

import type {
  AnalyticalFrameModel,
  AnalyticalLoadCase,
  AnalyticalLoadCombination,
  MemberUniformLoad,
  NodalPointLoad,
} from '../types/solver-types.js';
import type {
  ConcreteGrade,
  SteelGrade,
  SynthesizedStructuralSystem,
} from '../assembly/canonical-frame-assembler.js';
import type { Point } from '@ai-floor-planner/core';
import { resolveRectangularSlabTransfer, type SlabTributarySegment } from './rectangular-slab-transfer.js';
import {
  IS875_RCC_UNIT_WEIGHT_KN_M3,
  structuralMetersToCanonicalMm,
} from '../adapter/units-and-coordinates.js';
import {
  analyzeModalAndSeismicFrame,
  type EquivalentStaticSeismicResult,
  type SeismicZoneIS1893,
  type SoilTypeIS1893,
} from '../dynamics/modal-and-seismic.js';
import { AwatifStructuralSolver } from '../solver/awatif-structural-solver.js';

export interface GeotechnicalReviewedInputs {
  /** Safe Bearing Capacity (SBC) at foundation level in kN/m² (kPa). NEVER invented! */
  readonly safeBearingCapacityKPa: number;
  /** Explicit bearing basis (`'NET'` default per IS 1904 Cl. 3.6 & 7.1, or `'GROSS'`). */
  readonly bearingCapacityBasis?: 'NET' | 'GROSS';
  readonly foundationDepthBelowGroundM: number;
  readonly soilUnitWeightKnM3: number;
  readonly waterTableDepthBelowGroundM?: number;
  readonly allowableSettlementMm?: number;
  readonly subgradeModulusKnM3?: number;
  readonly reportReference: string;
}

export interface WindReviewedInputs {
  readonly enabled: boolean;
  readonly basicWindSpeedVbMs: number;
  readonly terrainCategory: 1 | 2 | 3 | 4;
  readonly riskCoefficientK1?: number;
  readonly topographyFactorK3?: number;
  readonly forceCoefficientCf?: number;
}

export interface SeismicReviewedInputs {
  readonly enabled: boolean;
  readonly zone: SeismicZoneIS1893;
  readonly soilType: SoilTypeIS1893;
  readonly importanceFactorI: number;
  readonly responseReductionFactorR: number;
  readonly frameSystemType: 'RC_MRF_WITHOUT_INFILL' | 'RC_MRF_WITH_BRICK_INFILL';
}

export interface ReviewedStructuralInputs {
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly ductileDetailingIS13920: boolean;
  readonly floorFinishKnM2: number;
  readonly masonryUnitWeightKnM3: number;
  readonly roofLiveLoadKnM2: number;
  readonly waterTankLoadKn?: number;
  readonly waterTankSupport?: {
    readonly reference: string;
    readonly centerOfGravityMm: Point;
    readonly reactions: readonly { readonly physicalColumnId: string; readonly verticalReactionKn: number }[];
  };
  readonly occupancyLiveLoadOverridesKnM2?: Readonly<Record<string, number>>;
  readonly seismic?: SeismicReviewedInputs;
  readonly wind?: WindReviewedInputs;
  readonly geotechnical?: GeotechnicalReviewedInputs | null;
  /** Optional user-supplied reference. It carries no approval authority. */
  readonly engineerApprovalReference?: string | null;
}

export interface LoadSourceAuditRecord {
  readonly sourceId: string;
  readonly category: 'MEMBER_SELF_WEIGHT' | 'SLAB_PANEL' | 'MASONRY_OR_PARAPET_WALL' | 'STAIRCASE_FLIGHT' | 'WATER_TANK';
  readonly loadCaseIds: readonly string[];
  readonly intensityDescription: string;
  readonly areaOrLength: string;
  readonly totalVerticalForceKn: number;
  readonly transferMethod:
    | 'DIRECT_MEMBER_SELF_WEIGHT'
    | 'EXACT_ONE_WAY_OPPOSITE_EDGES'
    | 'VERIFIED_TWO_WAY_YIELD_LINE_IS456'
    | 'VERIFIED_CANTILEVER_ROOT_EDGE'
    | 'UNVERIFIED_LINEAR_TRIBUTARY_FALLBACK'
    | 'RECTANGULAR_TWO_WAY_45_DEGREE_TRIBUTARY'
    | 'UNRESOLVED_SLAB_SUPPORT'
    | 'COLLINEAR_BEAM_WALL_LINE_LOAD'
    | 'STAIR_LANDING_REACTION'
    | 'REVIEWED_ROOF_TANK_REACTIONS'
    | 'UNRESOLVED_ROOF_TANK_SUPPORT'
    | 'ROOF_CORE_NODAL_REACTION';
  readonly receivingElementIds: readonly string[];
  readonly slabGeometry?: {
    readonly floorId: string;
    readonly elevationMm?: number;
    readonly boundaryMm?: SynthesizedStructuralSystem['slabPanels'][number]['exchangeBoundary'];
    readonly boundsMm?: SynthesizedStructuralSystem['slabPanels'][number]['boundsMm'];
    readonly completeEdges: readonly string[];
    readonly supportedSegments: readonly {
      readonly edge: string;
      readonly elementId: string;
      readonly physicalMemberId?: string;
      readonly startMm: number;
      readonly endMm: number;
    }[];
    readonly effectiveSpansMm: readonly number[];
  };
  readonly gravityTransfer?: {
    readonly forceByCaseKn: Readonly<Record<string, number>>;
    readonly assignedForceByCaseKn: Readonly<Record<string, number>>;
    readonly appliedMomentByCaseKnM?: Readonly<Record<string, readonly number[]>>;
    readonly loads?: readonly (SlabTributarySegment & { readonly elementId: string })[];
    readonly blocker?: string;
  };
}

export interface SlabLoadPathAudit {
  readonly verifiedOneWayOppositeEdges: readonly string[];
  readonly verifiedTwoWayYieldLineIs456: readonly string[];
  readonly verifiedCantileverRootEdge: readonly string[];
  readonly unverifiedPreliminaryFallback: readonly string[];
  readonly missingSupport: readonly string[];
  readonly meshedShellSkipped: readonly string[];
}

export interface LoadTakeoffBreakdown {
  readonly memberSelfWeightKn: number;
  readonly slabSelfWeightKn: number;
  readonly floorFinishLoadKn: number;
  readonly masonryWallLoadKn: number;
  readonly staircaseDeadLoadKn: number;
  readonly waterTankLoadKn: number;
  readonly totalDeadPlusSdlKn: number;
  readonly totalOccupancyLiveKn: number;
  readonly totalRoofLiveKn: number;
  readonly seismicSummary?: EquivalentStaticSeismicResult;
  readonly windBaseShearXKn: number;
  readonly windBaseShearYKn: number;
  /**
   * Backward-compatible 3-bucket summary:
   * - `oneWayEdgeSupported`: Slab panels with verified analytical tributary transfer.
   * - `preliminaryDistribution`: Panels with some geometric bearing but no verified load transfer.
   * - `missingSupport`: Panels with zero valid supporting beam elements
   */
  readonly slabLoadPaths?: {
    readonly oneWayEdgeSupported: readonly string[];
    readonly preliminaryDistribution: readonly string[];
    readonly missingSupport: readonly string[];
  };
  readonly slabLoadPathAudit?: SlabLoadPathAudit;
  readonly loadSourceAudit?: readonly LoadSourceAuditRecord[];
  /** Total estimated demands withheld from the diagnostic model for unresolved gravity paths. */
  readonly unassignedGravityKnByCase?: Readonly<Record<'DL' | 'SDL' | 'LL', number>>;
}

export interface AssembledFrameModelWithTakeoff {
  readonly analyticalModel: AnalyticalFrameModel;
  readonly loadTakeoff: LoadTakeoffBreakdown;
}

export function lookupIS875OccupancyLiveLoadKnM2(
  roomType: string,
  floorUse?: string,
  overrides?: Readonly<Record<string, number>>,
): number {
  if (overrides && overrides[roomType] !== undefined) {
    return overrides[roomType]!;
  }
  if (floorUse === 'STILT_PARKING') return 2.5;
  const upper = roomType.toUpperCase();
  if (
    upper.includes('BALCONY') ||
    upper.includes('CORRIDOR') ||
    upper.includes('PASSAGE') ||
    upper.includes('LOBBY') ||
    upper.includes('STAIR')
  ) {
    return 3.0;
  }
  if (upper.includes('STORE') || upper.includes('UTILITY')) {
    return 3.0;
  }
  if (upper.includes('GARAGE') || upper.includes('PARKING')) {
    return 2.5;
  }
  if (upper.includes('OFFICE')) {
    return 2.5;
  }
  return 2.0;
}

function computeIS875TerrainK2(heightM: number, category: 1 | 2 | 3 | 4): number {
  const h = Math.max(10, heightM);
  const base10 = { 1: 1.05, 2: 1.0, 3: 0.91, 4: 0.8 }[category];
  const exp = { 1: 0.065, 2: 0.085, 3: 0.11, 4: 0.14 }[category];
  return base10 * Math.pow(h / 10, exp);
}

export async function assembleLoadedAnalyticalFrameModel(
  system: SynthesizedStructuralSystem,
  inputs: ReviewedStructuralInputs,
  solverInstance?: AwatifStructuralSolver,
  options?: {
    /** Slab panel IDs modeled directly as PyNite Plate3D/Quad3D shell elements (prevents double-counting beam loads!). */
    readonly meshedSlabPanelIds?: ReadonlySet<string>;
  },
): Promise<AssembledFrameModelWithTakeoff> {
  const dlUniform: MemberUniformLoad[] = [];
  const sdlUniform: MemberUniformLoad[] = [];
  const sdlNodal: NodalPointLoad[] = [];
  const llUniform: MemberUniformLoad[] = [];
  const loadSourceAudit: LoadSourceAuditRecord[] = [];

  let memberSelfWeightKn = 0;
  let slabSelfWeightKn = 0;
  let floorFinishLoadKn = 0;
  let masonryWallLoadKn = 0;
  let staircaseDeadLoadKn = 0;
  let totalOccupancyLiveKn = 0;
  let totalRoofLiveKn = 0;

  const elemLengthsM = system.elements.map((el) => {
    const n0 = system.nodes[el.startNodeIndex]!.positionM;
    const n1 = system.nodes[el.endNodeIndex]!.positionM;
    return Math.hypot(n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]);
  });

  // 1. Member Self-Weight (Applied ONCE in DL; zero duplication!)
  for (let i = 0; i < system.elements.length; i++) {
    const el = system.elements[i]!;
    const L = elemLengthsM[i]!;
    const gamma = el.section.unitWeightKnM3 ?? IS875_RCC_UNIT_WEIGHT_KN_M3;
    const swPerM = el.section.areaM2 * gamma;
    memberSelfWeightKn += swPerM * L;
    dlUniform.push({
      elementIndex: i,
      coordinateSystem: 'GLOBAL',
      qStartKnPerM: [0, 0, -swPerM],
      sourceDescription: `Self-weight of ${el.id}`,
    });
  }
  loadSourceAudit.push({
    sourceId: 'MEMBER_SELF_WEIGHT_ALL',
    category: 'MEMBER_SELF_WEIGHT',
    loadCaseIds: ['DL'],
    intensityDescription: `${IS875_RCC_UNIT_WEIGHT_KN_M3} kN/m³ × section area`,
    areaOrLength: `${system.elements.length} frame elements`,
    totalVerticalForceKn: Number(memberSelfWeightKn.toFixed(3)),
    transferMethod: 'DIRECT_MEMBER_SELF_WEIGHT',
    receivingElementIds: system.elements.map((e) => e.id),
  });

  // 2. Masonry Wall & Roof Parapet Line Loads on Supporting Plinth & Floor Physical Beams
  for (const meta of system.memberMetadata) {
    if (meta.supportedWallThicknessMm > 0 && meta.supportedWallHeightMm > 0) {
      const netFactor = 1 - meta.wallOpeningFraction;
      const wallAreaPerM = (meta.supportedWallThicknessMm / 1000) * (meta.supportedWallHeightMm / 1000);
      const qWallKnM = wallAreaPerM * inputs.masonryUnitWeightKnM3 * netFactor;
      if (qWallKnM > 1e-4) {
        const childIndices =
          meta.analyticalElementIndices && meta.analyticalElementIndices.length > 0
            ? meta.analyticalElementIndices
            : [meta.elementIndex];
        let memberWallTotKn = 0;
        for (const eIdx of childIndices) {
          const L = elemLengthsM[eIdx]!;
          masonryWallLoadKn += qWallKnM * L;
          memberWallTotKn += qWallKnM * L;
          sdlUniform.push({
            elementIndex: eIdx,
            coordinateSystem: 'GLOBAL',
            qStartKnPerM: [0, 0, -qWallKnM],
            sourceDescription: `Masonry wall on ${meta.elementId} (${meta.supportedWallThicknessMm}mm, opening ${(meta.wallOpeningFraction * 100).toFixed(0)}%)`,
          });
        }
        loadSourceAudit.push({
          sourceId: `WALL_ON_${meta.elementId}`,
          category: 'MASONRY_OR_PARAPET_WALL',
          loadCaseIds: ['SDL'],
          intensityDescription: `${qWallKnM.toFixed(2)} kN/m (${meta.supportedWallThicknessMm}x${meta.supportedWallHeightMm}mm, open ${(meta.wallOpeningFraction * 100).toFixed(0)}%)`,
          areaOrLength: `${(meta.clearSpanOrHeightMm / 1000).toFixed(2)} m`,
          totalVerticalForceKn: Number(memberWallTotKn.toFixed(3)),
          transferMethod: 'COLLINEAR_BEAM_WALL_LINE_LOAD',
          receivingElementIds: childIndices.map((idx) => system.elements[idx]!.id),
        });
      }
    }
  }

  const maxFloorLevel = Math.max(0, ...system.slabPanels.map((p) => p.floorLevel));

  // Nodal Seismic Weights per IS 1893:2016
  const nodalDeadSdlKn = new Float64Array(system.nodes.length);
  const nodalSeismicLiveKn = new Float64Array(system.nodes.length);

  for (let i = 0; i < system.elements.length; i++) {
    const el = system.elements[i]!;
    const L = elemLengthsM[i]!;
    const sw = el.section.areaM2 * (el.section.unitWeightKnM3 ?? IS875_RCC_UNIT_WEIGHT_KN_M3) * L;
    nodalDeadSdlKn[el.startNodeIndex] += 0.5 * sw;
    nodalDeadSdlKn[el.endNodeIndex] += 0.5 * sw;
  }
  for (const ul of sdlUniform) {
    const el = system.elements[ul.elementIndex]!;
    const L = elemLengthsM[ul.elementIndex]!;
    const wTot = Math.abs(ul.qStartKnPerM[2]) * L;
    nodalDeadSdlKn[el.startNodeIndex] += 0.5 * wTot;
    nodalDeadSdlKn[el.endNodeIndex] += 0.5 * wTot;
  }

  const physBeamById = new Map(
    (system.physicalModel?.beams ?? []).map((pb) => [pb.physicalMemberId, pb]),
  );
  const physicalSlabsById = new Map(
    system.physicalModel.slabs.map(slab => [slab.physicalMemberId, slab]),
  );
  const beamIndicesByFloor = new Map<string, number[]>();
  for (const beam of system.physicalModel.beams) {
    const indices = beamIndicesByFloor.get(beam.floorId) ?? [];
    indices.push(...beam.analyticalElementIndices);
    beamIndicesByFloor.set(beam.floorId, indices);
  }
  const overlappingSlabs = new Set<string>();
  for (let i = 0; i < system.slabPanels.length; i++) {
    const a = system.slabPanels[i]!;
    if (!a.boundsMm || options?.meshedSlabPanelIds?.has(a.id)) continue;
    for (let j = i + 1; j < system.slabPanels.length; j++) {
      const b = system.slabPanels[j]!;
      if (b.floorId !== a.floorId || !b.boundsMm) continue;
      const overlapX = Math.min(a.boundsMm.maxX, b.boundsMm.maxX) - Math.max(a.boundsMm.minX, b.boundsMm.minX);
      const overlapY = Math.min(a.boundsMm.maxY, b.boundsMm.maxY) - Math.max(a.boundsMm.minY, b.boundsMm.minY);
      if (overlapX > 0.01 && overlapY > 0.01) {
        overlappingSlabs.add(a.id);
        overlappingSlabs.add(b.id);
      }
    }
  }
  const slabLoadPaths = {
    oneWayEdgeSupported: [] as string[],
    preliminaryDistribution: [] as string[],
    missingSupport: [] as string[],
  };
  const verifiedOneWay: string[] = [];
  const verifiedTwoWay: string[] = [];
  const meshedShellSkipped: string[] = [];
  const unassignedGravity = { DL: 0, SDL: 0, LL: 0 };
  const hasLowerFloor = system.slabPanels.some(panel => panel.floorLevel < maxFloorLevel);

  for (const panel of system.slabPanels) {
    if (options?.meshedSlabPanelIds?.has(panel.id)) {
      meshedShellSkipped.push(panel.id);
      continue;
    }

    const isTopRoof = panel.floorLevel === maxFloorLevel && hasLowerFloor;
    const intensities = {
      DL: (panel.thicknessMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3,
      SDL: inputs.floorFinishKnM2,
      LL: isTopRoof ? inputs.roofLiveLoadKnM2 : lookupIS875OccupancyLiveLoadKnM2(
        panel.roomType, undefined, inputs.occupancyLiveLoadOverridesKnM2,
      ),
    };
    const physicalSlab = physicalSlabsById.get(panel.id);
    const elevation = physicalSlab?.topElevationMm ?? system.storeys.find(s => s.id === panel.floorId)?.elevationMm;
    const candidates = physicalSlab ? beamIndicesByFloor.get(panel.floorId) ?? [] : panel.supportingBeamElementIndices;
    const resolved = resolveRectangularSlabTransfer(system, panel, elevation, candidates, overlappingSlabs.has(panel.id));
    const loadCaseIds = ['DL', 'SDL', 'LL'] as const;
    const area = resolved.kind !== 'UNRESOLVED' && panel.boundsMm
      ? (panel.boundsMm.maxX - panel.boundsMm.minX) * (panel.boundsMm.maxY - panel.boundsMm.minY) / 1e6
      : panel.areaM2;
    const forceByCaseKn = { DL: area * intensities.DL, SDL: area * intensities.SDL, LL: area * intensities.LL };
    const receivingElementIds = new Set<string>();
    const supportedSegments = resolved.segments.map(s => {
      const el = system.elements[s.elementIndex]!;
      return { edge: s.edge, elementId: el.id, physicalMemberId: system.physicalModel.mapping.analyticalToPhysicalMemberId[el.id],
        startMm: s.startMm, endMm: s.endMm };
    });
    const audit = {
      sourceId: panel.id,
      category: 'SLAB_PANEL' as const,
      loadCaseIds,
      intensityDescription: `SW=${intensities.DL.toFixed(2)}, FF=${intensities.SDL.toFixed(2)}, LL=${intensities.LL.toFixed(2)} kN/m²`,
      areaOrLength: `${area.toFixed(3)} m² (${panel.lxMm}x${panel.lyMm}mm)`,
      totalVerticalForceKn: forceByCaseKn.DL + forceByCaseKn.SDL + forceByCaseKn.LL,
      slabGeometry: { floorId: panel.floorId, elevationMm: elevation, boundaryMm: panel.exchangeBoundary,
        boundsMm: panel.boundsMm, completeEdges: resolved.completeEdges, supportedSegments, effectiveSpansMm: [panel.lxMm, panel.lyMm] },
    };

    if (resolved.kind === 'UNRESOLVED') {
      if (resolved.segments.length) slabLoadPaths.preliminaryDistribution.push(panel.id);
      else slabLoadPaths.missingSupport.push(panel.id);
      for (const id of loadCaseIds) unassignedGravity[id] += forceByCaseKn[id];
      loadSourceAudit.push({ ...audit, transferMethod: 'UNRESOLVED_SLAB_SUPPORT', receivingElementIds: [],
        gravityTransfer: { forceByCaseKn, assignedForceByCaseKn: { DL: 0, SDL: 0, LL: 0 }, blocker: resolved.reason } });
      continue;
    }

    const allocated = { area: 0, firstMomentX: 0, firstMomentY: 0 };
    const seismicLlFactor = isTopRoof ? 0 : intensities.LL <= 3.0 ? 0.25 : 0.5;
    for (const segment of resolved.allocations) {
      const { elementIndex, startFraction, endFraction, startTributaryWidthM: w0, endTributaryWidthM: w1 } = segment;
      const element = system.elements[elementIndex]!;
      const segmentLength = elemLengthsM[elementIndex]! * (endFraction - startFraction);
      const segmentArea = segmentLength * (w0 + w1) / 2;
      const endArea = startFraction * segmentArea + (endFraction - startFraction) * segmentLength * (w0 + 2 * w1) / 6;
      const startArea = segmentArea - endArea;
      const start = system.nodes[element.startNodeIndex]!.positionM;
      const end = system.nodes[element.endNodeIndex]!.positionM;
      allocated.area += segmentArea;
      allocated.firstMomentX += startArea * start[0] + endArea * end[0];
      allocated.firstMomentY += startArea * start[1] + endArea * end[1];
      receivingElementIds.add(element.id);
      const lists = { DL: dlUniform, SDL: sdlUniform, LL: llUniform };
      for (const id of loadCaseIds) {
        lists[id].push({
          elementIndex, startFraction, endFraction, coordinateSystem: 'GLOBAL',
          qStartKnPerM: [0, 0, -w0 * intensities[id]], qEndKnPerM: [0, 0, -w1 * intensities[id]],
          sourceDescription: `Slab ${panel.id} ${id} (${resolved.kind})`,
        });
      }
      nodalDeadSdlKn[element.startNodeIndex] += startArea * (intensities.DL + intensities.SDL);
      nodalDeadSdlKn[element.endNodeIndex] += endArea * (intensities.DL + intensities.SDL);
      nodalSeismicLiveKn[element.startNodeIndex] += startArea * intensities.LL * seismicLlFactor;
      nodalSeismicLiveKn[element.endNodeIndex] += endArea * intensities.LL * seismicLlFactor;
    }

    const bounds = panel.boundsMm!;
    const centroid = { x: (bounds.minX + bounds.maxX) / 2000, y: -(bounds.minY + bounds.maxY) / 2000 };
    const residual = [allocated.area - area, allocated.firstMomentX - area * centroid.x, allocated.firstMomentY - area * centroid.y];
    if (residual.some(value => Math.abs(value) > 1e-7 * Math.max(1, area))) {
      throw new Error(`Slab ${panel.id} support reactions do not conserve gravity force or moment.`);
    }
    slabLoadPaths.oneWayEdgeSupported.push(panel.id);
    (resolved.kind === 'ONE_WAY_OPPOSITE_EDGES' ? verifiedOneWay : verifiedTwoWay).push(panel.id);
    slabSelfWeightKn += forceByCaseKn.DL;
    floorFinishLoadKn += forceByCaseKn.SDL;
    if (isTopRoof) totalRoofLiveKn += forceByCaseKn.LL;
    else totalOccupancyLiveKn += forceByCaseKn.LL;
    loadSourceAudit.push({
      ...audit,
      transferMethod: resolved.kind === 'ONE_WAY_OPPOSITE_EDGES' ? 'EXACT_ONE_WAY_OPPOSITE_EDGES' : 'RECTANGULAR_TWO_WAY_45_DEGREE_TRIBUTARY',
      receivingElementIds: [...receivingElementIds],
      gravityTransfer: {
        forceByCaseKn,
        assignedForceByCaseKn: { DL: allocated.area * intensities.DL, SDL: allocated.area * intensities.SDL, LL: allocated.area * intensities.LL },
        appliedMomentByCaseKnM: Object.fromEntries(loadCaseIds.map(id => [
          id, [-allocated.firstMomentY * intensities[id], allocated.firstMomentX * intensities[id]],
        ])),
        loads: resolved.allocations.map(item => ({ ...item, elementId: system.elements[item.elementIndex]!.id })),
      },
    });
  }

  // 4. Staircase Waist Slab + Steps Dead & Live Load Reactions onto Landing/Header Beams
  for (const st of system.stairWaists) {
    if (st.supportingBeamElementIndices.length === 0) continue;
    const slopeFactor = Math.hypot(st.riserMm, st.treadMm) / Math.max(200, st.treadMm);
    const waistKPa = (st.waistThicknessMm / 1000) * slopeFactor * IS875_RCC_UNIT_WEIGHT_KN_M3;
    const stepsKPa = 0.5 * (st.riserMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;
    const finishKPa = inputs.floorFinishKnM2;
    const stairLiveKPa = 3.0;
    const areaM2 = (st.horizontalSpanMm / 1000) * (st.widthMm / 1000);

    const totDeadKn = (waistKPa + stepsKPa + finishKPa) * areaM2;
    const totLiveKn = stairLiveKPa * areaM2;
    staircaseDeadLoadKn += totDeadKn;
    totalOccupancyLiveKn += totLiveKn;

    const totBeamLenM = st.supportingBeamElementIndices.reduce((s, bIdx) => s + elemLengthsM[bIdx]!, 0);
    if (totBeamLenM <= 1e-6) continue;
    const qDeadStair = totDeadKn / totBeamLenM;
    const qLiveStair = totLiveKn / totBeamLenM;
    for (const bIdx of st.supportingBeamElementIndices) {
      const bLenM = elemLengthsM[bIdx]!;
      const el = system.elements[bIdx]!;
      sdlUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -qDeadStair],
        sourceDescription: `Staircase ${st.stairId} waist + steps DL`,
      });
      llUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -qLiveStair],
        sourceDescription: `Staircase ${st.stairId} imposed load (3.0 kN/m²)`,
      });
      nodalDeadSdlKn[el.startNodeIndex] += 0.5 * qDeadStair * bLenM;
      nodalDeadSdlKn[el.endNodeIndex] += 0.5 * qDeadStair * bLenM;
      nodalSeismicLiveKn[el.startNodeIndex] += 0.5 * qLiveStair * bLenM * 0.25;
      nodalSeismicLiveKn[el.endNodeIndex] += 0.5 * qLiveStair * bLenM * 0.25;
    }

    loadSourceAudit.push({
      sourceId: st.id,
      category: 'STAIRCASE_FLIGHT',
      loadCaseIds: ['SDL', 'LL'],
      intensityDescription: `DL=${(waistKPa + stepsKPa + finishKPa).toFixed(2)}, LL=3.00 kN/m²`,
      areaOrLength: `${areaM2.toFixed(2)} m²`,
      totalVerticalForceKn: Number((totDeadKn + totLiveKn).toFixed(3)),
      transferMethod: 'STAIR_LANDING_REACTION',
      receivingElementIds: st.supportingBeamElementIndices.map((idx) => system.elements[idx]!.id),
    });
  }

  // 5. Apply only reviewed roof-column reactions that reproduce the tank resultant.
  const requestedTankLoadKn = Math.max(0, inputs.waterTankLoadKn ?? 0);
  let waterTankLoadKn = 0;
  if (requestedTankLoadKn > 0) {
    const roofElevationMm = Math.max(...system.physicalModel.columns.map(column => column.topElevationMm));
    const roofColumns = new Map(system.physicalModel.columns
      .filter(column => column.topElevationMm === roofElevationMm)
      .map(column => [column.physicalMemberId, column]));
    const review = inputs.waterTankSupport;
    const reactions = review?.reactions.flatMap(reaction => {
      const column = roofColumns.get(reaction.physicalColumnId);
      if (!column || !Number.isFinite(reaction.verticalReactionKn) || reaction.verticalReactionKn <= 0) return [];
      const node = system.nodes[column.endAnalyticalNodeIndex];
      return node && !node.restraint?.[2]
        ? [{ column, node, force: reaction.verticalReactionKn, position: structuralMetersToCanonicalMm(node.positionM) }]
        : [];
    }) ?? [];
    const force = reactions.reduce((sum, r) => sum + r.force, 0);
    const momentX = reactions.reduce((sum, r) => sum + r.position.y * r.force / 1000, 0);
    const momentY = reactions.reduce((sum, r) => sum + r.position.x * r.force / 1000, 0);
    const supportIsValid = review?.reference.trim() && reactions.length === review.reactions.length &&
      new Set(reactions.map(r => r.node.index)).size === reactions.length &&
      Math.abs(force - requestedTankLoadKn) <= 1e-6 * Math.max(1, requestedTankLoadKn) &&
      Math.abs(momentX - requestedTankLoadKn * review.centerOfGravityMm.y / 1000) <= 0.001 * requestedTankLoadKn &&
      Math.abs(momentY - requestedTankLoadKn * review.centerOfGravityMm.x / 1000) <= 0.001 * requestedTankLoadKn;

    if (supportIsValid) {
      waterTankLoadKn = force;
      for (const r of reactions) {
        sdlNodal.push({ nodeIndex: r.node.index, vectorKnM: [0, 0, -r.force, 0, 0, 0],
          sourceDescription: 'Reviewed overhead tank gravity reaction' });
        nodalDeadSdlKn[r.node.index] += r.force;
      }
    } else {
      unassignedGravity.SDL += requestedTankLoadKn;
    }
    loadSourceAudit.push({
      sourceId: 'ROOF_WATER_TANK',
      category: 'WATER_TANK',
      loadCaseIds: ['SDL'],
      intensityDescription: `${requestedTankLoadKn.toFixed(2)} kN reviewed tank gravity force`,
      areaOrLength: review ? `Tank center (${review.centerOfGravityMm.x}, ${review.centerOfGravityMm.y}) mm` : 'Tank center required',
      totalVerticalForceKn: requestedTankLoadKn,
      transferMethod: supportIsValid ? 'REVIEWED_ROOF_TANK_REACTIONS' : 'UNRESOLVED_ROOF_TANK_SUPPORT',
      receivingElementIds: supportIsValid ? reactions.map(r => r.node.id) : [],
      gravityTransfer: {
        forceByCaseKn: { SDL: requestedTankLoadKn },
        assignedForceByCaseKn: { SDL: waterTankLoadKn },
        ...(supportIsValid ? { appliedMomentByCaseKnM: { SDL: [momentX, momentY] } } : {
          blocker: 'Supply the reviewed tank center of gravity and concurrent gravity reactions at identified roof columns. The reactions must reproduce the specified force and plan moments.',
        }),
      },
    });
  }

  const loadCases: AnalyticalLoadCase[] = [
    {
      id: 'DL',
      name: 'Dead Load (Member & Slab Self-Weight)',
      nature: 'DEAD',
      nodalLoads: [],
      memberUniformLoads: dlUniform,
    },
    {
      id: 'SDL',
      name: 'Superimposed Dead Load (Finishes, Masonry Walls, Stairs, Tank)',
      nature: 'SUPERIMPOSED_DEAD',
      nodalLoads: sdlNodal,
      memberUniformLoads: sdlUniform,
    },
    {
      id: 'LL',
      name: 'Imposed Live Load (IS 875 Part 2)',
      nature: 'LIVE',
      nodalLoads: [],
      memberUniformLoads: llUniform,
    },
  ];

  const xs = system.nodes.map((n) => n.positionM[0]);
  const ys = system.nodes.map((n) => n.positionM[1]);
  const zs = system.nodes.map((n) => n.positionM[2]);
  const planDimXM = Math.max(3.0, Math.max(...xs) - Math.min(...xs));
  const planDimYM = Math.max(3.0, Math.max(...ys) - Math.min(...ys));
  const buildingHeightAbovePlinthM = Math.max(3.0, Math.max(...zs));

  // 6. Optional IS 1893 (Part 1): 2016 Equivalent Static + Modal Seismic Analysis
  let seismicSummary: EquivalentStaticSeismicResult | undefined;
  if (inputs.seismic?.enabled) {
    const nodalMasses = system.nodes
      .map((n) => ({
        nodeIndex: n.index,
        seismicWeightKn:
          n.positionM[2] > 0.1 ? nodalDeadSdlKn[n.index]! + nodalSeismicLiveKn[n.index]! : 0,
      }))
      .filter((m) => m.seismicWeightKn > 1e-6);

    const baseModelForModal: AnalyticalFrameModel = {
      modelId: `${system.systemId}_modal`,
      sourceBuildingId: system.buildingId,
      sourceRevision: system.sourceArchitecturalRevision,
      sourceArchitecturalSha256: system.sourceArchitecturalSha256,
      nodes: system.nodes,
      elements: system.elements,
      loadCases: [],
      combinations: [],
    };

    seismicSummary = await analyzeModalAndSeismicFrame({
      model: baseModelForModal,
      nodalMasses,
      seismicParams: {
        zone: inputs.seismic.zone,
        soilType: inputs.seismic.soilType,
        importanceFactorI: inputs.seismic.importanceFactorI,
        responseReductionFactorR: inputs.seismic.responseReductionFactorR,
        buildingHeightM: buildingHeightAbovePlinthM,
        planDimensionXM: planDimXM,
        planDimensionYM: planDimYM,
        frameSystemType: inputs.seismic.frameSystemType,
      },
      solver: solverInstance,
    });

    loadCases.push({
      id: 'EQX',
      name: `Seismic +X (IS 1893:2016 Zone ${inputs.seismic.zone})`,
      nature: 'SEISMIC_X',
      nodalLoads: seismicSummary.lateralLoadsX,
      memberUniformLoads: [],
    });
    loadCases.push({
      id: 'EQY',
      name: `Seismic +Y (IS 1893:2016 Zone ${inputs.seismic.zone})`,
      nature: 'SEISMIC_Y',
      nodalLoads: seismicSummary.lateralLoadsY,
      memberUniformLoads: [],
    });
  }

  // 7. Optional IS 875 (Part 3): 2015 Wind Load Cases (+WLX, +WLY)
  let windBaseShearXKn = 0;
  let windBaseShearYKn = 0;
  if (inputs.wind?.enabled) {
    const k1 = inputs.wind.riskCoefficientK1 ?? 1.0;
    const k3 = inputs.wind.topographyFactorK3 ?? 1.0;
    const cf = inputs.wind.forceCoefficientCf ?? 1.2;

    const elevGroups = new Map<number, number[]>();
    for (const n of system.nodes) {
      if (n.positionM[2] <= 0.2 || n.restraint) continue;
      const zKey = Math.round(n.positionM[2] * 20) / 20;
      const arr = elevGroups.get(zKey) ?? [];
      arr.push(n.index);
      elevGroups.set(zKey, arr);
    }

    const sortedElevs = Array.from(elevGroups.keys()).sort((a, b) => a - b);
    const wlxLoads: NodalPointLoad[] = [];
    const wlyLoads: NodalPointLoad[] = [];

    for (let idx = 0; idx < sortedElevs.length; idx++) {
      const z = sortedElevs[idx]!;
      const zBelow = idx === 0 ? 0 : sortedElevs[idx - 1]!;
      const zAbove = idx === sortedElevs.length - 1 ? z : sortedElevs[idx + 1]!;
      const tribHeightM = 0.5 * (z - zBelow) + 0.5 * (zAbove - z);

      const k2 = computeIS875TerrainK2(z, inputs.wind.terrainCategory);
      const vz = inputs.wind.basicWindSpeedVbMs * k1 * k2 * k3;
      const pzKnM2 = 0.0006 * vz * vz;

      const fxStoryKn = cf * pzKnM2 * planDimYM * tribHeightM;
      const fyStoryKn = cf * pzKnM2 * planDimXM * tribHeightM;
      windBaseShearXKn += fxStoryKn;
      windBaseShearYKn += fyStoryKn;

      const groupNodes = elevGroups.get(z)!;
      const perNodeX = fxStoryKn / groupNodes.length;
      const perNodeY = fyStoryKn / groupNodes.length;

      for (const nIdx of groupNodes) {
        wlxLoads.push({
          nodeIndex: nIdx,
          vectorKnM: [perNodeX, 0, 0, 0, 0, 0],
          sourceDescription: `IS 875 Part 3 Wind +X at Z=${z}m`,
        });
        wlyLoads.push({
          nodeIndex: nIdx,
          vectorKnM: [0, perNodeY, 0, 0, 0, 0],
          sourceDescription: `IS 875 Part 3 Wind +Y at Z=${z}m`,
        });
      }
    }

    loadCases.push({
      id: 'WLX',
      name: `Wind +X (IS 875 Part 3 Vb=${inputs.wind.basicWindSpeedVbMs}m/s)`,
      nature: 'WIND_X',
      nodalLoads: wlxLoads,
      memberUniformLoads: [],
    });
    loadCases.push({
      id: 'WLY',
      name: `Wind +Y (IS 875 Part 3 Vb=${inputs.wind.basicWindSpeedVbMs}m/s)`,
      nature: 'WIND_Y',
      nodalLoads: wlyLoads,
      memberUniformLoads: [],
    });
  }

  // 8. Assemble Clause-Traceable ULS & SLS Load Combinations
  const combinations: AnalyticalLoadCombination[] = [
    {
      id: 'ULS_15_DL_LL',
      name: '1.5(DL + SDL + LL)',
      limitState: 'ULS',
      standardClause: 'IS 456:2000 Table 18',
      factors: { DL: 1.5, SDL: 1.5, LL: 1.5 },
    },
    {
      id: 'SLS_10_DL_LL',
      name: '1.0(DL + SDL + LL)',
      limitState: 'SLS_CHARACTERISTIC',
      standardClause: 'IS 456:2000 Table 18 (Serviceability)',
      factors: { DL: 1.0, SDL: 1.0, LL: 1.0 },
    },
  ];

  if (inputs.seismic?.enabled) {
    for (const [eqId, sign, suffix] of [
      ['EQX', 1, 'PLUS_EQX'],
      ['EQX', -1, 'MINUS_EQX'],
      ['EQY', 1, 'PLUS_EQY'],
      ['EQY', -1, 'MINUS_EQY'],
    ] as const) {
      const signSym = sign > 0 ? '+' : '-';
      combinations.push(
        {
          id: `ULS_12_DL_LL_${suffix}`,
          name: `1.2(DL + SDL + LL ${signSym} ${eqId})`,
          limitState: 'ULS',
          standardClause: 'IS 1893 (Part 1): 2016 Cl. 6.3.1.2',
          factors: { DL: 1.2, SDL: 1.2, LL: 1.2, [eqId]: 1.2 * sign },
        },
        {
          id: `ULS_15_DL_${suffix}`,
          name: `1.5(DL + SDL ${signSym} ${eqId})`,
          limitState: 'ULS',
          standardClause: 'IS 1893 (Part 1): 2016 Cl. 6.3.1.2',
          factors: { DL: 1.5, SDL: 1.5, [eqId]: 1.5 * sign },
        },
        {
          id: `ULS_09_DL_15_${suffix}`,
          name: `0.9(DL + SDL) ${signSym} 1.5 ${eqId}`,
          limitState: 'ULS',
          standardClause: 'IS 1893 (Part 1): 2016 Cl. 6.3.1.2 (Overturning/Uplift)',
          factors: { DL: 0.9, SDL: 0.9, [eqId]: 1.5 * sign },
        },
        {
          id: `SLS_10_DL_08_LL_08_${suffix}`,
          name: `1.0(DL + SDL) + 0.8 LL ${signSym} 0.8 ${eqId}`,
          limitState: 'SLS_CHARACTERISTIC',
          standardClause: 'IS 456:2000 Table 18 (Serviceability Lateral)',
          factors: { DL: 1.0, SDL: 1.0, LL: 0.8, [eqId]: 0.8 * sign },
        },
      );
    }
  }

  if (inputs.wind?.enabled) {
    for (const [wlId, sign, suffix] of [
      ['WLX', 1, 'PLUS_WLX'],
      ['WLX', -1, 'MINUS_WLX'],
      ['WLY', 1, 'PLUS_WLY'],
      ['WLY', -1, 'MINUS_WLY'],
    ] as const) {
      const signSym = sign > 0 ? '+' : '-';
      combinations.push(
        {
          id: `ULS_12_DL_LL_${suffix}`,
          name: `1.2(DL + SDL + LL ${signSym} ${wlId})`,
          limitState: 'ULS',
          standardClause: 'IS 456:2000 Table 18',
          factors: { DL: 1.2, SDL: 1.2, LL: 1.2, [wlId]: 1.2 * sign },
        },
        {
          id: `ULS_15_DL_${suffix}`,
          name: `1.5(DL + SDL ${signSym} ${wlId})`,
          limitState: 'ULS',
          standardClause: 'IS 456:2000 Table 18',
          factors: { DL: 1.5, SDL: 1.5, [wlId]: 1.5 * sign },
        },
        {
          id: `SLS_10_DL_08_LL_08_${suffix}`,
          name: `1.0(DL + SDL) + 0.8 LL ${signSym} 0.8 ${wlId}`,
          limitState: 'SLS_CHARACTERISTIC',
          standardClause: 'IS 456:2000 Table 18 (Serviceability Wind)',
          factors: { DL: 1.0, SDL: 1.0, LL: 0.8, [wlId]: 0.8 * sign },
        },
      );
    }
  }

  const totalDeadPlusSdlKn =
    memberSelfWeightKn +
    slabSelfWeightKn +
    floorFinishLoadKn +
    masonryWallLoadKn +
    staircaseDeadLoadKn +
    waterTankLoadKn;

  return {
    analyticalModel: {
      modelId: system.systemId,
      sourceBuildingId: system.buildingId,
      sourceRevision: system.sourceArchitecturalRevision,
      sourceArchitecturalSha256: system.sourceArchitecturalSha256,
      nodes: system.nodes,
      elements: system.elements,
      loadCases,
      combinations,
    },
    loadTakeoff: {
      slabLoadPaths,
      slabLoadPathAudit: {
        verifiedOneWayOppositeEdges: verifiedOneWay,
        verifiedTwoWayYieldLineIs456: verifiedTwoWay,
        verifiedCantileverRootEdge: [],
        unverifiedPreliminaryFallback: [],
        missingSupport: slabLoadPaths.missingSupport,
        meshedShellSkipped,
      },
      loadSourceAudit,
      unassignedGravityKnByCase: unassignedGravity,
      memberSelfWeightKn,
      slabSelfWeightKn,
      floorFinishLoadKn,
      masonryWallLoadKn,
      staircaseDeadLoadKn,
      waterTankLoadKn,
      totalDeadPlusSdlKn,
      totalOccupancyLiveKn,
      totalRoofLiveKn,
      seismicSummary,
      windBaseShearXKn,
      windBaseShearYKn,
    },
  };
}
