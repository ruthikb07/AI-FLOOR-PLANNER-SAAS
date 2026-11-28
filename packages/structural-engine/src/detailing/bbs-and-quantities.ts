/**
 * @ai-floor-planner/structural-engine — Reinforcement Detailing, Consolidated BBS, CSV Export & Reconciled BOQ (Carbon 4 Section 06)
 *
 * Operates strictly on PHYSICAL structural members (`PhysicalBeam`, `PhysicalColumn`, `PhysicalSlab`,
 * `PhysicalStairWaist`, `PhysicalFoundation`) via `CanonicalReinforcementSchedule`:
 * 1. Subdividing a physical beam or column into `k` analytical finite elements NEVER duplicates reinforcement cages or concrete volume!
 * 2. Uses exact IS 2502 centreline cutting lengths, non-overlapping 3-zone tie/stirrup counts, and
 *    explicit separation of net designed length vs lap/splice/anchorage length.
 * 3. Computes steel mass from exact nominal cross-sectional area × 7,850 kg/m³ and verifies
 *    `sum(byDiameter) === sum(byCategory) === sum(byFloor) === totalSteelWeightKg` (`discrepancy < 1e-6 kg`)!
 * 4. Exports RFC-4180 `BBS CSV` (`exportStructuralBbsCsv`) for direct site fabrication / spreadsheet audit.
 */

import type { SynthesizedStructuralSystem } from '../assembly/canonical-frame-assembler.js';
import type { CompleteRccDesignSummary } from '../rcc/rcc-design-engine.js';
import type { FoundationDesignSummary } from '../foundation/foundation-design-engine.js';
import {
  buildCanonicalPhysicalReinforcementRecords,
  exactNominalRebarMassKgPerM,
  type CanonicalReinforcementSchedule,
  type MassReconciliationAudit,
} from './canonical-reinforcement-model.js';

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
  readonly netDesignedLengthMm?: number;
  readonly lapOrAnchorageLengthMm?: number;
  readonly cuttingLengthMm: number;
  readonly totalLengthM: number;
  readonly unitWeightKgPerM: number;
  readonly netDesignedWeightKg?: number;
  readonly lapOrSpliceWeightKg?: number;
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
  readonly netDesignedSteelWeightKg?: number;
  readonly lapAndSpliceSteelWeightKg?: number;
  readonly steelByDiameterKg: Readonly<Record<number, number>>;
  readonly steelByCategoryKg: {
    readonly columns: number;
    readonly beams: number;
    readonly slabs: number;
    readonly stairs: number;
    readonly footings: number;
  };
  readonly steelByFloorKg: Readonly<Record<string, number>>;
  readonly massReconciliationAudit?: MassReconciliationAudit;
  readonly formworkAreaM2: number;
  readonly excavationVolumeM3: number;
  readonly pccBlindingVolumeM3: number;
  readonly indicativeStructuralCostInr: number;
}

export interface DetailingAndBoqPackage {
  readonly bbsEntries: readonly BarBendingScheduleEntry[];
  readonly quantities: StructuralMaterialBoq;
  readonly canonicalReinforcement?: CanonicalReinforcementSchedule;
}

/** Unit weight of round deformed steel bar in kg/m = π/4 * (d/1000)^2 * 7850 (= d² / 162.196, IS 1786). */
export function rebarUnitWeightKgPerM(diaMm: number): number {
  return exactNominalRebarMassKgPerM(diaMm);
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
  readonly netLengthMm: number;
  readonly lapLengthMm: number;
  readonly cuttingLengthMm: number;
}

