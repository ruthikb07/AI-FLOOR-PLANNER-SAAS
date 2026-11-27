/**
 * @ai-floor-planner/structural-engine â€” SectionCapacityProvider & Concrete Properties Adapter (Carbon 4 Section 03 & 05)
 *
 * Provides:
 * 1. Exact 2D perimeter bar coordinate generator (`buildColumnPerimeterBarCoordinates`) with ZERO corner
 *    double-counting, explicit per-face counts, clear spacing, and maximum c/c pitch!
 * 2. Batched `ConcreteProperties` (`v0.8.0`) fiber section evaluator using IS 456:2000 parabolic-rectangular
 *    concrete (`0.447 * fck`, zero tension) + IS 1786 / SP-16 HYSD steel (`0.87 * fy`) without double-applying
 *    partial safety factors or foreign AS3600/EC2 defaults.
 * 3. Direct side-by-side comparison helper against RH Planner's embedded analytical IS 456 integrator!
 */

import {
  CONCRETE_FCK_MPA,
  STEEL_FY_MPA,
  type ConcreteGrade,
  type SteelGrade,
} from '../assembly/canonical-frame-assembler.js';
import { evaluateColumnUniaxialMomentCapacity } from './rcc-design-engine.js';
import {
  getSharedPythonStructuralWorker,
  getSectionPythonStructuralWorkers,
  type PythonStructuralWorkerClient,
  type PythonWorkerResponseBase,
} from '../worker/python-structural-client.js';

// Fiber contour evaluation is CPU-bound. Keep individual calls small enough
// to make progress on shared hosts while preserving the requested contour.
const MAX_SECTION_RPC_DEMANDS = 4;
const MAX_SECTION_RPC_ITEMS = 8;

export interface ExplicitBarCoordinateMm {
  readonly barIndex: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly diaMm: number;
  readonly areaMm2: number;
  readonly locationRole: 'CORNER' | 'TOP_FACE' | 'BOTTOM_FACE' | 'LEFT_FACE' | 'RIGHT_FACE';
}

export interface ColumnPerimeterBarLayout {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearCoverMm: number;
  readonly tieDiaMm: number;
  readonly barDiaMm: number;
  /** Unique physical bar count around the perimeter (corners counted ONCE!). */
  readonly uniqueBarCount: number;
  readonly cornerBarCount: 4;
  /** Total bars along each horizontal width face (`x` in `[0, widthMm]`), INCLUDING the 2 corners on that face. */
  readonly barsPerWidthFaceIncludingCorners: number;
  /** Intermediate (non-corner) bars on each horizontal width face. */
  readonly intermediateBarsPerWidthFace: number;
  /** Total bars along each vertical depth face (`y` in `[0, depthMm]`), INCLUDING the 2 corners on that face. */
  readonly barsPerDepthFaceIncludingCorners: number;
  /** Intermediate (non-corner) bars on each vertical depth face. */
  readonly intermediateBarsPerDepthFace: number;
  readonly totalSteelAreaMm2: number;
  readonly minClearSpacingMm: number;
  readonly maxCenterPitchMm: number;
  readonly maxUnrestrainedSpacingMm: number;
  readonly spacingCompliantIS456: boolean;
  readonly bars: readonly ExplicitBarCoordinateMm[];
}

/**
 * Generates exact 2D `(xMm, yMm)` bar coordinates on `[0, widthMm] x [0, depthMm]` matching
 * RH Planner's symmetric perimeter optimization, with zero corner double-counting!
 * Note:
 * - `x` runs across `widthMm` (`b`)
 * - `y` runs across `depthMm` (`D`)
 * - Bending `Mux` (about horizontal X-axis) varies `y` across `depthMm` (`D`)
 * - Bending `Muy` (about vertical Y-axis) varies `x` across `widthMm` (`b`)
 */
