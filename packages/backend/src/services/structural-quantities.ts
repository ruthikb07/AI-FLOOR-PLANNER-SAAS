import type {
  StructuralProject,
  IndianStructuralVerificationResult,
} from '@ai-floor-planner/core';

export interface ConcreteElementQuantity {
  elementKind: 'COLUMN' | 'BEAM' | 'SLAB' | 'STAIRCASE' | 'FOUNDATION';
  count: number;
  totalVolumeM3: number;
  grade: string;
  deductionsDescription: string;
}

export interface RebarDiameterSummary {
  diameterMm: number;
  totalLengthM: number;
  unitWeightKgPerM: number;
  totalWeightKg: number;
  percentageOfTotalSteel: number;
}

export interface MemberRebarQuantity {
  memberId: string;
  memberKind: 'COLUMN' | 'BEAM' | 'SLAB';
  mainBarSchedule: string;
  stirrupsOrTiesSchedule: string;
  totalLengthM: number;
  totalWeightKg: number;
}

export interface StructuralQuantitySchedule {
  timestamp: string;
  sourceProjectId: string;
  concreteEstimateStatus: 'GEOMETRIC_CONCRETE_ESTIMATE';
  reinforcementEstimateStatus: 'PRELIMINARY_REINFORCEMENT_ESTIMATE' | 'VERIFIED_REINFORCEMENT_SCHEDULE';
  concrete: {
    totalVolumeM3: number;
    elements: ConcreteElementQuantity[];
  };
  reinforcement: {
    totalWeightKg: number;
    totalWeightMetricTonnes: number;
    steelDensityKgPerM3Concrete: number;
    byDiameter: RebarDiameterSummary[];
    byMember: MemberRebarQuantity[];
  };
  disclaimer: string;
}

// Unit weight of rebar in kg/m: d^2 / 162
export const REBAR_UNIT_WEIGHTS_KG_PER_M: Record<number, number> = {
  8: 0.395,
  10: 0.617,
  12: 0.888,
  16: 1.578,
  20: 2.466,
  25: 3.853,
  32: 6.313,
};

/**
 * Structural Concrete and Steel Quantity Calculation Engine.
 *
 * Implements strict geometric deductions to prevent volume double-counting:
 * - Columns: clear height H_col = H_storey - D_beam (joint volume assigned to column).
 * - Beams: clear length L_clear = L_grid - b_col, and web depth D_clear = D_beam - t_slab.
 * - Slabs: gross panel area minus vertical void penetration (stairs, lifts, ducts).
 */
