/**
 * @ai-floor-planner/structural-engine — Reinforcement Detailing, Bar Bending Schedule (BBS) & Deduplicated BOQ (Phase A17)
 *
 * Computes real reinforcement cutting lengths (IS 2502 / SP 34 bend deductions, 135° seismic hooks,
 * anchorage Ld, column lap splices), diameter-wise/floor-wise/member-wise steel schedules,
 * and intersection-deduplicated concrete, formwork, PCC, and excavation quantities!
 */

import type { SynthesizedStructuralSystem } from '../assembly/canonical-frame-assembler.js';
import type { CompleteRccDesignSummary } from '../rcc/rcc-design-engine.js';
import type { FoundationDesignSummary } from '../foundation/foundation-design-engine.js';

export type IS2502ShapeCode =
  | 'SHAPE_00_STRAIGHT'
  | 'SHAPE_21_U_BAR_ANCHORED'
  | 'SHAPE_11_L_HOOK_DOWEL'
  | 'SHAPE_51_SEISMIC_STIRRUP_135'
  | 'SHAPE_41_CRANKED_SLAB_BAR';

export interface BarBendingScheduleEntry {
  readonly barMark: string;
  readonly memberId: string;
  readonly memberCategory: 'BEAM' | 'COLUMN' | 'SLAB' | 'STAIR' | 'FOOTING';
  readonly floorId: string;
  readonly description: string;
  readonly shapeCode: IS2502ShapeCode;
  readonly barDiaMm: number;
  readonly spacingMm?: number;
  readonly memberCount: number;
  readonly barsPerMember: number;
  readonly totalBars: number;
  readonly cuttingLengthMm: number;
  readonly totalLengthM: number;
  readonly unitWeightKgPerM: number;
  readonly totalWeightKg: number;
}

export interface StructuralMaterialBoq {
  readonly grossConcreteVolumeM3: number;
  readonly jointAndSlabIntersectionDeductionM3: number;
  readonly netConcreteVolumeM3: number;
  readonly concreteByCategoryM3: {
    readonly columns: number;
    readonly beams: number;
    readonly slabs: number;
    readonly stairs: number;
    readonly footings: number;
  };
  readonly concreteByGradeM3: Readonly<Record<string, number>>;
  readonly totalSteelWeightKg: number;
  readonly totalSteelTonnes: number;
  readonly steelByDiameterKg: Readonly<Record<number, number>>;
  readonly steelByCategoryKg: {
    readonly columns: number;
    readonly beams: number;
    readonly slabs: number;
    readonly stairs: number;
    readonly footings: number;
  };
  readonly steelByFloorKg: Readonly<Record<string, number>>;
  readonly formworkAreaM2: number;
  readonly excavationVolumeM3: number;
  readonly pccBlindingVolumeM3: number;
  /** Indicative Indian construction structural material & labour cost in INR (for objective optimization comparison). */
  readonly indicativeStructuralCostInr: number;
}

export interface DetailingAndBoqPackage {
  readonly bbsEntries: readonly BarBendingScheduleEntry[];
  readonly quantities: StructuralMaterialBoq;
}

/** Unit weight of round deformed steel bar in kg/m = d² / 162.2 (IS 1786). */
export function rebarUnitWeightKgPerM(diaMm: number): number {
  return (diaMm * diaMm) / 162.2;
}

function parseSpacingLabel(label: string): { diaMm: number; spacingMm: number } {
  const m = label.match(/T(\d+)@(\d+)/i);
  if (!m) return { diaMm: 12, spacingMm: 150 };
  return { diaMm: Number(m[1]), spacingMm: Number(m[2]) };
}