function frameBarSpecs(canonicalFrameReinf: ReturnType<typeof buildCanonicalPhysicalReinforcementRecords>): RawBarSpec[] {
  const rawSpecs: RawBarSpec[] = [];

  // 1. Physical Beams BBS (from canonical physical beam reinforcement records!)
  for (const bm of canonicalFrameReinf.beams) {
    const anchTop = Math.max(0, bm.topContinuousCutLengthMm - bm.clearSpanMm);
    rawSpecs.push({
      prefix: 'BM',
      physicalMemberId: bm.physicalMemberId,
      scheduleGroupMark: bm.scheduleGroupMark,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: 'Top Continuous + End Support Anchorage Bars',
      shapeCode: 'SHAPE_21_U_BAR_ANCHORED',
      barDiaMm: bm.topBarDiaMm,
      barsPerMember: bm.topContinuousCount,
      netLengthMm: bm.clearSpanMm,
      lapLengthMm: anchTop,
      cuttingLengthMm: bm.topContinuousCutLengthMm,
    });

    if (bm.topExtraSupportCount > 0) {
      // Extra support hogging bars placed at both left and right supports (2 ends per extra bar line)
      const netSupportZone = Math.round(0.28 * bm.clearSpanMm);
      const anchExtra = Math.max(0, bm.topExtraSupportCutLengthMm - netSupportZone);
      rawSpecs.push({
        prefix: 'BME',
        physicalMemberId: bm.physicalMemberId,
        scheduleGroupMark: bm.scheduleGroupMark,
        memberCategory: 'BEAM',
        floorId: bm.floorId,
        description: 'Top Extra Support Hogging Bars (Both Ends)',
        shapeCode: 'SHAPE_11_L_HOOK_DOWEL',
        barDiaMm: bm.topBarDiaMm,
        barsPerMember: bm.topExtraSupportCount * 2,
        netLengthMm: netSupportZone,
        lapLengthMm: anchExtra,
        cuttingLengthMm: bm.topExtraSupportCutLengthMm,
      });
    }

    const anchBot = Math.max(0, bm.bottomCutLengthMm - bm.clearSpanMm);
    rawSpecs.push({
      prefix: 'BM',
      physicalMemberId: bm.physicalMemberId,
      scheduleGroupMark: bm.scheduleGroupMark,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: 'Bottom Main Sagging Bars',
      shapeCode: 'SHAPE_00_STRAIGHT',
      barDiaMm: bm.bottomBarDiaMm,
      barsPerMember: bm.bottomMainCount,
      netLengthMm: bm.clearSpanMm,
      lapLengthMm: anchBot,
      cuttingLengthMm: bm.bottomCutLengthMm,
    });

    rawSpecs.push({
      prefix: 'BS',
      physicalMemberId: bm.physicalMemberId,
      scheduleGroupMark: bm.scheduleGroupMark,
      memberCategory: 'BEAM',
      floorId: bm.floorId,
      description: `${bm.stirrups.legs}-Legged 135 deg Seismic Stirrups (${bm.stirrups.leftHingeCount}+${bm.stirrups.midSpanCount}+${bm.stirrups.rightHingeCount})`,
      shapeCode: 'SHAPE_51_SEISMIC_STIRRUP_135',
      barDiaMm: bm.stirrups.diaMm,
      spacingMm: bm.stirrups.spacingHingeMm,
      barsPerMember: bm.stirrups.totalStirrupSets,
      netLengthMm: bm.stirrups.cutLengthPerSetMm,
      lapLengthMm: 0,
      cuttingLengthMm: bm.stirrups.cutLengthPerSetMm,
    });
  }

  // 2. Physical Columns BBS (from canonical physical column reinforcement records — zero corner double-counting!)
  for (const col of canonicalFrameReinf.columns) {
    const isBaseLift = col.spliceType === 'FOOTING_STARTER_L_DOWEL';
    rawSpecs.push({
      prefix: 'CL',
      physicalMemberId: col.physicalMemberId,
      scheduleGroupMark: col.scheduleGroupMark,
      memberCategory: 'COLUMN',
      floorId: col.floorId,
      description: isBaseLift
        ? 'Column Longitudinal + Footing Starter L-Dowel'
        : col.spliceType === 'MECHANICAL_COUPLER_RECOMMENDED'
          ? 'Column Longitudinal (Mechanical Coupler Splice)'
          : 'Column Longitudinal + Compression Lap Splice',
      shapeCode: isBaseLift ? 'SHAPE_11_L_HOOK_DOWEL' : 'SHAPE_00_STRAIGHT',
      barDiaMm: col.layout.barDiaMm,
      barsPerMember: col.layout.uniqueBarCount,
      netLengthMm: col.longitudinalNetLengthMm,
      lapLengthMm: col.spliceOrStarterLengthMm,
      cuttingLengthMm: col.longitudinalCutLengthMm,
    });

    rawSpecs.push({
      prefix: 'CT',
      physicalMemberId: col.physicalMemberId,
      scheduleGroupMark: col.scheduleGroupMark,
      memberCategory: 'COLUMN',
      floorId: col.floorId,
      description: `Special Confining & Lateral Ties 135 deg (${col.ties.bottomZoneTieCount}+${col.ties.midZoneTieCount}+${col.ties.topZoneTieCount})`,
      shapeCode: 'SHAPE_51_SEISMIC_STIRRUP_135',
      barDiaMm: col.ties.tieDiaMm,
      spacingMm: col.ties.spacingEndZoneMm,
      barsPerMember: col.ties.totalTieSets,
      netLengthMm: col.ties.cutLengthPerSetMm,
      lapLengthMm: 0,
      cuttingLengthMm: col.ties.cutLengthPerSetMm,
    });
  }

  return rawSpecs;
}