export function buildColumnPerimeterBarCoordinates(params: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearCoverMm?: number;
  readonly tieDiaMm?: number;
  readonly barDiaMm: number;
  readonly totalBarCount: number;
}): ColumnPerimeterBarLayout {
  const b = params.widthMm;
  const d = params.depthMm;
  const clearCover = params.clearCoverMm ?? 40;
  const tieDia = params.tieDiaMm ?? (params.barDiaMm > 24 ? 10 : 8);
  const dia = params.barDiaMm;
  const count = Math.max(4, Math.floor(params.totalBarCount / 2) * 2); // symmetric even count >= 4
  const areaOne = (Math.PI * dia * dia) / 4;

  const centerOffset = clearCover + tieDia + dia / 2;
  const innerB = Math.max(20, b - 2 * centerOffset);
  const innerD = Math.max(20, d - 2 * centerOffset);

  const extraPairs = Math.max(0, Math.floor((count - 4) / 2));
  let interDepth = 0;
  let smallestPitch = Infinity;
  for (let n = 0; n <= extraPairs; n++) {
    const pitch = Math.max(innerB / (extraPairs - n + 1), innerD / (n + 1));
    if (pitch < smallestPitch || (pitch === smallestPitch && d > b)) {
      smallestPitch = pitch;
      interDepth = n;
    }
  }
  const interWidth = extraPairs - interDepth;

  const xLeft = centerOffset;
  const xRight = b - centerOffset;
  const yBot = centerOffset;
  const yTop = d - centerOffset;

  const bars: ExplicitBarCoordinateMm[] = [
    { barIndex: 0, xMm: Number(xLeft.toFixed(2)), yMm: Number(yBot.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
    { barIndex: 1, xMm: Number(xRight.toFixed(2)), yMm: Number(yBot.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
    { barIndex: 2, xMm: Number(xRight.toFixed(2)), yMm: Number(yTop.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
    { barIndex: 3, xMm: Number(xLeft.toFixed(2)), yMm: Number(yTop.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
  ];

  for (let i = 1; i <= interWidth; i++) {
    const x = xLeft + (innerB * i) / (interWidth + 1);
    bars.push({
      barIndex: bars.length,
      xMm: Number(x.toFixed(2)),
      yMm: Number(yBot.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'BOTTOM_FACE',
    });
    bars.push({
      barIndex: bars.length,
      xMm: Number(x.toFixed(2)),
      yMm: Number(yTop.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'TOP_FACE',
    });
  }

  for (let j = 1; j <= interDepth; j++) {
    const y = yBot + (innerD * j) / (interDepth + 1);
    bars.push({
      barIndex: bars.length,
      xMm: Number(xLeft.toFixed(2)),
      yMm: Number(y.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'LEFT_FACE',
    });
    bars.push({
      barIndex: bars.length,
      xMm: Number(xRight.toFixed(2)),
      yMm: Number(y.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'RIGHT_FACE',
    });
  }

  const pitchWidth = innerB / (interWidth + 1);
  const pitchDepth = innerD / (interDepth + 1);
  const minPitch = Math.min(pitchWidth, pitchDepth);
  const maxPitch = Math.max(pitchWidth, pitchDepth);
  const minClear = minPitch - dia;
  // IS 456 Cl. 26.5.3.1(g): max c/c spacing along perimeter <= 300 mm; min clear spacing >= max(dia, 40mm aggregate+5 or 35mm)
  const spacingCompliant = minClear >= Math.max(dia, 35) && maxPitch <= 300.5;

  return {
    widthMm: b,
    depthMm: d,
    clearCoverMm: clearCover,
    tieDiaMm: tieDia,
    barDiaMm: dia,
    uniqueBarCount: bars.length,
    cornerBarCount: 4,
    barsPerWidthFaceIncludingCorners: interWidth + 2,
    intermediateBarsPerWidthFace: interWidth,
    barsPerDepthFaceIncludingCorners: interDepth + 2,
    intermediateBarsPerDepthFace: interDepth,
    totalSteelAreaMm2: Number((bars.length * areaOne).toFixed(2)),
    minClearSpacingMm: Number(minClear.toFixed(2)),
    maxCenterPitchMm: Number(maxPitch.toFixed(2)),
    maxUnrestrainedSpacingMm: Number(maxPitch.toFixed(2)),
    spacingCompliantIS456: spacingCompliant,
    bars,
  };
}

export interface ConcretePropertiesDemandRequest {
  readonly id: string;
  readonly puKn: number;
  readonly muxKnM: number;
  readonly muyKnM: number;
  readonly enforceIs456AxialCap?: boolean;
  readonly includeContour?: boolean;
  readonly biaxialPoints?: number;
}

export interface ConcretePropertiesSectionBatchItem {
  readonly sectionId: string;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly polygonMm?: readonly (readonly [number, number])[];
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly bars: readonly { readonly xMm: number; readonly yMm: number; readonly areaMm2: number }[];
  readonly includeInteractionCurves?: boolean;
  readonly includeMomentCurvature?: boolean;
  readonly momentCurvatureAxialKn?: number;
  readonly demands: readonly ConcretePropertiesDemandRequest[];
}

export interface ConcretePropertiesDemandEvaluation {
  readonly id: string;
  readonly puKn: number;
  readonly muxDemandKnM: number;
  readonly muyDemandKnM: number;
  readonly outsideAxialDomain: boolean;
  readonly mux1CapacityKnM: number;
  readonly muy1CapacityKnM: number;
  readonly rayCapacityMuxKnM: number;
  readonly rayCapacityMuyKnM: number;
  readonly utilizationRatio: number;
  readonly pointInsideDiagram: boolean;
  readonly biaxialContourKnM?: readonly { readonly mxKnM: number; readonly myKnM: number }[];
  readonly uncappedForensic?: {
    readonly mux1UncappedKnM: number;
    readonly muy1UncappedKnM: number;
    readonly rayCapacityMuxKnM: number;
    readonly rayCapacityMuyKnM: number;
    readonly rayUtilizationUncapped: number;
  } | null;
}

export interface ConcretePropertiesSectionResult {
  readonly sectionId: string;
  readonly grossProperties: {
    readonly totalAreaMm2: number;
    readonly concreteAreaMm2: number;
    readonly reinfLumpedAreaMm2: number;
    readonly inputBarAreaSumMm2: number;
    readonly centroidMm: readonly [number, number];
    readonly axialRigidityN: number;
    readonly flexuralRigidityEIxxNmm2: number;
    readonly flexuralRigidityEIyyNmm2: number;
  };
  readonly axialLimits: {
    readonly puzIs456Kn: number;
    readonly puMaxIs456Cl39_1bKn: number;
    readonly concretePropertiesUncappedMaxKn: number;
    readonly ptMinTensionKn: number;
  };
  readonly interactionCurveX?: readonly { readonly puKn: number; readonly muxKnM: number }[] | null;
  readonly interactionCurveY?: readonly { readonly puKn: number; readonly muyKnM: number }[] | null;
  readonly momentCurvature?: {
    readonly axialKn: number;
    readonly kappa1PerMm: readonly number[];
    readonly momentKnM: readonly number[];
    readonly failureGeometry: string | null;
  } | null;
  readonly demandEvaluations: readonly ConcretePropertiesDemandEvaluation[];
}

interface SectionBatchRpcResponse extends PythonWorkerResponseBase {
  readonly results?: readonly ConcretePropertiesSectionResult[];
  readonly durationMs?: number;
}

export async function evaluateSectionsWithConcreteProperties(
  items: readonly ConcretePropertiesSectionBatchItem[],
  worker?: PythonStructuralWorkerClient,
  signal?: AbortSignal,
): Promise<{
  readonly results: readonly ConcretePropertiesSectionResult[];
  readonly durationMs: number;
}> {
  const rpcItems = items.map((it) => ({
    sectionId: it.sectionId,
    widthMm: it.widthMm,
    depthMm: it.depthMm,
    polygonMm: it.polygonMm,
    fckMPa: CONCRETE_FCK_MPA[it.concreteGrade],
    fyMPa: STEEL_FY_MPA[it.steelGrade],
    bars: it.bars,
    includeInteractionCurves: it.includeInteractionCurves ?? false,
    includeMomentCurvature: it.includeMomentCurvature ?? false,
    momentCurvatureAxialKn: it.momentCurvatureAxialKn ?? 0,
    demands: it.demands,
  }));

  const started = performance.now();
  const demandCount = rpcItems.reduce((sum, item) => sum + item.demands.length, 0);
  if (rpcItems.length > 512 || demandCount > 1024) throw new Error('ConcreteProperties evaluation exceeds the section or demand limit.');
  const clients = !worker && demandCount >= 16 && rpcItems.length >= 3
    ? getSectionPythonStructuralWorkers() : [worker ?? getSharedPythonStructuralWorker()];
  const batches = clients.map(client => ({ client, indices: [] as number[], estimatedCost: 0 }));
  const order = rpcItems.map((item, index) => ({ index, cost: (1 + item.bars.length + (item.polygonMm?.length ?? 4)) * (1 + item.demands.reduce(
    (sum, demand) => sum + (demand.biaxialPoints ?? (demand.includeContour ? 36 : 20)), 0,
  )) })).sort((a, b) => b.cost - a.cost);
  for (const { index, cost } of order) {
    const batch = batches.reduce((best, candidate) => candidate.estimatedCost < best.estimatedCost ? candidate : best);
    batch.indices.push(index);
    batch.estimatedCost += cost;
  }

  const cancel = new AbortController();
  const batchSignal = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal;
  const results: ConcretePropertiesSectionResult[] = new Array(items.length);
  try {
    await Promise.all(batches.map(async ({ client, indices }) => {
      const requests: { index: number; item: (typeof rpcItems)[number] }[][] = [];
      let pending: (typeof requests)[number] = [];
      let pendingDemands = 0;
      for (const index of indices) {
        const item = rpcItems[index]!;
        for (let offset = 0; offset < Math.max(1, item.demands.length); offset += MAX_SECTION_RPC_DEMANDS) {
          const demands = item.demands.slice(offset, offset + MAX_SECTION_RPC_DEMANDS);
          if (pendingDemands + demands.length > MAX_SECTION_RPC_DEMANDS || pending.length === MAX_SECTION_RPC_ITEMS) {
            requests.push(pending);
            pending = [];
            pendingDemands = 0;
          }
          pending.push({ index, item: { ...item, demands,
            includeInteractionCurves: offset === 0 && item.includeInteractionCurves,
            includeMomentCurvature: offset === 0 && item.includeMomentCurvature } });
          pendingDemands += demands.length;
        }
      }
      if (pending.length) requests.push(pending);
      for (const request of requests) {
        const response = await client.request<SectionBatchRpcResponse>({
          action: 'section_capacity_batch', items: request.map(entry => entry.item),
        }, 300_000, batchSignal);
        if (!response.ok || !response.results || response.results.length !== request.length) {
          throw new Error(`ConcreteProperties section evaluation failed (${response.errorCode ?? 'ERROR'}): ${response.message ?? 'Incomplete batch response.'}`);
        }
        response.results.forEach((result, i) => {
          const { index, item } = request[i]!;
          if (result.sectionId !== item.sectionId || result.demandEvaluations.length !== item.demands.length ||
              result.demandEvaluations.some((demand, j) => demand.id !== item.demands[j]!.id)) {
            throw new Error('ConcreteProperties returned inconsistent section or demand identifiers.');
          }
          const previous = results[index];
          results[index] = previous ? { ...previous,
            demandEvaluations: [...previous.demandEvaluations, ...result.demandEvaluations] } : result;
        });
      }
    }));
  } catch (error) {
    cancel.abort();
    throw error;
  }
  return { results, durationMs: performance.now() - started };
}

/**
 * Compares RH Planner's analytical IS 456 integrator against ConcreteProperties fiber integration
 * at identical bar coordinates, dimensions, concrete/steel grades, and `(Pu, Mux, Muy)` demands.
 */
export async function compareColumnSectionProviders(params: {
  readonly sectionId: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearCoverMm?: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly barDiaMm: number;
  readonly totalBarCount: number;
  readonly demandPuKn: number;
  readonly demandMuxKnM: number;
  readonly demandMuyKnM: number;
  readonly includeContour?: boolean;
}) {
  const layout = buildColumnPerimeterBarCoordinates({
    widthMm: params.widthMm,
    depthMm: params.depthMm,
    clearCoverMm: params.clearCoverMm ?? 40,
    barDiaMm: params.barDiaMm,
    totalBarCount: params.totalBarCount,
  });

  const analyticalX = evaluateColumnUniaxialMomentCapacity({
    widthPerpMm: params.widthMm,
    depthBendingMm: params.depthMm,
    clearCoverMm: layout.clearCoverMm,
    concreteGrade: params.concreteGrade,
    steelGrade: params.steelGrade,
    totalBarCount: layout.uniqueBarCount,
    barDiaMm: layout.barDiaMm,
    tieDiaMm: layout.tieDiaMm,
    demandPuKn: params.demandPuKn,
  });

  const analyticalY = evaluateColumnUniaxialMomentCapacity({
    widthPerpMm: params.depthMm,
    depthBendingMm: params.widthMm,
    transposeSquareLayout: params.depthMm === params.widthMm,
    clearCoverMm: layout.clearCoverMm,
    concreteGrade: params.concreteGrade,
    steelGrade: params.steelGrade,
    totalBarCount: layout.uniqueBarCount,
    barDiaMm: layout.barDiaMm,
    tieDiaMm: layout.tieDiaMm,
    demandPuKn: params.demandPuKn,
  });

  const alphaN =
    params.demandPuKn <= 0
      ? 1
      : Math.max(1, Math.min(2, 1 + (params.demandPuKn / analyticalX.puzKn - 0.2) / 0.6));
  const breslerRatio =
    analyticalX.mu1CapacityKnM <= 0 || analyticalY.mu1CapacityKnM <= 0
      ? params.demandPuKn / analyticalX.puMaxDesignKn
      : Math.pow(Math.abs(params.demandMuxKnM) / analyticalX.mu1CapacityKnM, alphaN) +
        Math.pow(Math.abs(params.demandMuyKnM) / analyticalY.mu1CapacityKnM, alphaN);

  const cpBatch = await evaluateSectionsWithConcreteProperties([
    {
      sectionId: params.sectionId,
      widthMm: params.widthMm,
      depthMm: params.depthMm,
      concreteGrade: params.concreteGrade,
      steelGrade: params.steelGrade,
      bars: layout.bars.map((b) => ({ xMm: b.xMm, yMm: b.yMm, areaMm2: b.areaMm2 })),
      includeInteractionCurves: true,
      demands: [
        {
          id: 'IS456_CAPPED',
          puKn: params.demandPuKn,
          muxKnM: params.demandMuxKnM,
          muyKnM: params.demandMuyKnM,
          enforceIs456AxialCap: true,
          includeContour: params.includeContour ?? true,
        },
        {
          id: 'CP_UNCAPPED',
          puKn: params.demandPuKn,
          muxKnM: params.demandMuxKnM,
          muyKnM: params.demandMuyKnM,
          enforceIs456AxialCap: false,
          includeContour: params.includeContour ?? true,
        },
      ],
    },
  ]);

  const cpSec = cpBatch.results[0]!;
  return {
    layout,
    rhAnalyticalIs456: {
      puzKn: analyticalX.puzKn,
      puMaxDesignKn: analyticalX.puMaxDesignKn,
      mux1KnM: analyticalX.mu1CapacityKnM,
      muy1KnM: analyticalY.mu1CapacityKnM,
      breslerAlphaN: alphaN,
      breslerInteractionRatio: breslerRatio,
    },
    concretePropertiesIs456: cpSec.demandEvaluations[0]!,
    concretePropertiesUncappedForensic: cpSec.demandEvaluations[1]!,
    grossProperties: cpSec.grossProperties,
    axialLimits: cpSec.axialLimits,
  };
}
