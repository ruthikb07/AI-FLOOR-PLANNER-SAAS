/**
 * @ai-floor-planner/structural-engine — Reinforcement Detailing, Consolidated BBS & Deduplicated BOQ (Milestone 5.1 Gates 2 & 10)
 *
 * Operates strictly on PHYSICAL structural members (`PhysicalBeam`, `PhysicalColumn`, `PhysicalSlab`,
 * `PhysicalStairWaist`, `PhysicalFoundation`):
 * 1. Subdividing a physical beam or column into `k` analytical finite elements NEVER duplicates reinforcement cages or concrete volume!
 * 2. Consolidates identical physical member reinforcement marks (`scheduleGroupMark` + identical cutting geometry on the same floor)
 *    with explicit `memberCount` and `memberIds`, eliminating artificial BBS mark inflation while preserving 100% exact bar counts and steel weights!
 * 3. Computes intersection-deduplicated concrete, formwork, PCC, and excavation quantities from physical dimensions.
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
  /** Consolidated group or single physical member label (e.g. `C-G1 (8 nos)` or `BM_floor_01_1`). */
  readonly memberId: string;
  /** Exact physical member IDs represented by this consolidated BBS entry (`length === memberCount`). */
  readonly physicalMemberIds: readonly string[];
  readonly scheduleGroupMark?: string;
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

interface RawBarSpec {
  readonly prefix: string;
  readonly physicalMemberId: string;
  readonly scheduleGroupMark?: string;
  readonly memberCategory: BarBendingScheduleEntry['memberCategory'];
  readonly floorId: string;
  readonly description: string;
  readonly shapeCode: IS2502ShapeCode;
  readonly barDiaMm: number;
  readonly spacingMm?: number;
  readonly barsPerMember: number;
  readonly cuttingLengthMm: number;
}