function reconcileBarSpecs(rawSpecs: readonly RawBarSpec[]) {
  // Consolidate identical bar geometries per floor & member category (zero duplicate marks!)
  const consolidatedMap = new Map<string, { spec: RawBarSpec; physicalMemberIds: string[] }>();
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

  // Accumulate unrounded exact masses first so diameter/category/floor totals reconcile to < 1e-9 kg!
  const bbs: BarBendingScheduleEntry[] = [];
  const exactSteelByDia: Record<number, number> = {};
  const exactSteelByFloor: Record<string, number> = {};
  const exactSteelByCat = { columns: 0, beams: 0, slabs: 0, stairs: 0, footings: 0 };
  let exactNetSteelKg = 0;
  let exactLapSteelKg = 0;
  let exactTotalSteelKg = 0;

  let markSeq = 1;
  for (const { spec, physicalMemberIds } of consolidatedMap.values()) {
    const memberCount = physicalMemberIds.length;
    const totalBars = memberCount * spec.barsPerMember;
    const totalLengthM = (totalBars * spec.cuttingLengthMm) / 1000;
    const netLengthM = (totalBars * spec.netLengthMm) / 1000;
    const lapLengthM = (totalBars * spec.lapLengthMm) / 1000;
    const uwExact = exactNominalRebarMassKgPerM(spec.barDiaMm);

    const rowTotalKgExact = totalLengthM * uwExact;
    const rowNetKgExact = netLengthM * uwExact;
    const rowLapKgExact = lapLengthM * uwExact;

    exactTotalSteelKg += rowTotalKgExact;
    exactNetSteelKg += rowNetKgExact;
    exactLapSteelKg += rowLapKgExact;
    exactSteelByDia[spec.barDiaMm] = (exactSteelByDia[spec.barDiaMm] ?? 0) + rowTotalKgExact;
    exactSteelByFloor[spec.floorId] = (exactSteelByFloor[spec.floorId] ?? 0) + rowTotalKgExact;

    if (spec.memberCategory === 'COLUMN') exactSteelByCat.columns += rowTotalKgExact;
    else if (spec.memberCategory === 'BEAM') exactSteelByCat.beams += rowTotalKgExact;
    else if (spec.memberCategory === 'SLAB') exactSteelByCat.slabs += rowTotalKgExact;
    else if (spec.memberCategory === 'STAIR') exactSteelByCat.stairs += rowTotalKgExact;
    else exactSteelByCat.footings += rowTotalKgExact;

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
      netDesignedLengthMm: spec.netLengthMm,
      lapOrAnchorageLengthMm: spec.lapLengthMm,
      cuttingLengthMm: spec.cuttingLengthMm,
      totalLengthM: Number(totalLengthM.toFixed(3)),
      unitWeightKgPerM: uwExact,
      netDesignedWeightKg: rowNetKgExact,
      lapOrSpliceWeightKg: rowLapKgExact,
      totalWeightKg: rowTotalKgExact,
    });
  }

  const sumDiaExact = Object.values(exactSteelByDia).reduce((a, b) => a + b, 0);
  const sumCatExact =
    exactSteelByCat.columns +
    exactSteelByCat.beams +
    exactSteelByCat.slabs +
    exactSteelByCat.stairs +
    exactSteelByCat.footings;
  const sumFloorExact = Object.values(exactSteelByFloor).reduce((a, b) => a + b, 0);
  const sumBarMarksExact = bbs.reduce((mass, row) => mass + row.totalWeightKg, 0);
  const maxDiscrepancy = Math.max(
    Math.abs(sumBarMarksExact - exactTotalSteelKg),
    Math.abs(sumDiaExact - exactTotalSteelKg),
    Math.abs(sumCatExact - exactTotalSteelKg),
    Math.abs(sumFloorExact - exactTotalSteelKg),
    Math.abs(exactNetSteelKg + exactLapSteelKg - exactTotalSteelKg),
  );

  const massAudit: MassReconciliationAudit = {
    netDesignedSteelMassKg: Number(exactNetSteelKg.toFixed(2)),
    lapAndSpliceSteelMassKg: Number(exactLapSteelKg.toFixed(2)),
    totalCutSteelMassKg: Number(exactTotalSteelKg.toFixed(2)),
    sumByDiameterKg: Number(sumDiaExact.toFixed(2)),
    sumByCategoryKg: Number(sumCatExact.toFixed(2)),
    sumByFloorKg: Number(sumFloorExact.toFixed(2)),
    maxReconciliationDiscrepancyKg: Number(maxDiscrepancy.toExponential(4)),
    isReconciled: maxDiscrepancy <= 1e-6,
    advisoryWastagePercent: 3.0,
    advisoryGrossProcurementKg: Number((exactTotalSteelKg * 1.03).toFixed(2)),
  };

  return { bbs, massAudit, exactSteelByDia, exactSteelByFloor, exactSteelByCat, exactNetSteelKg, exactLapSteelKg, exactTotalSteelKg };
}