export function generateDetailingBbsAndBoq(
  system: SynthesizedStructuralSystem,
  rcc: CompleteRccDesignSummary,
  foundation: FoundationDesignSummary,
): DetailingAndBoqPackage {
  const bbs: BarBendingScheduleEntry[] = [];
  let markSeq = 1;
  const nextMark = (prefix: string) => `${prefix}-${String(markSeq++).padStart(3, '0')}`;

  const pushBbs = (entry: Omit<BarBendingScheduleEntry, 'totalBars' | 'totalLengthM' | 'unitWeightKgPerM' | 'totalWeightKg'>) => {
    const totalBars = entry.memberCount * entry.barsPerMember;
    const totalLengthM = (totalBars * entry.cuttingLengthMm) / 1000;
    const uw = rebarUnitWeightKgPerM(entry.barDiaMm);
    const wt = totalLengthM * uw;
    bbs.push({
      ...entry,
      totalBars,
      cuttingLengthM: undefined,
      totalLengthM: Number(totalLengthM.toFixed(2)),
      unitWeightKgPerM: Number(uw.toFixed(3)),
      totalWeightKg: Number(wt.toFixed(2)),
    } as BarBendingScheduleEntry);
  };

  // 1. Beams BBS (Top main + Bottom main + 135° Seismic Stirrups)
  for (const bm of rcc.beams) {
    // Top bars: clearSpan + 2 * Ld - 2 * (2 * d_bar for two 90° standard end bends per IS 2502)
    const dTop = bm.topBarsSupport.barDiaMm;
    const cutTopMm = Math.round(bm.clearSpanMm + 2 * bm.developmentLengthMm - 4 * dTop);
    pushBbs({
      barMark: nextMark('BM'),
      memberId: bm.elementId,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: 'Top Continuous + Support Anchorage Bars',
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: dTop,
      memberCount: 1,
      barsPerMember: bm.topBarsSupport.barCount,
      cuttingLengthMm: cutTopMm,
    });

    const dBot = bm.bottomBarsMidspan.barDiaMm;
    const cutBotMm = Math.round(bm.clearSpanMm + 2 * Math.max(12 * dBot, 300) - 4 * dBot);
    pushBbs({
      barMark: nextMark('BM'),
      memberId: bm.elementId,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: 'Bottom Main Sagging Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: dBot,
      memberCount: 1,
      barsPerMember: bm.bottomBarsMidspan.barCount,
      cuttingLengthMm: cutBotMm,
    });

    // Stirrups: 2 * hingeZoneLength / spacingHinge + remaining / spacingMid + 1
    const st = bm.stirrups;
    const twoHingeLen = Math.min(bm.clearSpanMm, 2 * st.hingeZoneLengthMm);
    const midLen = Math.max(0, bm.clearSpanMm - twoHingeLen);
    const nStirrups =
      Math.ceil(twoHingeLen / st.spacingHingeZoneMm) +
      Math.ceil(midLen / st.spacingMidZoneMm) +
      1;
    // Rectangular hoop perimeter + two 135° seismic hooks (2 * 10d = 20d) - three 90° bends (6d) - two 135° bends (6d)
    const coreB = Math.max(100, bm.widthMm - 2 * bm.clearCoverMm);
    const coreD = Math.max(150, bm.depthMm - 2 * bm.clearCoverMm);
    const legLoops = st.legs / 2;
    const cutStirrupMm = Math.round(legLoops * (2 * (coreB + coreD) + 20 * st.barDiaMm - 12 * st.barDiaMm));
    pushBbs({
      barMark: nextMark('BS'),
      memberId: bm.elementId,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: `${st.legs}-Legged 135° Seismic Stirrups`,
      shapeCode: 'SHAPE_51_SEISMIC_STIRRUP_135',
      barDiaMm: st.barDiaMm,
      spacingMm: st.spacingHingeZoneMm,
      memberCount: 1,
      barsPerMember: nStirrups,
      cuttingLengthMm: cutStirrupMm,
    });
  }

  // 2. Columns BBS (Longitudinal bars + Lap Splice + Confining Hoops)
  for (const col of rcc.columns) {
    const dLong = col.longitudinalBars.barDiaMm;
    // Vertical length = storey height + compression/tension lap splice (or L-bend starter on lowest lift)
    const isBaseLift = col.elementId.endsWith('_L0');
    const extraMm = isBaseLift ? col.spliceLengthMm + 300 - 2 * dLong : col.spliceLengthMm;
    pushBbs({
      barMark: nextMark('CL'),
      memberId: col.elementId,
      memberCategory: 'COLUMN',
      floorId: col.floorId,
      description: isBaseLift ? 'Column Longitudinal + Footing Starter Leg' : 'Column Longitudinal + Lap Splice',
      shapeCode: isBaseLift ? 'SHAPE_11_L_HOOK_DOWEL' : 'SHAPE_00_STRAIGHT',
      barDiaMm: dLong,
      memberCount: 1,
      barsPerMember: col.longitudinalBars.barCount,
      cuttingLengthMm: Math.round(col.clearHeightMm + extraMm),
    });

    const tie = col.lateralTies;
    const twoLo = Math.min(col.clearHeightMm, 2 * tie.hingeZoneLengthMm);
    const midH = Math.max(0, col.clearHeightMm - twoLo);
    const nTies =
      Math.ceil(twoLo / tie.spacingHingeZoneMm) + Math.ceil(midH / tie.spacingMidZoneMm) + 1;
    const coreB = Math.max(120, col.widthMm - 80);
    const coreD = Math.max(120, col.depthMm - 80);
    const cutTieMm = Math.round((tie.legs / 2) * (2 * (coreB + coreD) + 8 * tie.barDiaMm));
    pushBbs({
      barMark: nextMark('CT'),
      memberId: col.elementId,
      memberCategory: 'COLUMN',
      floorId: col.floorId,
      description: 'Special Confining & Lateral Ties (135° Hooks)',
      shapeCode: 'SHAPE_51_SEISMIC_STIRRUP_135',
      barDiaMm: tie.barDiaMm,
      spacingMm: tie.spacingHingeZoneMm,
      memberCount: 1,
      barsPerMember: nTies,
      cuttingLengthMm: cutTieMm,
    });
  }

  // 3. Slabs BBS
  for (const sl of rcc.slabs) {
    const nShortBars = Math.ceil(sl.lyMm / sl.shortSpanBottomSpacingMm) + 1;
    const crankExtra = sl.panelType === 'CANTILEVER' ? 600 : Math.round(0.42 * (sl.thicknessMm - 40));
    pushBbs({
      barMark: nextMark('SL'),
      memberId: sl.panelId,
      memberCategory: 'SLAB',
      floorId: sl.floorId,
      description: `${sl.roomName} Short-Span Cranked/Main Bars`,
      shapeCode: 'SHAPE_41_CRANKED_SLAB_BAR',
      barDiaMm: sl.shortSpanBottomDiaMm,
      spacingMm: sl.shortSpanBottomSpacingMm,
      memberCount: 1,
      barsPerMember: nShortBars,
      cuttingLengthMm: Math.round(sl.lxMm + 240 + crankExtra),
    });

    const nLongBars = Math.ceil(sl.lxMm / sl.longSpanSpacingMm) + 1;
    pushBbs({
      barMark: nextMark('SD'),
      memberId: sl.panelId,
      memberCategory: 'SLAB',
      floorId: sl.floorId,
      description: `${sl.roomName} Long-Span Distribution Bars`,
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: sl.longSpanDiaMm,
      spacingMm: sl.longSpanSpacingMm,
      memberCount: 1,
      barsPerMember: nLongBars,
      cuttingLengthMm: Math.round(sl.lyMm + 200),
    });
  }

  // 4. Stairs BBS
  for (const st of rcc.stairs) {
    const widthMm = 1200;
    const nMain = Math.ceil(widthMm / st.mainBarSpacingMm) + 1;
    pushBbs({
      barMark: nextMark('ST'),
      memberId: st.waistId,
      memberCategory: 'STAIR',
      floorId: st.floorId,
      description: 'Staircase Waist Main Longitudinal Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: st.mainBarDiaMm,
      spacingMm: st.mainBarSpacingMm,
      memberCount: 1,
      barsPerMember: nMain,
      cuttingLengthMm: Math.round(st.spanMm * 1.15 + 600),
    });
  }

  // 5. Foundations BBS
  for (const ft of foundation.footings) {
    const meshX = parseSpacingLabel(ft.bottomMeshXLabel);
    const meshY = parseSpacingLabel(ft.bottomMeshYLabel);
    const nBarsX = Math.ceil((ft.widthYMm - 100) / meshX.spacingMm) + 1;
    const nBarsY = Math.ceil((ft.lengthXMm - 100) / meshY.spacingMm) + 1;
    const legUpMm = Math.max(150, ft.thicknessMm - 100);

    pushBbs({
      barMark: nextMark('FX'),
      memberId: ft.footingId,
      memberCategory: 'FOOTING',
      floorId: 'FOUNDATION',
      description: `${ft.typology} Bottom Mat X-Direction`,
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: meshX.diaMm,
      spacingMm: meshX.spacingMm,
      memberCount: 1,
      barsPerMember: nBarsX,
      cuttingLengthMm: Math.round(ft.lengthXMm - 100 + 2 * legUpMm - 4 * meshX.diaMm),
    });

    pushBbs({
      barMark: nextMark('FY'),
      memberId: ft.footingId,
      memberCategory: 'FOOTING',
      floorId: 'FOUNDATION',
      description: `${ft.typology} Bottom Mat Y-Direction`,
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: meshY.diaMm,
      spacingMm: meshY.spacingMm,
      memberCount: 1,
      barsPerMember: nBarsY,
      cuttingLengthMm: Math.round(ft.widthYMm - 100 + 2 * legUpMm - 4 * meshY.diaMm),
    });

    if (ft.topMeshLabel) {
      const topM = parseSpacingLabel(ft.topMeshLabel);
      const nTop = Math.ceil((ft.widthYMm - 100) / topM.spacingMm) + 1;
      pushBbs({
        barMark: nextMark('FT'),
        memberId: ft.footingId,
        memberCategory: 'FOOTING',
        floorId: 'FOUNDATION',
        description: `${ft.typology} Top Hogging Mat`,
        shapeCode: 'SHAPE_00_STRAIGHT',
        barDiaMm: topM.diaMm,
        spacingMm: topM.spacingMm,
        memberCount: 1,
        barsPerMember: nTop,
        cuttingLengthMm: Math.round(ft.lengthXMm - 100),
      });
    }
  }

  // 6. Intersection-Deduplicated Concrete, Formwork, Excavation & Steel Aggregation!
  let colConcGrossM3 = 0;
  let bmConcGrossM3 = 0;
  let slabConcM3 = 0;
  let stairConcM3 = 0;
  let footConcM3 = 0;
  let jointDeductionM3 = 0;
  let formworkM2 = 0;
  let excavationM3 = 0;
  let pccM3 = 0;
  const concByGrade: Record<string, number> = {};

  const addGradeVol = (grade: string, vol: number) => {
    concByGrade[grade] = (concByGrade[grade] ?? 0) + vol;
  };

  for (const col of rcc.columns) {
    const v = (col.widthMm / 1000) * (col.depthMm / 1000) * (col.clearHeightMm / 1000);
    colConcGrossM3 += v;
    addGradeVol(col.concreteGrade, v);
    formworkM2 += 2 * ((col.widthMm + col.depthMm) / 1000) * (col.clearHeightMm / 1000);
  }

  const avgSlabThickM =
    rcc.slabs.length > 0
      ? rcc.slabs.reduce((s, p) => s + p.thicknessMm, 0) / rcc.slabs.length / 1000
      : 0.135;

  for (const bm of rcc.beams) {
    const bM = bm.widthMm / 1000;
    const dM = bm.depthMm / 1000;
    const lM = bm.clearSpanMm / 1000;
    const vGross = bM * dM * lM;
    // Deduct beam-column joint end overlap (~0.32 m column depth at ends) AND slab-beam top flange overlap!
    const colJointDed = bM * dM * Math.min(0.35, lM * 0.12);
    const slabFlangeDed = bm.category === 'PLINTH_BEAM' ? 0 : bM * Math.min(avgSlabThickM, dM * 0.4) * Math.max(0, lM - 0.35);
    const ded = colJointDed + slabFlangeDed;
    const vNet = Math.max(0.01, vGross - ded);

    bmConcGrossM3 += vGross;
    jointDeductionM3 += ded;
    addGradeVol(bm.concreteGrade, vNet);
    const netWebDepthM = Math.max(0.15, dM - (bm.category === 'PLINTH_BEAM' ? 0 : avgSlabThickM));
    formworkM2 += (bM + 2 * netWebDepthM) * Math.max(0, lM - 0.3);
  }

  for (const panel of system.slabPanels) {
    const v = panel.areaM2 * (panel.thicknessMm / 1000);
    slabConcM3 += v;
    addGradeVol(panel.concreteGrade, v);
    formworkM2 += panel.areaM2;
  }

  for (const st of system.stairWaists) {
    const v =
      (st.horizontalSpanMm / 1000) *
      (st.widthMm / 1000) *
      ((st.waistThicknessMm / 1000) * 1.15 + 0.5 * (st.riserMm / 1000));
    stairConcM3 += v;
    addGradeVol(system.concreteGrade, v);
    formworkM2 += (st.horizontalSpanMm / 1000) * (st.widthMm / 1000) * 1.25;
  }

  for (const ft of foundation.footings) {
    const lxM = ft.lengthXMm / 1000;
    const wyM = ft.widthYMm / 1000;
    const tM = ft.thicknessMm / 1000;
    const v = lxM * wyM * tM;
    footConcM3 += v;
    addGradeVol(ft.concreteGrade, v);
    formworkM2 += 2 * (lxM + wyM) * tM;

    // PCC blinding extends 100 mm on all sides; excavation adds working space 150 mm per side
    pccM3 += (lxM + 0.2) * (wyM + 0.2) * (ft.pccThicknessMm / 1000);
    excavationM3 += (lxM + 0.3) * (wyM + 0.3) * ft.excavationDepthM;
  }

  const grossConc = colConcGrossM3 + bmConcGrossM3 + slabConcM3 + stairConcM3 + footConcM3;
  const netConc = Math.max(0.1, grossConc - jointDeductionM3);

  // Steel aggregation
  const steelByDia: Record<number, number> = {};
  const steelByFloor: Record<string, number> = {};
  const steelByCat = { columns: 0, beams: 0, slabs: 0, stairs: 0, footings: 0 };
  let totalSteelKg = 0;

  for (const row of bbs) {
    totalSteelKg += row.totalWeightKg;
    steelByDia[row.barDiaMm] = Number(((steelByDia[row.barDiaMm] ?? 0) + row.totalWeightKg).toFixed(2));
    steelByFloor[row.floorId] = Number(((steelByFloor[row.floorId] ?? 0) + row.totalWeightKg).toFixed(2));
    if (row.memberCategory === 'COLUMN') steelByCat.columns += row.totalWeightKg;
    else if (row.memberCategory === 'BEAM') steelByCat.beams += row.totalWeightKg;
    else if (row.memberCategory === 'SLAB') steelByCat.slabs += row.totalWeightKg;
    else if (row.memberCategory === 'STAIR') steelByCat.stairs += row.totalWeightKg;
    else steelByCat.footings += row.totalWeightKg;
  }

  // Indicative Indian RCC Rate Model (M25 ~ ₹7,800/m³, M30 ~ ₹8,400/m³, M35+ ~ ₹9,100/m³; HYSD Rebar ~ ₹76/kg; Formwork ~ ₹550/m²; Excavation+PCC ~ ₹450/m³)
  let concCostInr = 0;
  for (const [gr, vol] of Object.entries(concByGrade)) {
    const rate = gr === 'M20' ? 7300 : gr === 'M25' ? 7800 : gr === 'M30' ? 8400 : gr === 'M35' ? 9000 : 9600;
    concCostInr += vol * rate;
  }
  const indicativeCostInr = Math.round(
    concCostInr + totalSteelKg * 76 + formworkM2 * 550 + excavationM3 * 320 + pccM3 * 5200,
  );

  const normalizedByGrade: Record<string, number> = {};
  for (const [k, v] of Object.entries(concByGrade)) {
    normalizedByGrade[k] = Number(v.toFixed(2));
  }

  return {
    bbsEntries: bbs,
    quantities: {
      grossConcreteVolumeM3: Number(grossConc.toFixed(2)),
      jointAndSlabIntersectionDeductionM3: Number(jointDeductionM3.toFixed(2)),
      netConcreteVolumeM3: Number(netConc.toFixed(2)),
      concreteByCategoryM3: {
        columns: Number(colConcGrossM3.toFixed(2)),
        beams: Number(Math.max(0, bmConcGrossM3 - jointDeductionM3).toFixed(2)),
        slabs: Number(slabConcM3.toFixed(2)),
        stairs: Number(stairConcM3.toFixed(2)),
        footings: Number(footConcM3.toFixed(2)),
      },
      concreteByGradeM3: normalizedByGrade,
      totalSteelWeightKg: Number(totalSteelKg.toFixed(1)),
      totalSteelTonnes: Number((totalSteelKg / 1000).toFixed(3)),
      steelByDiameterKg: steelByDia,
      steelByCategoryKg: {
        columns: Number(steelByCat.columns.toFixed(1)),
        beams: Number(steelByCat.beams.toFixed(1)),
        slabs: Number(steelByCat.slabs.toFixed(1)),
        stairs: Number(steelByCat.stairs.toFixed(1)),
        footings: Number(steelByCat.footings.toFixed(1)),
      },
      steelByFloorKg: steelByFloor,
      formworkAreaM2: Number(formworkM2.toFixed(1)),
      excavationVolumeM3: Number(excavationM3.toFixed(1)),
      pccBlindingVolumeM3: Number(pccM3.toFixed(2)),
      indicativeStructuralCostInr: indicativeCostInr,
    },
  };
}