export function generateDetailingBbsAndBoq(
  system: SynthesizedStructuralSystem,
  rcc: CompleteRccDesignSummary,
  foundation: FoundationDesignSummary,
): DetailingAndBoqPackage {
  const rawSpecs: RawBarSpec[] = [];

  // 1. Physical Beams BBS (1 cage per PhysicalBeam — never duplicated across analytical segments!)
  for (const bm of rcc.beams) {
    const dTop = bm.topBarsSupport.barDiaMm;
    const cutTopMm = Math.round(bm.clearSpanMm + 2 * bm.developmentLengthMm - 4 * dTop);
    rawSpecs.push({
      prefix: 'BM',
      physicalMemberId: bm.physicalMemberId,
      scheduleGroupMark: bm.scheduleGroupMark,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: 'Top Continuous + Support Anchorage Bars',
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: dTop,
      barsPerMember: bm.topBarsSupport.barCount,
      cuttingLengthMm: cutTopMm,
    });

    const dBot = bm.bottomBarsMidspan.barDiaMm;
    const cutBotMm = Math.round(bm.clearSpanMm + 2 * Math.max(12 * dBot, 300) - 4 * dBot);
    rawSpecs.push({
      prefix: 'BM',
      physicalMemberId: bm.physicalMemberId,
      scheduleGroupMark: bm.scheduleGroupMark,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: 'Bottom Main Sagging Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: dBot,
      barsPerMember: bm.bottomBarsMidspan.barCount,
      cuttingLengthMm: cutBotMm,
    });

    const st = bm.stirrups;
    const twoHingeLen = Math.min(bm.clearSpanMm, 2 * st.hingeZoneLengthMm);
    const midLen = Math.max(0, bm.clearSpanMm - twoHingeLen);
    const nStirrups =
      Math.ceil(twoHingeLen / st.spacingHingeZoneMm) +
      Math.ceil(midLen / st.spacingMidZoneMm) +
      1;
    const coreB = Math.max(100, bm.widthMm - 2 * bm.clearCoverMm);
    const coreD = Math.max(150, bm.depthMm - 2 * bm.clearCoverMm);
    const legLoops = st.legs / 2;
    const cutStirrupMm = Math.round(
      legLoops * (2 * (coreB + coreD) + 20 * st.barDiaMm - 12 * st.barDiaMm),
    );
    rawSpecs.push({
      prefix: 'BS',
      physicalMemberId: bm.physicalMemberId,
      scheduleGroupMark: bm.scheduleGroupMark,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: `${st.legs}-Legged 135 deg Seismic Stirrups`,
      shapeCode: 'SHAPE_51_SEISMIC_STIRRUP_135',
      barDiaMm: st.barDiaMm,
      spacingMm: st.spacingHingeZoneMm,
      barsPerMember: nStirrups,
      cuttingLengthMm: cutStirrupMm,
    });
  }

  // 2. Physical Columns BBS
  for (const col of rcc.columns) {
    const dLong = col.longitudinalBars.barDiaMm;
    const isBaseLift = col.elementId.endsWith('_L0');
    const extraMm = isBaseLift ? col.spliceLengthMm + 300 - 2 * dLong : col.spliceLengthMm;
    rawSpecs.push({
      prefix: 'CL',
      physicalMemberId: col.physicalMemberId,
      scheduleGroupMark: col.scheduleGroupMark,
      memberCategory: 'COLUMN',
      floorId: col.floorId,
      description: isBaseLift
        ? 'Column Longitudinal + Footing Starter Leg'
        : 'Column Longitudinal + Lap Splice',
      shapeCode: isBaseLift ? 'SHAPE_11_L_HOOK_DOWEL' : 'SHAPE_00_STRAIGHT',
      barDiaMm: dLong,
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
    rawSpecs.push({
      prefix: 'CT',
      physicalMemberId: col.physicalMemberId,
      scheduleGroupMark: col.scheduleGroupMark,
      memberCategory: 'COLUMN',
      floorId: col.floorId,
      description: 'Special Confining & Lateral Ties (135 deg Hooks)',
      shapeCode: 'SHAPE_51_SEISMIC_STIRRUP_135',
      barDiaMm: tie.barDiaMm,
      spacingMm: tie.spacingHingeZoneMm,
      barsPerMember: nTies,
      cuttingLengthMm: cutTieMm,
    });
  }

  // 3. Physical Slabs BBS
  for (const sl of rcc.slabs) {
    const nShortBars = Math.ceil(sl.lyMm / sl.shortSpanBottomSpacingMm) + 1;
    const crankExtra =
      sl.panelType === 'CANTILEVER' ? 600 : Math.round(0.42 * (sl.thicknessMm - 40));
    rawSpecs.push({
      prefix: 'SL',
      physicalMemberId: sl.physicalMemberId,
      scheduleGroupMark: sl.scheduleGroupMark,
      memberCategory: 'SLAB',
      floorId: sl.floorId,
      description: 'Slab Short-Span Cranked/Main Bars',
      shapeCode: 'SHAPE_41_CRANKED_SLAB_BAR',
      barDiaMm: sl.shortSpanBottomDiaMm,
      spacingMm: sl.shortSpanBottomSpacingMm,
      barsPerMember: nShortBars,
      cuttingLengthMm: Math.round(sl.lxMm + 240 + crankExtra),
    });

    const nLongBars = Math.ceil(sl.lxMm / sl.longSpanSpacingMm) + 1;
    rawSpecs.push({
      prefix: 'SD',
      physicalMemberId: sl.physicalMemberId,
      scheduleGroupMark: sl.scheduleGroupMark,
      memberCategory: 'SLAB',
      floorId: sl.floorId,
      description: 'Slab Long-Span Distribution Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: sl.longSpanDiaMm,
      spacingMm: sl.longSpanSpacingMm,
      barsPerMember: nLongBars,
      cuttingLengthMm: Math.round(sl.lyMm + 200),
    });
  }

  // 4. Physical Stair Waists BBS (using actual physical stair flight width!)
  const waistById = new Map(system.stairWaists.map((w) => [w.id, w]));
  for (const st of rcc.stairs) {
    const waist = waistById.get(st.waistId);
    const widthMm = waist?.widthMm ?? 1200;
    const riserTotalMm = (waist?.riserCount ?? 18) * (waist?.riserMm ?? 150);
    const inclinedLenMm = Math.hypot(st.spanMm, riserTotalMm);
    const nMain = Math.ceil(widthMm / st.mainBarSpacingMm) + 1;
    rawSpecs.push({
      prefix: 'ST',
      physicalMemberId: st.physicalMemberId,
      memberCategory: 'STAIR',
      floorId: st.floorId,
      description: 'Staircase Waist Main Inclined Longitudinal Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: st.mainBarDiaMm,
      spacingMm: st.mainBarSpacingMm,
      barsPerMember: nMain,
      cuttingLengthMm: Math.round(inclinedLenMm + 600),
    });

    const nDist = Math.ceil(inclinedLenMm / st.distributionBarSpacingMm) + 1;
    rawSpecs.push({
      prefix: 'SDT',
      physicalMemberId: st.physicalMemberId,
      memberCategory: 'STAIR',
      floorId: st.floorId,
      description: 'Staircase Waist Transverse Distribution Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: st.distributionBarDiaMm,
      spacingMm: st.distributionBarSpacingMm,
      barsPerMember: nDist,
      cuttingLengthMm: Math.round(widthMm - 60),
    });
  }

  // 5. Physical Foundations BBS
  for (const ft of foundation.footings) {
    const meshX = parseSpacingLabel(ft.bottomMeshXLabel);
    const meshY = parseSpacingLabel(ft.bottomMeshYLabel);
    const nBarsX = Math.ceil((ft.widthYMm - 100) / meshX.spacingMm) + 1;
    const nBarsY = Math.ceil((ft.lengthXMm - 100) / meshY.spacingMm) + 1;
    const legUpMm = Math.max(150, ft.thicknessMm - 100);

    rawSpecs.push({
      prefix: 'FX',
      physicalMemberId: ft.footingId,
      scheduleGroupMark: ft.scheduleGroupMark,
      memberCategory: 'FOOTING',
      floorId: 'FOUNDATION',
      description: `${ft.typology} Bottom Mat X-Direction`,
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: meshX.diaMm,
      spacingMm: meshX.spacingMm,
      barsPerMember: nBarsX,
      cuttingLengthMm: Math.round(ft.lengthXMm - 100 + 2 * legUpMm - 4 * meshX.diaMm),
    });

    rawSpecs.push({
      prefix: 'FY',
      physicalMemberId: ft.footingId,
      scheduleGroupMark: ft.scheduleGroupMark,
      memberCategory: 'FOOTING',
      floorId: 'FOUNDATION',
      description: `${ft.typology} Bottom Mat Y-Direction`,
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: meshY.diaMm,
      spacingMm: meshY.spacingMm,
      barsPerMember: nBarsY,
      cuttingLengthMm: Math.round(ft.widthYMm - 100 + 2 * legUpMm - 4 * meshY.diaMm),
    });

    if (ft.topMeshLabel) {
      const topM = parseSpacingLabel(ft.topMeshLabel);
      const nTopX = Math.ceil((ft.widthYMm - 100) / topM.spacingMm) + 1;
      const nTopY = Math.ceil((ft.lengthXMm - 100) / topM.spacingMm) + 1;
      rawSpecs.push({
        prefix: 'FTX',
        physicalMemberId: ft.footingId,
        scheduleGroupMark: ft.scheduleGroupMark,
        memberCategory: 'FOOTING',
        floorId: 'FOUNDATION',
        description: `${ft.typology} Top Hogging Mat X-Direction`,
        shapeCode: 'SHAPE_00_STRAIGHT',
        barDiaMm: topM.diaMm,
        spacingMm: topM.spacingMm,
        barsPerMember: nTopX,
        cuttingLengthMm: Math.round(ft.lengthXMm - 100),
      });
      if (ft.typology === 'RIGID_RAFT') {
        rawSpecs.push({
          prefix: 'FTY',
          physicalMemberId: ft.footingId,
          scheduleGroupMark: ft.scheduleGroupMark,
          memberCategory: 'FOOTING',
          floorId: 'FOUNDATION',
          description: `${ft.typology} Top Hogging Mat Y-Direction`,
          shapeCode: 'SHAPE_00_STRAIGHT',
          barDiaMm: topM.diaMm,
          spacingMm: topM.spacingMm,
          barsPerMember: nTopY,
          cuttingLengthMm: Math.round(ft.widthYMm - 100),
        });
      }
    }
  }

  // Consolidate identical bar geometries per floor & member category (Gate 10: zero duplicate marks!)
  const consolidatedMap = new Map<
    string,
    { spec: RawBarSpec; physicalMemberIds: string[] }
  >();
  for (const spec of rawSpecs) {
    const key = [
      spec.floorId,
      spec.memberCategory,
      spec.scheduleGroupMark ?? spec.physicalMemberId,
      spec.prefix,
      spec.shapeCode,
      spec.barDiaMm,
      spec.spacingMm ?? 0,
      spec.barsPerMember,
      spec.cuttingLengthMm,
    ].join('|');
    const existing = consolidatedMap.get(key);
    if (existing) {
      existing.physicalMemberIds.push(spec.physicalMemberId);
    } else {
      consolidatedMap.set(key, { spec, physicalMemberIds: [spec.physicalMemberId] });
    }
  }

  const bbs: BarBendingScheduleEntry[] = [];
  let markSeq = 1;
  for (const { spec, physicalMemberIds } of consolidatedMap.values()) {
    const memberCount = physicalMemberIds.length;
    const totalBars = memberCount * spec.barsPerMember;
    const totalLengthM = (totalBars * spec.cuttingLengthMm) / 1000;
    const uw = rebarUnitWeightKgPerM(spec.barDiaMm);
    const wt = totalLengthM * uw;
    const displayMember =
      memberCount === 1
        ? physicalMemberIds[0]!
        : `${spec.scheduleGroupMark ?? physicalMemberIds[0]} (${memberCount} nos: ${physicalMemberIds.slice(0, 3).join(', ')}${memberCount > 3 ? '...' : ''})`;

    bbs.push({
      barMark: `${spec.prefix}-${String(markSeq++).padStart(3, '0')}`,
      memberId: displayMember,
      physicalMemberIds,
      scheduleGroupMark: spec.scheduleGroupMark,
      memberCategory: spec.memberCategory,
      floorId: spec.floorId,
      description: spec.description,
      shapeCode: spec.shapeCode,
      barDiaMm: spec.barDiaMm,
      spacingMm: spec.spacingMm,
      memberCount,
      barsPerMember: spec.barsPerMember,
      totalBars,
      cuttingLengthMm: spec.cuttingLengthMm,
      totalLengthM: Number(totalLengthM.toFixed(2)),
      unitWeightKgPerM: Number(uw.toFixed(3)),
      totalWeightKg: Number(wt.toFixed(2)),
    });
  }

  // 6. Intersection-Deduplicated Concrete, Formwork, Excavation & Steel Aggregation (Strictly Physical Members!)
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
    const colJointDed = bM * dM * Math.min(0.35, lM * 0.12);
    const slabFlangeDed =
      bm.category === 'PLINTH_BEAM' ? 0 : bM * Math.min(avgSlabThickM, dM * 0.4) * Math.max(0, lM - 0.35);
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
    const slopeFactor = Math.hypot(st.riserMm, st.treadMm) / Math.max(200, st.treadMm);
    const v =
      (st.horizontalSpanMm / 1000) *
      (st.widthMm / 1000) *
      ((st.waistThicknessMm / 1000) * slopeFactor + 0.5 * (st.riserMm / 1000));
    stairConcM3 += v;
    addGradeVol(system.concreteGrade, v);
    formworkM2 += (st.horizontalSpanMm / 1000) * (st.widthMm / 1000) * slopeFactor;
  }

  for (const ft of foundation.footings) {
    const lxM = ft.lengthXMm / 1000;
    const wyM = ft.widthYMm / 1000;
    const tM = ft.thicknessMm / 1000;
    const v = lxM * wyM * tM;
    footConcM3 += v;
    addGradeVol(ft.concreteGrade, v);
    formworkM2 += 2 * (lxM + wyM) * tM;
    pccM3 += (lxM + 0.2) * (wyM + 0.2) * (ft.pccThicknessMm / 1000);
    excavationM3 += (lxM + 0.3) * (wyM + 0.3) * ft.excavationDepthM;
  }

  const grossConc = colConcGrossM3 + bmConcGrossM3 + slabConcM3 + stairConcM3 + footConcM3;
  const netConc = Math.max(0.1, grossConc - jointDeductionM3);

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