export function generateFrameCandidateSchedule(system:SynthesizedStructuralSystem, design:Pick<CompleteRccDesignSummary,'beams'|'columns'>) {
  const reinforcement = buildCanonicalPhysicalReinforcementRecords(system,design);
  const {bbs,massAudit} = reconcileBarSpecs(frameBarSpecs(reinforcement));
  return {scope:'PRELIMINARY_GRAVITY_FRAME_ONLY' as const,reinforcement,bbsEntries:bbs,quantities:{massReconciliationAudit:massAudit}};
}

export function generateDetailingBbsAndBoq(
  system: SynthesizedStructuralSystem,
  rcc: CompleteRccDesignSummary,
  foundation: FoundationDesignSummary,
): DetailingAndBoqPackage {
  const canonicalFrameReinf = buildCanonicalPhysicalReinforcementRecords(system,rcc,foundation);
  const rawSpecs = frameBarSpecs(canonicalFrameReinf);

  // 3. Physical Slabs BBS
  for (const sl of rcc.slabs) {
    const nShortBars = Math.ceil(sl.lyMm / sl.shortSpanBottomSpacingMm) + 1;
    const crankExtra =
      sl.panelType === 'CANTILEVER' ? 600 : Math.round(0.42 * (sl.thicknessMm - 40));
    const cutShort = Math.round(sl.lxMm + 240 + crankExtra);
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
      netLengthMm: sl.lxMm,
      lapLengthMm: cutShort - sl.lxMm,
      cuttingLengthMm: cutShort,
    });

    const nLongBars = Math.ceil(sl.lxMm / sl.longSpanSpacingMm) + 1;
    const cutLong = Math.round(sl.lyMm + 200);
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
      netLengthMm: sl.lyMm,
      lapLengthMm: 200,
      cuttingLengthMm: cutLong,
    });
  }

  // 4. Physical Stair Waists BBS
  const waistById = new Map(system.stairWaists.map((w) => [w.id, w]));
  for (const st of rcc.stairs) {
    const waist = waistById.get(st.waistId);
    const widthMm = waist?.widthMm ?? 1200;
    const riserTotalMm = (waist?.riserCount ?? 18) * (waist?.riserMm ?? 150);
    const inclinedLenMm = Math.round(Math.hypot(st.spanMm, riserTotalMm));
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
      netLengthMm: inclinedLenMm,
      lapLengthMm: 600,
      cuttingLengthMm: inclinedLenMm + 600,
    });

    const nDist = Math.ceil(inclinedLenMm / st.distributionBarSpacingMm) + 1;
    const distCut = Math.round(widthMm - 60);
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
      netLengthMm: distCut,
      lapLengthMm: 0,
      cuttingLengthMm: distCut,
    });
  }

  // 5. Physical Foundations BBS
  for (const ft of foundation.footings) {
    const meshX = parseSpacingLabel(ft.bottomMeshXLabel);
    const meshY = parseSpacingLabel(ft.bottomMeshYLabel);
    const nBarsX = Math.ceil((ft.widthYMm - 100) / meshX.spacingMm) + 1;
    const nBarsY = Math.ceil((ft.lengthXMm - 100) / meshY.spacingMm) + 1;
    const legUpMm = Math.max(150, ft.thicknessMm - 100);
    const netX = Math.max(200, ft.lengthXMm - 100);
    const cutX = Math.round(netX + 2 * legUpMm - 4 * meshX.diaMm);
    const netY = Math.max(200, ft.widthYMm - 100);
    const cutY = Math.round(netY + 2 * legUpMm - 4 * meshY.diaMm);

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
      netLengthMm: netX,
      lapLengthMm: Math.max(0, cutX - netX),
      cuttingLengthMm: cutX,
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
      netLengthMm: netY,
      lapLengthMm: Math.max(0, cutY - netY),
      cuttingLengthMm: cutY,
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
        netLengthMm: netX,
        lapLengthMm: 0,
        cuttingLengthMm: Math.round(netX),
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
          netLengthMm: netY,
          lapLengthMm: 0,
          cuttingLengthMm: Math.round(netY),
        });
      }
    }
  }

  const { bbs, massAudit, exactSteelByDia, exactSteelByFloor, exactSteelByCat, exactNetSteelKg, exactLapSteelKg, exactTotalSteelKg } = reconcileBarSpecs(rawSpecs);

  // 6. Intersection-Deduplicated Concrete, Formwork, Excavation & Steel Aggregation
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

  const roundedDia: Record<number, number> = {};
  for (const [d, v] of Object.entries(exactSteelByDia)) {
    roundedDia[Number(d)] = Number(v.toFixed(2));
  }
  const roundedFloor: Record<string, number> = {};
  for (const [f, v] of Object.entries(exactSteelByFloor)) {
    roundedFloor[f] = Number(v.toFixed(2));
  }
  const roundedGrade: Record<string, number> = {};
  for (const [g, v] of Object.entries(concByGrade)) {
    roundedGrade[g] = Number(v.toFixed(2));
  }

  const indicativeCostInr = Math.round(
    netConc * 7200 +
      exactTotalSteelKg * 76 +
      formworkM2 * 580 +
      excavationM3 * 340 +
      pccM3 * 5200,
  );

  return {
    bbsEntries: bbs,
    quantities: {
      grossConcreteVolumeM3: Number(grossConc.toFixed(2)),
      jointAndSlabIntersectionDeductionM3: Number(jointDeductionM3.toFixed(2)),
      netConcreteVolumeM3: Number(netConc.toFixed(2)),
      concreteByCategoryM3: {
        columns: Number(colConcGrossM3.toFixed(2)),
        beams: Number(Math.max(0.05, bmConcGrossM3 - jointDeductionM3).toFixed(2)),
        slabs: Number(slabConcM3.toFixed(2)),
        stairs: Number(stairConcM3.toFixed(2)),
        footings: Number(footConcM3.toFixed(2)),
      },
      concreteByGradeM3: roundedGrade,
      totalSteelWeightKg: Number(exactTotalSteelKg.toFixed(2)),
      totalSteelTonnes: Number((exactTotalSteelKg / 1000).toFixed(3)),
      netDesignedSteelWeightKg: Number(exactNetSteelKg.toFixed(2)),
      lapAndSpliceSteelWeightKg: Number(exactLapSteelKg.toFixed(2)),
      steelByDiameterKg: roundedDia,
      steelByCategoryKg: {
        columns: Number(exactSteelByCat.columns.toFixed(2)),
        beams: Number(exactSteelByCat.beams.toFixed(2)),
        slabs: Number(exactSteelByCat.slabs.toFixed(2)),
        stairs: Number(exactSteelByCat.stairs.toFixed(2)),
        footings: Number(exactSteelByCat.footings.toFixed(2)),
      },
      steelByFloorKg: roundedFloor,
      massReconciliationAudit: massAudit,
      formworkAreaM2: Number(formworkM2.toFixed(1)),
      excavationVolumeM3: Number(excavationM3.toFixed(1)),
      pccBlindingVolumeM3: Number(pccM3.toFixed(2)),
      indicativeStructuralCostInr: indicativeCostInr,
    },
    canonicalReinforcement: {
      ...canonicalFrameReinf,
      massAudit,
    },
  };
}

