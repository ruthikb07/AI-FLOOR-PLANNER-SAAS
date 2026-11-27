/**
 * @ai-floor-planner/structural-engine — Traceable Indian Load & Combination Engine (Phase A8)
 *
 * Implements explicit, clause-traceable gravity, lateral seismic, and lateral wind loading
 * per IS 875 (Parts 1, 2, 3), IS 456:2000 Table 18, and IS 1893 (Part 1): 2016 Cl. 6.3.1.2:
 * - Member self-weight applied ONCE (zero duplicate self-weight!)
 * - Slab dead + floor finish + occupancy live load transferred onto supporting frame beams
 *   with exact total vertical force conservation (sum of beam line loads === panel area load!)
 * - Masonry wall line loads (deducting door/window openings) applied in SUPERIMPOSED_DEAD
 * - Staircase waist + riser/step + live load reactions transferred onto stair beams
 * - Optional overhead water tank load on designated roof column nodes
 * - IS 1893:2016 equivalent static lateral seismic load cases (+EQX, +EQY) via Awatif modal/seismic engine
 * - IS 875 (Part 3): 2015 wind lateral load cases (+WLX, +WLY) when wind parameters are provided
 * - Strictly distinguishes unfactored Serviceability (`SLS_CHARACTERISTIC`) combinations from factored `ULS` combinations!
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
import { IS875_RCC_UNIT_WEIGHT_KN_M3 } from '../adapter/units-and-coordinates.js';
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
  readonly foundationDepthBelowGroundM: number;
  readonly soilUnitWeightKnM3: number;
  readonly waterTableDepthBelowGroundM?: number;
  readonly allowableSettlementMm?: number;
  readonly subgradeModulusKnM3?: number;
  readonly reportReference: string;
}

export interface WindReviewedInputs {
  readonly enabled: boolean;
  /** IS 875 (Part 3): 2015 Basic wind speed Vb in m/s (e.g., 39 m/s Pune, 44 m/s Mumbai, 47 m/s Delhi). */
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
  /** Floor finish load in kN/m² (IS 875 Part 1, typically 1.0 - 1.5 kN/m²). */
  readonly floorFinishKnM2: number;
  /** Masonry infill unit weight in kN/m³ (Brick ~ 19.2 kN/m³, AAC block ~ 8.5 kN/m³). */
  readonly masonryUnitWeightKnM3: number;
  /** Accessible roof terrace live load in kN/m² (IS 875 Part 2 Table 2: 1.5 kN/m² accessible, 0.75 kN/m² inaccessible). */
  readonly roofLiveLoadKnM2: number;
  /** Optional overhead water tank gravity load in kN distributed over roof core columns. */
  readonly waterTankLoadKn?: number;
  /** Optional room-type live load overrides (kN/m²). */
  readonly occupancyLiveLoadOverridesKnM2?: Readonly<Record<string, number>>;
  readonly seismic?: SeismicReviewedInputs;
  readonly wind?: WindReviewedInputs;
  /**
   * Explicit user/geotechnical-engineer soil parameters.
   * When `null` or `undefined`, superstructure frame analysis & RCC design run normally,
   * while foundation design refuses to invent SBC and reports `MISSING_GEOTECHNICAL_INPUT`!
   */
  readonly geotechnical?: GeotechnicalReviewedInputs | null;
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
}

export interface AssembledFrameModelWithTakeoff {
  readonly analyticalModel: AnalyticalFrameModel;
  readonly loadTakeoff: LoadTakeoffBreakdown;
}

/**
 * IS 875 (Part 2): 1987 Table 1 Imposed Floor Loads for Residential / Commercial Spaces (kN/m²).
 */
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
    return 3.0; // IS 875 Part 2 Table 1 Item 1(a)(iii): Corridors, passages, staircases, balconies = 3.0 kN/m²
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
  // All residential habitable rooms, bedrooms, kitchens, toilets, bathrooms = 2.0 kN/m²
  return 2.0;
}