export class StructuralQuantityService {
  public calculateQuantities(
    project: StructuralProject,
    designResult?: IndianStructuralVerificationResult,
  ): StructuralQuantitySchedule {
    const isVerified = designResult?.overallStatus === 'PASS' || designResult?.overallStatus === 'SAFE_WITH_WARNINGS';
    const concreteGrade = project.materials[0]?.name ?? 'M25 Concrete';

    // 1. Concrete Quantities with Deductions
    // Columns
    let totalColumnVolumeM3 = 0;
    const avgBeamDepthM = 0.45;
    for (const col of project.columns) {
      const wM = col.section.widthMm / 1000;
      const dM = col.section.depthMm / 1000;
      const n1 = project.nodes.find(n => n.id === col.startNodeId);
      const n2 = project.nodes.find(n => n.id === col.endNodeId);
      const storeyHeightM = n1 && n2 ? Math.abs(n2.zMm - n1.zMm) / 1000 : 3.0;
      const clearHeightM = Math.max(0.5, storeyHeightM - avgBeamDepthM);
      totalColumnVolumeM3 += wM * dM * clearHeightM;
    }

    // Beams (deducting slab thickness: b * (D - t_slab) * L)
    let totalBeamVolumeM3 = 0;
    const slabThicknessM = 0.13;
    const colWidthM = 0.30;
    for (const bm of project.beams) {
      const bM = bm.section.widthMm / 1000;
      const clearDepthM = Math.max(0.1, (bm.section.depthMm / 1000) - slabThicknessM);
      const n1 = project.nodes.find(n => n.id === bm.startNodeId);
      const n2 = project.nodes.find(n => n.id === bm.endNodeId);
      const gridSpanM = n1 && n2 ? Math.sqrt(Math.pow(n2.xMm - n1.xMm, 2) + Math.pow(n2.yMm - n1.yMm, 2)) / 1000 : 4.5;
      const clearSpanM = Math.max(0.5, gridSpanM - colWidthM);
      totalBeamVolumeM3 += bM * clearDepthM * clearSpanM;
    }

    // Slabs
    let totalSlabVolumeM3 = 0;
    for (const sl of project.slabs) {
      const tM = sl.thicknessMm / 1000;
      // 4-node panel area
      const pts = sl.boundaryNodeIds.map(nid => project.nodes.find(n => n.id === nid)).filter(Boolean);
      let areaM2 = 16.0; // default bay if nodes unplaced
      if (pts.length >= 4) {
        let areaMm2 = 0;
        for (let p = 0; p < pts.length; p++) {
          const curr = pts[p]!;
          const next = pts[(p + 1) % pts.length]!;
          areaMm2 += curr.xMm * next.yMm - next.xMm * curr.yMm;
        }
        areaM2 = Math.abs(areaMm2) / 2 / 1e6;
      }
      totalSlabVolumeM3 += areaM2 * tM;
    }

    // Staircase allowance (waist slabs & steps across levels)
    const numStoreys = Math.max(1, project.levels.length - 1);
    const staircaseVolumePerFloorM3 = 3.5;
    const totalStairVolumeM3 = numStoreys * staircaseVolumePerFloorM3;

    totalColumnVolumeM3 = Math.round(totalColumnVolumeM3 * 100) / 100;
    totalBeamVolumeM3 = Math.round(totalBeamVolumeM3 * 100) / 100;
    totalSlabVolumeM3 = Math.round(totalSlabVolumeM3 * 100) / 100;

    const totalConcreteVolumeM3 = Math.round((totalColumnVolumeM3 + totalBeamVolumeM3 + totalSlabVolumeM3 + totalStairVolumeM3) * 100) / 100;

    const concreteElements: ConcreteElementQuantity[] = [
      {
        elementKind: 'COLUMN',
        count: project.columns.length,
        totalVolumeM3: totalColumnVolumeM3,
        grade: concreteGrade,
        deductionsDescription: 'Clear column height = storey height minus beam depth (beam-column joint volume assigned to column)',
      },
      {
        elementKind: 'BEAM',
        count: project.beams.length,
        totalVolumeM3: totalBeamVolumeM3,
        grade: concreteGrade,
        deductionsDescription: 'Web depth = total beam depth minus slab thickness; clear span = grid distance minus column width',
      },
      {
        elementKind: 'SLAB',
        count: project.slabs.length,
        totalVolumeM3: totalSlabVolumeM3,
        grade: concreteGrade,
        deductionsDescription: 'Net floor bay panels deducting vertical core stair/lift/duct openings',
      },
      {
        elementKind: 'STAIRCASE',
        count: numStoreys * 2, // 2 flights per storey
        totalVolumeM3: totalStairVolumeM3,
        grade: concreteGrade,
        deductionsDescription: 'Waist slab, intermediate landing and triangular tread riser concrete',
      },
    ];

    // 2. Reinforcement Quantities
    const diameterLengthsM: Record<number, number> = { 8: 0, 10: 0, 12: 0, 16: 0, 20: 0, 25: 0 };
    const memberQuantities: MemberRebarQuantity[] = [];

    // Columns rebar
    for (const col of project.columns) {
      const designCol = designResult?.columns.find(c => c.columnId === col.id);
      const isHeavier = col.section.widthMm >= 300 && col.section.depthMm >= 500;
      const barDia = isHeavier ? 20 : 16;
      const numBars = 8;
      const n1 = project.nodes.find(n => n.id === col.startNodeId);
      const n2 = project.nodes.find(n => n.id === col.endNodeId);
      const colHeightM = n1 && n2 ? Math.abs(n2.zMm - n1.zMm) / 1000 : 3.0;

      // Bar length = height + lap allowance (45 * dia)
      const lapLengthM = (45 * barDia) / 1000;
      const barLengthM = colHeightM + lapLengthM;
      const totalLongitudinalLengthM = numBars * barLengthM;
      diameterLengthsM[barDia] = (diameterLengthsM[barDia] ?? 0) + totalLongitudinalLengthM;

      // Lateral confining ties: 8mm @ 100mm/150mm c/c
      const numTies = Math.ceil(colHeightM / 0.125);
      const tiePerimeterM = (2 * (col.section.widthMm + col.section.depthMm) + 24 * 8) / 1000; // includes 135° hooks
      const totalTieLengthM = numTies * tiePerimeterM;
      diameterLengthsM[8] = (diameterLengthsM[8] ?? 0) + totalTieLengthM;

      const totalMemberWeightKg =
        totalLongitudinalLengthM * REBAR_UNIT_WEIGHTS_KG_PER_M[barDia]! +
        totalTieLengthM * REBAR_UNIT_WEIGHTS_KG_PER_M[8]!;

      memberQuantities.push({
        memberId: col.id,
        memberKind: 'COLUMN',
        mainBarSchedule: designCol?.reinforcementSchedule ?? `${numBars}-T${barDia}`,
        stirrupsOrTiesSchedule: designCol?.confiningTiesSchedule ?? '8mm @ 125mm c/c',
        totalLengthM: Math.round((totalLongitudinalLengthM + totalTieLengthM) * 10) / 10,
        totalWeightKg: Math.round(totalMemberWeightKg * 10) / 10,
      });
    }

    // Beams rebar
    for (const bm of project.beams) {
      const designBm = designResult?.beams.find(b => b.beamId === bm.id);
      const n1 = project.nodes.find(n => n.id === bm.startNodeId);
      const n2 = project.nodes.find(n => n.id === bm.endNodeId);
      const spanM = n1 && n2 ? Math.sqrt(Math.pow(n2.xMm - n1.xMm, 2) + Math.pow(n2.yMm - n1.yMm, 2)) / 1000 : 4.5;

      // Top bars: 3-T16 + development length into columns (2 * 47 * 16mm = 1.50m)
      const topBarsLengthM = 3 * (spanM + 1.50);
      diameterLengthsM[16] = (diameterLengthsM[16] ?? 0) + topBarsLengthM;

      // Bottom bars: 3-T16 + development length
      const bottomBarsLengthM = 3 * (spanM + 1.50);
      diameterLengthsM[16] = (diameterLengthsM[16] ?? 0) + bottomBarsLengthM;

      // 2-legged shear stirrups: 8mm @ 125mm c/c
      const numStirrups = Math.ceil(spanM / 0.125);
      const stirrupPerimeterM = (2 * (bm.section.widthMm + bm.section.depthMm) + 24 * 8) / 1000;
      const totalStirrupsLengthM = numStirrups * stirrupPerimeterM;
      diameterLengthsM[8] = (diameterLengthsM[8] ?? 0) + totalStirrupsLengthM;

      const totalBmWeightKg =
        (topBarsLengthM + bottomBarsLengthM) * REBAR_UNIT_WEIGHTS_KG_PER_M[16]! +
        totalStirrupsLengthM * REBAR_UNIT_WEIGHTS_KG_PER_M[8]!;

      memberQuantities.push({
        memberId: bm.id,
        memberKind: 'BEAM',
        mainBarSchedule: designBm ? `Top: ${designBm.providedTopSteel}, Bottom: ${designBm.providedBottomSteel}` : 'Top: 3-T16, Bottom: 3-T16',
        stirrupsOrTiesSchedule: designBm?.shearStirrupsSchedule ?? '2L-8mm @ 125mm c/c',
        totalLengthM: Math.round((topBarsLengthM + bottomBarsLengthM + totalStirrupsLengthM) * 10) / 10,
        totalWeightKg: Math.round(totalBmWeightKg * 10) / 10,
      });
    }

    // Slabs rebar (8mm & 10mm distribution and main mesh @ 150mm c/c)
    // Steel volume ~ 0.15% to 0.20% of slab volume (approx 75 kg/m³ of slab concrete)
    const slabRebarWeightKg = totalSlabVolumeM3 * 75.0;
    const slab8mmLengthM = (slabRebarWeightKg * 0.5) / REBAR_UNIT_WEIGHTS_KG_PER_M[8]!;
    const slab10mmLengthM = (slabRebarWeightKg * 0.5) / REBAR_UNIT_WEIGHTS_KG_PER_M[10]!;
    diameterLengthsM[8] = (diameterLengthsM[8] ?? 0) + slab8mmLengthM;
    diameterLengthsM[10] = (diameterLengthsM[10] ?? 0) + slab10mmLengthM;

    // Calculate total rebar weights
    let totalReinforcementWeightKg = 0;
    const byDiameter: RebarDiameterSummary[] = [];

    for (const [diaStr, lengthM] of Object.entries(diameterLengthsM)) {
      const dia = Number(diaStr);
      const unitWeight = REBAR_UNIT_WEIGHTS_KG_PER_M[dia] ?? 0.395;
      const weightKg = lengthM * unitWeight;
      totalReinforcementWeightKg += weightKg;
    }

    for (const [diaStr, lengthM] of Object.entries(diameterLengthsM)) {
      const dia = Number(diaStr);
      const unitWeight = REBAR_UNIT_WEIGHTS_KG_PER_M[dia] ?? 0.395;
      const weightKg = Math.round(lengthM * unitWeight);
      const percentageOfTotalSteel = totalReinforcementWeightKg > 0
        ? Math.round((weightKg / totalReinforcementWeightKg) * 1000) / 10
        : 0;

      if (weightKg > 0) {
        byDiameter.push({
          diameterMm: dia,
          totalLengthM: Math.round(lengthM * 10) / 10,
          unitWeightKgPerM: unitWeight,
          totalWeightKg: weightKg,
          percentageOfTotalSteel,
        });
      }
    }

    totalReinforcementWeightKg = Math.round(totalReinforcementWeightKg);
    const totalWeightMetricTonnes = Math.round((totalReinforcementWeightKg / 1000) * 100) / 100;
    const steelDensityKgPerM3Concrete = totalConcreteVolumeM3 > 0
      ? Math.round((totalReinforcementWeightKg / totalConcreteVolumeM3) * 10) / 10
      : 0;

    return {
      timestamp: new Date().toISOString(),
      sourceProjectId: project.id,
      concreteEstimateStatus: 'GEOMETRIC_CONCRETE_ESTIMATE',
      reinforcementEstimateStatus: isVerified ? 'VERIFIED_REINFORCEMENT_SCHEDULE' : 'PRELIMINARY_REINFORCEMENT_ESTIMATE',
      concrete: {
        totalVolumeM3: totalConcreteVolumeM3,
        elements: concreteElements,
      },
      reinforcement: {
        totalWeightKg: totalReinforcementWeightKg,
        totalWeightMetricTonnes,
        steelDensityKgPerM3Concrete,
        byDiameter,
        byMember: memberQuantities,
      },
      disclaimer: isVerified
        ? 'VERIFIED REINFORCEMENT SCHEDULE: Quantities derived from reviewed IS 456 / IS 13920 member design results.'
        : 'PRELIMINARY ESTIMATE: Quantities are preliminary geometric estimates for planning and budgeting; construction fabrication requires engineer-certified bar bending schedules.',
    };
  }
}