function csvCell(val: string | number | undefined): string {
  if (val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exports a complete, audit-grade RFC-4180 Bar Bending Schedule CSV (`Section 06 & 07`).
 */
export function exportStructuralBbsCsv(
  pkg: Pick<DetailingAndBoqPackage,'bbsEntries'> & {quantities:Pick<StructuralMaterialBoq,'massReconciliationAudit'>},
  metadata?: {
    readonly projectName?: string;
    readonly sourceArchitecturalSha256?: string;
    readonly structuralRevision?: number;
    readonly lifecycleStatus?: string;
  },
): string {
  const lines: string[] = [];
  if (metadata) {
    lines.push(
      `# RH_PLANNER_CARBON4_BBS,Project=${csvCell(metadata.projectName ?? 'Project')},ArchSHA256=${csvCell(metadata.sourceArchitecturalSha256 ?? '')},StructRev=${csvCell(metadata.structuralRevision ?? 1)},Status=${csvCell(metadata.lifecycleStatus ?? 'ANALYZED')}`,
    );
  }
  lines.push(
    [
      'BAR_MARK',
      'SCHEDULE_GROUP',
      'FLOOR_ID',
      'CATEGORY',
      'MEMBER_IDS',
      'SHAPE_CODE',
      'DIA_MM',
      'SPACING_MM',
      'MEMBER_COUNT',
      'BARS_PER_MEMBER',
      'TOTAL_BARS',
      'NET_DESIGNED_LEN_MM',
      'LAP_OR_ANCHOR_LEN_MM',
      'CUT_LEN_MM',
      'TOTAL_LEN_M',
      'UNIT_MASS_KG_M',
      'NET_DESIGNED_MASS_KG',
      'LAP_SPLICE_MASS_KG',
      'TOTAL_CUT_MASS_KG',
      'DESCRIPTION',
    ].join(','),
  );

  for (const row of pkg.bbsEntries) {
    lines.push(
      [
        csvCell(row.barMark),
        csvCell(row.scheduleGroupMark ?? ''),
        csvCell(row.floorId),
        csvCell(row.memberCategory),
        csvCell(row.physicalMemberIds.join(';')),
        csvCell(row.shapeCode),
        csvCell(row.barDiaMm),
        csvCell(row.spacingMm ?? ''),
        csvCell(row.memberCount),
        csvCell(row.barsPerMember),
        csvCell(row.totalBars),
        csvCell(row.netDesignedLengthMm ?? row.cuttingLengthMm),
        csvCell(row.lapOrAnchorageLengthMm ?? 0),
        csvCell(row.cuttingLengthMm),
        csvCell(row.totalLengthM),
        csvCell(row.unitWeightKgPerM),
        csvCell(row.netDesignedWeightKg ?? row.totalWeightKg),
        csvCell(row.lapOrSpliceWeightKg ?? 0),
        csvCell(row.totalWeightKg),
        csvCell(row.description),
      ].join(','),
    );
  }

  const audit = pkg.quantities.massReconciliationAudit;
  if (audit) {
    lines.push(
      [
        'TOTAL_RECONCILED',
        'ALL_GROUPS',
        'ALL_FLOORS',
        'SUMMARY',
        `Reconciled=${audit.isReconciled};DiscrepancyKg=${audit.maxReconciliationDiscrepancyKg}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        csvCell(audit.netDesignedSteelMassKg),
        csvCell(audit.lapAndSpliceSteelMassKg),
        csvCell(audit.totalCutSteelMassKg),
        csvCell(`Advisory +${audit.advisoryWastagePercent}% Wastage Gross = ${audit.advisoryGrossProcurementKg} kg`),
      ].join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}