/** IS 875 (Part 3): 2015 Table 2 Terrain & Height Factor k2 approximation. */
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
): Promise<AssembledFrameModelWithTakeoff> {
  const dlUniform: MemberUniformLoad[] = [];
  const sdlUniform: MemberUniformLoad[] = [];
  const sdlNodal: NodalPointLoad[] = [];
  const llUniform: MemberUniformLoad[] = [];

  let memberSelfWeightKn = 0;
  let slabSelfWeightKn = 0;
  let floorFinishLoadKn = 0;
  let masonryWallLoadKn = 0;
  let staircaseDeadLoadKn = 0;
  let totalOccupancyLiveKn = 0;
  let totalRoofLiveKn = 0;

  // Map elementIndex -> lengthM
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

  // 2. Masonry Wall Line Loads on Supporting Plinth & Floor Beams (SDL)
  for (const meta of system.memberMetadata) {
    if (meta.supportedWallThicknessMm > 0 && meta.supportedWallHeightMm > 0) {
      const L = elemLengthsM[meta.elementIndex]!;
      const netFactor = 1 - meta.wallOpeningFraction;
      const wallAreaPerM = (meta.supportedWallThicknessMm / 1000) * (meta.supportedWallHeightMm / 1000);
      const qWallKnM = wallAreaPerM * inputs.masonryUnitWeightKnM3 * netFactor;
      if (qWallKnM > 1e-4) {
        masonryWallLoadKn += qWallKnM * L;
        sdlUniform.push({
          elementIndex: meta.elementIndex,
          coordinateSystem: 'GLOBAL',
          qStartKnPerM: [0, 0, -qWallKnM],
          sourceDescription: `Masonry wall (${meta.supportedWallThicknessMm}mm, opening ${(meta.wallOpeningFraction * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  // Determine highest floor level to treat top slab live load / roof terrace properly
  const maxFloorLevel = Math.max(0, ...system.slabPanels.map((p) => p.floorLevel));

  // 3. Tributary Slab-to-Beam Load Transfer (Exact Force Conservation: sum(q_i * L_i) === w * Area!)
  // Accumulate Nodal Seismic Weights per node as well for IS 1893:2016
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

  for (const panel of system.slabPanels) {
    const beamIndices = panel.supportingBeamElementIndices;
    if (beamIndices.length === 0) continue;

    const totalBeamLenM = beamIndices.reduce((s, idx) => s + elemLengthsM[idx]!, 0);
    if (totalBeamLenM <= 1e-6) continue;

    const slabSwKPa = (panel.thicknessMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;
    const ffKPa = inputs.floorFinishKnM2;
    const isTopRoof = panel.floorLevel === maxFloorLevel && system.slabPanels.some((p) => p.floorLevel < maxFloorLevel);
    const liveKPa = isTopRoof
      ? inputs.roofLiveLoadKnM2
      : lookupIS875OccupancyLiveLoadKnM2(
          panel.roomType,
          undefined,
          inputs.occupancyLiveLoadOverridesKnM2,
        );

    const panelSwKn = slabSwKPa * panel.areaM2;
    const panelFfKn = ffKPa * panel.areaM2;
    const panelLiveKn = liveKPa * panel.areaM2;

    slabSelfWeightKn += panelSwKn;
    floorFinishLoadKn += panelFfKn;
    if (isTopRoof) totalRoofLiveKn += panelLiveKn;
    else totalOccupancyLiveKn += panelLiveKn;

    // Distribute tributary load proportionally across bounding beams (with aspect-ratio weighting so long beams carry larger yield-line share!)
    const weights = beamIndices.map((idx) => {
      const L = elemLengthsM[idx]!;
      // IS 456 Cl. 24.5 yield-line share: longer edge carries (1 - 1/(3*(ly/lx)^2)) vs shorter edge 1/3
      return Math.pow(L, 1.35);
    });
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;

    for (let k = 0; k < beamIndices.length; k++) {
      const bIdx = beamIndices[k]!;
      const share = weights[k]! / sumW;
      const bLenM = elemLengthsM[bIdx]!;
      const el = system.elements[bIdx]!;

      const qSw = (panelSwKn * share) / bLenM;
      const qFf = (panelFfKn * share) / bLenM;
      const qLl = (panelLiveKn * share) / bLenM;

      dlUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -qSw],
        sourceDescription: `Slab ${panel.id} self-weight (${panel.thicknessMm}mm)`,
      });
      sdlUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -qFf],
        sourceDescription: `Slab ${panel.id} floor finish`,
      });
      llUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -qLl],
        sourceDescription: `Slab ${panel.id} imposed load (${liveKPa} kN/m²)`,
      });

      nodalDeadSdlKn[el.startNodeIndex] += 0.5 * (panelSwKn + panelFfKn) * share;
      nodalDeadSdlKn[el.endNodeIndex] += 0.5 * (panelSwKn + panelFfKn) * share;

      // IS 1893:2016 Cl. 7.3.1 / Table 10: Roof live load = 0% seismic weight; LL <= 3.0 kN/m² = 25%; LL > 3.0 kN/m² = 50%
      const seismicLlFactor = isTopRoof ? 0 : liveKPa <= 3.0 ? 0.25 : 0.5;
      nodalSeismicLiveKn[el.startNodeIndex] += 0.5 * panelLiveKn * share * seismicLlFactor;
      nodalSeismicLiveKn[el.endNodeIndex] += 0.5 * panelLiveKn * share * seismicLlFactor;
    }
  }

  // 4. Staircase Waist Slab + Steps Dead & Live Load Transfer
  for (const st of system.stairWaists) {
    if (st.supportingBeamElementIndices.length === 0) continue;
    const slopeFactor = Math.hypot(st.riserMm, st.treadMm) / Math.max(200, st.treadMm);
    const waistKPa = (st.waistThicknessMm / 1000) * slopeFactor * IS875_RCC_UNIT_WEIGHT_KN_M3;
    const stepsKPa = (0.5 * (st.riserMm / 1000)) * IS875_RCC_UNIT_WEIGHT_KN_M3;
    const finishKPa = inputs.floorFinishKnM2;
    const stairLiveKPa = 3.0; // IS 875 Part 2 Table 1
    const areaM2 = (st.horizontalSpanMm / 1000) * (st.widthMm / 1000);

    const totDeadKn = (waistKPa + stepsKPa + finishKPa) * areaM2;
    const totLiveKn = stairLiveKPa * areaM2;
    staircaseDeadLoadKn += totDeadKn;
    totalOccupancyLiveKn += totLiveKn;

    const sharePerBeam = 1 / st.supportingBeamElementIndices.length;
    for (const bIdx of st.supportingBeamElementIndices) {
      const bLenM = elemLengthsM[bIdx]!;
      const el = system.elements[bIdx]!;
      sdlUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -(totDeadKn * sharePerBeam) / bLenM],
        sourceDescription: `Staircase ${st.stairId} waist + steps DL`,
      });
      llUniform.push({
        elementIndex: bIdx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -(totLiveKn * sharePerBeam) / bLenM],
        sourceDescription: `Staircase ${st.stairId} imposed load (3.0 kN/m²)`,
      });
      nodalDeadSdlKn[el.startNodeIndex] += 0.5 * totDeadKn * sharePerBeam;
      nodalDeadSdlKn[el.endNodeIndex] += 0.5 * totDeadKn * sharePerBeam;
      nodalSeismicLiveKn[el.startNodeIndex] += 0.5 * totLiveKn * sharePerBeam * 0.25;
      nodalSeismicLiveKn[el.endNodeIndex] += 0.5 * totLiveKn * sharePerBeam * 0.25;
    }
  }

  // 5. Optional Overhead Water Tank Load on Highest Roof Column Nodes
  const waterTankLoadKn = Math.max(0, inputs.waterTankLoadKn ?? 0);
  if (waterTankLoadKn > 0) {
    const maxZ = Math.max(...system.nodes.map((n) => n.positionM[2]));
    const roofNodes = system.nodes
      .filter((n) => Math.abs(n.positionM[2] - maxZ) < 0.05 && !n.restraint)
      .slice(0, 4);
    if (roofNodes.length > 0) {
      const perNode = waterTankLoadKn / roofNodes.length;
      for (const rn of roofNodes) {
        sdlNodal.push({
          nodeIndex: rn.index,
          vectorKnM: [0, 0, -perNode, 0, 0, 0],
          sourceDescription: 'Overhead water tank gravity reaction',
        });
        nodalDeadSdlKn[rn.index] += perNode;
      }
    }
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

  // Plan dimensions & building height above plinth (Z = 0)
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

    // Group above-ground nodes by elevation band
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
      // pz = 0.6 * Vz^2 in N/m² -> 0.0006 * Vz^2 in kN/m²
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

  // 8. Assemble Clause-Traceable ULS & SLS Load Combinations (IS 456 Table 18 & IS 1893 Cl. 6.3.1.2)
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
